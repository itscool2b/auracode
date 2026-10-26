-- Possession of a previously valid token may reveal only that its own account was deleted.
-- No account ID, email or raw token is retained. Receipts expire no later than the session.
CREATE TABLE account_deletion_receipts (
  token_hash TEXT PRIMARY KEY,
  client_kind TEXT NOT NULL CHECK(client_kind IN ('browser','desktop')),
  csrf_hash TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > deleted_at)
);
CREATE INDEX account_deletion_receipts_expiry ON account_deletion_receipts(expires_at);
