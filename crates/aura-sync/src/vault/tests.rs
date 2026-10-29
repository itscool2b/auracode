use super::*;
use keyring_core::api::CredentialStoreApi;
use std::{any::Any, collections::HashMap};

struct CheckedMock {
    inner: Arc<keyring_core::mock::Store>,
}
impl CredentialStoreApi for CheckedMock {
    fn vendor(&self) -> String {
        "auracode test memory store".into()
    }
    fn id(&self) -> String {
        "memory".into()
    }
    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> keyring_core::Result<keyring_core::Entry> {
        assert_eq!(service, SERVICE);
        assert!(user.starts_with(&format!("{SERVICE}:")));
        #[cfg(windows)]
        assert_eq!(
            modifiers,
            Some(&HashMap::from([("target", user), ("persistence", "Local")]))
        );
        #[cfg(not(windows))]
        assert!(modifiers.is_none_or(HashMap::is_empty));
        self.inner.build(service, user, None)
    }
    fn search(&self, _: &HashMap<&str, &str>) -> keyring_core::Result<Vec<keyring_core::Entry>> {
        panic!("credential enumeration is forbidden");
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
}
fn entry() -> VaultEntry {
    VaultEntry::new("https://example.invalid", "account").unwrap()
}
fn passphrase() -> Zeroizing<String> {
    Zeroizing::new("synthetic correct horse battery".into())
}
fn vault_path(directory: &std::path::Path, entry: &VaultEntry) -> std::path::PathBuf {
    directory.join(format!("{}.vault", entry.0))
}

#[test]
fn named_native_operations_use_only_app_scope_and_local_persistence() {
    // This adapter only touches keyring-core's process-memory mock, never the OS credential store.
    let temp = tempfile::tempdir().unwrap();
    let store = NativeStore {
        _lease: super::lease::acquire(&temp.path().join("lease"), false, true).unwrap(),
        store: Arc::new(CheckedMock {
            inner: keyring_core::mock::Store::new().unwrap(),
        }),
    };
    let first = entry();
    let account = VaultEntry::new("https://example.invalid/", "other").unwrap();
    let service = VaultEntry::new("https://different.invalid/", "account").unwrap();
    assert_eq!(
        first,
        VaultEntry::new("https://EXAMPLE.invalid:443/", "account").unwrap()
    );
    assert!(store.load(&first).unwrap().is_none());
    store.save(&first, b"synthetic app key").unwrap();
    assert_eq!(
        store.load(&first).unwrap().unwrap().as_slice(),
        b"synthetic app key"
    );
    assert!(store.load(&account).unwrap().is_none());
    assert!(store.load(&service).unwrap().is_none());
    assert_eq!(
        store.save(&first, &[0; MAX_SECRET + 1]),
        Err(VaultError::Invalid)
    );
    assert_eq!(store.save(&first, b""), Err(VaultError::Invalid));
    store.remove(&first).unwrap();
    store.remove(&first).unwrap();
    assert!(store.load(&first).unwrap().is_none());
    assert!(VaultEntry::new("https://example.invalid/", "../credentials").is_err());
    assert!(VaultEntry::new("http://example.invalid/", "account").is_err());
}

#[test]
fn explicit_passphrase_store_roundtrips_without_plaintext_and_serializes_access() {
    let directory = tempfile::tempdir().unwrap();
    let entry = entry();
    let store = PassphraseStore::create(directory.path(), entry.clone(), passphrase()).unwrap();
    assert!(store.load(&entry).unwrap().is_none());
    assert!(matches!(
        PassphraseStore::open(directory.path(), entry.clone(), passphrase()),
        Err(VaultError::Busy)
    ));
    store
        .save(&entry, b"synthetic secret session and account key")
        .unwrap();
    let before = std::fs::read(vault_path(directory.path(), &entry)).unwrap();
    assert!(!String::from_utf8_lossy(&before).contains("synthetic secret"));
    assert!(!String::from_utf8_lossy(&before).contains(passphrase().as_str()));
    let other = VaultEntry::new("https://example.invalid/", "other").unwrap();
    assert_eq!(
        store.save(&other, b"wrong account"),
        Err(VaultError::Invalid)
    );
    drop(store);
    assert!(matches!(
        PassphraseStore::create(directory.path(), entry.clone(), passphrase()),
        Err(VaultError::Write)
    ));
    assert_eq!(
        std::fs::read(vault_path(directory.path(), &entry)).unwrap(),
        before
    );
    let store = PassphraseStore::open(directory.path(), entry.clone(), passphrase()).unwrap();
    assert_eq!(
        store.load(&entry).unwrap().unwrap().as_slice(),
        b"synthetic secret session and account key"
    );
    store.save(&entry, b"replacement").unwrap();
    assert_ne!(
        std::fs::read(vault_path(directory.path(), &entry)).unwrap(),
        before
    );
    store.remove(&entry).unwrap();
    drop(store);
    let store = PassphraseStore::open(directory.path(), entry.clone(), passphrase()).unwrap();
    assert!(store.load(&entry).unwrap().is_none());
}

#[test]
fn passphrase_wrong_key_tamper_and_account_substitution_preserve_the_saved_file() {
    let directory = tempfile::tempdir().unwrap();
    let entry = entry();
    let store = PassphraseStore::create(directory.path(), entry.clone(), passphrase()).unwrap();
    store
        .save(&entry, b"synthetic retained profile key")
        .unwrap();
    drop(store);
    let path = vault_path(directory.path(), &entry);
    let original = std::fs::read(&path).unwrap();
    assert!(matches!(
        PassphraseStore::open(
            directory.path(),
            entry.clone(),
            Zeroizing::new("different sufficiently long phrase".into())
        ),
        Err(VaultError::Unlock)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let other = VaultEntry::new("https://different.invalid", "account").unwrap();
    std::fs::copy(&path, vault_path(directory.path(), &other)).unwrap();
    assert!(matches!(
        PassphraseStore::open(directory.path(), other, passphrase()),
        Err(VaultError::Unlock)
    ));
    let mut changed = original.clone();
    *changed.last_mut().unwrap() ^= 1;
    std::fs::write(&path, &changed).unwrap();
    assert!(matches!(
        PassphraseStore::open(directory.path(), entry.clone(), passphrase()),
        Err(VaultError::Unlock)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), changed);
    std::fs::write(&path, [0; 10_000]).unwrap();
    assert!(matches!(
        PassphraseStore::open(directory.path(), entry, passphrase()),
        Err(VaultError::Corrupt)
    ));
}

#[test]
fn the_listing_names_only_auracode_entries_of_a_keychain_store_and_removes_nothing() {
    // keyring-core's process-memory mock only; it matches services by substring, as a loose store
    // might, so the lookalike service proves the exact second check.
    let mock = keyring_core::mock::Store::new().unwrap();
    let make = |service: &str, user: &str| {
        let entry = mock.build(service, user, None).unwrap();
        entry.set_secret(b"synthetic").unwrap();
        entry
    };
    let first = make(SERVICE, &format!("{SERVICE}:first"));
    let second = make(SERVICE, &format!("{SERVICE}:second"));
    let vendor = make("Claude Code-credentials", "someone");
    let lookalike = make("x-auracode.sync.v1", "x-auracode.sync.v1:third");
    let foreign_user = make(SERVICE, "not-ours");
    let store: Arc<keyring_core::CredentialStore> = mock.clone();
    let mut listed = list_by_service(store.as_ref()).unwrap();
    listed.sort();
    assert_eq!(
        listed,
        [format!("{SERVICE}:first"), format!("{SERVICE}:second")]
    );
    for entry in [first, second, vendor, lookalike, foreign_user] {
        assert_eq!(entry.get_secret().unwrap(), b"synthetic");
    }
    // The names become entries the store can load and remove, and nothing else does.
    listed.push(format!("{SERVICE}:first"));
    listed.push(format!("{SERVICE}:"));
    listed.push("x-auracode.sync.v1:third".into());
    let entries = app_entries(&listed);
    assert_eq!(
        entries.iter().map(VaultEntry::target).collect::<Vec<_>>(),
        [
            format!("{SERVICE}:"),
            format!("{SERVICE}:first"),
            format!("{SERVICE}:second")
        ]
    );
    let account = entry();
    assert_eq!(
        VaultEntry::from_target(&account.target()),
        Some(account.clone())
    );
    assert!(account.target().starts_with("auracode.sync.v1:"));
    assert_eq!(VaultEntry::from_target("auracode.sync.v1"), None);
}

#[test]
fn review_labels_never_expose_non_digest_entry_names() {
    let legacy = VaultEntry::from_target("auracode.sync.v1:private-account-id").unwrap();
    assert!(!legacy.opaque_target().contains("private-account-id"));
    assert!(
        legacy
            .opaque_target()
            .starts_with("auracode.sync.v1:unrecognized-")
    );
    assert_eq!(entry().opaque_target(), entry().target());
}
