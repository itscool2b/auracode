//! Encrypted apply receipts bound to one owned Account profile. No receipt bytes or IDs are logged.
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use aura_config::sync::{
    ConfigApplyJournal, ConfigPortError, MAX_APPLY_RECEIPT_BYTES, MAX_APPLY_RECEIPTS,
};
use aura_sync::crypto::files::ProfileFileKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::profile_files::EncryptedRecord;

const INDEX_LIMIT: usize = 16 * 1024;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    ids: BTreeSet<String>,
}

/// The profile owner lock excludes other app processes. This mutex serializes local CAS operations
/// and invalidation, including callers that mistakenly retain the service after a profile switch.
pub struct AccountConfigJournal {
    directory: PathBuf,
    key: Arc<ProfileFileKey>,
    index: EncryptedRecord,
    active: Mutex<bool>,
}

impl AccountConfigJournal {
    pub fn open(directory: PathBuf, key: Arc<ProfileFileKey>) -> Result<Self, ConfigPortError> {
        let index = EncryptedRecord::open(
            &directory,
            "config-apply-index-v1",
            INDEX_LIMIT,
            key.clone(),
        )
        .map_err(|_| ConfigPortError::Invalid)?;
        index
            .initialize_empty_directory(b"{\"ids\":[]}")
            .map_err(|_| ConfigPortError::Invalid)?;
        let result = Self {
            directory,
            key,
            index,
            active: Mutex::new(true),
        };
        result.load_index()?;
        Ok(result)
    }

    /// Called only after successful profile publication. In-flight writes finish before it returns.
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

    fn load_index(&self) -> Result<Index, ConfigPortError> {
        let bytes = self
            .index
            .read()
            .map_err(|_| ConfigPortError::Invalid)?
            .ok_or(ConfigPortError::Invalid)?;
        let bytes = Zeroizing::new(bytes);
        let index: Index = serde_json::from_slice(&bytes).map_err(|_| ConfigPortError::Invalid)?;
        if index.ids.len() > MAX_APPLY_RECEIPTS {
            return Err(ConfigPortError::Limit);
        }
        for id in &index.ids {
            validate_id(id)?;
        }
        Ok(index)
    }

    fn record(&self, id: &str) -> Result<EncryptedRecord, ConfigPortError> {
        validate_id(id)?;
        EncryptedRecord::open(
            &self.directory,
            &format!("config-apply-{id}"),
            MAX_APPLY_RECEIPT_BYTES,
            self.key.clone(),
        )
        .map_err(|_| ConfigPortError::Invalid)
    }
}

impl ConfigApplyJournal for AccountConfigJournal {
    fn create(&self, id: &str, receipt: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError> {
        validate_receipt(&receipt)?;
        let _guard = self.guard()?;
        let mut index = self.load_index()?;
        let record = self.record(id)?;
        if !index.ids.contains(id) && index.ids.len() == MAX_APPLY_RECEIPTS {
            return Err(ConfigPortError::Limit);
        }
        match record
            .read()
            .map_err(|_| ConfigPortError::Invalid)?
            .map(Zeroizing::new)
        {
            Some(previous) if previous.as_slice() != receipt.as_slice() => {
                return Err(ConfigPortError::Stale);
            }
            Some(_) => {}
            None if index.ids.contains(id) => return Err(ConfigPortError::Invalid),
            None => record
                .write(&receipt)
                .map_err(|_| ConfigPortError::Storage)?,
        }
        // A failed index write leaves only authenticated ciphertext. Retrying the same ID accepts
        // only the exact original bytes, so failure cannot authorize an unjournaled filesystem edit.
        if index.ids.insert(id.to_owned()) {
            let encoded =
                Zeroizing::new(serde_json::to_vec(&index).map_err(|_| ConfigPortError::Invalid)?);
            self.index
                .write(&encoded)
                .map_err(|_| ConfigPortError::Storage)?;
        }
        Ok(())
    }

    fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        let _guard = self.guard()?;
        validate_id(id)?;
        if !self.load_index()?.ids.contains(id) {
            return Err(ConfigPortError::Invalid);
        }
        self.record(id)?
            .read()
            .map_err(|_| ConfigPortError::Invalid)?
            .map(Zeroizing::new)
            .ok_or(ConfigPortError::Invalid)
    }

    fn replace(
        &self,
        id: &str,
        expected_hash: &str,
        receipt: Zeroizing<Vec<u8>>,
    ) -> Result<(), ConfigPortError> {
        validate_receipt(&receipt)?;
        let _guard = self.guard()?;
        validate_id(id)?;
        if !self.load_index()?.ids.contains(id) {
            return Err(ConfigPortError::Invalid);
        }
        let record = self.record(id)?;
        let previous = Zeroizing::new(
            record
                .read()
                .map_err(|_| ConfigPortError::Invalid)?
                .ok_or(ConfigPortError::Invalid)?,
        );
        if expected_hash != format!("{:x}", Sha256::digest(&previous)) {
            return Err(ConfigPortError::Stale);
        }
        record.write(&receipt).map_err(|_| ConfigPortError::Storage)
    }

    fn list(&self) -> Result<Vec<String>, ConfigPortError> {
        let _guard = self.guard()?;
        Ok(self.load_index()?.ids.into_iter().collect())
    }
}

fn validate_id(id: &str) -> Result<(), ConfigPortError> {
    if uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.hyphenated().to_string() == id) {
        Ok(())
    } else {
        Err(ConfigPortError::Invalid)
    }
}
fn validate_receipt(bytes: &[u8]) -> Result<(), ConfigPortError> {
    if bytes.len() > MAX_APPLY_RECEIPT_BYTES {
        Err(ConfigPortError::Limit)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_sync::crypto::{AccountKey, files::Purpose};

    fn key() -> Arc<ProfileFileKey> {
        Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        )
    }
    fn bytes(value: &[u8]) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(value.to_vec())
    }

    #[test]
    fn receipts_are_encrypted_reopenable_and_cas_protected() {
        let dir = tempfile::tempdir().unwrap();
        let key = key();
        let journal = AccountConfigJournal::open(dir.path().into(), key.clone()).unwrap();
        let id = crate::ids::new_id();
        let first = b"private synthetic before and after file bytes";
        journal.create(&id, bytes(first)).unwrap();
        journal.create(&id, bytes(first)).unwrap();
        assert_eq!(
            journal.create(&id, bytes(b"different")),
            Err(ConfigPortError::Stale)
        );
        let hash = format!("{:x}", Sha256::digest(first));
        journal
            .replace(&id, &hash, bytes(b"private completed receipt"))
            .unwrap();
        assert_eq!(
            journal.replace(&id, &hash, bytes(b"stale")),
            Err(ConfigPortError::Stale)
        );
        for file in std::fs::read_dir(dir.path()).unwrap() {
            let file = file.unwrap();
            assert!(!file.file_name().to_string_lossy().contains(&id));
            let raw = std::fs::read(file.path()).unwrap();
            assert!(!raw.windows(7).any(|part| part == b"private"));
            assert!(!raw.windows(id.len()).any(|part| part == id.as_bytes()));
        }
        journal.close();
        assert_eq!(journal.list(), Err(ConfigPortError::Unavailable));
        assert_eq!(
            journal.create(&crate::ids::new_id(), bytes(b"late")),
            Err(ConfigPortError::Unavailable)
        );
        let reopened = AccountConfigJournal::open(dir.path().into(), key).unwrap();
        assert_eq!(reopened.list().unwrap(), vec![id.clone()]);
        assert_eq!(
            reopened.read(&id).unwrap().as_slice(),
            b"private completed receipt"
        );
        assert!(AccountConfigJournal::open(dir.path().into(), self::key()).is_err());
    }

    #[test]
    fn orphan_retry_requires_exact_bytes_and_corrupt_index_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let key = key();
        let journal = AccountConfigJournal::open(dir.path().into(), key.clone()).unwrap();
        let id = crate::ids::new_id();
        journal
            .record(&id)
            .unwrap()
            .write(b"orphan before index")
            .unwrap();
        assert_eq!(journal.read(&id), Err(ConfigPortError::Invalid));
        assert_eq!(
            journal.create(&id, bytes(b"replacement")),
            Err(ConfigPortError::Stale)
        );
        journal.create(&id, bytes(b"orphan before index")).unwrap();
        let path = dir.path().join(
            key.object_name(Purpose::Metadata, "config-apply-index-v1")
                .unwrap(),
        );
        let mut corrupt = std::fs::read(&path).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        std::fs::write(&path, &corrupt).unwrap();
        assert_eq!(journal.list(), Err(ConfigPortError::Invalid));
        assert_eq!(
            journal.create(&crate::ids::new_id(), bytes(b"cannot reset")),
            Err(ConfigPortError::Invalid)
        );
        assert_eq!(std::fs::read(&path).unwrap(), corrupt);
    }

    #[test]
    fn size_id_and_index_limits_fail_before_receipt_publication() {
        let dir = tempfile::tempdir().unwrap();
        let journal = AccountConfigJournal::open(dir.path().into(), key()).unwrap();
        assert_eq!(
            journal.create("../escape", bytes(b"x")),
            Err(ConfigPortError::Invalid)
        );
        assert_eq!(
            journal.create(
                &crate::ids::new_id(),
                Zeroizing::new(vec![0; MAX_APPLY_RECEIPT_BYTES + 1])
            ),
            Err(ConfigPortError::Limit)
        );
        let index = Index {
            ids: (0..MAX_APPLY_RECEIPTS)
                .map(|_| crate::ids::new_id())
                .collect(),
        };
        journal
            .index
            .write(&serde_json::to_vec(&index).unwrap())
            .unwrap();
        let id = crate::ids::new_id();
        assert_eq!(
            journal.create(&id, bytes(b"limit")),
            Err(ConfigPortError::Limit)
        );
        assert!(journal.record(&id).unwrap().read().unwrap().is_none());
    }

    #[test]
    fn missing_index_never_hides_existing_receipts_on_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let key = key();
        let journal = AccountConfigJournal::open(dir.path().into(), key.clone()).unwrap();
        let id = crate::ids::new_id();
        journal
            .create(&id, bytes(b"retain recovery evidence"))
            .unwrap();
        let index = dir.path().join(
            key.object_name(Purpose::Metadata, "config-apply-index-v1")
                .unwrap(),
        );
        std::fs::remove_file(index).unwrap();
        assert_eq!(journal.list(), Err(ConfigPortError::Invalid));
        assert!(AccountConfigJournal::open(dir.path().into(), key).is_err());
        assert_eq!(
            journal.record(&id).unwrap().read().unwrap().unwrap(),
            b"retain recovery evidence"
        );
    }
}
