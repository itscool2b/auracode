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
    let (_target_dir, mut target, target_context, target_files) = fixture(key, "target");
    let (chat, turn, _) = seed(&source, &files);
    let owned_bytes = b"owned agent image bytes";
    let foreign_bytes = b"another chat's private image bytes";
    let owned = format!("{:x}", Sha256::digest(owned_bytes));
    let foreign = format!("{:x}", Sha256::digest(foreign_bytes));
    let other = crate::chatstore::rows::create_chat(
        source.conn(),
        &NewChat {
            folder: "/private/other/project".into(),
            agent_id: "codex".into(),
            agent_host: aura_protocol::agents::AgentHost::Native,
            device_id: "source".into(),
            now: 1,
        },
    )
    .unwrap();
    for (owner, hash, bytes) in [
        (&chat, &owned, owned_bytes.as_slice()),
        (&other.id, &foreign, foreign_bytes.as_slice()),
    ] {
        files.write(hash, bytes).unwrap();
        source
            .conn()
            .execute(
                "INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,'image/png',?2,1)",
                params![hash, bytes.len()],
            )
            .unwrap();
        source.conn().execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES(?1,?2,?3,'Agent image','image/png',?4,1)",params![crate::ids::new_id(),owner,hash,bytes.len()]).unwrap();
    }
    let event = AuraEvent::MessageDelta {
        message_id: "message".into(),
        text: format!(
            "![Agent image](<aura-image:{owned}>)\n![Guessed image](<aura-image:{foreign}>)"
        ),
    };
    source
        .conn()
        .execute(
            "UPDATE events SET payload=?2 WHERE turn_id=?1 AND seq=1",
            params![turn, serde_json::to_string(&event).unwrap()],
        )
        .unwrap();
    let header = capture(&mut source, &context, &files, &turn);
    let leaked: bool = source
        .conn()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_turn_files WHERE turn_id=?1 AND hash=?2)",
            params![turn, foreign],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!leaked, "an inline URI cannot export another chat's image");
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
    let missing = exchange::execute_with_files(
        &mut target,
        &target_context,
        exchange::Command::Import {
            chat_id: header.chat_id.clone(),
            minimum_seq: 0,
        },
        Some(&target_files),
    )
    .unwrap();
    assert!(matches!(missing, exchange::Reply::Imported(None)));
    let (project, folder): (String, String) = source
        .conn()
        .query_row(
            "SELECT project_id,folder_id FROM chats WHERE id=?1",
            [&header.chat_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    target.conn().execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES(?1,'Remote project',1,1,'source')",[&project]).unwrap();
    target.conn().execute("INSERT INTO project_folders(id,project_id,display_name,kind,created_at,updated_at,device_id) VALUES(?1,?2,'Remote folder','local',1,1,'source')",params![folder,project]).unwrap();
    target.conn().execute("INSERT INTO chats(id,project_id,folder_id,active_agent,created_at,updated_at,device_id) VALUES(?1,?2,?3,'codex',1,1,'source')",params![header.chat_id,project,folder]).unwrap();
    let exchange::Reply::Imported(Some(imported)) = exchange::execute_with_files(
        &mut target,
        &target_context,
        exchange::Command::Import {
            chat_id: header.chat_id.clone(),
            minimum_seq: 90,
        },
        Some(&target_files),
    )
    .unwrap() else {
        panic!("import")
    };
    assert!(imported.next_seq > 90);
    let load = crate::chatstore::rows::load_chat(target.conn(), "target", &header.chat_id, 0)
        .unwrap()
        .unwrap();
    assert!(load.remote_history);
    assert!(load.chat.folder.as_os_str().is_empty());
    assert!(load.agent_session.is_none());
    let unknown: String = target
        .conn()
        .query_row(
            "SELECT payload FROM events WHERE turn_id=?1 AND kind='future_event'",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        unknown,
        "{ \"type\": \"future_event\", \"opaque\": [3,2,1] }"
    );
    let hash = format!("{:x}", Sha256::digest(vec![0x90; 1024 * 1024]));
    let (size, bytes) = target_files.sync_range(&hash, 0).unwrap();
    assert_eq!(size, 1024 * 1024);
    assert!(bytes.iter().all(|byte| *byte == 0x90));
    let (_, image) = target_files.sync_range(&owned, 0).unwrap();
    assert_eq!(image.as_slice(), owned_bytes);
    let names: Vec<String> = target
        .conn()
        .prepare("SELECT sha256 FROM composer_attachments WHERE chat_id=?1 ORDER BY sha256")
        .unwrap()
        .query_map([&chat], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        names,
        vec![owned],
        "import grants only the transferred owned image"
    );
    assert!(target_files.sync_range(&foreign, 0).is_err());
    let accepted: String = target
        .conn()
        .query_row(
            "SELECT state FROM steering_inputs WHERE turn_id=?1",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(accepted, "accepted");
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

pub(crate) fn staged_turn(
    conn: &Connection,
    context: &SyncContext,
    chat_id: &str,
    parent: Option<String>,
) -> String {
    let id = crate::ids::new_id();
    let blob_id = crate::ids::new_id();
    let metadata = Turn {
        chat_id: chat_id.into(),
        turn_id: id.clone(),
        parent_turn_id: parent.clone(),
        agent: "mock".into(),
        status: "completed".into(),
        stop_reason: Some("end_turn".into()),
        started_at: 1,
        ended_at: 2,
        prompt_id: None,
        parts: vec![PromptPart::Text {
            text: "remote prompt".into(),
        }],
        continuation_prefix: None,
    };
    let mut entries = vec![Entry::Turn(metadata)];
    for (seq, event) in [
        AuraEvent::TurnStarted {
            turn_id: id.clone(),
            prompt_id: None,
        },
        AuraEvent::UserMessageDelta {
            message_id: format!("{id}.user"),
            text: "remote prompt".into(),
        },
        AuraEvent::MessageDelta {
            message_id: format!("{id}.assistant"),
            text: "remote reply".into(),
        },
        AuraEvent::MessageCompleted {
            message_id: format!("{id}.assistant"),
        },
        AuraEvent::TurnEnded {
            turn_id: id.clone(),
            stop_reason: aura_protocol::StopReason::EndTurn,
            usage: None,
            duration_ms: None,
            recovered: false,
        },
    ]
    .into_iter()
    .enumerate()
    {
        entries.push(Entry::Event(Event {
            seq: seq as u32,
            kind: event.kind().into(),
            payload: serde_json::to_string(&event).unwrap(),
            created_at: 2,
        }));
    }
    let piece = Piece {
        schema_version: 1,
        turn_id: id.clone(),
        index: 0,
        previous: None,
        entries,
    };
    let sealed = crypto::seal_blob(
        &context.key,
        &context.identity.account,
        &blob_id,
        context.identity.key_version,
        &serde_json::to_vec(&piece).unwrap(),
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sync_blobs(id,key_version,nonce,ciphertext,uploaded) VALUES(?1,?2,?3,?4,1)",
        params![
            blob_id,
            context.identity.key_version,
            sealed.nonce,
            sealed.ciphertext
        ],
    )
    .unwrap();
    let head = Head {
        schema_version: 1,
        chat_id: chat_id.into(),
        turn_id: id.clone(),
        parent_turn_id: parent,
        tail: blob_id.clone(),
        parts: 1,
    };
    let clock = Clock::new("remote-device")
        .unwrap()
        .tick(crate::time::now_millis() as u64)
        .unwrap();
    let mut record = EncryptedRecord {
        collection: "chat_chunks".into(),
        id: id.clone(),
        hlc: clock.to_string(),
        deleted: false,
        nonce: String::new(),
        ciphertext: String::new(),
        key_version: context.identity.key_version,
    };
    let sealed = crypto::seal_record(
        &context.key,
        &super::super::context(&context.identity, &record),
        &serde_json::to_vec(&head).unwrap(),
    )
    .unwrap();
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    save_head(conn, &record).unwrap();
    conn.execute("INSERT INTO sync_turns(turn_id,chat_id,state,tail_blob,part_count) VALUES(?1,?2,'staged',?3,1)",params![id,chat_id,blob_id]).unwrap();
    conn.execute(
        "INSERT INTO sync_turn_parts(turn_id,part_index,blob_id) VALUES(?1,0,?2)",
        params![id, blob_id],
    )
    .unwrap();
    id
}

fn empty_chat(store: &Store) -> String {
    crate::chatstore::rows::create_chat(
        store.conn(),
        &NewChat {
            folder: std::path::PathBuf::from(format!("/private/{}", crate::ids::new_id())),
            agent_id: "mock".into(),
            agent_host: aura_protocol::agents::AgentHost::Native,
            device_id: "target".into(),
            now: 1,
        },
    )
    .unwrap()
    .id
}

fn import_turn(
    store: &mut Store,
    context: &SyncContext,
    files: &Attachments,
    chat: &str,
    floor: u32,
) -> Option<Imported> {
    let exchange::Reply::Imported(imported) = exchange::execute_with_files(
        store,
        context,
        exchange::Command::Import {
            chat_id: chat.into(),
            minimum_seq: floor,
        },
        Some(files),
    )
    .unwrap() else {
        panic!("import");
    };
    imported
}

#[test]
fn import_waits_for_ancestors_and_marks_offline_siblings_without_replacing_history() {
    let (_dir, mut store, context, files) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "target");
    let chat = empty_chat(&store);
    let parent = staged_turn(store.conn(), &context, &chat, None);
    let child = staged_turn(store.conn(), &context, &chat, Some(parent.clone()));
    store
        .conn()
        .execute(
            "UPDATE sync_turns SET state='remote' WHERE turn_id=?1",
            [&parent],
        )
        .unwrap();
    assert!(import_turn(&mut store, &context, &files, &chat, 20).is_none());
    let count: u32 = store
        .conn()
        .query_row(
            "SELECT count(*) FROM turns WHERE chat_id=?1",
            [&chat],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    store
        .conn()
        .execute(
            "UPDATE sync_turns SET state='staged' WHERE turn_id=?1",
            [&parent],
        )
        .unwrap();
    let first = import_turn(&mut store, &context, &files, &chat, 20).unwrap();
    assert_eq!(first.turn_id, parent);
    let second = import_turn(&mut store, &context, &files, &chat, first.next_seq).unwrap();
    assert_eq!(second.turn_id, child);
    let sibling = staged_turn(store.conn(), &context, &chat, Some(parent.clone()));
    let third = import_turn(&mut store, &context, &files, &chat, second.next_seq).unwrap();
    assert_eq!(third.turn_id, sibling);
    assert!(third.next_seq > second.next_seq && second.next_seq > first.next_seq);
    let parents: Vec<(String, Option<String>)> = store
        .conn()
        .prepare("SELECT id,parent_turn_id FROM turns WHERE chat_id=?1 ORDER BY seq")
        .unwrap()
        .query_map([&chat], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        parents,
        vec![
            (parent.clone(), None),
            (child, Some(parent.clone())),
            (sibling, Some(parent))
        ]
    );
    let notices: Vec<String> = store
        .conn()
        .prepare("SELECT payload FROM events WHERE chat_id=?1 AND kind='notice'")
        .unwrap()
        .query_map([&chat], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(notices.len(), 1);
    assert!(notices[0].contains("Both conversation branches are retained"));
    assert!(import_turn(&mut store, &context, &files, &chat, third.next_seq).is_none());
}

#[test]
fn malformed_authenticated_turn_rolls_back_all_visible_rows_and_preserves_staging() {
    let (_dir, mut store, context, files) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "target");
    let chat = empty_chat(&store);
    let turn = staged_turn(store.conn(), &context, &chat, None);
    let (id,nonce,ciphertext): (String,String,String) = store.conn().query_row("SELECT b.id,b.nonce,b.ciphertext FROM sync_turn_parts p JOIN sync_blobs b ON b.id=p.blob_id WHERE p.turn_id=?1",[&turn],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    let sealed = SealedPayload { nonce, ciphertext };
    let bytes = crypto::open_blob(&context.key, "account", &id, 1, &sealed).unwrap();
    let mut value = piece(&bytes, &turn, 0).unwrap();
    value.entries.pop(); // Authenticated bytes still need complete lifecycle validation.
    let damaged = crypto::seal_blob(
        &context.key,
        "account",
        &id,
        1,
        &serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    store
        .conn()
        .execute(
            "UPDATE sync_blobs SET nonce=?2,ciphertext=?3 WHERE id=?1",
            params![id, damaged.nonce, damaged.ciphertext],
        )
        .unwrap();
    assert!(
        exchange::execute_with_files(
            &mut store,
            &context,
            exchange::Command::Import {
                chat_id: chat.clone(),
                minimum_seq: 50
            },
            Some(&files)
        )
        .is_err()
    );
    let visible: u32 = store.conn().query_row("SELECT (SELECT count(*) FROM turns WHERE chat_id=?1)+(SELECT count(*) FROM events WHERE chat_id=?1)",[&chat],|r|r.get(0)).unwrap();
    assert_eq!(visible, 0);
    let state: String = store
        .conn()
        .query_row(
            "SELECT state FROM sync_turns WHERE turn_id=?1",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(state, "staged");
    store
        .conn()
        .execute(
            "UPDATE sync_blobs SET nonce=?2,ciphertext=?3 WHERE id=?1",
            params![id, sealed.nonce, sealed.ciphertext],
        )
        .unwrap();
    assert_eq!(
        import_turn(&mut store, &context, &files, &chat, 50)
            .unwrap()
            .turn_id,
        turn
    );
}

#[test]
fn staged_chat_rotation_does_not_starve_behind_four_busy_actors() {
    let (_dir, mut store, context, _files) =
        fixture(Arc::new(AccountKey::generate().unwrap()), "target");
    let mut expected = std::collections::BTreeSet::new();
    for _ in 0..5 {
        let chat = empty_chat(&store);
        staged_turn(store.conn(), &context, &chat, None);
        expected.insert(chat);
    }
    let mut observed = std::collections::BTreeSet::new();
    for _ in 0..2 {
        let exchange::Reply::ReadyChats(chats) =
            exchange::execute(&mut store, &context, exchange::Command::ReadyChats).unwrap()
        else {
            panic!("ready chats");
        };
        assert_eq!(chats.len(), 4);
        observed.extend(chats);
    }
    assert_eq!(observed, expected);
}
