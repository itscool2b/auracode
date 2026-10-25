//! The demo agent end to end through the desktop's own startup (spec 7.2): `boot` on a fresh data
//! folder, then `start_chats` with the real chat store, leftover registry, sweep, shared redactor,
//! protocol logs and session manager, over [`Outside::over_env`], which builds the real detector,
//! process spawner and `StandardDriverFactory`. Only the env is fixed: its `PATH` is an empty
//! folder, so detection finds no agent binary, and nothing here runs a real agent or a login shell.
//!
//! A chat is created with the demo agent, prompts run to the end of their turns, and the stored
//! turns are read back through the history API: the same transcript the live frames showed, and
//! again after a restart on the same data folder, from the database alone.

// Helpers in an integration test count as test code only inside a `#[cfg(test)]` item (clippy.toml).
#[cfg(test)]
mod end_to_end {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, PoisonError};
    use std::time::{Duration, Instant};

    use aura_core::paths::DataRoot;
    use aura_core::session::{FrameSink, SessionManager, SinkGone};
    use aura_process::{EnvKey, EnvMap, EnvResolver, EnvSource, ResolvedEnv};
    use aura_protocol::session::{Availability, HistoryItem, HistoryPage};
    use aura_protocol::{AuraEvent, EventBatch, SessionStatus, StopReason, ToolKind};
    use auracode_desktop::boot::{Booted, boot};
    use auracode_desktop::sessions::{
        ChatRuntime, Outside, QUIT_SESSIONS_DEADLINE, QUIT_STORE_DEADLINE, RUN_DIR, start_chats,
    };
    use tokio::runtime::Handle;

    /// How long one step may take before the test fails.
    const STEP: Duration = Duration::from_secs(30);

    /// The webview the chat view belongs to.
    const OWNER: &str = "main";

    /// What the first prompt asks the demo agent to echo.
    const ECHOED: &str = "Hello from the merged workspace";

    /// An env that finds no agent: `PATH` is an empty folder, `HOME` one of the test's own.
    fn no_agents_env(dir: &Path) -> Arc<EnvResolver> {
        let bin = dir.join("empty-bin");
        let home = dir.join("home");
        std::fs::create_dir_all(&bin).expect("bin folder");
        std::fs::create_dir_all(&home).expect("home folder");
        let mut vars = EnvMap::new();
        vars.insert(EnvKey::from("PATH"), bin.into_os_string());
        vars.insert(EnvKey::from("HOME"), home.clone().into_os_string());
        vars.insert(EnvKey::from("USERPROFILE"), home.into_os_string());
        EnvResolver::fixed(ResolvedEnv {
            vars,
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        })
    }

    /// Boots `root` as a launch does, waiting out an owner lock the last run is still releasing.
    async fn boot_free(root: &DataRoot) -> Booted {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let booted = boot(Ok(root.clone()));
            let in_use = booted
                .fatal
                .as_deref()
                .is_some_and(|fatal| fatal.starts_with("auracode is already running"));
            if !in_use || Instant::now() >= deadline {
                return booted;
            }
            drop(booted);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// The desktop's startup on `root`, with the real outside parts over `env`.
    async fn start(root: &DataRoot, env: &Arc<EnvResolver>) -> ChatRuntime {
        let mut booted = boot_free(root).await;
        assert_eq!(booted.fatal, None, "startup failed");
        let env = Arc::clone(env);
        let chats = start_chats(
            &mut booted,
            "0.1.0",
            &Handle::current(),
            move |registry, _redactor, data_dir, rt| Outside::over_env(env, registry, data_dir, rt),
        )
        .expect("the chats start");
        assert!(
            booted.store.is_none() && booted.owner.is_none(),
            "the store and the owner lock moved into the chat store"
        );
        chats
    }

    /// Quits the way the app's quit flow does: sessions, then the store, then the registry file.
    async fn quit(chats: ChatRuntime) {
        let summary = chats.manager.shutdown_all(QUIT_SESSIONS_DEADLINE).await;
        assert_eq!(summary.forced, 0, "every session stopped on its own");
        assert!(
            chats.store.shutdown(QUIT_STORE_DEADLINE).await,
            "the store saved everything"
        );
        chats.registry.close().expect("the registry file goes");
    }

    /// This process's leftover registry files under `run`.
    fn own_registry_files(run: &Path) -> Vec<PathBuf> {
        let prefix = format!("{}-", std::process::id());
        std::fs::read_dir(run)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
                    .map(|entry| entry.path())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// One chat view's frames, as its channel receives them: every event with its seq.
    #[derive(Default)]
    struct View {
        events: Mutex<Vec<HistoryItem>>,
    }

    impl View {
        fn items(&self) -> Vec<HistoryItem> {
            self.events
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone()
        }
    }

    struct ViewSink(Arc<View>);

    impl FrameSink for ViewSink {
        fn send(&self, frame: &EventBatch) -> Result<(), SinkGone> {
            let mut events = self.0.events.lock().unwrap_or_else(PoisonError::into_inner);
            for (seq, event) in (frame.seq_start..).zip(&frame.events) {
                events.push(HistoryItem {
                    seq,
                    turn_id: None,
                    at: 0,
                    event: event.clone(),
                });
            }
            Ok(())
        }

        fn owner(&self) -> &str {
            OWNER
        }
    }

    /// A turn reduced to what it says: the prompt, the reply, the tools it ran, how it ended.
    #[derive(Debug, Clone, PartialEq)]
    struct Turn {
        turn_id: String,
        prompt_id: Option<String>,
        user: String,
        reply: String,
        tools: Vec<ToolKind>,
        stop: Option<StopReason>,
    }

    /// The turns of seq-ordered events (history items or live frames): deltas joined in order, so a
    /// compacted turn and its live stream reduce to the same thing.
    fn turns(items: &[HistoryItem]) -> Vec<Turn> {
        let mut turns: Vec<Turn> = Vec::new();
        for item in items {
            match &item.event {
                AuraEvent::TurnStarted { turn_id, prompt_id } => turns.push(Turn {
                    turn_id: turn_id.clone(),
                    prompt_id: prompt_id.clone(),
                    user: String::new(),
                    reply: String::new(),
                    tools: Vec::new(),
                    stop: None,
                }),
                AuraEvent::UserMessageDelta { text, .. } => {
                    turns.last_mut().expect("a turn").user.push_str(text);
                }
                AuraEvent::MessageDelta { text, .. } => {
                    turns.last_mut().expect("a turn").reply.push_str(text);
                }
                AuraEvent::ToolCall(call) => {
                    turns.last_mut().expect("a turn").tools.push(call.kind)
                }
                AuraEvent::TurnEnded {
                    turn_id,
                    stop_reason,
                    ..
                } => {
                    let turn = turns.last_mut().expect("a turn");
                    assert_eq!(&turn.turn_id, turn_id, "a turn ends as it started");
                    turn.stop = Some(*stop_reason);
                }
                _ => {}
            }
        }
        turns
    }

    /// The chat's status in the chat list.
    async fn status(manager: &SessionManager, chat_id: &str) -> SessionStatus {
        manager
            .chats()
            .await
            .expect("the chat list")
            .into_iter()
            .find(|chat| chat.id == chat_id)
            .expect("the chat is listed")
            .status
    }

    async fn wait_for_status(manager: &SessionManager, chat_id: &str, want: SessionStatus) {
        let deadline = Instant::now() + STEP;
        loop {
            let now = status(manager, chat_id).await;
            if now == want {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "the chat never reached {want:?}; it is {now:?}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Waits until the live frames hold `count` ended turns.
    async fn wait_for_ended_turns(view: &View, count: usize) {
        let deadline = Instant::now() + STEP;
        loop {
            let ended = turns(&view.items())
                .iter()
                .filter(|turn| turn.stop.is_some())
                .count();
            if ended >= count {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "the live frames hold {ended} ended turns, not {count}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Every stored row of a turn carries its turn's id, and the page is whole and saved.
    fn assert_whole_and_tagged(page: &HistoryPage) {
        assert!(!page.has_more, "one page holds the chat");
        assert_eq!(page.skipped, 0, "every row parses");
        assert_eq!(page.unsaved_from, None, "everything is saved");
        let mut current: Option<String> = None;
        for item in &page.items {
            if let AuraEvent::TurnStarted { turn_id, .. } = &item.event {
                current = Some(turn_id.clone());
            }
            if current.is_some() {
                assert_eq!(item.turn_id, current, "row {} is tagged", item.seq);
            }
            if matches!(item.event, AuraEvent::TurnEnded { .. }) {
                current = None;
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_demo_agent_runs_end_to_end_through_the_real_startup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let folder = dir.path().join("work");
        std::fs::create_dir_all(&folder).expect("chat folder");
        let env = no_agents_env(dir.path());
        let run = dir.path().join("data").join(RUN_DIR);

        let chats = start(&root, &env).await;
        if cfg!(unix) {
            assert_eq!(
                own_registry_files(&run).len(),
                1,
                "the real leftover registry has this instance's file"
            );
        }

        // The real detector: the demo agent is built in, and with nothing on PATH every other agent is
        // missing, so no probe ran anything.
        let agents = chats.manager.agents(true).await;
        let ids: Vec<&str> = agents.iter().map(|agent| agent.id.as_str()).collect();
        assert_eq!(
            ids,
            ["hermes", "claude-acp", "codex-acp", "mock"],
            "the catalog"
        );
        for agent in &agents {
            match (agent.id.as_str(), &agent.availability) {
                ("mock", Availability::Ready { .. }) => {}
                (id, Availability::Missing { .. }) if id != "mock" => {}
                (id, availability) => panic!("{id} reads {availability:?}"),
            }
        }

        // Create the chat with the demo agent and watch it as a chat view does.
        let summary = chats
            .manager
            .create_chat("mock", &folder)
            .await
            .expect("the chat is created");
        let chat_id = summary.id.clone();
        let view = Arc::new(View::default());
        let attach = chats
            .manager
            .attach(&chat_id, Arc::new(ViewSink(Arc::clone(&view))))
            .await
            .expect("the view attaches");
        assert!(
            turns(&attach.history.items).is_empty(),
            "a new chat has no turns"
        );
        wait_for_status(&chats.manager, &chat_id, SessionStatus::Ready).await;

        // A prompt with a known answer, then the demo agent's full turn: thinking, tools, plan, usage.
        let echo = format!("/echo {ECHOED}");
        let first = chats
            .manager
            .send(&chat_id, echo.clone())
            .await
            .expect("the first prompt is taken");
        assert!(!first.queued, "a ready agent takes the prompt at once");
        wait_for_ended_turns(&view, 1).await;
        wait_for_status(&chats.manager, &chat_id, SessionStatus::Ready).await;
        let demo = "Tidy up src/main.rs".to_owned();
        let second = chats
            .manager
            .send(&chat_id, demo.clone())
            .await
            .expect("the second prompt is taken");
        wait_for_ended_turns(&view, 2).await;

        // The stored turns, read back through the history API, say what the live frames said.
        let page = chats
            .manager
            .history(&chat_id, u32::MAX, None)
            .await
            .expect("the history");
        assert_whole_and_tagged(&page);
        let stored = turns(&page.items);
        assert_eq!(stored.len(), 2, "{stored:#?}");
        assert_eq!(
            stored[0].prompt_id.as_deref(),
            Some(first.prompt_id.as_str())
        );
        assert_eq!(stored[0].user, echo);
        assert_eq!(stored[0].reply, ECHOED);
        assert_eq!(stored[0].stop, Some(StopReason::EndTurn));
        assert_eq!(
            stored[1].prompt_id.as_deref(),
            Some(second.prompt_id.as_str())
        );
        assert_eq!(stored[1].user, demo);
        assert!(!stored[1].reply.is_empty(), "the demo turn answers");
        assert_eq!(stored[1].tools, [ToolKind::Read, ToolKind::Edit]);
        assert_eq!(stored[1].stop, Some(StopReason::EndTurn));
        assert_eq!(stored, turns(&view.items()), "stored and live agree");

        // Quit, then start again on the same data folder: the turns come back from the database alone,
        // and reading them starts no agent.
        chats.manager.detach(&attach.subscription_id);
        quit(chats).await;
        assert!(
            own_registry_files(&run).is_empty(),
            "the registry file went at quit"
        );

        let chats = start(&root, &env).await;
        assert_eq!(
            status(&chats.manager, &chat_id).await,
            SessionStatus::Stopped
        );
        let page = chats
            .manager
            .history(&chat_id, u32::MAX, None)
            .await
            .expect("the history after a restart");
        assert_whole_and_tagged(&page);
        assert_eq!(turns(&page.items), stored, "the same turns after a restart");
        assert_eq!(
            status(&chats.manager, &chat_id).await,
            SessionStatus::Stopped,
            "reading history starts no agent"
        );
        quit(chats).await;
        assert!(own_registry_files(&run).is_empty());
    }
}
