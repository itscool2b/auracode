//! Lost-key reset is one atomic, session-bound generation change. Every effect checks the same
//! winning operation token. Replaying a receipt never re-applies deletion to the new generation.
pub const MIGRATION: &str = include_str!("../../../infra/migrations/0004_sync_reset.sql");
pub const REVIEW: &str = "INSERT INTO sync_reset_reviews(id,user_id,session_hash,device_id,key_version,created_at,expires_at)
SELECT ?1,s.user_id,s.token_hash,d.id,k.key_version,?3,?3+300 FROM sessions s
JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
JOIN user_keys k ON k.user_id=s.user_id WHERE s.token_hash=?2 AND s.client_kind='desktop'
AND s.created_at>=?3-300 AND s.created_at<=?3 AND s.expires_at>?3 AND s.revoked_at IS NULL
AND u.deletion_requested_at IS NULL AND d.revoked_at IS NULL AND d.approved_at IS NULL
AND d.created_at>=?3-600 AND k.key_version<1000000";

pub const CONSUME: &str = "UPDATE sync_reset_reviews SET consumed_by=?4,request_hash=?5
WHERE id=?1 AND session_hash=?2 AND consumed_by IS NULL AND expires_at>?3
AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id JOIN user_keys k ON k.user_id=s.user_id
WHERE s.token_hash=?2 AND s.user_id=sync_reset_reviews.user_id
AND s.device_id=sync_reset_reviews.device_id AND k.key_version=sync_reset_reviews.key_version
AND s.client_kind='desktop' AND s.created_at>=?3-300 AND s.created_at<=?3
AND s.expires_at>?3 AND s.revoked_at IS NULL AND u.deletion_requested_at IS NULL
AND d.revoked_at IS NULL AND d.approved_at IS NULL AND d.created_at>=?3-600)";

// Parameters common to all effects: review ID, winning operation. Extra values start at ?3.
pub const KEYS: &str = "UPDATE user_keys SET key_version=key_version+1,recovery_verifier=?3,
recovery_envelope=?4,created_at=?5,initialized_by=(SELECT device_id FROM sync_reset_reviews WHERE id=?1)
WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)";
pub const HEADS: &str = "DELETE FROM sync_heads WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)";
pub const CHANGES: &str = "DELETE FROM sync_changes WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)";
// Keep blob_objects until garbage collection acknowledges R2 deletion. In-flight old uploads keep
// their original collection deadline, and their commit fails after the key generation changes.
pub const BLOBS: &str = "DELETE FROM blobs WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)";
pub const QUOTA: &str = "UPDATE users SET sync_used_bytes=0 WHERE id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)";
pub const DEVICES: &str = "UPDATE devices SET revoked_at=?3,wrapped_key=NULL
WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)
AND id<>(SELECT device_id FROM sync_reset_reviews WHERE id=?1)";
pub const SESSIONS: &str = "UPDATE sessions SET revoked_at=?3
WHERE user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)
AND token_hash<>(SELECT session_hash FROM sync_reset_reviews WHERE id=?1)";
pub const DEVICE: &str = "UPDATE devices SET approved_at=?3,wrapped_key=?4,
key_version=(SELECT key_version+1 FROM sync_reset_reviews WHERE id=?1)
WHERE id=(SELECT device_id FROM sync_reset_reviews WHERE id=?1 AND consumed_by=?2)
AND user_id=(SELECT user_id FROM sync_reset_reviews WHERE id=?1)";

#[cfg(test)]
mod tests;
