-- A reset requires a fresh email-verified session, a pending desktop device and explicit review.
-- The receipt survives retries so a lost response cannot clear a newly started sync generation.
CREATE TABLE sync_reset_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK(key_version BETWEEN 1 AND 999999),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT,
  request_hash TEXT
);
CREATE INDEX sync_reset_expiry ON sync_reset_reviews(expires_at);
