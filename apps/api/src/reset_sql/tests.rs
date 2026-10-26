use super::*;
use rusqlite::{Connection, params};

fn db() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(crate::sql::MIGRATION).unwrap();
    db.execute_batch(MIGRATION).unwrap();
    db.execute_batch("INSERT INTO users(id,email_key,email,created_at) VALUES('u','email','a@example.invalid',0),('other','other','b@example.invalid',0);
        INSERT INTO sessions VALUES('old','u','desktop','csrf','old',900,3000,NULL),('fresh','u','desktop','csrf','new',1000,3000,NULL),('other','other','desktop','csrf','other',1000,3000,NULL);
        INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen,approved_at,wrapped_key,key_version)
        VALUES('old','u','old','windows','key','123456',0,900,900,'old-envelope',7),('new','u','new','macos','new-key','654321',1000,1000,NULL,NULL,NULL),('other','other','other','macos','other-key','654321',1000,1000,1000,'other-envelope',1);
        INSERT INTO user_keys VALUES('u',7,'old-verifier','old-recovery',900,'old'),('other',1,'other-verifier','other-recovery',900,'other');
        INSERT INTO sync_changes(user_id,collection,id,hlc,device_id,deleted,nonce,ciphertext,key_version,size_bytes) VALUES('u','chats','old-chat','clock','old',0,'nonce','cipher',7,16),('other','chats','other-chat','clock','other',0,'nonce','cipher',1,16);
        INSERT INTO blob_objects VALUES('u/old','u',16,5000),('u/pending','u',16,6000),('other/blob','other',16,5000);
        INSERT INTO blobs VALUES('u','old','u/old','etag','nonce',7,16,900),('other','blob','other/blob','etag','nonce',1,16,900);").unwrap();
    db
}
fn review(db: &Connection, id: &str) -> usize {
    db.execute(REVIEW, params![id, "fresh", 1000]).unwrap()
}
fn reset(db: &mut Connection, review: &str, operation: &str, now: i64) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    tx.execute(
        CONSUME,
        params![review, "fresh", now, operation, "request-hash"],
    )?;
    tx.execute(
        KEYS,
        params![review, operation, "new-verifier", "new-recovery", now],
    )?;
    for sql in [HEADS, CHANGES, BLOBS, QUOTA] {
        tx.execute(sql, params![review, operation])?;
    }
    tx.execute(DEVICES, params![review, operation, now])?;
    tx.execute(SESSIONS, params![review, operation, now])?;
    tx.execute(
        DEVICE,
        params![review, operation, now, "new-device-envelope"],
    )?;
    tx.commit()
}
fn number(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |row| row.get(0)).unwrap()
}

#[test]
fn reset_increments_epoch_revokes_old_access_and_preserves_other_accounts_and_gc() {
    let mut db = db();
    assert_eq!(review(&db, "review"), 1);
    reset(&mut db, "review", "operation", 1001).unwrap();
    assert_eq!(
        number(&db, "SELECT key_version FROM user_keys WHERE user_id='u'"),
        8
    );
    assert_eq!(
        number(&db, "SELECT key_version FROM devices WHERE id='new'"),
        8
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM devices WHERE user_id='u' AND revoked_at IS NULL"
        ),
        1
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sessions WHERE user_id='u' AND revoked_at IS NULL"
        ),
        1
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM sync_changes WHERE user_id='u'"),
        0
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM blobs WHERE user_id='u'"),
        0
    );
    assert_eq!(
        number(&db, "SELECT sync_used_bytes FROM users WHERE id='u'"),
        0
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM blob_objects WHERE user_id='u'"),
        2
    );
    assert_eq!(
        number(
            &db,
            "SELECT collect_after FROM blob_objects WHERE object_key='u/pending'"
        ),
        6000
    );
    assert_eq!(
        number(&db, "SELECT blob_reserved_bytes FROM users WHERE id='u'"),
        32
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sync_changes WHERE user_id='other'"
        ),
        1
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM blobs WHERE user_id='other'"),
        1
    );
    assert_eq!(
        number(
            &db,
            "SELECT key_version FROM user_keys WHERE user_id='other'"
        ),
        1
    );
    // An upload reserved before reset may finish writing R2, but its old-epoch commit is refused.
    assert_eq!(
        db.execute(
            crate::sql::COMMIT_BLOB,
            params![
                "old",
                1002,
                "late",
                "u/pending",
                "etag",
                "nonce",
                7,
                16,
                Option::<String>::None
            ]
        )
        .unwrap(),
        0
    );
}

#[test]
fn lost_ack_retry_and_other_review_never_delete_new_generation() {
    let mut db = db();
    assert_eq!(review(&db, "review"), 1);
    assert_eq!(review(&db, "competing"), 1);
    reset(&mut db, "review", "winner", 1001).unwrap();
    db.execute(
        crate::sql::PUSH_RECORD,
        params![
            "fresh", 1002, "chats", "new-chat", "clock", 0, "nonce", "new", 8, 16
        ],
    )
    .unwrap();
    reset(&mut db, "review", "retry", 1003).unwrap();
    reset(&mut db, "competing", "loser", 1003).unwrap();
    assert_eq!(
        number(&db, "SELECT key_version FROM user_keys WHERE user_id='u'"),
        8
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM sync_changes WHERE user_id='u'"),
        1
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sync_reset_reviews WHERE consumed_by='winner' AND request_hash='request-hash'"
        ),
        1
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sync_reset_reviews WHERE consumed_by='retry' OR consumed_by='loser'"
        ),
        0
    );
}

#[test]
fn stale_or_revoked_review_is_inert_at_commit_time() {
    for mutation in [
        "UPDATE sessions SET revoked_at=1001 WHERE token_hash='fresh'",
        "UPDATE sessions SET created_at=0 WHERE token_hash='fresh'",
        "UPDATE sessions SET device_id='old' WHERE token_hash='fresh'",
        "UPDATE sessions SET client_kind='browser' WHERE token_hash='fresh'",
        "UPDATE devices SET revoked_at=1001 WHERE id='new'",
        "UPDATE devices SET approved_at=1001 WHERE id='new'",
        "UPDATE users SET deletion_requested_at=1001 WHERE id='u'",
        "UPDATE sync_reset_reviews SET expires_at=1001",
    ] {
        let mut db = db();
        review(&db, "review");
        db.execute(mutation, []).unwrap();
        reset(&mut db, "review", "operation", 1001).unwrap();
        assert_eq!(
            number(&db, "SELECT key_version FROM user_keys WHERE user_id='u'"),
            7,
            "{mutation}"
        );
        assert_eq!(
            number(&db, "SELECT COUNT(*) FROM sync_changes WHERE user_id='u'"),
            1,
            "{mutation}"
        );
    }
}

#[test]
fn reset_is_atomic_if_a_later_write_fails() {
    let mut db = db();
    review(&db, "review");
    db.execute_batch("CREATE TRIGGER fail_reset BEFORE UPDATE ON devices WHEN NEW.id='new' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(reset(&mut db, "review", "operation", 1001).is_err());
    assert_eq!(
        number(&db, "SELECT key_version FROM user_keys WHERE user_id='u'"),
        7
    );
    assert_eq!(
        number(&db, "SELECT COUNT(*) FROM sync_changes WHERE user_id='u'"),
        1
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sessions WHERE user_id='u' AND revoked_at IS NULL"
        ),
        2
    );
    assert_eq!(
        number(
            &db,
            "SELECT COUNT(*) FROM sync_reset_reviews WHERE consumed_by IS NOT NULL"
        ),
        0
    );
}

#[test]
fn review_requires_pending_desktop_and_recent_email_verification() {
    for mutation in [
        "UPDATE sessions SET created_at=699 WHERE token_hash='fresh'",
        "UPDATE sessions SET created_at=1001 WHERE token_hash='fresh'",
        "UPDATE sessions SET client_kind='browser' WHERE token_hash='fresh'",
        "UPDATE devices SET approved_at=1000 WHERE id='new'",
        "UPDATE devices SET revoked_at=1000 WHERE id='new'",
    ] {
        let db = db();
        db.execute(mutation, []).unwrap();
        assert_eq!(review(&db, "review"), 0, "{mutation}");
    }
}
