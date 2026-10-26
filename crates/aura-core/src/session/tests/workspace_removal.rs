use super::*;
use aura_protocol::workspace_removal::{
    WorkspaceRemovalAction as Action, WorkspaceRemovalTarget as Target,
};

async fn saved(rig: &Rig) -> String {
    rig.store
        .create_chat(NewChat {
            agent_host: Default::default(),
            agent_id: "mock".into(),
            folder: rig.folder.clone(),
            device_id: "device".into(),
            now: now_millis(),
        })
        .await
        .unwrap()
        .id
}
async fn target(rig: &Rig, chat: &str) -> Target {
    let view = rig
        .manager
        .workspace_snapshot(aura_protocol::workspace::WorkspaceFilter {
            include_archived: true,
            project_id: None,
        })
        .await
        .unwrap();
    Target::Project {
        id: view
            .chats
            .iter()
            .find(|entry| entry.chat.id == chat)
            .unwrap()
            .project_id
            .clone(),
    }
}
#[tokio::test]
async fn removal_is_one_use_preserves_disk_and_blocks_cached_actor_until_restore() {
    let rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = saved(&rig).await;
    let target = target(&rig, &chat).await;
    let file = rig.folder.join("retained.txt");
    std::fs::write(&file, "unchanged").unwrap();
    let review = rig
        .manager
        .workspace_removal_preview(target.clone(), Action::Remove)
        .await
        .unwrap();
    rig.manager
        .workspace_removal_apply(&review.token, Box::new(()))
        .await
        .unwrap();
    assert!(
        rig.manager
            .workspace_removal_apply(&review.token, Box::new(()))
            .await
            .is_err()
    );
    assert!(rig.manager.chats().await.unwrap().is_empty());
    assert!(matches!(
        rig.manager.send(&chat, "do not send".into()).await,
        Err(SessionError::Organization(_))
    ));
    assert!(rig.manager.start(&chat, false).await.is_err());
    assert_eq!(std::fs::read_to_string(file).unwrap(), "unchanged");
    assert_eq!(
        rig.manager.workspace_removed().await.unwrap()[0].chat_count,
        1
    );
    let review = rig
        .manager
        .workspace_removal_preview(target, Action::Restore)
        .await
        .unwrap();
    rig.manager
        .workspace_removal_apply(&review.token, Box::new(()))
        .await
        .unwrap();
    assert_eq!(rig.manager.chats().await.unwrap()[0].id, chat);
    assert!(rig.store.workspace_available(&chat));
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
#[tokio::test]
async fn project_terminal_and_stale_membership_refuse_removal() {
    let rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = saved(&rig).await;
    let target = target(&rig, &chat).await;
    let review = rig
        .manager
        .workspace_removal_preview(target.clone(), Action::Remove)
        .await
        .unwrap();
    let key = super::super::live::normalize_path(rig.folder.clone());
    assert!(rig.manager.shared().live.begin_folder_use(key.clone()));
    assert!(
        rig.manager
            .workspace_removal_apply(&review.token, Box::new(()))
            .await
            .is_err()
    );
    rig.manager.shared().live.end_folder_use(&key);
    let review = rig
        .manager
        .workspace_removal_preview(target, Action::Remove)
        .await
        .unwrap();
    saved(&rig).await;
    assert!(
        rig.manager
            .workspace_removal_apply(&review.token, Box::new(()))
            .await
            .is_err()
    );
    assert_eq!(rig.manager.chats().await.unwrap().len(), 2);
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
#[tokio::test]
async fn removal_winning_dispatch_admission_returns_a_held_queue_ack_and_lifecycle() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("admission-race"),
        Step::Expect(CommandMatch::Shutdown),
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let sink = Arc::new(Sink::default());
    rig.manager.attach(&chat.id, sink.clone()).await.unwrap();
    // Inject the writer winning exactly between send's visibility check and dispatch admission.
    rig.store.remove_workspace_before_begin(&chat.id);
    let ack = rig
        .manager
        .send(&chat.id, "retain this prompt".into())
        .await
        .unwrap();
    assert!(ack.queued);
    eventually("queued lifecycle", || lock(&sink.frames).iter().flat_map(|frame| &frame.events).any(|event| matches!(event,
        AuraEvent::PromptLifecycle { prompt_id, state: aura_protocol::PromptState::Queued, .. } if prompt_id == &ack.prompt_id
    ))).await;
    let attached = rig
        .manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .unwrap();
    assert_eq!(attached.snapshot.queue.len(), 1);
    assert!(attached.snapshot.queue[0].held);
    assert_eq!(attached.snapshot.queue[0].prompt_id, ack.prompt_id);
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, aura_drivers::driver::LoggedCommand::Prompt { .. }))
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
