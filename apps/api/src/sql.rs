//! Queries are shared by the D1 adapter and SQLite concurrency/authorization regressions.
pub const MIGRATION: &str = include_str!("../../../infra/migrations/0001_accounts_sync.sql");

pub const RATE: &str =
    "INSERT INTO rate_limits(key,window_start,count,expires_at) VALUES(?1,?2,1,?3)
ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=?2 THEN count+1 ELSE 1 END,
window_start=?2,expires_at=?3 WHERE window_start<>?2 OR count<?4 RETURNING count";

pub const BEGIN_AUTH: &str = "INSERT INTO auth_challenges(id,email_key,email,verifier,client_kind,created_at,expires_at)
VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(email_key) DO UPDATE SET
id=excluded.id,email=excluded.email,verifier=excluded.verifier,client_kind=excluded.client_kind,
created_at=excluded.created_at,expires_at=excluded.expires_at,attempts=0,delivery='pending',consumed_by=NULL,consumed_at=NULL
WHERE auth_challenges.created_at<=?6-60 RETURNING id";

pub const CONSUME_CODE: &str = "UPDATE auth_challenges SET attempts=attempts+1,
consumed_by=CASE WHEN verifier=?2 THEN ?3 ELSE NULL END,
consumed_at=CASE WHEN verifier=?2 THEN ?4 ELSE NULL END
WHERE id=?1 AND delivery='sent' AND consumed_at IS NULL AND expires_at>?4 AND attempts<5";

pub const CREATE_USER: &str = "INSERT INTO users(id,email_key,email,created_at)
SELECT ?1,email_key,email,?3 FROM auth_challenges WHERE consumed_by=?2
ON CONFLICT(email) DO UPDATE SET email_key=excluded.email_key";

pub const CREATE_SESSION: &str =
    "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at)
SELECT ?1,u.id,c.client_kind,?3,?4,?5 FROM users u JOIN auth_challenges c ON c.email=u.email
WHERE c.consumed_by=?2 AND u.deletion_requested_at IS NULL";

pub const AUTHENTICATE: &str = "SELECT s.user_id,s.client_kind,s.device_id,s.created_at,s.expires_at,s.csrf_hash
FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND u.deletion_requested_at IS NULL
AND (s.device_id IS NULL OR (d.id IS NOT NULL AND d.revoked_at IS NULL))";

pub const REGISTER_DEVICE: &str = "INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen)
SELECT ?1,s.user_id,?3,?4,?5,?6,?7,?7 FROM sessions s JOIN users u ON u.id=s.user_id
WHERE s.token_hash=?2 AND s.client_kind='desktop' AND s.device_id IS NULL AND s.revoked_at IS NULL
AND s.expires_at>?7 AND u.deletion_requested_at IS NULL
AND (SELECT COUNT(*) FROM devices d WHERE d.user_id=s.user_id AND d.revoked_at IS NULL)<32";
pub const BIND_DEVICE: &str =
    "UPDATE sessions SET device_id=?1 WHERE token_hash=?2 AND device_id IS NULL
AND EXISTS(SELECT 1 FROM devices d WHERE d.id=?1 AND d.user_id=sessions.user_id)";

pub const APPROVED: &str = "SELECT d.id FROM sessions s JOIN users u ON u.id=s.user_id
JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND u.deletion_requested_at IS NULL
AND s.client_kind='desktop' AND d.approved_at IS NOT NULL AND d.revoked_at IS NULL";

pub const PUSH_RECORD: &str = "INSERT INTO sync_changes(user_id,collection,id,hlc,device_id,deleted,nonce,ciphertext,key_version,size_bytes)
SELECT s.user_id,?3,?4,?5,s.device_id,?6,?7,?8,?9,?10 FROM sessions s
JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
JOIN user_keys k ON k.user_id=s.user_id AND k.key_version=?9
WHERE s.token_hash=?1 AND s.expires_at>?2 AND s.revoked_at IS NULL AND s.client_kind='desktop'
AND u.deletion_requested_at IS NULL AND d.approved_at IS NOT NULL AND d.revoked_at IS NULL
AND NOT EXISTS(SELECT 1 FROM sync_heads h WHERE h.user_id=s.user_id AND h.collection=?3 AND h.id=?4
AND (h.hlc>=?5 OR ?3='chat_chunks'))";

pub const PULL: &str = "SELECT c.server_seq,c.collection,c.id,c.hlc,c.device_id,c.deleted,c.nonce,c.ciphertext,c.key_version
FROM sync_changes c JOIN sessions s ON s.user_id=c.user_id JOIN users u ON u.id=s.user_id
JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
WHERE s.token_hash=?1 AND s.expires_at>?2 AND s.revoked_at IS NULL AND u.deletion_requested_at IS NULL
AND s.client_kind='desktop' AND d.approved_at IS NOT NULL AND d.revoked_at IS NULL
AND c.server_seq>?3 ORDER BY c.server_seq LIMIT ?4";

pub const INITIALIZE_KEYS: &str = "INSERT INTO user_keys(user_id,key_version,recovery_verifier,recovery_envelope,created_at,initialized_by)
            SELECT s.user_id,1,?3,?4,?2,s.device_id FROM sessions s JOIN users u ON u.id=s.user_id
            JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
            WHERE s.token_hash=?1 AND s.expires_at>?2 AND s.revoked_at IS NULL AND u.deletion_requested_at IS NULL
            AND d.revoked_at IS NULL AND d.approved_at IS NULL AND d.created_at>=?2-600 AND s.client_kind='desktop'
            AND NOT EXISTS(SELECT 1 FROM user_keys k WHERE k.user_id=s.user_id)";

pub const INITIALIZE_DEVICE: &str = "UPDATE devices SET approved_at=?3,key_version=1,wrapped_key=?4 WHERE id=?1 AND user_id=?2 AND approved_at IS NULL
            AND EXISTS(SELECT 1 FROM user_keys k WHERE k.user_id=?2 AND k.initialized_by=?1)";

pub const APPROVE_DEVICE: &str = "UPDATE devices SET approved_at=?3,wrapped_key=?4,key_version=(SELECT key_version FROM user_keys WHERE user_id=?2)
        WHERE id=?1 AND user_id=?2 AND verification_code=?5 AND revoked_at IS NULL AND approved_at IS NULL AND created_at>=?3-600
        AND EXISTS(SELECT 1 FROM sessions s JOIN devices source ON source.id=s.device_id AND source.user_id=s.user_id
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=?6 AND s.user_id=?2 AND s.revoked_at IS NULL AND s.expires_at>?3
        AND u.deletion_requested_at IS NULL AND source.approved_at IS NOT NULL AND source.revoked_at IS NULL) RETURNING id";

pub const RECOVER_DEVICE: &str = "UPDATE devices SET approved_at=?3,wrapped_key=?4,key_version=(SELECT key_version FROM user_keys WHERE user_id=?2)
        WHERE id=?1 AND user_id=?2 AND revoked_at IS NULL AND approved_at IS NULL AND created_at>=?3-600
        AND EXISTS(SELECT 1 FROM user_keys k WHERE k.user_id=?2 AND k.recovery_verifier=?5)
        AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?6 AND s.device_id=?1
        AND s.revoked_at IS NULL AND s.expires_at>?3 AND u.deletion_requested_at IS NULL) RETURNING id";

pub const RESERVE_BLOB: &str = "INSERT INTO blob_objects(object_key,user_id,size_bytes,collect_after)
        SELECT ?3,s.user_id,?4,?2+3600 FROM sessions s JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
        JOIN users u ON u.id=s.user_id JOIN user_keys k ON k.user_id=s.user_id
        WHERE s.token_hash=?1 AND s.expires_at>?2 AND s.revoked_at IS NULL AND u.deletion_requested_at IS NULL
        AND d.revoked_at IS NULL AND d.approved_at IS NOT NULL AND s.client_kind='desktop' AND k.key_version=?5
        AND u.blob_reserved_bytes+?4<=u.blob_limit_bytes RETURNING object_key";

pub const COMMIT_BLOB: &str = "INSERT INTO blobs(user_id,id,object_key,etag,nonce,key_version,size_bytes,updated_at)
        SELECT s.user_id,?3,?4,?5,?6,?7,?8,?2 FROM sessions s JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
        JOIN users u ON u.id=s.user_id JOIN user_keys k ON k.user_id=s.user_id AND k.key_version=?7
        JOIN blob_objects o ON o.object_key=?4 AND o.user_id=s.user_id AND o.collect_after>?2
        WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2
        AND u.deletion_requested_at IS NULL AND d.approved_at IS NOT NULL AND d.revoked_at IS NULL
        AND ((?9 IS NULL AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.user_id=s.user_id AND b.id=?3))
        OR EXISTS(SELECT 1 FROM blobs b WHERE b.user_id=s.user_id AND b.id=?3 AND b.etag=?9))
        ON CONFLICT(user_id,id) DO UPDATE SET object_key=excluded.object_key,etag=excluded.etag,nonce=excluded.nonce,
        key_version=excluded.key_version,size_bytes=excluded.size_bytes,updated_at=excluded.updated_at WHERE blobs.etag=?9 RETURNING etag";

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, params};

    fn db() -> Connection {
        let db = Connection::open_in_memory().expect("db");
        db.execute_batch(MIGRATION).expect("migration");
        db
    }
    fn challenge(db: &Connection) {
        returned(
            db,
            BEGIN_AUTH,
            params![
                "challenge",
                "email-key",
                "person@example.invalid",
                "correct",
                "desktop",
                100,
                700
            ],
        )
        .expect("challenge");
        db.execute("UPDATE auth_challenges SET delivery='sent'", [])
            .expect("sent");
    }
    fn returned(
        db: &Connection,
        sql: &str,
        args: impl rusqlite::Params,
    ) -> rusqlite::Result<usize> {
        let mut statement = db.prepare(sql)?;
        let mut rows = statement.query(args)?;
        let mut count = 0;
        while rows.next()?.is_some() {
            count += 1;
        }
        Ok(count)
    }
    fn sign_in(db: &mut Connection, code: &str, token: &str, now: i64) {
        let tx = db.transaction().expect("transaction");
        tx.execute(CONSUME_CODE, params!["challenge", code, token, now])
            .expect("consume");
        tx.execute(CREATE_USER, params!["user", token, now])
            .expect("user");
        tx.execute(
            CREATE_SESSION,
            params![token, token, "csrf", now, now + 1000],
        )
        .expect("session");
        tx.commit().expect("commit");
    }
    fn count(db: &Connection, table: &str) -> i64 {
        db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
    }
    fn approved(db: &mut Connection) {
        challenge(db);
        sign_in(db, "correct", "token", 110);
        let tx = db.transaction().expect("tx");
        tx.execute(
            REGISTER_DEVICE,
            params![
                "device", "token", "My PC", "windows", "public", "123456", 110
            ],
        )
        .expect("device");
        tx.execute(BIND_DEVICE, params!["device", "token"])
            .expect("binding");
        tx.commit().expect("commit");
        db.execute("UPDATE devices SET approved_at=110", [])
            .expect("approved");
        db.execute(
            "INSERT INTO user_keys VALUES('user',1,'recovery','envelope',110,'device')",
            [],
        )
        .expect("keys");
    }
    fn push(db: &Connection, token: &str, collection: &str, hlc: &str, text: &str) -> usize {
        db.execute(
            PUSH_RECORD,
            params![token, 120, collection, "item", hlc, 0, "nonce", text, 1, 16],
        )
        .expect("push")
    }

    #[test]
    fn successful_code_is_consumed_exactly_once_and_wrong_code_creates_nothing() {
        let mut db = db();
        challenge(&db);
        sign_in(&mut db, "wrong", "first", 110);
        assert_eq!(count(&db, "sessions"), 0);
        sign_in(&mut db, "correct", "winner", 111);
        assert_eq!(count(&db, "sessions"), 1);
        sign_in(&mut db, "correct", "loser", 112);
        assert_eq!(count(&db, "sessions"), 1);
        assert_eq!(count(&db, "users"), 1);
    }
    #[test]
    fn attempt_limit_expiry_and_failed_delivery_never_authenticate() {
        for mode in ["attempts", "expired", "delivery"] {
            let mut db = db();
            challenge(&db);
            if mode == "attempts" {
                for attempt in 0..5 {
                    sign_in(&mut db, "bad", &attempt.to_string(), 110);
                }
            }
            if mode == "delivery" {
                db.execute("UPDATE auth_challenges SET delivery='failed'", [])
                    .expect("failed");
            }
            sign_in(
                &mut db,
                "correct",
                "token",
                if mode == "expired" { 700 } else { 110 },
            );
            assert_eq!(count(&db, "sessions"), 0, "{mode}");
        }
    }
    #[test]
    fn resend_has_a_cooldown_and_invalidates_the_old_identifier() {
        let db = db();
        challenge(&db);
        let resend = |now| {
            returned(
                &db,
                BEGIN_AUTH,
                params![
                    "new",
                    "email-key",
                    "person@example.invalid",
                    "new-code",
                    "desktop",
                    now,
                    now + 600
                ],
            )
        };
        assert_eq!(resend(159).expect("cooldown"), 0);
        assert_eq!(resend(160).expect("resend"), 1);
        assert_eq!(
            db.query_row("SELECT id FROM auth_challenges", [], |r| r
                .get::<_, String>(0))
                .expect("id"),
            "new"
        );
    }
    #[test]
    fn rate_counter_is_atomic_and_does_not_extend_its_window() {
        let db = db();
        for _ in 0..5 {
            assert_eq!(
                returned(&db, RATE, params!["email", 100, 160, 5]).expect("rate"),
                1
            );
        }
        assert_eq!(
            returned(&db, RATE, params!["email", 100, 160, 5]).expect("limit"),
            0
        );
        assert_eq!(
            returned(&db, RATE, params!["email", 160, 220, 5]).expect("next window"),
            1
        );
    }
    #[test]
    fn device_registration_is_bound_to_the_session_and_cannot_rebind() {
        let mut db = db();
        approved(&mut db);
        assert_eq!(
            db.execute(
                REGISTER_DEVICE,
                params!["other", "token", "PC", "windows", "public", "123456", 120]
            )
            .expect("register"),
            0
        );
        assert_eq!(
            db.execute(BIND_DEVICE, params!["other", "token"])
                .expect("bind"),
            0
        );
        db.execute("UPDATE devices SET revoked_at=120", [])
            .expect("revoke");
        assert!(
            db.prepare(AUTHENTICATE)
                .expect("stmt")
                .query(params!["token", 120])
                .expect("query")
                .next()
                .expect("row")
                .is_none()
        );
    }
    #[test]
    fn records_are_conditional_and_chunks_append_only_with_monotonic_cursors() {
        let mut db = db();
        approved(&mut db);
        assert_eq!(push(&db, "token", "chats", "001", "first"), 1);
        assert_eq!(push(&db, "token", "chats", "001", "duplicate"), 0);
        assert_eq!(push(&db, "token", "chats", "000", "older"), 0);
        assert_eq!(push(&db, "token", "chats", "002", "newer"), 1);
        assert_eq!(push(&db, "token", "chat_chunks", "003", "chunk"), 1);
        assert_eq!(push(&db, "token", "chat_chunks", "004", "rewrite"), 0);
        let mut statement = db.prepare(PULL).expect("stmt");
        let rows = statement
            .query_map(params!["token", 120, 0, 100], |row| row.get::<_, i64>(0))
            .expect("rows")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect");
        assert_eq!(rows.len(), 3);
        assert!(rows.windows(2).all(|pair| pair[0] < pair[1]));
    }
    #[test]
    fn revocation_and_account_deletion_block_writes_inside_the_write_statement() {
        for mutation in [
            "UPDATE sessions SET revoked_at=119",
            "UPDATE devices SET revoked_at=119",
            "UPDATE users SET deletion_requested_at=119",
        ] {
            let mut db = db();
            approved(&mut db);
            db.execute(mutation, []).expect("revoke");
            assert_eq!(push(&db, "token", "chats", "001", "ciphertext"), 0);
        }
    }
    #[test]
    fn quota_failure_rolls_back_the_batch_and_leaves_the_cursor_unchanged() {
        let mut db = db();
        approved(&mut db);
        db.execute("UPDATE users SET sync_limit_bytes=16", [])
            .expect("quota");
        {
            let tx = db.transaction().expect("tx");
            assert_eq!(push(&tx, "token", "chats", "001", "first"), 1);
            assert!(
                tx.execute(
                    PUSH_RECORD,
                    params![
                        "token", 120, "chats", "item", "002", 0, "nonce", "second", 1, 16
                    ]
                )
                .is_err()
            );
        }
        assert_eq!(count(&db, "sync_changes"), 0);
        assert_eq!(count(&db, "sync_heads"), 0);
    }

    fn pending(db: &Connection, token: &str, device: &str, now: i64) {
        db.execute("INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES(?1,'user','desktop','csrf',?2,?2+10000)",params![token,now]).expect("session");
        db.execute(
            REGISTER_DEVICE,
            params![device, token, "Pending", "macos", "public", "123456", now],
        )
        .expect("register");
        db.execute(BIND_DEVICE, params![device, token])
            .expect("bind");
    }

    #[test]
    fn only_the_winning_initial_device_can_bootstrap_an_account() {
        let mut db = db();
        approved(&mut db);
        db.execute("DELETE FROM user_keys", []).expect("reset");
        db.execute("UPDATE devices SET approved_at=NULL", [])
            .expect("pending");
        pending(&db, "second", "second-device", 120);
        for (token, device) in [("token", "device"), ("second", "second-device")] {
            let tx = db.transaction().expect("tx");
            tx.execute(INITIALIZE_KEYS, params![token, 130, "recovery", "envelope"])
                .expect("keys");
            tx.execute(INITIALIZE_DEVICE, params![device, "user", 130, "wrapped"])
                .expect("approve");
            tx.commit().expect("commit");
        }
        let approved: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM devices WHERE approved_at IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(approved, 1);
        assert_eq!(
            db.query_row("SELECT initialized_by FROM user_keys", [], |r| r
                .get::<_, String>(0))
                .expect("winner"),
            "device"
        );
    }

    #[test]
    fn device_approval_checks_code_expiry_source_revocation_and_account() {
        for failure in ["code", "expired", "revoked", "account", "valid"] {
            let mut db = db();
            approved(&mut db);
            pending(&db, "second", "second-device", 120);
            if failure == "revoked" {
                db.execute("UPDATE devices SET revoked_at=121 WHERE id='device'", [])
                    .expect("revoke");
            }
            let changed = returned(
                &db,
                APPROVE_DEVICE,
                params![
                    "second-device",
                    if failure == "account" {
                        "another"
                    } else {
                        "user"
                    },
                    if failure == "expired" { 721 } else { 130 },
                    "wrapped",
                    if failure == "code" { "wrong" } else { "123456" },
                    "token"
                ],
            )
            .expect("approve");
            assert_eq!(changed, usize::from(failure == "valid"), "{failure}");
        }
    }

    #[test]
    fn recovery_is_bound_to_the_pending_session_and_cannot_revive_a_revoked_device() {
        for failure in ["proof", "session", "expired", "revoked", "valid"] {
            let mut db = db();
            approved(&mut db);
            pending(&db, "second", "second-device", 120);
            if failure == "revoked" {
                db.execute(
                    "UPDATE devices SET revoked_at=121 WHERE id='second-device'",
                    [],
                )
                .expect("revoke");
            }
            let changed = returned(
                &db,
                RECOVER_DEVICE,
                params![
                    "second-device",
                    "user",
                    if failure == "expired" { 721 } else { 130 },
                    "wrapped",
                    if failure == "proof" {
                        "wrong"
                    } else {
                        "recovery"
                    },
                    if failure == "session" {
                        "token"
                    } else {
                        "second"
                    }
                ],
            )
            .expect("recover");
            assert_eq!(changed, usize::from(failure == "valid"), "{failure}");
        }
    }

    fn reserve(db: &Connection, key: &str) -> usize {
        returned(db, RESERVE_BLOB, params!["token", 120, key, 16, 1]).expect("reserve")
    }
    fn commit_blob(db: &Connection, key: &str, etag: &str, expected: Option<&str>) -> usize {
        returned(
            db,
            COMMIT_BLOB,
            params!["token", 121, "blob", key, etag, "nonce", 1, 16, expected],
        )
        .expect("commit blob")
    }
    #[test]
    fn blob_cas_never_overwrites_a_concurrent_winner_and_requires_its_reservation() {
        let mut db = db();
        approved(&mut db);
        assert_eq!(commit_blob(&db, "unreserved", "a", None), 0);
        assert_eq!(reserve(&db, "first"), 1);
        assert_eq!(reserve(&db, "second"), 1);
        assert_eq!(commit_blob(&db, "first", "a", None), 1);
        assert_eq!(commit_blob(&db, "second", "b", None), 0);
        assert_eq!(commit_blob(&db, "second", "b", Some("stale")), 0);
        assert_eq!(commit_blob(&db, "second", "b", Some("a")), 1);
        assert_eq!(
            db.query_row("SELECT object_key FROM blobs", [], |r| r
                .get::<_, String>(0))
                .expect("key"),
            "second"
        );
        assert_eq!(
            count(&db, "blob_objects"),
            2,
            "losing and old objects remain discoverable"
        );
    }
    #[test]
    fn abandoned_uploads_consume_quota_until_cleanup_confirms_deletion() {
        let mut db = db();
        approved(&mut db);
        db.execute("UPDATE users SET blob_limit_bytes=16", [])
            .expect("quota");
        assert_eq!(reserve(&db, "abandoned"), 1);
        assert_eq!(reserve(&db, "next"), 0);
        db.execute("DELETE FROM blob_objects WHERE object_key='abandoned'", [])
            .expect("confirmed delete");
        assert_eq!(reserve(&db, "next"), 1);
        db.execute("UPDATE sessions SET revoked_at=120", [])
            .expect("revoked during upload");
        assert_eq!(commit_blob(&db, "next", "etag", None), 0);
    }
    #[test]
    fn an_auth_hmac_rotation_preserves_the_existing_account_identity() {
        let mut db = db();
        challenge(&db);
        sign_in(&mut db, "correct", "first", 110);
        db.execute("UPDATE auth_challenges SET email_key='rotated',consumed_at=NULL,consumed_by=NULL,verifier='new'",[]).expect("rotate verifier");
        sign_in(&mut db, "new", "second", 120);
        assert_eq!(count(&db, "users"), 1);
        assert_eq!(count(&db, "sessions"), 2);
        assert_eq!(
            db.query_row(
                "SELECT user_id FROM sessions WHERE token_hash='second'",
                [],
                |r| r.get::<_, String>(0)
            )
            .expect("identity"),
            "user"
        );
    }

    #[test]
    fn another_account_cannot_pull_existing_transcript_changes() {
        let mut db = db();
        approved(&mut db);
        push(&db, "token", "chats", "001", "ciphertext");
        db.execute("INSERT INTO users(id,email_key,email,created_at) VALUES('other','other','other@example.invalid',100)",[]).expect("other account");
        db.execute("INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,device_id,created_at,expires_at) VALUES('other','other','desktop','csrf','other-device',100,1000)",[]).expect("session");
        db.execute("INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen,approved_at) VALUES('other-device','other','PC','windows','key','123456',100,100,100)",[]).expect("device");
        let mut statement = db.prepare(PULL).expect("stmt");
        assert!(
            statement
                .query(params!["other", 120, 0, 32])
                .expect("query")
                .next()
                .expect("row")
                .is_none()
        );
    }
}
