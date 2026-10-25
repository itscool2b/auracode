//! The session manager's tests that need the crate's internals: a store whose FIFO and retry are
//! shrunk (saving pauses within a test), a small actor outbox, and the actor's panic hook.

use std::sync::Mutex;
use std::time::Duration;

use aura_agents::{Detector, FixedAgent};
use aura_drivers::driver::{DriverEvent, DriverExit, ReadyInfo, ResumeOutcome};
use aura_drivers::testing::{CommandMatch, ScriptedDriver, Step};
use aura_process::testing::{FakeAgentEnd, FakeCall, FakeSpawner};
use aura_process::{EnvKey, EnvMap, LaunchSpec, ProcessCwd, ResolvedEnv};
use aura_protocol::session::{PauseReason, StorageState};
use aura_protocol::{AuraEvent, Capabilities, StopReason};

use super::*;
use crate::chatstore::WriterConfig;
use crate::owner::ProfileOwner;
use crate::paths::DataRoot;
use crate::profile::{Profile, Profiles};
use crate::store::Store;

/// A manager over a temporary profile whose store and actors run with test limits.
struct Rig {
    _dir: tempfile::TempDir,
    profile: Profile,
    folder: PathBuf,
    store: Arc<ChatStore>,
    manager: SessionManager,
    spawner: Arc<FakeSpawner>,
    _ends: mpsc::UnboundedReceiver<FakeAgentEnd>,
    statuses: Arc<Statuses>,
}

fn launch() -> LaunchSpec {
    LaunchSpec {
        label: "fake agent".into(),
        program: PathBuf::from("/bin/fake-agent"),
        args: Vec::new(),
        cwd: ProcessCwd::ChatFolder,
        set_env: Vec::new(),
        daemons: Vec::new(),
        startup_timeout: Duration::from_secs(60),
    }
}

fn ready_step(native: &str) -> Step {
    Step::Emit(DriverEvent::Ready(ReadyInfo {
        native_session_id: native.into(),
        agent_name: Some("Demo".into()),
        agent_version: Some("1.0.0".into()),
        capabilities: Capabilities::default(),
        resumed: ResumeOutcome::New,
        spawn_id: "spawn-1".into(),
        replay: None,
    }))
}

fn delta(text: &str) -> Step {
    Step::EmitInTurn(DriverEvent::Event {
        turn: None,
        event: AuraEvent::MessageDelta {
            message_id: "m1".into(),
            text: text.into(),
        },
    })
}

fn rig(drivers: Vec<ScriptedDriver>, config: WriterConfig, knobs: Knobs) -> Rig {
    let dir = tempfile::tempdir().expect("tempdir");
    let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
        .open_active()
        .expect("profile");
    let folder = dir.path().join("work");
    std::fs::create_dir_all(&folder).expect("folder");
    let owner = ProfileOwner::acquire(&profile).expect("owner");
    let (store, _) = Store::open(&profile).expect("store");
    let rt = Handle::current();
    let store = ChatStore::start_with(store, owner, &profile, "device".into(), rt.clone(), config)
        .expect("store");
    let mut vars = EnvMap::new();
    vars.insert(EnvKey::from("PATH"), "/usr/bin".into());
    let env = EnvResolver::fixed(ResolvedEnv {
        vars,
        source: EnvSource::Fallback {
            reason: "test".into(),
        },
        warnings: Vec::new(),
        resolved_at_ms: 0,
    });
    let spec = aura_agents::get("mock").expect("mock").clone();
    let detector = Detector::fixed(vec![FixedAgent::new(
        spec,
        aura_protocol::session::Availability::Ready {
            version: None,
            path: "built in".into(),
        },
        Some(launch()),
    )]);
    let (spawner, ends) = FakeSpawner::new();
    let redactor = Arc::new(Redactor::standard());
    let logs = LogFactory::new(
        profile.logs_dir().join("protocol"),
        Arc::clone(&redactor),
        rt.clone(),
    );
    let manager = SessionManager::with_knobs(
        ManagerDeps {
            store: Arc::clone(&store),
            env,
            spawner: spawner.clone(),
            detector,
            drivers: aura_drivers::testing::ScriptedDriverFactory::new(drivers),
            logs,
            redactor,
            device_id: "device".into(),
            app_version: "0.1.0".into(),
            limits: ManagerLimits::STANDARD,
            timings: SessionTimings::STANDARD,
            rt,
        },
        knobs,
    );
    let statuses = Arc::new(Statuses::default());
    manager.status_subscribe(statuses.clone());
    Rig {
        _dir: dir,
        profile,
        folder,
        store,
        manager,
        spawner,
        _ends: ends,
        statuses,
    }
}

/// A store that pauses quickly and a FIFO and outbox that fill quickly.
fn tight() -> (WriterConfig, Knobs) {
    (
        WriterConfig {
            fifo_ops: 8,
            fifo_bytes: 64 * 1024,
            disk_full_retry: Duration::from_millis(50),
            ..WriterConfig::STANDARD
        },
        Knobs {
            outbox_bytes: 64 * 1024,
        },
    )
}

#[derive(Default)]
struct Statuses {
    updates: Mutex<Vec<ChatStatusUpdate>>,
}

impl StatusSink for Statuses {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone> {
        lock(&self.updates).push(update.clone());
        Ok(())
    }

    fn owner(&self) -> &str {
        "main"
    }
}

impl Statuses {
    fn status(&self, chat: &str) -> Option<SessionStatus> {
        lock(&self.updates)
            .iter()
            .rev()
            .find(|update| update.chat_id == chat)
            .map(|update| update.status)
    }
}

#[derive(Default)]
struct Sink {
    frames: Mutex<Vec<EventBatch>>,
}

impl FrameSink for Sink {
    fn send(&self, frame: &EventBatch) -> Result<(), SinkGone> {
        lock(&self.frames).push(frame.clone());
        Ok(())
    }

    fn owner(&self) -> &str {
        "main"
    }
}

async fn eventually(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while !condition() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting until {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn status(rig: &Rig, chat: &str, wanted: SessionStatus) {
    let statuses = Arc::clone(&rig.statuses);
    let chat = chat.to_owned();
    eventually(&format!("{chat} is {wanted:?}"), move || {
        statuses.status(&chat) == Some(wanted)
    })
    .await;
}

/// Caps the database at its current size (plus one page): the next batch that grows it fails
/// with SQLITE_FULL.
fn fill_disk(store: &ChatStore) {
    store.with_store(|store| {
        let pages: i64 = store
            .conn()
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .expect("pages");
        let _: i64 = store
            .conn()
            .query_row(
                &format!("PRAGMA max_page_count = {}", pages + 1),
                [],
                |row| row.get(0),
            )
            .expect("cap");
    });
}

fn free_disk(store: &ChatStore) {
    store.with_store(|store| {
        let _: i64 = store
            .conn()
            .query_row("PRAGMA max_page_count = 1073741823", [], |row| row.get(0))
            .expect("uncap");
    });
}

async fn paused(rig: &Rig) {
    let mut status = rig.store.status();
    tokio::time::timeout(
        Duration::from_secs(30),
        status.wait_for(|status| matches!(status.state, StorageState::Paused { .. })),
    )
    .await
    .expect("saving pauses")
    .expect("status");
}

/// A flood of agent text: 300 deltas of 2 KB each, then the turn's end and a crash.
fn flooding_driver() -> (ScriptedDriver, aura_drivers::testing::ScriptHandle) {
    let mut steps = vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
    ];
    for i in 0..300 {
        steps.push(delta(&format!("{i:04}{}", "z".repeat(2000))));
    }
    steps.push(Step::EndTurn {
        stop_reason: StopReason::EndTurn,
        usage: None,
        error: None,
    });
    steps.push(Step::Exit(DriverExit::Crashed {
        exit: None,
        stderr_tail: String::new(),
    }));
    ScriptedDriver::new(steps)
}

fn flood_text() -> String {
    (0..300)
        .map(|i| format!("{i:04}{}", "z".repeat(2000)))
        .collect()
}

/// S3: a full disk pauses saving; the writer keeps only the failed batch, the FIFO and the
/// actor's outbox fill, and the backpressure reaches the agent, which blocks; the agent exiting
/// meanwhile loses nothing; freeing space resumes and every event is saved.
#[tokio::test]
async fn disk_full_pauses_without_loss() {
    let (config, knobs) = tight();
    let (driver, handle) = flooding_driver();
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "write a lot".into())
        .await
        .expect("send");
    paused(&rig).await;
    assert!(matches!(
        rig.manager.storage_status().state,
        StorageState::Paused {
            reason: PauseReason::DiskFull,
            ..
        }
    ));
    // The agent is blocked: its turn's end and its exit stay unseen while saving is paused.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(rig.statuses.status(&chat.id), Some(SessionStatus::Running));
    assert!(handle.commands().len() == 1, "only the prompt reached it");
    free_disk(&rig.store);
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let mut storage = rig.store.status();
    tokio::time::timeout(
        Duration::from_secs(30),
        storage.wait_for(|status| status.state == StorageState::Ok),
    )
    .await
    .expect("saving resumes")
    .expect("status");
    let page = rig
        .manager
        .history(&chat.id, u32::MAX, Some(4 * 1024 * 1024))
        .await
        .expect("history");
    let text: String = page
        .items
        .iter()
        .filter_map(|item| match &item.event {
            AuraEvent::MessageDelta { message_id, text } if message_id == "m1" => {
                Some(text.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(text.len(), flood_text().len());
    assert_eq!(text, flood_text(), "nothing was lost");
    assert!(page.items.iter().any(|item| matches!(
        item.event,
        AuraEvent::TurnEnded {
            stop_reason: StopReason::EndTurn,
            ..
        }
    )));
}

/// S8: while saving is paused, an attach is served at once from saved rows, with the unsaved part
/// marked; chat lists answer at once; the view attaches again fully once saving resumes.
#[tokio::test]
async fn attach_while_paused_reads_saved_rows() {
    let (config, knobs) = tight();
    let (driver, _handle) = flooding_driver();
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "write a lot".into())
        .await
        .expect("send");
    paused(&rig).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let started = std::time::Instant::now();
    let attach = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("attach while paused");
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    assert!(matches!(
        attach.snapshot.storage.state,
        StorageState::Paused { .. }
    ));
    let unsaved = attach
        .history
        .unsaved_from
        .expect("the unsaved rows are marked");
    assert!(attach.history.items.iter().all(|item| item.seq < unsaved));
    assert!(unsaved < attach.next_seq);
    let started = std::time::Instant::now();
    assert_eq!(rig.manager.chats().await.expect("chats").len(), 1);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "reads never wait behind the paused writer"
    );
    free_disk(&rig.store);
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let mut storage = rig.store.status();
    tokio::time::timeout(
        Duration::from_secs(30),
        storage.wait_for(|status| status.state == StorageState::Ok),
    )
    .await
    .expect("saving resumes")
    .expect("status");
    let again = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("attach again");
    assert_eq!(again.history.unsaved_from, None);
}

/// S34: force stop works while saving is paused and the agent floods.
#[tokio::test]
async fn force_stop_while_storage_paused() {
    let (config, knobs) = tight();
    let (driver, _handle) = flooding_driver();
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "write a lot".into())
        .await
        .expect("send");
    paused(&rig).await;
    // The actor still answers while its outbox is full: actors and drivers never wait on each other.
    rig.manager
        .lists(&chat.id)
        .await
        .expect("the actor answers");
    rig.manager.force_stop(&chat.id).await.expect("force stop");
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let control = &rig.spawner.controls()[0];
    eventually("the agent's process is force-stopped", || {
        control
            .calls()
            .contains(&FakeCall::Shutdown(aura_process::ShutdownPlan::FORCE))
    })
    .await;
    free_disk(&rig.store);
}

/// S25: quitting while paused is bounded; what was not saved is dropped (and logged by count), and
/// the next start reads a consistent database.
#[tokio::test]
async fn quit_while_paused() {
    let (config, knobs) = tight();
    let (driver, _handle) = flooding_driver();
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "write a lot".into())
        .await
        .expect("send");
    paused(&rig).await;
    let started = std::time::Instant::now();
    let summary = rig.manager.shutdown_all(Duration::from_millis(500)).await;
    assert_eq!(summary.forced, 1, "{summary:?}");
    assert!(
        !rig.store.shutdown(Duration::from_millis(300)).await,
        "something was unsaved"
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
    // The next start: recovery ends the turn the quit cut short.
    let Rig {
        profile,
        manager,
        store,
        ..
    } = rig;
    drop(manager);
    drop(store);
    let owner = ProfileOwner::acquire(&profile).expect("owner");
    let (reopened, _) = Store::open(&profile).expect("reopen");
    let store = ChatStore::start(
        reopened,
        owner,
        &profile,
        "device".into(),
        Handle::current(),
    )
    .expect("store");
    let report = store.recovered().await;
    assert!(report.interrupted_turns <= 1);
    let load = store.load_chat(&chat.id).await.expect("load");
    assert_eq!(load.chat.id, chat.id);
    assert!(store.shutdown(Duration::from_secs(5)).await);
}

/// S34: an agent flooding while saving is paused never deadlocks with its actor: the actor
/// stops reading but keeps answering, the driver keeps answering commands while it waits for room
/// (an option change completes), and once saving resumes everything flows and is saved.
#[tokio::test]
async fn actor_and_driver_never_deadlock() {
    let (config, knobs) = tight();
    let option = aura_protocol::session::ConfigOption {
        id: "model".into(),
        name: "Model".into(),
        description: None,
        category: aura_protocol::session::ConfigCategory::Model,
        kind: aura_protocol::session::ConfigKind::Select {
            current: "fast".into(),
            choices: vec![
                aura_protocol::session::ConfigChoice {
                    value: "fast".into(),
                    name: "Fast".into(),
                    description: None,
                    group: None,
                },
                aura_protocol::session::ConfigChoice {
                    value: "smart".into(),
                    name: "Smart".into(),
                    description: None,
                    group: None,
                },
            ],
        },
        pending: None,
    };
    let mut steps = vec![
        Step::Spawn(launch()),
        Step::Emit(DriverEvent::Options(vec![option])),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
    ];
    for i in 0..300 {
        steps.push(delta(&format!("{i:04}{}", "z".repeat(2000))));
    }
    steps.push(Step::EndTurn {
        stop_reason: StopReason::EndTurn,
        usage: None,
        error: None,
    });
    // The option change arrived during the flood; then the prompt queued meanwhile.
    steps.push(Step::Expect(CommandMatch::SetOption));
    steps.push(Step::Expect(CommandMatch::Prompt));
    steps.push(Step::EndTurn {
        stop_reason: StopReason::EndTurn,
        usage: None,
        error: None,
    });
    let (driver, handle) = ScriptedDriver::new(steps);
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "write a lot".into())
        .await
        .expect("send");
    paused(&rig).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        rig.statuses.status(&chat.id),
        Some(SessionStatus::Running),
        "blocked, not done"
    );
    let lists = tokio::time::timeout(
        Duration::from_secs(5),
        rig.manager.set_option(
            &chat.id,
            "model",
            aura_protocol::session::ConfigValue::Choice {
                value: "smart".into(),
            },
        ),
    )
    .await
    .expect("no deadlock")
    .expect("the option change completes");
    assert_eq!(lists.options.len(), 1);
    assert!(handle.commands().iter().any(|command| matches!(
        command,
        aura_drivers::driver::LoggedCommand::SetOption { .. }
    )));
    let queued = rig
        .manager
        .send(&chat.id, "next".into())
        .await
        .expect("send while blocked");
    assert!(queued.queued);
    free_disk(&rig.store);
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let page = rig
        .manager
        .history(&chat.id, u32::MAX, Some(4 * 1024 * 1024))
        .await
        .expect("history");
    let text: String = page
        .items
        .iter()
        .filter_map(|item| match &item.event {
            AuraEvent::MessageDelta { message_id, text } if message_id == "m1" => {
                Some(text.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(text, flood_text());
}

/// S22: a chat actor that panics: its processes are killed, its views end, the chat reads
/// `Stopped`, and the next call recreates it, which recovers the running turn.
#[tokio::test]
async fn actor_panic_is_contained() {
    let (driver, _handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        delta("partial"),
        Step::Hang,
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("create");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let sink = Arc::new(Sink::default());
    rig.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    rig.manager.send(&chat.id, "go".into()).await.expect("send");
    status(&rig, &chat.id, SessionStatus::Running).await;
    // Let the turn's first rows reach the store.
    rig.manager
        .history(&chat.id, u32::MAX, None)
        .await
        .expect("history");
    rig.manager.panic_actor(&chat.id);
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let control = &rig.spawner.controls()[0];
    eventually("the processes are killed", || {
        control.calls().contains(&FakeCall::KillTree)
    })
    .await;
    eventually("the views end", || Arc::strong_count(&sink) == 1).await;
    assert!(!rig.manager.has_live_sessions());
    let page = rig
        .manager
        .history(&chat.id, u32::MAX, None)
        .await
        .expect("a new actor answers");
    assert!(page.items.iter().any(|item| matches!(
        item.event,
        AuraEvent::TurnEnded {
            stop_reason: StopReason::Interrupted,
            recovered: true,
            ..
        }
    )));
    let _ = &rig.profile;
}
