use super::*;
use crate::{
    chatstore::{NewChat, files::Attachments},
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use aura_sync::wire::Blob;
use sha2::{Digest, Sha256};
use std::sync::Arc;

fn fixture(
    key: Arc<AccountKey>,
    device: &str,
) -> (tempfile::TempDir, Store, SyncContext, Attachments) {
    let dir = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(dir.path()))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let (mut store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let files = Attachments::Encrypted(
        crate::profile_files::EncryptedFiles::open(
            &profile.attachments_dir(),
            crypto::files::Purpose::Attachment,
            Arc::new(key.profile_file_key("account", &profile.meta.id).unwrap()),
        )
        .unwrap(),
    );
    let context = SyncContext {
        identity: SyncIdentity {
            account: "account".into(),
            device: device.into(),
            key_version: 1,
        },
        key,
    };
    context.initialize(&mut store).unwrap();
    (dir, store, context, files)
}
fn seed(store: &Store, files: &Attachments) -> (String, String, String) {
    let chat = crate::chatstore::rows::create_chat(
        store.conn(),
        &NewChat {
            folder: "/private/source/project".into(),
            agent_id: "codex".into(),
            agent_host: aura_protocol::agents::AgentHost::Native,
            device_id: "source".into(),
            now: 1,
        },
    )
    .unwrap();
    let turn = crate::ids::new_id();
    let blob = vec![0x90; 1024 * 1024];
    let hash = format!("{:x}", Sha256::digest(&blob));
    files.write(&hash, &blob).unwrap();
    store
        .conn()
        .execute(
            "INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,'image/png',?2,1)",
            params![hash, blob.len() as i64],
        )
        .unwrap();
    let parts = serde_json::to_string(&vec![
        PromptPart::Text {
            text: "visible user prompt".into(),
        },
        PromptPart::Image {
            blob: hash.clone(),
            mime: "image/png".into(),
        },
    ])
    .unwrap();
    store.conn().execute("INSERT INTO turns(id,chat_id,seq,status,started_at,ended_at,device_id,prompt_parts_json,compacted_at) VALUES(?1,?2,1,'completed',1,2,'source',?3,3)",params![turn,chat.id,parts]).unwrap();
    for (seq, event) in [
        AuraEvent::TurnStarted {
            turn_id: turn.clone(),
            prompt_id: Some("prompt".into()),
        },
        AuraEvent::MessageDelta {
            message_id: "message".into(),
            text: "m".repeat(1024 * 1024),
        },
        AuraEvent::MessageDelta {
            message_id: "message".into(),
            text: "n".repeat(1024 * 1024),
        },
        AuraEvent::TurnEnded {
            turn_id: turn.clone(),
            stop_reason: aura_protocol::StopReason::EndTurn,
            usage: None,
            duration_ms: None,
            recovered: false,
        },
    ]
    .into_iter()
    .enumerate()
    {
        store.conn().execute("INSERT INTO events(id,chat_id,turn_id,seq,kind,payload,created_at,device_id) VALUES(?1,?2,?3,?4,?5,?6,2,'source')",params![crate::ids::new_id(),chat.id,turn,seq as i64,event.kind(),serde_json::to_string(&event).unwrap()]).unwrap();
    }
    store.conn().execute("INSERT INTO events(id,chat_id,turn_id,seq,kind,payload,created_at,device_id) VALUES(?1,?2,?3,4,'future_event',?4,2,'source')",params![crate::ids::new_id(),chat.id,turn,"{ \"type\": \"future_event\", \"opaque\": [3,2,1] }"]).unwrap();
    store.conn().execute("INSERT INTO steering_inputs(message_id,chat_id,turn_id,seq,parts_json,state,created_at,updated_at) VALUES('steer',?1,?2,1,?3,'accepted',1,2)",params![chat.id,turn,parts]).unwrap();
    (chat.id, turn, hash)
}
fn pending(store: &mut Store, context: &SyncContext, files: &Attachments) -> exchange::Pending {
    let exchange::Reply::Pending(work) =
        exchange::execute_with_files(store, context, exchange::Command::Pending, Some(files))
            .unwrap()
    else {
        panic!("pending")
    };
    work
}
fn capture(store: &mut Store, context: &SyncContext, files: &Attachments, turn: &str) -> Head {
    for _ in 0..20 {
        let work = pending(store, context, files);
        assert!(
            !work
                .records
                .iter()
                .any(|record| record.collection == "chat_chunks")
        );
        if store
            .conn()
            .query_row(
                "SELECT state='ready' FROM sync_turns WHERE turn_id=?1",
                [turn],
                |r| r.get::<_, bool>(0),
            )
            .unwrap()
        {
            return decode(
                context,
                &head(store.conn(), "chat_chunks", turn).unwrap().unwrap(),
            )
            .unwrap();
        }
    }
    panic!("capture did not finish");
}

#[test]
fn capture_is_bounded_restartable_and_preserves_unknown_events_images_and_steering() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_dir, mut store, context, files) = fixture(key, "source");
    let (chat, turn, hash) = seed(&store, &files);
    pending(&mut store, &context, &files);
    let first_count: i64 = store
        .conn()
        .query_row(
            "SELECT count(*) FROM sync_turn_parts WHERE turn_id=?1",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(first_count, 1);
    // Reinitialization represents an ordinary reopened writer. It does not restart captured pieces.
    context.initialize(&mut store).unwrap();
    let header = capture(&mut store, &context, &files, &turn);
    assert_eq!(header.chat_id, chat);
    assert!(header.parts >= 2);
    let records:Vec<(u32,String,String,String)>=store.conn().prepare("SELECT p.part_index,p.blob_id,b.nonce,b.ciphertext FROM sync_turn_parts p JOIN sync_blobs b ON b.id=p.blob_id WHERE p.turn_id=?1 ORDER BY p.part_index").unwrap().query_map([&turn],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    let mut images = Vec::new();
    let mut unknown = None;
    let mut steering = 0;
    let mut previous = None;
    for (index, id, nonce, ciphertext) in records {
        let bytes = crypto::open_blob(
            &context.key,
            "account",
            &id,
            1,
            &SealedPayload { nonce, ciphertext },
        )
        .unwrap();
        assert!(bytes.len() <= PIECE_BYTES);
        let piece = piece(&bytes, &turn, index).unwrap();
        assert_eq!(piece.previous, previous);
        previous = Some(id);
        for entry in piece.entries {
            match entry {
                Entry::File(file) => {
                    assert_eq!(file.hash, hash);
                    assert_eq!(file.offset, images.len() as u64);
                    images.extend_from_slice(&crypto::decode(&file.bytes, 192 * 1024).unwrap());
                }
                Entry::Steering(value) => {
                    assert_eq!(value.state, "accepted");
                    assert_eq!(value.parts.len(), 2);
                    steering += 1;
                }
                Entry::Event(value) if value.kind == "future_event" => {
                    unknown = Some(value.payload)
                }
                Entry::Turn(value) => assert_eq!(value.agent, "codex"),
                _ => {}
            }
        }
    }
    assert_eq!(images, vec![0x90; 1024 * 1024]);
    assert_eq!(steering, 1);
    assert_eq!(
        unknown.as_deref(),
        Some("{ \"type\": \"future_event\", \"opaque\": [3,2,1] }")
    );
    assert_eq!(previous.as_deref(), Some(header.tail.as_str()));
    let encoded = serde_json::to_string(&header).unwrap();
    assert!(!encoded.contains("source/project"));
    assert!(!encoded.contains("native_session"));
}

#[test]
fn head_waits_for_all_uploads_and_remote_chain_rejects_rewrite_and_substitution() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_dir, mut source, context, files) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context, _) = fixture(key, "target");
    let (_, turn, _) = seed(&source, &files);
    let header = capture(&mut source, &context, &files, &turn);
    let mut blobs = std::collections::HashMap::new();
    while let Some(upload) = pending(&mut source, &context, &files).upload {
        let blob = Blob {
            key_version: 1,
            nonce: upload.sealed.nonce.clone(),
            ciphertext: upload.sealed.ciphertext.clone(),
            etag: "A".repeat(43),
            size_bytes: crypto::decode(&upload.sealed.ciphertext, 4 * 1024 * 1024)
                .unwrap()
                .len() as u64,
        };
        blobs.insert(upload.id.clone(), blob);
        exchange::execute(
            &mut source,
            &context,
            exchange::Command::Uploaded {
                sent: upload,
                etag: "A".repeat(43),
            },
        )
        .unwrap();
    }
    let record = pending(&mut source, &context, &files)
        .records
        .into_iter()
        .find(|record| record.collection == "chat_chunks")
        .unwrap();
    let change = Change {
        record: record.clone(),
        server_seq: 1,
        device_id: "source".into(),
    };
    exchange::execute(
        &mut target,
        &target_context,
        exchange::Command::Pull(Pull {
            records: vec![change],
            next_cursor: 1,
            has_more: false,
        }),
    )
    .unwrap();
    for _ in 0..header.parts {
        let exchange::Reply::Pending(work) =
            exchange::execute(&mut target, &target_context, exchange::Command::Pending).unwrap()
        else {
            panic!("pending")
        };
        let request = work.downloads.into_iter().next().unwrap();
        let mut wrong = blobs.get(&request.id).unwrap().clone();
        wrong.nonce = "A".repeat(32);
        assert!(
            exchange::execute(
                &mut target,
                &target_context,
                exchange::Command::Downloaded {
                    request: request.clone(),
                    blob: wrong
                }
            )
            .is_err()
        );
        let blob = blobs.get(&request.id).unwrap().clone();
        exchange::execute(
            &mut target,
            &target_context,
            exchange::Command::Downloaded { request, blob },
        )
        .unwrap();
    }
    let state: String = target
        .conn()
        .query_row(
            "SELECT state FROM sync_turns WHERE turn_id=?1",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(state, "staged");
    // A later authenticated revision from the same account still cannot rewrite an immutable turn.
    let mut different = header;
    different.tail = crate::ids::new_id();
    let mut record = record;
    let sealed = crypto::seal_record(
        &context.key,
        &super::super::context(&context.identity, &record),
        &serde_json::to_vec(&different).unwrap(),
    )
    .unwrap();
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    assert!(
        exchange::execute(
            &mut target,
            &target_context,
            exchange::Command::Pull(Pull {
                records: vec![Change {
                    record,
                    server_seq: 2,
                    device_id: "source".into()
                }],
                next_cursor: 2,
                has_more: false
            })
        )
        .is_err()
    );
    assert_eq!(cursor(target.conn()).unwrap(), 1);
}

#[test]
fn escaped_compacted_rows_fragment_across_transactions_without_losing_bytes() {
    let (_dir, mut store, context, files) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "source");
    let (_, turn, _) = seed(&store, &files);
    let event = AuraEvent::MessageDelta {
        message_id: "escaped".into(),
        text: "\0".repeat(600_000),
    };
    let json = serde_json::to_string(&event).unwrap();
    store
        .conn()
        .execute(
            "UPDATE events SET payload=?2 WHERE turn_id=?1 AND seq=1",
            params![turn, json],
        )
        .unwrap();
    let head = capture(&mut store, &context, &files, &turn);
    assert!(head.parts > 2);
    let mut assembled = Vec::new();
    let mut completed = 0;
    for index in 0..head.parts {
        let (id,nonce,ciphertext):(String,String,String)=store.conn().query_row("SELECT b.id,b.nonce,b.ciphertext FROM sync_turn_parts p JOIN sync_blobs b ON b.id=p.blob_id WHERE p.turn_id=?1 AND p.part_index=?2",params![turn,index],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        let plain = crypto::open_blob(
            &context.key,
            "account",
            &id,
            1,
            &SealedPayload { nonce, ciphertext },
        )
        .unwrap();
        for entry in piece(&plain, &turn, index).unwrap().entries {
            if let Entry::Fragment {
                offset,
                total,
                bytes,
            } = entry
            {
                assert_eq!(offset as usize, assembled.len());
                assembled.extend_from_slice(&crypto::decode(&bytes, 192 * 1024).unwrap());
                if assembled.len() == total as usize {
                    let Entry::Event(event) = serde_json::from_slice(&assembled).unwrap() else {
                        panic!("event")
                    };
                    assert_eq!(event.payload, json);
                    completed += 1;
                    assembled.clear();
                }
            } else {
                assert!(assembled.is_empty());
            }
        }
    }
    assert_eq!(completed, 1);
    assert!(assembled.is_empty());
    let fragments: i64 = store
        .conn()
        .query_row("SELECT count(*) FROM sync_turn_fragments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fragments, 0);
}

#[test]
fn capture_waits_for_pending_steering_instead_of_freezing_an_unconfirmed_outcome() {
    let (_dir, mut store, context, files) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "source");
    let (_, turn, _) = seed(&store, &files);
    store
        .conn()
        .execute(
            "UPDATE steering_inputs SET state='pending' WHERE turn_id=?1",
            [&turn],
        )
        .unwrap();
    let work = pending(&mut store, &context, &files);
    assert!(!work.local_work);
    assert!(work.upload.is_none());
    assert!(head(store.conn(), "chat_chunks", &turn).unwrap().is_none());
    store
        .conn()
        .execute(
            "UPDATE steering_inputs SET state='accepted' WHERE turn_id=?1",
            [&turn],
        )
        .unwrap();
    capture(&mut store, &context, &files, &turn);
    assert!(head(store.conn(), "chat_chunks", &turn).unwrap().is_some());
}
