//! Runs only when the compiled Worker runtime harness supplies its isolated loopback server.
use super::*;
use crate::crypto::{AccountKey, DeviceKey, RecordContext, RecoveryKey, SealedPayload};

#[tokio::test]
#[ignore = "Run through apps/api/tests/runtime.test.mjs with an isolated compiled Worker"]
async fn compiled_worker_roundtrip() {
    let origin = std::env::var("AURACODE_COMPILED_WORKER_URL").expect("owned Worker test server");
    let parsed = Url::parse(&origin).unwrap();
    assert_eq!(parsed.scheme(), "http");
    assert_eq!(parsed.host_str(), Some("127.0.0.1"));
    let api = ApiClient::local_test(&origin);
    // Public deterministic fixtures, created only in the harness's disposable database.
    let first = SessionToken::parse(crypto::encode(&[31; 32])).unwrap();
    let second = SessionToken::parse(crypto::encode(&[32; 32])).unwrap();
    let account = "rust-client-account";
    assert_eq!(api.session(&first).await.unwrap().user_id, account);
    let key = AccountKey::generate().unwrap();
    let device_key = DeviceKey::generate().unwrap();
    let first_device = api
        .register_device(
            &first,
            "Synthetic Windows",
            Platform::Windows,
            &device_key.public_key(),
        )
        .await
        .unwrap();
    let wrapped = crypto::wrap_device(
        &key,
        account,
        &first_device.device_id,
        1,
        &device_key.public_key(),
    )
    .unwrap();
    let recovery = RecoveryKey::generate().unwrap();
    let keys = api
        .initialize_keys(
            &first,
            &wrapped,
            &crypto::wrap_recovery(&key, &recovery, account, 1).unwrap(),
            &recovery.verifier(account, 1).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(keys.key_version, 1);
    let peer_key = DeviceKey::generate().unwrap();
    let peer = api
        .register_device(
            &second,
            "Synthetic Mac",
            Platform::Macos,
            &peer_key.public_key(),
        )
        .await
        .unwrap();
    assert!(matches!(
        api.pull(&second, 0).await,
        Err(ApiError::Forbidden)
    ));
    let wrapped =
        crypto::wrap_device(&key, account, &peer.device_id, 1, &peer_key.public_key()).unwrap();
    api.approve_device(&first, &peer.device_id, &peer.verification_code, &wrapped)
        .await
        .unwrap();
    let peer_keys = api.keys(&second).await.unwrap();
    let peer_account_key = crypto::unwrap_device(
        peer_keys.wrapped_key.as_ref().unwrap(),
        &peer_key,
        account,
        &peer.device_id,
        peer_keys.key_version,
    )
    .unwrap();
    assert_eq!(
        key.fingerprint(account, 1).unwrap(),
        peer_account_key.fingerprint(account, 1).unwrap()
    );
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let clock = format!("{now}:0000000001:{}", first_device.device_id);
    let context = RecordContext {
        account,
        collection: "projects",
        id: "rust-project",
        key_version: 1,
        hlc: &clock,
        deleted: false,
    };
    let plaintext = br#"{"name":"A synthetic shared project","schema_version":1}"#;
    let sealed = crypto::seal_record(&key, &context, plaintext).unwrap();
    let record = EncryptedRecord {
        collection: context.collection.into(),
        id: context.id.into(),
        hlc: clock.clone(),
        deleted: false,
        nonce: sealed.nonce.clone(),
        ciphertext: sealed.ciphertext.clone(),
        key_version: 1,
    };
    let heads = api
        .push(&first, std::slice::from_ref(&record))
        .await
        .unwrap();
    assert_eq!(
        api.push(&first, std::slice::from_ref(&record))
            .await
            .unwrap()
            .heads,
        heads.heads
    );
    let pulled = api.pull(&second, 0).await.unwrap();
    assert_eq!(pulled.records.len(), 1);
    assert!(!pulled.records[0].record.deleted);
    let peer_record = &pulled.records[0].record;
    let plaintext_again = crypto::open_record(
        &peer_account_key,
        &context,
        &SealedPayload {
            nonce: peer_record.nonce.clone(),
            ciphertext: peer_record.ciphertext.clone(),
        },
    )
    .unwrap();
    assert_eq!(plaintext_again.as_slice(), plaintext);
    assert!(
        api.pull(&second, pulled.next_cursor)
            .await
            .unwrap()
            .records
            .is_empty()
    );
    let blob =
        crypto::seal_blob(&key, account, "rust-attachment", 1, b"synthetic attachment").unwrap();
    let etag = api
        .put_blob(&first, "rust-attachment", &blob, 1, None)
        .await
        .unwrap();
    let fetched = api.blob(&second, "rust-attachment").await.unwrap();
    assert_eq!(fetched.etag, etag);
    assert_eq!(
        crypto::open_blob(
            &peer_account_key,
            account,
            "rust-attachment",
            1,
            &SealedPayload {
                nonce: fetched.nonce,
                ciphertext: fetched.ciphertext
            }
        )
        .unwrap()
        .as_slice(),
        b"synthetic attachment"
    );
    assert!(matches!(
        api.put_blob(&first, "rust-attachment", &blob, 1, None)
            .await,
        Err(ApiError::Conflict)
    ));
    let tombstone_clock = format!("{now}:0000000002:{}", first_device.device_id);
    let tombstone_context = RecordContext {
        hlc: &tombstone_clock,
        deleted: true,
        ..context
    };
    let deleted = crypto::seal_record(&key, &tombstone_context, b"{}").unwrap();
    api.push(
        &first,
        &[EncryptedRecord {
            hlc: tombstone_clock.clone(),
            deleted: true,
            nonce: deleted.nonce,
            ciphertext: deleted.ciphertext,
            ..record
        }],
    )
    .await
    .unwrap();
    let changes = api.pull(&second, pulled.next_cursor).await.unwrap();
    assert_eq!(changes.records.len(), 1);
    assert!(changes.records[0].record.deleted);
    api.revoke_device(&first, &peer.device_id).await.unwrap();
    assert!(matches!(
        api.pull(&second, 0).await,
        Err(ApiError::Unauthorized)
    ));
    assert!(api.pull(&first, 0).await.is_ok());
}
