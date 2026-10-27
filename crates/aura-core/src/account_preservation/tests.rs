use super::*;
use crate::{
    chatstore::{NewChat, rows},
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use std::sync::Arc;

struct Fixture {
    _dir: tempfile::TempDir,
    root: DataRoot,
    profiles: Profiles,
    store: Store,
    files: Attachments,
    chat: String,
    hash: String,
}
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = DataRoot::at(dir.path());
    let profiles = Profiles::new(root.clone());
    let local = profiles.create(ProfileKind::Local, "Local").unwrap();
    let (local_store, _) = Store::open(&local).unwrap();
    local_store.conn().execute("INSERT INTO projects(id,name,sort_key,created_at,updated_at,device_id) VALUES('original','Original Local','a',1,1,'device')", []).unwrap();
    drop(local_store);
    let profile = profiles.create(ProfileKind::Account, "Account").unwrap();
    let key = aura_sync::crypto::AccountKey::generate().unwrap();
    let (store, _) = Store::open_encrypted(
        &profile,
        Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
    )
    .unwrap();
    let files = Attachments::Encrypted(
        crate::profile_files::EncryptedFiles::open(
            &profile.attachments_dir(),
            aura_sync::crypto::files::Purpose::Attachment,
            Arc::new(key.profile_file_key("account", &profile.meta.id).unwrap()),
        )
        .unwrap(),
    );
    let chat = rows::create_chat(
        store.conn(),
        &NewChat {
            folder: dir.path().join("repo"),
            agent_id: "codex".into(),
            agent_host: aura_protocol::agents::AgentHost::Native,
            device_id: "device".into(),
            now: 1,
        },
    )
    .unwrap()
    .id;
    store.conn().execute("UPDATE chats SET archived=1,isolation='isolated',worktree_branch='private-branch' WHERE id=?1", [&chat]).unwrap();
    let session = crate::ids::new_id();
    store.conn().execute("INSERT INTO agent_sessions(id,chat_id,agent_id,native_session_id,cwd,created_at,updated_at,device_id) VALUES(?1,?2,'codex','never-copy-native','/native/private',1,1,'device')", params![session,chat]).unwrap();
    let bytes = b"retained account attachment";
    let hash = format!("{:x}", Sha256::digest(bytes));
    files.write(&hash, bytes).unwrap();
    store
        .conn()
        .execute(
            "INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,'text/plain',?2,1)",
            params![hash, bytes.len() as i64],
        )
        .unwrap();
    store.conn().execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES('attachment',?1,?2,'notes.txt','text/plain',?3,1)", params![chat,hash,bytes.len() as i64]).unwrap();
    Fixture {
        _dir: dir,
        root,
        profiles,
        store,
        files,
        chat,
        hash,
    }
}
fn preview(f: &Fixture) -> Snapshot {
    match execute(&f.store, &f.files, "device", Command::Preview).unwrap() {
        Reply::Preview(value) => value,
        _ => panic!("preview"),
    }
}
#[test]
fn kept_copy_preserves_archived_workspace_and_decrypts_only_referenced_attachments() {
    let f = fixture();
    let before = preview(&f);
    let result = execute(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: before.clone(),
        },
    )
    .unwrap();
    let Reply::Applied(result) = result else {
        panic!("applied")
    };
    let copy = f.profiles.get(&result.profile_id).unwrap();
    assert_eq!(copy.meta.kind, ProfileKind::Local);
    let (copy_store, _) = Store::open(&copy).unwrap();
    assert!(!copy_store.is_encrypted());
    assert_eq!(
        std::fs::read(copy.attachments_dir().join(&f.hash)).unwrap(),
        b"retained account attachment"
    );
    let row: (bool, String, Option<String>) = copy_store
        .conn()
        .query_row(
            "SELECT archived,isolation,worktree_branch FROM chats WHERE id=?1",
            [&f.chat],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(row, (true, "direct".into(), None));
    for table in [
        "agent_sessions",
        "queued_prompts",
        "sync_outbox",
        "local_imports",
    ] {
        assert_eq!(
            copy_store
                .conn()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert!(preview(&f) == before);
    assert_eq!(
        f.store
            .conn()
            .query_row("SELECT native_session_id FROM agent_sessions", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "never-copy-native"
    );
    let (original, _) = Store::open(&f.profiles.get("local").unwrap()).unwrap();
    assert_eq!(
        original
            .conn()
            .query_row("SELECT name FROM projects", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Original Local"
    );
    assert_eq!(f.profiles.list().unwrap().len(), 3);
}
#[test]
fn changed_review_never_creates_a_plaintext_destination() {
    let f = fixture();
    let reviewed = preview(&f);
    f.store
        .conn()
        .execute("UPDATE chats SET title='Changed' WHERE id=?1", [&f.chat])
        .unwrap();
    assert!(matches!(
        execute(
            &f.store,
            &f.files,
            "device",
            Command::Apply {
                root: f.root.clone(),
                snapshot: reviewed
            }
        ),
        Err(PreservationError::Changed)
    ));
    assert_eq!(std::fs::read_dir(f.root.profiles_dir()).unwrap().count(), 2);
}
#[test]
fn corrupt_blob_retains_an_unpublished_partial_copy_and_the_encrypted_source() {
    let f = fixture();
    f.store
        .conn()
        .execute("UPDATE attachments SET size=size+1", [])
        .unwrap();
    let reviewed = preview(&f);
    let Err(PreservationError::Partial(id)) = execute(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: reviewed,
        },
    ) else {
        panic!("must fail")
    };
    assert!(f.profiles.get(&id).is_err());
    assert_eq!(f.profiles.list().unwrap().len(), 2);
    assert!(
        f.root
            .profile_dir(&id)
            .unwrap()
            .join("keep-local-incomplete.json")
            .is_file()
    );
    assert!(f.store.is_encrypted());
}
#[test]
fn missing_attachment_is_counted_without_losing_chat_metadata() {
    let f = fixture();
    let absent = "a".repeat(64);
    f.store
        .conn()
        .execute("UPDATE composer_attachments SET sha256=?1", [&absent])
        .unwrap();
    let Reply::Applied(result) = execute(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: preview(&f),
        },
    )
    .unwrap() else {
        panic!("apply")
    };
    assert_eq!(result.missing_attachments, 1);
    assert_eq!(result.chats, 1);
}

#[test]
fn unfinished_turn_recovery_changes_only_the_copy() {
    let f = fixture();
    let turn = crate::ids::new_id();
    f.store.conn().execute("INSERT INTO turns(id,chat_id,agent_session_id,seq,status,started_at,device_id,prompt_parts_json,first_event_seq) SELECT ?1,?2,id,1,'running',1,'device','[]',0 FROM agent_sessions WHERE chat_id=?2", params![turn,f.chat]).unwrap();
    let Reply::Applied(result) = execute(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: preview(&f),
        },
    )
    .unwrap() else {
        panic!("apply")
    };
    let (copy, _) = Store::open(&f.profiles.get(&result.profile_id).unwrap()).unwrap();
    let copied: (String, Option<String>) = copy
        .conn()
        .query_row(
            "SELECT status,agent_session_id FROM turns WHERE id=?1",
            [&turn],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(copied, ("interrupted".into(), None));
    assert_eq!(
        f.store
            .conn()
            .query_row("SELECT status FROM turns WHERE id=?1", [&turn], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "running"
    );
}

#[test]
fn publication_refuses_a_preexisting_metadata_file() {
    let directory = tempfile::tempdir().unwrap();
    let root = DataRoot::at(directory.path());
    let mut stage = staging::Stage::new(root).unwrap();
    std::fs::write(stage.profile.db_path(), b"synthetic destination").unwrap();
    std::fs::write(stage.profile.meta_path(), b"independent data").unwrap();
    assert!(stage.publish().is_err());
    assert_eq!(
        std::fs::read(stage.profile.meta_path()).unwrap(),
        b"independent data"
    );
    assert!(
        stage
            .profile
            .dir
            .join("keep-local-incomplete.json")
            .is_file()
    );
}

#[test]
fn cumulative_attachment_limit_stops_before_writing_the_next_blob() {
    let f = fixture();
    let bytes = b"a second retained attachment";
    let hash = format!("{:x}", Sha256::digest(bytes));
    f.files.write(&hash, bytes).unwrap();
    f.store.conn().execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES('second',?1,?2,'second.txt','text/plain',?3,1)", params![f.chat,hash,bytes.len() as i64]).unwrap();
    let before = preview(&f);
    let Err(PreservationError::PartialLimit(id)) = execute_bounded(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: before.clone(),
        },
        AttachmentLimits {
            objects: 4096,
            bytes: 30,
        },
    ) else {
        panic!("cumulative limit")
    };
    assert_eq!(
        std::fs::read_dir(f.root.profile_dir(&id).unwrap().join("attachments"))
            .unwrap()
            .count(),
        1
    );
    assert!(f.profiles.get(&id).is_err());
    assert!(preview(&f) == before);
    let Err(PreservationError::PartialLimit(id)) = execute_bounded(
        &f.store,
        &f.files,
        "device",
        Command::Apply {
            root: f.root.clone(),
            snapshot: before,
        },
        AttachmentLimits {
            objects: 1,
            bytes: 1024,
        },
    ) else {
        panic!("object limit")
    };
    assert_eq!(
        std::fs::read_dir(f.root.profile_dir(&id).unwrap().join("attachments"))
            .unwrap()
            .count(),
        0
    );
}
