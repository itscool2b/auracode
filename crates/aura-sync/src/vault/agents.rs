//! Sign-in tokens of the agent accounts a person adds in auracode, one entry per account.
//!
//! They live in a service of their own (`auracode.agents.v1`), so the sync key review and its
//! cleanup never meet them and they never meet sync keys. An entry's name is a digest of the
//! account's id, a UUIDv7 no other install shares: it names no account, email or folder, and a
//! data cleanup finds every entry from the ids its profiles list. Call these on a blocking worker.
use super::{NATIVE_ACCESS, Result, VaultError, platform, validate};
use crate::crypto;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use zeroize::Zeroizing;

const SERVICE: &str = "auracode.agents.v1";

/// One account's entry, by the account's id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TokenEntry(String);
impl TokenEntry {
    pub fn new(account: &str) -> Result<Self> {
        if account.is_empty() || account.len() > 128 {
            return Err(VaultError::Invalid);
        }
        let tuple = serde_json::to_vec(&("auracode-agent-token-v1", account))
            .map_err(|_| VaultError::Invalid)?;
        Ok(Self(crypto::encode(&Sha256::digest(tuple))))
    }
    /// The entry's name in the platform store, as Credential Manager and Keychain Access show it.
    pub fn target(&self) -> String {
        format!("{SERVICE}:{}", self.0)
    }
}

/// Where account tokens are kept. There is no plaintext fallback.
pub trait TokenStore: Send + Sync {
    fn load(&self, entry: &TokenEntry) -> Result<Option<Zeroizing<Vec<u8>>>>;
    fn save(&self, entry: &TokenEntry, secret: &[u8]) -> Result<()>;
    fn remove(&self, entry: &TokenEntry) -> Result<()>;
}

/// Credential Manager on Windows, the login keychain on macOS, the Secret Service (GNOME Keyring,
/// KWallet) on Linux. Elsewhere it is unavailable.
pub struct NativeTokens {
    store: Arc<keyring_core::CredentialStore>,
}
impl NativeTokens {
    /// Constructs the provider without reading or writing any credential.
    pub fn new() -> Result<Self> {
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new().map_err(platform)?;
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new().map_err(platform)?;
        #[cfg(target_os = "linux")]
        let store = zbus_secret_service_keyring_store::Store::new().map_err(platform)?;
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        return Err(VaultError::Unavailable);
        #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
        Ok(Self { store })
    }
    fn entry(&self, entry: &TokenEntry) -> Result<keyring_core::Entry> {
        let target = entry.target();
        #[cfg(windows)]
        let modifiers = std::collections::HashMap::from([
            ("target", target.as_str()),
            ("persistence", "Local"),
        ]);
        // A Secret Service `target` names a collection to create, so Linux sets only the label,
        // which shows the entry under its target name as the other platforms do.
        #[cfg(target_os = "linux")]
        let modifiers = std::collections::HashMap::from([("label", target.as_str())]);
        #[cfg(not(any(windows, target_os = "linux")))]
        let modifiers = std::collections::HashMap::new();
        self.store
            .build(SERVICE, &target, Some(&modifiers))
            .map_err(platform)
    }
}
impl TokenStore for NativeTokens {
    fn load(&self, entry: &TokenEntry) -> Result<Option<Zeroizing<Vec<u8>>>> {
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
    fn save(&self, entry: &TokenEntry, secret: &[u8]) -> Result<()> {
        validate(secret)?;
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        self.entry(entry)?.set_secret(secret).map_err(platform)
    }
    fn remove(&self, entry: &TokenEntry) -> Result<()> {
        let _guard = NATIVE_ACCESS.lock().map_err(|_| VaultError::Unavailable)?;
        match self.entry(entry)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(platform(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_never_name_the_account() {
        let id = "01a1982d-2146-759a-a84c-cc94c4774f76";
        let entry = TokenEntry::new(id).unwrap();
        let target = entry.target();
        assert!(target.starts_with("auracode.agents.v1:"), "{target}");
        assert!(!target.contains("01a1982d"), "{target}");
        assert_eq!(
            entry,
            TokenEntry::new(id).unwrap(),
            "stable for one account"
        );
        assert_ne!(
            entry,
            TokenEntry::new("01a1982d-2146-759a-a84c-cc94c4774f77").unwrap()
        );
        assert!(TokenEntry::new("").is_err());
        assert!(TokenEntry::new(&"a".repeat(129)).is_err());
    }
}
