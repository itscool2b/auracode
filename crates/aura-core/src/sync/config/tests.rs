use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use std::sync::Arc;

fn fixture() -> (tempfile::TempDir, Store, SyncContext) {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let (mut store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let context = SyncContext {
        key,
        identity: SyncIdentity {
            account: "account".into(),
            device: "device".into(),
            key_version: 1,
        },
    };
    context.initialize(&mut store).unwrap();
    (temp, store, context)
}
fn metadata() -> ConfigSnapshotMetadata {
    ConfigSnapshotMetadata {
        schema: 1,
        scope: ConfigScope::Windows,
        deleted: false,
    }
}
fn publish_one(
    store: &mut Store,
    context: &SyncContext,
    id: &str,
    expected: Option<String>,
    text: &[u8],
) -> ConfigSnapshotHead {
    let Reply::Published(head) = execute(
        store,
        context,
        Command::Publish {
            id: id.into(),
            expected,
            snapshot: Zeroizing::new(text.into()),
            metadata: metadata(),
        },
    )
    .unwrap() else {
        panic!("head")
    };
    head
}

#[test]
fn snapshot_binding_revision_and_upload_order_are_enforced() {
    let (_temp, mut store, context) = fixture();
    let id = "a".repeat(64);
    let head = publish_one(&mut store, &context, &id, None, b"private config");
    let wire = context.key.config_record_id("account", &id).unwrap();
    assert_ne!(wire, id);
    assert_ne!(
        wire,
        context.key.config_record_id("other-account", &id).unwrap()
    );
    assert!(
        SyncLedger::new(&mut store, context.identity.clone(), &context.key)
            .unwrap()
            .outgoing()
            .unwrap()
            .is_empty()
    );
    let stale = execute(
        &mut store,
        &context,
        Command::Publish {
            id: id.clone(),
            expected: None,
            snapshot: Zeroizing::new(b"stale".to_vec()),
            metadata: metadata(),
        },
    );
    assert!(matches!(stale, Err(ConfigPortError::Stale)));
    assert!(read_snapshot(store.conn(), &context, &"b".repeat(64), &head).is_err());
    assert_eq!(
        &*read_snapshot(store.conn(), &context, &id, &head).unwrap(),
        b"private config"
    );
    store
        .conn()
        .execute(
            "UPDATE sync_blobs SET uploaded=1 WHERE id=?1",
            [&head.blob_id],
        )
        .unwrap();
    assert_eq!(
        SyncLedger::new(&mut store, context.identity.clone(), &context.key)
            .unwrap()
            .outgoing()
            .unwrap()
            .len(),
        1
    );
    let newer = publish_one(
        &mut store,
        &context,
        &id,
        Some(head.revision.clone()),
        b"new config",
    );
    assert_ne!(head.revision, newer.revision);
    assert_eq!(
        &*read_snapshot(store.conn(), &context, &id, &head).unwrap(),
        b"private config",
        "old merge base remains readable"
    );
}

#[test]
fn device_flags_use_a_separate_revision_even_when_base_is_unchanged() {
    let (_temp, mut store, context) = fixture();
    let id = "a".repeat(64);
    let empty = |revision| ConfigDeviceState {
        revision,
        head: None,
        snapshot: None,
        device_only: true,
        skipped: None,
    };
    execute(
        &mut store,
        &context,
        Command::SaveDevice {
            id: id.clone(),
            expected: None,
            state: empty(None),
        },
    )
    .unwrap();
    let before = read_device(store.conn(), &id).unwrap().unwrap();
    let revision = before.revision.clone();
    execute(
        &mut store,
        &context,
        Command::SaveDevice {
            id: id.clone(),
            expected: None,
            state: empty(revision.clone()),
        },
    )
    .unwrap();
    let late = execute(
        &mut store,
        &context,
        Command::SaveDevice {
            id: id.clone(),
            expected: None,
            state: empty(revision),
        },
    );
    assert!(matches!(late, Err(ConfigPortError::Stale)));
    assert!(read_device(store.conn(), &id).unwrap().unwrap().device_only);
    let mut invalid = read_device(store.conn(), &id).unwrap().unwrap();
    invalid.skipped = Some("vendor\ncontrol".into());
    assert!(matches!(
        execute(
            &mut store,
            &context,
            Command::SaveDevice {
                id,
                expected: None,
                state: invalid
            }
        ),
        Err(ConfigPortError::Invalid)
    ));
}

#[test]
fn a_failed_publish_retains_the_previous_head_and_blob_queue() {
    let (_temp, mut store, context) = fixture();
    let id = "a".repeat(64);
    let head = publish_one(&mut store, &context, &id, None, b"before");
    store.conn().execute_batch("CREATE TEMP TRIGGER refuse_head BEFORE UPDATE ON sync_heads BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(matches!(
        execute(
            &mut store,
            &context,
            Command::Publish {
                id: id.clone(),
                expected: Some(head.revision.clone()),
                snapshot: Zeroizing::new(b"after".to_vec()),
                metadata: metadata()
            }
        ),
        Err(ConfigPortError::Storage)
    ));
    assert_eq!(
        read_head(store.conn(), &context, &id)
            .unwrap()
            .unwrap()
            .head,
        head
    );
    assert_eq!(
        store
            .conn()
            .query_row("SELECT COUNT(*) FROM sync_blobs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
