PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  deletion_requested_at INTEGER,
  cleanup_after INTEGER NOT NULL DEFAULT 0,
  purged_at INTEGER,
  sync_used_bytes INTEGER NOT NULL DEFAULT 0,
  blob_reserved_bytes INTEGER NOT NULL DEFAULT 0,
  sync_limit_bytes INTEGER NOT NULL DEFAULT 104857600,
  blob_limit_bytes INTEGER NOT NULL DEFAULT 1073741824
);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  email_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  verifier TEXT NOT NULL,
  client_kind TEXT NOT NULL CHECK(client_kind IN ('browser','desktop')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  delivery TEXT NOT NULL DEFAULT 'pending' CHECK(delivery IN ('pending','sent','failed')),
  consumed_by TEXT,
  consumed_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_kind TEXT NOT NULL CHECK(client_kind IN ('browser','desktop')),
  csrf_hash TEXT NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_expiry ON rate_limits(expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('windows','macos')),
  public_key TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  approved_at INTEGER,
  revoked_at INTEGER,
  wrapped_key TEXT,
  key_version INTEGER,
  UNIQUE(user_id,id)
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE user_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK(key_version > 0),
  recovery_verifier TEXT NOT NULL,
  recovery_envelope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  initialized_by TEXT NOT NULL
);

CREATE TABLE sync_changes (
  server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK(key_version > 0),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 16),
  UNIQUE(user_id,collection,id,hlc)
);
CREATE INDEX sync_pull ON sync_changes(user_id,server_seq);
CREATE TABLE sync_heads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  server_seq INTEGER NOT NULL REFERENCES sync_changes(server_seq),
  PRIMARY KEY(user_id,collection,id)
);

CREATE TRIGGER sync_quota BEFORE INSERT ON sync_changes BEGIN
  SELECT CASE WHEN NEW.size_bytes > (SELECT sync_limit_bytes-sync_used_bytes FROM users WHERE id=NEW.user_id)
    THEN RAISE(ABORT,'sync_quota') END;
END;
CREATE TRIGGER sync_head AFTER INSERT ON sync_changes BEGIN
  UPDATE users SET sync_used_bytes=sync_used_bytes+NEW.size_bytes WHERE id=NEW.user_id;
  INSERT INTO sync_heads(user_id,collection,id,hlc,server_seq)
    VALUES(NEW.user_id,NEW.collection,NEW.id,NEW.hlc,NEW.server_seq)
    ON CONFLICT(user_id,collection,id) DO UPDATE SET hlc=excluded.hlc,server_seq=excluded.server_seq;
END;

CREATE TABLE blobs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  etag TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,id)
);
-- Every uploaded object remains discoverable for cleanup, including abandoned CAS attempts.
CREATE TABLE blob_objects (
  object_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size_bytes INTEGER NOT NULL,
  collect_after INTEGER NOT NULL
);
CREATE INDEX blob_objects_gc ON blob_objects(collect_after);
CREATE TRIGGER blob_reservation_quota BEFORE INSERT ON blob_objects BEGIN
  SELECT CASE WHEN NEW.size_bytes > (SELECT blob_limit_bytes-blob_reserved_bytes FROM users WHERE id=NEW.user_id)
    THEN RAISE(ABORT,'blob_quota') END;
END;
CREATE TRIGGER blob_reserved AFTER INSERT ON blob_objects BEGIN
  UPDATE users SET blob_reserved_bytes=blob_reserved_bytes+NEW.size_bytes WHERE id=NEW.user_id;
END;
CREATE TRIGGER blob_released AFTER DELETE ON blob_objects BEGIN
  UPDATE users SET blob_reserved_bytes=blob_reserved_bytes-OLD.size_bytes WHERE id=OLD.user_id;
END;
