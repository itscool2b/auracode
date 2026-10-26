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
