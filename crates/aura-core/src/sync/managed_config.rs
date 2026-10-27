//! One atomic encrypted ownership document per Account. No plaintext index or config sidecars.
use crate::profile_files::EncryptedRecord;
use aura_config::sync::{
    ConfigPortError,
    managed::{ConfigManagedStore, MAX_MANAGED_BYTES, ManagedDocument, ManagedRead},
};
use aura_sync::crypto::files::ProfileFileKey;
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};
use zeroize::Zeroizing;

pub struct AccountManagedConfig {
    record: EncryptedRecord,
    active: Mutex<bool>,
}
impl AccountManagedConfig {
    pub fn open(directory: &Path, key: Arc<ProfileFileKey>) -> Result<Self, ConfigPortError> {
        let record = EncryptedRecord::open(directory, "config-managed-v1", MAX_MANAGED_BYTES, key)
            .map_err(|_| ConfigPortError::Invalid)?;
        record
            .initialize_empty_directory(&ManagedDocument::default().encode()?)
            .map_err(|_| ConfigPortError::Invalid)?;
        let store = Self {
            record,
            active: Mutex::new(true),
        };
        store.load()?;
        Ok(store)
    }
    pub fn close(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = false;
        }
    }
    fn guard(&self) -> Result<MutexGuard<'_, bool>, ConfigPortError> {
        let active = self
            .active
            .lock()
            .map_err(|_| ConfigPortError::Unavailable)?;
        if !*active {
            return Err(ConfigPortError::Unavailable);
        }
        Ok(active)
    }
    fn read(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.record
            .read()
            .map_err(|_| ConfigPortError::Invalid)?
            .map(Zeroizing::new)
            .ok_or(ConfigPortError::Invalid)
    }
}
impl ConfigManagedStore for AccountManagedConfig {
    fn load(&self) -> Result<ManagedRead, ConfigPortError> {
        let _guard = self.guard()?;
        let bytes = self.read()?;
        Ok(ManagedRead {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            document: ManagedDocument::decode(&bytes)?,
        })
    }
    fn save(
        &self,
        expected_revision: &str,
        document: &ManagedDocument,
    ) -> Result<(), ConfigPortError> {
        let bytes = document.encode()?;
        let _guard = self.guard()?;
        let previous = self.read()?;
        if format!("{:x}", Sha256::digest(&previous)) != expected_revision {
            return Err(ConfigPortError::Stale);
        }
        self.record
            .write(&bytes)
            .map_err(|_| ConfigPortError::Storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_config::{
        Provider,
        sync::{
            ConfigContent, ConfigFormat, ConfigIdentity, ConfigScope, ConfigSnapshot,
            LocalSnapshot,
            managed::{commit_claim, prepare_claim},
        },
    };
    use aura_sync::crypto::AccountKey;
    fn key() -> Arc<ProfileFileKey> {
        Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("fixture-account", "fixture-profile")
                .unwrap(),
        )
    }
    fn snapshot(value: &str) -> ConfigSnapshot {
        ConfigSnapshot {
            schema: 1,
            identity: ConfigIdentity {
                provider: Provider::Claude,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Json,
                path: "settings.json".into(),
                keys: vec!["model".into()],
            },
            content: Some(ConfigContent::Value(value.into())),
            local_fields: vec![],
        }
    }
    #[test]
    fn ownership_is_encrypted_reopenable_cas_guarded_and_invalidated_with_profile() {
        let temp = tempfile::tempdir().unwrap();
        let key = key();
        let store = AccountManagedConfig::open(temp.path(), key.clone()).unwrap();
        let previous = store.load().unwrap();
        let baseline = snapshot("private-original-model");
        let desired = snapshot("private-account-model");
        let claim =
            prepare_claim(&store, &LocalSnapshot::Present(baseline.clone()), &desired).unwrap();
        assert_eq!(
            store.save(&previous.revision, &previous.document),
            Err(ConfigPortError::Stale)
        );
        commit_claim(&store, &claim, &desired).unwrap();
        for file in std::fs::read_dir(temp.path()).unwrap() {
            let bytes = std::fs::read(file.unwrap().path()).unwrap();
            assert!(!bytes.windows(13).any(|part| part == b"private-accou"));
        }
        let reopened = AccountManagedConfig::open(temp.path(), key).unwrap();
        let read = reopened.load().unwrap();
        let item = &read.document.items[&claim.id];
        assert!(item.baseline == baseline);
        assert!(item.saved == desired);
        assert!(item.committed);
        assert!(AccountManagedConfig::open(temp.path(), self::key()).is_err());
        reopened.close();
        assert!(matches!(reopened.load(), Err(ConfigPortError::Unavailable)));
    }
}
