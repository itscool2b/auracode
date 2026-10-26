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
