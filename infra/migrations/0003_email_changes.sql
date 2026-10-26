CREATE TABLE email_changes (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'pending' CHECK(delivery IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  consumed_by TEXT
) STRICT;
CREATE INDEX email_changes_expiry ON email_changes(expires_at);
