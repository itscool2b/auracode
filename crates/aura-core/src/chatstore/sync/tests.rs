use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
    sync::{SyncIdentity, SyncLedger},
};
use aura_sync::{
    crypto::AccountKey,
    merge::{DecodedMetadata, FieldValue},
};

#[tokio::test]
async fn every_acknowledged_account_metadata_edit_has_a_durable_sealed_head() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path().join("data")))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let db_key = Arc::new(key.database_key("account", &profile.meta.id).unwrap());
    let file_key = Arc::new(key.profile_file_key("account", &profile.meta.id).unwrap());
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(&profile, db_key.clone()).unwrap();
    let chats = ChatStore::start_account(
        store,
        owner,
        &profile,
        "local-device".into(),
        Handle::current(),
        file_key,
    )
    .unwrap();
    let context = SyncContext {
        identity: SyncIdentity {
            account: "account".into(),
            device: "bound-device".into(),
            key_version: 1,
        },
        key: key.clone(),
    };
    chats.configure_sync(context.clone()).await.unwrap();
    let port = chats.config_sync_port();
    let config_id = "a".repeat(64);
    let config_head = port
        .publish_snapshot(
            &config_id,
            None,
            Zeroizing::new(b"native config port".to_vec()),
            ConfigSnapshotMetadata {
                schema: 1,
                scope: ConfigScope::Portable,
                deleted: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        port.read_head(&config_id).await.unwrap(),
        Some(config_head.clone())
    );
    assert_eq!(
        &*port.read_snapshot(&config_id, &config_head).await.unwrap(),
        b"native config port"
    );
    let chat = chats
        .create_chat(NewChat {
            agent_id: "mock".into(),
            agent_host: Default::default(),
            folder: temp.path().join("private-workspace"),
            device_id: "local-device".into(),
            now: 1,
        })
        .await
        .unwrap();
    chats
        .organize(organization::OrganizationCommand::RenameChat {
            id: chat.id.clone(),
            title: "Saved title".into(),
        })
        .await
        .unwrap();
    let activity_at = crate::time::now_millis() + 10_000;
    chats.reserve(256).await.unwrap().send(Op::TouchChat {
        chat_id: chat.id.clone(),
        at: activity_at,
    });
    chats.flush(Duration::from_secs(5)).await.unwrap();
    assert!(chats.shutdown(Duration::from_secs(5)).await);
    assert!(matches!(
        port.read_head(&config_id).await,
        Err(ConfigPortError::Unavailable)
    ));
    drop(chats);
    let (mut store, _) = Store::open_encrypted(&profile, db_key).unwrap();
    let outgoing = SyncLedger::new(&mut store, context.identity.clone(), &key)
        .unwrap()
        .outgoing()
        .unwrap();
    assert_eq!(
        outgoing.len(),
        3,
        "project, portable folder identity and chat"
    );
    for record in outgoing {
        let plain = aura_sync::crypto::open_record(
            &key,
            &aura_sync::crypto::RecordContext {
                account: "account",
                collection: &record.collection,
                id: &record.id,
                key_version: 1,
                hlc: &record.hlc,
                deleted: record.deleted,
            },
            &aura_sync::crypto::SealedPayload {
                nonce: record.nonce,
                ciphertext: record.ciphertext,
            },
        )
        .unwrap();
        let text = std::str::from_utf8(&plain).unwrap();
        assert!(!text.contains(&temp.path().to_string_lossy().replace('\\', "\\\\")));
        if record.collection == "chats" {
            let DecodedMetadata::Known(metadata) =
                aura_sync::merge::decode_metadata(&plain).unwrap()
            else {
                panic!("metadata")
            };
            assert!(metadata.fields["title"].value == FieldValue::Present("Saved title".into()));
            assert!(metadata.fields["updated_at"].value == FieldValue::Present(activity_at.into()));
        }
    }
}

#[tokio::test]
async fn local_writer_refuses_account_sync_without_changing_its_dataset() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .open_active()
        .unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open(&profile).unwrap();
    let chats = ChatStore::start(
        store,
        owner,
        &profile,
        "local-device".into(),
        Handle::current(),
    )
    .unwrap();
    assert!(
        chats
            .configure_sync(SyncContext {
                identity: SyncIdentity {
                    account: "account".into(),
                    device: "bound-device".into(),
                    key_version: 1
                },
                key: Arc::new(AccountKey::generate().unwrap())
            })
            .await
            .is_err()
    );
    chats
        .create_chat(NewChat {
            agent_id: "mock".into(),
            agent_host: Default::default(),
            folder: temp.path().into(),
            device_id: "local-device".into(),
            now: 1,
        })
        .await
        .unwrap();
    assert!(chats.shutdown(Duration::from_secs(5)).await);
}
