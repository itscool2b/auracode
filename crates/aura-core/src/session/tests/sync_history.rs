use super::*;
use crate::{
    profile::ProfileKind,
    sync::{SyncContext, SyncIdentity},
};
use aura_drivers::driver::LoggedCommand;
use aura_protocol::conversation::ContinuationAction;
use aura_sync::crypto::AccountKey;

struct RecordingFactory {
    inner: Arc<dyn DriverFactory>,
    starts: Arc<Mutex<Vec<Option<String>>>>,
}
struct RecordingDriver {
    inner: Box<dyn AgentDriver>,
    starts: Arc<Mutex<Vec<Option<String>>>>,
}
impl DriverFactory for RecordingFactory {
    fn create(&self, kind: aura_protocol::DriverKind) -> Box<dyn AgentDriver> {
        Box::new(RecordingDriver {
            inner: self.inner.create(kind),
            starts: self.starts.clone(),
        })
    }
}
impl AgentDriver for RecordingDriver {
    fn run(self: Box<Self>, ctx: DriverContext) -> BoxFuture<'static, DriverExit> {
        lock(&self.starts).push(ctx.setup.resume.clone());
        self.inner.run(ctx)
    }
}
fn driver(native: &str) -> (ScriptedDriver, aura_drivers::testing::ScriptHandle) {
    let Step::Emit(DriverEvent::Ready(mut ready)) = ready_step(native) else {
        unreachable!()
    };
    ready.capabilities.resume = true;
    ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        Step::Emit(DriverEvent::Ready(ready)),
    ])
}
async fn rig_account(drivers: Arc<dyn DriverFactory>) -> (Rig, SyncContext) {
    let dir = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let folder = dir.path().join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let context = SyncContext {
        identity: SyncIdentity {
            account: "account".into(),
            device: "account-device".into(),
            key_version: 1,
        },
        key: key.clone(),
    };
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let store = ChatStore::start_account(
        store,
        owner,
        &profile,
        "device".into(),
        Handle::current(),
        Arc::new(key.profile_file_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    store.configure_sync(context.clone()).await.unwrap();
    (
        rig_from_store(
            dir,
            profile,
            folder,
            store,
            drivers,
            Knobs::STANDARD,
            aura_agents::get("mock").unwrap().clone(),
        ),
        context,
    )
}

#[tokio::test]
async fn remote_history_defers_live_sessions_rejoins_views_and_requires_a_visible_fresh_handoff() {
    let (first, old) = driver("saved-local-native");
    let (second, new) = driver("fresh-after-handoff");
    let starts = Arc::new(Mutex::new(Vec::new()));
    let factory = Arc::new(RecordingFactory {
        inner: aura_drivers::testing::ScriptedDriverFactory::new(vec![first, second]),
        starts: starts.clone(),
    });
    let (rig, context) = rig_account(factory).await;
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let id = chat.id.clone();
    let source_context = context.clone();
    rig.store.with_store(move |store| {
        crate::sync::transcript::staged_turn(store.conn(), &source_context, &id, None);
    });
    assert_eq!(rig.manager.reconcile_synced_history().await.unwrap(), 0);
    rig.manager.stop(&chat.id).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let sink = Arc::new(Sink::default());
    let before = rig.manager.attach(&chat.id, sink.clone()).await.unwrap();
    assert_eq!(rig.manager.reconcile_synced_history().await.unwrap(), 1);
    assert!(
        lock(&sink.frames)
            .iter()
            .any(|frame| frame.seq_start > before.next_seq)
    );
    let joined = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .unwrap();
    assert!(joined.history.items.iter().any(
        |item| matches!(&item.event,AuraEvent::MessageDelta{text,..} if text=="remote reply")
    ));
    let turns = rig
        .manager
        .conversation_turns(&chat.id, None)
        .await
        .unwrap();
    assert!(turns.can_continue_here);
    assert_eq!(turns.turns[0].agent_id, "mock");
    assert!(
        rig.manager
            .send(&chat.id, "Unreviewed".into())
            .await
            .unwrap_err()
            .to_string()
            .contains("Continue here")
    );
    assert_eq!(lock(&starts).len(), 1);
    let preview = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::ContinueHere)
        .await
        .unwrap();
    assert!(!preview.resumes_native);
    assert!(!preview.uses_native_fork);
    assert!(preview.handoff.contains("remote reply"));
    let id = chat.id.clone();
    let imported_turn = turns.turns[0].turn_id.clone();
    rig.store.with_store(move |store| {
        crate::sync::transcript::staged_turn(store.conn(), &context, &id, Some(imported_turn));
    });
    assert_eq!(rig.manager.reconcile_synced_history().await.unwrap(), 1);
    assert!(
        rig.manager
            .continuation_apply(&chat.id, &preview.token)
            .await
            .is_err(),
        "a review cannot authorize dispatch after more remote history arrived"
    );
    let preview = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::ContinueHere)
        .await
        .unwrap();
    rig.manager
        .continuation_apply(&chat.id, &preview.token)
        .await
        .unwrap();
    assert_eq!(
        lock(&starts).len(),
        1,
        "review must not send a hidden prompt"
    );
    rig.manager
        .send(&chat.id, "Continue the reviewed work".into())
        .await
        .unwrap();
    let LoggedCommand::Prompt { parts, .. } = new.wait_for(CommandMatch::Prompt).await else {
        panic!("prompt")
    };
    let text = parts
        .iter()
        .filter_map(|part| match part {
            aura_protocol::PromptPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("remote reply") && text.contains("Continue the reviewed work"));
    assert_eq!(*lock(&starts), vec![None, None]);
    assert!(
        !old.commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Prompt { .. }))
    );
    rig.manager.history(&chat.id, u32::MAX, None).await.unwrap();
    rig.store.with_store(move|store|{
        let saved:bool=store.conn().query_row("SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE native_session_id='saved-local-native')",[],|r|r.get(0)).unwrap();assert!(saved);
    });
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
