use super::*;
use rusqlite::{Connection, OptionalExtension, params};

fn db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(crate::sql::MIGRATION).unwrap();
    db.execute_batch(MIGRATION).unwrap();
    db.execute_batch("INSERT INTO users(id,email_key,email,created_at) VALUES
        ('owner','owner','owner@example.invalid',1),('other','other','other@example.invalid',1);
        INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES
        ('fresh','owner','desktop','csrf',900,2000),('browser','owner','browser','browser-csrf',1,1800),
        ('old','owner','desktop','csrf',1,2000),('revoked','owner','desktop','csrf',900,2000),
        ('expired','owner','desktop','csrf',900,1000),('other','other','desktop','csrf',900,2000);
        UPDATE sessions SET revoked_at=999 WHERE token_hash='revoked';").unwrap();
    db
}
fn delete(db: &mut Connection, token: &str, now: i64) {
    let tx = db.transaction().unwrap();
    for sql in [REMEMBER, DELETE, REVOKE] {
        tx.execute(sql, params![token, now]).unwrap();
    }
    tx.commit().unwrap();
}
fn receipt(db: &Connection, token: &str, now: i64) -> Option<(String, String)> {
    db.query_row(RECEIPT, params![token, now], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })
    .optional()
    .unwrap()
}
#[test]
fn only_valid_sessions_of_the_deleted_account_receive_expiring_receipts() {
    let mut db = db();
    delete(&mut db, "fresh", 1000);
    assert_eq!(
        receipt(&db, "browser", 1000),
        Some(("browser".into(), "browser-csrf".into()))
    );
    for token in ["fresh", "old"] {
        assert!(receipt(&db, token, 1000).is_some());
    }
    for token in ["unknown", "other", "revoked", "expired"] {
        assert!(receipt(&db, token, 1000).is_none());
    }
    assert!(receipt(&db, "fresh", 999).is_none());
    assert!(receipt(&db, "fresh", 2000).is_none());
    let active: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE user_id='owner' AND revoked_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(active, 0);
    // Account cleanup can remove sessions without removing the bounded deletion notice.
    db.execute("DELETE FROM sessions WHERE user_id='owner'", [])
        .unwrap();
    assert!(receipt(&db, "fresh", 1001).is_some());
    db.execute(CLEANUP, [2000]).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM account_deletion_receipts", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
}
#[test]
fn deletion_rechecks_fresh_authentication_inside_the_transaction() {
    for token in ["old", "revoked", "expired", "unknown"] {
        let mut db = db();
        delete(&mut db, token, 1000);
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM users WHERE deletion_requested_at IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(receipt(&db, "fresh", 1000).is_none());
    }
}
#[test]
fn revoked_devices_and_future_sessions_do_not_authorize_deletion() {
    let mut db = db();
    db.execute_batch("INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen,revoked_at)
        VALUES('device','owner','Test','windows','public','code',1,1,999);
        UPDATE sessions SET device_id='device' WHERE token_hash='fresh';").unwrap();
    delete(&mut db, "fresh", 1000);
    assert!(receipt(&db, "fresh", 1000).is_none());
    db.execute(
        "UPDATE sessions SET device_id=NULL,created_at=1001 WHERE token_hash='fresh'",
        [],
    )
    .unwrap();
    delete(&mut db, "fresh", 1000);
    assert!(receipt(&db, "fresh", 1000).is_none());
}
