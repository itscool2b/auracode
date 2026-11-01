use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
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
fn record(store: &Store, collection: &str, id: &str) -> EncryptedRecord {
    head(store.conn(), collection, id).unwrap().unwrap()
}
fn incoming(record: EncryptedRecord, seq: u64) -> Change {
    Change {
        device_id: record.hlc.parse::<Hlc>().unwrap().device().into(),
        record,
        server_seq: seq,
    }
}
fn pull(store: &mut Store, context: &SyncContext, records: Vec<Change>, now: u64) -> Result<()> {
    let next_cursor = records.last().unwrap().server_seq;
    SyncLedger::new(store, context.identity.clone(), &context.key)?.accept_workspace_pull(
        &Pull {
            records,
            next_cursor,
            has_more: false,
        },
        now,
    )
}
fn seed(store: &mut Store, context: &SyncContext, now: u64) -> (String, String, String) {
    let (project, folder, chat) = (
        crate::ids::new_id(),
        crate::ids::new_id(),
        crate::ids::new_id(),
    );
    let tx = store.conn_mut().transaction().unwrap();
    tx.execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES(?1,'Remote project',1,1,'source')", [&project]).unwrap();
    tx.execute("INSERT INTO project_folders(id,project_id,display_name,kind,git_remote_url,created_at,updated_at,device_id) VALUES(?1,?2,'Repository','git','https://example.test/repo',1,1,'source')", params![folder,project]).unwrap();
    tx.execute("INSERT INTO chats(id,project_id,folder_id,title,created_at,updated_at,device_id) VALUES(?1,?2,?3,'Shared chat',1,1,'source')", params![chat,project,folder]).unwrap();
    capture::pending(&tx, context, now).unwrap();
    tx.commit().unwrap();
    (project, folder, chat)
}

#[test]
fn child_before_parent_is_durable_and_projects_without_device_locations_or_echoes() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_source_dir, mut source, source_context) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context) = fixture(key, "target");
    let now = crate::time::now_millis() as u64;
    let (project, folder, chat) = seed(&mut source, &source_context, now);
    pull(
        &mut target,
        &target_context,
        vec![incoming(record(&source, "chats", &chat), 1)],
        now,
    )
    .unwrap();
    assert_eq!(
        target
            .conn()
            .query_row("SELECT count(*) FROM chats", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        target
            .conn()
            .query_row("SELECT count(*) FROM sync_projection", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    pull(
        &mut target,
        &target_context,
        vec![incoming(
            record(&source, "projects", &format!("folder-{folder}")),
            2,
        )],
        now,
    )
    .unwrap();
    pull(
        &mut target,
        &target_context,
        vec![incoming(record(&source, "projects", &project), 3)],
        now,
    )
    .unwrap();
    assert_eq!(
        target
            .conn()
            .query_row("SELECT title FROM chats WHERE id=?1", [&chat], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "Shared chat"
    );
    for table in [
        "folder_locations",
        "agent_sessions",
        "queued_prompts",
        "sync_projection",
        "sync_outbox",
        "aura_sync_dirty",
    ] {
        assert_eq!(
            target
                .conn()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert_eq!(
        SyncLedger::new(
            &mut target,
            target_context.identity.clone(),
            &target_context.key
        )
        .unwrap()
        .cursor()
        .unwrap(),
        3
    );
}

#[test]
fn remote_fields_merge_without_erasing_local_edits_and_deletes_keep_local_paths() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_source_dir, mut source, source_context) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context) = fixture(key, "target");
    let now = crate::time::now_millis() as u64;
    let (project, folder, chat) = seed(&mut source, &source_context, now);
    pull(
        &mut target,
        &target_context,
        vec![
            incoming(record(&source, "projects", &project), 1),
            incoming(record(&source, "projects", &format!("folder-{folder}")), 2),
            incoming(record(&source, "chats", &chat), 3),
        ],
        now,
    )
    .unwrap();
    target.conn().execute("INSERT INTO folder_locations(folder_id,device_id,path) VALUES(?1,'target','C:/private/local')",[&folder]).unwrap();
    target
        .conn()
        .execute(
            "UPDATE projects SET name='Local name' WHERE id=?1",
            [&project],
        )
        .unwrap();
    capture::pending(target.conn(), &target_context, now + 1).unwrap();
    source
        .conn()
        .execute(
            "UPDATE projects SET color='blue',deleted=1 WHERE id=?1",
            [&project],
        )
        .unwrap();
    capture::pending(source.conn(), &source_context, now + 2).unwrap();
    pull(
        &mut target,
        &target_context,
        vec![incoming(record(&source, "projects", &project), 4)],
        now + 2,
    )
    .unwrap();
    let row = target
        .conn()
        .query_row(
            "SELECT name,color,deleted FROM projects WHERE id=?1",
            [&project],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(row, ("Local name".into(), "blue".into(), true));
    assert_eq!(
        target
            .conn()
            .query_row(
                "SELECT path FROM folder_locations WHERE folder_id=?1",
                [&folder],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "C:/private/local"
    );
    assert_eq!(
        SyncLedger::new(
            &mut target,
            target_context.identity.clone(),
            &target_context.key
        )
        .unwrap()
        .outgoing()
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn parent_tombstone_waits_for_memory_turn_then_blocks_the_next_dispatch() {
    use crate::chatstore::workspace_activity::{Activity, prepare, refresh};
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_source_dir, mut source, source_context) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context) = fixture(key, "target");
    let now = crate::time::now_millis() as u64;
    let (project, folder, chat) = seed(&mut source, &source_context, now);
    pull(
        &mut target,
        &target_context,
        vec![
            incoming(record(&source, "projects", &project), 1),
            incoming(record(&source, "projects", &format!("folder-{folder}")), 2),
            incoming(record(&source, "chats", &chat), 3),
        ],
        now,
    )
    .unwrap();
    let activity = Arc::new(Activity::default());
    activity.loaded(target.conn(), &chat).unwrap();
    let turn = activity.begin(&chat).unwrap();
    source
        .conn()
        .execute("UPDATE projects SET deleted=1 WHERE id=?1", [&project])
        .unwrap();
    capture::pending(source.conn(), &source_context, now + 1).unwrap();
    {
        let mut active = activity.lock();
        prepare(target.conn(), &active).unwrap();
        pull(
            &mut target,
            &target_context,
            vec![incoming(record(&source, "projects", &project), 4)],
            now + 1,
        )
        .unwrap();
        refresh(target.conn(), &mut active);
    }
    assert!(activity.available(&chat));
    assert_eq!(
        target
            .conn()
            .query_row("SELECT count(*) FROM sync_projection", [], |r| r
                .get::<_, u32>(0))
            .unwrap(),
        1
    );
    drop(turn);
    target.conn().execute("INSERT INTO turns(id,chat_id,seq,status,started_at,device_id) VALUES('pending-turn',?1,1,'running',1,'target')",[&chat]).unwrap();
    {
        let mut active = activity.lock();
        prepare(target.conn(), &active).unwrap();
        drain(
            target.conn(),
            &target_context.identity,
            &target_context.key,
            now + 2,
        )
        .unwrap();
        refresh(target.conn(), &mut active);
    }
    assert!(activity.available(&chat));
    target
        .conn()
        .execute(
            "UPDATE turns SET status='completed' WHERE id='pending-turn'",
            [],
        )
        .unwrap();
    {
        let mut active = activity.lock();
        prepare(target.conn(), &active).unwrap();
        drain(
            target.conn(),
            &target_context.identity,
            &target_context.key,
            now + 3,
        )
        .unwrap();
        refresh(target.conn(), &mut active);
    }
    assert!(!activity.available(&chat));
    assert!(activity.begin(&chat).is_none());
    assert_eq!(
        target
            .conn()
            .query_row("SELECT count(*) FROM chats", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
}

#[test]
fn malformed_known_row_rolls_back_all_projection_and_cursor_progress() {
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_source_dir, mut source, source_context) = fixture(key.clone(), "source");
    let (_target_dir, mut target, target_context) = fixture(key, "target");
    let now = crate::time::now_millis() as u64;
    let (project, _, chat) = seed(&mut source, &source_context, now);
    let good = record(&source, "projects", &project);
    let bad = record(&source, "chats", &chat);
    let DecodedMetadata::Known(mut data) =
        open(&source_context.identity, &source_context.key, &bad, now).unwrap()
    else {
        unreachable!()
    };
    data.fields.get_mut("project_id").unwrap().value =
        FieldValue::Present(serde_json::Value::String("../not-an-id".into()));
    let bad = seal(
        &source_context.identity,
        &source_context.key,
        "chats",
        &chat,
        &bad.hlc.parse().unwrap(),
        &data,
    )
    .unwrap();
    assert!(
        pull(
            &mut target,
            &target_context,
            vec![incoming(good, 1), incoming(bad, 2)],
            now
        )
        .is_err()
    );
    for table in ["projects", "sync_heads", "sync_projection"] {
        assert_eq!(
            target
                .conn()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert_eq!(
        SyncLedger::new(
            &mut target,
            target_context.identity.clone(),
            &target_context.key
        )
        .unwrap()
        .cursor()
        .unwrap(),
        0
    );
}

#[test]
fn unresolved_memory_and_mcp_dependencies_rotate_without_starving_unrelated_chat_projection() {
    use aura_protocol::memory::MemoryRevision;
    let key = Arc::new(AccountKey::generate().unwrap());
    let (_a, mut source, source_context) = fixture(key.clone(), "source");
    let (_b, mut target, target_context) = fixture(key, "target");
    let now = crate::time::now_millis() as u64;
    let (project, folder, chat) = seed(&mut source, &source_context, now);
    pull(
        &mut target,
        &target_context,
        vec![
            incoming(record(&source, "projects", &project), 1),
            incoming(record(&source, "projects", &format!("folder-{folder}")), 2),
        ],
        now + 1,
    )
    .unwrap();
    let missing_project = crate::ids::new_id();
    let mut clock = Clock::new("source").unwrap();
    let tx = target.conn_mut().transaction().unwrap();
    // Both custom record kinds sort before chats. More than one batch must remain unresolved.
    for index in 0..260 {
        let id = crate::ids::new_id();
        let stamp = clock.tick(now + 2).unwrap();
        let (entity, prefix, value) = if index % 2 == 0 {
            (
                "memory",
                "memory-",
                serde_json::to_value(MemoryRevision {
                    revision: id.clone(),
                    project_id: missing_project.clone(),
                    parent_revision: None,
                    markdown: "Waiting for missing project".into(),
                    reason: "Dependency fixture".into(),
                    source: "user".into(),
                    created_at: now as i64,
                })
                .unwrap(),
            )
        } else {
            (
                "shared_mcp",
                "mcp-",
                serde_json::to_value(crate::mcp::Revision {
                    id: id.clone(),
                    parent: None,
                    scope: missing_project.clone(),
                    server_id: crate::ids::new_id(),
                    definition: None,
                    resolved: vec![],
                })
                .unwrap(),
            )
        };
        let metadata = Metadata {
            schema_version: 1,
            live: Stamped {
                clock: stamp.clone(),
                value: true,
            },
            fields: BTreeMap::from([
                (
                    "entity".into(),
                    Stamped {
                        clock: stamp.clone(),
                        value: FieldValue::Present(serde_json::json!(entity)),
                    },
                ),
                (
                    "revision".into(),
                    Stamped {
                        clock: stamp.clone(),
                        value: FieldValue::Present(value),
                    },
                ),
            ]),
        };
        let record = seal(
            &source_context.identity,
            &source_context.key,
            "projects",
            &format!("{prefix}{id}"),
            &stamp,
            &metadata,
        )
        .unwrap();
        save_head(&tx, &record).unwrap();
        queue(&tx, &record, &metadata).unwrap();
    }
    let chat_record = record(&source, "chats", &chat);
    let DecodedMetadata::Known(metadata) = open(
        &source_context.identity,
        &source_context.key,
        &chat_record,
        now + 2,
    )
    .unwrap() else {
        panic!()
    };
    save_head(&tx, &chat_record).unwrap();
    queue(&tx, &chat_record, &metadata).unwrap();
    tx.commit().unwrap();
    drain(
        target.conn(),
        &target_context.identity,
        &target_context.key,
        now + 3,
    )
    .unwrap();
    assert_eq!(
        target
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sync_projection WHERE attempt>0",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        256
    );
    drain(
        target.conn(),
        &target_context.identity,
        &target_context.key,
        now + 4,
    )
    .unwrap();
    assert!(
        target
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chats WHERE id=?1)",
                [chat],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
    assert_eq!(
        target
            .conn()
            .query_row("SELECT COUNT(*) FROM sync_projection", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        260
    );
}
