use super::{MAX_SECRET, Result, SecretStore, VaultEntry, VaultError, validate};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"AURA-VAULT\x01";
const HEADER: usize = MAGIC.len() + 16 + 24;
const MAX_FILE: usize = HEADER + 1 + MAX_SECRET + 16;
const AAD: &str = "auracode-passphrase-vault-v1";

/// Explicit fallback for a user-chosen passphrase. The directory must already be an auracode-owned
/// private profile directory. Opening never creates a store or overwrites damaged ciphertext.
/// The lock is held until drop; unlocked keys and values are zeroized on drop.
pub struct PassphraseStore {
    entry: VaultEntry,
    path: PathBuf,
    _lock: File,
    salt: [u8; 16],
    key: Zeroizing<[u8; 32]>,
    value: Mutex<Option<Zeroizing<Vec<u8>>>>,
}
impl PassphraseStore {
    pub fn create(
        directory: &Path,
        entry: VaultEntry,
        passphrase: Zeroizing<String>,
    ) -> Result<Self> {
        let (path, lock) = location(directory, &entry)?;
        let mut salt = [0; 16];
        getrandom::fill(&mut salt).map_err(|_| VaultError::Unavailable)?;
        let key = derive(&passphrase, &salt)?;
        let store = Self {
            entry,
            path,
            _lock: lock,
            salt,
            key,
            value: Mutex::new(None),
        };
        store.persist(None, true)?;
        Ok(store)
    }
    pub fn open(
        directory: &Path,
        entry: VaultEntry,
        passphrase: Zeroizing<String>,
    ) -> Result<Self> {
        let (path, lock) = location(directory, &entry)?;
        let metadata = fs::symlink_metadata(&path).map_err(|_| VaultError::Unavailable)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_FILE as u64
        {
            return Err(VaultError::Corrupt);
        }
        let mut bytes = Vec::new();
        File::open(&path)
            .map_err(|_| VaultError::Unavailable)?
            .take(MAX_FILE as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| VaultError::Unavailable)?;
        if bytes.len() < HEADER + 17 || bytes.len() > MAX_FILE || !bytes.starts_with(MAGIC) {
            return Err(VaultError::Corrupt);
        }
        let salt = bytes[MAGIC.len()..MAGIC.len() + 16]
            .try_into()
            .map_err(|_| VaultError::Corrupt)?;
        let nonce: [u8; 24] = bytes[MAGIC.len() + 16..HEADER]
            .try_into()
            .map_err(|_| VaultError::Corrupt)?;
        let key = derive(&passphrase, &salt)?;
        let cipher =
            XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| VaultError::Corrupt)?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    &XNonce::from(nonce),
                    Payload {
                        msg: &bytes[HEADER..],
                        aad: &context(&entry)?,
                    },
                )
                .map_err(|_| VaultError::Unlock)?,
        );
        let value = match plaintext.first() {
            Some(0) if plaintext.len() == 1 => None,
            Some(1) if plaintext.len() > 1 => Some(Zeroizing::new(plaintext[1..].to_vec())),
            _ => return Err(VaultError::Corrupt),
        };
        Ok(Self {
            entry,
            path,
            _lock: lock,
            salt,
            key,
            value: Mutex::new(value),
        })
    }
    fn same(&self, entry: &VaultEntry) -> Result<()> {
        if entry == &self.entry {
            Ok(())
        } else {
            Err(VaultError::Invalid)
        }
    }
    fn persist(&self, value: Option<&[u8]>, create: bool) -> Result<()> {
        let mut plaintext = Zeroizing::new(Vec::with_capacity(1 + value.map_or(0, <[u8]>::len)));
        plaintext.push(u8::from(value.is_some()));
        if let Some(value) = value {
            plaintext.extend_from_slice(value);
        }
        let mut nonce = [0; 24];
        getrandom::fill(&mut nonce).map_err(|_| VaultError::Unavailable)?;
        let cipher = XChaCha20Poly1305::new_from_slice(self.key.as_ref())
            .map_err(|_| VaultError::Corrupt)?;
        let ciphertext = cipher
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &plaintext,
                    aad: &context(&self.entry)?,
                },
            )
            .map_err(|_| VaultError::Write)?;
        let directory = self.path.parent().ok_or(VaultError::Invalid)?;
        let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|_| VaultError::Write)?;
        for part in [MAGIC, &self.salt, &nonce, &ciphertext] {
            temp.write_all(part).map_err(|_| VaultError::Write)?;
        }
        temp.as_file().sync_all().map_err(|_| VaultError::Write)?;
        if create {
            temp.persist_noclobber(&self.path)
                .map_err(|_| VaultError::Write)?;
        } else {
            temp.persist(&self.path).map_err(|_| VaultError::Write)?;
        }
        // Atomic replacement has committed at this point. Failure to sync a directory cannot
        // truthfully be reported as a rolled-back write. macOS performs this extra durability step.
        #[cfg(unix)]
        if let Ok(directory) = File::open(directory) {
            let _ = directory.sync_all();
        }
        Ok(())
    }
}
impl SecretStore for PassphraseStore {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>> {
        self.same(entry)?;
        Ok(self
            .value
            .lock()
            .map_err(|_| VaultError::Unavailable)?
            .clone())
    }
    fn save(&self, entry: &VaultEntry, secret: &[u8]) -> Result<()> {
        self.same(entry)?;
        validate(secret)?;
        let mut current = self.value.lock().map_err(|_| VaultError::Unavailable)?;
        self.persist(Some(secret), false)?;
        *current = Some(Zeroizing::new(secret.to_vec()));
        Ok(())
    }
    fn remove(&self, entry: &VaultEntry) -> Result<()> {
        self.same(entry)?;
        let mut current = self.value.lock().map_err(|_| VaultError::Unavailable)?;
        self.persist(None, false)?;
        *current = None;
        Ok(())
    }
}
fn context(entry: &VaultEntry) -> Result<Vec<u8>> {
    serde_json::to_vec(&(AAD, &entry.0)).map_err(|_| VaultError::Invalid)
}
fn derive(passphrase: &str, salt: &[u8; 16]) -> Result<Zeroizing<[u8; 32]>> {
    if !(12..=1024).contains(&passphrase.len()) {
        return Err(VaultError::Invalid);
    }
    // Version 1 has fixed parameters, so untrusted files cannot choose an unbounded KDF workload.
    let params = Params::new(64 * 1024, 3, 1, Some(32)).map_err(|_| VaultError::Invalid)?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| VaultError::Unavailable)?;
    Ok(key)
}
fn location(directory: &Path, entry: &VaultEntry) -> Result<(PathBuf, File)> {
    let directory = directory
        .canonicalize()
        .map_err(|_| VaultError::Unavailable)?;
    if !directory.is_dir() {
        return Err(VaultError::Invalid);
    }
    let path = directory.join(format!("{}.vault", entry.0));
    let lock_path = directory.join(format!("{}.lock", entry.0));
    if fs::symlink_metadata(&lock_path)
        .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err(VaultError::Invalid);
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(lock_path)
        .map_err(|_| VaultError::Unavailable)?;
    lock.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => VaultError::Busy,
        TryLockError::Error(_) => VaultError::Unavailable,
    })?;
    Ok((path, lock))
}
