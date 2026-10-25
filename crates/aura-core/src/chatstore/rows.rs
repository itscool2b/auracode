//! SQL for chats, folders, agent sessions, turns, events and the prompt queue.
//!
//! Every function takes a [`Connection`] (a transaction derefs to one) and runs on the writer thread;
//! the caller owns the transaction, so each [`Op`](super::Op) stays atomic. Ids are new UUIDv7 strings,
//! times are Unix ms, and every synced row carries the device that wrote it.

use std::path::{Path, PathBuf};

use aura_protocol::{Autonomy, Millis};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use super::{
    AgentSessionPatch, AgentSessionRow, ChatLoad, ChatRecord, EventRow, NewChat, QueuedRow,
    ReplayCheck, TitleSource, TurnEnd, TurnRow, TurnStatus,
};
use crate::ids::new_id;

/// How many of an agent session's newest turns the replay check looks through for the newest reply.
const REPLY_SEARCH_TURNS: i64 = 50;

/// The chat with this id, unless it was deleted.
pub(crate) fn chat(
    conn: &Connection,
    device_id: &str,
    chat_id: &str,
) -> rusqlite::Result<Option<ChatRecord>> {
    let mut stmt =
        conn.prepare_cached(&format!("{CHAT_SELECT} WHERE c.id = ?2 AND c.deleted = 0"))?;
    stmt.query_row(params![device_id, chat_id], chat_record)
        .optional()
}

/// Every chat that is neither deleted nor archived, the most recently updated first.
pub(crate) fn chats(conn: &Connection, device_id: &str) -> rusqlite::Result<Vec<ChatRecord>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{CHAT_SELECT} WHERE c.deleted = 0 AND c.archived = 0 ORDER BY c.updated_at DESC, c.id DESC"
    ))?;
    let rows = stmt.query_map(params![device_id], chat_record)?;
    rows.collect()
}

/// A chat with the folder as this device knows it (any device's path when this one has none).
const CHAT_SELECT: &str = "SELECT c.id, c.title, c.title_source, c.active_agent, c.created_at, c.updated_at, \
     COALESCE((SELECT fl.path FROM folder_locations fl WHERE fl.folder_id = c.folder_id AND fl.device_id = ?1), \
              (SELECT fl.path FROM folder_locations fl WHERE fl.folder_id = c.folder_id LIMIT 1)) \
     FROM chats c";

fn chat_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatRecord> {
    let title_source: Option<String> = row.get(2)?;
    let folder: Option<String> = row.get(6)?;
    Ok(ChatRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        title_source: title_source.as_deref().and_then(parse_title_source),
        agent_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        folder: PathBuf::from(folder.unwrap_or_default()),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn parse_title_source(text: &str) -> Option<TitleSource> {
    match text {
        "first_line" => Some(TitleSource::FirstLine),
        "agent" => Some(TitleSource::Agent),
        _ => None,
    }
}

fn title_source_str(source: TitleSource) -> &'static str {
    match source {
        TitleSource::FirstLine => "first_line",
        TitleSource::Agent => "agent",
    }
}

/// Creates a chat in `new.folder`, reusing the project, folder and location already recorded for
/// that path on this device; otherwise a project named after the folder, a local folder whose origin
/// is this device, and its location here.
pub(crate) fn create_chat(conn: &Connection, new: &NewChat) -> rusqlite::Result<ChatRecord> {
    let path = new.folder.to_string_lossy().into_owned();
    let existing: Option<(String, String)> = conn
        .prepare_cached(
            "SELECT fl.folder_id, pf.project_id FROM folder_locations fl \
             JOIN project_folders pf ON pf.id = fl.folder_id \
             JOIN projects p ON p.id = pf.project_id \
             WHERE fl.device_id = ?1 AND fl.path = ?2 AND pf.deleted = 0 AND p.deleted = 0 \
             ORDER BY pf.created_at LIMIT 1",
        )?
        .query_row(params![new.device_id, path], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    let (folder_id, project_id) = match existing {
        Some((folder_id, project_id)) => {
            conn.prepare_cached(
                "UPDATE folder_locations SET last_seen_at = ?3 WHERE folder_id = ?1 AND device_id = ?2",
            )?
            .execute(params![folder_id, new.device_id, new.now])?;
            (folder_id, project_id)
        }
        None => {
            let name = folder_name(&new.folder);
            let project_id = new_id();
            let folder_id = new_id();
            conn.prepare_cached(
                "INSERT INTO projects (id, name, created_at, updated_at, device_id) VALUES (?1, ?2, ?3, ?3, ?4)",
            )?
            .execute(params![project_id, name, new.now, new.device_id])?;
            conn.prepare_cached(
                "INSERT INTO project_folders (id, project_id, display_name, kind, origin_device_id, created_at, \
                 updated_at, device_id) VALUES (?1, ?2, ?3, 'local', ?4, ?5, ?5, ?4)",
            )?
            .execute(params![folder_id, project_id, name, new.device_id, new.now])?;
            conn.prepare_cached(
                "INSERT INTO folder_locations (folder_id, device_id, path, last_seen_at) VALUES (?1, ?2, ?3, ?4)",
            )?
            .execute(params![folder_id, new.device_id, path, new.now])?;
            (folder_id, project_id)
        }
    };
    let id = new_id();
    conn.prepare_cached(
        "INSERT INTO chats (id, project_id, folder_id, active_agent, created_at, updated_at, device_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
    )?
    .execute(params![id, project_id, folder_id, new.agent_id, new.now, new.device_id])?;
    Ok(ChatRecord {
        id,
        title: None,
        title_source: None,
        agent_id: new.agent_id.clone(),
        folder: new.folder.clone(),
        created_at: new.now,
        updated_at: new.now,
    })
}

/// The folder's own name, for a new project; the whole path when it has none (a drive root).
fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| folder.to_string_lossy().into_owned())
}

/// Everything an actor starts from, after recovery ran. `None` when there is no such chat.
pub(crate) fn load_chat(
    conn: &Connection,
    device_id: &str,
    chat_id: &str,
    recovered_turns: u32,
) -> rusqlite::Result<Option<ChatLoad>> {
    let Some(chat) = chat(conn, device_id, chat_id)? else {
        return Ok(None);
    };
    let max_seq: Option<i64> = conn
        .prepare_cached("SELECT MAX(seq) FROM events WHERE chat_id = ?1")?
        .query_row(params![chat_id], |row| row.get(0))?;
    let next_seq = match max_seq {
        Some(max) => u32::try_from(max).map_or(u32::MAX, |max| max.saturating_add(1)),
        None => 0,
    };
    let max_ordinal: Option<i64> = conn
        .prepare_cached("SELECT MAX(seq) FROM turns WHERE chat_id = ?1")?
        .query_row(params![chat_id], |row| row.get(0))?;
    let next_turn_ordinal = match max_ordinal {
        Some(max) => u32::try_from(max).map_or(u32::MAX, |max| max.saturating_add(1)),
        None => 1,
    };
    let agent_session = latest_agent_session(conn, chat_id)?;
    let queue = queued(conn, chat_id)?;
    let replay_check = match &agent_session {
        Some(session) => replay_check(conn, session)?,
        None => None,
    };
    Ok(Some(ChatLoad {
        chat,
        next_seq,
        next_turn_ordinal,
        agent_session,
        queue,
        recovered_turns,
        replay_check,
    }))
}

/// The chat's newest agent session.
pub(crate) fn latest_agent_session(
    conn: &Connection,
    chat_id: &str,
) -> rusqlite::Result<Option<AgentSessionRow>> {
    conn.prepare_cached(
        "SELECT id, chat_id, agent_id, native_session_id, model, effort, autonomy, config_json, cwd, \
         created_at, updated_at FROM agent_sessions WHERE chat_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
    )?
    .query_row(params![chat_id], |row| {
        let autonomy: Option<String> = row.get(6)?;
        let cwd: String = row.get(8)?;
        Ok(AgentSessionRow {
            id: row.get(0)?,
            chat_id: row.get(1)?,
            agent_id: row.get(2)?,
            native_session_id: row.get(3)?,
            model: row.get(4)?,
            effort: row.get(5)?,
            autonomy: autonomy.as_deref().map(parse_autonomy).unwrap_or_default(),
            config_json: row.get(7)?,
            cwd: PathBuf::from(cwd),
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })
    .optional()
}

/// The chat's queued prompts, oldest first.
pub(crate) fn queued(conn: &Connection, chat_id: &str) -> rusqlite::Result<Vec<QueuedRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, chat_id, text, held, created_at FROM queued_prompts WHERE chat_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map(params![chat_id], |row| {
        Ok(QueuedRow {
            id: row.get(0)?,
            chat_id: row.get(1)?,
            text: row.get(2)?,
            held: row.get::<_, i64>(3)? != 0,
            created_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// The turn count of an agent session with a native id, and the hash of its newest reply.
fn replay_check(
    conn: &Connection,
    session: &AgentSessionRow,
) -> rusqlite::Result<Option<ReplayCheck>> {
    let Some(native_session_id) = session.native_session_id.clone() else {
        return Ok(None);
    };
    let turns: i64 = conn
        .prepare_cached("SELECT COUNT(*) FROM turns WHERE agent_session_id = ?1")?
        .query_row(params![session.id], |row| row.get(0))?;
    let mut newest = conn.prepare_cached(
        "SELECT id FROM turns WHERE agent_session_id = ?1 ORDER BY seq DESC LIMIT ?2",
    )?;
    let turn_ids: Vec<String> = newest
        .query_map(params![session.id, REPLY_SEARCH_TURNS], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut last_reply_sha256 = None;
    for turn_id in turn_ids {
        if let Some(hash) = reply_hash(conn, &turn_id)? {
            last_reply_sha256 = Some(hash);
            break;
        }
    }
    Ok(Some(ReplayCheck {
        native_session_id,
        turns: u32::try_from(turns).unwrap_or(u32::MAX),
        last_reply_sha256,
    }))
}

/// The hash of one turn's agent reply (every agent message's text, whitespace removed), or `None`
/// when the turn has no agent text.
fn reply_hash(conn: &Connection, turn_id: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT payload FROM events WHERE turn_id = ?1 AND kind = 'message_delta' ORDER BY seq",
    )?;
    let payloads = stmt.query_map(params![turn_id], |row| row.get::<_, String>(0))?;
    let mut hasher = ReplyHasher::default();
    for payload in payloads {
        if let Ok(aura_protocol::AuraEvent::MessageDelta { text, .. }) =
            serde_json::from_str(&payload?)
        {
            hasher.update(&text);
        }
    }
    Ok(hasher.finish())
}

/// The reply hash the actor keeps as deltas arrive and recovery recomputes from stored rows: sha256
/// over the concatenated agent text with all whitespace removed, so chunking and spacing differences
/// in a replay do not count as changes.
#[derive(Debug, Clone, Default)]
pub(crate) struct ReplyHasher {
    hasher: Sha256,
    any: bool,
}

impl ReplyHasher {
    pub(crate) fn update(&mut self, text: &str) {
        let mut buffer = [0u8; 4];
        for c in text.chars().filter(|c| !c.is_whitespace()) {
            self.hasher.update(c.encode_utf8(&mut buffer).as_bytes());
            self.any = true;
        }
    }

    /// The hex digest, or `None` when no non-whitespace text arrived.
    pub(crate) fn finish(self) -> Option<String> {
        self.any.then(|| hex(&self.hasher.finalize()))
    }
}

/// Lowercase hex.
pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn parse_autonomy(text: &str) -> Autonomy {
    serde_json::from_value(serde_json::Value::String(text.to_owned())).unwrap_or_default()
}

fn autonomy_str(autonomy: Autonomy) -> &'static str {
    match autonomy {
        Autonomy::FullAuto => "full_auto",
        Autonomy::AutoEdit => "auto_edit",
        Autonomy::Ask => "ask",
    }
}

pub(crate) fn insert_agent_session(
    conn: &Connection,
    device_id: &str,
    row: &AgentSessionRow,
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "INSERT INTO agent_sessions (id, chat_id, agent_id, native_session_id, model, effort, autonomy, cwd, \
         created_at, updated_at, device_id, config_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )?
    .execute(params![
        row.id,
        row.chat_id,
        row.agent_id,
        row.native_session_id,
        row.model,
        row.effort,
        autonomy_str(row.autonomy),
        row.cwd.to_string_lossy(),
        row.created_at,
        row.updated_at,
        device_id,
        row.config_json,
    ])?;
    Ok(())
}

/// Sets the patch's `Some` fields; `None` keeps a field.
pub(crate) fn update_agent_session(
    conn: &Connection,
    device_id: &str,
    id: &str,
    patch: &AgentSessionPatch,
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "UPDATE agent_sessions SET native_session_id = COALESCE(?2, native_session_id), \
         model = COALESCE(?3, model), effort = COALESCE(?4, effort), autonomy = COALESCE(?5, autonomy), \
         config_json = COALESCE(?6, config_json), updated_at = ?7, device_id = ?8 WHERE id = ?1",
    )?
    .execute(params![
        id,
        patch.native_session_id,
        patch.model,
        patch.effort,
        patch.autonomy.map(autonomy_str),
        patch.config_json,
        patch.updated_at,
        device_id,
    ])?;
    Ok(())
}

/// Inserts the turn, appends its first rows, and removes the queued prompt it came from.
pub(crate) fn begin_turn(
    conn: &Connection,
    device_id: &str,
    turn: &TurnRow,
    rows: &[EventRow],
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "INSERT INTO turns (id, chat_id, agent_session_id, seq, status, started_at, device_id, prompt_id, \
         first_event_seq) VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, ?7, ?8)",
    )?
    .execute(params![
        turn.id,
        turn.chat_id,
        turn.agent_session_id,
        turn.ordinal,
        turn.started_at,
        device_id,
        turn.prompt_id,
        turn.first_event_seq,
    ])?;
    append_events(conn, device_id, &turn.chat_id, rows)?;
    conn.prepare_cached("DELETE FROM queued_prompts WHERE id = ?1")?
        .execute(params![turn.prompt_id])?;
    Ok(())
}

pub(crate) fn append_events(
    conn: &Connection,
    device_id: &str,
    chat_id: &str,
    rows: &[EventRow],
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO events (id, chat_id, turn_id, seq, kind, payload, created_at, device_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for row in rows {
        stmt.execute(params![
            new_id(),
            chat_id,
            row.turn_id,
            row.seq,
            row.kind,
            row.payload,
            row.created_at,
            device_id,
        ])?;
    }
    Ok(())
}

pub(crate) fn turn_status_str(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::Running => "running",
        TurnStatus::Completed => "completed",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
    }
}

pub(crate) fn end_turn(conn: &Connection, end: &TurnEnd) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "UPDATE turns SET status = ?2, stop_reason = ?3, ended_at = ?4, last_event_seq = ?5 WHERE id = ?1",
    )?
    .execute(params![
        end.turn_id,
        turn_status_str(end.status),
        end.stop_reason.as_str(),
        end.ended_at,
        end.last_event_seq,
    ])?;
    Ok(())
}

pub(crate) fn set_title(
    conn: &Connection,
    chat_id: &str,
    title: &str,
    source: TitleSource,
) -> rusqlite::Result<()> {
    conn.prepare_cached("UPDATE chats SET title = ?2, title_source = ?3 WHERE id = ?1")?
        .execute(params![chat_id, title, title_source_str(source)])?;
    Ok(())
}

/// Moves the chat's `updated_at` forward to `at` (never back).
pub(crate) fn touch_chat(conn: &Connection, chat_id: &str, at: Millis) -> rusqlite::Result<()> {
    conn.prepare_cached("UPDATE chats SET updated_at = MAX(updated_at, ?2) WHERE id = ?1")?
        .execute(params![chat_id, at])?;
    Ok(())
}

/// Inserts a queued prompt, or replaces the row with its id (a prompt that met a sign-in error goes
/// back with its original `created_at`).
pub(crate) fn queue_put(
    conn: &Connection,
    device_id: &str,
    row: &QueuedRow,
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "INSERT OR REPLACE INTO queued_prompts (id, chat_id, text, held, created_at, device_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?
    .execute(params![
        row.id,
        row.chat_id,
        row.text,
        i64::from(row.held),
        row.created_at,
        device_id,
    ])?;
    Ok(())
}

pub(crate) fn queue_remove(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.prepare_cached("DELETE FROM queued_prompts WHERE id = ?1")?
        .execute(params![id])?;
    Ok(())
}

/// Holds (or releases) every queued prompt of one chat, or of every chat with `chat_id: None`.
pub(crate) fn queue_hold(
    conn: &Connection,
    chat_id: Option<&str>,
    held: bool,
) -> rusqlite::Result<usize> {
    match chat_id {
        Some(chat_id) => conn
            .prepare_cached(
                "UPDATE queued_prompts SET held = ?2 WHERE chat_id = ?1 AND held <> ?2",
            )?
            .execute(params![chat_id, i64::from(held)]),
        None => conn
            .prepare_cached("UPDATE queued_prompts SET held = ?1 WHERE held <> ?1")?
            .execute(params![i64::from(held)]),
    }
}

/// Records a stored blob's file.
pub(crate) fn insert_attachment(
    conn: &Connection,
    sha256: &str,
    mime: &str,
    size: u64,
    now: Millis,
) -> rusqlite::Result<()> {
    conn.prepare_cached(
        "INSERT OR IGNORE INTO attachments (sha256, mime, size, created_at) VALUES (?1, ?2, ?3, ?4)",
    )?
    .execute(params![sha256, mime, i64::try_from(size).unwrap_or(i64::MAX), now])?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::chatstore::test_support::{TestDb, event_row};

    #[test]
    fn a_chat_in_a_new_folder_creates_its_project_folder_and_location() {
        let db = TestDb::new();
        let conn = db.conn();
        let chat = create_chat(
            conn,
            &NewChat {
                agent_id: "mock".into(),
                folder: PathBuf::from("/work/my repo"),
                device_id: "dev".into(),
                now: 10,
            },
        )
        .expect("create");
        assert_eq!(chat.agent_id, "mock");
        assert_eq!(chat.folder, PathBuf::from("/work/my repo"));
        let (name, kind, origin): (String, String, String) = conn
            .query_row(
                "SELECT p.name, pf.kind, pf.origin_device_id FROM chats c JOIN projects p ON p.id = c.project_id \
                 JOIN project_folders pf ON pf.id = c.folder_id WHERE c.id = ?1",
                params![chat.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("joined");
        assert_eq!(
            (name.as_str(), kind.as_str(), origin.as_str()),
            ("my repo", "local", "dev")
        );
        assert_eq!(chats(conn, "dev").expect("chats"), [chat]);
    }

    #[test]
    fn a_second_chat_in_the_same_folder_reuses_the_project_and_location() {
        let db = TestDb::new();
        let conn = db.conn();
        let new = |now| NewChat {
            agent_id: "mock".into(),
            folder: PathBuf::from("/work/repo"),
            device_id: "dev".into(),
            now,
        };
        let first = create_chat(conn, &new(1)).expect("first");
        let second = create_chat(conn, &new(2)).expect("second");
        assert_ne!(first.id, second.id);
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
        };
        assert_eq!(count("projects"), 1);
        assert_eq!(count("project_folders"), 1);
        assert_eq!(count("folder_locations"), 1);
        assert_eq!(count("chats"), 2);
        let listed = chats(conn, "dev").expect("chats");
        assert_eq!(listed.first().map(|chat| chat.id.clone()), Some(second.id));
    }

    #[test]
    fn load_chat_continues_numbering_and_finds_the_newest_session_and_queue() {
        let db = TestDb::new();
        let conn = db.conn();
        let chat = db.chat("/work");
        assert_eq!(
            load_chat(conn, "dev", "missing", 0).expect("load"),
            None,
            "no such chat"
        );
        let empty = load_chat(conn, "dev", &chat, 0)
            .expect("load")
            .expect("chat");
        assert_eq!((empty.next_seq, empty.next_turn_ordinal), (0, 1));
        assert_eq!(empty.agent_session, None);

        let session = AgentSessionRow {
            id: "s1".into(),
            chat_id: chat.clone(),
            agent_id: "mock".into(),
            native_session_id: Some("native".into()),
            model: None,
            effort: None,
            autonomy: Autonomy::Ask,
            config_json: Some("{}".into()),
            cwd: PathBuf::from("/work"),
            created_at: 5,
            updated_at: 5,
        };
        insert_agent_session(conn, "dev", &session).expect("session");
        begin_turn(
            conn,
            "dev",
            &TurnRow {
                id: "t1".into(),
                chat_id: chat.clone(),
                agent_session_id: Some("s1".into()),
                ordinal: 1,
                prompt_id: "p1".into(),
                first_event_seq: 0,
                started_at: 6,
            },
            &[event_row(
                0,
                Some("t1"),
                &aura_protocol::AuraEvent::TurnStarted {
                    turn_id: "t1".into(),
                    prompt_id: Some("p1".into()),
                },
            )],
        )
        .expect("turn");
        append_events(
            conn,
            "dev",
            &chat,
            &[
                event_row(
                    4,
                    Some("t1"),
                    &aura_protocol::AuraEvent::MessageDelta {
                        message_id: "t1.m1".into(),
                        text: "Hello there".into(),
                    },
                ),
                event_row(
                    7,
                    Some("t1"),
                    &aura_protocol::AuraEvent::MessageDelta {
                        message_id: "t1.m1".into(),
                        text: " world".into(),
                    },
                ),
            ],
        )
        .expect("events");
        queue_put(
            conn,
            "dev",
            &QueuedRow {
                id: "q2".into(),
                chat_id: chat.clone(),
                text: "later".into(),
                held: false,
                created_at: 9,
            },
        )
        .expect("queue");
        queue_put(
            conn,
            "dev",
            &QueuedRow {
                id: "q1".into(),
                chat_id: chat.clone(),
                text: "first".into(),
                held: true,
                created_at: 8,
            },
        )
        .expect("queue");
        let load = load_chat(conn, "dev", &chat, 0)
            .expect("load")
            .expect("chat");
        assert_eq!((load.next_seq, load.next_turn_ordinal), (8, 2));
        assert_eq!(load.agent_session, Some(session));
        assert_eq!(
            load.queue
                .iter()
                .map(|row| (row.id.as_str(), row.held))
                .collect::<Vec<_>>(),
            [("q1", true), ("q2", false)]
        );
        let mut hasher = ReplyHasher::default();
        hasher.update("Hellothereworld");
        let check = load.replay_check.expect("replay check");
        assert_eq!(check.native_session_id, "native");
        assert_eq!(check.turns, 1);
        assert_eq!(check.last_reply_sha256, hasher.finish());
    }

    #[test]
    fn reply_hashes_ignore_whitespace_and_chunking() {
        let hash = |parts: &[&str]| {
            let mut hasher = ReplyHasher::default();
            for part in parts {
                hasher.update(part);
            }
            hasher.finish()
        };
        assert_eq!(
            hash(&["Hello, ", "world!\n"]),
            hash(&["Hel", "lo,world", "!"])
        );
        assert_ne!(hash(&["Hello"]), hash(&["Hullo"]));
        assert_eq!(hash(&[" \n\t "]), None);
        assert_eq!(hash(&[]), None);
    }

    #[test]
    fn queue_hold_and_release_touch_one_chat_or_all() {
        let db = TestDb::new();
        let conn = db.conn();
        let a = db.chat("/a");
        let b = db.chat("/b");
        for (id, chat) in [("1", &a), ("2", &b)] {
            queue_put(
                conn,
                "dev",
                &QueuedRow {
                    id: id.into(),
                    chat_id: chat.clone(),
                    text: "x".into(),
                    held: false,
                    created_at: 1,
                },
            )
            .expect("put");
        }
        assert_eq!(queue_hold(conn, Some(&a), true).expect("hold"), 1);
        assert!(queued(conn, &a).expect("a")[0].held);
        assert!(!queued(conn, &b).expect("b")[0].held);
        assert_eq!(queue_hold(conn, None, true).expect("hold all"), 1);
        assert!(queued(conn, &b).expect("b")[0].held);
        assert_eq!(queue_hold(conn, Some(&b), false).expect("release"), 1);
        assert!(!queued(conn, &b).expect("b")[0].held);
    }
}
