//! Durable, content-verified revert recovery. Never infer ownership from a UUID directory name.
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use aura_protocol::changes::RevertResult;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::revert::STAGING_PREFIX;
use super::{CheckpointError, Checkpoints, Manifest, Result, Storage, scan};
use scan::Fingerprint;

const JOURNAL_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct Store {
    root: PathBuf,
    #[cfg(feature = "account-sync")]
    encrypted: Option<crate::profile_files::EncryptedFiles>,
}
pub(super) struct Group {
    #[cfg(feature = "account-sync")]
    token: String,
    local: Option<Dir>,
    #[cfg(feature = "account-sync")]
    encrypted: Option<crate::profile_files::EncryptedFiles>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Journal {
    version: u32,
    checkpoint_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    root: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    files: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    backup: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<Fingerprint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replacement: Option<Fingerprint>,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Saved {
    source: String,
    object: String,
    sha256: String,
    bytes: usize,
}

impl Journal {
    pub(super) fn new(
        manifest: &Manifest,
        token: &str,
        selected: &BTreeMap<String, Option<Fingerprint>>,
    ) -> Self {
        Self {
            version: 2,
            checkpoint_id: manifest.summary.id.clone(),
            root: Some(manifest.root.clone()),
            token: Some(token.into()),
            files: selected
                .iter()
                .enumerate()
                .map(|(index, (path, fingerprint))| Entry {
                    path: path.clone(),
                    backup: format!("original-{index}"),
                    fingerprint: fingerprint.clone(),
                    replacement: manifest
                        .files
                        .get(path)
                        .map(|saved| saved.fingerprint.clone()),
                })
                .collect(),
        }
    }
    fn validate(&self, root: &Path, token: &str) -> Result<()> {
        super::valid_id(&self.checkpoint_id)?;
        if !matches!(self.version, 1 | 2)
            || self.files.is_empty()
            || self.files.len() > 20_000
            || (self.version == 2
                && (self.root.as_deref() != Some(root) || self.token.as_deref() != Some(token)))
            || (self.version == 1 && (self.root.is_some() || self.token.is_some()))
        {
            return Err(invalid("The revert recovery manifest is invalid."));
        }
        let mut paths = BTreeSet::new();
        for (index, entry) in self.files.iter().enumerate() {
            scan::validate(&entry.path)?;
            if !paths.insert(&entry.path) || entry.backup != format!("original-{index}") {
                return Err(invalid("The revert recovery entries are invalid."));
            }
        }
        Ok(())
    }
    fn names(&self) -> BTreeSet<String> {
        let mut names = BTreeSet::from(["recovery.json".into()]);
        for (index, entry) in self.files.iter().enumerate() {
            names.insert(entry.backup.clone());
            names.insert(format!("replacement-{index}"));
        }
        names
    }
}

impl Checkpoints {
    pub(super) fn recovery_store(&self) -> Result<Store> {
        if matches!(self.storage, Storage::Locked) {
            return Err(invalid("Unlock the account before saving revert recovery."));
        }
        Ok(Store {
            root: match self.storage {
                Storage::Local => self.root.join("reverts"),
                _ => self.root.clone(),
            },
            #[cfg(feature = "account-sync")]
            encrypted: match &self.storage {
                Storage::Encrypted(files) => Some(files.clone()),
                Storage::Local => None,
                Storage::Locked => {
                    return Err(invalid("Unlock the account before saving revert recovery."));
                }
            },
        })
    }

    /// Recovery is scoped to a known checkpoint in this chat, folder and canonical root. Invalid
    /// folders, unrelated names and links stay untouched. A validated migration failure is visible.
    pub(super) async fn sweep_reverts(&self, root: &Path, chat: &str, folder: &str) -> Result<()> {
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
        for entry in directory.entries()? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(token) = name
                .to_str()
                .and_then(|name| name.strip_prefix(STAGING_PREFIX))
            else {
                continue;
            };
            if !uuid::Uuid::parse_str(token).is_ok_and(|id| id.to_string() == token)
                || !entry.file_type()?.is_dir()
            {
                continue;
            }
            let Ok(stage) = directory.open_dir_nofollow(&name) else {
                continue;
            };
            let Ok(bytes) = read_regular(&stage, "recovery.json", JOURNAL_LIMIT) else {
                continue;
            };
            let Ok(journal) = serde_json::from_slice::<Journal>(&bytes) else {
                continue;
            };
            if journal.validate(root, token).is_err() || expected_entries(&stage, &journal).is_err()
            {
                continue;
            }
            let Ok(checkpoint) = self.load(chat, folder, root, &journal.checkpoint_id) else {
                continue;
            };
            if journal.files.iter().any(|entry| {
                if journal.version == 1 {
                    entry.fingerprint.is_some() || entry.replacement.is_some()
                } else {
                    entry.replacement.as_ref()
                        != checkpoint
                            .files
                            .get(&entry.path)
                            .map(|saved| &saved.fingerprint)
                }
            }) {
                continue;
            }
            drop(stage);
            let store = self.recovery_store()?;
            let token = token.to_owned();
            let name = name
                .into_string()
                .map_err(|_| invalid("Invalid recovery name."))?;
            let directory = directory.try_clone()?;
            tokio::task::spawn_blocking(move || -> Result<()> {
                let group = store.group(&token)?;
                // Preserve the exact validated legacy journal and the copy's content catalog.
                group.write("recovery.json", &bytes)?;
                let mut result = RevertResult {
                    applied: vec![],
                    error: None,
                    recovery_paths: vec![],
                };
                settle(&directory, &name, &journal, &group, &mut result);
                match result.error {
                    Some(error) => Err(CheckpointError::Message(error)),
                    None => Ok(()),
                }
            })
            .await
            .map_err(|_| {
                invalid("Legacy revert recovery stopped; surviving copies were preserved.")
            })??;
        }
        Ok(())
    }
}

impl Store {
    pub(super) fn path(&self, token: &str) -> PathBuf {
        self.root.join(token)
    }
    pub(super) fn group(&self, token: &str) -> Result<Group> {
        super::valid_id(token)?;
        #[cfg(feature = "account-sync")]
        if let Some(files) = &self.encrypted {
            let child = match files.child(token, true) {
                Ok(child) => child,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    files.child(token, false)?
                }
                Err(error) => return Err(error.into()),
            };
            return Ok(Group {
                token: token.into(),
                local: None,
                encrypted: Some(child),
            });
        }
        crate::fsutil::create_private_dir_all(&self.root)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let parent = Dir::open_ambient_dir(&self.root, cap_std::ambient_authority())?;
        let builder = cap_std::fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use cap_std::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        match parent.create_dir_with(token, &builder) {
            Ok(()) => sync(&parent)?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        Ok(Group {
            #[cfg(feature = "account-sync")]
            token: token.into(),
            local: Some(parent.open_dir_nofollow(token)?),
            #[cfg(feature = "account-sync")]
            encrypted: None,
        })
    }
}
impl Group {
    #[cfg(feature = "account-sync")]
    fn id(&self, name: &str) -> String {
        format!(
            "revert-{}-{}",
            self.token,
            crate::chatstore::rows::hex(&Sha256::digest(name.as_bytes()))
        )
    }
    pub(super) fn write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        #[cfg(feature = "account-sync")]
        if let Some(files) = &self.encrypted {
            let id = self.id(name);
            files.write(&id, bytes)?;
            if files.read(&id, bytes.len())? != bytes {
                return Err(invalid("Encrypted recovery verification failed."));
            }
            return Ok(());
        }
        let dir = self
            .local
            .as_ref()
            .ok_or_else(|| invalid("Recovery storage is unavailable."))?;
        match read_regular(dir, name, bytes.len()) {
            Ok(existing) if existing == bytes => return Ok(()),
            Ok(_) => return Err(invalid("Existing recovery data differs; it was preserved.")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let temporary = format!(".{}.partial", crate::ids::new_id());
        let published = (|| -> io::Result<()> {
            write_new(dir, &temporary, bytes)?;
            dir.hard_link(&temporary, dir, name)?;
            sync(dir)
        })();
        let removed = dir.remove_file(&temporary);
        published?;
        removed?;
        sync(dir)?;
        if read_regular(dir, name, bytes.len())? != bytes {
            return Err(invalid(
                "Recovery verification failed; existing data was preserved.",
            ));
        }
        Ok(())
    }
    fn read_optional(&self, name: &str) -> Result<Option<Vec<u8>>> {
        #[cfg(feature = "account-sync")]
        if let Some(files) = &self.encrypted {
            return match files.read(&self.id(name), JOURNAL_LIMIT) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(error.into()),
            };
        }
        match read_regular(
            self.local
                .as_ref()
                .ok_or_else(|| invalid("Recovery storage is unavailable."))?,
            name,
            JOURNAL_LIMIT,
        ) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
    fn catalog(&self, saved: &[Saved]) -> Result<()> {
        // Fixed, bounded generation names remain discoverable after an interrupted cleanup.
        for index in 0..32 {
            let name = if index == 0 {
                "saved-recovery.json".into()
            } else {
                format!("saved-recovery-{index}.json")
            };
            if let Some(bytes) = self.read_optional(&name)? {
                let existing: Vec<Saved> =
                    serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                if saved.iter().all(|item| existing.contains(item)) {
                    return Ok(());
                }
            } else {
                let catalog = serde_json::to_vec(saved).map_err(io::Error::other)?;
                return self.write(&name, &catalog);
            }
        }
        Err(invalid(
            "Recovery cleanup reached its retry limit; source copies were preserved.",
        ))
    }
}

pub(super) fn write_new(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = dir.open_with(name, &options)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync(dir)
}
fn sync(dir: &Dir) -> io::Result<()> {
    #[cfg(unix)]
    dir.try_clone()?.into_std_file().sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}
fn read_regular(dir: &Dir, name: &str, limit: usize) -> io::Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = dir.open_with(name, &options)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err(io::Error::other(
            "Recovery object is not a bounded regular file.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::other("Recovery object exceeds its limit."));
    }
    Ok(bytes)
}
fn expected_entries(stage: &Dir, journal: &Journal) -> Result<()> {
    let allowed = journal.names();
    let mut total = 0;
    for entry in stage.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| invalid("Invalid recovery entry."))?;
        if !allowed.contains(&name) || !entry.file_type()?.is_file() {
            return Err(invalid("Unexpected recovery entry; nothing was removed."));
        }
        let size = stage.symlink_metadata(&name)?.len();
        let limit = if name == "recovery.json" {
            JOURNAL_LIMIT
        } else {
            scan::FILE_LIMIT
        };
        if size > limit as u64 {
            return Err(invalid("Recovery object exceeds its size limit."));
        }
        total += size;
        if total > (2 * scan::TOTAL_LIMIT + JOURNAL_LIMIT) as u64 {
            return Err(invalid("Recovery directory exceeds its size limit."));
        }
    }
    Ok(())
}
fn inspect(stage: &Dir, journal: &Journal) -> Result<BTreeMap<String, Vec<u8>>> {
    let allowed = journal.names();
    let mut files = BTreeMap::new();
    let mut total = 0;
    for entry in stage.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| invalid("Invalid recovery entry."))?;
        if !allowed.contains(&name) || !entry.file_type()?.is_file() {
            return Err(invalid("Unexpected recovery entry; nothing was removed."));
        }
        let bytes = read_regular(
            stage,
            &name,
            if name == "recovery.json" {
                JOURNAL_LIMIT
            } else {
                scan::FILE_LIMIT
            },
        )?;
        total += bytes.len();
        if total > 2 * scan::TOTAL_LIMIT + JOURNAL_LIMIT {
            return Err(invalid("Recovery directory exceeds its size limit."));
        }
        files.insert(name, bytes);
    }
    Ok(files)
}

/// The destination may be on another volume. Copy, verify and sync every object and the content
/// catalog before unlinking any source. All source operations stay relative to open capabilities.
pub(super) fn settle(
    root: &Dir,
    name: &str,
    journal: &Journal,
    group: &Group,
    result: &mut RevertResult,
) {
    let mut durable = false;
    let finalized = (|| -> Result<()> {
        let stage = root.open_dir_nofollow(name)?;
        let files = inspect(&stage, journal)?;
        let mut saved = Vec::new();
        for (source, bytes) in &files {
            let hash = crate::chatstore::rows::hex(&Sha256::digest(bytes));
            let object = format!("saved-{source}-{hash}");
            group.write(&object, bytes)?;
            saved.push(Saved {
                source: source.clone(),
                object,
                sha256: hash,
                bytes: bytes.len(),
            });
        }
        group.catalog(&saved)?;
        durable = true;
        // Recheck the entire set before removal. No remove_dir_all, including on errors.
        if inspect(&stage, journal)? != files {
            return Err(invalid(
                "Recovery files changed during finalization; source copies were preserved.",
            ));
        }
        for (source, bytes) in files
            .iter()
            .filter(|(name, _)| name.as_str() != "recovery.json")
            .chain(files.get_key_value("recovery.json"))
        {
            if read_regular(&stage, source, bytes.len())? != *bytes {
                return Err(invalid("Recovery file changed before cleanup."));
            }
            same_directory(root, name, &stage)?;
            stage.remove_file(source)?;
        }
        sync(&stage)?;
        same_directory(root, name, &stage)?;
        drop(stage);
        root.remove_dir(name)?;
        sync(root)?;
        Ok(())
    })();
    if let Err(cause) = finalized {
        // If storage failed, attempt no-clobber restoration of any only surviving originals.
        // Preserve the stage when another writer owns the path or its content cannot be saved.
        if !durable && let Ok(stage) = root.open_dir_nofollow(name) {
            for (index, entry) in journal.files.iter().enumerate() {
                if read_regular(&stage, &entry.backup, scan::FILE_LIMIT).is_ok()
                    && let Ok(parent) = parent(root, &entry.path)
                    && let Some(file) = Path::new(&entry.path).file_name()
                    && restore_original(&stage, &entry.backup, &parent, file).unwrap_or(false)
                {
                    result.applied.retain(|path| path != &entry.path);
                    let _ = stage.remove_file(&entry.backup);
                }
                // Replacement bytes matching the checkpoint already have a durable source.
                let replacement = format!("replacement-{index}");
                if let Some(expected) = &entry.replacement
                    && let Ok(bytes) = read_regular(&stage, &replacement, scan::FILE_LIMIT)
                    && bytes.len() == expected.bytes as usize
                    && crate::chatstore::rows::hex(&Sha256::digest(&bytes)) == expected.sha256
                {
                    let _ = stage.remove_file(&replacement);
                }
            }
            if stage.entries().is_ok_and(|entries| {
                entries
                    .into_iter()
                    .all(|entry| entry.is_ok_and(|entry| entry.file_name() == "recovery.json"))
            }) {
                let _ = stage.remove_file("recovery.json");
                drop(stage);
                let _ = root.remove_dir(name);
            }
        }
        let recovery = match root.canonicalize(name) {
            Ok(path) => {
                result
                    .recovery_paths
                    .push(path.to_string_lossy().into_owned());
                format!(
                    "Surviving recovery data was preserved in {name}; inspect it before retrying."
                )
            }
            Err(_) => {
                "Surviving originals were retained or restored without replacing newer work.".into()
            }
        };
        error(
            result,
            format!("Revert recovery could not be finalized: {cause}. {recovery}"),
        );
    }
}
fn restore_original(
    stage: &Dir,
    backup: &str,
    parent: &Dir,
    name: &std::ffi::OsStr,
) -> io::Result<bool> {
    match stage.hard_link(backup, parent, name) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let mut options = OpenOptions::new();
            options.read(true).follow(FollowSymlinks::No);
            let saved =
                same_file::Handle::from_file(stage.open_with(backup, &options)?.into_std())?;
            let current =
                same_file::Handle::from_file(parent.open_with(name, &options)?.into_std())?;
            Ok(saved == current)
        }
        Err(error) => Err(error),
    }
}
fn same_directory(root: &Dir, name: &str, held: &Dir) -> Result<()> {
    let retained = same_file::Handle::from_file(held.try_clone()?.into_std_file())?;
    let current = same_file::Handle::from_file(root.open_dir_nofollow(name)?.into_std_file())?;
    if retained != current {
        return Err(invalid(
            "The recovery directory moved during cleanup; surviving copies were preserved.",
        ));
    }
    Ok(())
}
fn parent(root: &Dir, path: &str) -> io::Result<Dir> {
    let mut dir = root.try_clone()?;
    if let Some(parent) = Path::new(path).parent() {
        for component in parent.components() {
            dir = dir.open_dir_nofollow(component.as_os_str())?;
        }
    }
    Ok(dir)
}
pub(super) fn error(result: &mut RevertResult, cause: impl std::fmt::Display) {
    let message = cause.to_string();
    match &mut result.error {
        Some(error) => {
            error.push_str("; ");
            error.push_str(&message);
        }
        None => result.error = Some(message),
    }
}
fn invalid(message: &str) -> CheckpointError {
    CheckpointError::Message(message.into())
}
#[cfg(test)]
impl Store {
    pub(super) fn fixture(root: PathBuf, encrypted: bool) -> Self {
        #[cfg(feature = "account-sync")]
        if encrypted {
            use aura_sync::crypto::{AccountKey, files::Purpose};
            let key = std::sync::Arc::new(
                AccountKey::generate()
                    .unwrap()
                    .profile_file_key("account", "profile")
                    .unwrap(),
            );
            return Self {
                root: root.clone(),
                encrypted: Some(
                    crate::profile_files::EncryptedFiles::open(&root, Purpose::Checkpoint, key)
                        .unwrap(),
                ),
            };
        }
        assert!(!encrypted);
        Self {
            root,
            #[cfg(feature = "account-sync")]
            encrypted: None,
        }
    }
}
#[cfg(test)]
impl Group {
    pub(super) fn read(&self, name: &str) -> Vec<u8> {
        #[cfg(feature = "account-sync")]
        if let Some(files) = &self.encrypted {
            return files.read(&self.id(name), JOURNAL_LIMIT).unwrap();
        }
        read_regular(self.local.as_ref().unwrap(), name, JOURNAL_LIMIT).unwrap()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: &Path, token: &str) -> (Dir, Journal, String) {
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority()).unwrap();
        let name = format!("{STAGING_PREFIX}{token}");
        directory.create_dir(&name).unwrap();
        let stage = directory.open_dir_nofollow(&name).unwrap();
        let journal = Journal {
            version: 2,
            checkpoint_id: crate::ids::new_id(),
            root: Some(root.to_path_buf()),
            token: Some(token.into()),
            files: vec![Entry {
                path: "file".into(),
                backup: "original-0".into(),
                fingerprint: None,
                replacement: None,
            }],
        };
        write_new(
            &stage,
            "recovery.json",
            &serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        write_new(&stage, "original-0", b"only surviving original").unwrap();
        (directory, journal, name)
    }
    fn result() -> RevertResult {
        RevertResult {
            applied: vec![],
            error: None,
            recovery_paths: vec![],
        }
    }

    #[test]
    fn copy_verify_sync_path_handles_separate_store_and_interrupted_source_cleanup() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let token = crate::ids::new_id();
        let (root, journal, name) = fixture(source.path(), &token);
        let store = Store::fixture(destination.path().join("reverts"), false);
        let group = store.group(&token).unwrap();
        // Exercise the copy path on every platform, including same-volume fixtures. There is no
        // rename-to-destination fast path that could hide a cross-volume implementation failure.
        let stage = root.open_dir_nofollow(&name).unwrap();
        let bytes = read_regular(&stage, "original-0", scan::FILE_LIMIT).unwrap();
        let hash = crate::chatstore::rows::hex(&Sha256::digest(&bytes));
        let object = format!("saved-original-0-{hash}");
        group.write(&object, &bytes).unwrap();
        group
            .catalog(&[Saved {
                source: "original-0".into(),
                object: object.clone(),
                sha256: hash,
                bytes: bytes.len(),
            }])
            .unwrap();
        // Simulate interruption after one synced source object has been removed.
        stage.remove_file("original-0").unwrap();
        drop(stage);
        let mut outcome = result();
        settle(&root, &name, &journal, &group, &mut outcome);
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        assert!(!source.path().join(&name).exists());
        assert_eq!(group.read(&object), b"only surviving original");
        assert!(
            group
                .read_optional("saved-recovery-1.json")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn failed_storage_and_occupied_original_path_preserve_only_copy_and_report_error() {
        let source = tempfile::tempdir().unwrap();
        let token = crate::ids::new_id();
        let (root, journal, name) = fixture(source.path(), &token);
        std::fs::write(source.path().join("file"), "concurrent owner").unwrap();
        let blocked = Group {
            #[cfg(feature = "account-sync")]
            token,
            local: None,
            #[cfg(feature = "account-sync")]
            encrypted: None,
        };
        let mut outcome = result();
        settle(&root, &name, &journal, &blocked, &mut outcome);
        assert!(
            outcome
                .error
                .as_deref()
                .unwrap()
                .contains("Surviving recovery data was preserved")
        );
        assert_eq!(
            std::fs::read(source.path().join(&name).join("original-0")).unwrap(),
            b"only surviving original"
        );
        assert_eq!(
            std::fs::read(source.path().join("file")).unwrap(),
            b"concurrent owner"
        );
        assert_eq!(outcome.recovery_paths.len(), 1);
    }

    #[test]
    fn failed_storage_restores_without_clobber_and_removes_stage_when_possible() {
        let source = tempfile::tempdir().unwrap();
        let token = crate::ids::new_id();
        let (root, journal, name) = fixture(source.path(), &token);
        let blocked = Group {
            #[cfg(feature = "account-sync")]
            token,
            local: None,
            #[cfg(feature = "account-sync")]
            encrypted: None,
        };
        let mut outcome = result();
        settle(&root, &name, &journal, &blocked, &mut outcome);
        assert!(outcome.error.is_some());
        assert_eq!(
            std::fs::read(source.path().join("file")).unwrap(),
            b"only surviving original"
        );
        assert!(!source.path().join(&name).exists());
    }

    #[test]
    fn failed_storage_recognizes_an_original_already_restored_by_the_swap() {
        let source = tempfile::tempdir().unwrap();
        let token = crate::ids::new_id();
        let (root, journal, name) = fixture(source.path(), &token);
        root.open_dir_nofollow(&name)
            .unwrap()
            .hard_link("original-0", &root, "file")
            .unwrap();
        let blocked = Group {
            #[cfg(feature = "account-sync")]
            token,
            local: None,
            #[cfg(feature = "account-sync")]
            encrypted: None,
        };
        let mut outcome = result();
        settle(&root, &name, &journal, &blocked, &mut outcome);
        assert!(outcome.error.is_some());
        assert_eq!(
            std::fs::read(source.path().join("file")).unwrap(),
            b"only surviving original"
        );
        assert!(!source.path().join(&name).exists());
    }

    #[test]
    fn unexpected_entries_and_link_objects_are_never_cleaned() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let token = crate::ids::new_id();
        let (root, journal, name) = fixture(source.path(), &token);
        let group = Store::fixture(destination.path().to_path_buf(), false)
            .group(&token)
            .unwrap();
        let stage = root.open_dir_nofollow(&name).unwrap();
        stage.create_dir("unrelated").unwrap();
        assert!(inspect(&stage, &journal).is_err());
        let mut outcome = result();
        settle(&root, &name, &journal, &group, &mut outcome);
        assert!(outcome.error.is_some());
        assert!(source.path().join(&name).join("unrelated").exists());
        #[cfg(unix)]
        {
            stage.remove_dir("unrelated").unwrap();
            stage.remove_file("original-0").ok();
            std::os::unix::fs::symlink(
                source.path().join("file"),
                source.path().join(&name).join("original-0"),
            )
            .unwrap();
            assert!(inspect(&stage, &journal).is_err());
        }
    }
}
