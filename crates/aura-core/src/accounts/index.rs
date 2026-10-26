//! Only auracode's selected secure store holds account/profile bindings. No email is retained.
use super::{Result, error};
use aura_sync::vault::{SecretStore, VaultEntry};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};
use zeroize::Zeroizing;

const LIMIT: usize = 8;

pub(super) fn entry(origin: &str, root: &std::path::Path) -> Result<VaultEntry> {
    use sha2::{Digest, Sha256};
    let canonical = std::fs::canonicalize(root).map_err(|_| error::storage())?;
    let scope = format!(
        "{:x}",
        Sha256::digest(canonical.as_os_str().as_encoded_bytes())
    );
    VaultEntry::profile_index(origin, &scope).map_err(error::vault)
}

/// The index is replaced atomically in the vault, but its read-modify-write cycle also needs one
/// owner across processes. An empty operational lock reveals no account or profile metadata.
pub(super) fn acquire(root: &std::path::Path) -> Result<aura_process::locked_file::LockedFile> {
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
    use cap_std::fs::{Dir, OpenOptions};
    let dir =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| error::storage())?;
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = dir
        .open_with("accounts.lock", &options)
        .map_err(|_| error::storage())?
        .into_std();
    if !file.metadata().map_err(|_| error::storage())?.is_file() {
        return Err(error::storage());
    }
    file.try_lock().map_err(|_| error::failure(aura_protocol::account::AccountFailureCode::LocalStorage, "Another auracode instance is using accounts in this data folder, or the folder does not support ownership locks."))?;
    Ok(aura_process::locked_file::LockedFile::new(file))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Index {
    version: u8,
    pub accounts: BTreeMap<String, Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removal: Option<super::removal::Receipt>,
}
impl Default for Index {
    fn default() -> Self {
        Self {
            version: 1,
            accounts: BTreeMap::new(),
            removal: None,
        }
    }
}
impl Index {
    pub fn ensure(&mut self, account: &str) -> Result<()> {
        if !self.accounts.contains_key(account) && self.accounts.len() >= LIMIT {
            return Err(error::failure(
                aura_protocol::account::AccountFailureCode::InvalidState,
                "This local data folder already remembers eight accounts.",
            ));
        }
        self.accounts.entry(account.into()).or_default();
        Ok(())
    }
    pub async fn load(
        store: Arc<dyn SecretStore>,
        entry: VaultEntry,
        origin: String,
    ) -> Result<Self> {
        tokio::task::spawn_blocking(move || {
            let Some(bytes) = store.load(&entry).map_err(error::vault)? else {
                return Ok(Self::default());
            };
            let index: Self = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
            if !(1..=2).contains(&index.version)
                || index.accounts.len() > LIMIT
                || (index.version == 1 && index.removal.is_some())
            {
                return Err(invalid());
            }
            let mut profiles = std::collections::HashSet::new();
            for (account, profile) in &index.accounts {
                VaultEntry::new(&origin, account).map_err(|_| invalid())?;
                if let Some(profile) = profile {
                    let parsed = uuid::Uuid::parse_str(profile).map_err(|_| invalid())?;
                    if parsed.hyphenated().to_string() != *profile || !profiles.insert(profile) {
                        return Err(invalid());
                    }
                }
            }
            if index
                .removal
                .as_ref()
                .is_some_and(|receipt| !receipt.valid(&index))
            {
                return Err(invalid());
            }
            Ok(index)
        })
        .await
        .map_err(|_| invalid())?
    }
    pub async fn save(&self, store: Arc<dyn SecretStore>, entry: VaultEntry) -> Result<()> {
        let mut saved = self.clone();
        saved.version = 2;
        let bytes = Zeroizing::new(serde_json::to_vec(&saved).map_err(|_| invalid())?);
        tokio::task::spawn_blocking(move || store.save(&entry, &bytes).map_err(error::vault))
            .await
            .map_err(|_| invalid())?
    }
}
fn invalid() -> aura_protocol::account::AccountFailure {
    error::failure(
        aura_protocol::account::AccountFailureCode::SecureStorage,
        "The saved account profile index is invalid or unsupported. It was preserved.",
    )
}
