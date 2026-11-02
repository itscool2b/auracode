//! One immutable head per compacted turn. Its reverse-linked encrypted pieces keep both memory and
//! wire records bounded, independent of turn length. Raw event JSON survives older client codecs.
use super::*;
use aura_protocol::{AuraEvent, PromptPart, ToolContent, Truncation};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

mod capture;
pub(crate) use capture::{capture_one, install};
mod import;
pub(crate) use import::publish;

#[derive(Clone)]
pub struct Imported {
    pub chat_id: String,
    pub turn_id: String,
    pub next_seq: u32,
    pub next_turn_ordinal: u32,
}

pub(super) const PIECE_BYTES: usize = 3 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 16 * 1024 * 1024;
const MAX_PARTS: u32 = 65_536;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Head {
    schema_version: u32,
    pub chat_id: String,
    pub turn_id: String,
    pub parent_turn_id: Option<String>,
    pub tail: String,
    pub parts: u32,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Piece {
    schema_version: u32,
    pub turn_id: String,
    pub index: u32,
    pub previous: Option<String>,
    pub entries: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Entry {
    Turn(Turn),
    Event(Event),
    Steering(Steering),
    File(File),
    MissingFile {
        hash: String,
    },
    Fragment {
        offset: u32,
        total: u32,
        bytes: String,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Turn {
    pub chat_id: String,
    pub turn_id: String,
    pub parent_turn_id: Option<String>,
    pub agent: String,
    pub status: String,
    pub stop_reason: Option<String>,
    pub started_at: i64,
    pub ended_at: i64,
    pub prompt_id: Option<String>,
    pub parts: Vec<PromptPart>,
    pub continuation_prefix: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Event {
    pub seq: u32,
    pub kind: String,
    // A string, rather than Value, deliberately preserves unknown event bytes verbatim.
    pub payload: String,
    pub created_at: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Steering {
    pub message_id: String,
    pub seq: u32,
    pub parts: Vec<PromptPart>,
    pub state: String,
    pub detail: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct File {
    pub hash: String,
    pub mime: String,
    pub total: u64,
    pub offset: u64,
    pub bytes: String,
    pub display_name: Option<String>,
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|parsed| parsed.to_string() == value)
}
fn valid_parent(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(uuid)
}
pub(super) fn decode(context: &SyncContext, record: &EncryptedRecord) -> Result<Head> {
    decode_with(&context.identity, &context.key, record)
}
fn decode_with(
    identity: &SyncIdentity,
    key: &AccountKey,
    record: &EncryptedRecord,
) -> Result<Head> {
    if record.collection != "chat_chunks"
        || record.key_version != identity.key_version
        || record.deleted
        || !uuid(&record.id)
    {
        return Err(SyncError::Invalid);
    }
    let bytes = crypto::open_record(
        key,
        &context(identity, record),
        &SealedPayload {
            nonce: record.nonce.clone(),
            ciphertext: record.ciphertext.clone(),
        },
    )?;
    let version: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| SyncError::Invalid)?;
    if version
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|version| version > 1)
    {
        return Err(SyncError::Deferred);
    }
    let head: Head = serde_json::from_slice(&bytes).map_err(|_| SyncError::Invalid)?;
    if head.schema_version != 1
        || head.turn_id != record.id
        || !uuid(&head.chat_id)
        || !valid_parent(&head.parent_turn_id)
        || head.parent_turn_id.as_ref() == Some(&head.turn_id)
        || !uuid(&head.tail)
        || !(1..=MAX_PARTS).contains(&head.parts)
    {
        return Err(SyncError::Invalid);
    }
    Ok(head)
}
pub(super) fn piece(bytes: &[u8], turn_id: &str, index: u32) -> Result<Piece> {
    if bytes.len() > PIECE_BYTES {
        return Err(SyncError::Invalid);
    }
    let piece: Piece = serde_json::from_slice(bytes).map_err(|_| SyncError::Invalid)?;
    if piece.schema_version != 1
        || piece.turn_id != turn_id
        || piece.index != index
        || index >= MAX_PARTS
        || (index == 0) != piece.previous.is_none()
        || !valid_parent(&piece.previous)
        || piece.entries.is_empty()
        || piece.entries.len() > 128
    {
        return Err(SyncError::Invalid);
    }
    for entry in &piece.entries {
        validate_entry(entry, turn_id)?;
    }
    Ok(piece)
}
fn validate_entry(entry: &Entry, turn_id: &str) -> Result<()> {
    let valid = match entry {
        Entry::Turn(turn) => {
            turn.turn_id == turn_id
                && uuid(&turn.chat_id)
                && valid_parent(&turn.parent_turn_id)
                && turn.parent_turn_id.as_deref() != Some(turn_id)
                && !turn.agent.is_empty()
                && turn.agent.len() <= 128
                && !turn.agent.chars().any(char::is_control)
                && matches!(turn.status.as_str(), "completed" | "interrupted" | "failed")
                && turn.started_at >= 0
                && turn.ended_at >= 0
                && turn.prompt_id.as_ref().is_none_or(|id| id.len() <= 128)
                && turn
                    .stop_reason
                    .as_ref()
                    .is_none_or(|reason| reason.len() <= 128)
        }
        Entry::Event(event) => {
            event.kind.len() <= 128
                && !event.kind.is_empty()
                && event.created_at >= 0
                && serde_json::from_str::<serde_json::Value>(&event.payload).is_ok()
        }
        Entry::Steering(steer) => {
            !steer.message_id.is_empty()
                && steer.message_id.len() <= 128
                && matches!(
                    steer.state.as_str(),
                    "accepted" | "rejected" | "unconfirmed"
                )
                && steer.created_at >= 0
                && steer.updated_at >= 0
        }
        Entry::File(file) => {
            crate::chatstore::blobs::is_sha256(&file.hash)
                && file.total <= aura_sync::crypto::files::MAX_FILE as u64
                && file.offset <= file.total
                && file.mime.len() <= 128
                && file
                    .display_name
                    .as_ref()
                    .is_none_or(|name| name.len() <= 1024)
                && crypto::decode(&file.bytes, 192 * 1024).is_ok_and(|bytes| {
                    file.offset + bytes.len() as u64 <= file.total
                        && (!bytes.is_empty() || file.total == 0)
                })
        }
        Entry::MissingFile { hash } => crate::chatstore::blobs::is_sha256(hash),
        Entry::Fragment {
            offset,
            total,
            bytes,
        } => {
            *total > 0
                && (*total as usize) <= MAX_ENTRY_BYTES
                && *offset < *total
                && crypto::decode(bytes, 192 * 1024).is_ok_and(|bytes| {
                    !bytes.is_empty()
                        && u64::from(*offset) + bytes.len() as u64 <= u64::from(*total)
                })
        }
    };
    if valid {
        Ok(())
    } else {
        Err(SyncError::Invalid)
    }
}

pub(super) fn accept_remote(
    conn: &Connection,
    identity: &SyncIdentity,
    key: &AccountKey,
    change: &Change,
) -> Result<()> {
    let record = &change.record;
    let incoming = match decode_with(identity, key, record) {
        Ok(head) => head,
        Err(SyncError::Deferred) => return retain(conn, change, "future_transcript_schema"),
        Err(error) => return Err(error),
    };
    if deferred(conn, "chat_chunks", &record.id)? {
        return retain(conn, change, "blocked_by_future_transcript_schema");
    }
    if let Some(previous) = head(conn, "chat_chunks", &record.id)? {
        // Append-only identity is stronger than last-writer-wins. A later clock cannot rewrite a turn.
        if decode_with(identity, key, &previous)? != incoming {
            return Err(SyncError::Invalid);
        }
    } else {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1)",
            [&record.id],
            |r| r.get(0),
        )?;
        if exists {
            return Err(SyncError::Invalid);
        }
        conn.execute("INSERT INTO sync_turns(turn_id,chat_id,state,tail_blob,part_count) VALUES(?1,?2,'remote',?3,?4)", params![incoming.turn_id,incoming.chat_id,incoming.tail,incoming.parts])?;
        conn.execute(
            "INSERT INTO sync_turn_parts(turn_id,part_index,blob_id) VALUES(?1,?2,?3)",
            params![incoming.turn_id, incoming.parts - 1, incoming.tail],
        )?;
        save_head(conn, record)?;
    }
    conn.execute(
        "DELETE FROM sync_outbox WHERE collection='chat_chunks' AND id=?1",
        [&record.id],
    )?;
    Ok(())
}

/// A fetched piece binds its expected turn and ordinal and discovers exactly one predecessor.
pub(super) fn accept_piece(
    conn: &Connection,
    context: &SyncContext,
    record: &EncryptedRecord,
    blob_id: &str,
    bytes: &[u8],
) -> Result<()> {
    let head = decode(context, record)?;
    let index: u32 = conn.query_row(
        "SELECT part_index FROM sync_turn_parts WHERE turn_id=?1 AND blob_id=?2",
        params![head.turn_id, blob_id],
        |r| r.get(0),
    )?;
    let decoded = piece(bytes, &head.turn_id, index)?;
    if let Some(previous) = &decoded.previous {
        if previous == blob_id {
            return Err(SyncError::Invalid);
        }
        let existing: Option<String> = conn
            .query_row(
                "SELECT blob_id FROM sync_turn_parts WHERE turn_id=?1 AND part_index=?2",
                params![head.turn_id, index - 1],
                |r| r.get(0),
            )
            .optional()?;
        if existing.as_ref().is_some_and(|id| id != previous) {
            return Err(SyncError::Invalid);
        }
        conn.execute(
            "INSERT OR IGNORE INTO sync_turn_parts(turn_id,part_index,blob_id) VALUES(?1,?2,?3)",
            params![head.turn_id, index - 1, previous],
        )?;
    }
    Ok(())
}

fn referenced(entry: &Entry) -> Vec<String> {
    fn parts(parts: &[PromptPart], result: &mut Vec<String>) {
        result.extend(parts.iter().filter_map(|part| match part {
            PromptPart::Image { blob, .. } => Some(blob.clone()),
            _ => None,
        }));
    }
    fn truncation(value: &Option<Truncation>, result: &mut Vec<String>) {
        if let Some(hash) = value.as_ref().and_then(|value| value.blob.as_ref()) {
            result.push(hash.clone());
        }
    }
    fn content(values: &[ToolContent], result: &mut Vec<String>) {
        for value in values {
            match value {
                ToolContent::Text { truncated, .. }
                | ToolContent::Diff { truncated, .. }
                | ToolContent::Terminal { truncated, .. } => truncation(truncated, result),
            }
        }
    }
    let mut result = Vec::new();
    match entry {
        Entry::Turn(turn) => parts(&turn.parts, &mut result),
        Entry::Steering(steer) => parts(&steer.parts, &mut result),
        Entry::Event(event) => match serde_json::from_str::<AuraEvent>(&event.payload) {
            Ok(AuraEvent::ToolCall(call)) => {
                truncation(&call.truncated, &mut result);
                content(&call.content, &mut result);
            }
            Ok(AuraEvent::ToolUpdate(update)) => {
                truncation(&update.truncated, &mut result);
                if let Some(values) = update.content {
                    content(&values, &mut result);
                }
            }
            _ => {}
        },
        _ => {}
    }
    result
}

/// Unlike explicit image parts, arbitrary text can contain an unavailable or forged private URI.
/// Keep these optional on import, and require source-chat ownership before exporting any bytes.
fn inline_images(entry: &Entry) -> std::collections::BTreeSet<String> {
    let mut result = std::collections::BTreeSet::new();
    let mut text = |text: &str| {
        result.extend(crate::chatstore::image_refs::hashes(text).map(str::to_owned));
    };
    match entry {
        Entry::Event(event) => text(&event.payload),
        Entry::Turn(turn) => {
            if let Some(prefix) = &turn.continuation_prefix {
                text(prefix);
            }
            for part in &turn.parts {
                if let PromptPart::Text { text: value } = part {
                    text(value);
                }
            }
        }
        Entry::Steering(steer) => {
            for part in &steer.parts {
                if let PromptPart::Text { text: value } = part {
                    text(value);
                }
            }
        }
        _ => {}
    }
    result
}

#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) use tests::staged_turn;
