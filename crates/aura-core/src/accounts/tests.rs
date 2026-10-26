use super::*;
use aura_sync::vault::VaultError;
use std::{collections::HashMap, sync::Mutex as StdMutex};

#[derive(Default)]
struct Memory {
    values: StdMutex<HashMap<VaultEntry, Vec<u8>>>,
    writes: StdMutex<usize>,
    fail_entry: StdMutex<Option<VaultEntry>>,
    fail_remove: StdMutex<bool>,
    fail_write_at: StdMutex<Option<usize>>,
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
        if *self.fail_write_at.lock().unwrap() == Some(*self.writes.lock().unwrap() + 1) {
            return Err(VaultError::Write);
        }
        if self.fail_entry.lock().unwrap().as_ref() == Some(entry) {
            return Err(VaultError::Write);
        }
        self.values
            .lock()
            .unwrap()
            .insert(entry.clone(), bytes.into());
        *self.writes.lock().unwrap() += 1;
        Ok(())
    }
    fn remove(&self, entry: &VaultEntry) -> aura_sync::vault::Result<()> {
        if *self.fail_remove.lock().unwrap() {
            return Err(VaultError::Write);
        }
        self.values.lock().unwrap().remove(entry);
        Ok(())
    }
}

#[tokio::test]
async fn removal_requires_local_and_explicit_review_then_retains_receipt_through_key_failure() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    accounts.inner.lock().await.account = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap();
    let profile = accounts.local_profile().await.unwrap().profile;
    let other = profiles
        .create(ProfileKind::Account, "Other workspace")
        .unwrap();
    std::fs::write(other.db_path(), b"unrelated retained ciphertext").unwrap();
    std::fs::write(profile.db_path(), b"selected synthetic ciphertext").unwrap();
    profiles.set_active(&profile.meta.id).unwrap();
    assert!(
        accounts
            .prepare_removal(&profile.meta.id, 100)
            .await
            .is_err()
    );
    profiles.set_active("local").unwrap();
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    assert!(
        accounts
            .remove_from_device(&review.token, "wrong")
            .await
            .is_err()
    );
    assert!(profile.db_path().exists());
    std::fs::write(profile.dir.join("new-content"), b"arrived after review").unwrap();
    assert!(
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .is_err()
    );
    assert!(profile.db_path().exists());
    accounts.cancel_removal(&review.token).await.unwrap();
    assert!(accounts.inner.lock().await.index.removal.is_none());
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    *vault.fail_remove.lock().unwrap() = true;
    let failure = accounts
        .remove_from_device(&review.token, "REMOVE")
        .await
        .unwrap_err();
    assert!(failure.message.contains("may already be erased"));
    assert!(!profile.dir.exists());
    assert!(accounts.local_profile().await.is_err());
    assert!(accounts.cancel_removal(&review.token).await.is_err());
    assert!(
        vault
            .load(&VaultEntry::new(ORIGIN, "account").unwrap())
            .unwrap()
            .is_some()
    );
    drop(accounts);
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    assert!(accounts.removal_candidates().await.unwrap()[0].pending);
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    assert!(review.resuming);
    *vault.fail_remove.lock().unwrap() = false;
    accounts
        .remove_from_device(&review.token, "REMOVE")
        .await
        .unwrap();
    assert!(accounts.removal_candidates().await.unwrap().is_empty());
    assert!(
        vault
            .load(&VaultEntry::new(ORIGIN, "account").unwrap())
            .unwrap()
            .is_none()
    );
    assert_eq!(
        std::fs::read(other.db_path()).unwrap(),
        b"unrelated retained ciphertext"
    );
    assert_eq!(profiles.open_active().unwrap().meta.id, "local");
}

#[tokio::test]
async fn removal_retries_index_acknowledgements_after_staging_and_after_key_erasure() {
    for fail_at in [2, 5] {
        let dir = tempfile::tempdir().unwrap();
        let profiles = profiles(&dir);
        profiles.open_active().unwrap();
        let vault = Arc::new(Memory::default());
        seed_key(&vault);
        let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
            .await
            .unwrap();
        accounts.inner.lock().await.account =
            Account::restore(api(), "account", vault.clone(), 100)
                .await
                .unwrap();
        let profile = accounts.local_profile().await.unwrap().profile;
        std::fs::write(profile.db_path(), b"selected synthetic ciphertext").unwrap();
        let review = accounts
            .prepare_removal(&profile.meta.id, 100)
            .await
            .unwrap();
        *vault.fail_write_at.lock().unwrap() = Some(*vault.writes.lock().unwrap() + fail_at);
        assert!(
            accounts
                .remove_from_device(&review.token, "REMOVE")
                .await
                .is_err()
        );
        assert!(!profile.dir.exists());
        assert!(accounts.inner.lock().await.index.removal.is_some());
        drop(accounts);
        *vault.fail_write_at.lock().unwrap() = None;
        let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
            .await
            .unwrap();
        let review = accounts
            .prepare_removal(&profile.meta.id, 100)
            .await
            .unwrap();
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .unwrap();
        assert!(accounts.inner.lock().await.index.removal.is_none());
        assert!(
            vault
                .load(&VaultEntry::new(ORIGIN, "account").unwrap())
                .unwrap()
                .is_none()
        );
    }
}

#[tokio::test]
async fn removal_preserves_files_when_receipt_cannot_save_or_profile_is_owned() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    accounts.inner.lock().await.account = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap();
    let profile = accounts.local_profile().await.unwrap().profile;
    std::fs::write(profile.db_path(), b"preserve selected ciphertext").unwrap();
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    *vault.fail_entry.lock().unwrap() = Some(accounts.index_entry.clone());
    assert!(
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .is_err()
    );
    assert!(accounts.inner.lock().await.index.removal.is_none());
    assert!(profile.db_path().exists());
    *vault.fail_entry.lock().unwrap() = None;
    let owner = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(profile.dir.join("owner.lock"))
        .unwrap();
    owner.try_lock().unwrap();
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    assert!(
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read(profile.db_path()).unwrap(),
        b"preserve selected ciphertext"
    );
    assert!(
        vault
            .load(&VaultEntry::new(ORIGIN, "account").unwrap())
            .unwrap()
            .is_some()
    );
    accounts.cancel_removal(&review.token).await.unwrap();
    drop(owner);
}

#[tokio::test]
async fn removal_prepared_resume_rechecks_staged_content_before_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    accounts.inner.lock().await.account = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap();
    let profile = accounts.local_profile().await.unwrap().profile;
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    *vault.fail_write_at.lock().unwrap() = Some(*vault.writes.lock().unwrap() + 2);
    assert!(
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .is_err()
    );
    let staged = dir
        .path()
        .join("profiles/.account-removals")
        .join(&review.token)
        .join("data");
    std::fs::write(staged.join("late-file"), b"unreviewed data").unwrap();
    *vault.fail_write_at.lock().unwrap() = None;
    let review = accounts
        .prepare_removal(&profile.meta.id, 100)
        .await
        .unwrap();
    assert!(
        accounts
            .remove_from_device(&review.token, "REMOVE")
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read(staged.join("late-file")).unwrap(),
        b"unreviewed data"
    );
    assert!(
        vault
            .load(&VaultEntry::new(ORIGIN, "account").unwrap())
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn reset_detaches_old_profile_durably_before_ack_and_never_reuses_its_ciphertext() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let old = profiles
        .create(ProfileKind::Account, "Old encrypted account")
        .unwrap();
    std::fs::write(old.db_path(), b"synthetic old ciphertext").unwrap();
    let vault = Arc::new(Memory::default());
    let account_entry = VaultEntry::new(ORIGIN, "account").unwrap();
    seed_key(&vault);
    let restored = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap()
        .unwrap();
    let (key, _) = restored.local_key_handle().unwrap();
    let recovery = aura_sync::crypto::RecoveryKey::generate().unwrap();
    let device = aura_sync::crypto::DeviceKey::generate().unwrap();
    let pending = serde_json::json!({"version":8,"request":{
        "review_id":"receipt","confirmation":"RESET SYNC",
        "wrapped_key":aura_sync::crypto::wrap_device(&key,"account","device",8,&device.public_key()).unwrap(),
        "recovery_envelope":aura_sync::crypto::wrap_recovery(&key,&recovery,"account",8).unwrap(),
        "recovery_verifier":recovery.verifier("account",8).unwrap()}});
    let pending = serde_json::to_vec(&pending).unwrap();
    let mut bytes = b"AURA-ACCOUNT\x03".to_vec();
    bytes.extend_from_slice(&[3; 32]);
    bytes.push(6);
    bytes.extend_from_slice(b"device");
    bytes.extend_from_slice(&[0, 1]);
    bytes.extend_from_slice(&8_u32.to_be_bytes());
    bytes.extend_from_slice(&[1, 1]);
    bytes.extend_from_slice(&[7; 32]);
    bytes.push(0);
    bytes.extend_from_slice(&(pending.len() as u16).to_be_bytes());
    bytes.extend_from_slice(&pending);
    vault.save(&account_entry, &bytes).unwrap();
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    {
        let mut inner = accounts.inner.lock().await;
        inner
            .index
            .accounts
            .insert("account".into(), Some(old.meta.id.clone()));
        inner
            .index
            .save(vault.clone(), accounts.index_entry.clone())
            .await
            .unwrap();
        inner.account = Account::restore(api(), "account", vault.clone(), 100)
            .await
            .unwrap();
        *vault.fail_entry.lock().unwrap() = Some(accounts.index_entry.clone());
        assert!(accounts.finish_reset_binding(&mut inner).await.is_err());
        assert!(inner.account.as_ref().unwrap().reset_committed());
        assert_eq!(
            inner.index.accounts["account"].as_deref(),
            Some(old.meta.id.as_str())
        );
    }
    assert!(accounts.local_profile().await.is_err());
    {
        let mut inner = accounts.inner.lock().await;
        *vault.fail_entry.lock().unwrap() = Some(account_entry);
        assert!(accounts.finish_reset_binding(&mut inner).await.is_err());
        assert_eq!(inner.index.accounts["account"], None);
        assert!(inner.account.as_ref().unwrap().reset_committed());
        *vault.fail_entry.lock().unwrap() = None;
        accounts.finish_reset_binding(&mut inner).await.unwrap();
        assert!(
            inner
                .account
                .as_ref()
                .unwrap()
                .pending_reset_version()
                .is_none()
        );
    }
    let new = accounts.local_profile().await.unwrap();
    assert_ne!(new.profile.meta.id, old.meta.id);
    assert_eq!(
        std::fs::read(old.db_path()).unwrap(),
        b"synthetic old ciphertext"
    );
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

fn retained_database(profiles: &Profiles, account: &str, key: &AccountKey) -> Profile {
    let profile = profiles
        .create(ProfileKind::Account, "Retained account")
        .unwrap();
    let db_key = Arc::new(key.database_key(account, &profile.meta.id).unwrap());
    let (mut store, _) = crate::store::Store::open_encrypted(&profile, db_key).unwrap();
    let identity = crate::sync::SyncIdentity {
        account: account.into(),
        device: "old-device".into(),
        key_version: 1,
    };
    crate::sync::SyncLedger::new(&mut store, identity, key)
        .unwrap()
        .edit_metadata("chats", "saved", 100, |_, metadata, clock| {
            metadata.fields.insert(
                "title".into(),
                aura_sync::merge::Stamped {
                    clock: clock.clone(),
                    value: aura_sync::merge::FieldValue::Present(serde_json::json!(
                        "retained queued title"
                    )),
                },
            );
            Ok(())
        })
        .unwrap();
    store
        .conn()
        .execute(
            "UPDATE sync_state SET last_hlc='0000000000100:0000000007:old-device',pull_cursor=27",
            [],
        )
        .unwrap();
    profile
}

#[tokio::test]
async fn explicit_rebinding_proves_key_identity_and_preserves_queued_edits_across_index_failure() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let restored = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap()
        .unwrap();
    let (key, _) = restored.local_key_handle().unwrap();
    let retained = retained_database(&profiles, "account", &key);
    let wrong = retained_database(&profiles, "other", &key);
    let empty = profiles.create(ProfileKind::Account, "Empty").unwrap();
    let accounts = Accounts::open(api(), vault.clone(), profiles.clone())
        .await
        .unwrap();
    accounts.inner.lock().await.account = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap();
    assert!(accounts.rebind_profile(&wrong.meta.id, 100).await.is_err());
    assert!(accounts.rebind_profile(&empty.meta.id, 100).await.is_err());
    assert!(!empty.db_path().exists());
    assert!(accounts.rebind_profile("../outside", 100).await.is_err());
    *vault.fail_entry.lock().unwrap() = Some(accounts.index_entry.clone());
    assert!(
        accounts
            .rebind_profile(&retained.meta.id, 100)
            .await
            .is_err()
    );
    assert!(accounts.status().await.unwrap().profile_id.is_none());
    *vault.fail_entry.lock().unwrap() = None;
    let status = accounts
        .rebind_profile(&retained.meta.id, 100)
        .await
        .unwrap();
    assert_eq!(
        status.profile_id.as_deref(),
        Some(retained.meta.id.as_str())
    );
    let (mut store, _) = crate::store::Store::open_encrypted(
        &retained,
        Arc::new(key.database_key("account", &retained.meta.id).unwrap()),
    )
    .unwrap();
    let identity = crate::sync::SyncIdentity {
        account: "account".into(),
        device: "device".into(),
        key_version: 1,
    };
    crate::sync::SyncLedger::new(&mut store, identity, &key).unwrap();
    let (device, hlc, cursor): (String, String, i64) = store
        .conn()
        .query_row(
            "SELECT device_id,last_hlc,pull_cursor FROM sync_state",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(device, "device");
    assert_eq!(cursor, 27);
    assert!(
        hlc.parse::<aura_sync::clock::Hlc>().unwrap()
            > "0000000000100:0000000007:old-device".parse().unwrap()
    );
    let json = store
        .conn()
        .query_row("SELECT record_json FROM sync_outbox", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap();
    let record: aura_sync::wire::EncryptedRecord = serde_json::from_str(&json).unwrap();
    // The server requires the outer HLC device to equal the authenticated current device.
    assert_eq!(
        record
            .hlc
            .parse::<aura_sync::clock::Hlc>()
            .unwrap()
            .device(),
        "device"
    );
    let plain = aura_sync::crypto::open_record(
        &key,
        &aura_sync::crypto::RecordContext {
            account: "account",
            collection: &record.collection,
            id: &record.id,
            key_version: record.key_version,
            hlc: &record.hlc,
            deleted: record.deleted,
        },
        &aura_sync::crypto::SealedPayload {
            nonce: record.nonce,
            ciphertext: record.ciphertext,
        },
    )
    .unwrap();
    let metadata: aura_sync::merge::Metadata = serde_json::from_slice(&plain).unwrap();
    assert!(
        metadata.fields["title"].value
            == aura_sync::merge::FieldValue::Present(serde_json::json!("retained queued title"))
    );
    assert_eq!(metadata.fields["title"].clock.device(), "old-device");
    assert_eq!(profiles.list().unwrap().len(), 4);
}

#[tokio::test]
async fn explicit_rebinding_refuses_future_schema_without_rewriting_database_or_index() {
    let dir = tempfile::tempdir().unwrap();
    let profiles = profiles(&dir);
    profiles.open_active().unwrap();
    let vault = Arc::new(Memory::default());
    seed_key(&vault);
    let restored = Account::restore(api(), "account", vault.clone(), 100)
        .await
        .unwrap()
        .unwrap();
    let (key, _) = restored.local_key_handle().unwrap();
    let retained = retained_database(&profiles, "account", &key);
    {
        let (store, _) = crate::store::Store::open_encrypted(
            &retained,
            Arc::new(key.database_key("account", &retained.meta.id).unwrap()),
        )
        .unwrap();
        store
            .conn()
            .pragma_update(None, "user_version", crate::store::SCHEMA_VERSION + 1)
            .unwrap();
    }
    let before = std::fs::read(retained.db_path()).unwrap();
    let accounts = Accounts::open(api(), vault.clone(), profiles)
        .await
        .unwrap();
    accounts.inner.lock().await.account = Some(restored);
    let writes = *vault.writes.lock().unwrap();
    let failure = accounts
        .rebind_profile(&retained.meta.id, 300)
        .await
        .unwrap_err();
    assert!(failure.message.contains("newer auracode"));
    assert_eq!(std::fs::read(retained.db_path()).unwrap(), before);
    assert_eq!(*vault.writes.lock().unwrap(), writes);
    assert!(accounts.status().await.unwrap().profile_id.is_none());
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
        serde_json::json!({"version":3,"accounts":{}}),
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
