//! Saved conversation reads and atomic, explicitly confirmed continuation changes.

use std::collections::BTreeMap;

use aura_drivers::driver::NativeStartOptions;
use aura_protocol::{
    AuraEvent, PromptPart,
    conversation::{ConversationTurn, ConversationTurns},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::{AgentSessionRow, ChatRecord, rows};
use crate::conversation::{ContextTurn, cut};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PendingContinuation {
    pub handoff: String,
    pub force_fresh: bool,
    pub resume_source: Option<String>,
    pub native_start: NativeStartOptions,
}

#[derive(Debug, Clone)]
pub(crate) struct ConversationSnapshot {
    pub chat: ChatRecord,
    pub next_seq: u32,
    pub latest_ordinal: u32,
    pub turns: Vec<ContextTurn>,
    pub selected: Option<ContextTurn>,
    pub target_session: Option<AgentSessionRow>,
    pub target_last_turn: Option<u32>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ApplyContinuation {
    pub source_chat: String,
    pub source_turn: Option<String>,
    pub expected_next_seq: u32,
    pub expected_updated_at: i64,
    pub expected_folder: std::path::PathBuf,
    pub expected_active_agent: String,
    pub expected_target_session: Option<(String, Option<String>)>,
    pub target_agent: String,
    pub destination_chat: Option<String>,
    pub pending: PendingContinuation,
    pub parts: Vec<PromptPart>,
}

#[derive(Clone)]
pub(crate) enum ConversationCommand {
    Turns {
        chat_id: String,
        before: Option<u32>,
    },
    Snapshot {
        chat_id: String,
        selected: Option<String>,
        target_agent: Option<String>,
        include_selected: bool,
    },
    Apply(Box<ApplyContinuation>),
}

pub(crate) enum ConversationReply {
    Turns(ConversationTurns),
    Snapshot(Box<ConversationSnapshot>),
    Applied(Box<super::ChatLoad>),
}

impl ConversationCommand {
    pub fn writes(&self) -> bool {
        matches!(self, Self::Apply(_))
    }
    pub fn bytes(&self) -> usize {
        match self {
            Self::Apply(apply) => {
                4096 + apply.pending.handoff.len()
                    + serde_json::to_string(&apply.parts).map_or(0, |value| value.len())
            }
            _ => 4096,
        }
    }
}

fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

pub(crate) fn pending(
    conn: &Connection,
    chat_id: &str,
) -> rusqlite::Result<Option<PendingContinuation>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT pending_json FROM chat_continuations WHERE chat_id=?1 AND deleted=0",
            [chat_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|json| serde_json::from_str(&json).map_err(|_| invalid("The saved continuation is damaged. Keep the source chat and create a new continuation."))).transpose()
}

pub(crate) fn execute(
    conn: &Connection,
    device: &str,
    now: i64,
    command: ConversationCommand,
) -> rusqlite::Result<ConversationReply> {
    match command {
        ConversationCommand::Turns { chat_id, before } => {
            let _ =
                rows::chat(conn, device, &chat_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let mut statement = conn.prepare("SELECT t.id,t.seq,COALESCE(s.agent_id,''),t.status,t.started_at FROM turns t LEFT JOIN agent_sessions s ON s.id=t.agent_session_id WHERE t.chat_id=?1 AND (?2 IS NULL OR t.seq<?2) ORDER BY t.seq DESC LIMIT 51")?;
            let mut turns = statement
                .query_map(params![chat_id, before], |row| {
                    Ok(ConversationTurn {
                        turn_id: row.get(0)?,
                        ordinal: row.get(1)?,
                        agent_id: row.get(2)?,
                        status: row.get(3)?,
                        started_at: row.get(4)?,
                        prompt_preview: String::new(),
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let has_more = turns.len() > 50;
            turns.truncate(50);
            for turn in &mut turns {
                turn.prompt_preview =
                    cut(&read_turn(conn, &chat_id, &turn.turn_id)?.prompt, 256).to_owned();
            }
            let before_ordinal = turns.last().map(|turn| turn.ordinal);
            Ok(ConversationReply::Turns(ConversationTurns {
                turns,
                before_ordinal,
                has_more,
            }))
        }
        ConversationCommand::Snapshot {
            chat_id,
            selected,
            target_agent,
            include_selected,
        } => {
            let chat =
                rows::chat(conn, device, &chat_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let selected = selected
                .map(|id| read_turn(conn, &chat_id, &id))
                .transpose()?;
            let latest_ordinal = conn.query_row(
                "SELECT COALESCE(MAX(seq),0) FROM turns WHERE chat_id=?1",
                [&chat_id],
                |row| row.get(0),
            )?;
            let through = selected
                .as_ref()
                .map(|turn| turn.ordinal.saturating_sub(u32::from(!include_selected)))
                .unwrap_or(latest_ordinal);
            let target = target_agent.unwrap_or_else(|| {
                selected
                    .as_ref()
                    .map_or_else(|| chat.agent_id.clone(), |turn| turn.agent_id.clone())
            });
            let target_session = rows::agent_session_for(conn, &chat_id, &target)?;
            let target_last_turn = conn.query_row(
                "SELECT MAX(seq) FROM turns WHERE chat_id=?1 AND agent_session_id=?2",
                params![chat_id, target_session.as_ref().map(|session| &session.id)],
                |row| row.get(0),
            )?;
            let ids = conn
                .prepare(
                    "SELECT id FROM turns WHERE chat_id=?1 AND seq<=?2 ORDER BY seq DESC LIMIT 201",
                )?
                .query_map(params![chat_id, through], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut turns = Vec::new();
            let mut bytes = 0;
            let mut truncated = ids.len() > 200;
            for id in ids.into_iter().take(200) {
                let turn = read_turn(conn, &chat_id, &id)?;
                bytes += turn.prompt.len() + turn.answer.len();
                if bytes > 4 * 1024 * 1024 {
                    truncated = true;
                    break;
                }
                turns.push(turn);
            }
            turns.reverse();
            Ok(ConversationReply::Snapshot(Box::new(
                ConversationSnapshot {
                    next_seq: next_seq(conn, &chat_id)?,
                    chat,
                    latest_ordinal,
                    turns,
                    selected,
                    target_session,
                    target_last_turn,
                    truncated,
                },
            )))
        }
        ConversationCommand::Apply(apply) => {
            let id = apply_change(conn, device, now, *apply)?;
            let load = rows::load_chat(conn, device, &id, 0)?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            Ok(ConversationReply::Applied(Box::new(load)))
        }
    }
}

fn next_seq(conn: &Connection, chat: &str) -> rusqlite::Result<u32> {
    conn.query_row(
        "SELECT COALESCE(MAX(seq)+1,0) FROM events WHERE chat_id=?1",
        [chat],
        |row| row.get(0),
    )
}

fn read_turn(conn: &Connection, chat_id: &str, turn_id: &str) -> rusqlite::Result<ContextTurn> {
    let (ordinal,agent_id,status,json,prefix): (u32,String,String,String,Option<String>) = conn.query_row("SELECT t.seq,COALESCE(s.agent_id,c.active_agent,''),t.status,t.prompt_parts_json,t.continuation_prefix FROM turns t JOIN chats c ON c.id=t.chat_id LEFT JOIN agent_sessions s ON s.id=t.agent_session_id WHERE t.id=?1 AND t.chat_id=?2", params![turn_id,chat_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)))?;
    if json.len() > 2 * 1024 * 1024 {
        return Err(invalid(
            "The original prompt exceeds the continuation limit.",
        ));
    }
    let mut parts: Vec<PromptPart> = serde_json::from_str(&json)
        .map_err(|_| invalid("The original prompt is not supported by this version."))?;
    let mut prompt = String::new();
    let mut messages = BTreeMap::<String, String>::new();
    let mut last_message = None;
    let mut statement = conn.prepare("SELECT payload FROM events WHERE chat_id=?1 AND turn_id=?2 AND kind IN ('user_message_delta','message_delta','message_completed') ORDER BY seq LIMIT 10001")?;
    let values = statement.query_map(params![chat_id, turn_id], |row| row.get::<_, String>(0))?;
    let mut bytes = 0;
    for (index, value) in values.enumerate() {
        let value = value?;
        bytes += value.len();
        if bytes > 4 * 1024 * 1024 || index >= 10_000 {
            return Err(invalid(
                "This turn exceeds the continuation limit. Its original transcript is still available.",
            ));
        }
        match serde_json::from_str::<AuraEvent>(&value) {
            Ok(AuraEvent::UserMessageDelta { text, .. }) => prompt.push_str(&text),
            Ok(AuraEvent::MessageDelta { message_id, text }) => {
                messages.entry(message_id).or_default().push_str(&text)
            }
            Ok(AuraEvent::MessageCompleted { message_id }) => last_message = Some(message_id),
            _ => {}
        }
    }
    if let Some(prefix) = prefix {
        if let Some(rest) = prompt.strip_prefix(&prefix) {
            prompt = rest.to_owned();
        }
        if matches!(parts.first(),Some(PromptPart::Text { text }) if text == &prefix) {
            parts.remove(0);
        }
    }
    let answer = if status == "completed" {
        last_message
            .and_then(|id| messages.remove(&id))
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(ContextTurn {
        id: turn_id.into(),
        ordinal,
        agent_id,
        status,
        prompt,
        parts,
        answer,
    })
}

fn apply_change(
    conn: &Connection,
    device: &str,
    now: i64,
    apply: ApplyContinuation,
) -> rusqlite::Result<String> {
    let source = rows::chat(conn, device, &apply.source_chat)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    if source.updated_at != apply.expected_updated_at
        || next_seq(conn, &apply.source_chat)? != apply.expected_next_seq
        || source.folder != apply.expected_folder
        || source.agent_id != apply.expected_active_agent
        || rows::agent_session_for(conn, &apply.source_chat, &apply.target_agent)?
            .map(|session| (session.id, session.native_session_id))
            != apply.expected_target_session
    {
        return Err(invalid(
            "The conversation changed after the preview. Review a new preview.",
        ));
    }
    let destination = apply
        .destination_chat
        .as_deref()
        .unwrap_or(&apply.source_chat);
    if apply.destination_chat.is_some() {
        conn.execute("INSERT INTO chats (id,project_id,folder_id,title,title_source,active_agent,created_at,updated_at,device_id,agent_host) SELECT ?2,project_id,folder_id,COALESCE(title,'Chat') || ' (fork)','manual',?3,?4,?4,?5,agent_host FROM chats WHERE id=?1 AND deleted=0", params![apply.source_chat,destination,apply.target_agent,now,device])?;
    } else {
        conn.execute(
            "UPDATE chats SET active_agent=?2,updated_at=?3,device_id=?4 WHERE id=?1 AND deleted=0",
            params![destination, apply.target_agent, now, device],
        )?;
    }
    // Only references selected from a stored source turn can copy chat-scoped attachment metadata.
    for part in &apply.parts {
        if let PromptPart::Image { blob, mime } = part {
            let item: Option<(String,String,u32)> = conn.query_row("SELECT display_name,mime,byte_length FROM composer_attachments WHERE chat_id=?1 AND sha256=?2 AND mime=?3 LIMIT 1", params![apply.source_chat,blob,mime], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
            let (name, mime, bytes) = item.ok_or_else(|| {
                invalid("A saved image is unavailable in the source chat. Attach it again.")
            })?;
            if destination != apply.source_chat {
                conn.execute("INSERT INTO composer_attachments (id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(chat_id,sha256,display_name) DO NOTHING", params![crate::ids::new_id(),destination,blob,name,mime,bytes,now])?;
            }
        }
    }
    let json = serde_json::to_string(&apply.pending)
        .map_err(|_| invalid("The continuation could not be saved."))?;
    conn.execute("INSERT INTO chat_continuations (chat_id,source_chat_id,source_turn_id,pending_json,created_at,device_id) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(chat_id) DO UPDATE SET source_chat_id=excluded.source_chat_id,source_turn_id=excluded.source_turn_id,pending_json=excluded.pending_json,created_at=excluded.created_at,device_id=excluded.device_id,deleted=0", params![destination,apply.source_chat,apply.source_turn,json,now,device])?;
    Ok(destination.into())
}
