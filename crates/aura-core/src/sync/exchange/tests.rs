use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use aura_config::sync::{ConfigScope, ConfigSnapshotMetadata};
use std::sync::Arc;

fn fixture(key: Arc<AccountKey>, device: &str) -> (tempfile::TempDir, Store, SyncContext) {
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
        identity: SyncIdentity {
            account: "account".into(),
            device: device.into(),
            key_version: 1,
        },
        key,
    };
    context.initialize(&mut store).unwrap();
    (temp, store, context)
}
fn pending_work(store: &mut Store, context: &SyncContext) -> Pending {
    let Reply::Pending(pending) = execute(store, context, Command::Pending).unwrap() else {
        panic!("pending")
    };
    pending
}
fn publish(
    store: &mut Store,
    context: &SyncContext,
    id: &str,
) -> aura_config::sync::ConfigSnapshotHead {
    let config::Reply::Published(head) = config::execute(
        store,
        context,
        config::Command::Publish {
            id: id.into(),
            expected: None,
            snapshot: b"private fixture config".to_vec().into(),
            metadata: ConfigSnapshotMetadata {
                schema: 1,
                scope: ConfigScope::Portable,
                deleted: false,
            },
        },
    )
    .unwrap() else {
        panic!("head")
    };
    head
}

#[test]
fn blob_ack_binds_exact_upload_and_download_authenticates_head_before_exposing_snapshot() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_source_dir, mut source, source_context) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context) = fixture(key, "target");
    let id = "c".repeat(64);
    let head = publish(&mut source, &source_context, &id);
    let pending = pending_work(&mut source, &source_context);
    assert!(pending.records.is_empty());
    let upload = pending.upload.unwrap();
    let mut wrong = upload.clone();
    wrong.sealed.nonce = "A".repeat(32);
    assert!(
        execute(
            &mut source,
            &source_context,
            Command::Uploaded {
                sent: wrong,
                etag: "A".repeat(43)
            }
        )
        .is_err()
    );
    assert!(
        pending_work(&mut source, &source_context)
            .records
            .is_empty()
    );
    execute(
        &mut source,
        &source_context,
        Command::Uploaded {
            sent: upload.clone(),
            etag: "A".repeat(43),
        },
    )
    .unwrap();
    let outgoing = pending_work(&mut source, &source_context);
    assert!(outgoing.upload.is_none());
    assert_eq!(outgoing.records.len(), 1);
    let change = Change {
        server_seq: 1,
        device_id: "source".into(),
        record: outgoing.records[0].clone(),
    };
    execute(
        &mut target,
        &target_context,
        Command::Pull(Pull {
            records: vec![change.clone()],
            next_cursor: 1,
            has_more: false,
        }),
    )
    .unwrap();
    execute(
        &mut source,
        &source_context,
        Command::Heads {
            sent: outgoing.records,
            heads: vec![change],
        },
    )
    .unwrap();
    assert!(
        pending_work(&mut source, &source_context)
            .records
            .is_empty()
    );
    let pending = pending_work(&mut target, &target_context);
    assert_eq!(pending.cursor, 1);
    assert_eq!(pending.downloads.len(), 1);
    let request = pending.downloads[0].clone();
    let blob = Blob {
        etag: "A".repeat(43),
        nonce: upload.sealed.nonce.clone(),
        key_version: 1,
        size_bytes: crypto::decode(&upload.sealed.ciphertext, 4 * 1024 * 1024)
            .unwrap()
            .len() as u64,
        ciphertext: upload.sealed.ciphertext.clone(),
    };
    let mut wrong = blob.clone();
    wrong.size_bytes += 1;
    assert!(
        execute(
            &mut target,
            &target_context,
            Command::Downloaded {
                request: request.clone(),
                blob: wrong
            }
        )
        .is_err()
    );
    assert_eq!(
        pending_work(&mut target, &target_context).downloads.len(),
        1
    );
    let mut mismatched = request.clone();
    mismatched.id = crate::ids::new_id();
    assert!(
        execute(
            &mut target,
            &target_context,
            Command::Downloaded {
                request: mismatched,
                blob: blob.clone()
            }
        )
        .is_err()
    );
    execute(
        &mut target,
        &target_context,
        Command::Downloaded {
            request: request.clone(),
            blob: blob.clone(),
        },
    )
    .unwrap();
    execute(
        &mut target,
        &target_context,
        Command::Downloaded { request, blob },
    )
    .unwrap();
    assert!(
        pending_work(&mut target, &target_context)
            .downloads
            .is_empty()
    );
    let config::Reply::Snapshot(bytes) = config::execute(
        &mut target,
        &target_context,
        config::Command::Snapshot { id, head },
    )
    .unwrap() else {
        panic!("snapshot")
    };
    assert_eq!(&*bytes, b"private fixture config");
}

#[test]
fn transfer_boundaries_reject_oversized_batches_before_writer_admission() {
    let records = (0..33)
        .map(|_| Change {
            server_seq: 1,
            device_id: "device".into(),
            record: EncryptedRecord {
                collection: "projects".into(),
                id: crate::ids::new_id(),
                hlc: "0:0:device".into(),
                deleted: false,
                nonce: String::new(),
                ciphertext: String::new(),
                key_version: 1,
            },
        })
        .collect();
    assert!(
        Command::Pull(Pull {
            records,
            next_cursor: 1,
            has_more: false
        })
        .validate()
        .is_err()
    );
    assert!(etag("not-an-etag").is_err());
}
