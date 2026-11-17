//! Recovery, at startup (every chat, the writer's first op) and per chat (`load_chat`, for an actor
//! that died):
//!
//! 1. Every `PermissionRequested` and `UiRequest` without a later resolution, inside or outside a
//!    turn, is resolved `Cancelled` / dismissed `by: System`: inside a running turn before its
//!    `TurnEnded`, otherwise outside any turn.
//! 2. Every running turn gets `TurnEnded { Interrupted, recovered: true }` and is marked interrupted,
//!    ending when its last row was written; a running turn whose own `TurnEnded` row was saved (only
//!    its `EndTurn` was lost) ends as that row says instead, and gets nothing appended.
//! 3. Every ended turn not compacted yet is compacted.
//! 4. Every queued prompt is held: auracode never sends a message on its own after a restart.
//!
//! The partial answer survives; no tool update is invented. Each chat recovers in one transaction.
//! Requests are found with SQLite's JSON functions, so no payload is deserialized, and startup
//! recovery reads only the request rows stored outside turns.

use std::collections::{BTreeMap, BTreeSet};

use aura_protocol::{AuraEvent, Millis, PermissionDecision, ResolvedBy, StopReason};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use super::compact::{self, CompactLimits};
use super::{EventRow, RecoveryReport, TurnEnd, history, rows};

/// Which chats a recovery covers.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Scope<'a> {
    All,
    Chat(&'a str),
}

/// Recovers `scope`, one transaction per chat. A chat whose recovery fails is skipped (and logged)
/// unless the failure is damage, a full disk or a busy database, which the caller handles.
pub(crate) fn recover(
    conn: &mut Connection,
    scope: Scope<'_>,
    device_id: &str,
    limits: &CompactLimits,
    now: Millis,
) -> rusqlite::Result<RecoveryReport> {
    let chats = match scope {
        Scope::All => chats_needing_recovery(conn)?,
        Scope::Chat(chat_id) => vec![chat_id.to_owned()],
    };
    let mut report = RecoveryReport::default();
    for chat_id in chats {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match recover_chat(&tx, &chat_id, device_id, limits, now) {
            Ok(chat) => {
                tx.commit()?;
                report.interrupted_turns += chat.interrupted_turns;
                report.resolved_requests += chat.resolved_requests;
                report.compacted_turns += chat.compacted_turns;
            }
            Err(error) if is_fatal(&error) => return Err(error),
            Err(error) => {
                drop(tx);
                tracing::error!(chat_id, %error, "could not recover a chat; its rows stay as they are");
            }
        }
    }
    if let Scope::All = scope {
        conn.execute("UPDATE worktree_setup_attempts SET state='interrupted',detail='Setup was interrupted by a restart. Review and retry the command.' WHERE device_id=?1 AND state IN ('awaiting','running')",[device_id])?;
        rows::queue_hold(conn, None, true)?;
    }
    Ok(report)
}

/// Errors the writer handles itself: damage, a full disk, a busy database.
fn is_fatal(error: &rusqlite::Error) -> bool {
    use rusqlite::ErrorCode;
    matches!(
        error.sqlite_error_code(),
        Some(
            ErrorCode::DatabaseCorrupt
                | ErrorCode::NotADatabase
                | ErrorCode::DiskFull
                | ErrorCode::DatabaseBusy
                | ErrorCode::DatabaseLocked
        )
    )
}

/// Chats with a running turn, an ended turn not compacted yet, or an unanswered request outside any
/// turn.
///
/// Only untagged request rows are read: the actor resolves a turn's open requests before its
/// `TurnEnded`, in the same op, so a turn that ended keeps none open, and a running turn is found
/// through `turns`. Per-chat recovery reads all of a chat's request rows.
fn chats_needing_recovery(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut chats = BTreeSet::new();
    for chat in conn.prepare("SELECT DISTINCT e.chat_id FROM events e WHERE e.kind='steering_status' AND json_extract(e.payload,'$.state')='pending' AND NOT EXISTS(SELECT 1 FROM events newer WHERE newer.chat_id=e.chat_id AND newer.kind='steering_status' AND newer.seq>e.seq AND json_extract(newer.payload,'$.message_id')=json_extract(e.payload,'$.message_id'))")?.query_map([], |row| row.get::<_,String>(0))? {
        chats.insert(chat?);
    }
    let mut running =
        conn.prepare("SELECT DISTINCT chat_id FROM turns WHERE status = 'running'")?;
    for chat in running.query_map([], |row| row.get::<_, String>(0))? {
        chats.insert(chat?);
    }
    let mut uncompacted = conn.prepare(
        "SELECT DISTINCT chat_id FROM turns WHERE status <> 'running' AND compacted_at IS NULL",
    )?;
    for chat in uncompacted.query_map([], |row| row.get::<_, String>(0))? {
        chats.insert(chat?);
    }
    let mut open: BTreeMap<String, Vec<OpenRequest>> = BTreeMap::new();
    for row in request_rows(conn, None)? {
        track(open.entry(row.chat_id.clone()).or_default(), row);
    }
    chats.extend(
        open.into_iter()
            .filter(|(_, requests)| !requests.is_empty())
            .map(|(chat, _)| chat),
    );
    Ok(chats.into_iter().collect())
}

/// The kinds of request and resolution rows, as SQL.
const REQUEST_KINDS: &str =
    "'permission_requested', 'permission_resolved', 'ui_request', 'ui_resolved'";

/// A request or resolution row, as SQLite's JSON functions read it: its payload is never
/// deserialized.
struct RequestRow {
    chat_id: String,
    kind: String,
    turn_id: Option<String>,
    request_id: String,
}

/// The request and resolution rows of one chat, or the untagged ones of every chat (`None`), in seq
/// order per chat. A row that is not JSON or has no text `request_id` is skipped, as is a
/// notification: nothing answers it, so it is never open.
fn request_rows(conn: &Connection, chat_id: Option<&str>) -> rusqlite::Result<Vec<RequestRow>> {
    let scope = if chat_id.is_some() {
        "chat_id = ?1"
    } else {
        "turn_id IS NULL"
    };
    // `doc` is NULL for any other row and for one that is not JSON, whatever order SQLite checks
    // the terms in (a CASE decides in order), so the JSON functions parse request payloads only.
    let sql = format!(
        "SELECT chat_id, kind, turn_id, json_extract(doc, '$.request_id') FROM ( \
             SELECT chat_id, seq, kind, turn_id, \
                 CASE WHEN kind IN ({REQUEST_KINDS}) \
                     THEN CASE WHEN json_valid(payload) THEN payload END END AS doc \
             FROM events WHERE kind IN ({REQUEST_KINDS}) AND {scope}) \
         WHERE json_type(doc, '$.request_id') = 'text' \
           AND (kind <> 'ui_request' OR json_extract(doc, '$.prompt.type') <> 'notify') \
         ORDER BY chat_id, seq"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let read = |row: &rusqlite::Row<'_>| {
        Ok(RequestRow {
            chat_id: row.get(0)?,
            kind: row.get(1)?,
            turn_id: row.get(2)?,
            request_id: row.get(3)?,
        })
    };
    match chat_id {
        Some(chat_id) => stmt.query_map(params![chat_id], read)?.collect(),
        None => stmt.query_map([], read)?.collect(),
    }
}

/// Follows one chat's request rows in seq order: a request opens its id (in its own turn), a
/// resolution closes it.
fn track(open: &mut Vec<OpenRequest>, row: RequestRow) {
    open.retain(|request| request.id != row.request_id);
    let question = match row.kind.as_str() {
        "permission_requested" => false,
        "ui_request" => true,
        _ => return,
    };
    open.push(OpenRequest {
        id: row.request_id,
        question,
        turn_id: row.turn_id,
    });
}

/// The rows recovery adds, numbered from the chat's next seq.
struct Appender {
    next: u32,
    rows: Vec<EventRow>,
}

impl Appender {
    /// Adds a row; returns its seq.
    fn push(&mut self, turn_id: Option<&str>, event: &AuraEvent, at: Millis) -> u32 {
        let seq = self.next;
        self.rows.push(EventRow {
            seq,
            turn_id: turn_id.map(str::to_owned),
            kind: event.kind(),
            payload: serde_json::to_string(event).unwrap_or_default(),
            created_at: at,
        });
        self.next = self.next.saturating_add(1);
        seq
    }
}

/// An unanswered request: its id, whether it is a question, and the turn it was stored in.
struct OpenRequest {
    id: String,
    question: bool,
    turn_id: Option<String>,
}

pub(crate) fn recover_chat(
    conn: &Connection,
    chat_id: &str,
    device_id: &str,
    limits: &CompactLimits,
    now: Millis,
) -> rusqlite::Result<RecoveryReport> {
    let mut report = RecoveryReport::default();
    let open = open_requests(conn, chat_id)?;
    let running: Vec<(String, Millis)> = conn
        .prepare_cached(
            "SELECT id, started_at FROM turns WHERE chat_id = ?1 AND status = 'running' ORDER BY first_event_seq",
        )?
        .query_map(params![chat_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let max_seq: Option<u32> = conn
        .prepare_cached("SELECT MAX(seq) FROM events WHERE chat_id = ?1")?
        .query_row(params![chat_id], |row| row.get(0))?;
    let mut out = Appender {
        next: max_seq.map_or(0, |max| max.saturating_add(1)),
        rows: Vec::new(),
    };
    recover_steering(conn, chat_id, &mut out, now)?;

    // The running turns that end here, interrupted; their open requests are resolved inside them.
    let mut interrupted: BTreeSet<&str> = BTreeSet::new();
    for (turn_id, started_at) in &running {
        // A turn whose own `TurnEnded` was saved ended; only its `EndTurn` was lost (a crash between
        // the two commits, or an actor that died with it still queued), so it ends as that row says.
        // The actor resolved the turn's requests before that row, in the same op.
        if let Some(end) = saved_end(conn, chat_id, turn_id)? {
            rows::end_turn(conn, &end)?;
            continue;
        }
        interrupted.insert(turn_id.as_str());
        let last_at: Option<Millis> = conn
            .prepare_cached(
                "SELECT created_at FROM events WHERE turn_id = ?1 ORDER BY seq DESC LIMIT 1",
            )?
            .query_row(params![turn_id], |row| row.get(0))
            .ok();
        let ended_at = last_at.unwrap_or(*started_at);
        for request in open
            .iter()
            .filter(|request| request.turn_id.as_deref() == Some(turn_id.as_str()))
        {
            out.push(Some(turn_id), &resolution(request), ended_at);
            report.resolved_requests += 1;
        }
        let ended_seq = out.push(
            Some(turn_id),
            &AuraEvent::TurnEnded {
                turn_id: turn_id.clone(),
                stop_reason: StopReason::Interrupted,
                usage: None,
                duration_ms: None,
                recovered: true,
            },
            ended_at,
        );
        rows::append_events(conn, device_id, chat_id, &std::mem::take(&mut out.rows))?;
        conn.prepare_cached(
            "UPDATE turns SET status = 'interrupted', stop_reason = ?2, ended_at = ?3, last_event_seq = ?4 \
             WHERE id = ?1",
        )?
        .execute(params![turn_id, StopReason::Interrupted.as_str(), ended_at, ended_seq])?;
        report.interrupted_turns += 1;
    }
    for request in open.iter().filter(|request| {
        request
            .turn_id
            .as_deref()
            .is_none_or(|turn| !interrupted.contains(turn))
    }) {
        out.push(None, &resolution(request), now);
        report.resolved_requests += 1;
    }
    rows::append_events(conn, device_id, chat_id, &out.rows)?;

    let uncompacted: Vec<String> = conn
        .prepare_cached(
            "SELECT id FROM turns WHERE chat_id = ?1 AND status <> 'running' AND compacted_at IS NULL \
             ORDER BY first_event_seq",
        )?
        .query_map(params![chat_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for turn_id in uncompacted {
        if compact::apply(conn, chat_id, &turn_id, device_id, limits, now)? {
            report.compacted_turns += 1;
        }
    }
    rows::queue_hold(conn, Some(chat_id), true)?;
    Ok(report)
}

/// Restore any outcome committed just before the actor could publish it. An interrupted native
/// request without an acknowledgement remains explicitly unconfirmed and is never resent.
fn recover_steering(
    conn: &Connection,
    chat_id: &str,
    out: &mut Appender,
    now: Millis,
) -> rusqlite::Result<()> {
    use aura_protocol::composer::SteeringState;
    let values = conn.prepare("SELECT json_extract(e.payload,'$.message_id'),e.turn_id,s.state,s.detail FROM events e LEFT JOIN steering_inputs s ON s.message_id=json_extract(e.payload,'$.message_id') AND s.chat_id=e.chat_id WHERE e.chat_id=?1 AND e.kind='steering_status' AND json_extract(e.payload,'$.state')='pending' AND NOT EXISTS(SELECT 1 FROM events newer WHERE newer.chat_id=e.chat_id AND newer.kind='steering_status' AND newer.seq>e.seq AND json_extract(newer.payload,'$.message_id')=json_extract(e.payload,'$.message_id'))")?
        .query_map([chat_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,Option<String>>(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (message_id, turn_id, state, detail) in values {
        let (state, detail) = match state.as_deref() {
            Some("accepted") => (SteeringState::Accepted, detail),
            Some("rejected") => (SteeringState::Rejected, detail),
            Some("unconfirmed") => (SteeringState::Unconfirmed, detail),
            _ => (
                SteeringState::Unconfirmed,
                Some(
                    "The app closed before delivery was confirmed. This message was not retried."
                        .into(),
                ),
            ),
        };
        conn.execute("UPDATE steering_inputs SET state=?2,detail=?3,updated_at=?4 WHERE message_id=?1 AND state='pending'",params![message_id,super::steering::state_name(state),detail,now])?;
        out.push(
            turn_id.as_deref(),
            &AuraEvent::SteeringStatus {
                message_id,
                state,
                detail,
            },
            now,
        );
    }
    Ok(())
}

/// How a running turn ended, from its saved `TurnEnded` row (read leniently, as history pages read
/// it: a row that does not parse ends the turn with `Other`), when it has one.
fn saved_end(conn: &Connection, chat_id: &str, turn_id: &str) -> rusqlite::Result<Option<TurnEnd>> {
    let row: Option<(u32, String, Millis)> = conn
        .prepare_cached(
            "SELECT seq, payload, created_at FROM events \
             WHERE chat_id = ?1 AND turn_id = ?2 AND kind = 'turn_ended' ORDER BY seq DESC LIMIT 1",
        )?
        .query_row(params![chat_id, turn_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()?;
    Ok(row.map(|(seq, payload, created_at)| {
        let stop_reason = match history::parse_row("turn_ended", &payload, Some(turn_id)) {
            Some(AuraEvent::TurnEnded { stop_reason, .. }) => stop_reason,
            _ => StopReason::Other,
        };
        TurnEnd {
            turn_id: turn_id.to_owned(),
            status: rows::turn_status(stop_reason),
            stop_reason,
            ended_at: created_at,
            last_event_seq: seq,
        }
    }))
}

/// The chat's requests that never got a resolution, in the order they were asked (a request asked
/// again counts once, in its last turn).
fn open_requests(conn: &Connection, chat_id: &str) -> rusqlite::Result<Vec<OpenRequest>> {
    let mut open = Vec::new();
    for row in request_rows(conn, Some(chat_id))? {
        track(&mut open, row);
    }
    Ok(open)
}

fn resolution(request: &OpenRequest) -> AuraEvent {
    if request.question {
        AuraEvent::UiResolved {
            request_id: request.id.clone(),
            answer: None,
            by: ResolvedBy::System,
        }
    } else {
        AuraEvent::PermissionResolved {
            request_id: request.id.clone(),
            decision: PermissionDecision::Cancelled,
            by: ResolvedBy::System,
        }
    }
}

#[cfg(test)]
mod tests {
    use aura_protocol::{
        PermissionOption, PermissionOptionKind, PermissionRequest, ToolKind, UiPrompt, UiRequest,
    };

    use super::*;
    use crate::chatstore::QueuedRow;
    use crate::chatstore::test_support::{TestDb, event_row};

    fn permission(id: &str) -> AuraEvent {
        AuraEvent::PermissionRequested(PermissionRequest {
            request_id: id.into(),
            tool_call_id: None,
            title: "Run it?".into(),
            kind: Some(ToolKind::Execute),
            raw_input: None,
            content: Vec::new(),
            locations: Vec::new(),
            options: vec![PermissionOption {
                option_id: "allow".into(),
                kind: PermissionOptionKind::AllowOnce,
                label: "Allow".into(),
            }],
            truncated: None,
        })
    }

    fn question(id: &str) -> AuraEvent {
        AuraEvent::UiRequest(UiRequest {
            request_id: id.into(),
            prompt: UiPrompt::Select {
                message: "Which?".into(),
                options: vec!["a".into(), "b".into()],
            },
        })
    }

    fn delta(id: &str, text: &str) -> AuraEvent {
        AuraEvent::MessageDelta {
            message_id: id.into(),
            text: text.into(),
        }
    }

    /// S1: a running turn ends interrupted and recovered, its open card resolved before its
    /// `TurnEnded`, compacted, the partial message kept.
    #[test]
    fn recovery_interrupts_running_turns() {
        let mut db = TestDb::new();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        db.append(
            &chat,
            &[
                event_row(
                    0,
                    Some("t1"),
                    &AuraEvent::TurnStarted {
                        turn_id: "t1".into(),
                        prompt_id: Some("p".into()),
                    },
                ),
                event_row(1, Some("t1"), &delta("t1.m1", "Half an ")),
                event_row(2, Some("t1"), &delta("t1.m1", "answer")),
                event_row(3, Some("t1"), &permission("t1.p1")),
            ],
        );
        let report = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            50,
        )
        .expect("recover");
        assert_eq!(
            report,
            RecoveryReport {
                interrupted_turns: 1,
                resolved_requests: 1,
                compacted_turns: 1
            }
        );
        let events = db.events(&chat);
        let tail: Vec<_> = events
            .iter()
            .map(|(seq, turn, event)| (*seq, turn.clone(), event.kind()))
            .collect();
        assert_eq!(
            tail,
            [
                (0, Some("t1".into()), "turn_started"),
                (1, Some("t1".into()), "message_delta"),
                (3, Some("t1".into()), "permission_requested"),
                (4, Some("t1".into()), "permission_resolved"),
                (5, Some("t1".into()), "turn_ended"),
            ]
        );
        assert_eq!(events[1].2, delta("t1.m1", "Half an answer"));
        assert_eq!(
            events[3].2,
            AuraEvent::PermissionResolved {
                request_id: "t1.p1".into(),
                decision: PermissionDecision::Cancelled,
                by: ResolvedBy::System
            }
        );
        assert_eq!(
            events[4].2,
            AuraEvent::TurnEnded {
                turn_id: "t1".into(),
                stop_reason: StopReason::Interrupted,
                usage: None,
                duration_ms: None,
                recovered: true
            }
        );
        let (status, stop_reason, ended_at, last): (String, String, i64, i64) = db
            .conn()
            .query_row(
                "SELECT status, stop_reason, ended_at, last_event_seq FROM turns WHERE id = 't1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("turn");
        assert_eq!(
            (status.as_str(), stop_reason.as_str(), ended_at, last),
            ("interrupted", "interrupted", 3, 5)
        );
        // A second recovery finds nothing to do.
        let again = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            60,
        )
        .expect("again");
        assert_eq!(again, RecoveryReport::default());
    }

    /// A running turn whose own `TurnEnded` was saved (its `EndTurn` was lost between the two
    /// commits) ends as that row says: nothing is appended, the turn takes the row's reason, time
    /// and seq, and it is compacted. A saved end that does not parse reads as `Other`.
    #[test]
    fn a_running_turn_whose_end_was_saved_ends_as_saved() {
        let mut db = TestDb::new();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        db.turn(&chat, "t2", 2, 3);
        let started = |turn: &str| AuraEvent::TurnStarted {
            turn_id: turn.into(),
            prompt_id: None,
        };
        let mut garbled = event_row(5, Some("t2"), &started("t2"));
        garbled.kind = "turn_ended";
        garbled.payload =
            r#"{"type":"turn_ended","turn_id":"t2","stop_reason":"teleported","usage":7}"#.into();
        db.append(
            &chat,
            &[
                event_row(0, Some("t1"), &started("t1")),
                event_row(1, Some("t1"), &delta("t1.m1", "All done")),
                event_row(
                    2,
                    Some("t1"),
                    &AuraEvent::TurnEnded {
                        turn_id: "t1".into(),
                        stop_reason: StopReason::EndTurn,
                        usage: None,
                        duration_ms: Some(9),
                        recovered: false,
                    },
                ),
                event_row(3, Some("t2"), &started("t2")),
                event_row(4, Some("t2"), &delta("t2.m1", "Also done")),
                garbled,
            ],
        );
        let report = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            50,
        )
        .expect("recover");
        assert_eq!(
            report,
            RecoveryReport {
                interrupted_turns: 0,
                resolved_requests: 0,
                compacted_turns: 2
            }
        );
        let seqs: Vec<u32> = db
            .conn()
            .prepare("SELECT seq FROM events WHERE chat_id = ?1 ORDER BY seq")
            .expect("prepare")
            .query_map(params![chat], |row| row.get(0))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(seqs, [0, 1, 2, 3, 4, 5], "nothing appended");
        let turn = |id: &str| -> (String, String, i64, i64, bool) {
            db.conn()
                .query_row(
                    "SELECT status, stop_reason, ended_at, last_event_seq, compacted_at IS NOT NULL \
                     FROM turns WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .expect("turn")
        };
        assert_eq!(
            turn("t1"),
            ("completed".into(), "end_turn".into(), 2, 2, true)
        );
        assert_eq!(turn("t2"), ("completed".into(), "other".into(), 5, 5, true));
        let again = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            60,
        )
        .expect("again");
        assert_eq!(again, RecoveryReport::default());
    }

    /// S37: cards and questions open outside a turn (or in an ended one) are resolved `System`
    /// outside any turn; answered ones and notifications are left alone; queued prompts are held.
    #[test]
    fn recovery_resolves_outside_turn_requests() {
        let mut db = TestDb::new();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        db.append(
            &chat,
            &[
                event_row(
                    0,
                    Some("t1"),
                    &AuraEvent::TurnStarted {
                        turn_id: "t1".into(),
                        prompt_id: None,
                    },
                ),
                event_row(1, Some("t1"), &permission("t1.p1")),
                event_row(
                    2,
                    Some("t1"),
                    &AuraEvent::TurnEnded {
                        turn_id: "t1".into(),
                        stop_reason: StopReason::EndTurn,
                        usage: None,
                        duration_ms: None,
                        recovered: false,
                    },
                ),
                event_row(3, None, &permission("s.p1")),
                event_row(4, None, &question("s.p2")),
                event_row(5, None, &permission("s.p3")),
                event_row(
                    6,
                    None,
                    &AuraEvent::PermissionResolved {
                        request_id: "s.p3".into(),
                        decision: PermissionDecision::Cancelled,
                        by: ResolvedBy::User,
                    },
                ),
                event_row(
                    7,
                    None,
                    &AuraEvent::UiRequest(UiRequest {
                        request_id: "s.n".into(),
                        prompt: UiPrompt::Notify {
                            message: "fyi".into(),
                        },
                    }),
                ),
            ],
        );
        db.conn()
            .execute("UPDATE turns SET status = 'completed'", [])
            .expect("end");
        rows::queue_put(
            db.conn(),
            "dev",
            &QueuedRow {
                parts: Vec::new(),
                id: "q".into(),
                chat_id: chat.clone(),
                text: "next".into(),
                held: false,
                created_at: 1,
            },
        )
        .expect("queue");
        let report = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            77,
        )
        .expect("recover");
        assert_eq!(report.resolved_requests, 3);
        assert_eq!(report.interrupted_turns, 0);
        assert_eq!(report.compacted_turns, 1);
        let added: Vec<_> = db
            .events(&chat)
            .into_iter()
            .filter(|(seq, _, _)| *seq >= 8)
            .collect();
        assert_eq!(
            added,
            [
                (
                    8,
                    None,
                    AuraEvent::PermissionResolved {
                        request_id: "t1.p1".into(),
                        decision: PermissionDecision::Cancelled,
                        by: ResolvedBy::System
                    }
                ),
                (
                    9,
                    None,
                    AuraEvent::PermissionResolved {
                        request_id: "s.p1".into(),
                        decision: PermissionDecision::Cancelled,
                        by: ResolvedBy::System
                    }
                ),
                (
                    10,
                    None,
                    AuraEvent::UiResolved {
                        request_id: "s.p2".into(),
                        answer: None,
                        by: ResolvedBy::System
                    }
                ),
            ]
        );
        assert!(rows::queued(db.conn(), &chat).expect("queue")[0].held);
    }

    /// Startup recovery finds unanswered requests with SQLite's JSON functions and reads only
    /// untagged rows: a request asked twice is resolved once, a row that is not JSON and a
    /// notification are skipped, and a chat with nothing open is left alone. A request a turn left
    /// open breaks the actor's invariant; per-chat recovery, which reads every row, still resolves it.
    #[test]
    fn recovery_finds_open_requests_without_deserializing() {
        let mut db = TestDb::new();
        let lone = db.chat("/lone");
        let mut garbage = event_row(2, None, &permission("x"));
        garbage.payload = "not json".into();
        db.append(
            &lone,
            &[
                event_row(0, None, &permission("a1")),
                event_row(1, None, &permission("a1")),
                garbage,
                event_row(
                    3,
                    None,
                    &AuraEvent::UiRequest(UiRequest {
                        request_id: "a2".into(),
                        prompt: UiPrompt::Notify {
                            message: "fyi".into(),
                        },
                    }),
                ),
                event_row(4, None, &question("a3")),
                event_row(
                    5,
                    None,
                    &AuraEvent::UiResolved {
                        request_id: "a3".into(),
                        answer: None,
                        by: ResolvedBy::User,
                    },
                ),
            ],
        );
        let quiet = db.chat("/quiet");
        let odd = db.chat("/odd");
        for (chat, turn) in [(&quiet, "tq"), (&odd, "to")] {
            db.turn(chat, turn, 1, 0);
            db.conn()
                .execute(
                    "UPDATE turns SET status = 'completed', compacted_at = 1 WHERE id = ?1",
                    params![turn],
                )
                .expect("ended and compacted");
        }
        let resolved = |id: &str| AuraEvent::PermissionResolved {
            request_id: id.into(),
            decision: PermissionDecision::Cancelled,
            by: ResolvedBy::User,
        };
        db.append(
            &quiet,
            &[
                event_row(0, Some("tq"), &permission("q1")),
                event_row(1, Some("tq"), &resolved("q1")),
                event_row(2, None, &permission("q2")),
                event_row(3, None, &resolved("q2")),
            ],
        );
        db.append(&odd, &[event_row(0, Some("to"), &permission("o1"))]);

        let report = recover(
            db.store.conn_mut(),
            Scope::All,
            "dev",
            &CompactLimits::STANDARD,
            9,
        )
        .expect("recover");
        assert_eq!(
            report,
            RecoveryReport {
                interrupted_turns: 0,
                resolved_requests: 1,
                compacted_turns: 0
            }
        );
        let added: String = db
            .conn()
            .query_row(
                "SELECT payload FROM events WHERE chat_id = ?1 AND seq = 6",
                params![lone],
                |row| row.get(0),
            )
            .expect("one resolution");
        assert_eq!(
            serde_json::from_str::<AuraEvent>(&added).expect("parse"),
            AuraEvent::PermissionResolved {
                request_id: "a1".into(),
                decision: PermissionDecision::Cancelled,
                by: ResolvedBy::System
            }
        );
        let count = |chat: &str| -> i64 {
            db.conn()
                .query_row(
                    "SELECT count(*) FROM events WHERE chat_id = ?1",
                    params![chat],
                    |row| row.get(0),
                )
                .expect("count")
        };
        assert_eq!(
            (count(&lone), count(&quiet), count(&odd)),
            (7, 4, 1),
            "only the lone chat changed"
        );

        let odd_report = recover(
            db.store.conn_mut(),
            Scope::Chat(&odd),
            "dev",
            &CompactLimits::STANDARD,
            10,
        )
        .expect("per chat");
        assert_eq!(odd_report.resolved_requests, 1);
        assert_eq!(
            db.events(&odd)[1],
            (
                1,
                None,
                AuraEvent::PermissionResolved {
                    request_id: "o1".into(),
                    decision: PermissionDecision::Cancelled,
                    by: ResolvedBy::System
                }
            )
        );
    }

    #[test]
    fn per_chat_recovery_touches_only_that_chat() {
        let mut db = TestDb::new();
        let a = db.chat("/a");
        let b = db.chat("/b");
        for (chat, turn) in [(&a, "ta"), (&b, "tb")] {
            db.turn(chat, turn, 1, 0);
            db.append(
                chat,
                &[event_row(
                    0,
                    Some(turn),
                    &AuraEvent::TurnStarted {
                        turn_id: turn.into(),
                        prompt_id: None,
                    },
                )],
            );
        }
        let report = recover(
            db.store.conn_mut(),
            Scope::Chat(&a),
            "dev",
            &CompactLimits::STANDARD,
            5,
        )
        .expect("recover");
        assert_eq!(report.interrupted_turns, 1);
        let status = |turn: &str| -> String {
            db.conn()
                .query_row(
                    "SELECT status FROM turns WHERE id = ?1",
                    params![turn],
                    |row| row.get(0),
                )
                .expect("status")
        };
        assert_eq!(status("ta"), "interrupted");
        assert_eq!(status("tb"), "running");
    }
}
