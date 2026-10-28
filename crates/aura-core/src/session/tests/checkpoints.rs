use super::*;
use aura_drivers::driver::LoggedCommand;
use aura_protocol::NoticeLevel;

fn enable(rig: &mut Rig, git_available: bool) -> Arc<crate::checkpoints::Checkpoints> {
    let vars = if git_available {
        aura_process::process_env()
    } else {
        EnvMap::new()
    };
    let env = EnvResolver::fixed(ResolvedEnv {
        vars,
        source: EnvSource::Fallback {
            reason: "checkpoint test".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let service = crate::checkpoints::Checkpoints::new(
        &rig.profile,
        env,
        aura_process::LeftoverRegistry::disabled(),
    );
    let inner = Arc::get_mut(&mut rig.manager.inner).expect("only test owner");
    Arc::get_mut(&mut inner.shared)
        .expect("no actors yet")
        .deps
        .checkpoints = Some(Arc::clone(&service));
    service
}

fn script() -> (ScriptedDriver, aura_drivers::testing::ScriptHandle) {
    ScriptedDriver::new(vec![
        ready_step("checkpoint-native"),
        Step::Expect(CommandMatch::Prompt),
        Step::EndTurn {
            stop_reason: StopReason::EndTurn,
            usage: None,
            error: None,
        },
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ])
}

#[tokio::test]
async fn capture_precedes_prompt_and_revert_requires_all_folder_agents_stopped() {
    let (driver, handle) = script();
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    enable(&mut rig, true);
    std::fs::write(rig.folder.join("work.txt"), b"original\r\n").expect("fixture");
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let ack = rig
        .manager
        .send(&chat.id, "visible prompt".into())
        .await
        .expect("send");
    assert!(ack.queued);
    handle.wait_for(CommandMatch::Prompt).await;
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let changes = rig
        .manager
        .chat_changes(&chat.id, None)
        .await
        .expect("changes");
    let checkpoint = changes.checkpoint.expect("capture persisted with turn");
    assert_eq!(checkpoint.file_count, 1);
    assert!(changes.files.is_empty());
    std::fs::write(rig.folder.join("work.txt"), "agent edit").expect("edit");
    let preview = rig
        .manager
        .checkpoint_revert_preview(&chat.id, &checkpoint.id, vec!["work.txt".into()])
        .await
        .expect("preview");
    assert!(
        rig.manager
            .checkpoint_revert(&chat.id, &preview.token)
            .await
            .expect_err("live agent refused")
            .to_string()
            .contains("Stop chats")
    );
    rig.manager.stop(&chat.id).await.expect("stop");
    eventually("live ownership released", || {
        !rig.manager.shared().live.contains(&chat.id)
    })
    .await;
    let result = rig
        .manager
        .checkpoint_revert(&chat.id, &preview.token)
        .await
        .expect("revert");
    assert!(result.error.is_none());
    assert_eq!(
        std::fs::read(rig.folder.join("work.txt")).expect("restored"),
        b"original\r\n"
    );
}

#[tokio::test]
async fn checkpoint_failure_holds_the_prompt_without_sending_it_to_an_agent() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("missing-git"),
        Step::Expect(CommandMatch::Shutdown),
    ]);
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    enable(&mut rig, false);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let sink = Arc::new(Sink::default());
    rig.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    rig.manager
        .send(&chat.id, "must not reach agent".into())
        .await
        .expect("enqueue");
    eventually("checkpoint failure shown", || lock(&sink.frames).iter().flat_map(|frame| &frame.events).any(|item| matches!(item, AuraEvent::Notice { message, .. } if message.contains("prompt was held")))).await;
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Prompt { .. }))
    );
    let attached = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("state");
    assert_eq!(attached.snapshot.queue.len(), 1);
    assert!(attached.snapshot.queue[0].held);
}

#[tokio::test]
async fn interrupt_cancels_checkpoint_wait_and_holds_the_unsent_prompt() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("cancel-checkpoint"),
        Step::Expect(CommandMatch::Shutdown),
    ]);
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let service = enable(&mut rig, true);
    let gate = service.hold_for_test().await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager
        .send(&chat.id, "cancel before capture".into())
        .await
        .expect("send");
    status(&rig, &chat.id, SessionStatus::Running).await;
    rig.manager.interrupt(&chat.id).await.expect("interrupt");
    drop(gate);
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let attached = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("state");
    assert!(attached.snapshot.queue[0].held);
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Prompt { .. }))
    );
}

/// Every prompt waits for its checkpoint; meanwhile the queue says so, then the prompt goes.
#[tokio::test]
async fn a_saving_checkpoint_says_why_the_prompt_waits() {
    let (driver, handle) = script();
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let service = enable(&mut rig, true);
    let gate = service.hold_for_test().await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager
        .send(&chat.id, "after the checkpoint".into())
        .await
        .expect("send");
    status(&rig, &chat.id, SessionStatus::Running).await;
    let attached = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("state");
    assert_eq!(attached.snapshot.queue.len(), 1);
    assert_eq!(
        attached.snapshot.session.queue_wait,
        Some(aura_protocol::QueueWait::SavingCheckpoint)
    );
    drop(gate);
    handle.wait_for(CommandMatch::Prompt).await;
    let attached = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("state");
    assert!(attached.snapshot.queue.is_empty());
    assert_eq!(attached.snapshot.session.queue_wait, None);
}

#[tokio::test]
async fn background_work_started_during_capture_keeps_prompt_queued_until_idle() {
    let (driver, handle) = script();
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let service = enable(&mut rig, true);
    let gate = service.hold_for_test().await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager
        .send(&chat.id, "wait for background work".into())
        .await
        .expect("send");
    status(&rig, &chat.id, SessionStatus::Running).await;
    let sink = Arc::new(Sink::default());
    rig.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    handle.emit(DriverEvent::RunState { idle: false });
    handle.emit(DriverEvent::Event {
        turn: None,
        event: AuraEvent::Notice {
            level: NoticeLevel::Info,
            message: "background marker".into(),
        },
    });
    eventually("background state observed", || lock(&sink.frames).iter().flat_map(|frame| &frame.events).any(|event| matches!(event, AuraEvent::Notice { message, .. } if message == "background marker"))).await;
    drop(gate);
    // Acquiring the service gate after capture ensures the Git operation has ended.
    let captured = service.hold_for_test().await;
    drop(captured);
    tokio::task::yield_now().await;
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Prompt { .. }))
    );
    handle.emit(DriverEvent::RunState { idle: true });
    handle.wait_for(CommandMatch::Prompt).await;
}

#[tokio::test]
async fn a_legacy_background_permission_during_capture_does_not_block_the_next_turn() {
    use aura_protocol::{PermissionOption, PermissionOptionKind, PermissionRequest};
    let (driver, handle) = script();
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let service = enable(&mut rig, true);
    let gate = service.hold_for_test().await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let sink = Arc::new(Sink::default());
    rig.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    rig.manager
        .send(&chat.id, "next legacy turn".into())
        .await
        .expect("send");
    status(&rig, &chat.id, SessionStatus::Running).await;
    handle.emit(DriverEvent::Permission {
        turn: None,
        request: PermissionRequest {
            request_id: "background-during-capture".into(),
            tool_call_id: None,
            title: "Background action".into(),
            kind: None,
            raw_input: None,
            content: vec![],
            locations: vec![],
            options: vec![PermissionOption {
                option_id: "allow".into(),
                kind: PermissionOptionKind::AllowOnce,
                label: "Allow once".into(),
            }],
            truncated: None,
        },
    });
    eventually("legacy background request observed", || {
        lock(&sink.frames)
            .iter()
            .flat_map(|frame| &frame.events)
            .any(|event| matches!(event, AuraEvent::PermissionRequested(_)))
    })
    .await;
    drop(gate);
    handle.wait_for(CommandMatch::Prompt).await;
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::RespondPermission { .. }))
    );
}
