use super::*;
use crate::{
    paths::DataRoot,
    profile::{ProfileKind, Profiles},
};
use std::sync::Arc;

fn fixture() -> (tempfile::TempDir, Store, SyncContext) {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .create(ProfileKind::Account, "Account")
        .unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let database_key = Arc::new(key.database_key("account", &profile.meta.id).unwrap());
    let (mut store, _) = Store::open_encrypted(&profile, database_key).unwrap();
    let context = SyncContext {
        identity: SyncIdentity {
            account: "account".into(),
            device: "bound-device".into(),
            key_version: 1,
        },
        key,
    };
    context.initialize(&mut store).unwrap();
    (temp, store, context)
}
fn project(conn: &Connection, name: &str) {
    conn.execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES('p',?1,1,1,'local-device')", [name]).unwrap();
}
fn opened(conn: &Connection, context: &SyncContext, collection: &str, id: &str) -> Metadata {
    let record = head(conn, collection, id).unwrap().unwrap();
    let DecodedMetadata::Known(metadata) =
        open(&context.identity, &context.key, &record, 100).unwrap()
    else {
        panic!("metadata")
    };
    metadata
}

#[test]
fn writer_snapshot_and_sealed_outbox_roll_back_together_on_failure() {
    let (_temp, mut store, context) = fixture();
    {
        let tx = store.conn_mut().transaction().unwrap();
        project(&tx, "Before");
        finish(&tx, &context, 10).unwrap();
        tx.commit().unwrap();
    }
    let before = head(store.conn(), "projects", "p").unwrap().unwrap();
    store.conn().execute_batch("CREATE TEMP TRIGGER refuse_sync BEFORE UPDATE ON sync_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END;").unwrap();
    {
        let tx = store.conn_mut().transaction().unwrap();
        tx.execute("UPDATE projects SET name='After' WHERE id='p'", [])
            .unwrap();
        assert!(finish(&tx, &context, 11).is_err());
    }
    assert_eq!(
        store
            .conn()
            .query_row("SELECT name FROM projects WHERE id='p'", [], |row| row
                .get::<_, String>(
                0
            ))
            .unwrap(),
        "Before"
    );
    assert_eq!(
        head(store.conn(), "projects", "p").unwrap().unwrap(),
        before
    );
    assert_eq!(
        store
            .conn()
            .query_row("SELECT COUNT(*) FROM aura_sync_dirty", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn field_clocks_preserve_unedited_values_and_local_tables_never_enter_payloads() {
    let (_temp, mut store, context) = fixture();
    let tx = store.conn_mut().transaction().unwrap();
    project(&tx, "Project");
    tx.execute("INSERT INTO project_folders(id,project_id,display_name,kind,git_remote_url,created_at,updated_at,device_id) VALUES('f','p','Folder','git','https://token:secret@example.com/repo',1,1,'local-device')", []).unwrap();
    tx.execute("INSERT INTO folder_locations(folder_id,device_id,path) VALUES('f','local-device','C:/private/path')", []).unwrap();
    tx.execute("INSERT INTO worktree_setup(folder_id,device_id,input_json,updated_at) VALUES('f','local-device','private setup args',1)", []).unwrap();
    finish(&tx, &context, 20).unwrap();
    let before = opened(&tx, &context, "projects", "p");
    tx.execute("UPDATE projects SET color='#abc' WHERE id='p'", [])
        .unwrap();
    finish(&tx, &context, 21).unwrap();
    let after = opened(&tx, &context, "projects", "p");
    assert!(before.fields["name"] == after.fields["name"]);
    assert!(before.fields["color"] != after.fields["color"]);
    let folder = opened(&tx, &context, "projects", "folder-f");
    assert!(folder.fields["git_remote_url"].value == FieldValue::Deleted);
    let encoded = serde_json::to_string(&folder).unwrap();
    for forbidden in ["private/path", "private setup", "token", "secret"] {
        assert!(!encoded.contains(forbidden));
    }
    assert_eq!(
        tx.query_row("SELECT COUNT(*) FROM sync_outbox", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    tx.commit().unwrap();
}

#[test]
fn tombstones_and_clock_rollback_are_retained_without_resurrecting_fields() {
    let (_temp, mut store, context) = fixture();
    let tx = store.conn_mut().transaction().unwrap();
    project(&tx, "Project");
    finish(&tx, &context, 500_000).unwrap();
    tx.execute("UPDATE projects SET deleted=1 WHERE id='p'", [])
        .unwrap();
    finish(&tx, &context, 1).unwrap();
    let record = head(&tx, "projects", "p").unwrap().unwrap();
    assert!(record.deleted);
    let DecodedMetadata::Known(metadata) =
        open(&context.identity, &context.key, &record, 500_000).unwrap()
    else {
        panic!("metadata")
    };
    assert!(!metadata.live.value);
    assert!(metadata.fields["name"].value == FieldValue::Present(Value::String("Project".into())));
    tx.commit().unwrap();
}
