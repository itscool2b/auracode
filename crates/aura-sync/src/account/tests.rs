use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

#[tokio::test]
async fn deleted_account_retains_its_key_and_durable_state_without_network_retries() {
    let (mut account, store) = account().await;
    ready(&mut account).await;
    let id = account.id.clone();
    assert!(matches!(
        account.response::<()>(Err(ApiError::Deleted)).await,
        Err(AccountError::Api(ApiError::Deleted))
    ));
    assert_eq!(account.access(), &Access::Deleted);
    assert!(account.bundle.session.is_none());
    assert!(account.local_key_handle().is_some());
    let mut restored = Account::restore(api(), &id, store.clone(), 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.access(), &Access::Deleted);
    assert!(restored.local_key_handle().is_some());
    assert!(matches!(
        restored.check(100).await,
        Err(AccountError::Api(ApiError::Deleted))
    ));
    restored.clear_session(Access::SignedOut).await.unwrap();
    assert_eq!(restored.access(), &Access::Deleted);
    assert!(matches!(
        Account::signed_in(
            api(),
            VerifiedSession {
                user_id: id,
                token: token(),
                expires_at: 10_000,
            },
            store
        )
        .await,
        Err(AccountError::Api(ApiError::Deleted))
    ));
}

#[test]
fn bundle_v3_reads_v1_and_v2_and_rejects_unknown_or_inconsistent_deleted_states() {
    let bundle = Bundle::new().unwrap();
    let mut bytes = bundle.encode().unwrap();
    assert_eq!(bytes[12], 3);
    let v2_length = bytes.len() - 2;
    bytes.truncate(v2_length);
    bytes[12] = 2;
    assert!(!Bundle::decode(&bytes).unwrap().account_deleted);
    bytes[12] = 1;
    bytes.pop();
    assert!(!Bundle::decode(&bytes).unwrap().account_deleted);
    bytes[12] = 4;
    assert!(Bundle::decode(&bytes).is_err());
    bytes[12] = 2;
    bytes.push(2);
    assert!(Bundle::decode(&bytes).is_err());
    let mut bundle = Bundle::new().unwrap();
    bundle.account_deleted = true;
    bundle.session = Some(SavedSession {
        token: token(),
        expires_at: 1000,
    });
    assert!(Bundle::decode(&bundle.encode().unwrap()).is_err());
}

async fn staged_reset() -> (Account, Arc<Memory>, serde_json::Value, Zeroizing<String>) {
    let (mut account, store) = account().await;
    account.bundle.device_id = Some("device".into());
    account.access = Access::PendingApproval {
        code: "123456".into(),
    };
    let (wire, reviewed) = script(vec![(
        "POST /api/v1/sync/reset/review ",
        "200 OK",
        serde_json::json!({"review":{"id":"receipt","key_version":8,"expires_at":400,"records":2,"blobs":1,"other_devices":1}}),
    )]);
    account.api = wire;
    let setup = account.prepare_reset(100).await.unwrap();
    let recovery = setup.recovery_text();
    reviewed.join().unwrap();
    let (wire, first) = script(vec![(
        "POST /api/v1/sync/reset ",
        "503 Unavailable",
        serde_json::json!({"error":"unavailable"}),
    )]);
    account.api = wire;
    assert!(
        account
            .confirm_reset(setup, "RESET SYNC", 100)
            .await
            .is_err()
    );
    (account, store, first.join().unwrap().remove(0), recovery)
}
#[tokio::test]
async fn reset_retries_exact_persisted_request_after_restart_and_uses_the_next_epoch() {
    let (account, store, first, recovery) = staged_reset().await;
    let id = account.id.clone();
    assert_eq!(account.pending_reset_version(), Some(8));
    assert!(account.local_key().is_none());
    drop(account);
    let mut account = Account::restore(api(), &id, store.clone(), 100)
        .await
        .unwrap()
        .unwrap();
    let pending = account.bundle.pending_reset.as_ref().unwrap();
    let recovered = crypto::unwrap_recovery(
        &pending.request.recovery_envelope,
        &RecoveryKey::parse(&recovery).unwrap(),
        &id,
        8,
    )
    .unwrap();
    assert!(
        crypto::unwrap_recovery(
            &pending.request.recovery_envelope,
            &RecoveryKey::parse(&recovery).unwrap(),
            &id,
            1
        )
        .is_err()
    );
    let response = serde_json::json!({"key_version":8,"approved_at":100,"wrapped_key":pending.request.wrapped_key,"recovery_envelope":pending.request.recovery_envelope});
    let (wire, done) = script(vec![("POST /api/v1/sync/reset ", "200 OK", response)]);
    account.api = wire;
    account.retry_reset(100).await.unwrap();
    assert_eq!(first, done.join().unwrap().remove(0));
    assert_eq!(account.local_key().unwrap().1, 8);
    assert_eq!(
        account.key_fingerprint().unwrap().unwrap(),
        recovered.fingerprint(&id, 8).unwrap()
    );
    assert!(account.reset_committed());
    account.acknowledge_reset_profile().await.unwrap();
    assert!(account.pending_reset_version().is_none());
}
#[tokio::test]
async fn reset_cancel_arbitrates_before_discarding_its_unconfirmed_key() {
    for (outcome, version, abandoned) in [
        ("committed", 8, false),
        ("absent", 8, false),
        ("cancelled", 8, true),
        ("absent", 7, true),
    ] {
        let (mut account, _, _, _) = staged_reset().await;
        let (wire, done) = script(vec![(
            "POST /api/v1/sync/reset/cancel ",
            "200 OK",
            serde_json::json!({"outcome":outcome,"key_version":version}),
        )]);
        account.api = wire;
        assert_eq!(account.cancel_reset(100).await.unwrap(), abandoned);
        done.join().unwrap();
        assert_eq!(account.bundle.pending_reset.is_none(), abandoned);
        assert_eq!(account.bundle.account_key.is_none(), abandoned);
    }
}
#[tokio::test]
async fn reset_vault_failure_prevents_dispatch_and_preserves_retry_material() {
    let (mut account, store, _, _) = staged_reset().await;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    account.api = ApiClient::local_test(&format!("http://{}/", listener.local_addr().unwrap()));
    store.fail.store(true, Ordering::SeqCst);
    assert!(matches!(
        account.retry_reset(100).await,
        Err(AccountError::Vault(_))
    ));
    assert!(matches!(listener.accept(),Err(error) if error.kind()==std::io::ErrorKind::WouldBlock));
    assert_eq!(account.pending_reset_version(), Some(8));
    assert!(account.bundle.account_key.is_some());
}
#[tokio::test]
async fn fresh_sign_in_does_not_rotate_away_a_pending_reset_key() {
    let (mut account, _, _, _) = staged_reset().await;
    let public = account.bundle.device_key.public_key();
    let (wire, done) = script(vec![
        (
            "GET /api/v1/auth/session ",
            "200 OK",
            session(&account, None),
        ),
        (
            "GET /api/v1/devices/device ",
            "200 OK",
            device(&account, false),
        ),
    ]);
    account.api = wire;
    account.connect(100).await.unwrap();
    done.join().unwrap();
    assert_eq!(account.device_id(), Some("device"));
    assert_eq!(account.bundle.device_key.public_key(), public);
    assert_eq!(account.pending_reset_version(), Some(8));
}

#[derive(Default)]
struct Memory {
    values: Mutex<HashMap<VaultEntry, Zeroizing<Vec<u8>>>>,
    fail: AtomicBool,
    saves: AtomicU64,
}
impl SecretStore for Memory {
    fn load(&self, entry: &VaultEntry) -> crate::vault::Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.values.lock().unwrap().get(entry).cloned())
    }
    fn save(&self, entry: &VaultEntry, secret: &[u8]) -> crate::vault::Result<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(VaultError::Unavailable);
        }
        self.values
            .lock()
            .unwrap()
            .insert(entry.clone(), Zeroizing::new(secret.to_vec()));
        self.saves.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn remove(&self, entry: &VaultEntry) -> crate::vault::Result<()> {
        self.values.lock().unwrap().remove(entry);
        Ok(())
    }
}
fn api() -> ApiClient {
    ApiClient::new("https://account.example.invalid").unwrap()
}
fn token() -> SessionToken {
    SessionToken::parse(crypto::encode(&[8; 32])).unwrap()
}
async fn account() -> (Account, Arc<Memory>) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let id = format!("account{}", NEXT.fetch_add(1, Ordering::SeqCst));
    let store = Arc::new(Memory::default());
    let account = Account::signed_in(
        api(),
        VerifiedSession {
            user_id: id,
            token: token(),
            expires_at: 10_000,
        },
        store.clone(),
    )
    .await
    .unwrap();
    (account, store)
}
fn key() -> AccountKey {
    AccountKey::restore(&[2; 32]).unwrap()
}
fn keys(account: &Account, key: &AccountKey) -> Keys {
    Keys {
        key_version: 1,
        approved_at: Some(10),
        wrapped_key: Some(
            crypto::wrap_device(
                key,
                &account.id,
                "device",
                1,
                &account.bundle.device_key.public_key(),
            )
            .unwrap(),
        ),
        recovery_envelope: crypto::wrap_recovery(
            key,
            &RecoveryKey::generate().unwrap(),
            &account.id,
            1,
        )
        .unwrap(),
    }
}
fn json_keys(keys: &Keys) -> serde_json::Value {
    serde_json::json!({"key_version":keys.key_version,"approved_at":keys.approved_at,"wrapped_key":keys.wrapped_key,"recovery_envelope":keys.recovery_envelope})
}
async fn ready(account: &mut Account) {
    account.bundle.device_id = Some("device".into());
    account.bundle.account_key = Some(SavedKey {
        key: Arc::new(key()),
        version: 1,
        confirmed: false,
        local_proof: true,
    });
    account.accept_keys(keys(account, &key())).await.unwrap();
    assert_eq!(account.access, Access::Ready);
}

type Reply = (&'static str, &'static str, serde_json::Value);
fn script(replies: Vec<Reply>) -> (ApiClient, std::thread::JoinHandle<Vec<serde_json::Value>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let api = ApiClient::local_test(&format!("http://{}/", listener.local_addr().unwrap()));
    let thread = std::thread::spawn(move || {
        let mut bodies = Vec::new();
        for (expected, status, body) in replies {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "expected request: {expected}");
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("listener: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            let end = loop {
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buffer[..n]);
                if let Some(end) = request.windows(4).position(|b| b == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .map(|v| v.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break end;
                    }
                }
            };
            assert!(String::from_utf8_lossy(&request[..end]).starts_with(expected));
            bodies.push(
                serde_json::from_slice(&request[end + 4..]).unwrap_or(serde_json::Value::Null),
            );
            let body = body.to_string();
            write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        bodies
    });
    (api, thread)
}
fn session(account: &Account, device: Option<&str>) -> serde_json::Value {
    serde_json::json!({"session":{"user_id":account.id,"client_kind":"desktop","device_id":device,"created_at":1,"expires_at":10000}})
}
fn device(account: &Account, approved: bool) -> serde_json::Value {
    serde_json::json!({"device":{"id":"device","name":"Test computer","platform":"windows","public_key":account.bundle.device_key.public_key(),"verification_code":account.bundle.device_key.approval_code(&account.id,"device").unwrap(),"created_at":1,"last_seen":10,"approved_at":approved.then_some(10),"revoked_at":null}})
}

#[tokio::test]
async fn lost_registration_response_is_reconciled_but_first_remote_key_needs_human_confirmation() {
    let (mut account, _) = account().await;
    let public = account.bundle.device_key.public_key();
    let data_key = key();
    let wrapped = keys(&account, &data_key);
    let (wire, done) = script(vec![
        (
            "GET /api/v1/auth/session ",
            "200 OK",
            session(&account, Some("device")),
        ),
        (
            "GET /api/v1/devices/device ",
            "200 OK",
            device(&account, true),
        ),
        ("GET /api/v1/keys ", "200 OK", json_keys(&wrapped)),
    ]);
    account.api = wire;
    account.connect(100).await.unwrap();
    assert_eq!(account.device_id(), Some("device"));
    assert_eq!(account.bundle.device_key.public_key(), public);
    let fingerprint = data_key.fingerprint(&account.id, 1).unwrap();
    assert_eq!(
        account.access,
        Access::VerifyAccountKey {
            fingerprint: fingerprint.clone()
        }
    );
    assert!(account.local_key().is_none());
    assert!(account.local_key_handle().is_none());
    assert!(matches!(
        account.pull(0, 100).await,
        Err(AccountError::State)
    ));
    assert!(matches!(
        account.confirm_account_key("wrong fingerprint", 100).await,
        Err(AccountError::State)
    ));
    account
        .confirm_account_key(&fingerprint, 100)
        .await
        .unwrap();
    assert_eq!(account.access, Access::Ready);
    assert_eq!(account.key_fingerprint().unwrap(), Some(fingerprint));
    assert_eq!(done.join().unwrap().len(), 3);
}

#[tokio::test]
async fn auth_rejection_and_local_expiry_stop_network_without_deleting_the_data_key() {
    for status in ["401 Unauthorized", "403 Forbidden"] {
        let (mut account, store) = account().await;
        ready(&mut account).await;
        let fingerprint = account.key_fingerprint().unwrap();
        let (wire, done) = script(vec![(
            "GET /api/v1/sync?after=0 ",
            status,
            serde_json::json!({"message":"must never surface"}),
        )]);
        account.api = wire;
        assert!(account.pull(0, 100).await.is_err());
        assert!(matches!(account.access, Access::Expired | Access::Denied));
        assert!(account.bundle.session.is_none());
        assert_eq!(account.key_fingerprint().unwrap(), fingerprint);
        assert!(matches!(
            account.pull(0, 100).await,
            Err(AccountError::State)
        ));
        done.join().unwrap();
        let restored = Account::restore(api(), &account.id, store, 100)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(restored.access, Access::SignedOut);
        assert_eq!(restored.key_fingerprint().unwrap(), fingerprint);
    }
    let (mut account, _) = account().await;
    ready(&mut account).await;
    assert!(matches!(
        account.pull(0, 10000).await,
        Err(AccountError::Api(ApiError::Unauthorized))
    ));
    assert_eq!(account.access, Access::Expired);
    assert!(account.local_key().is_some());
}

#[tokio::test]
async fn invitation_denial_pauses_sync_and_retains_the_session_and_data_key() {
    let (mut account, store) = account().await;
    ready(&mut account).await;
    let fingerprint = account.key_fingerprint().unwrap();
    let stored = store.load(&account.entry).unwrap();
    let (wire, done) = script(vec![(
        "GET /api/v1/sync?after=0 ",
        "403 Forbidden",
        serde_json::json!({"error":"invite_required", "message":"untrusted detail"}),
    )]);
    account.api = wire;
    assert!(matches!(
        account.pull(0, 100).await,
        Err(AccountError::Api(ApiError::InviteRequired))
    ));
    assert_eq!(account.access(), &Access::InviteRequired);
    assert!(account.bundle.session.is_some());
    assert_eq!(account.key_fingerprint().unwrap(), fingerprint);
    assert_eq!(store.load(&account.entry).unwrap(), stored);
    // Repeated cloud operations do not send another request until explicit refresh rechecks access.
    assert!(matches!(
        account.pull(0, 100).await,
        Err(AccountError::Api(ApiError::InviteRequired))
    ));
    assert_eq!(done.join().unwrap().len(), 1);
    let restored = Account::restore(api(), &account.id, store, 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.access(), &Access::VerificationRequired);
    assert!(restored.bundle.session.is_some());
    assert_eq!(restored.key_fingerprint().unwrap(), fingerprint);
}

#[tokio::test]
async fn lost_blob_upload_acknowledgement_accepts_only_exact_existing_ciphertext() {
    for substituted in [false, true] {
        let (mut account, _) = account().await;
        ready(&mut account).await;
        let sealed = crypto::seal_blob(
            &key(),
            &account.id,
            "blob",
            1,
            b"private synthetic snapshot",
        )
        .unwrap();
        let returned = if substituted {
            crypto::seal_blob(&key(), &account.id, "blob", 1, b"different object").unwrap()
        } else {
            sealed.clone()
        };
        let (wire, done) = script(vec![
            (
                "PUT /api/v1/blobs/blob ",
                "409 Conflict",
                serde_json::json!({}),
            ),
            (
                "GET /api/v1/blobs/blob ",
                "200 OK",
                serde_json::json!({"etag":crypto::encode(&[9;32]),"nonce":returned.nonce,"ciphertext":returned.ciphertext,"key_version":1,"size_bytes":crypto::decode(&returned.ciphertext,4*1024*1024).unwrap().len()}),
            ),
        ]);
        account.api = wire;
        let result = account.upload_blob("blob", &sealed, 1, 100).await;
        if substituted {
            assert!(matches!(result, Err(AccountError::Api(ApiError::Protocol))));
        } else {
            assert_eq!(result.unwrap(), crypto::encode(&[9; 32]));
        }
        let requests = done.join().unwrap();
        assert_eq!(requests[0]["expected_etag"], serde_json::Value::Null);
        assert_eq!(requests[0]["ciphertext"], sealed.ciphertext);
        assert_eq!(account.access(), &Access::Ready);
    }
}

#[tokio::test]
async fn remote_key_swap_cannot_replace_a_pinned_or_locally_proven_key() {
    let (mut account, _) = account().await;
    ready(&mut account).await;
    let pinned = account.key_fingerprint().unwrap();
    let attacker = AccountKey::restore(&[9; 32]).unwrap();
    account.access = Access::VerificationRequired;
    assert!(matches!(
        account.accept_keys(keys(&account, &attacker)).await,
        Err(AccountError::Api(ApiError::Protocol))
    ));
    assert_eq!(account.key_fingerprint().unwrap(), pinned);
    account.bundle.account_key.as_mut().unwrap().confirmed = false;
    account.bundle.account_key.as_mut().unwrap().local_proof = true;
    assert!(
        account
            .accept_keys(keys(&account, &attacker))
            .await
            .is_err()
    );
    account.bundle.account_key = None;
    account
        .accept_keys(keys(&account, &attacker))
        .await
        .unwrap();
    assert!(matches!(account.access, Access::VerifyAccountKey { .. }));
    assert!(
        account
            .confirm_account_key(pinned.as_deref().unwrap(), 100)
            .await
            .is_err()
    );
    assert!(account.local_key().is_none());
}

#[tokio::test]
async fn signout_halts_immediately_and_a_new_owner_invalidates_old_network_access() {
    let (mut old, store) = account().await;
    ready(&mut old).await;
    let fingerprint = old.key_fingerprint().unwrap();
    let mut current = Account::signed_in(
        api(),
        VerifiedSession {
            user_id: old.id.clone(),
            token: token(),
            expires_at: 20000,
        },
        store.clone(),
    )
    .await
    .unwrap();
    assert!(matches!(old.pull(0, 100).await, Err(AccountError::State)));
    assert!(matches!(old.sign_out().await, Err(AccountError::State)));
    assert_eq!(current.access, Access::VerificationRequired);
    assert_eq!(current.key_fingerprint().unwrap(), fingerprint);
    let (wire, done) = script(vec![(
        "POST /api/v1/auth/logout ",
        "503 Unavailable",
        serde_json::json!({}),
    )]);
    current.api = wire;
    let outcome = current.sign_out().await.unwrap();
    assert!(!outcome.server_revoked);
    assert_eq!(current.access, Access::SignedOut);
    assert_eq!(current.key_fingerprint().unwrap(), fingerprint);
    done.join().unwrap();
    let restored = Account::restore(api(), &current.id, store, 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.access, Access::SignedOut);
    assert_eq!(restored.key_fingerprint().unwrap(), fingerprint);
}

#[tokio::test]
async fn cancelled_queued_write_cannot_restore_an_older_secret_bundle() {
    let (account, store) = account().await;
    let writes = account.writes.clone();
    let (held_send, held) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let guard = std::thread::spawn(move || {
        let _lock = writes.serial.lock().unwrap();
        held_send.send(()).unwrap();
        wait.recv().unwrap();
    });
    held.await.unwrap();
    let before = store.saves.load(Ordering::SeqCst);
    let mut older = Box::pin(account.persist_data(Zeroizing::new(b"older token".to_vec())));
    assert!(
        tokio::time::timeout(Duration::from_millis(10), &mut older)
            .await
            .is_err()
    );
    drop(older);
    let mut newer = Box::pin(account.persist_data(Zeroizing::new(b"signed out".to_vec())));
    assert!(
        tokio::time::timeout(Duration::from_millis(10), &mut newer)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    newer.await.unwrap();
    guard.join().unwrap();
    assert_eq!(
        store.load(&account.entry).unwrap().unwrap().as_slice(),
        b"signed out"
    );
    assert_eq!(store.saves.load(Ordering::SeqCst), before + 1);
}

#[tokio::test]
async fn unsupported_or_truncated_local_bundles_are_preserved() {
    let (mut account, store) = account().await;
    ready(&mut account).await;
    let encoded = account.bundle.encode().unwrap();
    for end in 0..encoded.len() {
        assert!(Bundle::decode(&encoded[..end]).is_err());
    }
    let mut future = encoded.to_vec();
    future[12] = 2;
    store.save(&account.entry, &future).unwrap();
    assert!(matches!(
        Account::restore(api(), &account.id, store.clone(), 100).await,
        Err(AccountError::StoredData)
    ));
    assert_eq!(
        store.load(&account.entry).unwrap().unwrap().as_slice(),
        future
    );
}
#[tokio::test]
async fn first_device_setup_sends_only_envelopes_and_pins_the_locally_generated_key() {
    let (mut account, _) = account().await;
    account.bundle.device_id = Some("device".into());
    account.access = Access::NeedsFirstKey;
    let setup = account.prepare_first_key().unwrap();
    let text = setup.recovery_text();
    let fingerprint = setup.key.fingerprint(&account.id, 1).unwrap();
    let reply = keys(&account, &setup.key);
    let (wire, done) = script(vec![("POST /api/v1/keys ", "200 OK", json_keys(&reply))]);
    account.api = wire;
    account.initialize(setup, 100).await.unwrap();
    assert_eq!(account.access, Access::Ready);
    assert_eq!(
        account.key_fingerprint().unwrap(),
        Some(fingerprint.clone())
    );
    let requests = done.join().unwrap();
    assert!(!requests[0].to_string().contains(text.as_str()));
    let envelope: crypto::KeyEnvelope =
        serde_json::from_value(requests[0]["recovery_envelope"].clone()).unwrap();
    let retained = RecoveryKey::parse(&text).unwrap();
    let opened = crypto::unwrap_recovery(&envelope, &retained, &account.id, 1).unwrap();
    assert_eq!(opened.fingerprint(&account.id, 1).unwrap(), fingerprint);
    assert_eq!(
        requests[0]["recovery_verifier"],
        retained.verifier(&account.id, 1).unwrap()
    );
}

#[tokio::test]
async fn recovery_pins_the_key_opened_with_the_user_held_master_before_server_confirmation() {
    let (mut account, _) = account().await;
    account.bundle.device_id = Some("device".into());
    account.access = Access::PendingApproval {
        code: "123456".into(),
    };
    let recovery = RecoveryKey::generate().unwrap();
    let proof = recovery.auth_proof(&account.id, 1).unwrap();
    let mut pending = keys(&account, &key());
    pending.recovery_envelope = crypto::wrap_recovery(&key(), &recovery, &account.id, 1).unwrap();
    pending.wrapped_key = None;
    pending.approved_at = None;
    let (wire, done) = script(vec![
        ("GET /api/v1/keys ", "200 OK", json_keys(&pending)),
        (
            "POST /api/v1/devices/recover ",
            "200 OK",
            json_keys(&keys(&account, &key())),
        ),
    ]);
    account.api = wire;
    account.recover(recovery, 100).await.unwrap();
    assert_eq!(account.access, Access::Ready);
    assert_eq!(
        account.key_fingerprint().unwrap(),
        Some(key().fingerprint(&account.id, 1).unwrap())
    );
    let requests = done.join().unwrap();
    assert_eq!(requests[1]["recovery_proof"], proof.as_str());
    assert_eq!(requests[1].as_object().unwrap().len(), 2);
}

#[tokio::test]
async fn failed_signout_storage_is_reported_and_still_halts_the_live_owner() {
    let (mut account, store) = account().await;
    ready(&mut account).await;
    let (writer_key, version) = account.local_key_handle().unwrap();
    let pinned = writer_key.fingerprint(account.id(), version).unwrap();
    store.fail.store(true, Ordering::SeqCst);
    let (wire, done) = script(vec![(
        "POST /api/v1/auth/logout ",
        "200 OK",
        serde_json::json!({"ok":true}),
    )]);
    account.api = wire;
    assert!(matches!(
        account.sign_out().await,
        Err(AccountError::Vault(VaultError::Unavailable))
    ));
    assert_eq!(account.access, Access::SignedOut);
    assert!(account.bundle.session.is_none());
    assert!(account.local_key().is_some());
    assert_eq!(account.key_fingerprint().unwrap(), Some(pinned));
    assert_eq!(
        writer_key.fingerprint(account.id(), version).unwrap(),
        account.key_fingerprint().unwrap().unwrap()
    );
    assert!(matches!(
        account.pull(0, 100).await,
        Err(AccountError::State)
    ));
    done.join().unwrap();
}

#[tokio::test]
async fn device_list_recomputes_codes_and_revocation_keeps_only_local_access() {
    let (mut account, _) = account().await;
    ready(&mut account).await;
    let public = account.bundle.device_key.public_key();
    let expected = crypto::approval_code(&account.id, "device", &public).unwrap();
    let (wire, done) = script(vec![
        (
            "GET /api/v1/devices ",
            "200 OK",
            serde_json::json!({"devices":[{
                "id":"device","name":"My PC","platform":"windows","public_key":public,
                "verification_code":"000000","created_at":10,"last_seen":20,"approved_at":15,"revoked_at":null
            }]}),
        ),
        (
            "DELETE /api/v1/devices/device ",
            "200 OK",
            serde_json::json!({"revoked":true}),
        ),
    ]);
    account.api = wire;
    assert_eq!(
        account.devices(100).await.unwrap()[0].verification_code,
        expected
    );
    account.revoke_device("device", 100).await.unwrap();
    assert_eq!(account.access, Access::Denied);
    assert!(account.bundle.session.is_none());
    assert!(account.local_key_handle().is_some());
    assert!(account.pull(0, 100).await.is_err());
    done.join().unwrap();
}
