//! Deletion and its minimal token receipts share one guarded database transaction.
pub const MIGRATION: &str =
    include_str!("../../../infra/migrations/0005_account_deletion_receipts.sql");

/// The fresh caller and every remembered session must still be valid inside the transaction.
pub const REMEMBER: &str = "INSERT INTO account_deletion_receipts(token_hash,client_kind,csrf_hash,deleted_at,expires_at)
SELECT s.token_hash,s.client_kind,s.csrf_hash,?2,MIN(s.expires_at,?2+2592000)
FROM sessions s JOIN users u ON u.id=s.user_id
LEFT JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
WHERE s.revoked_at IS NULL AND s.expires_at>?2 AND u.deletion_requested_at IS NULL
AND (s.device_id IS NULL OR (d.id IS NOT NULL AND d.revoked_at IS NULL))
AND EXISTS(SELECT 1 FROM sessions caller LEFT JOIN devices cd ON cd.id=caller.device_id AND cd.user_id=caller.user_id
WHERE caller.token_hash=?1 AND caller.user_id=s.user_id AND caller.revoked_at IS NULL
AND caller.expires_at>?2 AND caller.created_at BETWEEN ?2-300 AND ?2
AND (caller.device_id IS NULL OR (cd.id IS NOT NULL AND cd.revoked_at IS NULL)))
ON CONFLICT(token_hash) DO NOTHING";

pub const DELETE: &str = "UPDATE users SET deletion_requested_at=?2
WHERE deletion_requested_at IS NULL AND id=(SELECT user_id FROM sessions WHERE token_hash=?1)
AND EXISTS(SELECT 1 FROM account_deletion_receipts WHERE token_hash=?1 AND deleted_at=?2)";

pub const REVOKE: &str = "UPDATE sessions SET revoked_at=COALESCE(revoked_at,?2)
WHERE user_id=(SELECT user_id FROM sessions WHERE token_hash=?1)
AND EXISTS(SELECT 1 FROM account_deletion_receipts WHERE token_hash=?1 AND deleted_at=?2)";

pub const RECEIPT: &str = "SELECT client_kind,csrf_hash FROM account_deletion_receipts
WHERE token_hash=?1 AND deleted_at<=?2 AND expires_at>?2";

pub const CLEANUP: &str = "DELETE FROM account_deletion_receipts WHERE expires_at<=?1";

#[cfg(test)]
mod tests;
