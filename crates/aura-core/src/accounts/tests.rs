use super::*;
use aura_sync::vault::VaultError;
use std::{collections::HashMap, sync::Mutex as StdMutex};

#[derive(Default)]
struct Memory {
    values: StdMutex<HashMap<VaultEntry, Vec<u8>>>,
    writes: StdMutex<usize>,
}
impl SecretStore for Memory {
    fn load(&self, entry: &VaultEntry) -> aura_sync::vault::Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(entry)
            .cloned()
            .map(Zeroizing::new))
    }
    fn save(&self, entry: &VaultEntry, bytes: &[u8]) -> aura_sync::vault::Result<()> {
        self.values
            .lock()
            .unwrap()
            .insert(entry.clone(), bytes.into());
        *self.writes.lock().unwrap() += 1;
        Ok(())
    }
    fn remove(&self, entry: &VaultEntry) -> aura_sync::vault::Result<()> {
        self.values.lock().unwrap().remove(entry);
        Ok(())
    }
}
const ORIGIN: &str = "https://accounts.example.test";
fn api() -> ApiClient {
    ApiClient::new(ORIGIN).unwrap()
}
fn profiles(dir: &tempfile::TempDir) -> Profiles {
    Profiles::new(crate::paths::DataRoot::at(dir.path()))
}

/// Synthetic documented bundle: a confirmed local key with no bearer. Restoration is offline.
fn seed_key(vault: &Memory) {
    let mut bytes = b"AURA-ACCOUNT\x01".to_vec();
    bytes.extend_from_slice(&[3; 32]);
    bytes.push(6);
    bytes.extend_from_slice(b"device");
    bytes.push(0); // signed out
    bytes.push(1); // account key present
    bytes.extend_from_slice(&1_u32.to_be_bytes());
    bytes.extend_from_slice(&[1, 1]); // confirmed, locally proven
    bytes.extend_from_slice(&[7; 32]);
    vault
        .save(&VaultEntry::new(ORIGIN, "account").unwrap(), &bytes)
        .unwrap();
}

#[tokio::test]
async fn opening_and_status_never_create_profile_or_contact_service() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Arc::new(Memory::default());
    let accounts = Accounts::open(api(), vault.clone(), profiles(&dir))
        .await
        .unwrap();
    let view = accounts.status().await.unwrap();
    assert_eq!(view.access, AccountAccess::SignedOut);
    assert_eq!(view.sync.state, AccountSyncState::Inactive);
    assert_eq!(*vault.writes.lock().unwrap(), 0);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    assert_eq!(
        std::fs::metadata(dir.path().join("accounts.lock"))
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        accounts.local_profile().await.err().unwrap().code,
        AccountFailureCode::InvalidState
    );
}

#[tokio::test]
async fn confirmed_offline_key_creates_one_opaque_profile_without_activating_it() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    let local = profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    {
        let mut inner = accounts.inner.lock().await;
        inner.index.ensure("account").unwrap();
        inner.account = Account::restore(api(), "account", vault.clone(), 100)
            .await
            .unwrap();
    }
    let first = accounts.local_profile().await.unwrap();
    let second = accounts.local_profile().await.unwrap();
    assert_eq!(first.profile, second.profile);
    assert_eq!(first.profile.meta.display_name, "Account");
    assert!(uuid::Uuid::parse_str(&first.profile.meta.id).is_ok());
    assert_eq!(profiles.open_active().unwrap(), local);
    let metadata = std::fs::read_to_string(first.profile.meta_path()).unwrap();
    let metadata: serde_json::Value = serde_json::from_str(&metadata).unwrap();
    assert!(metadata.get("account_id").is_none());
    assert!(metadata.get("email").is_none());
    drop(accounts);
    let reopened = Accounts::open(api(), vault, profiles).await.unwrap();
    let status = reopened
        .restore_profile(&first.profile.meta.id, 100)
        .await
        .unwrap();
    assert_eq!(status.access, AccountAccess::SignedOut);
    assert!(status.local_key_available);
    assert_eq!(
        status.profile_id.as_deref(),
        Some(first.profile.meta.id.as_str())
    );
    assert!(status.fingerprint.is_some());
}

#[tokio::test]
async fn malformed_index_is_preserved_and_cannot_select_local_profile() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Arc::new(Memory::default());
    let entry = index::entry(api().origin(), dir.path()).unwrap();
    let bytes = br#"{"version":1,"accounts":{"account":"local"}}"#;
    vault.save(&entry, bytes).unwrap();
    assert_eq!(
        Accounts::open(api(), vault.clone(), profiles(&dir))
            .await
            .err()
            .unwrap()
            .code,
        AccountFailureCode::SecureStorage
    );
    assert_eq!(vault.load(&entry).unwrap().unwrap().as_slice(), bytes);
}

#[tokio::test]
async fn index_rejects_duplicate_profile_bindings_and_future_version() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Arc::new(Memory::default());
    let entry = index::entry(api().origin(), dir.path()).unwrap();
    let profile = crate::ids::new_id();
    for value in [
        serde_json::json!({"version":1,"accounts":{"one":profile,"two":profile}}),
        serde_json::json!({"version":2,"accounts":{}}),
    ] {
        let bytes = serde_json::to_vec(&value).unwrap();
        vault.save(&entry, &bytes).unwrap();
        assert!(
            Accounts::open(api(), vault.clone(), profiles(&dir))
                .await
                .is_err()
        );
        assert_eq!(vault.load(&entry).unwrap().unwrap().as_slice(), bytes);
    }
}

#[tokio::test]
async fn concurrent_mutations_and_unknown_recovery_confirmation_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let accounts = Accounts::open(api(), Arc::new(Memory::default()), profiles(&dir))
        .await
        .unwrap();
    let guard = accounts.inner.lock().await;
    assert_eq!(
        accounts.refresh(100).await.unwrap_err().code,
        AccountFailureCode::InvalidState
    );
    drop(guard);
    assert_eq!(
        accounts
            .confirm_recovery("unknown", true, 100)
            .await
            .unwrap_err()
            .code,
        AccountFailureCode::InvalidState
    );
    assert_eq!(
        accounts
            .verify_code("unknown", "123456")
            .await
            .unwrap_err()
            .code,
        AccountFailureCode::InvalidState
    );
}

#[test]
fn index_namespace_cannot_alias_remote_account_or_other_data_root() {
    let index = VaultEntry::profile_index(ORIGIN, "root-a").unwrap();
    assert_ne!(index, VaultEntry::new(ORIGIN, "profile-index").unwrap());
    assert_ne!(index, VaultEntry::profile_index(ORIGIN, "root-b").unwrap());
    assert_ne!(
        index,
        VaultEntry::profile_index("https://other.example.test", "root-a").unwrap()
    );
}

#[test]
fn cooldown_errors_are_structured_and_recovery_debug_is_redacted() {
    let failure = error::api(aura_sync::api::ApiError::DeliveryFailed {
        retry_after_seconds: 75,
    });
    assert_eq!(failure.retry_after_seconds, Some(75));
    assert_eq!(failure.code, AccountFailureCode::DeliveryFailed);
    let setup = RecoverySetup {
        id: "setup".into(),
        recovery_key: "secret recovery key".into(),
    };
    assert!(!format!("{setup:?}").contains("secret recovery key"));
    assert_eq!(millis(12).unwrap(), 12_000);
    assert!(millis(i64::MAX).is_err());
    assert!(millis(-1).is_err());
    assert_eq!(
        error::vault(VaultError::Unavailable).code,
        AccountFailureCode::SecureStorage
    );
}

#[tokio::test]
async fn second_owner_is_refused_without_reading_or_replacing_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Arc::new(Memory::default());
    let first = Accounts::open(api(), vault.clone(), profiles(&dir))
        .await
        .unwrap();
    assert_eq!(
        Accounts::open(api(), vault.clone(), profiles(&dir))
            .await
            .err()
            .unwrap()
            .code,
        AccountFailureCode::LocalStorage
    );
    assert_eq!(*vault.writes.lock().unwrap(), 0);
    drop(first);
    assert!(Accounts::open(api(), vault, profiles(&dir)).await.is_ok());
    assert!(dir.path().join("accounts.lock").exists());
}
