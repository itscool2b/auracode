//! Encrypted profile-transition recovery. Only the strict, nonsecret locator lives outside the
//! owning Account profile. Each transaction gets its own bounded apply journal.
use super::journal::AccountConfigJournal;
use crate::profile_files::EncryptedRecord;
use aura_config::sync::{
    ConfigPortError,
    managed::MAX_MANAGED_BYTES,
    profile_transition::{ConfigTransitionStore, TransitionRead, TransitionRecord},
};
use aura_sync::crypto::files::ProfileFileKey;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, Weak},
};
use zeroize::Zeroizing;

#[derive(Default)]
struct State {
    closed: bool,
    journals: Vec<Weak<AccountConfigJournal>>,
}
pub struct AccountConfigTransitions {
    record: EncryptedRecord,
    journals: PathBuf,
    key: Arc<ProfileFileKey>,
    state: Mutex<State>,
}
impl AccountConfigTransitions {
    pub fn open(profile: &Path, key: Arc<ProfileFileKey>) -> Result<Self, ConfigPortError> {
        let record = EncryptedRecord::open(
            &profile.join("config-transition"),
            "config-transition-v1",
            MAX_MANAGED_BYTES,
            key.clone(),
        )
        .map_err(|_| ConfigPortError::Invalid)?;
        record
            .initialize_empty_directory(b"null")
            .map_err(|_| ConfigPortError::Invalid)?;
        let store = Self {
            record,
            journals: profile.join("config-transition-journals"),
            key,
            state: Mutex::default(),
        };
        store.load()?;
        Ok(store)
    }
    pub fn journal(&self, id: &str) -> Result<Arc<AccountConfigJournal>, ConfigPortError> {
        if !uuid::Uuid::parse_str(id).is_ok_and(|id_value| id_value.to_string() == id) {
            return Err(ConfigPortError::Invalid);
        }
        let mut state = self.guard()?;
        let journal = Arc::new(AccountConfigJournal::open(
            self.journals.join(id),
            self.key.clone(),
        )?);
        state.journals.retain(|journal| journal.strong_count() != 0);
        state.journals.push(Arc::downgrade(&journal));
        Ok(journal)
    }
    pub fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            for journal in state.journals.drain(..).filter_map(|weak| weak.upgrade()) {
                journal.close();
            }
        }
    }
    fn guard(&self) -> Result<MutexGuard<'_, State>, ConfigPortError> {
        let state = self
            .state
            .lock()
            .map_err(|_| ConfigPortError::Unavailable)?;
        if state.closed {
            return Err(ConfigPortError::Unavailable);
        }
        Ok(state)
    }
    fn read(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.record
            .read()
            .map_err(|_| ConfigPortError::Invalid)?
            .map(Zeroizing::new)
            .ok_or(ConfigPortError::Invalid)
    }
}
impl ConfigTransitionStore for AccountConfigTransitions {
    fn load(&self) -> Result<Option<TransitionRead>, ConfigPortError> {
        let _guard = self.guard()?;
        let bytes = self.read()?;
        if bytes.as_slice() == b"null" {
            return Ok(None);
        }
        Ok(Some(TransitionRead {
            revision: format!("{:x}", Sha256::digest(&bytes)),
            record: TransitionRecord::decode(&bytes)?,
        }))
    }
    fn save(
        &self,
        expected_revision: Option<&str>,
        record: &TransitionRecord,
    ) -> Result<(), ConfigPortError> {
        let bytes = record.encode()?;
        let _guard = self.guard()?;
        let previous = self.read()?;
        let previous_revision = if previous.as_slice() == b"null" {
            None
        } else {
            TransitionRecord::decode(&previous)?;
            Some(format!("{:x}", Sha256::digest(&previous)))
        };
        if previous_revision.as_deref() != expected_revision {
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
    use aura_config::sync::{ConfigApplyJournal, profile_transition::TransitionPhase};
    use aura_sync::crypto::AccountKey;
    fn key() -> Arc<ProfileFileKey> {
        Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        )
    }
    #[test]
    fn transition_and_receipts_are_encrypted_reopenable_and_close_together() {
        let temp = tempfile::tempdir().unwrap();
        let key = key();
        let store = AccountConfigTransitions::open(temp.path(), key.clone()).unwrap();
        assert!(store.load().unwrap().is_none());
        let record = TransitionRecord {
            schema: 1,
            id: uuid::Uuid::now_v7().to_string(),
            from_profile: "local".into(),
            to_profile: uuid::Uuid::now_v7().to_string(),
            phase: TransitionPhase::Prepared,
            realms: [("home".into(), "private synthetic realm".into())].into(),
            steps: vec![],
        };
        store.save(None, &record).unwrap();
        assert_eq!(store.save(None, &record), Err(ConfigPortError::Stale));
        let receipt_id = uuid::Uuid::now_v7().to_string();
        let journal = store.journal(&record.id).unwrap();
        journal
            .create(
                &receipt_id,
                Zeroizing::new(b"private synthetic receipt".to_vec()),
            )
            .unwrap();
        assert!(store.journal("../../outside").is_err());
        let reopened = AccountConfigTransitions::open(temp.path(), key).unwrap();
        assert_eq!(reopened.load().unwrap().unwrap().record.id, record.id);
        assert_eq!(
            reopened
                .journal(&record.id)
                .unwrap()
                .read(&receipt_id)
                .unwrap()
                .as_slice(),
            b"private synthetic receipt"
        );
        assert!(AccountConfigTransitions::open(temp.path(), self::key()).is_err());
        fn check(path: &Path) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    check(&path);
                } else {
                    assert!(
                        !std::fs::read(path)
                            .unwrap()
                            .windows(7)
                            .any(|bytes| bytes == b"private")
                    );
                }
            }
        }
        check(temp.path());
        store.close();
        assert!(matches!(store.load(), Err(ConfigPortError::Unavailable)));
        assert!(matches!(journal.list(), Err(ConfigPortError::Unavailable)));
    }
}
