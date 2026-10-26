use super::*;
use aura_protocol::workspace::{
    ChatMove, ProjectChatCreate, ProjectCreate, ProjectInput, WorkspaceFilter,
};

fn input(name: &str) -> ProjectInput {
    ProjectInput {
        name: name.into(),
        color: Some("#7766aa".into()),
        default_agent: Some("mock".into()),
        default_model: Some("small".into()),
    }
}

async fn project(rig: &Rig, name: &str) -> aura_protocol::workspace::ProjectSummary {
    rig.manager
        .project_create(ProjectCreate {
            project: input(name),
            folder: rig.folder.to_string_lossy().into_owned(),
        })
        .await
        .expect("project")
}

fn waiting_driver(native: &str) -> (ScriptedDriver, aura_drivers::testing::ScriptHandle) {
    ScriptedDriver::new(vec![
        ready_step(native),
        Step::Expect(CommandMatch::Shutdown),
    ])
}

#[tokio::test]
async fn projects_update_clear_optional_values_and_reuse_device_folder() {
    let rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    let project = project(&rig, "First").await;
    assert_eq!(project.folders.len(), 1);
    let folder = rig
        .manager
        .project_add_folder(&project.id, &rig.folder.join(".").to_string_lossy())
        .await
        .expect("same folder");
    assert_eq!(folder.id, project.folders[0].id);
    let updated = rig
        .manager
        .project_update(
            &project.id,
            ProjectInput {
                name: "Renamed".into(),
                color: None,
                default_agent: None,
                default_model: None,
            },
        )
        .await
        .expect("update");
    assert_eq!(updated.name, "Renamed");
    assert!(
        updated.color.is_none()
            && updated.default_agent.is_none()
            && updated.default_model.is_none()
    );
    assert!(
        rig.manager
            .project_update(&project.id, input("\n"))
            .await
            .is_err()
    );
    let snapshot = rig
        .manager
        .workspace_snapshot(WorkspaceFilter::default())
        .await
        .expect("snapshot");
    assert_eq!(snapshot.projects, vec![updated]);
}

#[tokio::test]
async fn manual_titles_survive_late_agent_titles_and_archived_chats_remain_addressable() {
    let (driver, handle) = waiting_driver("rename");
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let renamed = rig
        .manager
        .chat_rename(&chat.id, "  My title  ")
        .await
        .expect("rename");
    assert_eq!(renamed.chat.title.as_deref(), Some("My title"));
    handle.emit(DriverEvent::Title(Some("Automatic title".into())));
    rig.manager
        .attach(&chat.id, Arc::new(Sink::default()))
        .await
        .expect("actor barrier");
    let pinned = rig.manager.chat_pin(&chat.id, true).await.expect("pin");
    assert!(pinned.pinned);
    let archived = rig
        .manager
        .chat_archive(&chat.id, true)
        .await
        .expect("archive");
    assert!(archived.archived);
    assert!(
        rig.manager
            .workspace_snapshot(WorkspaceFilter::default())
            .await
            .expect("active")
            .chats
            .is_empty()
    );
    let all = rig
        .manager
        .workspace_snapshot(WorkspaceFilter {
            include_archived: true,
            project_id: Some(archived.project_id.clone()),
        })
        .await
        .expect("archive list");
    assert_eq!(all.chats.len(), 1);
    assert_eq!(all.chats[0].chat.title.as_deref(), Some("My title"));
    let stored = rig.store.load_chat(&chat.id).await.expect("durable title");
    assert_eq!(
        stored.chat.title_source,
        Some(crate::chatstore::TitleSource::Manual)
    );
    assert_eq!(stored.chat.title.as_deref(), Some("My title"));
    assert!(
        !rig.manager
            .chat_archive(&chat.id, false)
            .await
            .expect("restore")
            .archived
    );
}

#[tokio::test]
async fn active_move_is_refused_and_stopped_move_preserves_primary_folder() {
    let (driver, _) = waiting_driver("move");
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let destination = project(&rig, "Destination").await;
    let request = ChatMove {
        project_id: destination.id.clone(),
        folder_id: None,
        allow_busy_folder: false,
    };
    assert!(
        rig.manager
            .chat_move(&chat.id, request.clone())
            .await
            .expect_err("live move refused")
            .to_string()
            .contains("Stop the chat")
    );
    rig.manager.stop(&chat.id).await.expect("stop");
    eventually("all retired work ends", || {
        !rig.manager.shared().live.contains(&chat.id)
    })
    .await;
    let moved = rig
        .manager
        .chat_move(&chat.id, request)
        .await
        .expect("move");
    assert_eq!(moved.project_id, destination.id);
    assert_eq!(moved.chat.folder, chat.folder);
    assert_eq!(
        rig.store
            .load_chat(&chat.id)
            .await
            .expect("saved")
            .chat
            .folder
            .to_string_lossy(),
        chat.folder
    );
}

#[tokio::test]
async fn busy_folder_is_canonical_and_two_concurrent_creates_cannot_skip_warning() {
    let (driver, _) = waiting_driver("busy");
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let project = project(&rig, "Busy").await;
    let request = ProjectChatCreate {
        agent_id: "mock".into(),
        folder_id: project.folders[0].id.clone(),
        allow_busy_folder: false,
    };
    let (a, b) = tokio::join!(
        rig.manager.chat_project_create(request.clone()),
        rig.manager.chat_project_create(request)
    );
    assert_ne!(a.is_ok(), b.is_ok(), "exactly one start passes preflight");
    let alias = rig
        .manager
        .project_create(ProjectCreate {
            project: input("Alias"),
            folder: rig.folder.join(".").to_string_lossy().into_owned(),
        })
        .await
        .expect("alias project");
    let preview = rig
        .manager
        .chat_create_preview(&alias.folders[0].id)
        .await
        .expect("preview");
    assert_eq!(preview.busy_chats.len(), 1);
    assert_eq!(
        rig.manager
            .workspace_snapshot(WorkspaceFilter::default())
            .await
            .expect("snapshot")
            .chats
            .len(),
        1
    );
}

#[tokio::test]
async fn missing_folder_has_reason_and_cannot_create_a_chat() {
    let rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    let project = project(&rig, "Missing").await;
    std::fs::remove_dir(&rig.folder).expect("remove owned empty fixture folder");
    let preview = rig
        .manager
        .chat_create_preview(&project.folders[0].id)
        .await
        .expect("preview");
    assert_eq!(preview.folder.folder_state, FolderState::Missing);
    assert!(preview.folder.unavailable_reason.is_some());
    let result = rig
        .manager
        .chat_project_create(ProjectChatCreate {
            agent_id: "mock".into(),
            folder_id: project.folders[0].id.clone(),
            allow_busy_folder: true,
        })
        .await;
    assert!(result.is_err());
    assert!(
        rig.manager
            .workspace_snapshot(WorkspaceFilter::default())
            .await
            .expect("snapshot")
            .chats
            .is_empty()
    );
}

#[tokio::test]
async fn workspace_reads_saved_projects_while_saving_is_paused() {
    let (config, knobs) = tight();
    let (driver, _) = flooding_driver();
    let rig = rig(vec![driver], config, knobs);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    fill_disk(&rig.store);
    rig.manager
        .send(&chat.id, "fill fixture database".into())
        .await
        .expect("send");
    paused(&rig).await;
    let snapshot = tokio::time::timeout(
        Duration::from_secs(2),
        rig.manager.workspace_snapshot(WorkspaceFilter::default()),
    )
    .await
    .expect("saved read answers")
    .expect("snapshot");
    assert_eq!(snapshot.chats.len(), 1);
    assert!(
        rig.manager
            .chat_rename(&chat.id, "No late rename")
            .await
            .is_err()
    );
    free_disk(&rig.store);
}
