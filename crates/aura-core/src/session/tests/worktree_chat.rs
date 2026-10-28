use super::worktree_guards::enable_worktree_fixture;
use super::*;
use aura_protocol::git::{
    ChatFolderMode, WorktreeAction, WorktreeChatInput, WorktreeChatPlan, WorktreeChatPreview,
    WorktreeState,
};
use aura_protocol::workspace::{ProjectChatCreate, ProjectCreate, ProjectInput, ProjectSummary};
use aura_protocol::worktree_setup::{SetupCommand, WorktreeSetupInput};

fn idle_driver(native: &str) -> ScriptedDriver {
    ScriptedDriver::new(vec![
        ready_step(native),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ])
    .0
}

async fn project(rig: &Rig, folder: &Path) -> ProjectSummary {
    rig.manager
        .project_create(ProjectCreate {
            project: ProjectInput {
                name: "Parallel".into(),
                color: None,
                default_agent: Some("mock".into()),
                default_model: None,
            },
            folder: folder.to_string_lossy().into_owned(),
        })
        .await
        .expect("project")
}

fn input(project: &ProjectSummary) -> WorktreeChatInput {
    WorktreeChatInput {
        folder_id: project.folders[0].id.clone(),
        agent_id: "mock".into(),
        start_branch: None,
        branch: None,
        title: None,
        bring_changes: false,
        run_setup: true,
    }
}

async fn plan(rig: &Rig, input: WorktreeChatInput) -> WorktreeChatPlan {
    match rig
        .manager
        .worktree_chat_preview(input)
        .await
        .expect("preview")
    {
        WorktreeChatPreview::Worktree { plan } => *plan,
        WorktreeChatPreview::NotGitRepository { message, .. } => panic!("direct: {message}"),
    }
}

fn canonical(path: impl AsRef<Path>) -> PathBuf {
    path.as_ref().canonicalize().expect("canonical")
}

#[tokio::test]
async fn worktree_chat_is_created_in_its_own_worktree_while_the_source_is_busy() {
    let mut rig = rig(
        vec![idle_driver("direct"), idle_driver("isolated")],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    enable_worktree_fixture(&mut rig).await;
    let project = project(&rig, &rig.folder).await;
    let direct = rig
        .manager
        .chat_project_create(ProjectChatCreate {
            agent_id: "mock".into(),
            folder_id: project.folders[0].id.clone(),
            allow_busy_folder: false,
        })
        .await
        .expect("direct chat");
    status(&rig, &direct.chat.id, SessionStatus::Ready).await;
    let preview = plan(
        &rig,
        WorktreeChatInput {
            title: Some("Parallel fix".into()),
            ..input(&project)
        },
    )
    .await;
    assert_eq!(preview.branch, "aura/parallel-fix");
    assert_eq!(preview.starting_branch, "main");
    assert_eq!(preview.chip.mode, ChatFolderMode::Worktree);
    assert_eq!(
        preview.chip.label,
        "Worktree from main on aura/parallel-fix"
    );
    assert!(preview.setup.is_none());
    assert!(!Path::new(&preview.path).exists());
    // Bringing changes reads the source, so a busy source is refused for that variant only.
    let copying = plan(
        &rig,
        WorktreeChatInput {
            bring_changes: true,
            ..input(&project)
        },
    )
    .await;
    assert!(
        rig.manager
            .worktree_chat_apply(&copying.token)
            .await
            .is_err()
    );
    assert!(!Path::new(&copying.path).exists());
    let result = rig
        .manager
        .worktree_chat_apply(&preview.token)
        .await
        .expect("apply");
    assert!(result.started);
    assert!(result.setup.is_none());
    assert_eq!(result.worktree.state, WorktreeState::Ready);
    assert_eq!(result.chat.project_id, project.id);
    assert_eq!(result.chat.chat.title.as_deref(), Some("Parallel fix"));
    assert_eq!(
        canonical(&result.chat.chat.folder),
        canonical(&preview.path)
    );
    assert!(
        rig.manager
            .worktree_chat_apply(&preview.token)
            .await
            .is_err(),
        "a token is single use"
    );
    let chat_id = result.chat.chat.id.clone();
    status(&rig, &chat_id, SessionStatus::Ready).await;
    let saved = rig.store.load_chat(&chat_id).await.expect("saved chat");
    assert_eq!(canonical(&saved.chat.folder), canonical(&preview.path));
    let workspace = rig.manager.git_workspace(&chat_id).await.expect("git");
    assert!(workspace.is_linked_worktree);
    assert_eq!(workspace.branch.as_deref(), Some("aura/parallel-fix"));
    assert_eq!(
        rig.manager
            .managed_worktrees(&chat_id)
            .await
            .expect("records"),
        vec![result.worktree.clone()]
    );
    // Merge, PR and Discard work from the new chat as they do for a chat moved into a worktree.
    rig.manager
        .worktree_action_preview(&chat_id, &result.worktree.id, WorktreeAction::Discard)
        .await
        .expect("discard preview");
    let context = rig
        .manager
        .chat_folder_context(&chat_id)
        .await
        .expect("folder context");
    assert_eq!(canonical(&context.primary), canonical(&preview.path));
    assert!(
        context.additional.is_empty(),
        "the original checkout is excluded from the isolated session"
    );
    // The source chat kept running in the original folder.
    assert!(rig.manager.shared().live.contains(&direct.chat.id));
}

#[tokio::test]
async fn an_unsaved_chat_rolls_back_its_new_worktree_and_branch() {
    let mut rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    enable_worktree_fixture(&mut rig).await;
    let project = project(&rig, &rig.folder).await;
    let preview = plan(&rig, input(&project)).await;
    rig.manager
        .shared()
        .fail_worktree_chat_save
        .store(true, Ordering::SeqCst);
    let error = rig
        .manager
        .worktree_chat_apply(&preview.token)
        .await
        .expect_err("save failure")
        .to_string();
    assert!(error.contains("were removed"), "{error}");
    assert!(!Path::new(&preview.path).exists());
    let branch = rig.folder.join(".git/refs/heads").join(&preview.branch);
    assert!(!branch.exists(), "the new branch was removed");
    let packed = std::fs::read_to_string(rig.folder.join(".git/packed-refs")).unwrap_or_default();
    assert!(!packed.contains(&preview.branch));
    let snapshot = rig
        .manager
        .workspace_snapshot(aura_protocol::workspace::WorkspaceFilter {
            include_archived: true,
            project_id: None,
        })
        .await
        .expect("snapshot");
    assert!(snapshot.chats.is_empty(), "no chat was saved");
    // The next attempt with a fresh preview succeeds.
    let retry = plan(&rig, input(&project)).await;
    let created = rig
        .manager
        .worktree_chat_apply(&retry.token)
        .await
        .expect("retry");
    assert_eq!(created.worktree.state, WorktreeState::Ready);
}

#[tokio::test]
async fn a_plain_project_folder_returns_the_direct_fallback() {
    let mut rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    enable_worktree_fixture(&mut rig).await;
    let plain = tempfile::tempdir().expect("plain");
    let project = project(&rig, plain.path()).await;
    let preview = rig
        .manager
        .worktree_chat_preview(input(&project))
        .await
        .expect("preview");
    let WorktreeChatPreview::NotGitRepository { message, chip, .. } = preview else {
        panic!("expected the direct fallback");
    };
    assert!(message.contains("not a Git repository"), "{message}");
    assert_eq!(chip.mode, ChatFolderMode::Direct);
    assert!(chip.branch.is_none());
}

#[tokio::test]
async fn saved_setup_runs_after_creation_and_holds_the_agent_for_the_command() {
    let mut rig = rig(
        vec![idle_driver("setup-source")],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    enable_worktree_fixture(&mut rig).await;
    let project = project(&rig, &rig.folder).await;
    let direct = rig
        .manager
        .chat_project_create(ProjectChatCreate {
            agent_id: "mock".into(),
            folder_id: project.folders[0].id.clone(),
            allow_busy_folder: false,
        })
        .await
        .expect("direct chat");
    std::fs::write(rig.folder.join(".env"), "FIXTURE=one").expect("env fixture");
    let recipe = WorktreeSetupInput {
        files: vec![".env".into()],
        command: Some(SetupCommand {
            program: std::env::current_exe()
                .expect("exe")
                .to_string_lossy()
                .into(),
            args: vec!["--not-executed".into()],
        }),
    };
    rig.manager
        .worktree_setup_save(&direct.chat.id, recipe.clone())
        .await
        .expect("save recipe");
    let skipped = plan(
        &rig,
        WorktreeChatInput {
            run_setup: false,
            ..input(&project)
        },
    )
    .await;
    assert!(skipped.setup.is_none());
    assert!(
        skipped
            .warnings
            .iter()
            .any(|warning| warning.contains("skipped"))
    );
    let preview = plan(&rig, input(&project)).await;
    assert_eq!(preview.setup.as_ref(), Some(&recipe));
    assert!(
        preview
            .warnings
            .iter()
            .any(|warning| warning.contains("--not-executed"))
    );
    let result = rig
        .manager
        .worktree_chat_apply(&preview.token)
        .await
        .expect("apply");
    let setup = result.setup.expect("setup ran");
    assert_eq!(setup.copied, vec![".env"]);
    assert!(setup.command_token.is_some());
    assert!(!result.started, "the agent waits for the setup command");
    assert!(
        !rig.manager.shared().live.contains(&result.chat.chat.id),
        "no agent process was started"
    );
    assert_eq!(
        std::fs::read(Path::new(&result.worktree.path).join(".env")).expect("copied"),
        b"FIXTURE=one"
    );
}

#[tokio::test]
async fn a_deleted_worktree_folder_is_recreated_for_its_stopped_chat() {
    let mut rig = rig(
        vec![idle_driver("recreate")],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    enable_worktree_fixture(&mut rig).await;
    let project = project(&rig, &rig.folder).await;
    let preview = plan(&rig, input(&project)).await;
    let result = rig
        .manager
        .worktree_chat_apply(&preview.token)
        .await
        .expect("apply");
    let chat_id = result.chat.chat.id.clone();
    status(&rig, &chat_id, SessionStatus::Ready).await;
    std::fs::remove_dir_all(&result.worktree.path).expect("deleted by hand");
    assert_eq!(
        rig.manager.managed_worktrees(&chat_id).await.expect("list")[0].state,
        WorktreeState::Missing
    );
    let recreate = rig
        .manager
        .worktree_recreate_preview(&chat_id, &result.worktree.id)
        .await
        .expect("recreate preview");
    // A live chat still holds the folder; Git actions wait for it to stop.
    assert!(
        rig.manager
            .worktree_recreate_apply(&chat_id, &result.worktree.id, &recreate.token)
            .await
            .is_err()
    );
    rig.manager.stop(&chat_id).await.expect("stop");
    eventually("stopped", || !rig.manager.shared().live.contains(&chat_id)).await;
    let recreate = rig
        .manager
        .worktree_recreate_preview(&chat_id, &result.worktree.id)
        .await
        .expect("recreate preview again");
    let recreated = rig
        .manager
        .worktree_recreate_apply(&chat_id, &result.worktree.id, &recreate.token)
        .await
        .expect("recreate");
    assert!(recreated.error.is_none(), "{:?}", recreated.error);
    assert_eq!(recreated.worktree.state, WorktreeState::Ready);
    assert!(Path::new(&result.worktree.path).join(".git").is_file());
    assert_eq!(
        rig.manager.managed_worktrees(&chat_id).await.expect("list")[0].state,
        WorktreeState::Ready
    );
}
