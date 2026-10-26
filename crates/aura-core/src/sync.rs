//! Transaction-bound sync persistence. Call from the profile's sole writer. Network requests happen
//! outside these transactions; projections and their clocks/outbox/cursors commit together.
use aura_sync::{
    clock::{Clock, ClockError, Hlc},
    crypto::{self, AccountKey, RecordContext, SealedPayload},
    merge::{self, DecodedMetadata, Metadata, Stamped},
    wire::{Change, EncryptedRecord, Pull},
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::{BTreeMap, HashSet};

use crate::store::Store;
pub(crate) mod capture;
pub(crate) mod config;
pub mod engine;
pub mod exchange;
pub mod journal;
mod projection;

/// An unlocked Account writer's identity and encryption authority. Never exported through IPC.
#[derive(Clone)]
pub struct SyncContext {
    pub identity: SyncIdentity,
    pub key: std::sync::Arc<AccountKey>,
}
impl SyncContext {
    pub(crate) fn initialize(&self, store: &mut Store) -> Result<()> {
        let _ = SyncLedger::new(store, self.identity.clone(), &self.key)?;
        capture::install(store.conn())?;
        // Existing encrypted profiles may predate writer integration. Seed bounded transactions;
        // this reads portable metadata rows only, never the transcript or native credential files.
        loop {
            let tx = store
                .conn_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let captured = capture::pending(&tx, self, crate::time::now_millis().max(0) as u64)?;
            tx.commit()?;
            if captured < capture::BATCH {
                break;
            }
        }
        Ok(())
    }
}

const MAX_CURSOR: u64 = (1 << 53) - 1;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("The account profile is closed or its sync writer is unavailable.")]
    Unavailable,
    #[error(
        "The sync state could not be saved. Its previous cursor and outgoing edits are retained."
    )]
    Database,
    #[error(
        "The sync state could not be saved. Its previous cursor and outgoing edits are retained."
    )]
    Sqlite(i32),
    #[error("Sync requires the matching unlocked account profile and device identity.")]
    Identity,
    #[error("The sync response contains invalid or inconsistent records.")]
    Invalid,
    #[error("This item requires a newer app before it can be edited or synced.")]
    Deferred,
    #[error(transparent)]
    Crypto(#[from] crypto::CryptoError),
    #[error(transparent)]
    Clock(#[from] ClockError),
    #[error(transparent)]
    Merge(#[from] merge::MergeError),
}
impl From<rusqlite::Error> for SyncError {
    fn from(error: rusqlite::Error) -> Self {
        error
            .sqlite_error()
            .map_or(Self::Database, |error| Self::Sqlite(error.extended_code))
    }
}
pub type Result<T> = std::result::Result<T, SyncError>;

#[derive(Debug, Clone)]
pub struct SyncIdentity {
    pub account: String,
    pub device: String,
    pub key_version: u32,
}

/// Owns no network connection and emits no logs or plaintext files. The profile's writer constructs
/// this temporary borrow around each operation; the account key stays in the Rust backend.
pub struct SyncLedger<'a> {
    conn: &'a mut Connection,
    identity: SyncIdentity,
    key: &'a AccountKey,
}

impl<'a> SyncLedger<'a> {
    pub fn new(store: &'a mut Store, identity: SyncIdentity, key: &'a AccountKey) -> Result<Self> {
        if !store.is_encrypted() {
            return Err(SyncError::Identity);
        }
        let initial = Clock::new(&identity.device)?;
        let fingerprint = key.fingerprint(&identity.account, identity.key_version)?;
        let conn = store.conn_mut();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT OR IGNORE INTO sync_state(singleton,account_id,device_id,key_version,key_fingerprint,last_hlc) VALUES(1,?1,?2,?3,?4,?5)",
            params![identity.account, identity.device, identity.key_version, fingerprint, initial.last().to_string()])?;
        let matches = tx.query_row("SELECT account_id=?1 AND device_id=?2 AND key_version=?3 AND key_fingerprint=?4 FROM sync_state WHERE singleton=1",
            params![identity.account, identity.device, identity.key_version, fingerprint], |row| row.get::<_, bool>(0))?;
        if !matches {
            return Err(SyncError::Identity);
        }
        tx.commit()?;
        Ok(Self {
            conn,
            identity,
            key,
        })
    }

    pub fn cursor(&self) -> Result<u64> {
        cursor(self.conn)
    }
    pub fn accept_workspace_pull(&mut self, page: &Pull, now_ms: u64) -> Result<()> {
        self.accept_pull(page, now_ms, projection::queue)
    }
    pub fn accept_workspace_heads(
        &mut self,
        sent: &[EncryptedRecord],
        heads: &[Change],
        now_ms: u64,
    ) -> Result<()> {
        self.accept_heads(sent, heads, now_ms, projection::queue)
    }

    /// Coalesced unsent heads, with a fixed wire batch bound. Unsupported items stay durable but are
    /// excluded until their newer schema can be processed. Never delete merely because HTTP sent.
    pub fn outgoing(&self) -> Result<Vec<EncryptedRecord>> {
        outgoing(self.conn)
    }

    /// The callback updates the application's projection inside this same transaction. An error or
    /// panic rolls back its rows, clock and outbox together. The callback must not perform file IO.
    pub fn edit_metadata(
        &mut self,
        collection: &str,
        id: &str,
        now_ms: u64,
        edit: impl FnOnce(&Transaction<'_>, &mut Metadata, &Hlc) -> Result<()>,
    ) -> Result<Metadata> {
        if !matches!(collection, "projects" | "chats") {
            return Err(SyncError::Invalid);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if deferred(&tx, collection, id)? {
            return Err(SyncError::Deferred);
        }
        let mut clock = load_clock(&tx, &self.identity)?;
        let next = clock.tick(now_ms)?;
        let existing = head(&tx, collection, id)?;
        let mut metadata = match existing {
            Some(record) => match open(&self.identity, self.key, &record, now_ms)? {
                DecodedMetadata::Known(metadata) => metadata,
                DecodedMetadata::Future { .. } => return Err(SyncError::Deferred),
            },
            None => Metadata {
                schema_version: 1,
                live: Stamped {
                    clock: next.clone(),
                    value: true,
                },
                fields: BTreeMap::new(),
            },
        };
        let before = metadata.clone();
        edit(&tx, &mut metadata, &next)?;
        validate_local_change(&before, &metadata, &next)?;
        metadata.validate_clocks(&next, now_ms)?;
        let record = seal(&self.identity, self.key, collection, id, &next, &metadata)?;
        save_head(&tx, &record)?;
        enqueue(&tx, &record)?;
        save_clock(&tx, &clock)?;
        tx.commit()?;
        Ok(metadata)
    }

    /// Validates every AEAD/context and projects known metadata before advancing the cursor. A bad
    /// final record rolls back the entire page, including any earlier callback's writes.
    pub fn accept_pull(
        &mut self,
        page: &Pull,
        now_ms: u64,
        mut project: impl FnMut(&Transaction<'_>, &EncryptedRecord, &Metadata) -> Result<()>,
    ) -> Result<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let before = cursor(&tx)?;
        validate_page(page, before)?;
        let mut clock = load_clock(&tx, &self.identity)?;
        for change in &page.records {
            accept(
                &tx,
                &self.identity,
                self.key,
                &mut clock,
                change,
                now_ms,
                &mut project,
            )?;
        }
        projection::drain(&tx, &self.identity, self.key, now_ms)?;
        save_clock(&tx, &clock)?;
        tx.execute(
            "UPDATE sync_state SET pull_cursor=?1 WHERE singleton=1",
            [i64::try_from(page.next_cursor).map_err(|_| SyncError::Invalid)?],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Push replies contain authoritative heads, not a blanket acknowledgement. Merge them against
    /// the current local edit, which may have changed while the request was in flight. Pull progress
    /// is not advanced because unrelated remote changes have not been downloaded yet.
    pub fn accept_heads(
        &mut self,
        sent: &[EncryptedRecord],
        heads: &[Change],
        now_ms: u64,
        mut project: impl FnMut(&Transaction<'_>, &EncryptedRecord, &Metadata) -> Result<()>,
    ) -> Result<()> {
        if sent.is_empty() || sent.len() > 32 || sent.len() != heads.len() {
            return Err(SyncError::Invalid);
        }
        let expected: HashSet<_> = sent.iter().map(|r| (&r.collection, &r.id)).collect();
        let received: HashSet<_> = heads
            .iter()
            .map(|r| (&r.record.collection, &r.record.id))
            .collect();
        if expected.len() != sent.len() || expected != received {
            return Err(SyncError::Invalid);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut clock = load_clock(&tx, &self.identity)?;
        for change in heads {
            accept(
                &tx,
                &self.identity,
                self.key,
                &mut clock,
                change,
                now_ms,
                &mut project,
            )?;
        }
        projection::drain(&tx, &self.identity, self.key, now_ms)?;
        save_clock(&tx, &clock)?;
        tx.commit()?;
        Ok(())
    }

    /// Bounded retained revisions for a later codec upgrade. Reading does not clear their guards.
    pub fn deferred_records(&self, after_rowid: i64) -> Result<Vec<(i64, EncryptedRecord)>> {
        let mut query = self.conn.prepare(
            "SELECT rowid,record_json FROM sync_deferred WHERE rowid>?1 ORDER BY rowid LIMIT 32",
        )?;
        query
            .query_map([after_rowid], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .map(|row| {
                let (id, json) = row?;
                Ok((id, decode_record(&json)?))
            })
            .collect()
    }
}

fn outgoing(conn: &Connection) -> Result<Vec<EncryptedRecord>> {
    let mut query = conn.prepare("SELECT o.record_json FROM sync_outbox o WHERE NOT EXISTS(SELECT 1 FROM sync_deferred d WHERE d.collection=o.collection AND d.id=o.id) AND (o.collection<>'config' OR EXISTS(SELECT 1 FROM sync_blob_refs r JOIN sync_blobs b ON b.id=r.blob_id WHERE r.collection=o.collection AND r.id=o.id AND b.uploaded=1)) ORDER BY o.hlc,o.collection,o.id LIMIT 32")?;
    query
        .query_map([], |row| row.get::<_, String>(0))?
        .map(|row| decode_record(&row?))
        .collect()
}

fn cursor(conn: &Connection) -> Result<u64> {
    let cursor: i64 = conn.query_row(
        "SELECT pull_cursor FROM sync_state WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    let cursor = u64::try_from(cursor).map_err(|_| SyncError::Invalid)?;
    if cursor > MAX_CURSOR {
        return Err(SyncError::Invalid);
    }
    Ok(cursor)
}

fn validate_local_change(before: &Metadata, after: &Metadata, next: &Hlc) -> Result<()> {
    if (before.live != after.live && after.live.clock != *next)
        || before
            .fields
            .keys()
            .any(|key| !after.fields.contains_key(key))
        || after
            .fields
            .iter()
            .any(|(key, field)| before.fields.get(key) != Some(field) && field.clock != *next)
    {
        return Err(SyncError::Invalid);
    }
    Ok(())
}
fn load_clock(conn: &Connection, identity: &SyncIdentity) -> Result<Clock> {
    let hlc: String = conn.query_row(
        "SELECT last_hlc FROM sync_state WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    Ok(Clock::restore(&identity.device, hlc.parse()?)?)
}
fn save_clock(conn: &Connection, clock: &Clock) -> Result<()> {
    conn.execute(
        "UPDATE sync_state SET last_hlc=?1 WHERE singleton=1",
        [clock.last().to_string()],
    )?;
    Ok(())
}
fn validate_page(page: &Pull, before: u64) -> Result<()> {
    if page.records.len() > 32
        || page.next_cursor > MAX_CURSOR
        || (page.has_more && page.records.len() != 32)
    {
        return Err(SyncError::Invalid);
    }
    let mut cursor = before;
    for change in &page.records {
        if change.server_seq <= cursor || change.server_seq > MAX_CURSOR {
            return Err(SyncError::Invalid);
        }
        cursor = change.server_seq;
    }
    if cursor != page.next_cursor {
        return Err(SyncError::Invalid);
    }
    Ok(())
}
fn decode_record(json: &str) -> Result<EncryptedRecord> {
    if json.len() > 100_000 {
        return Err(SyncError::Invalid);
    }
    serde_json::from_str(json).map_err(|_| SyncError::Invalid)
}
fn head(conn: &Connection, collection: &str, id: &str) -> Result<Option<EncryptedRecord>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT record_json FROM sync_heads WHERE collection=?1 AND id=?2",
            params![collection, id],
            |r| r.get(0),
        )
        .optional()?;
    json.map(|s| decode_record(&s)).transpose()
}
fn deferred(conn: &Connection, collection: &str, id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_deferred WHERE collection=?1 AND id=?2)",
        params![collection, id],
        |r| r.get(0),
    )?)
}
fn context<'a>(identity: &'a SyncIdentity, record: &'a EncryptedRecord) -> RecordContext<'a> {
    RecordContext {
        account: &identity.account,
        collection: &record.collection,
        id: &record.id,
        key_version: record.key_version,
        hlc: &record.hlc,
        deleted: record.deleted,
    }
}
fn open(
    identity: &SyncIdentity,
    key: &AccountKey,
    record: &EncryptedRecord,
    now: u64,
) -> Result<DecodedMetadata> {
    if record.key_version != identity.key_version {
        return Err(SyncError::Identity);
    }
    let clock: Hlc = record.hlc.parse()?;
    clock.validate_time(now)?;
    let plain = crypto::open_record(
        key,
        &context(identity, record),
        &SealedPayload {
            nonce: record.nonce.clone(),
            ciphertext: record.ciphertext.clone(),
        },
    )?;
    let decoded = merge::decode_metadata(&plain)?;
    if let DecodedMetadata::Known(metadata) = &decoded {
        metadata.validate_clocks(&clock, now)?;
        if metadata.deleted() != record.deleted {
            return Err(SyncError::Invalid);
        }
    }
    Ok(decoded)
}
fn seal(
    identity: &SyncIdentity,
    key: &AccountKey,
    collection: &str,
    id: &str,
    clock: &Hlc,
    metadata: &Metadata,
) -> Result<EncryptedRecord> {
    let mut record = EncryptedRecord {
        collection: collection.into(),
        id: id.into(),
        hlc: clock.to_string(),
        deleted: metadata.deleted(),
        nonce: String::new(),
        ciphertext: String::new(),
        key_version: identity.key_version,
    };
    let plain =
        zeroize::Zeroizing::new(serde_json::to_vec(metadata).map_err(|_| SyncError::Invalid)?);
    let sealed = crypto::seal_record(key, &context(identity, &record), &plain)?;
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    Ok(record)
}
fn save_head(conn: &Connection, record: &EncryptedRecord) -> Result<()> {
    let json = serde_json::to_string(record).map_err(|_| SyncError::Invalid)?;
    conn.execute("INSERT INTO sync_heads(collection,id,record_json) VALUES(?1,?2,?3) ON CONFLICT(collection,id) DO UPDATE SET record_json=excluded.record_json",params![record.collection,record.id,json])?;
    Ok(())
}
fn enqueue(conn: &Connection, record: &EncryptedRecord) -> Result<()> {
    let json = serde_json::to_string(record).map_err(|_| SyncError::Invalid)?;
    conn.execute("INSERT INTO sync_outbox(collection,id,hlc,record_json) VALUES(?1,?2,?3,?4) ON CONFLICT(collection,id) DO UPDATE SET hlc=excluded.hlc,record_json=excluded.record_json",params![record.collection,record.id,record.hlc,json])?;
    Ok(())
}
fn retain(conn: &Connection, change: &Change, reason: &str) -> Result<()> {
    let record = &change.record;
    let json = serde_json::to_string(record).map_err(|_| SyncError::Invalid)?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT record_json FROM sync_deferred WHERE collection=?1 AND id=?2 AND hlc=?3",
            params![record.collection, record.id, record.hlc],
            |r| r.get(0),
        )
        .optional()?;
    if existing.as_ref().is_some_and(|s| s != &json) {
        return Err(merge::MergeError::ClockCollision.into());
    }
    let sequence = i64::try_from(change.server_seq).map_err(|_| SyncError::Invalid)?;
    conn.execute("INSERT OR IGNORE INTO sync_deferred(collection,id,hlc,server_seq,reason,record_json) VALUES(?1,?2,?3,?4,?5,?6)",params![record.collection,record.id,record.hlc,sequence,reason,json])?;
    Ok(())
}
fn accept(
    tx: &Transaction<'_>,
    identity: &SyncIdentity,
    key: &AccountKey,
    clock: &mut Clock,
    change: &Change,
    now: u64,
    project: &mut impl FnMut(&Transaction<'_>, &EncryptedRecord, &Metadata) -> Result<()>,
) -> Result<()> {
    let remote = &change.record;
    let remote_clock: Hlc = remote.hlc.parse()?;
    if remote_clock.device() != change.device_id
        || change.server_seq == 0
        || change.server_seq > MAX_CURSOR
    {
        return Err(SyncError::Invalid);
    }
    clock.observe(&remote_clock, now)?;
    if remote.collection == "config" {
        return config::accept_remote(tx, identity, key, change);
    }
    if !matches!(remote.collection.as_str(), "projects" | "chats") {
        if remote.key_version != identity.key_version {
            return Err(SyncError::Identity);
        }
        crypto::open_record(
            key,
            &context(identity, remote),
            &SealedPayload {
                nonce: remote.nonce.clone(),
                ciphertext: remote.ciphertext.clone(),
            },
        )?;
        return retain(tx, change, "collection_codec");
    }
    let metadata = match open(identity, key, remote, now)? {
        DecodedMetadata::Known(m) => m,
        DecodedMetadata::Future { .. } => return retain(tx, change, "future_schema"),
    };
    if deferred(tx, &remote.collection, &remote.id)? {
        return retain(tx, change, "blocked_by_future_schema");
    }
    let local = head(tx, &remote.collection, &remote.id)?;
    let merged = match &local {
        Some(record) => match open(identity, key, record, now)? {
            DecodedMetadata::Known(local) => merge::metadata(&local, &metadata)?,
            DecodedMetadata::Future { .. } => return Err(SyncError::Deferred),
        },
        None => metadata.clone(),
    };
    let accepted = if merged == metadata {
        tx.execute(
            "DELETE FROM sync_outbox WHERE collection=?1 AND id=?2",
            params![remote.collection, remote.id],
        )?;
        remote.clone()
    } else {
        let next = clock.tick(now)?;
        let record = seal(
            identity,
            key,
            &remote.collection,
            &remote.id,
            &next,
            &merged,
        )?;
        enqueue(tx, &record)?;
        record
    };
    save_head(tx, &accepted)?;
    project(tx, &accepted, &merged)?;
    Ok(())
}

#[cfg(test)]
mod tests;
