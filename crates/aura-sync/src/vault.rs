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
mod directory;
pub use directory::PassphraseDirectory;

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
    /// The entry's name in the platform store (`auracode.sync.v1:<digest>`), as Credential Manager
    /// and Keychain Access show it. The digest names no account, email or folder.
    pub fn target(&self) -> String {
        format!("{SERVICE}:{}", self.0)
    }
    /// An entry the platform listed under auracode's own service ([`NativeStore::app_entries`]).
    /// Any other name, or an empty one, is refused.
    fn from_target(target: &str) -> Option<Self> {
        let name = target.strip_prefix(SERVICE)?.strip_prefix(':')?;
        (!name.is_empty() && !name.contains('\0')).then(|| Self(name.to_owned()))
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
    /// Every entry in auracode's own service, by name only. The data cleanup reads the data-folder
    /// indexes among them to tell which account keys another data folder still uses, so it never
    /// removes what another install of auracode on this machine needs. The platform does the
    /// matching (Windows filters Credential Manager by the `auracode.sync.v1:` target prefix,
    /// macOS the keychain by its service), so no other app's credential reaches this process, and
    /// each hit is checked again. Nothing is removed here.
    pub fn app_entries(&self) -> Result<Vec<VaultEntry>> {
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        #[cfg(windows)]
        let targets = credential_manager::list_prefixed(&format!("{SERVICE}:"))?;
        #[cfg(not(windows))]
        let targets = list_by_service(self.store.as_ref())?;
        Ok(app_entries(&targets))
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
/// The listed names that are auracode's own entries, sorted, each once.
fn app_entries(targets: &[String]) -> Vec<VaultEntry> {
    let mut entries: Vec<VaultEntry> = targets
        .iter()
        .filter_map(|target| VaultEntry::from_target(target))
        .collect();
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries.dedup();
    entries
}

/// The keychain listing: the store's own search by exact service, then a second check of each
/// hit, since a store may match loosely (keyring-core's mock matches substrings). Only names are
/// taken; no secret is read.
#[cfg_attr(windows, allow(dead_code))]
fn list_by_service(store: &keyring_core::CredentialStore) -> Result<Vec<String>> {
    let spec = std::collections::HashMap::from([("service", SERVICE)]);
    let entries = match store.search(&spec) {
        Ok(entries) => entries,
        Err(keyring_core::Error::NoEntry) => return Ok(Vec::new()),
        Err(error) => return Err(platform(error)),
    };
    let prefix = format!("{SERVICE}:");
    Ok(entries
        .iter()
        .filter_map(|entry| entry.get_specifiers())
        .filter(|(service, user)| service == SERVICE && user.starts_with(&prefix))
        .map(|(_, user)| user)
        .collect())
}

/// Credential Manager's own filtered enumeration: `CredEnumerateW` with a `prefix*` filter returns
/// only matching targets, so no other application's credential reaches this process. The FFI is
/// confined to this module, which is why it alone allows `unsafe`.
#[cfg(windows)]
#[allow(unsafe_code)]
mod credential_manager {
    use super::{Result, VaultError};
    use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredEnumerateW, CredFree,
    };

    pub(super) fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Reads a NUL-terminated UTF-16 string the API returned.
    ///
    /// # Safety
    /// `text` is null or points at a NUL-terminated UTF-16 string that outlives this call.
    unsafe fn read(text: *const u16) -> Option<String> {
        if text.is_null() {
            return None;
        }
        let mut length = 0;
        // SAFETY: the caller guarantees a terminated string; the loop stops at its NUL.
        while unsafe { *text.add(length) } != 0 {
            length += 1;
        }
        // SAFETY: `length` units were just read from the same allocation.
        String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) }).ok()
    }

    /// The generic credentials whose target starts with `prefix`, by target name. Their secret
    /// bytes are cleared before the buffer is freed and never leave this function.
    pub(super) fn list_prefixed(prefix: &str) -> Result<Vec<String>> {
        if prefix.is_empty() || prefix.contains('*') {
            return Err(VaultError::Invalid);
        }
        let filter = wide(&format!("{prefix}*"));
        let mut count = 0u32;
        let mut credentials: *mut *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: valid out pointers; the filter is NUL-terminated and lives across the call.
        let found = unsafe { CredEnumerateW(filter.as_ptr(), 0, &mut count, &mut credentials) };
        if found == 0 {
            // SAFETY: reads this thread's last error right after the failed call.
            return match unsafe { GetLastError() } {
                ERROR_NOT_FOUND => Ok(Vec::new()),
                _ => Err(VaultError::Unavailable),
            };
        }
        let mut targets = Vec::new();
        for index in 0..count as usize {
            // SAFETY: CredEnumerateW returned `count` valid credential pointers.
            let credential = unsafe { &**credentials.add(index) };
            if credential.CredentialBlobSize > 0 && !credential.CredentialBlob.is_null() {
                // Never keep secret bytes around, even our own: clear them before the free.
                // SAFETY: the blob is `CredentialBlobSize` bytes inside this allocation.
                unsafe {
                    std::ptr::write_bytes(
                        credential.CredentialBlob,
                        0,
                        credential.CredentialBlobSize as usize,
                    )
                };
            }
            // SAFETY: TargetName is a NUL-terminated string inside the same allocation.
            let target = unsafe { read(credential.TargetName) };
            if credential.Type == CRED_TYPE_GENERIC
                && let Some(target) = target
                && target.starts_with(prefix)
            {
                targets.push(target);
            }
        }
        // SAFETY: frees the one buffer CredEnumerateW allocated; nothing points into it now.
        unsafe { CredFree(credentials.cast()) };
        Ok(targets)
    }

    #[cfg(test)]
    mod tests {
        use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
        use windows_sys::Win32::Security::Credentials::CredDeleteW;

        #[test]
        fn refuses_an_empty_or_wildcard_prefix() {
            assert!(super::list_prefixed("").is_err());
            assert!(super::list_prefixed("auracode*").is_err());
        }

        /// Deletes one throwaway credential by its exact name; `false` when it was not there.
        fn delete(target: &str) -> bool {
            let name = super::wide(target);
            // SAFETY: a NUL-terminated target name that lives across the call.
            if unsafe { CredDeleteW(name.as_ptr(), super::CRED_TYPE_GENERIC, 0) } != 0 {
                return true;
            }
            // SAFETY: reads this thread's last error right after the failed call.
            assert_eq!(unsafe { GetLastError() }, ERROR_NOT_FOUND);
            false
        }

        /// Writes, lists and deletes throwaway session credentials under a random test-only
        /// prefix that is not auracode's (nothing named `auracode.sync.v1:` is listed or
        /// touched). Ignored by default because it uses the real Credential Manager:
        /// `cargo test -p aura-sync --lib credential_manager -- --ignored`.
        #[test]
        #[ignore = "uses the real Windows Credential Manager with a throwaway test prefix"]
        fn lists_only_targets_with_the_prefix() {
            use windows_sys::Win32::Security::Credentials::{
                CRED_PERSIST_SESSION, CREDENTIALW, CredWriteW,
            };
            let unique = format!(
                "{:x}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                std::process::id()
            );
            let prefix = format!("vault-list-test.{unique}:");
            let unrelated = format!("vault-list-test-other.{unique}:kept");
            let write = |target: &str| {
                let name = super::wide(target);
                let mut secret = *b"synthetic";
                let credential = CREDENTIALW {
                    Type: super::CRED_TYPE_GENERIC,
                    TargetName: name.as_ptr().cast_mut(),
                    CredentialBlobSize: secret.len() as u32,
                    CredentialBlob: secret.as_mut_ptr(),
                    Persist: CRED_PERSIST_SESSION,
                    ..Default::default()
                };
                // SAFETY: every pointer lives across the call.
                assert_ne!(unsafe { CredWriteW(&credential, 0) }, 0);
            };
            let one = format!("{prefix}one");
            let two = format!("{prefix}two");
            write(&one);
            write(&two);
            write(&unrelated);
            let mut listed = super::list_prefixed(&prefix).unwrap();
            listed.sort();
            // Listing removes nothing: all three are still there to delete by exact name.
            let deleted = [delete(&one), delete(&two), delete(&unrelated)];
            assert_eq!(listed, [one, two]);
            assert_eq!(deleted, [true, true, true]);
            assert!(super::list_prefixed(&prefix).unwrap().is_empty());
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
