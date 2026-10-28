//! auracode's entries in the OS secure store (Windows Credential Manager, the macOS keychain).
//!
//! Account ids are never written to disk: each data folder's account and profile index lives in
//! the secure store itself, under an entry named after the folder's real path. So the cleanup
//! reads that index first, removes the account keys it lists and then the index. In machine scope
//! it then sweeps auracode's own service for anything whose record is already gone (a data folder
//! deleted by hand, another data folder). A data folder chosen with `AURACODE_DATA_DIR` removes
//! only its own index: account keys can be shared with the installed app's data folder.

use std::path::PathBuf;

use aura_sync::vault::{NativeStore, SecretStore, VaultEntry, VaultError};
use zeroize::Zeroizing;

use super::Scope;

/// The account services the app can be built against (`AURACODE_API_ORIGIN`); entries for each
/// are looked for.
pub const ORIGINS: [&str; 2] = ["https://auracode.si", "https://preview.auracode.si"];

/// The secure store as the cleanup uses it. The app's is [`NativeStore`]; tests use a map.
pub trait AppVault: Send + Sync {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError>;
    fn remove(&self, entry: &VaultEntry) -> Result<(), VaultError>;
    /// Removes every remaining entry in auracode's own service and says how many went.
    fn sweep(&self) -> Result<usize, VaultError>;
}

impl AppVault for NativeStore {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        SecretStore::load(self, entry)
    }
    fn remove(&self, entry: &VaultEntry) -> Result<(), VaultError> {
        SecretStore::remove(self, entry)
    }
    fn sweep(&self) -> Result<usize, VaultError> {
        self.sweep_app_entries()
    }
}

/// What the secure-store part of a cleanup did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VaultReport {
    /// Data-folder indexes found and removed.
    pub indexes: usize,
    /// Account keys those indexes listed, removed.
    pub accounts: usize,
    /// Further entries the machine sweep removed.
    pub swept: usize,
    /// Why the secure store could not be cleaned, when it could not.
    pub error: Option<String>,
}

pub(super) fn clean(vault: &dyn AppVault, roots: &[PathBuf], scope: Scope) -> VaultReport {
    let mut report = VaultReport::default();
    let fail = |report: &mut VaultReport, error: VaultError| {
        report.error.get_or_insert_with(|| error.to_string());
    };
    for root in roots.iter().filter(|root| root.exists()) {
        for origin in ORIGINS {
            let Some(index) = crate::accounts::profile_index_entry(origin, root) else {
                continue;
            };
            let bytes = match vault.load(&index) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => continue,
                Err(error) => {
                    fail(&mut report, error);
                    continue;
                }
            };
            if scope == Scope::Machine {
                for account in listed_accounts(&bytes) {
                    let Ok(entry) = VaultEntry::new(origin, &account) else {
                        continue;
                    };
                    match vault.remove(&entry) {
                        Ok(()) => report.accounts += 1,
                        Err(error) => fail(&mut report, error),
                    }
                }
            }
            match vault.remove(&index) {
                Ok(()) => report.indexes += 1,
                Err(error) => fail(&mut report, error),
            }
        }
    }
    if scope == Scope::Machine {
        match vault.sweep() {
            Ok(count) => report.swept = count,
            Err(error) => fail(&mut report, error),
        }
    }
    report
}

/// Account ids in an index (`accounts`' keys, and a removal in progress), read leniently: an
/// index this version cannot fully parse still names the keys to remove.
fn listed_accounts(bytes: &[u8]) -> Vec<String> {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return Vec::new();
    };
    let mut accounts: Vec<String> = value
        .get("accounts")
        .and_then(|accounts| accounts.as_object())
        .map(|accounts| accounts.keys().cloned().collect())
        .unwrap_or_default();
    if let Some(account) = value
        .get("removal")
        .and_then(|removal| removal.get("account_id"))
        .and_then(|account| account.as_str())
        && !accounts.iter().any(|known| known == account)
    {
        accounts.push(account.to_owned());
    }
    accounts
}
