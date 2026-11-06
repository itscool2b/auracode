//! Nonsecret recovery routing for a shared-home profile switch. This file contains strict IDs only;
//! configuration snapshots and paths stay in the owning Account's encrypted transition record.
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{self, Read, Write},
    path::Path,
};

const FILE: &str = "config-profile-transition.json";
const LOCK: &str = ".config-profile-transition.lock";
const LIMIT: u64 = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionLocator {
    pub schema: u32,
    pub transaction: String,
    pub owner_profile: String,
    pub from_profile: String,
    pub to_profile: String,
}
impl TransitionLocator {
    pub fn validate(&self) -> io::Result<()> {
        if self.schema != 1
            || !uuid(&self.transaction)
            || !uuid(&self.owner_profile)
            || !profile(&self.from_profile)
            || !profile(&self.to_profile)
            || self.from_profile == self.to_profile
            || self.owner_profile != self.from_profile && self.owner_profile != self.to_profile
        {
            return Err(invalid());
        }
        Ok(())
    }
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn profile(value: &str) -> bool {
    value == "local" || uuid(value)
}
fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "The configuration transition recovery locator is invalid. Existing data was preserved.",
    )
}
fn open(root: &Path) -> io::Result<Dir> {
    Dir::open_ambient_dir(root, cap_std::ambient_authority())
}
fn read(dir: &Dir) -> io::Result<Option<TransitionLocator>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = match dir.open_with(FILE, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let meta = file.metadata()?;
    if !meta.is_file() || meta.len() > LIMIT {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(invalid());
    }
    let locator: TransitionLocator = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    locator.validate()?;
    Ok(Some(locator))
}
/// Read-only boot check. Missing is the only state that permits normal profile admission.
pub fn pending(root: &Path) -> io::Result<Option<TransitionLocator>> {
    read(&open(root)?)
}

/// Inspect publication without repairing or falling back to Local. Recovery must not infer a
/// successful pointer write from a repaired startup snapshot.
pub fn active_profile(root: &Path) -> io::Result<String> {
    let dir = open(root)?;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = dir.open_with("state.json", &options)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take(64 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 {
        return Err(invalid());
    }
    #[derive(Deserialize)]
    struct Pointer {
        active_profile: String,
    }
    let value: Pointer = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if !profile(&value.active_profile) {
        return Err(invalid());
    }
    Ok(value.active_profile)
}

/// Serializes this app data root only. Normal desktop execution also uses its single-instance
/// gate. Isolated custom data roots are not mutually coordinated by this lease.
pub struct TransitionLease {
    dir: Dir,
    _lock: File,
}
impl TransitionLease {
    pub fn acquire(root: &Path) -> io::Result<Self> {
        let dir = open(root)?;
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = dir.open_with(LOCK, &options)?.into_std();
        if !file.metadata()?.is_file() {
            return Err(invalid());
        }
        file.try_lock().map_err(io::Error::other)?;
        Ok(Self { dir, _lock: file })
    }
    pub fn pending(&self) -> io::Result<Option<TransitionLocator>> {
        read(&self.dir)
    }
    /// Call only after the encrypted record is durable and before any configuration mutation.
    pub fn create(&self, locator: &TransitionLocator) -> io::Result<()> {
        locator.validate()?;
        if self.pending()?.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Configuration recovery is already pending.",
            ));
        }
        let bytes = serde_json::to_vec(locator).map_err(io::Error::other)?;
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
        let temporary = format!(".config-transition-{}.partial", uuid::Uuid::now_v7());
        let mut file = self.dir.open_with(&temporary, &options)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        // Publish a complete locator without replacing an existing transaction. A crash before
        // publication can leave only a nonsecret temporary file and has authorized no file edits.
        self.dir.hard_link(&temporary, &self.dir, FILE)?;
        self.sync()?;
        self.dir.remove_file(&temporary)?;
        self.sync()
    }
    /// Clear only the exact validated transaction after rollback or published-side verification.
    pub fn clear(&self, locator: &TransitionLocator) -> io::Result<()> {
        if self.pending()?.as_ref() != Some(locator) {
            return Err(invalid());
        }
        self.dir.remove_file(FILE)?;
        self.sync()
    }
    fn sync(&self) -> io::Result<()> {
        #[cfg(unix)]
        crate::fsutil::fsync_dir(&self.dir)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn locator() -> TransitionLocator {
        TransitionLocator {
            schema: 1,
            transaction: uuid::Uuid::now_v7().to_string(),
            owner_profile: uuid::Uuid::now_v7().to_string(),
            from_profile: "local".into(),
            to_profile: String::new(),
        }
    }
    #[test]
    fn locator_is_strict_serialized_and_cleared_only_by_its_exact_owner() {
        let temp = tempfile::tempdir().unwrap();
        let mut locator = locator();
        locator.to_profile.clone_from(&locator.owner_profile);
        let lease = TransitionLease::acquire(temp.path()).unwrap();
        assert!(TransitionLease::acquire(temp.path()).is_err());
        lease.create(&locator).unwrap();
        assert_eq!(pending(temp.path()).unwrap(), Some(locator.clone()));
        assert!(lease.create(&locator).is_err());
        let mut other = locator.clone();
        other.transaction = uuid::Uuid::now_v7().to_string();
        assert!(lease.clear(&other).is_err());
        assert_eq!(pending(temp.path()).unwrap(), Some(locator.clone()));
        lease.clear(&locator).unwrap();
        assert!(pending(temp.path()).unwrap().is_none());
        locator.owner_profile = "../../outside".into();
        assert!(lease.create(&locator).is_err());
    }
    #[test]
    fn corrupt_unknown_or_oversized_locators_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let lease = TransitionLease::acquire(temp.path()).unwrap();
        for bytes in [b"{broken".to_vec(), vec![b' '; LIMIT as usize + 1]] {
            std::fs::write(temp.path().join(FILE), &bytes).unwrap();
            assert!(pending(temp.path()).is_err());
            assert!(lease.pending().is_err());
            assert_eq!(std::fs::read(temp.path().join(FILE)).unwrap(), bytes);
        }
    }
}
