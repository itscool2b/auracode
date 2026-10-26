use super::*;
use crate::{
    owner::ProfileOwner,
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
    store::Store,
    sync::SyncContext,
};
use aura_sync::{
    crypto::{self, AccountKey},
    wire::{Change, Pull},
};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

async fn fixture(
    key: Arc<AccountKey>,
    device: &str,
) -> (tempfile::TempDir, Arc<ChatStore>, SyncIdentity) {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let files = Arc::new(key.profile_file_key("account", &profile.meta.id).unwrap());
    let chats = ChatStore::start_account(
        store,
        owner,
        &profile,
        "local-device".into(),
        tokio::runtime::Handle::current(),
        files,
    )
    .unwrap();
    let identity = SyncIdentity {
        account: "account".into(),
        device: device.into(),
        key_version: 1,
    };
    chats
        .configure_sync(SyncContext {
            identity: identity.clone(),
            key,
        })
        .await
        .unwrap();
    (temp, chats, identity)
}
#[derive(Default)]
struct Server {
    changes: Vec<Change>,
    blobs: HashMap<String, Blob>,
}
#[derive(Default)]
struct FakeNetwork {
    server: Mutex<Server>,
    connects: AtomicUsize,
    fail: AtomicUsize,
    blocked: Notify,
    block: bool,
    denied: bool,
    invite_required: bool,
}
impl Network for FakeNetwork {
    fn request<'a>(
        &'a self,
        identity: &'a SyncIdentity,
        request: NetworkRequest,
    ) -> NetworkFuture<'a> {
        Box::pin(async move {
            if matches!(request, NetworkRequest::Connect) {
                self.connects.fetch_add(1, Ordering::SeqCst);
                if self.block {
                    self.blocked.notified().await;
                }
                if self.denied {
                    return Err(failure(
                        AccountFailureCode::Forbidden,
                        "This synthetic device was revoked.",
                    ));
                }
                if self.invite_required {
                    return Err(failure(
                        AccountFailureCode::InviteRequired,
                        "Cloud access requires an invitation. Local data is retained.",
                    ));
                }
                if self
                    .fail
                    .try_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                        left.checked_sub(1)
                    })
                    .is_ok()
                {
                    return Err(failure(
                        AccountFailureCode::Offline,
                        "The synthetic network is offline.",
                    ));
                }
            }
            let mut server = self.server.lock().unwrap();
            Ok(match request {
                NetworkRequest::Connect => NetworkReply::Connected,
                NetworkRequest::Pull(after) => {
                    let changes = server
                        .changes
                        .iter()
                        .filter(|change| change.server_seq > after)
                        .take(32)
                        .cloned()
                        .collect::<Vec<_>>();
                    let next_cursor = changes.last().map_or(after, |change| change.server_seq);
                    NetworkReply::Pull(Pull {
                        records: changes,
                        next_cursor,
                        has_more: false,
                    })
                }
                NetworkRequest::Push(records) => {
                    let mut heads = Vec::new();
                    for record in records {
                        let change = Change {
                            server_seq: server.changes.len() as u64 + 1,
                            device_id: identity.device.clone(),
                            record,
                        };
                        server.changes.push(change.clone());
                        heads.push(change);
                    }
                    NetworkReply::Heads(Heads { heads })
                }
                NetworkRequest::Upload(upload) => {
                    server.blobs.insert(
                        upload.id,
                        Blob {
                            etag: "A".repeat(43),
                            nonce: upload.sealed.nonce,
                            key_version: upload.key_version,
                            size_bytes: crypto::decode(&upload.sealed.ciphertext, 4 * 1024 * 1024)
                                .unwrap()
                                .len() as u64,
                            ciphertext: upload.sealed.ciphertext,
                        },
                    );
                    NetworkReply::Uploaded("A".repeat(43))
                }
                NetworkRequest::Download(id) => {
                    NetworkReply::Blob(server.blobs.get(&id).unwrap().clone())
                }
            })
        })
    }
}
async fn called(network: &FakeNetwork, count: usize) {
    for _ in 0..1000 {
        if network.connects.load(Ordering::SeqCst) >= count {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!(
        "worker did not make request {count}; observed {}",
        network.connects.load(Ordering::SeqCst)
    );
}

#[tokio::test]
async fn two_keyed_profiles_exchange_config_through_the_owned_writer_without_plaintext_network_data()
 {
    use aura_config::sync::{ConfigScope, ConfigSnapshotMetadata};
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_a, source, source_identity) = fixture(key.clone(), "source").await;
    let (_b, target, target_identity) = fixture(key, "target").await;
    let network = FakeNetwork::default();
    let id = "a".repeat(64);
    let source_port = source.config_sync_port();
    let head = source_port
        .publish_snapshot(
            &id,
            None,
            b"private portable configuration".to_vec().into(),
            ConfigSnapshotMetadata {
                schema: 1,
                scope: ConfigScope::Portable,
                deleted: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        cycle(&source, &network, &source_identity).await.unwrap(),
        (0, false)
    );
    assert_eq!(
        cycle(&target, &network, &target_identity).await.unwrap(),
        (0, false)
    );
    let port = target.config_sync_port();
    assert_eq!(port.read_head(&id).await.unwrap(), Some(head.clone()));
    assert_eq!(
        &*port.read_snapshot(&id, &head).await.unwrap(),
        b"private portable configuration"
    );
    {
        let server = network.server.lock().unwrap();
        let record = serde_json::to_string(&server.changes[0].record).unwrap();
        assert!(!record.contains("private portable"));
        assert!(!record.contains(&id));
        assert_eq!(server.blobs.len(), 1);
    }
    assert!(source.shutdown(Duration::from_secs(5)).await);
    assert!(target.shutdown(Duration::from_secs(5)).await);
}

#[tokio::test]
async fn focus_triggers_coalesce_and_cannot_bypass_offline_backoff_or_restart_a_stopped_engine() {
    let (_dir, store, identity) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "device").await;
    tokio::time::pause();
    let network = Arc::new(FakeNetwork {
        fail: AtomicUsize::new(10),
        ..Default::default()
    });
    let engine = SyncEngine::start(
        store.clone(),
        network.clone(),
        identity,
        &tokio::runtime::Handle::current(),
    );
    called(&network, 1).await;
    for _ in 0..100 {
        engine.trigger();
    }
    tokio::task::yield_now().await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 1);
    assert_eq!(engine.status().state, AccountSyncState::Offline);
    tokio::time::advance(Duration::from_secs(9)).await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 1);
    // Tokio's timer wheel rounds its deadline to milliseconds.
    tokio::time::advance(Duration::from_millis(1001)).await;
    called(&network, 2).await;
    assert!(engine.close(Duration::from_secs(1)).await);
    engine.trigger();
    tokio::time::advance(Duration::from_secs(600)).await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 2);
    assert_eq!(engine.status().state, AccountSyncState::Inactive);
    tokio::time::resume();
    assert!(store.shutdown(Duration::from_secs(5)).await);
}

#[tokio::test]
async fn stop_cancels_only_the_owned_inflight_network_future() {
    let (_dir, store, identity) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "device").await;
    let network = Arc::new(FakeNetwork {
        block: true,
        ..Default::default()
    });
    let engine = SyncEngine::start(
        store.clone(),
        network.clone(),
        identity,
        &tokio::runtime::Handle::current(),
    );
    called(&network, 1).await;
    assert!(engine.suspend(Duration::from_secs(1)).await);
    assert_eq!(engine.status().state, AccountSyncState::Paused);
    engine.trigger();
    tokio::task::yield_now().await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 1);
    engine.resume();
    called(&network, 2).await;
    assert!(engine.close(Duration::from_secs(1)).await);
    assert_eq!(engine.status().state, AccountSyncState::Inactive);
    assert!(store.flush(Duration::from_secs(5)).await.is_ok());
    assert!(store.shutdown(Duration::from_secs(5)).await);
}

#[tokio::test]
async fn revocation_stops_automatic_requests_until_explicit_resume() {
    let (_dir, store, identity) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "device").await;
    tokio::time::pause();
    let network = Arc::new(FakeNetwork {
        denied: true,
        ..Default::default()
    });
    let engine = SyncEngine::start(
        store.clone(),
        network.clone(),
        identity,
        &tokio::runtime::Handle::current(),
    );
    called(&network, 1).await;
    assert_eq!(engine.status().state, AccountSyncState::Paused);
    engine.trigger();
    tokio::time::advance(Duration::from_secs(600)).await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 1);
    engine.resume();
    called(&network, 2).await;
    assert!(engine.close(Duration::from_secs(1)).await);
    tokio::time::resume();
    assert!(store.shutdown(Duration::from_secs(5)).await);
}

#[tokio::test]
async fn invitation_removal_pauses_automatic_requests_until_explicit_resume() {
    let (_dir, store, identity) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "device").await;
    tokio::time::pause();
    let network = Arc::new(FakeNetwork {
        invite_required: true,
        ..Default::default()
    });
    let engine = SyncEngine::start(
        store.clone(),
        network.clone(),
        identity,
        &tokio::runtime::Handle::current(),
    );
    called(&network, 1).await;
    assert_eq!(engine.status().state, AccountSyncState::Paused);
    assert!(engine.status().message.unwrap().contains("invitation"));
    engine.trigger();
    tokio::time::advance(Duration::from_secs(600)).await;
    assert_eq!(network.connects.load(Ordering::SeqCst), 1);
    engine.resume();
    called(&network, 2).await;
    assert!(engine.close(Duration::from_secs(1)).await);
    tokio::time::resume();
    assert!(store.shutdown(Duration::from_secs(5)).await);
}
