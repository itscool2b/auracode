use super::*;
use aura_sync::crypto::{AccountKey, DatabaseKey};
use std::sync::Arc;

fn key() -> Arc<DatabaseKey> {
    Arc::new(
        AccountKey::generate()
            .expect("synthetic account key")
            .database_key("account", "profile")
            .expect("synthetic database key"),
    )
}
fn migrations() -> [M<'static>; 2] {
    [
        M::up("CREATE TABLE secrets(value TEXT NOT NULL);"),
        M::up("ALTER TABLE secrets ADD COLUMN extra TEXT;"),
    ]
}
fn raw(path: &Path, key: &DatabaseKey) -> Connection {
    let mut conn = Connection::open(path).expect("open test database");
    aura_sync::database::configure(&mut conn, key).expect("key test database");
    conn
}
fn assert_ciphertext(path: &Path) {
    let bytes = fs::read(path).expect("read test ciphertext");
    assert!(!bytes.starts_with(b"SQLite format 3\0"));
    assert!(
        !bytes
            .windows(b"private synthetic title".len())
            .any(|p| p == b"private synthetic title")
    );
}

#[test]
fn encrypted_reopen_migration_and_backup_preserve_rows_without_plaintext() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("account.db");
    let backups = temp.path().join("backups");
    let key = key();
    let migrations = migrations();
    let (store, info) = open(&path, &backups, key.clone(), &migrations[..1]).unwrap();
    assert_eq!(info.outcome, OpenOutcome::Created);
    store
        .conn()
        .execute(
            "INSERT INTO secrets VALUES(?1)",
            ["private synthetic title"],
        )
        .unwrap();
    assert_eq!(store.check_integrity().unwrap(), Integrity::Ok);
    assert_ciphertext(&fsutil::with_suffix(&path, "-wal"));
    drop(store);
    assert_ciphertext(&path);
    let (store, info) = open(&path, &backups, key.clone(), &migrations).unwrap();
    let OpenOutcome::Migrated {
        backup: Some(backup),
        from: 1,
        to: 2,
    } = info.outcome
    else {
        panic!("expected a backed-up migration: {:?}", info.outcome)
    };
    assert_eq!(
        store
            .conn()
            .query_row("SELECT value FROM secrets", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "private synthetic title"
    );
    assert_ciphertext(Path::new(&backup));
    let backup = raw(Path::new(&backup), &key);
    assert_eq!(stored_version(&backup).unwrap(), 1);
    assert_eq!(
        backup
            .query_row("SELECT value FROM secrets", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "private synthetic title"
    );
    assert!(backup.prepare("SELECT extra FROM secrets").is_err());
    drop(backup);
    drop(store);
    let (store, info) = open(&path, &backups, key, &migrations).unwrap();
    assert_eq!(info.outcome, OpenOutcome::Opened);
    assert_eq!(store.schema_version().unwrap(), 2);
}

#[test]
fn wrong_key_damage_and_missing_ready_file_never_repair_or_replace() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("account.db");
    let backups = temp.path().join("backups");
    let correct = key();
    let (store, _) = open(&path, &backups, correct.clone(), &migrations()[..1]).unwrap();
    store
        .conn()
        .execute("INSERT INTO secrets VALUES('private synthetic title')", [])
        .unwrap();
    let damage = rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
        None,
    );
    assert!(matches!(
        store.note_query_error(&damage),
        Err(CoreError::EncryptedDatabase { .. })
    ));
    assert!(!recovery::damage_marker(&path).exists());
    drop(store);
    let original = fs::read(&path).unwrap();
    assert!(matches!(
        open(&path, &backups, key(), &migrations()),
        Err(CoreError::DatabaseEncryption(_))
    ));
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(matches!(
        Store::open_at(&path, &backups),
        Err(CoreError::ProfileLocked { .. })
    ));
    let mut damaged = original.clone();
    damaged[50] ^= 0x42;
    fs::write(&path, &damaged).unwrap();
    assert!(open(&path, &backups, correct.clone(), &migrations()).is_err());
    assert_eq!(fs::read(&path).unwrap(), damaged);
    assert!(!backups.exists());
    fs::remove_file(&path).unwrap();
    assert!(matches!(
        open(&path, &backups, correct, &migrations()),
        Err(CoreError::EncryptedDatabase { .. })
    ));
    assert!(!path.exists());
}

#[test]
fn failed_migration_and_newer_schema_preserve_encrypted_original() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("account.db");
    let backups = temp.path().join("backups");
    let key = key();
    drop(
        open(&path, &backups, key.clone(), &migrations()[..1])
            .unwrap()
            .0,
    );
    let bad = [
        M::up("CREATE TABLE secrets(value TEXT NOT NULL);"),
        M::up("CREATE TABLE temporary_upgrade(value); INSERT INTO nonexistent VALUES(1);"),
    ];
    assert!(matches!(
        open(&path, &backups, key.clone(), &bad),
        Err(CoreError::Migration(_))
    ));
    let conn = raw(&path, &key);
    assert_eq!(stored_version(&conn).unwrap(), 1);
    assert!(conn.prepare("SELECT * FROM temporary_upgrade").is_err());
    conn.pragma_update(None, "user_version", 100).unwrap();
    drop(conn);
    let original = fs::read(&path).unwrap();
    assert!(matches!(
        open(&path, &backups, key, &migrations()),
        Err(CoreError::SchemaTooNew { found: 100, .. })
    ));
    assert_eq!(fs::read(&path).unwrap(), original);
    for entry in fs::read_dir(backups).unwrap() {
        let entry = entry.unwrap();
        if entry.path().extension().is_some_and(|s| s == "bak") {
            assert_ciphertext(&entry.path());
        }
    }
}

#[test]
fn public_account_open_uses_current_schema_and_refuses_local_conversion() {
    let temp = tempfile::tempdir().unwrap();
    let mut profile = Profile {
        meta: crate::profile::ProfileMeta {
            id: "profile".into(),
            kind: ProfileKind::Local,
            display_name: "Local".into(),
            created_at: 0,
        },
        dir: temp.path().join("profile"),
    };
    let key = key();
    assert!(matches!(
        Store::open_encrypted(&profile, key.clone()),
        Err(CoreError::ProfileEncryptionMismatch)
    ));
    assert!(!profile.dir.exists());
    profile.meta.kind = ProfileKind::Account;
    let (store, _) = Store::open_encrypted(&profile, key.clone()).unwrap();
    assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(store.check_integrity().unwrap(), Integrity::Ok);
    drop(store);
    fs::write(
        marker_path(&profile.db_path()),
        b"{\"version\":99,\"state\":\"ready\"}",
    )
    .unwrap();
    let original = fs::read(profile.db_path()).unwrap();
    assert!(matches!(
        Store::open_encrypted(&profile, key),
        Err(CoreError::EncryptedDatabase { .. })
    ));
    assert_eq!(fs::read(profile.db_path()).unwrap(), original);
}

#[test]
fn interrupted_initialization_remains_keyed_and_can_finish_on_retry() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("account.db");
    let backups = temp.path().join("backups");
    let key = key();
    let broken = [M::up(
        "CREATE TABLE partial(value); INSERT INTO absent VALUES(1);",
    )];
    assert!(matches!(
        open(&path, &backups, key.clone(), &broken),
        Err(CoreError::Migration(_))
    ));
    assert!(matches!(
        Store::open_at(&path, &backups),
        Err(CoreError::ProfileLocked { .. })
    ));
    let (store, info) = open(&path, &backups, key, &migrations()[..1]).unwrap();
    assert_eq!(info.outcome, OpenOutcome::Created);
    assert!(store.conn().prepare("SELECT * FROM partial").is_err());
    assert_eq!(store.schema_version().unwrap(), 1);
    drop(store);
    assert_ciphertext(&path);
}

#[test]
fn sync_migration_keeps_existing_account_projects_and_takes_a_keyed_v6_backup() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("account.db");
    let backups = temp.path().join("backups");
    let key = key();
    let all = crate::store::migrations();
    let (store, _) = open(&path, &backups, key.clone(), &all[..6]).unwrap();
    store.conn().execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES('project','private synthetic title',1,1,'windows')", []).unwrap();
    drop(store);
    let (store, info) = open(&path, &backups, key.clone(), all).unwrap();
    let OpenOutcome::Migrated {
        from: 6,
        backup: Some(backup),
        ..
    } = info.outcome
    else {
        panic!("expected a v6 migration backup")
    };
    assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(
        store
            .conn()
            .query_row("SELECT name FROM projects WHERE id='project'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "private synthetic title"
    );
    assert_eq!(
        store
            .conn()
            .query_row("SELECT count(*) FROM sync_state", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_ciphertext(Path::new(&backup));
    let backup = raw(Path::new(&backup), &key);
    assert_eq!(stored_version(&backup).unwrap(), 6);
    assert!(backup.prepare("SELECT * FROM sync_state").is_err());
}

#[test]
fn account_filename_avoids_old_plaintext_open_and_multiple_candidates_are_preserved() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile {
        meta: crate::profile::ProfileMeta {
            id: "profile".into(),
            kind: ProfileKind::Account,
            display_name: "Account".into(),
            created_at: 0,
        },
        dir: temp.path().join("profile"),
    };
    assert_eq!(profile.db_path().file_name().unwrap(), "aura.encrypted.db");
    fs::create_dir(&profile.dir).unwrap();
    let old = profile.dir.join("aura.db");
    fs::write(&old, b"older account data").unwrap();
    assert!(matches!(
        Store::open_encrypted(&profile, key()),
        Err(CoreError::AccountDatabaseLayout { .. })
    ));
    assert!(!profile.db_path().exists());
    assert_eq!(fs::read(&old).unwrap(), b"older account data");
    fs::remove_file(&old).unwrap();
    let key = key();
    drop(Store::open_encrypted(&profile, key.clone()).unwrap().0);
    let cipher = fs::read(profile.db_path()).unwrap();
    // A pre-encryption build may create its own plain file, but it cannot target this ciphertext.
    fs::write(&old, b"data from an older build").unwrap();
    assert!(matches!(
        Store::open_encrypted(&profile, key),
        Err(CoreError::AccountDatabaseLayout { .. })
    ));
    assert_eq!(fs::read(profile.db_path()).unwrap(), cipher);
    assert_eq!(fs::read(&old).unwrap(), b"data from an older build");
}
