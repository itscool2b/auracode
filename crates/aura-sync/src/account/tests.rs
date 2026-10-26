use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

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
