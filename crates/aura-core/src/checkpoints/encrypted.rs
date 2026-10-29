//! Account checkpoints never place file content or manifests in Git objects or scratch copies.
//! Git's empty temporary repository is used only for existing ignore/path discovery semantics.
use super::*;
use crate::profile::{Profile, ProfileKind};
use crate::profile_files::EncryptedFiles;
use aura_sync::crypto::files::{ProfileFileKey, Purpose};

impl Checkpoints {
    pub fn new_account(
        profile: &Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
        key: Arc<ProfileFileKey>,
    ) -> Result<Arc<Self>> {
        if profile.meta.kind != ProfileKind::Account {
            return Err(CheckpointError::Message(
                "An account checkpoint key requires an Account profile.".into(),
            ));
        }
        let root = profile.checkpoints_dir();
        let files = EncryptedFiles::open(&root, Purpose::Checkpoint, key)?;
        Ok(Arc::new(Self {
            root,
            worktrees: profile.worktrees_dir(),
            storage: Storage::Encrypted(files),
            env,
            registry,
            gate: Mutex::new(()),
            previews: std::sync::Mutex::new(Default::default()),
        }))
    }
}

pub(super) async fn capture(
    files: EncryptedFiles,
    chat_id: &str,
    folder_id: &str,
    root: PathBuf,
    turn_id: &str,
    paths: Vec<String>,
) -> Result<CheckpointSummary> {
    let chat_id = chat_id.to_owned();
    let folder_id = folder_id.to_owned();
    let turn_id = turn_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let scanned = scan::collect(&root, &paths, None)?;
        let mut saved = BTreeMap::new();
        for (path, expected) in scanned.files {
            let (fingerprint, bytes) = scan::read(&root, &path)?.ok_or_else(|| changed(&path))?;
            if fingerprint != expected {
                return Err(changed(&path));
            }
            let oid = fingerprint.sha256.clone();
            files.write(&oid, &bytes)?;
            saved.insert(path, SavedFile { fingerprint, oid });
        }
        let summary = CheckpointSummary {
            id: crate::ids::new_id(),
            turn_id,
            created_at: crate::time::now_millis(),
            file_count: saved.len() as u32,
            total_bytes: saved.values().map(|file| file.fingerprint.bytes).sum(),
            warnings: scanned.warnings,
        };
        let manifest = Manifest {
            version: 2,
            chat_id,
            folder_id,
            root,
            commit: String::new(),
            summary: summary.clone(),
            files: saved,
        };
        let bytes = serde_json::to_vec(&manifest).map_err(|_| {
            CheckpointError::Message("Could not encode the encrypted checkpoint.".into())
        })?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(CheckpointError::Message(
                "Checkpoint metadata exceeds its limit.".into(),
            ));
        }
        files.write(&format!("manifest-{}", summary.id), &bytes)?;
        Ok(summary)
    })
    .await
    .map_err(|_| {
        CheckpointError::Message("Encrypted checkpoint capture stopped unexpectedly.".into())
    })?
}

fn changed(path: &str) -> CheckpointError {
    CheckpointError::Message(format!(
        "{path} changed while saving the checkpoint. No prompt was sent; try again."
    ))
}

/// A truthful byte summary for visible handoffs. It is deliberately not a Git line-count stat:
/// generating a Git diff-tree would persist plaintext account contents in Git's object database.
pub(super) fn stat(manifest: &Manifest, current: &scan::Scan) -> String {
    let mut value = String::new();
    for file in changes(&manifest.files, &current.files)
        .into_iter()
        .filter(|file| !current.excluded.contains(&file.path))
    {
        if value.is_empty() {
            value.push_str("Changed files (byte sizes):\n");
        }
        let line = format!(
            "{} | {} -> {} bytes\n",
            file.path,
            file.before_bytes.unwrap_or(0),
            file.after_bytes.unwrap_or(0)
        );
        if value.len() + line.len() > 16 * 1024 - 64 {
            value.push_str("Additional changed files omitted from this summary.\n");
            break;
        }
        value.push_str(&line);
    }
    value.trim_end().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProfileMeta;
    use aura_process::{EnvSource, ResolvedEnv, process_env};
    use aura_sync::crypto::AccountKey;
    fn fixture(path: &Path) -> (Profile, Arc<EnvResolver>) {
        (
            Profile {
                meta: ProfileMeta {
                    id: "profile".into(),
                    kind: ProfileKind::Account,
                    display_name: "Account".into(),
                    created_at: 0,
                },
                dir: path.join("profile"),
            },
            EnvResolver::fixed(ResolvedEnv {
                vars: process_env(),
                source: EnvSource::Fallback {
                    reason: "encrypted checkpoint fixture".into(),
                },
                warnings: vec![],
                resolved_at_ms: 0,
            }),
        )
    }
    fn private_files(dir: &Path, secrets: &[&[u8]]) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                private_files(&entry.path(), secrets)?;
            } else {
                let bytes = std::fs::read(entry.path())?;
                for secret in secrets {
                    assert!(!bytes.windows(secret.len()).any(|part| part == *secret));
                }
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn encrypted_capture_diff_reopen_and_explicit_revert_preserve_bytes_without_plaintext_profile_copies()
     {
        let temp = tempfile::tempdir().unwrap();
        let (profile, env) = fixture(temp.path());
        let work = temp.path().join("work");
        std::fs::create_dir(&work).unwrap();
        std::fs::write(work.join(".gitignore"), "ignored\n").unwrap();
        std::fs::write(work.join("ignored"), "not captured").unwrap();
        std::fs::write(work.join(".env"), "never open this fixture").unwrap();
        let before = b"synthetic secret checkpoint\r\nsecond line\r\n";
        std::fs::write(work.join("private-name.txt"), before).unwrap();
        std::fs::write(work.join("binary"), [0, 128, 255]).unwrap();
        let key = Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        );
        let service = Checkpoints::new_account(
            &profile,
            env.clone(),
            LeftoverRegistry::disabled(),
            key.clone(),
        )
        .unwrap();
        let chat = crate::ids::new_id();
        let folder = crate::ids::new_id();
        let checkpoint = service
            .capture(&chat, &folder, &work, &crate::ids::new_id())
            .await
            .unwrap();
        assert_eq!(checkpoint.file_count, 3);
        assert!(!work.join(".git").exists());
        std::fs::write(work.join("private-name.txt"), "later external edit").unwrap();
        let change = service
            .diff(&chat, &folder, &work, &checkpoint.id, "private-name.txt")
            .await
            .unwrap();
        assert_eq!(change.before.unwrap().as_bytes(), before);
        assert_eq!(change.after.as_deref(), Some("later external edit"));
        let stat = service
            .diff_stat(&chat, &folder, &work, &checkpoint.id)
            .await
            .unwrap();
        assert!(stat.contains("byte sizes") && stat.contains("private-name.txt"));
        private_files(
            &profile.dir,
            &[
                before,
                b"private-name.txt",
                b"synthetic legacy only copy",
                b"later external edit",
                chat.as_bytes(),
            ],
        )
        .unwrap();
        drop(service);
        let service =
            Checkpoints::new_account(&profile, env, LeftoverRegistry::disabled(), key).unwrap();
        let legacy_token = crate::ids::new_id();
        let legacy = work.join(format!(".auracode-revert-{legacy_token}"));
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("original-0"), b"synthetic legacy only copy").unwrap();
        std::fs::write(legacy.join("recovery.json"), serde_json::to_vec(&serde_json::json!({"version":1,"checkpoint_id":checkpoint.id,"files":[{"path":"private-name.txt","backup":"original-0"}]})).unwrap()).unwrap();
        assert_eq!(
            service
                .changes(&chat, &folder, &work, &checkpoint.id)
                .await
                .unwrap()
                .files
                .len(),
            1
        );
        assert!(
            service
                .changes(&crate::ids::new_id(), &folder, &work, &checkpoint.id)
                .await
                .is_err()
        );
        let preview = service
            .preview_revert(
                &chat,
                &folder,
                &work,
                &checkpoint.id,
                vec!["private-name.txt".into()],
            )
            .await
            .unwrap();
        let result = service
            .revert(&chat, &folder, &work, &preview.token)
            .await
            .unwrap();
        assert!(result.error.is_none());
        assert_eq!(
            std::fs::read(work.join("private-name.txt")).unwrap(),
            before
        );
        // No plaintext copy stays in the profile or in the working folder after a complete revert.
        assert_eq!(result.recovery_paths.len(), 1);
        assert!(!legacy.exists());
        assert!(std::fs::read_dir(&work).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".auracode-revert-")
        }));
        assert!(
            service
                .changes(&chat, &folder, &work, &checkpoint.id)
                .await
                .unwrap()
                .files
                .is_empty()
        );
        private_files(
            &profile.dir,
            &[
                before,
                b"private-name.txt",
                b"synthetic legacy only copy",
                b"later external edit",
                chat.as_bytes(),
            ],
        )
        .unwrap();
        assert!(
            std::fs::read_dir(profile.checkpoints_dir())
                .unwrap()
                .filter(|e| e.as_ref().unwrap().file_type().unwrap().is_dir())
                .count()
                == 2
        );
    }

    #[tokio::test]
    async fn account_checkpoints_reject_plain_constructor_and_legacy_data_without_writing() {
        let temp = tempfile::tempdir().unwrap();
        let (profile, env) = fixture(temp.path());
        let work = temp.path().join("work");
        std::fs::create_dir(&work).unwrap();
        let service = Checkpoints::new(&profile, env.clone(), LeftoverRegistry::disabled());
        assert!(
            service
                .capture(
                    &crate::ids::new_id(),
                    &crate::ids::new_id(),
                    &work,
                    &crate::ids::new_id()
                )
                .await
                .is_err()
        );
        assert!(!profile.checkpoints_dir().exists());
        std::fs::create_dir_all(profile.checkpoints_dir()).unwrap();
        std::fs::write(
            profile.checkpoints_dir().join("legacy"),
            "preserved existing data",
        )
        .unwrap();
        let key = Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        );
        assert!(
            Checkpoints::new_account(&profile, env, LeftoverRegistry::disabled(), key).is_err()
        );
        assert_eq!(
            std::fs::read(profile.checkpoints_dir().join("legacy")).unwrap(),
            b"preserved existing data"
        );
    }
}
