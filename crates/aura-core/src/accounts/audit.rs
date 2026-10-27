//! Reject known pre-encryption content locations without opening their contents or deleting them.
use super::{Result, error};
use crate::profile::{Profile, ProfileKind};
use cap_fs_ext::DirExt;
use cap_std::fs::Dir;

pub fn audit_profile(profile: &Profile) -> Result<()> {
    if profile.meta.kind != ProfileKind::Account {
        return Err(error::state());
    }
    let root = Dir::open_ambient_dir(&profile.dir, cap_std::ambient_authority())
        .map_err(|_| error::storage())?;
    for name in [
        "onboarding.json",
        "aura.db",
        "aura.db-wal",
        "aura.db-shm",
        "aura.db-journal",
    ] {
        match root.symlink_metadata(name) {
            Ok(_) => return Err(legacy()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(error::storage()),
        }
    }
    let mut remaining = 10_000_usize;
    if let Some(logs) = directory(&root, "logs")? {
        empty_tree(&logs, 0, &mut remaining)?;
    }
    if let Some(backups) = directory(&root, "backups")? {
        for entry in backups.entries().map_err(|_| error::storage())? {
            remaining = remaining.checked_sub(1).ok_or_else(legacy)?;
            let entry = entry.map_err(|_| error::storage())?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                return Err(legacy());
            };
            let kind = entry.file_type().map_err(|_| error::storage())?;
            if kind.is_symlink()
                || name.starts_with("deadletter-")
                || name.ends_with(".jsonl")
                || name.ends_with(".json")
            {
                return Err(legacy());
            }
        }
    }
    Ok(())
}
fn directory(parent: &Dir, name: &str) -> Result<Option<Dir>> {
    match parent.open_dir_nofollow(name) {
        Ok(dir) => Ok(Some(dir)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(legacy()),
    }
}
fn empty_tree(dir: &Dir, depth: usize, remaining: &mut usize) -> Result<()> {
    if depth > 16 {
        return Err(legacy());
    }
    for entry in dir.entries().map_err(|_| error::storage())? {
        *remaining = remaining.checked_sub(1).ok_or_else(legacy)?;
        let entry = entry.map_err(|_| error::storage())?;
        if !entry.file_type().map_err(|_| error::storage())?.is_dir() {
            return Err(legacy());
        }
        let child = dir
            .open_dir_nofollow(entry.file_name())
            .map_err(|_| legacy())?;
        empty_tree(&child, depth + 1, remaining)?;
    }
    Ok(())
}
fn legacy() -> aura_protocol::account::AccountFailure {
    error::failure(
        aura_protocol::account::AccountFailureCode::LocalStorage,
        "This account profile contains legacy plaintext files or unsupported links. They were preserved; explicit encrypted import is required before opening it.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_activation_preserves_and_refuses_plaintext_logs_and_recovery_files() {
        let temp = tempfile::tempdir().unwrap();
        let profiles = crate::profile::Profiles::new(crate::paths::DataRoot::at(temp.path()));
        let profile = profiles.create(ProfileKind::Account, "Account").unwrap();
        assert!(audit_profile(&profile).is_ok());
        let log = profile.logs_dir().join("protocol").join("old.jsonl");
        std::fs::create_dir_all(log.parent().unwrap()).unwrap();
        std::fs::write(&log, b"synthetic private content").unwrap();
        assert!(audit_profile(&profile).is_err());
        assert_eq!(std::fs::read(&log).unwrap(), b"synthetic private content");
        std::fs::remove_file(&log).unwrap();
        let journal = profile.backups_dir().join("deadletter-1.jsonl");
        std::fs::write(&journal, b"synthetic recovery content").unwrap();
        assert!(audit_profile(&profile).is_err());
        assert_eq!(
            std::fs::read(journal).unwrap(),
            b"synthetic recovery content"
        );
    }
}
