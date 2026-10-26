//! Account mutations recheck the session in the same D1 transaction as the change.
pub const BEGIN: &str = "INSERT INTO email_changes(id,session_hash,user_id,email,email_key,verifier,created_at,expires_at)
SELECT ?1,s.token_hash,s.user_id,?3,?4,?5,?6,?6+600 FROM sessions s JOIN users u ON u.id=s.user_id
WHERE s.token_hash=?2 AND s.revoked_at IS NULL AND s.expires_at>?6 AND s.created_at>=?6-300
AND u.deletion_requested_at IS NULL AND u.email<>?3
ON CONFLICT(session_hash) DO UPDATE SET id=excluded.id,email=excluded.email,email_key=excluded.email_key,
verifier=excluded.verifier,created_at=excluded.created_at,expires_at=excluded.expires_at,
delivery='pending',attempts=0,consumed_at=NULL,consumed_by=NULL
WHERE email_changes.created_at<=excluded.created_at-60 RETURNING id";
pub const CONSUME: &str = "UPDATE email_changes SET attempts=attempts+1,
consumed_at=CASE WHEN verifier=?3 THEN ?4 ELSE NULL END,
consumed_by=CASE WHEN verifier=?3 THEN ?5 ELSE NULL END
WHERE id=?1 AND session_hash=?2 AND expires_at>?4 AND delivery='sent' AND attempts<5 AND consumed_at IS NULL
AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?2 AND s.user_id=email_changes.user_id
AND s.revoked_at IS NULL AND s.expires_at>?4 AND u.deletion_requested_at IS NULL)";
pub const APPLY: &str = "UPDATE users SET email=c.email,email_key=c.email_key FROM email_changes c
WHERE c.consumed_by=?1 AND users.id=c.user_id
AND NOT EXISTS(SELECT 1 FROM users other WHERE other.email=c.email AND other.id<>users.id)";
pub const REVOKE: &str = "UPDATE sessions SET revoked_at=?2 WHERE token_hash<>?3
AND user_id IN (SELECT c.user_id FROM email_changes c JOIN users u ON u.id=c.user_id AND u.email=c.email WHERE c.consumed_by=?1)";

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, params};
    #[test]
    fn email_proof_is_session_bound_single_use_and_never_merges_accounts() {
        let mut db = Connection::open_in_memory().expect("test database operation");
        db.execute_batch(include_str!(
            "../../../infra/migrations/0001_accounts_sync.sql"
        ))
        .expect("test database operation");
        db.execute_batch(include_str!(
            "../../../infra/migrations/0003_email_changes.sql"
        ))
        .expect("test database operation");
        db.execute_batch("INSERT INTO users(id,email_key,email,created_at) VALUES('a','old','old@test.invalid',1),('b','taken','taken@test.invalid',1);
          INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES('s','a','browser','c',100,1000),('other','a','browser','c',100,1000);").expect("test database operation");
        for (id, email, expected) in [
            ("c1", "taken@test.invalid", "old@test.invalid"),
            ("c2", "new@test.invalid", "new@test.invalid"),
        ] {
            db.query_row(BEGIN, params![id, "s", email, email, "proof", 200], |r| {
                r.get::<_, String>(0)
            })
            .expect("begin change");
            db.execute("UPDATE email_changes SET delivery='sent'", [])
                .expect("test database operation");
            assert_eq!(
                db.execute(CONSUME, params![id, "other", "proof", 201, "wrong-session"])
                    .expect("test database operation"),
                0
            );
            let tx = db.transaction().expect("test database operation");
            tx.execute(CONSUME, params![id, "s", "proof", 201, "claim"])
                .expect("test database operation");
            tx.execute(APPLY, params!["claim"])
                .expect("test database operation");
            tx.execute(REVOKE, params!["claim", 201, "s"])
                .expect("test database operation");
            tx.commit().expect("test database operation");
            assert_eq!(
                db.query_row("SELECT email FROM users WHERE id='a'", [], |r| r
                    .get::<_, String>(0))
                    .expect("test database operation"),
                expected
            );
            assert_eq!(
                db.execute(CONSUME, params![id, "s", "proof", 201, "replay"])
                    .expect("test database operation"),
                0
            );
            db.execute("DELETE FROM email_changes", [])
                .expect("test database operation");
        }
        assert_eq!(
            db.query_row(
                "SELECT revoked_at FROM sessions WHERE token_hash='other'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .expect("test database operation"),
            201
        );
        assert_eq!(
            db.query_row("SELECT email FROM users WHERE id='b'", [], |r| r
                .get::<_, String>(0))
                .expect("test database operation"),
            "taken@test.invalid"
        );
    }
}
