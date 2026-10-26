use super::*;
use crate::profile::{Profile, ProfileKind, ProfileMeta};
use aura_sync::merge::FieldValue;
use std::sync::Arc;

const NOW: u64 = 1_793_000_000_000;
fn identity() -> SyncIdentity {
    SyncIdentity {
        account: "account".into(),
        device: "windows".into(),
        key_version: 1,
    }
}
struct Fixture {
    _temp: tempfile::TempDir,
    profile: Profile,
    key: AccountKey,
    db: Arc<crypto::DatabaseKey>,
    store: Store,
}
fn fixture() -> Fixture {
    let temp = tempfile::tempdir().expect("temporary profile");
    let profile = Profile {
        meta: ProfileMeta {
            id: "profile".into(),
            kind: ProfileKind::Account,
            display_name: "Account".into(),
            created_at: 0,
        },
        dir: temp.path().join("profile"),
    };
    let key = AccountKey::generate().expect("test key");
    let db = Arc::new(
        key.database_key("account", "profile")
            .expect("test database key"),
    );
    let (store, _) = Store::open_encrypted(&profile, db.clone()).expect("encrypted test store");
    store
        .conn()
        .execute(
            "CREATE TABLE projection(id TEXT PRIMARY KEY,value TEXT)",
            [],
        )
        .expect("test projection");
    Fixture {
        _temp: temp,
        profile,
        key,
        db,
        store,
    }
}
fn set(metadata: &mut Metadata, clock: &Hlc, field: &str, value: &str) {
    metadata.fields.insert(
        field.into(),
        Stamped {
            clock: clock.clone(),
            value: FieldValue::Present(serde_json::Value::String(value.into())),
        },
    );
}
fn value<'a>(metadata: &'a Metadata, field: &str) -> Option<&'a str> {
    match &metadata.fields.get(field)?.value {
        FieldValue::Present(value) => value.as_str(),
        FieldValue::Deleted => None,
    }
}
fn project(tx: &Transaction<'_>, record: &EncryptedRecord, metadata: &Metadata) -> Result<()> {
    tx.execute("INSERT INTO projection(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value",params![record.id,value(metadata,"title")])?;
    Ok(())
}
fn remote(key: &AccountKey, id: &str, field: &str, text: &str, at: u64, seq: u64) -> Change {
    let clock = Clock::new("mac").expect("clock").tick(at).expect("tick");
    let mut metadata = Metadata {
        schema_version: 1,
        live: Stamped {
            clock: clock.clone(),
            value: true,
        },
        fields: BTreeMap::new(),
    };
    set(&mut metadata, &clock, field, text);
    Change {
        server_seq: seq,
        device_id: "mac".into(),
        record: seal(&identity(), key, "projects", id, &clock, &metadata).expect("seal"),
    }
}
fn metadata(key: &AccountKey, record: &EncryptedRecord, now: u64) -> Metadata {
    match open(&identity(), key, record, now).expect("open") {
        DecodedMetadata::Known(value) => value,
        _ => panic!("expected known metadata"),
    }
}

#[test]
fn local_projection_clock_and_outbox_commit_or_rollback_together_and_survive_restart() {
    let mut f = fixture();
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    let before = load_clock(ledger.conn, &identity()).unwrap().last().clone();
    let failed = ledger.edit_metadata("projects", "project", NOW, |tx, metadata, clock| {
        set(metadata, clock, "title", "private local edit");
        tx.execute(
            "INSERT INTO projection VALUES('project','must roll back')",
            [],
        )?;
        Err(SyncError::Database)
    });
    assert!(failed.is_err());
    assert!(ledger.outgoing().unwrap().is_empty());
    assert_eq!(
        load_clock(ledger.conn, &identity()).unwrap().last(),
        &before
    );
    assert_eq!(
        ledger
            .conn
            .query_row("SELECT count(*) FROM projection", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    ledger
        .edit_metadata("projects", "project", NOW, |tx, metadata, clock| {
            set(metadata, clock, "title", "private local edit");
            tx.execute(
                "INSERT INTO projection VALUES('project','private local edit')",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let sent = ledger.outgoing().unwrap();
    assert_eq!(sent.len(), 1);
    drop(ledger);
    drop(f.store);
    let (mut store, _) = Store::open_encrypted(&f.profile, f.db).unwrap();
    let mut ledger = SyncLedger::new(&mut store, identity(), &f.key).unwrap();
    assert_eq!(ledger.outgoing().unwrap(), sent);
    ledger
        .edit_metadata("projects", "project", NOW - 1, |_, metadata, clock| {
            set(metadata, clock, "title", "second edit");
            Ok(())
        })
        .unwrap();
    let after = ledger.outgoing().unwrap();
    assert_eq!(after.len(), 1);
    assert!(after[0].hlc > sent[0].hlc);
    assert_eq!(
        value(&metadata(&f.key, &after[0], NOW), "title"),
        Some("second edit")
    );
}

#[test]
fn a_bad_last_record_or_failed_projection_rolls_back_the_whole_page_and_cursor() {
    let mut f = fixture();
    let first = remote(&f.key, "one", "title", "first", NOW, 3);
    let second = remote(&f.key, "two", "title", "second", NOW + 1, 12);
    let mut corrupt = second.clone();
    let replacement = if corrupt.record.ciphertext.starts_with('A') {
        "B"
    } else {
        "A"
    };
    corrupt.record.ciphertext.replace_range(..1, replacement);
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    let before = load_clock(ledger.conn, &identity()).unwrap().last().clone();
    let page = Pull {
        records: vec![first.clone(), corrupt],
        next_cursor: 12,
        has_more: false,
    };
    assert!(ledger.accept_pull(&page, NOW + 1, project).is_err());
    assert_eq!(ledger.cursor().unwrap(), 0);
    assert_eq!(
        load_clock(ledger.conn, &identity()).unwrap().last(),
        &before
    );
    assert_eq!(
        ledger
            .conn
            .query_row("SELECT count(*) FROM projection", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let valid = Pull {
        records: vec![first, second],
        next_cursor: 12,
        has_more: false,
    };
    assert!(
        ledger
            .accept_pull(&valid, NOW + 1, |tx, record, metadata| {
                project(tx, record, metadata)?;
                if record.id == "two" {
                    Err(SyncError::Database)
                } else {
                    Ok(())
                }
            })
            .is_err()
    );
    assert_eq!(ledger.cursor().unwrap(), 0);
    ledger.accept_pull(&valid, NOW + 1, project).unwrap();
    assert_eq!(ledger.cursor().unwrap(), 12);
    assert_eq!(
        ledger
            .conn
            .query_row("SELECT count(*) FROM projection", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(ledger.accept_pull(&valid, NOW + 1, project).is_err());
    assert_eq!(ledger.cursor().unwrap(), 12);
}

#[test]
fn delayed_push_ack_does_not_erase_new_edits_and_concurrent_fields_are_requeued() {
    let mut f = fixture();
    let color = remote(&f.key, "project", "color", "blue", NOW + 1, 6);
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    ledger
        .edit_metadata("projects", "project", NOW, |_, metadata, clock| {
            set(metadata, clock, "title", "first");
            Ok(())
        })
        .unwrap();
    let sent = ledger.outgoing().unwrap();
    ledger
        .edit_metadata("projects", "project", NOW + 2, |_, metadata, clock| {
            set(metadata, clock, "title", "newest");
            Ok(())
        })
        .unwrap();
    let ack = Change {
        server_seq: 5,
        device_id: "windows".into(),
        record: sent[0].clone(),
    };
    ledger
        .accept_heads(&sent, &[ack], NOW + 2, project)
        .unwrap();
    assert_eq!(ledger.cursor().unwrap(), 0);
    let pending = ledger.outgoing().unwrap();
    assert_eq!(
        value(&metadata(&f.key, &pending[0], NOW + 2), "title"),
        Some("newest")
    );
    ledger
        .accept_pull(
            &Pull {
                records: vec![color],
                next_cursor: 6,
                has_more: false,
            },
            NOW + 2,
            project,
        )
        .unwrap();
    let union = ledger.outgoing().unwrap();
    let merged = metadata(&f.key, &union[0], NOW + 2);
    assert_eq!(value(&merged, "title"), Some("newest"));
    assert_eq!(value(&merged, "color"), Some("blue"));
    ledger
        .accept_heads(
            &union,
            &[Change {
                server_seq: 9,
                device_id: "windows".into(),
                record: union[0].clone(),
            }],
            NOW + 2,
            project,
        )
        .unwrap();
    assert!(ledger.outgoing().unwrap().is_empty());
    assert_eq!(ledger.cursor().unwrap(), 6);
}

#[test]
fn future_schema_is_durably_retained_before_cursor_progress_and_blocks_old_writes() {
    let mut f = fixture();
    let mut future = remote(&f.key, "project", "title", "future", NOW + 1, 10);
    let payload = crypto::seal_record(
        &f.key,
        &context(&identity(), &future.record),
        br#"{"schema_version":9,"new_field":"must retain"}"#,
    )
    .unwrap();
    future.record.nonce = payload.nonce;
    future.record.ciphertext = payload.ciphertext;
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    ledger
        .edit_metadata("projects", "project", NOW, |_, metadata, clock| {
            set(metadata, clock, "title", "unsent local");
            Ok(())
        })
        .unwrap();
    ledger
        .accept_pull(
            &Pull {
                records: vec![future.clone()],
                next_cursor: 10,
                has_more: false,
            },
            NOW + 1,
            project,
        )
        .unwrap();
    assert_eq!(ledger.cursor().unwrap(), 10);
    assert!(ledger.outgoing().unwrap().is_empty());
    assert_eq!(
        ledger
            .conn
            .query_row("SELECT count(*) FROM sync_outbox", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(ledger.deferred_records(0).unwrap()[0].1, future.record);
    assert!(matches!(
        ledger.edit_metadata("projects", "project", NOW + 2, |_, _, _| Ok(())),
        Err(SyncError::Deferred)
    ));
    drop(ledger);
    drop(f.store);
    let (mut store, _) = Store::open_encrypted(&f.profile, f.db).unwrap();
    let ledger = SyncLedger::new(&mut store, identity(), &f.key).unwrap();
    assert_eq!(ledger.cursor().unwrap(), 10);
    assert_eq!(ledger.deferred_records(0).unwrap()[0].1, future.record);
}

#[test]
fn account_device_key_and_plaintext_profile_substitution_are_rejected() {
    let mut f = fixture();
    drop(SyncLedger::new(&mut f.store, identity(), &f.key).unwrap());
    for bad in [
        SyncIdentity {
            account: "other".into(),
            ..identity()
        },
        SyncIdentity {
            device: "other".into(),
            ..identity()
        },
        SyncIdentity {
            key_version: 2,
            ..identity()
        },
    ] {
        assert!(matches!(
            SyncLedger::new(&mut f.store, bad, &f.key),
            Err(SyncError::Identity)
        ));
    }
    assert!(matches!(
        SyncLedger::new(&mut f.store, identity(), &AccountKey::generate().unwrap()),
        Err(SyncError::Identity)
    ));
    let local = tempfile::tempdir().unwrap();
    let (mut plain, _) = Store::open_at(
        &local.path().join("local.db"),
        &local.path().join("backups"),
    )
    .unwrap();
    assert!(matches!(
        SyncLedger::new(&mut plain, identity(), &f.key),
        Err(SyncError::Identity)
    ));
    assert_eq!(
        plain
            .conn()
            .query_row("SELECT count(*) FROM sync_state", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn local_fields_require_new_clocks_and_explicit_tombstones() {
    let mut f = fixture();
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    ledger
        .edit_metadata("projects", "project", NOW, |_, metadata, clock| {
            set(metadata, clock, "title", "retained");
            Ok(())
        })
        .unwrap();
    let before = ledger.outgoing().unwrap();
    assert!(
        ledger
            .edit_metadata("projects", "project", NOW + 1, |_, metadata, _| {
                metadata.fields.remove("title");
                Ok(())
            })
            .is_err()
    );
    assert!(
        ledger
            .edit_metadata("projects", "project", NOW + 1, |_, metadata, _| {
                metadata.fields.get_mut("title").unwrap().value =
                    FieldValue::Present("changed without clock".into());
                Ok(())
            })
            .is_err()
    );
    assert_eq!(ledger.outgoing().unwrap(), before);
    ledger
        .edit_metadata("projects", "project", NOW + 1, |_, metadata, clock| {
            metadata.fields.insert(
                "title".into(),
                Stamped {
                    clock: clock.clone(),
                    value: FieldValue::Deleted,
                },
            );
            Ok(())
        })
        .unwrap();
    assert!(matches!(
        metadata(&f.key, &ledger.outgoing().unwrap()[0], NOW + 1).fields["title"].value,
        FieldValue::Deleted
    ));
}

#[test]
fn invalid_page_contracts_do_not_advance_or_poison_the_saved_clock() {
    let mut f = fixture();
    let good = remote(&f.key, "project", "title", "valid", NOW, 1);
    let mut author = good.clone();
    author.device_id = "substituted".into();
    let mut version = good.clone();
    version.record.key_version = 2;
    let future = remote(&f.key, "project", "title", "future", NOW + 300_001, 1);
    let mut ledger = SyncLedger::new(&mut f.store, identity(), &f.key).unwrap();
    let initial = load_clock(ledger.conn, &identity()).unwrap().last().clone();
    for page in [
        Pull {
            records: vec![good.clone()],
            next_cursor: 2,
            has_more: false,
        },
        Pull {
            records: vec![good.clone()],
            next_cursor: 1,
            has_more: true,
        },
        Pull {
            records: vec![good.clone(), good],
            next_cursor: 1,
            has_more: false,
        },
        Pull {
            records: vec![author],
            next_cursor: 1,
            has_more: false,
        },
        Pull {
            records: vec![version],
            next_cursor: 1,
            has_more: false,
        },
        Pull {
            records: vec![future],
            next_cursor: 1,
            has_more: false,
        },
    ] {
        assert!(ledger.accept_pull(&page, NOW, project).is_err());
        assert_eq!(ledger.cursor().unwrap(), 0);
        assert_eq!(
            load_clock(ledger.conn, &identity()).unwrap().last(),
            &initial
        );
    }
}
