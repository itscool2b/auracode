use super::*;
use crate::paths::DataRoot;
use crate::profile::Profiles;
use aura_process::{EnvSource, ResolvedEnv, process_env};

struct Rig {
    _dir: tempfile::TempDir,
    work: PathBuf,
    service: Arc<Checkpoints>,
    chat: String,
    folder: String,
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().expect("fixture");
    let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
        .open_active()
        .expect("profile");
    let work = dir.path().join("work");
    std::fs::create_dir(&work).expect("work");
    let env = EnvResolver::fixed(ResolvedEnv {
        vars: process_env(),
        source: EnvSource::Fallback {
            reason: "checkpoint fixture".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let service = Checkpoints::new(&profile, env, LeftoverRegistry::disabled());
    Rig {
        _dir: dir,
        work,
        service,
        chat: crate::ids::new_id(),
        folder: crate::ids::new_id(),
    }
}

#[tokio::test]
async fn non_git_checkpoint_preserves_bytes_ignores_and_reports_changes() {
    let rig = rig();
    std::fs::write(rig.work.join(".gitignore"), "ignored/\n").expect("ignore");
    std::fs::create_dir(rig.work.join("ignored")).expect("ignored directory");
    std::fs::write(rig.work.join("ignored/secret"), "not captured").expect("ignored file");
    std::fs::write(rig.work.join("text.txt"), b"first\r\nsecond\r\n").expect("text");
    std::fs::write(rig.work.join("binary.dat"), [0, 128, 255]).expect("binary");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    assert_eq!(checkpoint.file_count, 3);
    assert!(!rig.work.join(".git").exists());
    std::fs::write(rig.work.join("text.txt"), "changed\n").expect("edit");
    std::fs::remove_file(rig.work.join("binary.dat")).expect("delete fixture");
    std::fs::write(rig.work.join("new.txt"), "new").expect("new");
    let changes = rig
        .service
        .changes(&rig.chat, &rig.folder, &rig.work, &checkpoint.id)
        .await
        .expect("changes");
    assert_eq!(changes.files.len(), 3);
    assert_eq!(
        changes
            .files
            .iter()
            .find(|file| file.path == "binary.dat")
            .expect("binary change")
            .kind,
        ChangeKind::Deleted
    );
    let diff = rig
        .service
        .diff(
            &rig.chat,
            &rig.folder,
            &rig.work,
            &checkpoint.id,
            "text.txt",
        )
        .await
        .expect("diff");
    assert_eq!(diff.before.as_deref(), Some("first\r\nsecond\r\n"));
    assert_eq!(diff.after.as_deref(), Some("changed\n"));
    assert!(!diff.binary && !diff.truncated);
}

#[tokio::test]
async fn checkpoint_never_changes_the_user_index_or_applies_attributes() {
    let rig = rig();
    let git = aura_process::find_exe("git", &process_env()).expect("test Git");
    for args in [vec!["init"], vec!["add", "--", "staged.txt"]] {
        if args[0] == "add" {
            std::fs::write(rig.work.join("staged.txt"), "staged\n").expect("file");
        }
        let output = aura_process::run_helper(
            &LeftoverRegistry::disabled(),
            aura_process::HelperSpec {
                program: git.clone(),
                args: args.into_iter().map(Into::into).collect(),
                cwd: rig.work.clone(),
                env: aura_process::HelperEnv::ProcessEnv,
                set: vec![],
                new_session: true,
                timeout: std::time::Duration::from_secs(10),
                max_stdout: 4096,
            },
        )
        .await
        .expect("fixture Git");
        assert_eq!(output.exit.and_then(|exit| exit.code), Some(0));
    }
    let index = std::fs::read(rig.work.join(".git/index")).expect("index before");
    let head = std::fs::read(rig.work.join(".git/HEAD")).expect("head before");
    std::fs::write(rig.work.join(".gitattributes"), "*.txt text eol=lf\n").expect("attributes");
    std::fs::write(rig.work.join("staged.txt"), b"unstaged\r\n").expect("working change");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    assert_eq!(
        std::fs::read(rig.work.join(".git/index")).expect("index after"),
        index
    );
    assert_eq!(
        std::fs::read(rig.work.join(".git/HEAD")).expect("head after"),
        head
    );
    let diff = rig
        .service
        .diff(
            &rig.chat,
            &rig.folder,
            &rig.work,
            &checkpoint.id,
            "staged.txt",
        )
        .await
        .expect("diff");
    assert_eq!(diff.before.as_deref(), Some("unstaged\r\n"));
    assert_eq!(diff.before, diff.after);
}

#[test]
fn paths_reject_traversal_git_metadata_and_windows_streams() {
    for path in [
        "../secrets",
        "a/../b",
        "/absolute",
        "C:/absolute",
        "a\\b",
        "file:stream",
        ".git/config",
        "sub/.GIT/index",
        "line\nname",
    ] {
        assert!(scan::validate(path).is_err(), "{path}");
    }
    assert!(scan::validate("folder with space/文档.txt").is_ok());
}

#[tokio::test]
async fn newly_ignored_saved_file_does_not_look_deleted() {
    let rig = rig();
    std::fs::write(rig.work.join("file.txt"), "before").expect("file");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    std::fs::write(rig.work.join(".gitignore"), "file.txt\n").expect("ignore");
    let changes = rig
        .service
        .changes(&rig.chat, &rig.folder, &rig.work, &checkpoint.id)
        .await
        .expect("changes");
    assert_eq!(changes.files.len(), 1);
    assert_eq!(changes.files[0].path, ".gitignore");
}

#[tokio::test]
async fn revert_restores_exact_bytes_and_retains_original_work_for_recovery() {
    let rig = rig();
    std::fs::write(rig.work.join("edit.txt"), b"before\r\n").expect("before");
    std::fs::create_dir(rig.work.join("removed")).expect("directory");
    std::fs::write(rig.work.join("removed/file.txt"), "restore directory").expect("deleted file");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    std::fs::write(rig.work.join("edit.txt"), "external edit").expect("edit");
    std::fs::remove_file(rig.work.join("removed/file.txt")).expect("delete owned file");
    std::fs::remove_dir(rig.work.join("removed")).expect("delete empty owned directory");
    std::fs::write(rig.work.join("added.txt"), "new work").expect("added");
    let preview = rig
        .service
        .preview_revert(
            &rig.chat,
            &rig.folder,
            &rig.work,
            &checkpoint.id,
            vec![
                "edit.txt".into(),
                "removed/file.txt".into(),
                "added.txt".into(),
            ],
        )
        .await
        .expect("preview");
    let result = rig
        .service
        .revert(&rig.chat, &rig.folder, &rig.work, &preview.token)
        .await
        .expect("revert");
    assert!(result.error.is_none(), "{:?}", result.error);
    assert_eq!(result.applied.len(), 3);
    assert_eq!(
        std::fs::read(rig.work.join("edit.txt")).expect("restored"),
        b"before\r\n"
    );
    assert_eq!(
        std::fs::read_to_string(rig.work.join("removed/file.txt")).expect("restored deletion"),
        "restore directory"
    );
    assert!(!rig.work.join("added.txt").exists());
    let backup = PathBuf::from(&result.recovery_paths[0]);
    assert_eq!(
        std::fs::read_to_string(backup.join("original-0")).expect("new work retained"),
        "new work"
    );
    assert_eq!(
        std::fs::read_to_string(backup.join("original-1")).expect("edit retained"),
        "external edit"
    );
    assert!(
        rig.service
            .changes(&rig.chat, &rig.folder, &rig.work, &checkpoint.id)
            .await
            .expect("changes")
            .files
            .is_empty()
    );
}

#[tokio::test]
async fn changed_preview_is_rejected_before_any_file_is_modified() {
    let rig = rig();
    std::fs::write(rig.work.join("a.txt"), "old a").expect("a");
    std::fs::write(rig.work.join("b.txt"), "old b").expect("b");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    std::fs::write(rig.work.join("a.txt"), "new a").expect("a");
    std::fs::write(rig.work.join("b.txt"), "new b").expect("b");
    let preview = rig
        .service
        .preview_revert(
            &rig.chat,
            &rig.folder,
            &rig.work,
            &checkpoint.id,
            vec!["a.txt".into(), "b.txt".into()],
        )
        .await
        .expect("preview");
    std::fs::write(rig.work.join("b.txt"), "newest external b").expect("outside edit");
    assert!(
        rig.service
            .revert(&rig.chat, &rig.folder, &rig.work, &preview.token)
            .await
            .expect_err("stale")
            .to_string()
            .contains("changed after")
    );
    assert_eq!(
        std::fs::read_to_string(rig.work.join("a.txt")).expect("a kept"),
        "new a"
    );
    assert_eq!(
        std::fs::read_to_string(rig.work.join("b.txt")).expect("b kept"),
        "newest external b"
    );
    assert!(
        rig.service
            .revert(&rig.chat, &rig.folder, &rig.work, &preview.token)
            .await
            .is_err(),
        "token is one-use"
    );
}

#[tokio::test]
async fn agent_config_and_oversized_files_are_excluded_without_becoming_deletions() {
    let rig = rig();
    std::fs::create_dir(rig.work.join(".codex")).expect("owned config fixture");
    std::fs::write(
        rig.work.join(".codex/auth.json"),
        "fixture only, never read",
    )
    .expect("owned config fixture");
    std::fs::write(rig.work.join("grows.bin"), "small").expect("small");
    let checkpoint = rig
        .service
        .capture(&rig.chat, &rig.folder, &rig.work, &crate::ids::new_id())
        .await
        .expect("checkpoint");
    assert_eq!(checkpoint.file_count, 1);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(rig.work.join("grows.bin"))
        .expect("fixture file");
    file.set_len(scan::FILE_LIMIT as u64 + 1)
        .expect("grow owned file");
    drop(file);
    let changes = rig
        .service
        .changes(&rig.chat, &rig.folder, &rig.work, &checkpoint.id)
        .await
        .expect("changes");
    assert!(
        changes.files.is_empty(),
        "an excluded existing file is not a deletion"
    );
    assert!(!changes.checkpoint.expect("summary").warnings.is_empty());
    assert!(
        rig.service
            .preview_revert(
                &rig.chat,
                &rig.folder,
                &rig.work,
                &checkpoint.id,
                vec!["grows.bin".into()]
            )
            .await
            .is_err()
    );
}
