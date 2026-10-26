//! Encrypted config heads and device merge bases, called only by the profile writer.
use super::*;
use aura_config::sync::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

type PortResult<T> = std::result::Result<T, ConfigPortError>;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    schema_version: u32,
    id: String,
    head: ConfigSnapshotHead,
    scope: ConfigScope,
}

pub(crate) enum Command {
    Heads,
    Head(String),
    Snapshot {
        id: String,
        head: ConfigSnapshotHead,
    },
    Publish {
        id: String,
        expected: Option<String>,
        snapshot: Zeroizing<Vec<u8>>,
        metadata: ConfigSnapshotMetadata,
    },
    DeviceIds,
    Device(String),
    SaveDevice {
        id: String,
        expected: Option<String>,
        state: ConfigDeviceState,
    },
}
pub(crate) enum Reply {
    Heads(Vec<ConfigSnapshotRef>),
    Head(Option<ConfigSnapshotHead>),
    Snapshot(Zeroizing<Vec<u8>>),
    Published(ConfigSnapshotHead),
    Ids(Vec<String>),
    Device(Option<ConfigDeviceState>),
    Saved,
}
impl Command {
    pub(crate) fn bytes(&self) -> usize {
        1024 + match self {
            Self::Publish { snapshot, .. } => snapshot.len(),
            Self::SaveDevice { state, .. } => {
                state.snapshot.as_ref().map_or(0, |bytes| bytes.len())
            }
            _ => 0,
        }
    }
    pub(crate) fn validate(&self) -> PortResult<()> {
        let id = match self {
            Self::Head(id)
            | Self::Device(id)
            | Self::Snapshot { id, .. }
            | Self::Publish { id, .. }
            | Self::SaveDevice { id, .. } => Some(id),
            _ => None,
        };
        if id.is_some_and(|id| !valid_hash(id)) {
            return Err(ConfigPortError::Invalid);
        }
        let expected = match self {
            Self::Publish { expected, .. } | Self::SaveDevice { expected, .. } => {
                expected.as_deref()
            }
            _ => None,
        };
        if expected.is_some_and(|revision| revision.len() > 160 || revision.parse::<Hlc>().is_err())
        {
            return Err(ConfigPortError::Invalid);
        }
        let head = match self {
            Self::Snapshot { head, .. } => Some(head),
            Self::SaveDevice { state, .. } => state.head.as_ref(),
            _ => None,
        };
        if head.is_some_and(|head| {
            !valid_hash(&head.content_hash)
                || head.revision.len() > 160
                || head.revision.parse::<Hlc>().is_err()
                || uuid::Uuid::parse_str(&head.blob_id).is_err()
                || head.schema == 0
        }) {
            return Err(ConfigPortError::Invalid);
        }
        if let Self::SaveDevice { state, .. } = self
            && (state
                .revision
                .as_ref()
                .is_some_and(|revision| uuid::Uuid::parse_str(revision).is_err())
                || state.skipped.as_ref().is_some_and(|reason| {
                    reason.is_empty() || reason.len() > 256 || reason.chars().any(char::is_control)
                }))
        {
            return Err(ConfigPortError::Invalid);
        }
        match self {
            Self::Publish { snapshot, .. } if snapshot.len() > MAX_SNAPSHOT_BYTES => {
                Err(ConfigPortError::Limit)
            }
            Self::SaveDevice { state, .. }
                if state
                    .snapshot
                    .as_ref()
                    .is_some_and(|bytes| bytes.len() > MAX_SNAPSHOT_BYTES) =>
            {
                Err(ConfigPortError::Limit)
            }
            _ => Ok(()),
        }
    }
}

pub(crate) fn execute(
    store: &mut Store,
    context: &SyncContext,
    command: Command,
) -> PortResult<Reply> {
    command.validate()?;
    if !store.is_encrypted() {
        return Err(ConfigPortError::Unavailable);
    }
    let tx = store
        .conn_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ConfigPortError::Storage)?;
    let reply = match command {
        Command::Heads => Reply::Heads(list_heads(&tx, context)?),
        Command::Head(id) => Reply::Head(read_head(&tx, context, &id)?.map(|value| value.head)),
        Command::Snapshot { id, head } => Reply::Snapshot(read_snapshot(&tx, context, &id, &head)?),
        Command::Publish {
            id,
            expected,
            snapshot,
            metadata,
        } => Reply::Published(publish(
            &tx,
            context,
            &id,
            expected.as_deref(),
            snapshot,
            metadata,
        )?),
        Command::DeviceIds => Reply::Ids(device_ids(&tx)?),
        Command::Device(id) => {
            validate_id(context, &id)?;
            Reply::Device(read_device(&tx, &id)?)
        }
        Command::SaveDevice {
            id,
            expected,
            state,
        } => {
            save_device(&tx, context, &id, expected.as_deref(), state)?;
            Reply::Saved
        }
    };
    tx.commit().map_err(|_| ConfigPortError::Storage)?;
    Ok(reply)
}

fn validate_id(context: &SyncContext, id: &str) -> PortResult<String> {
    context
        .key
        .config_record_id(&context.identity.account, id)
        .map_err(|_| ConfigPortError::Invalid)
}
fn decode(context: &SyncContext, record: &EncryptedRecord) -> PortResult<Payload> {
    if record.collection != "config" || record.key_version != context.identity.key_version {
        return Err(ConfigPortError::Invalid);
    }
    let bytes = crypto::open_record(
        &context.key,
        &super::context(&context.identity, record),
        &SealedPayload {
            nonce: record.nonce.clone(),
            ciphertext: record.ciphertext.clone(),
        },
    )
    .map_err(|_| ConfigPortError::Invalid)?;
    let payload: Payload = serde_json::from_slice(&bytes).map_err(|_| ConfigPortError::Invalid)?;
    if payload.schema_version != 1
        || payload.head.schema == 0
        || payload.head.revision != record.hlc
        || payload.head.deleted != record.deleted
        || validate_id(context, &payload.id)? != record.id
        || !valid_hash(&payload.head.content_hash)
    {
        return Err(ConfigPortError::Invalid);
    }
    let _: Hlc = payload
        .head
        .revision
        .parse()
        .map_err(|_| ConfigPortError::Invalid)?;
    if uuid::Uuid::parse_str(&payload.head.blob_id).is_err() {
        return Err(ConfigPortError::Invalid);
    }
    Ok(payload)
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn read_head(conn: &Connection, context: &SyncContext, id: &str) -> PortResult<Option<Payload>> {
    let wire = validate_id(context, id)?;
    if deferred(conn, "config", &wire).map_err(|_| ConfigPortError::Storage)? {
        return Err(ConfigPortError::Invalid);
    }
    head(conn, "config", &wire)
        .map_err(|_| ConfigPortError::Storage)?
        .map(|head| decode(context, &head))
        .transpose()
}
fn list_heads(conn: &Connection, context: &SyncContext) -> PortResult<Vec<ConfigSnapshotRef>> {
    let mut stmt = conn
        .prepare(
            "SELECT record_json FROM sync_heads WHERE collection='config' ORDER BY id LIMIT 8193",
        )
        .map_err(|_| ConfigPortError::Storage)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| ConfigPortError::Storage)?;
    let mut values = Vec::new();
    for row in rows {
        if values.len() == MAX_SYNC_ITEMS {
            return Err(ConfigPortError::Limit);
        }
        let record = decode_record(&row.map_err(|_| ConfigPortError::Storage)?)
            .map_err(|_| ConfigPortError::Invalid)?;
        let value = decode(context, &record)?;
        values.push(ConfigSnapshotRef {
            id: value.id,
            head: value.head,
        });
    }
    Ok(values)
}
fn publish(
    conn: &Connection,
    context: &SyncContext,
    id: &str,
    expected: Option<&str>,
    snapshot: Zeroizing<Vec<u8>>,
    metadata: ConfigSnapshotMetadata,
) -> PortResult<ConfigSnapshotHead> {
    let wire_id = validate_id(context, id)?;
    let existing = read_head(conn, context, id)?;
    if existing.as_ref().map(|value| value.head.revision.as_str()) != expected {
        return Err(ConfigPortError::Stale);
    }
    if metadata.schema == 0 {
        return Err(ConfigPortError::Invalid);
    }
    if existing.is_none() {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_heads WHERE collection='config'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| ConfigPortError::Storage)?;
        if count >= MAX_SYNC_ITEMS as i64 {
            return Err(ConfigPortError::Limit);
        }
    }
    let mut clock = load_clock(conn, &context.identity).map_err(|_| ConfigPortError::Storage)?;
    let now = (crate::time::now_millis().max(0) as u64).max(clock.last().physical_ms());
    let revision = clock
        .tick(now)
        .map_err(|_| ConfigPortError::Invalid)?
        .to_string();
    let head = ConfigSnapshotHead {
        revision: revision.clone(),
        content_hash: format!("{:x}", Sha256::digest(&snapshot)),
        blob_id: uuid::Uuid::now_v7().to_string(),
        schema: metadata.schema,
        deleted: metadata.deleted,
    };
    let payload = Payload {
        schema_version: 1,
        id: id.into(),
        head: head.clone(),
        scope: metadata.scope,
    };
    let header =
        Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| ConfigPortError::Invalid)?);
    let mut bytes = Zeroizing::new(Vec::with_capacity(4 + header.len() + snapshot.len()));
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(&snapshot);
    let blob = crypto::seal_blob(
        &context.key,
        &context.identity.account,
        &head.blob_id,
        context.identity.key_version,
        &bytes,
    )
    .map_err(|_| ConfigPortError::Invalid)?;
    conn.execute(
        "INSERT INTO sync_blobs(id,key_version,nonce,ciphertext) VALUES(?1,?2,?3,?4)",
        params![
            head.blob_id,
            context.identity.key_version,
            blob.nonce,
            blob.ciphertext
        ],
    )
    .map_err(|_| ConfigPortError::Storage)?;
    let mut record = EncryptedRecord {
        collection: "config".into(),
        id: wire_id,
        hlc: revision,
        deleted: metadata.deleted,
        key_version: context.identity.key_version,
        nonce: String::new(),
        ciphertext: String::new(),
    };
    let sealed = crypto::seal_record(
        &context.key,
        &super::context(&context.identity, &record),
        &header,
    )
    .map_err(|_| ConfigPortError::Invalid)?;
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    save_head(conn, &record).map_err(|_| ConfigPortError::Storage)?;
    conn.execute("INSERT INTO sync_blob_refs(collection,id,blob_id) VALUES('config',?1,?2) ON CONFLICT(collection,id) DO UPDATE SET blob_id=excluded.blob_id", params![record.id, head.blob_id]).map_err(|_| ConfigPortError::Storage)?;
    enqueue(conn, &record).map_err(|_| ConfigPortError::Storage)?;
    save_clock(conn, &clock).map_err(|_| ConfigPortError::Storage)?;
    Ok(head)
}
fn read_snapshot(
    conn: &Connection,
    context: &SyncContext,
    id: &str,
    head: &ConfigSnapshotHead,
) -> PortResult<Zeroizing<Vec<u8>>> {
    validate_id(context, id)?;
    let found: Option<(u32, String, String)> = conn
        .query_row(
            "SELECT key_version,nonce,ciphertext FROM sync_blobs WHERE id=?1",
            [&head.blob_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| ConfigPortError::Storage)?;
    let (version, nonce, ciphertext) = found.ok_or(ConfigPortError::Offline)?;
    if version != context.identity.key_version {
        return Err(ConfigPortError::Invalid);
    }
    let bytes = crypto::open_blob(
        &context.key,
        &context.identity.account,
        &head.blob_id,
        version,
        &SealedPayload { nonce, ciphertext },
    )
    .map_err(|_| ConfigPortError::Invalid)?;
    if bytes.len() < 4 {
        return Err(ConfigPortError::Invalid);
    }
    let len = u32::from_le_bytes(
        bytes[..4]
            .try_into()
            .map_err(|_| ConfigPortError::Invalid)?,
    ) as usize;
    if len > 1024 || 4 + len > bytes.len() {
        return Err(ConfigPortError::Invalid);
    }
    let payload: Payload =
        serde_json::from_slice(&bytes[4..4 + len]).map_err(|_| ConfigPortError::Invalid)?;
    let plain = &bytes[4 + len..];
    if payload.schema_version != 1
        || payload.id != id
        || payload.head != *head
        || plain.len() > MAX_SNAPSHOT_BYTES
        || format!("{:x}", Sha256::digest(plain)) != head.content_hash
    {
        return Err(ConfigPortError::Invalid);
    }
    Ok(Zeroizing::new(plain.to_vec()))
}
fn device_ids(conn: &Connection) -> PortResult<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT id FROM sync_config_device ORDER BY id LIMIT 8193")
        .map_err(|_| ConfigPortError::Storage)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| ConfigPortError::Storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| ConfigPortError::Storage)?;
    if ids.len() > MAX_SYNC_ITEMS {
        return Err(ConfigPortError::Limit);
    }
    Ok(ids)
}
fn read_device(conn: &Connection, id: &str) -> PortResult<Option<ConfigDeviceState>> {
    conn.query_row("SELECT revision,head_json,snapshot,device_only,skipped FROM sync_config_device WHERE id=?1", [id], |row| {
        let head: Option<String> = row.get(1)?;
        let head = head.map(|json| serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)).transpose()?;
        let snapshot: Option<Vec<u8>> = row.get(2)?;
        Ok(ConfigDeviceState { revision: Some(row.get(0)?), head, snapshot: snapshot.map(Zeroizing::new), device_only: row.get(3)?, skipped: row.get(4)? })
    }).optional().map_err(|_| ConfigPortError::Storage)
}
fn save_device(
    conn: &Connection,
    context: &SyncContext,
    id: &str,
    expected: Option<&str>,
    state: ConfigDeviceState,
) -> PortResult<()> {
    validate_id(context, id)?;
    let previous = read_device(conn, id)?;
    if previous
        .as_ref()
        .and_then(|value| value.revision.as_deref())
        != state.revision.as_deref()
        || previous
            .as_ref()
            .and_then(|value| value.head.as_ref())
            .map(|head| head.revision.as_str())
            != expected
    {
        return Err(ConfigPortError::Stale);
    }
    if previous.is_none() && device_ids(conn)?.len() >= MAX_SYNC_ITEMS {
        return Err(ConfigPortError::Limit);
    }
    if let Some(reason) = &state.skipped
        && (reason.is_empty() || reason.len() > 256 || reason.chars().any(char::is_control))
    {
        return Err(ConfigPortError::Invalid);
    }
    if let Some(snapshot) = &state.snapshot {
        let head = state.head.as_ref().ok_or(ConfigPortError::Invalid)?;
        if format!("{:x}", Sha256::digest(snapshot)) != head.content_hash {
            return Err(ConfigPortError::Invalid);
        }
    }
    let head = state
        .head
        .map(|head| serde_json::to_string(&head).map_err(|_| ConfigPortError::Invalid))
        .transpose()?;
    conn.execute("INSERT INTO sync_config_device(id,revision,head_json,snapshot,device_only,skipped) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,head_json=excluded.head_json,snapshot=excluded.snapshot,device_only=excluded.device_only,skipped=excluded.skipped",
        params![id, uuid::Uuid::now_v7().to_string(), head, state.snapshot.as_deref().map(Vec::as_slice), state.device_only, state.skipped]).map_err(|_| ConfigPortError::Storage)?;
    Ok(())
}

#[cfg(test)]
mod tests;
