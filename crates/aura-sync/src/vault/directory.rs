//! Explicit multi-entry fallback for the app profile index and account bundles. Each entry retains
//! the existing authenticated passphrase format and independent atomic replacement. No enumeration
//! of OS credentials or automatic migration occurs.
use super::{PassphraseStore, Result, SecretStore, VaultEntry, VaultError};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use zeroize::Zeroizing;

const LIMIT: usize = 16;

pub struct PassphraseDirectory {
    directory: PathBuf,
    passphrase: Zeroizing<String>,
    marker_entry: VaultEntry,
    _marker: PassphraseStore,
    entries: Mutex<HashMap<VaultEntry, PassphraseStore>>,
}
impl PassphraseDirectory {
    /// The caller supplies an empty private app directory and retains its data-root ownership.
    /// Creation is always explicit. Existing encrypted content is never adopted or overwritten.
    pub fn create(directory: &Path, scope: &str, passphrase: Zeroizing<String>) -> Result<Self> {
        let directory = directory_path(directory)?;
        if fs::read_dir(&directory)
            .map_err(|_| VaultError::Unavailable)?
            .next()
            .is_some()
        {
            return Err(VaultError::Invalid);
        }
        let marker_entry = marker_entry(scope)?;
        let marker = PassphraseStore::create(&directory, marker_entry.clone(), passphrase.clone())?;
        Ok(Self {
            directory,
            passphrase,
            marker_entry,
            _marker: marker,
            entries: Mutex::default(),
        })
    }
    pub fn open(directory: &Path, scope: &str, passphrase: Zeroizing<String>) -> Result<Self> {
        let directory = directory_path(directory)?;
        let marker_entry = marker_entry(scope)?;
        let marker = PassphraseStore::open(&directory, marker_entry.clone(), passphrase.clone())?;
        // The authenticated empty value is the marker. Its first atomic publication is complete,
        // so a crash does not leave an empty vault waiting for an unrecorded second write.
        if marker.load(&marker_entry)?.is_some() {
            return Err(VaultError::Corrupt);
        }
        Ok(Self {
            directory,
            passphrase,
            marker_entry,
            _marker: marker,
            entries: Mutex::default(),
        })
    }
    fn with<T>(
        &self,
        entry: &VaultEntry,
        create: bool,
        action: impl FnOnce(Option<&PassphraseStore>) -> Result<T>,
    ) -> Result<T> {
        if entry == &self.marker_entry {
            return Err(VaultError::Invalid);
        }
        let mut entries = self.entries.lock().map_err(|_| VaultError::Unavailable)?;
        if !entries.contains_key(entry) {
            if entries.len() >= LIMIT {
                return Err(VaultError::Invalid);
            }
            let path = self.directory.join(format!("{}.vault", entry.0));
            let store = match fs::symlink_metadata(path) {
                Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                    PassphraseStore::open(&self.directory, entry.clone(), self.passphrase.clone())?
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if !create {
                        return action(None);
                    }
                    PassphraseStore::create(
                        &self.directory,
                        entry.clone(),
                        self.passphrase.clone(),
                    )?
                }
                _ => return Err(VaultError::Corrupt),
            };
            entries.insert(entry.clone(), store);
        }
        action(entries.get(entry))
    }
}
impl SecretStore for PassphraseDirectory {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>> {
        self.with(entry, false, |store| {
            store.map_or(Ok(None), |store| store.load(entry))
        })
    }
    fn save(&self, entry: &VaultEntry, secret: &[u8]) -> Result<()> {
        super::validate(secret)?;
        self.with(entry, true, |store| {
            store.ok_or(VaultError::Unavailable)?.save(entry, secret)
        })
    }
    fn remove(&self, entry: &VaultEntry) -> Result<()> {
        self.with(entry, false, |store| {
            store.map_or(Ok(()), |store| store.remove(entry))
        })
    }
}
fn marker_entry(scope: &str) -> Result<VaultEntry> {
    if scope.is_empty() || scope.len() > 32 * 1024 {
        return Err(VaultError::Invalid);
    }
    let context = serde_json::to_vec(&("auracode-passphrase-directory-v1", scope))
        .map_err(|_| VaultError::Invalid)?;
    Ok(VaultEntry(crate::crypto::encode(&Sha256::digest(context))))
}
fn directory_path(path: &Path) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(path).map_err(|_| VaultError::Unavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(VaultError::Invalid);
    }
    path.canonicalize().map_err(|_| VaultError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pass() -> Zeroizing<String> {
        Zeroizing::new("synthetic fallback test phrase".into())
    }
    fn entry(name: &str) -> VaultEntry {
        VaultEntry::new("https://example.invalid", name).unwrap()
    }
    #[test]
    fn explicit_directory_keeps_independent_entries_private_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let store = PassphraseDirectory::create(dir.path(), "test-root", pass()).unwrap();
        let a = entry("account-a");
        let b = entry("account-b");
        let initial = fs::read_dir(dir.path()).unwrap().count();
        assert!(store.load(&a).unwrap().is_none());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), initial);
        store.save(&a, b"synthetic account A").unwrap();
        store.save(&b, b"synthetic account B").unwrap();
        assert!(matches!(
            PassphraseDirectory::open(dir.path(), "test-root", pass()),
            Err(VaultError::Busy)
        ));
        for file in fs::read_dir(dir.path()).unwrap() {
            let path = file.unwrap().path();
            if path
                .extension()
                .is_none_or(|extension| extension != "vault")
            {
                continue;
            }
            let bytes = fs::read(path).unwrap();
            assert!(!bytes.windows(9).any(|part| part == b"synthetic"));
        }
        drop(store);
        assert!(matches!(
            PassphraseDirectory::open(
                dir.path(),
                "test-root",
                Zeroizing::new("incorrect synthetic phrase".into())
            ),
            Err(VaultError::Unlock)
        ));
        let store = PassphraseDirectory::open(dir.path(), "test-root", pass()).unwrap();
        assert_eq!(
            store.load(&a).unwrap().unwrap().as_slice(),
            b"synthetic account A"
        );
        store.remove(&a).unwrap();
        assert!(store.load(&a).unwrap().is_none());
        assert_eq!(
            store.load(&b).unwrap().unwrap().as_slice(),
            b"synthetic account B"
        );
    }
    #[test]
    fn unexpected_contents_and_damaged_entries_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("existing"), b"preserve").unwrap();
        assert!(PassphraseDirectory::create(dir.path(), "test-root", pass()).is_err());
        assert_eq!(fs::read(dir.path().join("existing")).unwrap(), b"preserve");
        let dir = tempfile::tempdir().unwrap();
        let store = PassphraseDirectory::create(dir.path(), "test-root", pass()).unwrap();
        let a = entry("account-a");
        let path = dir.path().join(format!("{}.vault", a.0));
        fs::write(&path, b"damaged ciphertext").unwrap();
        assert!(store.save(&a, b"replacement").is_err());
        assert_eq!(fs::read(path).unwrap(), b"damaged ciphertext");
    }
}
