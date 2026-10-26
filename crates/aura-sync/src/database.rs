//! SQLCipher keying primitive. Core owns file opening, locking, backups, migrations and recovery.
//! Call configure immediately after opening every encrypted connection, before any schema probe.
//! A wrong key and a damaged encrypted header are indistinguishable and must never auto-salvage.
use crate::crypto::DatabaseKey;
use rusqlite::{Connection, ffi};

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DatabaseError {
    #[error("This build cannot provide the required database encryption.")]
    Unavailable,
    #[error(
        "The database key is incorrect or the encrypted database is damaged. No repair was attempted."
    )]
    KeyOrCorrupt,
    #[error("The encrypted database settings could not be applied.")]
    Configuration,
}

/// No key text enters SQL, query tracing, database paths, or diagnostic errors. This only configures
/// an owned connection and reads the schema to validate it. It does not migrate or replace files.
#[allow(unsafe_code)]
pub fn configure(connection: &mut Connection, key: &DatabaseKey) -> Result<(), DatabaseError> {
    let version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| DatabaseError::Unavailable)?;
    if !version.starts_with("4.") {
        return Err(DatabaseError::Unavailable);
    }
    connection
        .pragma_update(None, "cipher_log_level", "NONE")
        .map_err(|_| DatabaseError::Configuration)?;
    connection
        .pragma_update(None, "cipher_memory_security", "ON")
        .map_err(|_| DatabaseError::Configuration)?;
    // SAFETY: the connection is alive and exclusively borrowed for this operation at the Rust API
    // boundary; sqlite3_key copies the 32-byte key during this call and never retains its pointer.
    // SQLCipher is compiled into this feature, and the raw handle is not stored or closed here.
    let status = unsafe { ffi::sqlite3_key(connection.handle(), key.secret().as_ptr().cast(), 32) };
    if status != ffi::SQLITE_OK {
        return Err(DatabaseError::Configuration);
    }
    connection
        .pragma_update(None, "temp_store", "MEMORY")
        .map_err(|_| DatabaseError::Configuration)?;
    connection
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| DatabaseError::KeyOrCorrupt)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::AccountKey;
    fn key() -> DatabaseKey {
        AccountKey::restore(&[3; 32])
            .unwrap()
            .database_key("account", "profile")
            .unwrap()
    }
    fn open(path: &std::path::Path, key: &DatabaseKey) -> Connection {
        let mut connection = Connection::open(path).unwrap();
        configure(&mut connection, key).unwrap();
        connection
    }
    #[test]
    fn encrypted_database_reopens_only_with_its_key_and_plain_local_databases_stay_plain() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("account.db");
        let conn = open(&path, &key());
        conn.execute_batch("CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('synthetic encrypted chat title');").unwrap();
        drop(conn);
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3\0"));
        assert!(
            !bytes
                .windows(b"synthetic encrypted chat title".len())
                .any(|part| part == b"synthetic encrypted chat title")
        );
        let conn = open(&path, &key());
        assert_eq!(
            conn.query_row("SELECT value FROM secrets", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "synthetic encrypted chat title"
        );
        drop(conn);
        let wrong = AccountKey::restore(&[4; 32])
            .unwrap()
            .database_key("account", "profile")
            .unwrap();
        let mut conn =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(
            configure(&mut conn, &wrong),
            Err(DatabaseError::KeyOrCorrupt)
        );
        drop(conn);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let plain = directory.path().join("local.db");
        let conn = Connection::open(&plain).unwrap();
        conn.execute_batch(
            "CREATE TABLE local_only(value TEXT); INSERT INTO local_only VALUES('local');",
        )
        .unwrap();
        drop(conn);
        assert!(
            std::fs::read(&plain)
                .unwrap()
                .starts_with(b"SQLite format 3\0")
        );
        assert_eq!(
            Connection::open(&plain)
                .unwrap()
                .query_row("SELECT value FROM local_only", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "local"
        );
    }
    #[test]
    fn backup_destination_must_be_keyed_and_stays_encrypted() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("account.db");
        let target = directory.path().join("backup.db");
        let conn = open(&source, &key());
        conn.execute_batch("CREATE TABLE items(value TEXT); INSERT INTO items VALUES('synthetic backup secret'); PRAGMA user_version=3;").unwrap();
        let mut destination = open(&target, &key());
        rusqlite::backup::Backup::new(&conn, &mut destination)
            .unwrap()
            .run_to_completion(16, std::time::Duration::from_millis(1), None)
            .unwrap();
        drop(destination);
        drop(conn);
        assert!(
            !std::fs::read(&target)
                .unwrap()
                .starts_with(b"SQLite format 3\0")
        );
        let restored = open(&target, &key());
        assert_eq!(
            restored
                .query_row("SELECT value FROM items", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "synthetic backup secret"
        );
        assert_eq!(
            restored
                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            3
        );
    }
    #[test]
    fn keying_does_not_convert_or_replace_an_existing_plain_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('local data');",
        )
        .unwrap();
        drop(conn);
        let original = std::fs::read(&path).unwrap();
        let mut conn = Connection::open(&path).unwrap();
        assert_eq!(
            configure(&mut conn, &key()),
            Err(DatabaseError::KeyOrCorrupt)
        );
        drop(conn);
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }
}
