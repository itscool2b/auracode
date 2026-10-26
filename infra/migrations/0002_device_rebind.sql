CREATE TABLE device_rebind_challenges (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  consumed_by TEXT
);
CREATE INDEX device_rebind_expiry ON device_rebind_challenges(expires_at);
