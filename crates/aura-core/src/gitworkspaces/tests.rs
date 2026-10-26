use super::*;
use crate::{paths::DataRoot, profile::Profiles};
use aura_process::{EnvSource, ResolvedEnv, process_env};
use aura_protocol::git::{IsolationInput, WorktreeState};

struct Rig {
    _dir: tempfile::TempDir,
    work: PathBuf,
    service: Arc<GitWorkspaces>,
    git: git::Git,
}

async fn rig() -> Rig {
    let dir = tempfile::tempdir().expect("fixture");
    let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
        .open_active()
        .expect("profile");
    let work = dir.path().join("repo with space");
    std::fs::create_dir(&work).expect("repo");
    let env = EnvResolver::fixed(ResolvedEnv {
        vars: process_env(),
        source: EnvSource::Fallback {
            reason: "worktree fixture".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let service = GitWorkspaces::new(&profile, env, LeftoverRegistry::disabled());
    let git = service.git().await.expect("git");
    git.run(&work, git::args(&["init", "-b", "main"]), 8192)
        .await
        .expect("init");
    git.run(
        &work,
        git::args(&["config", "core.autocrlf", "false"]),
        8192,
    )
    .await
    .expect("fixture line ending setting");
    for (key, value) in [
        ("user.name", "Fixture"),
        ("user.email", "fixture@localhost"),
    ] {
        git.run(&work, git::args(&["config", key, value]), 8192)
            .await
            .expect("fixture identity");
    }
    std::fs::write(work.join("file.txt"), "initial\n").expect("file");
    git.run(&work, git::args(&["add", "--", "file.txt"]), 8192)
        .await
        .expect("add");
    git.run(
        &work,
        git::args(&[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "initial",
        ]),
        8192,
    )
    .await
    .expect("commit");
    Rig {
        _dir: dir,
        work,
        service,
        git,
    }
}

async fn isolated(rig: &Rig) -> aura_protocol::git::ManagedWorktree {
    let preview = rig
        .service
        .isolation_preview(
            "chat",
            &rig.work,
            IsolationInput {
                slug: "feature".into(),
                bring_changes: false,
            },
        )
        .await
        .expect("preview");
    let result = rig
        .service
        .isolation_apply("chat", &preview.token)
        .await
        .expect("isolate");
    assert_eq!(result.worktree.state, WorktreeState::Ready);
    result.worktree
}

async fn commit_file(rig: &Rig, path: &Path, text: &str) {
    std::fs::write(path.join("file.txt"), text).expect("edit");
    rig.git
        .run(path, git::args(&["add", "--", "file.txt"]), 8192)
        .await
        .expect("stage fixture");
    rig.git
        .run(
            path,
            git::args(&[
                "-c",
                "commit.gpgSign=false",
                "commit",
                "-m",
                "owned fixture change",
            ]),
            8192,
        )
        .await
        .expect("commit fixture");
}

#[tokio::test]
async fn merge_preserves_recovery_and_refuses_a_dirty_or_changed_target() {
    use aura_protocol::git::WorktreeAction;
    let rig = rig().await;
    let worktree = isolated(&rig).await;
    commit_file(&rig, Path::new(&worktree.path), "isolated result\n").await;
    let action = WorktreeAction::Merge {
        message: "Merge reviewed changes".into(),
    };
    std::fs::write(rig.work.join("untracked.txt"), "keep").expect("owned untracked");
    assert!(
        rig.service
            .action_preview("chat", &worktree.id, action.clone())
            .await
            .expect_err("dirty")
            .to_string()
            .contains("clean index")
    );
    std::fs::remove_file(rig.work.join("untracked.txt")).expect("remove owned fixture");
    let stale = rig
        .service
        .action_preview("chat", &worktree.id, action.clone())
        .await
        .expect("preview");
    std::fs::write(rig.work.join("file.txt"), "late user edit").expect("late edit");
    assert!(
        rig.service
            .action_apply("chat", &stale.token)
            .await
            .expect_err("late edit")
            .to_string()
            .contains("changed after")
    );
    assert_eq!(
        std::fs::read_to_string(rig.work.join("file.txt")).expect("kept"),
        "late user edit"
    );
    std::fs::write(rig.work.join("file.txt"), "initial\n").expect("restore owned fixture");
    let before = rig
        .service
        .inspect(&rig.work)
        .await
        .expect("before")
        .head
        .expect("head");
    let preview = rig
        .service
        .action_preview("chat", &worktree.id, action)
        .await
        .expect("preview");
    assert!(preview.conflicts.is_empty());
    assert!(preview.changes.contains("file.txt"));
    let result = rig
        .service
        .action_apply("chat", &preview.token)
        .await
        .expect("merge");
    assert!(result.error.is_none(), "{:?}", result.error);
    assert_eq!(result.worktree.state, WorktreeState::Ready);
    assert_eq!(
        std::fs::read_to_string(rig.work.join("file.txt")).expect("merged"),
        "isolated result\n"
    );
    let after = rig.service.inspect(&rig.work).await.expect("after");
    assert!(after.files.is_empty());
    assert_eq!(after.head, result.commit);
    let recovery = git::text(
        &rig.git
            .run(
                &rig.work,
                vec!["rev-parse".into(), result.recovery.into()],
                128,
            )
            .await
            .expect("recovery"),
    )
    .expect("oid");
    assert_eq!(recovery, before);
    assert!(!rig.work.join(".git/HEAD.lock").exists());
}

#[tokio::test]
async fn merge_conflicts_leave_both_indexes_and_files_unchanged() {
    use aura_protocol::git::WorktreeAction;
    let rig = rig().await;
    let worktree = isolated(&rig).await;
    commit_file(&rig, Path::new(&worktree.path), "isolated change\n").await;
    commit_file(&rig, &rig.work, "direct change\n").await;
    let index = std::fs::read(rig.work.join(".git/index")).expect("index");
    let preview = rig
        .service
        .action_preview(
            "chat",
            &worktree.id,
            WorktreeAction::Merge {
                message: "merge".into(),
            },
        )
        .await
        .expect("conflict preview");
    assert_eq!(preview.conflicts, vec!["file.txt"]);
    assert!(
        rig.service
            .action_apply("chat", &preview.token)
            .await
            .expect_err("conflict")
            .to_string()
            .contains("conflicts")
    );
    assert_eq!(
        std::fs::read(rig.work.join(".git/index")).expect("same index"),
        index
    );
    assert_eq!(
        std::fs::read_to_string(rig.work.join("file.txt")).expect("direct"),
        "direct change\n"
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&worktree.path).join("file.txt")).expect("isolated"),
        "isolated change\n"
    );
    assert!(!rig.work.join(".git/MERGE_HEAD").exists());
}

#[tokio::test]
async fn discard_retires_owned_directory_with_ignored_bytes_and_rejects_external_paths() {
    use aura_protocol::git::WorktreeAction;
    let rig = rig().await;
    let worktree = isolated(&rig).await;
    let path = Path::new(&worktree.path);
    std::fs::write(path.join(".gitignore"), "retained.data\n").expect("ignore fixture");
    std::fs::write(path.join("retained.data"), [0, 255, 7, 3]).expect("opaque owned bytes");
    let preview = rig
        .service
        .action_preview("chat", &worktree.id, WorktreeAction::Discard)
        .await
        .expect("discard preview");
    let result = rig
        .service
        .action_apply("chat", &preview.token)
        .await
        .expect("retire");
    assert!(result.error.is_none(), "{:?}", result.error);
    assert_eq!(result.worktree.state, WorktreeState::Retired);
    assert!(!path.exists());
    assert_eq!(
        std::fs::read(Path::new(&result.recovery).join("retained.data"))
            .expect("all bytes retained"),
        [0, 255, 7, 3]
    );
    assert!(
        rig.service
            .action_preview("chat", &worktree.id, WorktreeAction::Discard)
            .await
            .is_err()
    );
    let mut records = rig.service.read_records().expect("records");
    records[0].path = rig.work.to_string_lossy().into_owned();
    records[0].state = WorktreeState::Ready;
    rig.service
        .write_records(records)
        .expect("owned corrupt registry fixture");
    assert!(
        rig.service
            .action_preview("chat", &worktree.id, WorktreeAction::Discard)
            .await
            .expect_err("outside ownership")
            .to_string()
            .contains("app-owned")
    );
    assert!(rig.work.join("file.txt").exists());
}

#[tokio::test]
async fn a_merge_never_overwrites_an_ignored_or_late_untracked_collision() {
    use aura_protocol::git::WorktreeAction;
    for ignored in [false, true] {
        let rig = rig().await;
        let worktree = isolated(&rig).await;
        let path = Path::new(&worktree.path);
        std::fs::write(path.join("introduced.txt"), "incoming\n").expect("introduced fixture");
        rig.git
            .run(path, git::args(&["add", "--", "introduced.txt"]), 8192)
            .await
            .expect("stage introduced");
        rig.git
            .run(
                path,
                git::args(&[
                    "-c",
                    "commit.gpgSign=false",
                    "commit",
                    "-m",
                    "introduce path",
                ]),
                8192,
            )
            .await
            .expect("commit fixture");
        if ignored {
            std::fs::write(rig.work.join(".git/info/exclude"), "introduced.txt\n")
                .expect("owned exclude");
        }
        let preview = rig
            .service
            .action_preview(
                "chat",
                &worktree.id,
                WorktreeAction::Merge {
                    message: "reviewed merge".into(),
                },
            )
            .await
            .expect("preview before collision");
        std::fs::write(rig.work.join("introduced.txt"), b"retain local bytes\r\n")
            .expect("late collision");
        let outcome = rig.service.action_apply("chat", &preview.token).await;
        assert!(
            !outcome.as_ref().is_ok_and(|result| result.error.is_none()),
            "a collision cannot be called a clean merge"
        );
        assert_eq!(
            std::fs::read(rig.work.join("introduced.txt")).expect("retained"),
            b"retain local bytes\r\n",
            "ignored={ignored}"
        );
        assert_eq!(
            rig.service.inspect(&rig.work).await.expect("target").head,
            preview.target.expect("target preview").head
        );
    }
}

#[tokio::test]
async fn post_merge_verification_rejects_a_branch_switch_or_new_index_change() {
    let rig = rig().await;
    let head = rig
        .service
        .inspect(&rig.work)
        .await
        .expect("snapshot")
        .head
        .expect("head");
    actions::verify_merge_result(&rig.git, &rig.work, "main", &head)
        .await
        .expect("matching state");
    rig.git
        .run(&rig.work, git::args(&["checkout", "-b", "other"]), 8192)
        .await
        .expect("external branch switch fixture");
    assert!(
        actions::verify_merge_result(&rig.git, &rig.work, "main", &head)
            .await
            .is_err()
    );
    rig.git
        .run(&rig.work, git::args(&["checkout", "main"]), 8192)
        .await
        .expect("restore fixture branch");
    std::fs::write(rig.work.join("file.txt"), "late change").expect("late change");
    rig.git
        .run(&rig.work, git::args(&["add", "--", "file.txt"]), 8192)
        .await
        .expect("late staged change");
    assert!(
        actions::verify_merge_result(&rig.git, &rig.work, "main", &head)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn retired_worktree_restore_preserves_files_and_reconciles_an_interrupted_move() {
    use aura_protocol::git::{WorktreeAction, WorktreeRecovery, WorktreeRecoveryAction};
    let rig = rig().await;
    let original = isolated(&rig).await;
    std::fs::write(
        Path::new(&original.path).join("private.local"),
        b"retain bytes\r\n",
    )
    .expect("local bytes");
    std::fs::write(rig.work.join(".git/info/exclude"), "private.local\n").expect("owned ignore");
    let discard = rig
        .service
        .action_preview("chat", &original.id, WorktreeAction::Discard)
        .await
        .expect("discard");
    let retired = rig
        .service
        .action_apply("chat", &discard.token)
        .await
        .expect("retire")
        .worktree;
    let mut interrupted = original.clone();
    interrupted.state = WorktreeState::Retiring;
    interrupted.recovery = Some(WorktreeRecovery::Retire);
    rig.service
        .save_record(&interrupted)
        .expect("interrupted journal");
    let review = rig
        .service
        .recovery_preview("chat", &original.id, WorktreeRecoveryAction::Reconcile)
        .await
        .expect("reconcile moved path");
    assert_eq!(
        Path::new(&review.destination)
            .canonicalize()
            .expect("destination"),
        Path::new(&retired.path).canonicalize().expect("retired")
    );
    let reconciled = rig
        .service
        .recovery_apply("chat", &original.id, &review.token)
        .await
        .expect("reconcile");
    assert_eq!(reconciled.worktree.state, WorktreeState::Retired);
    let restore = rig
        .service
        .recovery_preview("chat", &original.id, WorktreeRecoveryAction::Restore)
        .await
        .expect("restore preview");
    assert!(
        rig.service
            .recovery_apply("chat", "another-worktree", &restore.token)
            .await
            .is_err()
    );
    let restore = rig
        .service
        .recovery_preview("chat", &original.id, WorktreeRecoveryAction::Restore)
        .await
        .expect("fresh restore");
    let result = rig
        .service
        .recovery_apply("chat", &original.id, &restore.token)
        .await
        .expect("restore");
    assert_eq!(result.error, None);
    assert_eq!(result.worktree.state, WorktreeState::Ready);
    assert_eq!(Path::new(&result.worktree.path), Path::new(&original.path));
    assert_eq!(
        std::fs::read(Path::new(&original.path).join("private.local")).expect("kept"),
        b"retain bytes\r\n"
    );
    assert!(!Path::new(&retired.path).exists());
    assert!(
        rig.service
            .recovery_apply("chat", &original.id, &restore.token)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn recovery_keeps_foreign_locks_and_rejects_unknown_future_state() {
    use aura_protocol::git::WorktreeRecoveryAction;
    let rig = rig().await;
    let mut worktree = isolated(&rig).await;
    worktree.state = WorktreeState::Creating;
    rig.service
        .save_record(&worktree)
        .expect("interrupted creation");
    let folder = Path::new(&worktree.path);
    let gitdir = git::text(
        &rig.git
            .run(
                folder,
                git::args(&["rev-parse", "--absolute-git-dir"]),
                8192,
            )
            .await
            .expect("git dir"),
    )
    .expect("path");
    let lock = Path::new(&gitdir).join("locked");
    std::fs::write(&lock, "another owner's review\n").expect("foreign lock fixture");
    let preview = rig
        .service
        .recovery_preview("chat", &worktree.id, WorktreeRecoveryAction::Reconcile)
        .await
        .expect("read only preview");
    assert!(
        rig.service
            .recovery_apply("chat", &worktree.id, &preview.token)
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(lock).expect("retained"),
        "another owner's review\n"
    );
    let registry = rig.service.root.join("registry.json");
    let before = std::fs::read_to_string(&registry)
        .expect("registry")
        .replace("\"creating\"", "\"future_state\"");
    std::fs::write(&registry, &before).expect("newer state fixture");
    assert!(rig.service.list("chat").await.is_err());
    assert_eq!(
        std::fs::read_to_string(registry).expect("unchanged"),
        before
    );
}

#[tokio::test]
async fn interrupted_merge_reconciliation_checks_clean_outcome_and_retained_refs() {
    use aura_protocol::git::{WorktreeAction, WorktreeRecovery, WorktreeRecoveryAction};
    let rig = rig().await;
    let worktree = isolated(&rig).await;
    commit_file(&rig, Path::new(&worktree.path), "merged\n").await;
    let merge = rig
        .service
        .action_preview(
            "chat",
            &worktree.id,
            WorktreeAction::Merge {
                message: "merge".into(),
            },
        )
        .await
        .expect("merge preview");
    let mut result = rig
        .service
        .action_apply("chat", &merge.token)
        .await
        .expect("merge")
        .worktree;
    result.state = WorktreeState::Merging;
    rig.service
        .save_record(&result)
        .expect("interrupted journal");
    std::fs::write(rig.work.join("file.txt"), "new user edit").expect("edit");
    assert!(
        rig.service
            .recovery_preview("chat", &worktree.id, WorktreeRecoveryAction::Reconcile)
            .await
            .is_err()
    );
    std::fs::write(rig.work.join("file.txt"), "merged\n").expect("restore owned fixture");
    let index = std::fs::read(rig.work.join(".git/index")).expect("index before read-only review");
    let preview = rig
        .service
        .recovery_preview("chat", &worktree.id, WorktreeRecoveryAction::Reconcile)
        .await
        .expect("settled outcome");
    assert_eq!(
        std::fs::read(rig.work.join(".git/index")).expect("index after review"),
        index
    );
    let Some(WorktreeRecovery::Merge {
        before_ref,
        before_commit,
        ..
    }) = &result.recovery
    else {
        panic!("typed merge journal");
    };
    rig.git
        .run(
            &rig.work,
            git::args(&["update-ref", "-d", before_ref, before_commit]),
            8192,
        )
        .await
        .expect("external ref deletion fixture");
    assert!(
        rig.service
            .recovery_apply("chat", &worktree.id, &preview.token)
            .await
            .is_err()
    );
    rig.git
        .run(
            &rig.work,
            git::args(&["update-ref", before_ref, before_commit, ""]),
            8192,
        )
        .await
        .expect("restore fixture ref");
    let preview = rig
        .service
        .recovery_preview("chat", &worktree.id, WorktreeRecoveryAction::Reconcile)
        .await
        .expect("review retained outcome");
    let reconciled = rig
        .service
        .recovery_apply("chat", &worktree.id, &preview.token)
        .await
        .expect("reconcile");
    assert_eq!(reconciled.worktree.state, WorktreeState::Ready);
    assert_eq!(reconciled.error, None);
}

#[tokio::test]
async fn create_isolation_preserves_dirty_user_index_and_head_and_is_durably_registered() {
    let rig = rig().await;
    std::fs::write(rig.work.join("file.txt"), "staged\n").expect("staged");
    rig.git
        .run(&rig.work, git::args(&["add", "--", "file.txt"]), 8192)
        .await
        .expect("stage");
    std::fs::write(rig.work.join("file.txt"), "unstaged\r\n").expect("unstaged");
    std::fs::write(rig.work.join("untracked.txt"), "keep").expect("untracked");
    let index = std::fs::read(rig.work.join(".git/index")).expect("index");
    let head = std::fs::read(rig.work.join(".git/HEAD")).expect("head");
    let preview = rig
        .service
        .isolation_preview(
            "chat",
            &rig.work,
            IsolationInput {
                slug: "feature".into(),
                bring_changes: false,
            },
        )
        .await
        .expect("preview");
    assert_eq!(preview.source.files.len(), 2);
    assert!(!Path::new(&preview.path).starts_with(&rig.work));
    assert!(
        !Path::new(&preview.path).exists(),
        "preview never creates worktree"
    );
    let result = rig
        .service
        .isolation_apply("chat", &preview.token)
        .await
        .expect("apply");
    assert_eq!(
        result.worktree.state,
        WorktreeState::Ready,
        "{:?}",
        result.worktree.detail
    );
    assert_eq!(
        std::fs::read(rig.work.join(".git/index")).expect("same index"),
        index
    );
    assert_eq!(
        std::fs::read(rig.work.join(".git/HEAD")).expect("same head"),
        head
    );
    assert_eq!(
        std::fs::read(rig.work.join("file.txt")).expect("same bytes"),
        b"unstaged\r\n"
    );
    assert_eq!(
        std::fs::read(Path::new(&preview.path).join("file.txt")).expect("new checkout"),
        b"initial\n"
    );
    assert!(!Path::new(&preview.path).join("untracked.txt").exists());
    assert_eq!(
        rig.service.list("chat").await.expect("registry"),
        vec![result.worktree]
    );
    assert!(
        rig.service
            .isolation_apply("chat", &preview.token)
            .await
            .is_err()
    );
    let second = rig
        .service
        .isolation_preview(
            "other",
            &rig.work,
            IsolationInput {
                slug: "feature".into(),
                bring_changes: false,
            },
        )
        .await
        .expect("second");
    assert_eq!(second.branch, "aura/feature-2");
}

#[tokio::test]
async fn stale_commit_or_index_and_interrupted_git_states_are_blocked() {
    let rig = rig().await;
    let input = IsolationInput {
        slug: "stale".into(),
        bring_changes: false,
    };
    let preview = rig
        .service
        .isolation_preview("chat", &rig.work, input.clone())
        .await
        .expect("preview");
    std::fs::write(rig.work.join("file.txt"), "changed").expect("change");
    rig.git
        .run(&rig.work, git::args(&["add", "--", "file.txt"]), 8192)
        .await
        .expect("stage");
    assert!(
        rig.service
            .isolation_apply("chat", &preview.token)
            .await
            .expect_err("stale")
            .to_string()
            .contains("changed after")
    );
    assert!(!Path::new(&preview.path).exists());
    std::fs::write(
        rig.work.join(".git/MERGE_HEAD"),
        "1111111111111111111111111111111111111111\n",
    )
    .expect("owned merge fixture");
    let snapshot = rig.service.inspect(&rig.work).await.expect("inspect");
    assert!(
        snapshot
            .blockers
            .iter()
            .any(|reason| reason.contains("merge is in progress"))
    );
    assert!(
        rig.service
            .isolation_preview("chat", &rig.work, input)
            .await
            .is_err()
    );
    assert!(rig.service.list("chat").await.expect("list").is_empty());
}

#[tokio::test]
async fn missing_git_and_detached_head_have_explicit_reasons() {
    let rig = rig().await;
    let plain = rig._dir.path().join("plain");
    std::fs::create_dir(&plain).expect("plain");
    assert!(
        rig.service
            .inspect(&plain)
            .await
            .expect_err("non git")
            .to_string()
            .contains("not a Git")
    );
    rig.git
        .run(&rig.work, git::args(&["checkout", "--detach"]), 8192)
        .await
        .expect("detach");
    let snapshot = rig.service.inspect(&rig.work).await.expect("inspect");
    assert!(
        snapshot
            .blockers
            .iter()
            .any(|reason| reason.contains("detached"))
    );
}
