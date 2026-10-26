use super::*;
use crate::{
    profile::{ProfileKind, ProfileMeta},
    profile_files::EncryptedFiles,
};
use aura_sync::crypto::{AccountKey, files::Purpose};
use sha2::{Digest as _, Sha256};

fn profile(dir: &std::path::Path) -> Profile {
    Profile {
        meta: ProfileMeta {
            id: "profile".into(),
            kind: ProfileKind::Account,
            display_name: "Account".into(),
            created_at: 0,
        },
        dir: dir.join("profile"),
    }
}
fn assert_private(dir: &std::path::Path, secret: &[u8]) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            assert_private(&entry.path(), secret)?;
        } else {
            let bytes = std::fs::read(entry.path())?;
            assert!(
                !bytes.windows(secret.len()).any(|p| p == secret),
                "plaintext in {:?}",
                entry.path()
            );
        }
    }
    Ok(())
}

#[tokio::test]
async fn account_writer_cannot_start_through_the_plain_file_entry_point() {
    let temp = tempfile::tempdir().unwrap();
    let profile = profile(temp.path());
    std::fs::create_dir_all(&profile.dir).unwrap();
    let key = AccountKey::generate().unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", "profile").unwrap()),
    )
    .unwrap();
    assert!(matches!(
        ChatStore::start(store, owner, &profile, "device".into(), Handle::current()),
        Err(CoreError::ProfileLocked { .. })
    ));
    assert!(!profile.attachments_dir().exists());
}

#[tokio::test]
async fn account_writer_imports_pages_and_reopens_encrypted_payloads() {
    let temp = tempfile::tempdir().unwrap();
    let profile = profile(temp.path());
    let key = AccountKey::generate().unwrap();
    let database_key = Arc::new(key.database_key("account", "profile").unwrap());
    let file_key = Arc::new(key.profile_file_key("account", "profile").unwrap());
    std::fs::create_dir_all(&profile.dir).unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(&profile, database_key.clone()).unwrap();
    let chats = ChatStore::start_account(
        store,
        owner,
        &profile,
        "device".into(),
        Handle::current(),
        file_key.clone(),
    )
    .unwrap();
    chats.recovered().await;
    let chat = chats
        .create_chat(NewChat {
            agent_host: Default::default(),
            agent_id: "mock".into(),
            folder: temp.path().to_path_buf(),
            device_id: "device".into(),
            now: 1,
        })
        .await
        .unwrap();
    let mut bytes = b"synthetic-private-import".to_vec();
    bytes.extend_from_slice("😀é".repeat(40_000).as_bytes());
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let imported = chats
        .composer(composer::ComposerCommand::Import {
            chat_id: chat.id.clone(),
            name: "private.txt".into(),
            mime: "text/plain".into(),
            sha256: hash.clone(),
            bytes: Arc::from(bytes.clone()),
        })
        .await
        .unwrap();
    assert_eq!(imported[0].sha256, hash);
    let reader = chats.attachment_reader().unwrap();
    assert_eq!(
        aura_drivers::attachments::read_from(None, Some(reader.as_ref()), &hash, bytes.len())
            .unwrap(),
        bytes
    );
    assert!(!profile.attachments_dir().join(&hash).exists());
    let first = chats
        .read_blob(&hash, 0, blobs::MAX_BLOB_PAGE)
        .await
        .unwrap();
    let second = chats
        .read_blob(&hash, first.next_offset, blobs::MAX_BLOB_PAGE)
        .await
        .unwrap();
    assert_eq!([first.text, second.text].concat().as_bytes(), bytes);
    assert!(chats.shutdown(Duration::from_secs(5)).await);
    drop(chats);
    assert_private(&profile.dir, b"synthetic-private-import").unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(&profile, database_key).unwrap();
    let chats = ChatStore::start_account(
        store,
        owner,
        &profile,
        "device".into(),
        Handle::current(),
        file_key,
    )
    .unwrap();
    chats.recovered().await;
    assert_eq!(
        chats
            .composer(composer::ComposerCommand::Resolve {
                chat_id: chat.id,
                ids: vec![imported[0].meta.id.clone()]
            })
            .await
            .unwrap()[0]
            .sha256,
        hash
    );
    assert_eq!(
        chats
            .attachment_reader()
            .unwrap()
            .read(&hash, bytes.len())
            .unwrap(),
        bytes
    );
    assert!(chats.shutdown(Duration::from_secs(5)).await);
}

#[test]
fn encrypted_pages_match_local_unicode_boundaries_and_authenticate_every_returned_chunk() {
    let temp = tempfile::tempdir().unwrap();
    let key = Arc::new(
        AccountKey::generate()
            .unwrap()
            .profile_file_key("account", "profile")
            .unwrap(),
    );
    let dir = temp.path().join("encrypted");
    let files = EncryptedFiles::open(&dir, Purpose::Attachment, key.clone()).unwrap();
    let encrypted = files::Attachments::Encrypted(files);
    let local = files::Attachments::Local(temp.path().join("plain"));
    let text = format!(
        "{}😀é{}",
        "a".repeat(blobs::MAX_BLOB_PAGE as usize - 1),
        "😀x".repeat(100)
    );
    let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
    encrypted.write(&hash, text.as_bytes()).unwrap();
    local.write(&hash, text.as_bytes()).unwrap();
    for offset in [
        0,
        1,
        blobs::MAX_BLOB_PAGE as u64 - 1,
        blobs::MAX_BLOB_PAGE as u64,
        text.len() as u64,
        u64::MAX,
    ] {
        for len in [0, 1, 3, blobs::MAX_BLOB_PAGE, u32::MAX] {
            let a = encrypted.read_page(&hash, offset, len).unwrap();
            let b = local.read_page(&hash, offset, len).unwrap();
            assert_eq!(
                serde_json::to_value(a).unwrap(),
                serde_json::to_value(b).unwrap()
            );
        }
    }
    let path = dir.join(key.object_name(Purpose::Attachment, &hash).unwrap());
    let mut ciphertext = std::fs::read(&path).unwrap();
    *ciphertext.last_mut().unwrap() ^= 1;
    std::fs::write(path, ciphertext).unwrap();
    assert!(
        encrypted
            .read_page(&hash, text.len() as u64 - 5, 5)
            .is_err()
    );
}

#[tokio::test]
async fn account_poison_journal_is_encrypted_and_database_remains_usable() {
    let temp = tempfile::tempdir().unwrap();
    let profile = profile(temp.path());
    std::fs::create_dir_all(&profile.dir).unwrap();
    let key = AccountKey::generate().unwrap();
    let file_key = Arc::new(key.profile_file_key("account", "profile").unwrap());
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", "profile").unwrap()),
    )
    .unwrap();
    let chats = ChatStore::start_account(
        store,
        owner,
        &profile,
        "device".into(),
        Handle::current(),
        file_key.clone(),
    )
    .unwrap();
    chats.test_work(TestWork::Panic);
    assert!(chats.barrier().await);
    assert!(chats.shutdown(Duration::from_secs(5)).await);
    let root = profile.backups_dir().join("recovery");
    let journal = std::fs::read_dir(&root)
        .unwrap()
        .map(Result::unwrap)
        .find(|e| e.file_type().unwrap().is_dir())
        .unwrap()
        .file_name()
        .to_str()
        .unwrap()
        .to_owned();
    let files = EncryptedFiles::open(&root, Purpose::DeadLetter, file_key)
        .unwrap()
        .child(&journal, false)
        .unwrap();
    let manifest: journal::Manifest =
        serde_json::from_slice(&files.read(&format!("{journal}-manifest"), 1024).unwrap()).unwrap();
    assert_eq!(manifest.parts, 1);
    let text = files.read(&format!("{journal}-0"), 1024).unwrap();
    assert!(String::from_utf8(text).unwrap().contains("test_panic"));
    assert_private(&profile.dir, b"test_panic").unwrap();
    assert!(
        !std::fs::read_dir(profile.backups_dir()).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|x| x == "jsonl"))
    );
}
