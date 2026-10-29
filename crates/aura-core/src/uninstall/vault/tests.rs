use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct Fake {
    values: Mutex<HashMap<VaultEntry, Vec<u8>>>,
    unreadable: Mutex<HashSet<VaultEntry>>,
    failures: Mutex<HashSet<VaultEntry>>,
    removed: Mutex<Vec<VaultEntry>>,
    listing_fails: bool,
}
impl Fake {
    fn put(&self, entry: &VaultEntry, value: &[u8]) {
        self.values
            .lock()
            .unwrap()
            .insert(entry.clone(), value.to_vec());
    }
    fn has(&self, entry: &VaultEntry) -> bool {
        self.values.lock().unwrap().contains_key(entry)
    }
}
impl AppVault for Fake {
    fn entries(&self) -> Result<Vec<VaultEntry>, VaultError> {
        if self.listing_fails {
            return Err(VaultError::Unavailable);
        }
        Ok(self.values.lock().unwrap().keys().cloned().collect())
    }
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        if self.unreadable.lock().unwrap().contains(entry) {
            return Err(VaultError::Unavailable);
        }
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(entry)
            .cloned()
            .map(Zeroizing::new))
    }
    fn remove(&self, entry: &VaultEntry) -> Result<(), VaultError> {
        if self.failures.lock().unwrap().contains(entry) {
            return Err(VaultError::Write);
        }
        self.removed.lock().unwrap().push(entry.clone());
        self.values.lock().unwrap().remove(entry);
        Ok(())
    }
}
fn bundle() -> Vec<u8> {
    let mut bytes = b"AURA-ACCOUNT".to_vec();
    bytes.push(1);
    bytes.extend([7; 32]);
    bytes.extend([0, 0, 0]);
    bytes
}
fn index(ids: &[&str]) -> Vec<u8> {
    let accounts: std::collections::BTreeMap<_, Option<String>> =
        ids.iter().map(|id| (*id, None)).collect();
    serde_json::to_vec(&serde_json::json!({"version": 2, "accounts": accounts})).unwrap()
}
fn entry(id: &str) -> VaultEntry {
    VaultEntry::new(ORIGINS[0], id).unwrap()
}
fn root_index(root: &Path, origin: &str) -> VaultEntry {
    crate::accounts::profile_index_entry(origin, root).unwrap()
}
fn run(vault: &Fake, root: &Path, default: Option<&Path>) -> VaultReport {
    let roots = vec![root.to_owned()];
    let review = review_vault(vault, &roots, default);
    clean(vault, &roots, default, &review.approvals)
}

#[test]
fn exclusive_accounts_go_first_shared_accounts_and_foreign_index_stay() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("deleted");
    let other = temp.path().join("survivor");
    let own = root_index(&root, ORIGINS[0]);
    let foreign = root_index(&other, ORIGINS[1]);
    let shared = entry("shared");
    let exclusive = entry("exclusive");
    let vault = Fake::default();
    vault.put(&own, &index(&["shared", "exclusive"]));
    vault.put(&foreign, &index(&["shared"]));
    vault.put(&shared, &bundle());
    vault.put(&exclusive, &bundle());
    let report = run(&vault, &root, Some(&root));
    assert_eq!((report.accounts, report.indexes), (1, 1));
    assert!(vault.has(&foreign) && vault.has(&shared));
    assert!(!vault.has(&own) && !vault.has(&exclusive));
    assert_eq!(*vault.removed.lock().unwrap(), [exclusive, own]);
    assert!(report.error.is_none());
}

#[test]
fn custom_only_never_removes_orphans_but_canonical_default_does() {
    let temp = tempfile::tempdir().unwrap();
    let custom = temp.path().join("custom");
    let default = temp.path().join("default");
    let vault = Fake::default();
    let orphan = entry("orphan");
    vault.put(&orphan, &bundle());
    assert_eq!(run(&vault, &custom, Some(&default)).accounts, 0);
    assert!(vault.has(&orphan));
    assert_eq!(run(&vault, &default, Some(&default)).swept, 1);
    assert_eq!(run(&vault, &default, Some(&default)).accounts, 0);
}

#[test]
fn empty_foreign_index_is_preserved_without_blocking_exclusive_accounts() {
    let temp = tempfile::tempdir().unwrap();
    let own = root_index(temp.path(), ORIGINS[0]);
    let foreign = entry("opaque-index-name");
    let account = entry("account");
    let vault = Fake::default();
    vault.put(&own, &index(&["account"]));
    vault.put(&foreign, &index(&[]));
    vault.put(&account, &bundle());
    assert_eq!(run(&vault, temp.path(), None).accounts, 1);
    assert!(vault.has(&foreign));
}

#[test]
fn unknown_unreadable_and_unsupported_foreign_entries_block_every_account() {
    let temp = tempfile::tempdir().unwrap();
    let own = root_index(temp.path(), ORIGINS[0]);
    let foreign = entry("unclassified");
    let account = entry("account");
    for bytes in [
        b"not json".as_slice(),
        br#"{"version":3,"accounts":{}}"#,
        b"AURA-ACCOUNT",
        br#"{"version":2,"accounts":{},"extra":true}"#,
    ] {
        let vault = Fake::default();
        vault.put(&own, &index(&["account"]));
        vault.put(&foreign, bytes);
        vault.put(&account, &bundle());
        let report = run(&vault, temp.path(), Some(temp.path()));
        assert!(vault.has(&own) && vault.has(&account));
        assert_eq!(report.accounts, 0);
        assert!(report.error.is_some());
    }
    let vault = Fake::default();
    vault.put(&own, &index(&["account"]));
    vault.put(&foreign, &index(&[]));
    vault.put(&account, &bundle());
    vault.unreadable.lock().unwrap().insert(foreign);
    assert_eq!(run(&vault, temp.path(), Some(temp.path())).accounts, 0);
    assert!(vault.has(&own));
}

#[test]
fn strict_index_validation_rejects_noncanonical_duplicate_profiles_and_bad_receipts() {
    let profile = "01234567-1234-4234-8234-0123456789ab";
    let token = "11234567-1234-4234-8234-0123456789ab";
    let valid = serde_json::json!({"version":2, "accounts":{"account":profile}, "removal": {
        "account_id":"account", "profile_id":profile, "token":token,
        "meta_hash":"a".repeat(64), "tree_hash":"b".repeat(64), "phase":"prepared"
    }});
    assert!(crate::accounts::cleanup_references(&serde_json::to_vec(&valid).unwrap()).is_some());
    let mut invalid = vec![
        serde_json::json!({"version":2,"accounts":{"a":profile,"b":profile}}),
        serde_json::json!({"version":2,"accounts":{"a":profile.to_uppercase()}}),
        serde_json::json!({"version":2,"accounts":{"a":"not-a-uuid"}}),
        serde_json::json!({"version":2,"accounts":{"bad account":null}}),
        serde_json::json!({"version":2,"accounts": (0..9).map(|i| (format!("a{i}"), serde_json::Value::Null)).collect::<serde_json::Map<_,_>>() }),
    ];
    for (key, value) in [
        ("account_id", "different"),
        ("profile_id", token),
        ("token", "invalid"),
        ("meta_hash", "bad"),
        ("phase", "future"),
    ] {
        let mut broken = valid.clone();
        broken["removal"][key] = value.into();
        invalid.push(broken);
    }
    let mut v1 = valid.clone();
    v1["version"] = 1.into();
    invalid.push(v1);
    for value in invalid {
        assert!(
            crate::accounts::cleanup_references(&serde_json::to_vec(&value).unwrap()).is_none(),
            "{value}"
        );
    }
}

#[test]
fn foreign_receipt_protects_account_bundles_in_both_origins() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Fake::default();
    let foreign = entry("foreign");
    let profile = "01234567-1234-4234-8234-0123456789ab";
    let value = serde_json::json!({"version":2,"accounts":{"shared":profile},"removal":{
        "account_id":"shared","profile_id":profile,"token":profile,"meta_hash":"a".repeat(64),"tree_hash":"b".repeat(64),"phase":"key_removed"
    }});
    vault.put(&foreign, &serde_json::to_vec(&value).unwrap());
    for origin in ORIGINS {
        vault.put(&VaultEntry::new(origin, "shared").unwrap(), &bundle());
    }
    let report = run(&vault, temp.path(), Some(temp.path()));
    assert_eq!(report.accounts, 0);
    assert!(report.error.is_none());
    assert_eq!(
        report
            .rows
            .iter()
            .filter(|row| row.kind == VaultKind::Account && !row.remove)
            .count(),
        2
    );
}

#[test]
fn review_execution_matches_and_never_expands_when_references_change() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Fake::default();
    let own = root_index(temp.path(), ORIGINS[0]);
    let foreign = entry("foreign");
    let account = entry("account");
    vault.put(&own, &index(&["account"]));
    vault.put(&account, &bundle());
    let roots = vec![temp.path().to_owned()];
    let review = review_vault(&vault, &roots, Some(temp.path()));
    assert_eq!(review.rows.iter().filter(|row| row.remove).count(), 2);
    let text = format!("{:?}", review.rows);
    assert!(!text.contains("\"account\"") && !text.contains("AURA-ACCOUNT"));
    vault.put(&foreign, &index(&["account"]));
    let newly_added = entry("new-orphan");
    vault.put(&newly_added, &bundle());
    let report = clean(&vault, &roots, Some(temp.path()), &review.approvals);
    assert!(vault.has(&account) && vault.has(&foreign) && vault.has(&newly_added));
    assert!(!vault.has(&own));
    assert_eq!(report.accounts, 0);
    // A previously retained account becoming orphaned still was not approved for deletion.
    let next = review_vault(&vault, &roots, Some(temp.path()));
    vault.put(&foreign, &index(&[]));
    clean(&vault, &roots, Some(temp.path()), &next.approvals);
    assert!(vault.has(&account));
}

#[test]
fn changed_values_and_new_unknown_payloads_are_retained_with_retry_indexes() {
    let temp = tempfile::tempdir().unwrap();
    for unknown in [false, true] {
        let vault = Fake::default();
        let own = root_index(temp.path(), ORIGINS[0]);
        let account = entry("account");
        vault.put(&own, &index(&["account"]));
        vault.put(&account, &bundle());
        let roots = vec![temp.path().to_owned()];
        let review = review_vault(&vault, &roots, Some(temp.path()));
        if unknown {
            vault.put(&entry("unknown"), b"unknown");
        } else {
            let mut value = bundle();
            value[12] = 8;
            vault.put(&account, &value);
        }
        let report = clean(&vault, &roots, Some(temp.path()), &review.approvals);
        assert!(vault.has(&own) && vault.has(&account));
        assert_eq!(report.accounts, 0);
    }
}

#[test]
fn failed_account_delete_retains_owning_index_and_missing_root_retry_succeeds() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("one/two/root");
    std::fs::create_dir_all(&root).unwrap();
    let own = root_index(&root, ORIGINS[0]);
    let account = entry("account");
    let vault = Fake::default();
    vault.put(&own, &index(&["account"]));
    vault.put(&account, &bundle());
    vault.failures.lock().unwrap().insert(account.clone());
    let report = run(&vault, &root, None);
    assert!(report.error.is_some());
    assert!(vault.has(&own) && vault.has(&account));
    std::fs::remove_dir_all(temp.path().join("one")).unwrap();
    assert_eq!(root_index(&root, ORIGINS[0]), own);
    vault.failures.lock().unwrap().clear();
    assert_eq!(run(&vault, &root, None).indexes, 1);
    assert!(!vault.has(&own) && !vault.has(&account));
    assert!(run(&vault, &root, None).rows.is_empty());
}

#[test]
fn ambiguous_root_and_listing_failure_preserve_every_key() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Fake::default();
    let account = entry("account");
    vault.put(&account, &bundle());
    let ambiguous = temp.path().join("missing/../root");
    assert!(crate::accounts::cleanup_identity(&ambiguous).is_none());
    assert_eq!(run(&vault, &ambiguous, Some(&ambiguous)).accounts, 0);
    let failed = Fake {
        listing_fails: true,
        ..Fake::default()
    };
    failed.put(&account, &bundle());
    assert!(run(&failed, temp.path(), Some(temp.path())).error.is_some());
    assert!(failed.removed.lock().unwrap().is_empty());
}

#[test]
fn review_changes_no_fake_store_or_files_and_unchanged_execution_matches() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("missing");
    let vault = Fake::default();
    let own = root_index(&root, ORIGINS[0]);
    let account = entry("account");
    vault.put(&own, &index(&["account"]));
    vault.put(&account, &bundle());
    let roots = vec![root.clone()];
    let before = vault.values.lock().unwrap().clone();
    let review = review_vault(&vault, &roots, None);
    assert!(!root.exists());
    assert!(vault.removed.lock().unwrap().is_empty());
    assert_eq!(*vault.values.lock().unwrap(), before);
    let report = clean(&vault, &roots, None, &review.approvals);
    let selected: HashSet<_> = review
        .rows
        .iter()
        .filter(|row| row.remove)
        .map(|row| &row.target)
        .collect();
    let removed: HashSet<_> = report
        .rows
        .iter()
        .filter(|row| row.remove)
        .map(|row| &row.target)
        .collect();
    assert_eq!(selected, removed);
}

#[test]
fn changed_own_index_and_new_own_indexes_protect_previously_approved_accounts() {
    let temp = tempfile::tempdir().unwrap();
    let roots = vec![temp.path().join("one"), temp.path().join("two")];
    for changed in [true, false] {
        let vault = Fake::default();
        let own = root_index(&roots[0], ORIGINS[0]);
        let second = root_index(&roots[1], ORIGINS[0]);
        let account = entry("account");
        vault.put(&own, &index(&["account"]));
        vault.put(&account, &bundle());
        let review = review_vault(&vault, &roots, Some(&roots[0]));
        if changed {
            vault.put(&own, &index(&["account", "new-account"]));
        } else {
            vault.put(&second, &index(&["account"]));
        }
        clean(&vault, &roots, Some(&roots[0]), &review.approvals);
        assert!(vault.has(&account));
        assert!(vault.has(if changed { &own } else { &second }));
    }
}

#[test]
fn complete_bundle_validation_rejects_truncation_trailing_bytes_and_future_version() {
    let valid = bundle();
    assert!(aura_sync::account::valid_stored_bundle(&valid));
    let mut trailing = valid.clone();
    trailing.push(0);
    let mut future = valid.clone();
    future[11] = 99;
    for malformed in [valid[..valid.len() - 1].to_vec(), trailing, future] {
        assert!(!aura_sync::account::valid_stored_bundle(&malformed));
        let temp = tempfile::tempdir().unwrap();
        let vault = Fake::default();
        vault.put(&entry("malformed"), &malformed);
        vault.put(&entry("valid"), &valid);
        let report = run(&vault, temp.path(), Some(temp.path()));
        assert_eq!((report.accounts, report.swept), (0, 0));
        assert!(report.error.is_some());
    }
}

#[test]
fn account_payload_at_an_index_target_does_not_establish_account_ownership() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Fake::default();
    let own = root_index(temp.path(), ORIGINS[0]);
    vault.put(&own, &bundle());
    vault.put(&entry("orphan"), &bundle());
    let report = run(&vault, temp.path(), Some(temp.path()));
    assert!(vault.has(&own));
    assert_eq!((report.accounts, report.swept), (0, 0));
    assert!(report.error.is_some());
}
