//! Explicit, one-use, content-bound copies. Journals retain replaced files, and publication uses
//! no-overwrite hard links so an intervening external writer cannot be silently overwritten.

use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};

use cap_fs_ext::DirExt;
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};

use crate::{
    CopyFile, CopyPreview, CopyReceipt, CopyResult, CopyState, Error, ItemRef, Kind, Library,
    Provider, Result, Scope, Source, inventory,
    safe_fs::{self, FileData},
};

const JOURNALS: &str = ".auracode-library";

pub struct PreparedCopy {
    preview: CopyPreview,
    source_revision: String,
    source_root: PathBuf,
    target_root: PathBuf,
    target: Dir,
    expires: Instant,
    files: Vec<Mutation>,
    target_kind: Kind,
    target_prefix: String,
}

impl PreparedCopy {
    pub fn preview(&self) -> &CopyPreview {
        &self.preview
    }

    pub fn is_expired(&self) -> bool {
        Instant::now() > self.expires
    }
}

struct Mutation {
    path: String,
    before: Option<FileData>,
    after: FileData,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    version: u32,
    source_id: String,
    kind: Kind,
    prefix: String,
    files: Vec<JournalFile>,
}

#[derive(Serialize, Deserialize)]
struct JournalFile {
    path: String,
    before: Option<String>,
    after: String,
}

fn fingerprint(file: &FileData) -> String {
    // The relative path belongs to the journal separately; the mode is part of its revision.
    let mut bytes = vec![u8::from(file.executable)];
    bytes.extend_from_slice(&file.bytes);
    safe_fs::hash(&bytes)
}

impl Library {
    /// Read only bounded, validated journal metadata. Never exposes retained file contents.
    pub fn copy_history(&self) -> Result<Vec<CopyReceipt>> {
        let mut receipts = Vec::new();
        for source in &self.sources {
            let Ok(root) = inventory::open(source) else {
                continue;
            };
            match root.symlink_metadata(JOURNALS) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err(Error::Io),
                Ok(_) => {}
            }
            for id in safe_fs::children(&root, JOURNALS)? {
                if uuid::Uuid::parse_str(&id)
                    .ok()
                    .is_none_or(|uuid| uuid.to_string() != id)
                {
                    continue;
                }
                let backup = safe_fs::directory(&root, &format!("{JOURNALS}/{id}"))?;
                let Some(bytes) = safe_fs::read(&backup, "journal.json")? else {
                    continue;
                };
                let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| Error::Format)?;
                // Several project providers share a folder. Only its original source owns a receipt.
                if journal.source_id != source.id {
                    continue;
                }
                validate_journal(source, &journal)?;
                let state = if has_marker(&backup, "rolled-back")? {
                    CopyState::RolledBack
                } else if has_marker(&backup, "complete")?
                    && !has_marker(&backup, "rollback-started")?
                {
                    CopyState::Complete
                } else {
                    CopyState::RecoveryRequired
                };
                receipts.push(CopyReceipt {
                    id,
                    source_id: source.id.clone(),
                    kind: journal.kind,
                    files: journal.files.into_iter().map(|file| file.path).collect(),
                    state,
                });
                if receipts.len() > safe_fs::ITEM_COUNT {
                    return Err(Error::Limit);
                }
            }
        }
        receipts.sort_by(|a, b| b.id.cmp(&a.id));
        Ok(receipts)
    }

    pub fn prepare_copy(
        &self,
        from: &ItemRef,
        revision: &str,
        to_source: &str,
    ) -> Result<PreparedCopy> {
        let source = self
            .sources
            .iter()
            .find(|source| source.id == from.source_id)
            .ok_or(Error::Unavailable)?;
        let target = self
            .sources
            .iter()
            .find(|source| source.id == to_source)
            .ok_or(Error::Unavailable)?;
        let entry = self.entry(from)?;
        if entry.item.revision != revision {
            return Err(Error::Stale);
        }
        if let Some(reason) = entry.item.copy_blocked {
            return Err(Error::Unsupported(reason));
        }
        let prefix = destination(target, from.kind, &from.key, source.provider)?;
        let source_root = std::fs::canonicalize(&source.root).map_err(|_| Error::Unavailable)?;
        let target_root = std::fs::canonicalize(&target.root).map_err(|_| Error::Unavailable)?;
        if source_root == target_root && entry.item.relative_path == prefix {
            return Err(Error::Unsupported(
                "This item is already in that location.".into(),
            ));
        }
        let root = inventory::open(target)?;
        let mut files = Vec::new();
        let mut before_bytes = 0;
        let mut before_text = None;
        for file in entry.files {
            let path = if from.kind == Kind::Skill {
                format!("{prefix}/{}", file.path)
            } else {
                prefix.clone()
            };
            let before = safe_fs::read_file(&root, &path)?;
            before_bytes += before.as_ref().map_or(0, |file| file.bytes.len());
            if before_bytes > safe_fs::TREE_LIMIT {
                return Err(Error::Limit);
            }
            if path.ends_with("/SKILL.md") || from.kind == Kind::Instructions {
                before_text = before
                    .as_ref()
                    .map(|file| inventory::text(&file.bytes).map(str::to_owned))
                    .transpose()?;
            }
            files.push(Mutation {
                path,
                before,
                after: file,
            });
        }
        if files.is_empty() {
            return Err(Error::Unsupported(
                "This item needs a vendor-specific installation workflow.".into(),
            ));
        }
        let preview = CopyPreview {
            id: uuid::Uuid::now_v7().to_string(), from: from.clone(), to_source: to_source.into(),
            files: files.iter().map(|file| CopyFile { path: file.path.clone(), before_revision: file.before.as_ref().map(fingerprint),
                after_revision: fingerprint(&file.after), bytes: file.after.bytes.len() as u32 }).collect(),
            before_text, after_text: entry.text,
            notices: vec!["Copying changes the selected agent's configuration. Review instructions and scripts before the next agent session.".into(),
                "Existing unrelated files stay in place. Replaced files are retained for rollback; the Library does not run copied scripts.".into()],
        };
        Ok(PreparedCopy {
            preview,
            source_revision: revision.into(),
            source_root,
            target_root,
            target: root,
            expires: Instant::now() + Duration::from_secs(600),
            files,
            target_kind: from.kind,
            target_prefix: prefix,
        })
    }

    /// Consumes the reviewed plan even if validation fails. The host must serialize apply/rollback
    /// and run this in an owned blocking task so an IPC cancellation cannot interrupt the journal.
    pub fn apply_copy(&self, prepared: PreparedCopy) -> Result<CopyResult> {
        let source = self
            .sources
            .iter()
            .find(|source| source.id == prepared.preview.from.source_id)
            .ok_or(Error::Unavailable)?;
        let target = self
            .sources
            .iter()
            .find(|source| source.id == prepared.preview.to_source)
            .ok_or(Error::Unavailable)?;
        if Instant::now() > prepared.expires
            || std::fs::canonicalize(&source.root).ok().as_ref() != Some(&prepared.source_root)
            || std::fs::canonicalize(&target.root).ok().as_ref() != Some(&prepared.target_root)
            || self.entry(&prepared.preview.from)?.item.revision != prepared.source_revision
        {
            return Err(Error::Stale);
        }
        // Keep the handle opened for the preview. A path replacement after canonical validation
        // cannot redirect any write into a different root.
        let root = prepared.target;
        for file in &prepared.files {
            if safe_fs::read_file(&root, &file.path)?
                .as_ref()
                .map(fingerprint)
                != file.before.as_ref().map(fingerprint)
            {
                return Err(Error::Stale);
            }
        }
        let journals = create_directory(&root, JOURNALS)?;
        journals.create_dir(&prepared.preview.id)?;
        let backup = journals.open_dir_nofollow(&prepared.preview.id)?;
        for (index, file) in prepared.files.iter().enumerate() {
            stage(&backup, &format!("after-{index}"), &file.after)?;
            if let Some(before) = &file.before {
                // Keep a separate snapshot too: an editor holding an old handle can still change
                // the moved original. The reviewed bytes must remain recoverable in that case.
                stage(&backup, &format!("snapshot-{index}"), before)?;
            }
        }
        let journal = Journal {
            version: 1,
            source_id: target.id.clone(),
            kind: prepared.target_kind,
            prefix: prepared.target_prefix,
            files: prepared
                .files
                .iter()
                .map(|file| JournalFile {
                    path: file.path.clone(),
                    before: file.before.as_ref().map(fingerprint),
                    after: fingerprint(&file.after),
                })
                .collect(),
        };
        let bytes = serde_json::to_vec(&journal).map_err(|_| Error::Format)?;
        stage(
            &backup,
            "journal.json",
            &FileData {
                path: String::new(),
                bytes,
                executable: false,
            },
        )?;
        sync_directory(&backup)?;
        sync_directory(&journals)?;
        let mut result = CopyResult {
            id: prepared.preview.id,
            source_id: target.id.clone(),
            applied: Vec::new(),
            recovery_required: false,
            message: None,
        };
        for (index, file) in prepared.files.iter().enumerate() {
            if let Err(error) = apply_file(&root, &backup, index, file) {
                result.recovery_required = true;
                result.message = Some(format!(
                    "Copy stopped: {error} Original and staged files remain in the Library recovery folder."
                ));
                break;
            }
            result.applied.push(file.path.clone());
        }
        if !result.recovery_required && marker(&backup, "complete").is_err() {
            result.recovery_required = true;
            result.message = Some("The files were copied, but the final recovery marker could not be saved. The retained originals remain available.".into());
        }
        Ok(result)
    }

    /// Rollback only accepts a UUID journal beneath a known source. It rechecks every affected file
    /// before the first mutation, preserving subsequent user edits and partial-copy originals.
    pub fn rollback_copy(&self, source_id: &str, id: &str) -> Result<CopyResult> {
        let target = self
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or(Error::Unavailable)?;
        if uuid::Uuid::parse_str(id)
            .ok()
            .is_none_or(|uuid| uuid.to_string() != id)
        {
            return Err(Error::UnsafePath);
        }
        let root = inventory::open(target)?;
        let backup = safe_fs::directory(&root, &format!("{JOURNALS}/{id}"))?;
        let journal: Journal =
            serde_json::from_slice(&safe_fs::read(&backup, "journal.json")?.ok_or(Error::Format)?)
                .map_err(|_| Error::Format)?;
        validate_journal(target, &journal)?;
        let complete = has_marker(&backup, "complete")?;
        let rollback_started = has_marker(&backup, "rollback-started")?;
        // A copy can stop before moving a file, after moving its old value, or after publication.
        // Inspect actual retained objects rather than trusting a last-written progress counter.
        for (index, file) in journal.files.iter().enumerate() {
            let current = safe_fs::read_file(&root, &file.path)?
                .as_ref()
                .map(fingerprint);
            if current == file.before {
                continue;
            }
            if current.is_none() && complete && !rollback_started {
                return Err(Error::Stale);
            }
            if current.as_ref().is_some_and(|hash| hash != &file.after) {
                return Err(Error::Stale);
            }
            if file.before.is_some()
                && safe_fs::read_file(&backup, &format!("before-{index}"))?
                    .as_ref()
                    .map(fingerprint)
                    != file.before
            {
                return Err(Error::Stale);
            }
        }
        let mut result = CopyResult {
            id: id.into(),
            source_id: source_id.into(),
            applied: Vec::new(),
            recovery_required: false,
            message: None,
        };
        marker(&backup, "rollback-started")?;
        for (index, file) in journal.files.iter().enumerate() {
            match rollback_file(&root, &backup, index, file) {
                Ok(()) => result.applied.push(file.path.clone()),
                Err(error) => {
                    result.recovery_required = true;
                    result.message = Some(format!(
                        "Rollback stopped: {error} All retained files remain available for recovery."
                    ));
                    break;
                }
            }
        }
        if !result.recovery_required && marker(&backup, "rolled-back").is_err() {
            result.recovery_required = true;
            result.message = Some("Files were restored, but the recovery status could not be saved. Retained files remain available.".into());
        }
        Ok(result)
    }
}

fn destination(target: &Source, kind: Kind, key: &str, from: Provider) -> Result<String> {
    if target.claude_state_only {
        return Err(Error::Unsupported(
            "Choose an agent configuration folder for this item.".into(),
        ));
    }
    safe_fs::validate(key)?;
    match kind {
        Kind::Skill => {
            if key.contains('/') {
                return Err(Error::UnsafePath);
            }
            let base = match (target.provider, target.scope) {
                (Provider::Shared, _) => "",
                (_, Scope::User) => "skills/",
                (Provider::Claude, Scope::Project) => ".claude/skills/",
                (Provider::Codex, Scope::Project) => ".codex/skills/",
                (Provider::Pi, Scope::Project) => ".pi/skills/",
            };
            Ok(format!("{base}{key}"))
        }
        Kind::Instructions if target.provider != Provider::Shared => {
            if key == "AGENTS.override.md" && from != target.provider {
                return Err(Error::Unsupported("Override instructions have different precedence in another agent. Copy them manually after reviewing that behavior.".into()));
            }
            if !matches!(key, "CLAUDE.md" | "AGENTS.md" | "AGENTS.override.md") {
                return Err(Error::Unsupported(
                    "This instruction type needs a manual conversion.".into(),
                ));
            }
            Ok(if target.provider == Provider::Claude {
                "CLAUDE.md".into()
            } else if key == "AGENTS.override.md" {
                key.into()
            } else {
                "AGENTS.md".into()
            })
        }
        _ => Err(Error::Unsupported(
            "This item needs a vendor-specific installation workflow. No files were changed."
                .into(),
        )),
    }
}

fn validate_journal(target: &Source, journal: &Journal) -> Result<()> {
    if journal.version != 1
        || journal.source_id != target.id
        || journal.files.is_empty()
        || journal.files.len() > safe_fs::FILE_COUNT
    {
        return Err(Error::Format);
    }
    let mut paths = std::collections::HashSet::new();
    for file in &journal.files {
        safe_fs::validate(&file.path)?;
        if !paths.insert(&file.path)
            || file.after.len() != 64
            || file.before.as_ref().is_some_and(|hash| hash.len() != 64)
        {
            return Err(Error::Format);
        }
        match journal.kind {
            Kind::Instructions => {
                if journal.files.len() != 1
                    || file.path != journal.prefix
                    || !matches!(
                        file.path.as_str(),
                        "CLAUDE.md" | "AGENTS.md" | "AGENTS.override.md"
                    )
                {
                    return Err(Error::UnsafePath);
                }
            }
            Kind::Skill => {
                let key = journal.prefix.rsplit('/').next().ok_or(Error::UnsafePath)?;
                if destination(target, Kind::Skill, key, target.provider)? != journal.prefix
                    || !file.path.starts_with(&format!("{}/", journal.prefix))
                {
                    return Err(Error::UnsafePath);
                }
            }
            _ => return Err(Error::UnsafePath),
        }
    }
    Ok(())
}

fn create_directory(root: &Dir, path: &str) -> Result<Dir> {
    let mut directory = root.try_clone()?;
    safe_fs::validate(path)?;
    for part in path.split('/') {
        match directory.create_dir(part) {
            Ok(()) => sync_directory(&directory)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        directory = directory
            .open_dir_nofollow(part)
            .map_err(|_| Error::UnsafePath)?;
    }
    Ok(directory)
}

fn destination_parent(root: &Dir, path: &str) -> Result<(Dir, String)> {
    safe_fs::validate(path)?;
    match path.rsplit_once('/') {
        Some((parent, name)) => Ok((create_directory(root, parent)?, name.into())),
        None => Ok((root.try_clone()?, path.into())),
    }
}

fn stage(root: &Dir, name: &str, data: &FileData) -> Result<()> {
    let mut file = root.open_with(name, OpenOptions::new().write(true).create_new(true))?;
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;
        file.set_permissions(cap_std::fs::Permissions::from_mode(if data.executable {
            0o700
        } else {
            0o600
        }))?;
    }
    file.write_all(&data.bytes)?;
    file.sync_all()?;
    Ok(())
}

fn apply_file(root: &Dir, backup: &Dir, index: usize, file: &Mutation) -> Result<()> {
    let (parent, name) = destination_parent(root, &file.path)?;
    let original = format!("before-{index}");
    if let Some(expected) = &file.before {
        parent.rename(&name, backup, &original)?;
        if safe_fs::read_file(backup, &original)?
            .as_ref()
            .map(fingerprint)
            != Some(fingerprint(expected))
        {
            let _ = backup.hard_link(&original, &parent, &name);
            return Err(Error::Stale);
        }
        sync_directory(backup)?;
    }
    if let Err(error) = backup.hard_link(format!("after-{index}"), &parent, &name) {
        if file.before.is_some() {
            let _ = backup.hard_link(&original, &parent, &name);
        }
        return Err(error.into());
    }
    sync_directory(&parent)?;
    Ok(())
}

fn rollback_file(root: &Dir, backup: &Dir, index: usize, file: &JournalFile) -> Result<()> {
    let current = safe_fs::read_file(root, &file.path)?
        .as_ref()
        .map(fingerprint);
    if current == file.before {
        return Ok(());
    }
    if current.as_ref().is_some_and(|hash| hash != &file.after) {
        return Err(Error::Stale);
    }
    let (parent, name) = destination_parent(root, &file.path)?;
    if current.is_some() {
        let removed = format!("rollback-{index}-{}", uuid::Uuid::now_v7());
        parent.rename(&name, backup, &removed)?;
        if safe_fs::read_file(backup, &removed)?
            .as_ref()
            .map(fingerprint)
            != Some(file.after.clone())
        {
            let _ = backup.hard_link(&removed, &parent, &name);
            return Err(Error::Stale);
        }
        sync_directory(backup)?;
    }
    if file.before.is_some() {
        backup.hard_link(format!("before-{index}"), &parent, &name)?;
    }
    sync_directory(&parent)?;
    Ok(())
}

fn sync_directory(directory: &Dir) -> Result<()> {
    #[cfg(unix)]
    directory.try_clone()?.into_std_file().sync_all()?;
    #[cfg(not(unix))]
    let _ = directory; // Windows syncs staged file handles; directory handles do not support FlushFileBuffers.
    Ok(())
}

fn has_marker(directory: &Dir, name: &str) -> Result<bool> {
    match safe_fs::read(directory, name)? {
        None => Ok(false),
        Some(bytes) if bytes == b"1" => Ok(true),
        Some(_) => Err(Error::Format),
    }
}

fn marker(directory: &Dir, name: &str) -> Result<()> {
    if !has_marker(directory, name)? {
        stage(
            directory,
            name,
            &FileData {
                path: String::new(),
                bytes: b"1".to_vec(),
                executable: false,
            },
        )?;
        sync_directory(directory)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_file_between_validation_and_move_is_retained_without_overwriting_it() {
        let fixture = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        root.create_dir("backup").unwrap();
        let backup = root.open_dir_nofollow("backup").unwrap();
        root.write("AGENTS.md", b"original").unwrap();
        let before = safe_fs::read_file(&root, "AGENTS.md").unwrap();
        let after = FileData {
            path: "AGENTS.md".into(),
            bytes: b"replacement".to_vec(),
            executable: false,
        };
        stage(&backup, "after-0", &after).unwrap();
        root.write("AGENTS.md", b"concurrent user edit").unwrap();
        let file = Mutation {
            path: "AGENTS.md".into(),
            before,
            after,
        };
        assert!(matches!(
            apply_file(&root, &backup, 0, &file),
            Err(Error::Stale)
        ));
        assert_eq!(root.read("AGENTS.md").unwrap(), b"concurrent user edit");
        assert_eq!(backup.read("before-0").unwrap(), b"concurrent user edit");
    }

    #[test]
    fn publication_never_overwrites_a_new_file_created_after_validation() {
        let fixture = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        root.create_dir("backup").unwrap();
        let backup = root.open_dir_nofollow("backup").unwrap();
        let after = FileData {
            path: "AGENTS.md".into(),
            bytes: b"replacement".to_vec(),
            executable: false,
        };
        stage(&backup, "after-0", &after).unwrap();
        root.write("AGENTS.md", b"concurrent creation").unwrap();
        assert!(
            apply_file(
                &root,
                &backup,
                0,
                &Mutation {
                    path: "AGENTS.md".into(),
                    before: None,
                    after
                }
            )
            .is_err()
        );
        assert_eq!(root.read("AGENTS.md").unwrap(), b"concurrent creation");
    }

    #[test]
    fn rollback_recovers_a_crash_after_moving_the_original_before_publication() {
        let fixture = tempfile::tempdir().unwrap();
        let source = Source {
            id: "pi".into(),
            provider: Provider::Pi,
            scope: Scope::User,
            root: fixture.path().into(),
            claude_state_only: false,
        };
        let library = Library::new(vec![source.clone()]).unwrap();
        let root = inventory::open(&source).unwrap();
        root.write("AGENTS.md", b"original").unwrap();
        let before = safe_fs::read_file(&root, "AGENTS.md").unwrap().unwrap();
        let after = FileData {
            path: "AGENTS.md".into(),
            bytes: b"replacement".to_vec(),
            executable: false,
        };
        let id = uuid::Uuid::now_v7().to_string();
        let backup = create_directory(&root, &format!("{JOURNALS}/{id}")).unwrap();
        stage(&backup, "after-0", &after).unwrap();
        let journal = Journal {
            version: 1,
            source_id: "pi".into(),
            kind: Kind::Instructions,
            prefix: "AGENTS.md".into(),
            files: vec![JournalFile {
                path: "AGENTS.md".into(),
                before: Some(fingerprint(&before)),
                after: fingerprint(&after),
            }],
        };
        stage(
            &backup,
            "journal.json",
            &FileData {
                path: String::new(),
                bytes: serde_json::to_vec(&journal).unwrap(),
                executable: false,
            },
        )
        .unwrap();
        root.rename("AGENTS.md", &backup, "before-0").unwrap();
        let result = library.rollback_copy("pi", &id).unwrap();
        assert!(!result.recovery_required);
        assert_eq!(root.read("AGENTS.md").unwrap(), b"original");
    }
}
