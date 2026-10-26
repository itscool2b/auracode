//! Reverts use a one-use content-bound preview and retain original files for recovery.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use aura_protocol::changes::{RevertPreview, RevertResult};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};

use super::{CheckpointError, Checkpoints, Manifest, Result, changes, scan};
use scan::Fingerprint;

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
        let _guard = self.gate.lock().await;
        let manifest = self.load(chat_id, folder_id, folder, checkpoint_id)?;
        let operation = self.operation(folder_id, &manifest.root, false).await?;
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
        let _guard = self.gate.lock().await;
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
            || prepared.manifest.root != std::fs::canonicalize(folder)?
        {
            return Err(CheckpointError::Message(
                "This revert preview no longer matches the chat and folder.".into(),
            ));
        }
        let operation = self
            .operation(folder_id, &prepared.manifest.root, false)
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
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            apply(&prepared, &token, replacements)
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
) -> Result<RevertResult> {
    let root = &prepared.manifest.root;
    // Validate the entire selection before the first mutation. A changed byte, mode, type or
    // missing file invalidates the preview instead of silently replacing newer work.
    for (path, expected) in &prepared.current {
        let current = scan::read(root, path)?.map(|(fingerprint, _)| fingerprint);
        if &current != expected {
            return Err(stale(path));
        }
    }
    let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
    let backup_name = format!(".auracode-revert-{token}");
    directory.create_dir(&backup_name)?;
    let backup = directory.open_dir_nofollow(&backup_name)?;
    let manifest = serde_json::json!({ "version": 1, "checkpoint_id": prepared.manifest.summary.id,
        "files": prepared.current.keys().enumerate().map(|(index, path)| serde_json::json!({"path": path, "backup": format!("original-{index}")})).collect::<Vec<_>>() });
    let mut journal = backup.open_with(
        "recovery.json",
        OpenOptions::new().write(true).create_new(true),
    )?;
    journal.write_all(
        serde_json::to_string_pretty(&manifest)
            .map_err(|_| {
                CheckpointError::Message("Writing revert recovery metadata failed.".into())
            })?
            .as_bytes(),
    )?;
    journal.sync_all()?;
    let recovery_path = root.join(&backup_name).to_string_lossy().into_owned();
    let mut result = RevertResult {
        applied: Vec::new(),
        error: None,
        recovery_paths: vec![recovery_path],
    };
    for (index, (path, expected)) in prepared.current.iter().enumerate() {
        let replacement = replacements.get(path).and_then(Option::as_ref);
        match apply_file(
            &directory,
            &backup,
            root,
            path,
            index,
            expected.as_ref(),
            replacement,
        ) {
            Ok(()) => result.applied.push(path.clone()),
            Err(error) => {
                result.error = Some(error.to_string());
                break;
            }
        }
    }
    Ok(result)
}

fn apply_file(
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
    use super::*;

    #[test]
    fn an_edit_between_validation_and_rename_is_retained_and_restored() {
        let temp = tempfile::tempdir().expect("owned fixture");
        let root = temp.path();
        std::fs::write(root.join("file"), "previewed").expect("initial");
        let expected = scan::read(root, "file")
            .expect("fingerprint")
            .expect("file")
            .0;
        std::fs::write(root.join("file"), "new external work").expect("external edit");
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority()).expect("root");
        directory.create_dir("backup").expect("backup");
        let backup = directory.open_dir("backup").expect("backup handle");
        assert!(apply_file(&directory, &backup, root, "file", 0, Some(&expected), None).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("file")).expect("restored"),
            "new external work"
        );
        assert_eq!(
            backup
                .read_to_string("original-0")
                .expect("backup retained"),
            "new external work"
        );
    }
}
