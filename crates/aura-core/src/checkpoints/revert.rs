//! Reverts use a one-use content-bound preview and retain original files for recovery.
//!
//! Selected originals and a recovery manifest reach private durable storage before mutation.
//! The transient same-volume swap verifies the actual renamed file before publishing replacement
//! bytes. Finalization copies and verifies any surviving swap objects before removing them.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use aura_protocol::changes::{RevertPreview, RevertResult};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};

use super::{CheckpointError, Checkpoints, Manifest, Result, changes, coordination, scan};
use scan::Fingerprint;

/// The name a revert's working folder takes at the root of the folder it reverts.
pub(super) const STAGING_PREFIX: &str = ".auracode-revert-";

pub(super) struct Prepared {
    manifest: Manifest,
    current: BTreeMap<String, Option<Fingerprint>>,
    expires: Instant,
}

impl Checkpoints {
    /// Empty selection is rejected. A caller must explicitly select the files it shows the user.
    pub async fn preview_revert(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        checkpoint_id: &str,
        mut paths: Vec<String>,
    ) -> Result<RevertPreview> {
        if paths.is_empty() || paths.len() > 20_000 {
            return Err(CheckpointError::Message(
                "Select at least one changed file to revert.".into(),
            ));
        }
        for path in &paths {
            scan::validate(path)?;
        }
        paths.sort();
        paths.dedup();
        let root = std::fs::canonicalize(folder)?;
        let owner = coordination::acquire(&self.root, folder_id, &root).await?;
        let context = owner.context();
        let manifest = self.load(chat_id, folder_id, folder, checkpoint_id)?;
        if manifest.root != root {
            return Err(CheckpointError::Message(
                "The checkpoint folder changed while waiting. Refresh Changes.".into(),
            ));
        }
        let operation = self
            .operation(folder_id, &manifest.root, false, context.clone())
            .await?;
        self.sweep_reverts(&manifest.root, chat_id, folder_id, &context)
            .await?;
        let current = self.current(&operation, &manifest).await?;
        let changed = changes(&manifest.files, &current.files);
        let mut files = Vec::new();
        let mut fingerprints = BTreeMap::new();
        for path in &paths {
            if current.excluded.contains(path) {
                return Err(CheckpointError::Message(format!(
                    "{path} cannot be safely inspected and cannot be reverted."
                )));
            }
            let change = changed
                .iter()
                .find(|file| &file.path == path)
                .ok_or_else(|| {
                    CheckpointError::Message(format!(
                        "{path} is no longer changed. Refresh Changes."
                    ))
                })?;
            files.push(change.clone());
            fingerprints.insert(path.clone(), current.files.get(path).cloned());
        }
        let token = crate::ids::new_id();
        let mut warnings = manifest.summary.warnings.clone();
        warnings.push("This restores the selected checkpoint bytes, including edits made outside the agent. Review each selected file before reverting.".into());
        let expires = Instant::now() + Duration::from_secs(10 * 60);
        let mut previews = self
            .previews
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        previews.retain(|_, preview| preview.expires > Instant::now());
        if previews.len() >= 32 {
            return Err(CheckpointError::Message(
                "Too many revert previews are open. Close an older preview or try again later."
                    .into(),
            ));
        }
        previews.insert(
            token.clone(),
            Prepared {
                manifest,
                current: fingerprints,
                expires,
            },
        );
        Ok(RevertPreview {
            token,
            checkpoint_id: checkpoint_id.into(),
            files,
            expires_at: crate::time::now_millis().saturating_add(10 * 60 * 1000),
            warnings,
        })
    }

    /// A token is consumed once, including on failure. The UI must refresh after any failure.
    pub async fn revert(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        token: &str,
    ) -> Result<RevertResult> {
        self.revert_guarded(chat_id, folder_id, folder, token, ())
            .await
    }

    pub(crate) async fn revert_guarded<G: Send + 'static>(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        token: &str,
        guard: G,
    ) -> Result<RevertResult> {
        super::valid_id(token)?;
        let root = std::fs::canonicalize(folder)?;
        let owner = coordination::acquire(&self.root, folder_id, &root).await?;
        let context = owner.context();
        let prepared = self
            .previews
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(token)
            .ok_or_else(|| {
                CheckpointError::Message(
                    "This revert preview expired or was already used. Refresh Changes.".into(),
                )
            })?;
        if prepared.expires <= Instant::now()
            || prepared.manifest.chat_id != chat_id
            || prepared.manifest.folder_id != folder_id
            || prepared.manifest.root != root
            || prepared.manifest.root != std::fs::canonicalize(folder)?
        {
            return Err(CheckpointError::Message(
                "This revert preview no longer matches the chat and folder.".into(),
            ));
        }
        let operation = self
            .operation(folder_id, &prepared.manifest.root, false, context.clone())
            .await?;
        let mut replacements = BTreeMap::new();
        for path in prepared.current.keys() {
            let bytes = match prepared.manifest.files.get(path) {
                Some(file) => Some((
                    file.fingerprint.clone(),
                    self.blob(&operation, &prepared.manifest.root, file).await?,
                )),
                None => None,
            };
            replacements.insert(path.clone(), bytes);
        }
        let token = token.to_owned();
        let keep = self.recovery_store()?;
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            // Keep both session admission and checkpoint ownership until apply/recovery ends,
            // even if the caller stops awaiting this blocking task.
            let _context = context;
            _context.check()?;
            apply(&prepared, &token, replacements, &keep)
        })
        .await
        .map_err(|_| {
            CheckpointError::Message(
                "The revert operation stopped unexpectedly. Check the folder's recovery directory."
                    .into(),
            )
        })?
    }
}

type Replacement = Option<(Fingerprint, Vec<u8>)>;

fn apply(
    prepared: &Prepared,
    token: &str,
    replacements: BTreeMap<String, Replacement>,
    keep: &super::recovery::Store,
) -> Result<RevertResult> {
    apply_with(prepared, token, replacements, keep, || {})
}

fn apply_with(
    prepared: &Prepared,
    token: &str,
    replacements: BTreeMap<String, Replacement>,
    keep: &super::recovery::Store,
    before_swap: impl FnOnce(),
) -> Result<RevertResult> {
    let root = &prepared.manifest.root;
    // Validate and save every selected original before the first working-folder mutation.
    let mut originals = BTreeMap::new();
    for (path, expected) in &prepared.current {
        let current = scan::read(root, path)?;
        if &current.as_ref().map(|(fingerprint, _)| fingerprint.clone()) != expected {
            return Err(stale(path));
        }
        originals.insert(path.clone(), current);
    }
    let mut result = RevertResult {
        applied: Vec::new(),
        error: None,
        recovery_paths: Vec::new(),
    };
    let operation = (|| -> Result<()> {
        let group = keep.group(token)?;
        result
            .recovery_paths
            .push(keep.path(token).to_string_lossy().into_owned());
        let journal = super::recovery::Journal::new(&prepared.manifest, token, &prepared.current);
        for (index, (_, original)) in originals.iter().enumerate() {
            if let Some((_, bytes)) = original {
                group.write(&format!("original-{index}"), bytes)?;
            }
        }
        let encoded = serde_json::to_vec(&journal).map_err(std::io::Error::other)?;
        group.write("recovery.json", &encoded)?;
        before_swap();
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
        let backup_name = format!("{STAGING_PREFIX}{token}");
        let builder = cap_std::fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use cap_std::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        directory.create_dir_with(&backup_name, &builder)?;
        // Every error after creation, including journal writes and opening the swap, is finalized.
        let mutation = (|| -> Result<()> {
            let backup = directory.open_dir_nofollow(&backup_name)?;
            super::recovery::write_new(&backup, "recovery.json", &encoded)?;
            for (index, (path, expected)) in prepared.current.iter().enumerate() {
                apply_file(
                    &directory,
                    &backup,
                    root,
                    path,
                    index,
                    expected.as_ref(),
                    replacements.get(path).and_then(Option::as_ref),
                )?;
                result.applied.push(path.clone());
            }
            Ok(())
        })();
        if let Err(error) = mutation {
            super::recovery::error(&mut result, error);
        }
        super::recovery::settle(&directory, &backup_name, &journal, &group, &mut result);
        Ok(())
    })();
    if let Err(error) = operation {
        super::recovery::error(&mut result, error);
    }
    Ok(result)
}

pub(crate) fn apply_file(
    root_dir: &Dir,
    backup: &Dir,
    root: &Path,
    path: &str,
    index: usize,
    expected: Option<&Fingerprint>,
    replacement: Option<&(Fingerprint, Vec<u8>)>,
) -> Result<()> {
    scan::checked_path(root, path)?;
    let mut parent = root_dir.try_clone()?;
    if let Some(ancestors) = Path::new(path).parent() {
        for component in ancestors.components() {
            let name = component.as_os_str();
            if replacement.is_some() {
                match parent.create_dir(name) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            parent = parent.open_dir_nofollow(name)?;
        }
    }
    let name = Path::new(path).file_name().ok_or_else(|| stale(path))?;
    let original = format!("original-{index}");
    let restored = format!("replacement-{index}");
    if let Some((fingerprint, bytes)) = replacement {
        let mut file =
            backup.open_with(&restored, OpenOptions::new().write(true).create_new(true))?;
        file.write_all(bytes)?;
        #[cfg(unix)]
        {
            use cap_std::fs::PermissionsExt;
            file.set_permissions(cap_std::fs::Permissions::from_mode(
                fingerprint.mode & 0o777,
            ))?;
        }
        #[cfg(not(unix))]
        let _ = fingerprint;
        file.sync_all()?;
    }
    if let Some(expected) = expected {
        // Move aside first, then inspect the object actually removed from the name. Newer work is
        // retained even if another editor changed the file between preview validation and rename.
        parent.rename(name, backup, &original)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let saved = backup.open_with(&original, &options)?.into_std();
        let meta = saved.metadata()?;
        let mut bytes = Vec::new();
        saved
            .take(scan::FILE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)?;
        let hash = crate::chatstore::rows::hex(&Sha256::digest(&bytes));
        #[cfg(unix)]
        let mode_changed = {
            use std::os::unix::fs::PermissionsExt;
            (meta.permissions().mode() & 0o111 != 0) != (expected.mode & 0o111 != 0)
        };
        #[cfg(not(unix))]
        let mode_changed = false;
        if !meta.is_file()
            || hash != expected.sha256
            || bytes.len() != expected.bytes as usize
            || mode_changed
        {
            let _ = backup.hard_link(&original, &parent, name);
            return Err(stale(path));
        }
    }
    if replacement.is_some() {
        // Hard-link publication is atomic and refuses to replace a path another writer created.
        // The complete original and replacement remain in the recovery directory on any failure.
        if let Err(error) = backup.hard_link(&restored, &parent, name) {
            if expected.is_some() {
                let _ = backup.hard_link(&original, &parent, name);
            }
            return Err(error.into());
        }
    }
    Ok(())
}

fn stale(path: &str) -> CheckpointError {
    CheckpointError::Message(format!(
        "{path} changed after the preview. No newer file was overwritten; refresh Changes before retrying."
    ))
}

#[cfg(test)]
mod tests {
    use super::super::recovery::Store;
    use super::*;
    use aura_protocol::changes::CheckpointSummary;

    fn prepared(root: &Path) -> Prepared {
        let current = ["a", "b"]
            .into_iter()
            .map(|path| {
                (
                    path.into(),
                    scan::read(root, path).unwrap().map(|(fp, _)| fp),
                )
            })
            .collect();
        Prepared {
            manifest: Manifest {
                version: 1,
                chat_id: crate::ids::new_id(),
                folder_id: crate::ids::new_id(),
                root: root.canonicalize().unwrap(),
                commit: String::new(),
                files: BTreeMap::new(),
                summary: CheckpointSummary {
                    id: crate::ids::new_id(),
                    turn_id: crate::ids::new_id(),
                    created_at: 0,
                    file_count: 0,
                    total_bytes: 0,
                    warnings: vec![],
                },
            },
            current,
            expires: Instant::now() + Duration::from_secs(60),
        }
    }
    fn encrypted_variants() -> Vec<bool> {
        #[cfg(feature = "account-sync")]
        {
            vec![false, true]
        }
        #[cfg(not(feature = "account-sync"))]
        {
            vec![false]
        }
    }
    fn no_plaintext(root: &Path, needle: &[u8]) {
        for entry in std::fs::read_dir(root).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                no_plaintext(&entry.path(), needle)
            } else {
                assert!(
                    !std::fs::read(entry.path())
                        .unwrap()
                        .windows(needle.len())
                        .any(|bytes| bytes == needle)
                );
            }
        }
    }

    #[test]
    fn durable_originals_precede_mutation_for_local_and_account_success_and_partial_failure() {
        for encrypted in encrypted_variants() {
            for partial in [false, true] {
                let temp = tempfile::tempdir().unwrap();
                let root = temp.path().join("work");
                std::fs::create_dir(&root).unwrap();
                std::fs::write(root.join("a"), "private original a").unwrap();
                std::fs::write(root.join("b"), "private original b").unwrap();
                let prepared = prepared(&root);
                let token = crate::ids::new_id();
                let store = Store::fixture(temp.path().join("durable"), encrypted);
                // Removal uses the same verified swap as replacement publication.
                let result = apply_with(&prepared, &token, BTreeMap::new(), &store, || {
                    let group = store.group(&token).unwrap();
                    assert_eq!(group.read("original-0"), b"private original a");
                    assert_eq!(group.read("original-1"), b"private original b");
                    assert!(!group.read("recovery.json").is_empty());
                    assert!(root.join("a").exists());
                    if partial {
                        std::fs::write(root.join("b"), "private newer b").unwrap();
                    }
                })
                .unwrap();
                assert_eq!(result.error.is_some(), partial, "{:?}", result.error);
                assert_eq!(result.applied.len(), if partial { 1 } else { 2 });
                assert!(!root.join(format!("{STAGING_PREFIX}{token}")).exists());
                if partial {
                    assert_eq!(std::fs::read(root.join("b")).unwrap(), b"private newer b");
                }
                assert_eq!(
                    result.recovery_paths,
                    vec![store.path(&token).to_string_lossy().into_owned()]
                );
                let group = store.group(&token).unwrap();
                let catalog: serde_json::Value =
                    serde_json::from_slice(&group.read("saved-recovery.json")).unwrap();
                let original = catalog
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|item| item["source"] == "original-1")
                    .unwrap();
                assert_eq!(
                    group.read(original["object"].as_str().unwrap()),
                    if partial {
                        b"private newer b".as_slice()
                    } else {
                        b"private original b".as_slice()
                    }
                );
                if encrypted {
                    no_plaintext(&store.path(&token), b"private");
                    no_plaintext(&store.path(&token), b"checkpoint_id");
                }
            }
        }
    }

    #[test]
    fn failed_durable_write_stops_before_any_working_file_mutation() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("a"), "original a").unwrap();
        std::fs::write(temp.path().join("b"), "original b").unwrap();
        let prepared = prepared(temp.path());
        let token = crate::ids::new_id();
        let blocked = temp.path().join("blocked");
        std::fs::write(&blocked, "not a storage folder").unwrap();
        let store = Store::fixture(blocked, false);
        let result = apply(&prepared, &token, BTreeMap::new(), &store).unwrap();
        assert!(result.error.is_some());
        assert!(result.applied.is_empty());
        assert_eq!(std::fs::read(temp.path().join("a")).unwrap(), b"original a");
        assert_eq!(std::fs::read(temp.path().join("b")).unwrap(), b"original b");
        assert!(
            !temp
                .path()
                .join(format!("{STAGING_PREFIX}{token}"))
                .exists()
        );
    }

    #[test]
    fn existing_recovery_object_write_failure_never_mutates_local_or_account_work() {
        for encrypted in encrypted_variants() {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("work");
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("a"), "original a").unwrap();
            std::fs::write(root.join("b"), "original b").unwrap();
            let prepared = prepared(&root);
            let token = crate::ids::new_id();
            let store = Store::fixture(temp.path().join("durable"), encrypted);
            let group = store.group(&token).unwrap();
            group
                .write("original-0", b"immutable different original")
                .unwrap();
            let outcome = apply(&prepared, &token, BTreeMap::new(), &store).unwrap();
            assert!(outcome.error.is_some());
            assert!(outcome.applied.is_empty());
            assert_eq!(group.read("original-0"), b"immutable different original");
            assert_eq!(std::fs::read(root.join("a")).unwrap(), b"original a");
            assert_eq!(std::fs::read(root.join("b")).unwrap(), b"original b");
            assert!(!root.join(format!("{STAGING_PREFIX}{token}")).exists());
        }
    }

    #[test]
    fn concurrent_new_path_prevents_replacement_publication() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        std::fs::write(root.join("a"), "original").unwrap();
        std::fs::write(root.join("b"), "replacement").unwrap();
        let replacement = scan::read(root, "b").unwrap().unwrap();
        std::fs::remove_file(root.join("b")).unwrap();
        let prepared = prepared(root);
        let token = crate::ids::new_id();
        let store = Store::fixture(root.join("durable"), false);
        let result = apply_with(
            &prepared,
            &token,
            BTreeMap::from([("b".into(), Some(replacement))]),
            &store,
            || {
                std::fs::write(root.join("b"), "concurrent writer").unwrap();
            },
        )
        .unwrap();
        assert!(result.error.is_some());
        assert_eq!(std::fs::read(root.join("b")).unwrap(), b"concurrent writer");
        assert!(!root.join(format!("{STAGING_PREFIX}{token}")).exists());
    }
}
