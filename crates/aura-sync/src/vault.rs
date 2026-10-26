//! App-owned secrets only. Stores are explicit and never enumerate vendor credentials.
//!
//! Call blocking vault operations on a blocking worker. A single bounded bundle per account makes
//! replacement atomic: an auth coordinator can remove the session while retaining local data keys.
use crate::crypto;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use zeroize::{Zeroize, Zeroizing};

mod passphrase;
pub use passphrase::PassphraseStore;

const SERVICE: &str = "auracode.sync.v1";
const MAX_SECRET: usize = 2048;
// The Windows provider requires same-entry operations to be serialized across threads. This also
// covers multiple NativeStore handles in one process. It never guards a network request.
static NATIVE_ACCESS: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum VaultError {
    #[error(
        "Secure storage is unavailable or locked. Unlock it or explicitly choose a passphrase store."
    )]
    Unavailable,
    #[error("This encrypted store is already open in another process.")]
    Busy,
    #[error("The secure-store input is invalid.")]
    Invalid,
    #[error("The encrypted store is damaged or uses an unsupported version.")]
    Corrupt,
    #[error("The passphrase is incorrect or the encrypted store is damaged.")]
    Unlock,
    #[error("The encrypted store could not be saved. The previous value remains available.")]
    Write,
}
pub type Result<T> = std::result::Result<T, VaultError>;

/// Opaque identity bound to a canonical HTTPS service origin and account. Callers cannot select
/// arbitrary keychain services or vendor entries. Names do not contain email addresses.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct VaultEntry(String);
impl VaultEntry {
    /// App-owned profile bindings have a separate namespace from every remote account ID.
    /// `scope` identifies one local data root, but only its digest enters the platform entry name.
    pub fn profile_index(origin: &str, scope: &str) -> Result<Self> {
        let origin_entry = Self::new(origin, "profile-index")?;
        if scope.is_empty() || scope.len() > 32 * 1024 {
            return Err(VaultError::Invalid);
        }
        let tuple = serde_json::to_vec(&("auracode-profile-index-v1", origin_entry.0, scope))
            .map_err(|_| VaultError::Invalid)?;
        Ok(Self(crypto::encode(&Sha256::digest(tuple))))
    }
    pub fn new(origin: &str, account: &str) -> Result<Self> {
        crypto::identifier(account).map_err(|_| VaultError::Invalid)?;
        let origin = reqwest::Url::parse(origin).map_err(|_| VaultError::Invalid)?;
        if origin.scheme() != "https"
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(VaultError::Invalid);
        }
        let tuple = serde_json::to_vec(&(SERVICE, origin.as_str(), account))
            .map_err(|_| VaultError::Invalid)?;
        Ok(Self(crypto::encode(&Sha256::digest(tuple))))
    }
}

/// No plaintext fallback exists. Production chooses NativeStore, or PassphraseStore only after an
/// explicit user choice. Neither implementation logs the data or raw platform errors.
pub trait SecretStore: Send + Sync {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>>;
    fn save(&self, entry: &VaultEntry, secret: &[u8]) -> Result<()>;
    fn remove(&self, entry: &VaultEntry) -> Result<()>;
}

pub struct NativeStore {
    store: Arc<keyring_core::CredentialStore>,
}
impl NativeStore {
    /// This constructs a provider, without reading or writing any credential.
    pub fn new() -> Result<Self> {
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new().map_err(platform)?;
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new().map_err(platform)?;
        #[cfg(not(any(windows, target_os = "macos")))]
        return Err(VaultError::Unavailable);
        #[cfg(any(windows, target_os = "macos"))]
        Ok(Self { store })
    }
    fn entry(&self, entry: &VaultEntry) -> Result<keyring_core::Entry> {
        let target = format!("{SERVICE}:{}", entry.0);
        #[cfg(windows)]
        let modifiers = std::collections::HashMap::from([
            ("target", target.as_str()),
            ("persistence", "Local"),
        ]);
        #[cfg(not(windows))]
        let modifiers = std::collections::HashMap::new();
        self.store
            .build(SERVICE, &target, Some(&modifiers))
            .map_err(platform)
    }
}
impl SecretStore for NativeStore {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        match self.entry(entry)?.get_secret() {
            Ok(secret) => {
                let secret = Zeroizing::new(secret);
                validate(&secret).map_err(|_| VaultError::Corrupt)?;
                Ok(Some(secret))
            }
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(platform(error)),
        }
    }
    fn save(&self, entry: &VaultEntry, secret: &[u8]) -> Result<()> {
        validate(secret)?;
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        self.entry(entry)?.set_secret(secret).map_err(platform)
    }
    fn remove(&self, entry: &VaultEntry) -> Result<()> {
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        match self.entry(entry)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(platform(error)),
        }
    }
}
fn validate(secret: &[u8]) -> Result<()> {
    if secret.is_empty() || secret.len() > MAX_SECRET {
        Err(VaultError::Invalid)
    } else {
        Ok(())
    }
}
fn platform(error: keyring_core::Error) -> VaultError {
    // Some provider errors carry failed secret bytes. Clear them before dropping; never format them.
    match error {
        keyring_core::Error::BadEncoding(mut bytes)
        | keyring_core::Error::BadDataFormat(mut bytes, _) => {
            bytes.zeroize();
            VaultError::Corrupt
        }
        _ => VaultError::Unavailable,
    }
}

#[cfg(test)]
mod tests;
