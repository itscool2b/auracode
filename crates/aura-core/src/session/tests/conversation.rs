use super::*;
use aura_drivers::driver::{LoggedCommand, NativeStartOptions};
use aura_drivers::testing::ScriptHandle;
use aura_protocol::{PromptPart, conversation::ContinuationAction};

fn turn_driver(native: &str, answer: &str) -> (ScriptedDriver, ScriptHandle) {
    let mut ready = ready_step(native);
    if let Step::Emit(DriverEvent::Ready(info)) = &mut ready {
        info.capabilities.resume = true;
        info.capabilities.fork = true;
        info.capabilities.images = true;
    }
    ScriptedDriver::new(vec![
        ready,
        Step::Expect(CommandMatch::Prompt),
        delta(answer),
        Step::EmitInTurn(DriverEvent::Event {
            turn: None,
            event: AuraEvent::MessageCompleted {
                message_id: "m1".into(),
            },
        }),
        Step::EndTurn {
            stop_reason: StopReason::EndTurn,
            usage: None,
            error: None,
        },
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ])
}

async fn stop(rig: &Rig, chat: &str) {
    rig.manager.stop(chat).await.expect("stop");
    eventually("driver retired", || {
        !rig.manager.shared().live.contains(chat)
    })
    .await;
}

async fn turn(rig: &Rig, chat: &str, handle: &ScriptHandle, text: &str) -> String {
    rig.manager.send(chat, text.into()).await.expect("send");
    handle.wait_for(CommandMatch::Prompt).await;
    status(rig, chat, SessionStatus::Ready).await;
    rig.manager
        .conversation_turns(chat, None)
        .await
        .expect("turns")
        .turns[0]
        .turn_id
        .clone()
}

#[tokio::test]
async fn retry_preserves_source_and_exact_visible_handoff_without_recursive_prefixes() {
    let (first, h1) = turn_driver("original-native", "original final answer");
    let (second, h2) = turn_driver("retry-native", "replacement final answer");
    let rig = rig(vec![first, second], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let original = turn(&rig, &chat.id, &h1, "original prompt").await;
    stop(&rig, &chat.id).await;
    let preview = rig
        .manager
        .continuation_preview(
            &chat.id,
            ContinuationAction::Retry {
                turn_id: original.clone(),
            },
        )
        .await
        .expect("preview");
    assert!(!preview.handoff.contains("original final answer"));
    assert_eq!(preview.prompt.as_deref(), Some("original prompt"));
    assert!(h2.commands().is_empty(), "preview sends no model prompt");
    let result = rig
        .manager
        .continuation_apply(&chat.id, &preview.token)
        .await
        .expect("apply");
    assert!(result.prompt.is_some());
    let command = h2.wait_for(CommandMatch::Prompt).await;
    let LoggedCommand::Prompt { parts, .. } = command else {
        panic!("prompt");
    };
    assert!(matches!(&parts[0],PromptPart::Text { text } if text.starts_with(&preview.handoff)));
    assert_eq!(
        parts[1],
        PromptPart::Text {
            text: "original prompt".into()
        }
    );
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let turns = rig
        .manager
        .conversation_turns(&chat.id, None)
        .await
        .expect("turns");
    assert_eq!(turns.turns.len(), 2);
    assert_eq!(turns.turns[1].turn_id, original);
    let editable = rig
        .manager
        .conversation_editable(&chat.id, &turns.turns[0].turn_id)
        .await
        .expect("editable");
    assert_eq!(editable.text, "original prompt");
    assert!(!editable.has_context);
    assert!(
        rig.manager
            .continuation_apply(&chat.id, &preview.token)
            .await
            .is_err(),
        "one-use token"
    );
}

#[tokio::test]
async fn changed_preview_and_live_session_cannot_change_conversation() {
    let (first, h1) = turn_driver("original-native", "answer");
    let rig = rig(vec![first], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let original = turn(&rig, &chat.id, &h1, "original prompt").await;
    let live = rig
        .manager
        .continuation_preview(
            &chat.id,
            ContinuationAction::Fork {
                turn_id: original.clone(),
            },
        )
        .await
        .expect("preview");
    assert!(
        rig.manager
            .continuation_apply(&chat.id, &live.token)
            .await
            .expect_err("live refused")
            .to_string()
            .contains("Stop")
    );
    stop(&rig, &chat.id).await;
    let stale = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::Fork { turn_id: original })
        .await
        .expect("preview");
    rig.manager
        .chat_rename(&chat.id, "changed after preview")
        .await
        .expect("rename");
    assert!(
        rig.manager
            .continuation_apply(&chat.id, &stale.token)
            .await
            .expect_err("stale refused")
            .to_string()
            .contains("changed after")
    );
    assert_eq!(rig.manager.chats().await.expect("chats").len(), 1);
}

type Starts = Arc<Mutex<Vec<(String, Option<String>, NativeStartOptions)>>>;
struct RecordingFactory {
    inner: Arc<dyn DriverFactory>,
    starts: Starts,
}
struct RecordingDriver {
    inner: Box<dyn AgentDriver>,
    starts: Starts,
}
impl DriverFactory for RecordingFactory {
    fn create(&self, kind: aura_protocol::DriverKind) -> Box<dyn AgentDriver> {
        Box::new(RecordingDriver {
            inner: self.inner.create(kind),
            starts: Arc::clone(&self.starts),
        })
    }
}
impl AgentDriver for RecordingDriver {
    fn run(self: Box<Self>, ctx: DriverContext) -> BoxFuture<'static, DriverExit> {
        lock(&self.starts).push((
            ctx.setup.agent_id.clone(),
            ctx.setup.resume.clone(),
            ctx.setup.native_start.clone(),
        ));
        self.inner.run(ctx)
    }
}

#[tokio::test]
async fn switching_back_resumes_that_agents_session_and_only_hands_off_the_delta() {
    let (first, h1) = turn_driver("native-a", "answer A");
    let (second, h2) = turn_driver("native-b", "answer B");
    let (third, h3) = turn_driver("native-a", "answer A again");
    let starts = Arc::new(Mutex::new(Vec::new()));
    let factory = Arc::new(RecordingFactory {
        inner: aura_drivers::testing::ScriptedDriverFactory::new(vec![first, second, third]),
        starts: Arc::clone(&starts),
    });
    let mut rig = rig_with(factory, WriterConfig::STANDARD, Knobs::STANDARD);
    let mut other = aura_agents::get("mock").expect("mock").clone();
    other.id = "mock-other";
    let fixed = |spec| {
        FixedAgent::new(
            spec,
            aura_protocol::session::Availability::Ready {
                version: None,
                path: "fixture".into(),
            },
            Some(launch()),
        )
    };
    let shared = &mut Arc::get_mut(&mut rig.manager.inner)
        .expect("only owner")
        .shared;
    Arc::get_mut(shared).expect("no actors").deps.detector = Detector::fixed(vec![
        fixed(aura_agents::get("mock").unwrap().clone()),
        fixed(other),
    ]);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    turn(&rig, &chat.id, &h1, "prompt A").await;
    stop(&rig, &chat.id).await;
    let switch = rig
        .manager
        .continuation_preview(
            &chat.id,
            ContinuationAction::SwitchAgent {
                agent_id: "mock-other".into(),
            },
        )
        .await
        .expect("preview B");
    rig.manager
        .continuation_apply(&chat.id, &switch.token)
        .await
        .expect("switch B");
    turn(&rig, &chat.id, &h2, "prompt B").await;
    stop(&rig, &chat.id).await;
    let back = rig
        .manager
        .continuation_preview(
            &chat.id,
            ContinuationAction::SwitchAgent {
                agent_id: "mock".into(),
            },
        )
        .await
        .expect("preview A");
    assert!(back.resumes_native);
    assert!(back.handoff.contains("prompt B") && back.handoff.contains("answer B"));
    assert!(!back.handoff.contains("answer A\n"));
    rig.manager
        .continuation_apply(&chat.id, &back.token)
        .await
        .expect("switch A");
    turn(&rig, &chat.id, &h3, "new A prompt").await;
    assert_eq!(lock(&starts)[2].1.as_deref(), Some("native-a"));
}

#[tokio::test]
async fn fork_copies_only_selected_image_metadata_and_missing_metadata_rolls_back() {
    let (first, h1) = turn_driver("image-source", "answer");
    let rig = rig(vec![first], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .expect("fixture PNG");
    let attachment = rig
        .manager
        .composer_paste(&chat.id, png.into_inner())
        .await
        .expect("import");
    rig.manager
        .composer_send(
            &chat.id,
            aura_protocol::composer::ComposerInput {
                text: "look at this image".into(),
                attachments: vec![attachment.id],
                mentions: vec![],
            },
        )
        .await
        .expect("send");
    h1.wait_for(CommandMatch::Prompt).await;
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let original = rig
        .manager
        .conversation_turns(&chat.id, None)
        .await
        .expect("turns")
        .turns[0]
        .turn_id
        .clone();
    stop(&rig, &chat.id).await;
    let fork = rig
        .manager
        .continuation_preview(
            &chat.id,
            ContinuationAction::Fork {
                turn_id: original.clone(),
            },
        )
        .await
        .expect("preview");
    let result = rig
        .manager
        .continuation_apply(&chat.id, &fork.token)
        .await
        .expect("fork");
    assert!(result.prompt.is_none());
    let load = rig
        .store
        .load_chat(&result.chat_id)
        .await
        .expect("saved fork");
    assert_eq!(
        load.continuation.as_ref().expect("durable handoff").handoff,
        fork.handoff
    );
    assert!(
        load.agent_session.is_none(),
        "fork has a distinct future native session"
    );
    let source = chat.id.clone();
    let destination = result.chat_id.clone();
    rig.store.with_store(move |store| {
        let count: u32 = store.conn().query_row("SELECT COUNT(*) FROM composer_attachments a JOIN composer_attachments b ON a.sha256=b.sha256 AND a.id<>b.id WHERE a.chat_id=?1 AND b.chat_id=?2",rusqlite::params![source,destination],|row| row.get(0)).expect("metadata copied");
        assert_eq!(count,1);
    });
    let stale = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::Fork { turn_id: original })
        .await
        .expect("preview");
    let source = chat.id.clone();
    rig.store.with_store(move |store| {
        store
            .conn()
            .execute(
                "DELETE FROM composer_attachments WHERE chat_id=?1",
                [source],
            )
            .expect("remove fixture metadata");
    });
    assert!(
        rig.manager
            .continuation_apply(&chat.id, &stale.token)
            .await
            .expect_err("missing metadata")
            .to_string()
            .contains("image is unavailable")
    );
    assert_eq!(
        rig.manager.chats().await.expect("chats").len(),
        2,
        "failed fork rolled back"
    );
}

#[tokio::test]
async fn latest_qualified_native_fork_uses_a_distinct_native_id() {
    let (first, h1) = turn_driver("source-native", "source answer");
    let (second, h2) = turn_driver("fork-native", "fork answer");
    let starts = Arc::new(Mutex::new(Vec::new()));
    let factory = Arc::new(RecordingFactory {
        inner: aura_drivers::testing::ScriptedDriverFactory::new(vec![first, second]),
        starts: Arc::clone(&starts),
    });
    let mut rig = rig_with(factory, WriterConfig::STANDARD, Knobs::STANDARD);
    let shared = &mut Arc::get_mut(&mut rig.manager.inner)
        .expect("only owner")
        .shared;
    Arc::get_mut(shared).expect("no actors").deps.detector =
        Detector::fixed(vec![FixedAgent::new(
            aura_agents::get("claude").expect("catalog").clone(),
            aura_protocol::session::Availability::Ready {
                version: None,
                path: "fixture".into(),
            },
            Some(launch()),
        )]);
    let chat = rig
        .manager
        .create_chat("claude", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let selected = turn(&rig, &chat.id, &h1, "source prompt").await;
    stop(&rig, &chat.id).await;
    let preview = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::Fork { turn_id: selected })
        .await
        .expect("preview");
    assert!(preview.uses_native_fork && preview.handoff.is_empty());
    let fork = rig
        .manager
        .continuation_apply(&chat.id, &preview.token)
        .await
        .expect("fork");
    turn(&rig, &fork.chat_id, &h2, "new fork prompt").await;
    let starts = lock(&starts);
    let (_, source, options) = &starts[1];
    assert_eq!(source.as_deref(), Some("source-native"));
    assert!(options.fork);
    assert!(
        options.new_session_id.is_some() && options.new_session_id.as_deref() != source.as_deref()
    );
}

async fn reopen_manager(rig: &mut Rig) {
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
    let deps = rig.manager.deps();
    let manager = SessionManager::new(ManagerDeps {
        worktrees: deps.worktrees.clone(),
        store: Arc::clone(&deps.store),
        checkpoints: deps.checkpoints.clone(),
        env: Arc::clone(&deps.env),
        spawner: Arc::clone(&deps.spawner),
        detector: Arc::clone(&deps.detector),
        drivers: Arc::clone(&deps.drivers),
        logs: deps.logs.clone(),
        redactor: Arc::clone(&deps.redactor),
        device_id: deps.device_id.clone(),
        app_version: deps.app_version.clone(),
        limits: deps.limits,
        timings: deps.timings,
        rt: deps.rt.clone(),
    });
    manager.status_subscribe(rig.statuses.clone());
    rig.manager = manager;
}

#[tokio::test]
async fn saved_handoff_survives_actor_reconstruction_and_is_consumed_once() {
    let (source, h1) = turn_driver("source", "saved answer");
    let (forked, h2) = turn_driver("fork", "first answer");
    let (later, h3) = turn_driver("fork", "later answer");
    let mut rig = rig(
        vec![source, forked, later],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let source = turn(&rig, &chat.id, &h1, "saved prompt").await;
    stop(&rig, &chat.id).await;
    let preview = rig
        .manager
        .continuation_preview(&chat.id, ContinuationAction::Fork { turn_id: source })
        .await
        .expect("preview");
    let fork = rig
        .manager
        .continuation_apply(&chat.id, &preview.token)
        .await
        .expect("fork");
    reopen_manager(&mut rig).await;
    turn(&rig, &fork.chat_id, &h2, "first prompt").await;
    let LoggedCommand::Prompt { parts, .. } = h2
        .commands()
        .into_iter()
        .find(|command| matches!(command, LoggedCommand::Prompt { .. }))
        .expect("prompt")
    else {
        panic!("prompt")
    };
    assert!(matches!(&parts[0],PromptPart::Text {text} if text.starts_with(&preview.handoff)));
    stop(&rig, &fork.chat_id).await;
    let load = rig.store.load_chat(&fork.chat_id).await.expect("saved");
    assert!(load.continuation.expect("continuation").handoff.is_empty());
    reopen_manager(&mut rig).await;
    turn(&rig, &fork.chat_id, &h3, "later prompt").await;
    let LoggedCommand::Prompt { parts, .. } = h3
        .commands()
        .into_iter()
        .find(|command| matches!(command, LoggedCommand::Prompt { .. }))
        .expect("prompt")
    else {
        panic!("prompt")
    };
    assert_eq!(
        parts,
        vec![PromptPart::Text {
            text: "later prompt".into()
        }]
    );
}
