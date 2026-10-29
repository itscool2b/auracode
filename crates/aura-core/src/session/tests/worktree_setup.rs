use super::*;
use aura_drivers::driver::LoggedCommand;
use aura_protocol::worktree_setup::WorktreeSetupState;

async fn pending_chat(rig: &Rig) -> String {
    let chat = rig
        .store
        .create_chat(crate::chatstore::NewChat {
            agent_host: Default::default(),
            agent_id: "mock".into(),
            folder: rig.folder.clone(),
            device_id: "device".into(),
            now: now_millis(),
        })
        .await
        .unwrap();
    let id = chat.id.clone();
    let (saved, done) = oneshot::channel();
    rig.store.with_store(move |store| {
        store.conn().execute("INSERT INTO worktree_setup_attempts VALUES (?1,'device','fixture-tree',1,'awaiting',NULL)",[id]).unwrap();
        let _=saved.send(());
    });
    done.await.unwrap();
    chat.id
}

#[tokio::test]
async fn delayed_setup_allows_durable_compose_edit_reorder_and_releases_fifo_once() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("setup-queue"),
        Step::Expect(CommandMatch::Prompt),
        Step::EndTurn {
            stop_reason: StopReason::EndTurn,
            usage: None,
            error: None,
        },
        Step::Expect(CommandMatch::Prompt),
        Step::Hang,
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = pending_chat(&rig).await;
    assert!(rig.manager.start(&chat, false).await.is_err());
    let first = rig.manager.send(&chat, "first draft".into()).await.unwrap();
    rig.manager
        .ask(&chat, |reply| ChatMsg::ReserveSetup {
            id: "setup-reservation".into(),
            reply,
        })
        .await
        .unwrap();
    rig.manager
        .set_setup_attempt(&chat, Some(1), WorktreeSetupState::Running, None)
        .await
        .unwrap()
        .unwrap();
    let second = rig.manager.send(&chat, "second".into()).await.unwrap();
    rig.manager
        .edit_queued(&chat, &first.prompt_id, "first edited".into())
        .await
        .unwrap();
    rig.manager
        .move_queued(&chat, &second.prompt_id, 0)
        .await
        .unwrap();
    let attach = rig
        .manager
        .attach(&chat, Arc::new(Sink::default()))
        .await
        .unwrap();
    assert_eq!(
        attach
            .snapshot
            .queue
            .iter()
            .map(|row| row.prompt_id.as_str())
            .collect::<Vec<_>>(),
        [second.prompt_id.as_str(), first.prompt_id.as_str()]
    );
    assert!(matches!(
        attach.snapshot.session.queue_wait,
        Some(aura_protocol::QueueWait::Setup {
            state: WorktreeSetupState::Running,
            ..
        })
    ));
    assert!(
        handle.commands().is_empty(),
        "no agent commands before setup succeeds"
    );
    assert!(rig.manager.start(&chat, false).await.is_err());
    rig.manager
        .actor(&chat)
        .send(ChatMsg::ReleaseGit {
            id: "setup-reservation".into(),
        })
        .unwrap();
    rig.manager
        .set_setup_attempt(&chat, Some(1), WorktreeSetupState::Succeeded, None)
        .await
        .unwrap()
        .unwrap();
    assert!(
        rig.manager
            .set_setup_attempt(&chat, Some(1), WorktreeSetupState::Succeeded, None)
            .await
            .unwrap()
            .is_none()
    );
    eventually("two prompts after successful setup", || {
        handle
            .commands()
            .iter()
            .filter(|command| matches!(command, LoggedCommand::Prompt { .. }))
            .count()
            == 2
    })
    .await;
    let texts = handle
        .commands()
        .into_iter()
        .filter_map(|command| {
            if let LoggedCommand::Prompt { parts, .. } = command {
                parts.into_iter().find_map(|part| {
                    if let aura_protocol::PromptPart::Text { text } = part {
                        Some(text)
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    assert_eq!(texts, ["second", "first edited"]);
    let saved = rig.store.read_setup_attempt(&chat).await.unwrap().unwrap();
    assert_eq!(saved.state, WorktreeSetupState::Succeeded);
}

#[tokio::test]
async fn failure_holds_messages_and_retry_ignores_old_generation_completion() {
    let (driver, handle) = ScriptedDriver::new(vec![ready_step("setup-retry"), Step::Hang]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = pending_chat(&rig).await;
    rig.manager.send(&chat, "keep this".into()).await.unwrap();
    rig.manager
        .set_setup_attempt(&chat, Some(1), WorktreeSetupState::Running, None)
        .await
        .unwrap()
        .unwrap();
    rig.manager
        .set_setup_attempt(
            &chat,
            Some(1),
            WorktreeSetupState::Failed,
            Some("Setup exited with code 2. Retry setup.".into()),
        )
        .await
        .unwrap()
        .unwrap();
    let failed = rig
        .manager
        .attach(&chat, Arc::new(Sink::default()))
        .await
        .unwrap();
    assert!(failed.snapshot.queue[0].held);
    assert!(matches!(
        failed.snapshot.session.queue_wait,
        Some(aura_protocol::QueueWait::Setup {
            state: WorktreeSetupState::Failed,
            ..
        })
    ));
    let retry = rig
        .manager
        .set_setup_attempt(&chat, None, WorktreeSetupState::Awaiting, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retry.generation, 2);
    assert!(
        rig.manager
            .set_setup_attempt(&chat, Some(1), WorktreeSetupState::Succeeded, None)
            .await
            .unwrap()
            .is_none()
    );
    assert!(rig.manager.start(&chat, false).await.is_err());
    rig.manager
        .set_setup_attempt(&chat, Some(2), WorktreeSetupState::Running, None)
        .await
        .unwrap()
        .unwrap();
    rig.manager
        .set_setup_attempt(&chat, Some(2), WorktreeSetupState::Succeeded, None)
        .await
        .unwrap()
        .unwrap();
    status(&rig, &chat, SessionStatus::Ready).await;
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Prompt { .. })),
        "failed prompts remain held after retry success"
    );
}
