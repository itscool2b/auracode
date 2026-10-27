use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use std::sync::Arc;

#[test]
fn device_rebinding_reissues_sender_without_promoting_config_edit_or_replacing_blob() {
    let (_temp, mut store, context) = fixture();
    let id = "a".repeat(64);
    let old = publish_one(&mut store, &context, &id, None, b"retained config snapshot");
    let wire = validate_id(&context, &id).unwrap();
    let mut current = context.clone();
    current.identity.device = "replacement-device".into();
    let mut clock = Clock::new(&current.identity.device).unwrap();
    let tx = store.conn_mut().transaction().unwrap();
    crate::sync::rebind::outgoing_for_device(
        &tx,
        &current.identity,
        &current.key,
        &mut clock,
        crate::time::now_millis() as u64,
    )
    .unwrap();
    tx.commit().unwrap();
    let record = head(store.conn(), "config", &wire).unwrap().unwrap();
    assert_eq!(
        record.hlc.parse::<Hlc>().unwrap().device(),
        "replacement-device"
    );
    let payload = decode(&current, &record).unwrap();
    assert_ne!(payload.head.revision, record.hlc);
    assert_eq!(payload.head, old);
    assert_eq!(
        &*read_snapshot(store.conn(), &current, &id, &payload.head).unwrap(),
        b"retained config snapshot"
    );
    assert_eq!(
        &*read_snapshot(store.conn(), &context, &id, &old).unwrap(),
        b"retained config snapshot"
    );
    let uploaded: i32 = store
        .conn()
        .query_row(
            "SELECT uploaded FROM sync_blobs WHERE id=?1",
            [payload.head.blob_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(uploaded, 0);
    let count: i64 = store
        .conn()
        .query_row("SELECT COUNT(*) FROM sync_blobs", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

fn rebound(store: &mut Store, context: &SyncContext, now: u64) -> SyncContext {
    let mut current = context.clone();
    current.identity.device = "replacement-device".into();
    let mut clock = Clock::new(&current.identity.device).unwrap();
    let tx = store.conn_mut().transaction().unwrap();
    crate::sync::rebind::outgoing_for_device(&tx, &current.identity, &current.key, &mut clock, now)
        .unwrap();
    tx.execute(
        "UPDATE sync_state SET device_id=?1,last_hlc=?2",
        params![current.identity.device, clock.last().to_string()],
    )
    .unwrap();
    tx.commit().unwrap();
    current
}

#[test]
fn later_remote_config_edit_wins_over_recovered_old_pending_transport() {
    let (_temp, mut source, source_context) = fixture();
    let (_other, mut remote, remote_context) =
        fixture_with(source_context.key.clone(), "remote-device");
    let id = "b".repeat(64);
    let old = publish_one(
        &mut source,
        &source_context,
        &id,
        None,
        b"old pending config",
    );
    let wire = validate_id(&source_context, &id).unwrap();
    let original = head(source.conn(), "config", &wire).unwrap().unwrap();
    let now = crate::time::now_millis() as u64;
    SyncLedger::new(
        &mut remote,
        remote_context.identity.clone(),
        &remote_context.key,
    )
    .unwrap()
    .accept_pull(&page(original, 1), now, |_, _, _| unreachable!())
    .unwrap();
    let newer = publish_one(
        &mut remote,
        &remote_context,
        &id,
        Some(old.revision.clone()),
        b"new remote config",
    );
    let remote_record = head(remote.conn(), "config", &wire).unwrap().unwrap();
    let current = rebound(&mut source, &source_context, now + 1000);
    let recovered = head(source.conn(), "config", &wire).unwrap().unwrap();
    assert!(recovered.hlc > remote_record.hlc);
    SyncLedger::new(&mut source, current.identity.clone(), &current.key)
        .unwrap()
        .accept_pull(
            &page(remote_record, 1),
            now + 1000,
            |_, _, _| unreachable!(),
        )
        .unwrap();
    assert_eq!(
        read_head(source.conn(), &current, &id)
            .unwrap()
            .unwrap()
            .head,
        newer
    );
    assert_eq!(
        source
            .conn()
            .query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        &*read_snapshot(source.conn(), &current, &id, &old).unwrap(),
        b"old pending config"
    );
}

#[test]
fn newer_content_reseals_as_current_sender_against_stale_content_with_later_transport() {
    let (_temp, mut source, source_context) = fixture();
    let (_other, mut remote, remote_context) =
        fixture_with(source_context.key.clone(), "remote-device");
    let id = "b".repeat(64);
    let old = publish_one(
        &mut source,
        &source_context,
        &id,
        None,
        b"old pending config",
    );
    let wire = validate_id(&source_context, &id).unwrap();
    let original = head(source.conn(), "config", &wire).unwrap().unwrap();
    let now = crate::time::now_millis() as u64;
    SyncLedger::new(
        &mut remote,
        remote_context.identity.clone(),
        &remote_context.key,
    )
    .unwrap()
    .accept_pull(&page(original, 1), now, |_, _, _| unreachable!())
    .unwrap();
    let newer = publish_one(
        &mut remote,
        &remote_context,
        &id,
        Some(old.revision.clone()),
        b"new remote config",
    );
    rebound(&mut source, &source_context, now + 1000);
    let stale = head(source.conn(), "config", &wire).unwrap().unwrap();
    SyncLedger::new(
        &mut remote,
        remote_context.identity.clone(),
        &remote_context.key,
    )
    .unwrap()
    .accept_pull(
        &page(stale.clone(), 2),
        now + 1000,
        |_, _, _| unreachable!(),
    )
    .unwrap();
    let winner = head(remote.conn(), "config", &wire).unwrap().unwrap();
    assert!(winner.hlc > stale.hlc);
    assert_eq!(
        winner.hlc.parse::<Hlc>().unwrap().device(),
        remote_context.identity.device
    );
    assert_eq!(
        read_head(remote.conn(), &remote_context, &id)
            .unwrap()
            .unwrap()
            .head,
        newer
    );
    remote
        .conn()
        .execute("UPDATE sync_blobs SET uploaded=1", [])
        .unwrap();
    let mut ledger = SyncLedger::new(
        &mut remote,
        remote_context.identity.clone(),
        &remote_context.key,
    )
    .unwrap();
    assert_eq!(ledger.outgoing().unwrap(), vec![winner.clone()]);
    ledger
        .accept_heads(
            std::slice::from_ref(&winner),
            &page(winner.clone(), 3).records,
            now + 1000,
            |_, _, _| unreachable!(),
        )
        .unwrap();
    assert!(ledger.outgoing().unwrap().is_empty());
}

fn fixture() -> (tempfile::TempDir, Store, SyncContext) {
    fixture_with(Arc::new(AccountKey::generate().unwrap()), "device")
}
fn fixture_with(key: Arc<AccountKey>, device: &str) -> (tempfile::TempDir, Store, SyncContext) {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let (mut store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let context = SyncContext {
        key,
        identity: SyncIdentity {
            account: "account".into(),
            device: device.into(),
            key_version: 1,
        },
    };
    context.initialize(&mut store).unwrap();
    (temp, store, context)
}

fn page(record: EncryptedRecord, sequence: u64) -> Pull {
    Pull {
        records: vec![Change {
            device_id: record.hlc.parse::<Hlc>().unwrap().device().into(),
            record,
            server_seq: sequence,
        }],
        next_cursor: sequence,
        has_more: false,
    }
}

#[test]
fn pulled_config_heads_wait_for_blobs_and_keep_newer_unsent_edits() {
    let (_temp, mut source, context) = fixture();
    let (_other, mut target, target_context) = fixture_with(context.key.clone(), "other-device");
    let id = "e".repeat(64);
    let first = publish_one(&mut source, &context, &id, None, b"remote config");
    let wire = validate_id(&context, &id).unwrap();
    let record = head(source.conn(), "config", &wire).unwrap().unwrap();
    let incoming = page(record.clone(), 1);
    SyncLedger::new(&mut target, target_context.identity.clone(), &context.key)
        .unwrap()
        .accept_pull(&incoming, crate::time::now_millis() as u64, |_, _, _| {
            panic!("config is not metadata")
        })
        .unwrap();
    assert_eq!(
        read_head(target.conn(), &target_context, &id)
            .unwrap()
            .unwrap()
            .head,
        first
    );
    assert_eq!(
        read_snapshot(target.conn(), &target_context, &id, &first),
        Err(ConfigPortError::Offline)
    );
    let local = publish_one(
        &mut target,
        &target_context,
        &id,
        Some(first.revision.clone()),
        b"new local edit",
    );
    let later = page(record, 2);
    SyncLedger::new(&mut target, target_context.identity.clone(), &context.key)
        .unwrap()
        .accept_pull(
            &later,
            crate::time::now_millis() as u64,
            |_, _, _| unreachable!(),
        )
        .unwrap();
    assert_eq!(
        read_head(target.conn(), &target_context, &id)
            .unwrap()
            .unwrap()
            .head,
        local
    );
    assert_eq!(
        target
            .conn()
            .query_row(
                "SELECT count(*) FROM sync_outbox WHERE collection='config'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        &*read_snapshot(target.conn(), &target_context, &id, &local).unwrap(),
        b"new local edit"
    );
}

#[test]
fn config_clock_collision_rolls_back_page_and_future_payload_is_retained() {
    let (_temp, mut store, context) = fixture();
    let id = "f".repeat(64);
    publish_one(&mut store, &context, &id, None, b"original");
    let wire = validate_id(&context, &id).unwrap();
    let original = head(store.conn(), "config", &wire).unwrap().unwrap();
    let mut payload = decode(&context, &original).unwrap();
    payload.head.content_hash = "0".repeat(64);
    let mut forged = original.clone();
    let sealed = crypto::seal_record(
        &context.key,
        &super::super::context(&context.identity, &forged),
        &serde_json::to_vec(&payload).unwrap(),
    )
    .unwrap();
    forged.nonce = sealed.nonce;
    forged.ciphertext = sealed.ciphertext;
    let mut ledger = SyncLedger::new(&mut store, context.identity.clone(), &context.key).unwrap();
    assert!(
        ledger
            .accept_pull(
                &page(forged, 1),
                crate::time::now_millis() as u64,
                |_, _, _| unreachable!()
            )
            .is_err()
    );
    assert_eq!(ledger.cursor().unwrap(), 0);

    payload.schema_version = 2;
    let mut future = original;
    let sealed = crypto::seal_record(
        &context.key,
        &super::super::context(&context.identity, &future),
        &serde_json::to_vec(&payload).unwrap(),
    )
    .unwrap();
    future.nonce = sealed.nonce;
    future.ciphertext = sealed.ciphertext;
    ledger
        .accept_pull(
            &page(future.clone(), 1),
            crate::time::now_millis() as u64,
            |_, _, _| unreachable!(),
        )
        .unwrap();
    assert_eq!(ledger.cursor().unwrap(), 1);
    assert_eq!(ledger.deferred_records(0).unwrap()[0].1, future);
    assert!(ledger.outgoing().unwrap().is_empty());
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
