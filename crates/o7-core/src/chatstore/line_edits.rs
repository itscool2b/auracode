//! The Dashboard's line edits: how many lines agents' edit tools changed, by quarter hour.
//!
//! - **What counts.** A completed tool call that edited files: a diff the agent attached (ACP
//!   agents' old and new text), an edit's own input (Claude Code's Edit, MultiEdit, Write and
//!   NotebookEdit, Pi's edit and write: the text replaced and its replacement, or a file's new
//!   text) and Codex's file changes (a hunk per changed file, or a new file's text). A changed line
//!   counts once: each stretch of changes counts the larger of the lines it removed and the lines
//!   it added, so a rewritten line is one edit and a new file is its length. Failed and unfinished
//!   calls count nothing, nor do files changed by commands, nor subagents' edits (their steps carry
//!   no input).
//! - **When.** A turn is counted once it has ended, the next time the Dashboard asks, the newest
//!   first. Counting reads on a read-only connection of its own ([`count_pass`]), never on the
//!   writer: one turn can hold hundreds of megabytes of tool events (a long command's streamed
//!   output), and the writer carries every live chat. Only edit calls and their updates are read
//!   (SQLite picks them out), folded as compaction folds them, so a turn counts the same before
//!   and after compaction; an edit cut to fit the event budget is read whole from the blob of the
//!   event that last set its input, once it is known to have completed.
//!   What a pass counted is saved through the writer in one short transaction ([`save`]).
//! - **What is kept.** `line_edits` holds the turn, its chat, its agent, the quarter hour and the
//!   count: no paths and no text. Deleted chats and projects drop out of [`read`].

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration;

use o7_protocol::activity::LineEditBucket;
use o7_protocol::{Millis, O7Event, ToolCall, ToolContent, ToolKind, ToolStatus, Truncation};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;

use super::compact::apply_update;
use super::files::Attachments;

/// Edits are kept by the quarter hour they were made in: every time zone's day starts on one.
pub(crate) const BUCKET_MS: Millis = 15 * 60 * 1000;

/// One pass counts at most this many turns...
const PASS_TURNS: usize = 8;

/// ...and stops once it has read this much of their edits.
const PASS_BYTES: u64 = 32 * 1024 * 1024;

/// The longest changed stretch, on either side, compared line by line (as the chat's diff does);
/// a longer one counts as the larger side.
const MAX_DIFF_LINES: usize = 2000;

/// A blob larger than this is not read for counting: its call counts what its row kept.
const MAX_BLOB_READ: u64 = 16 * 1024 * 1024;

/// An ended turn not counted yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Uncounted {
    pub(crate) turn_id: String,
    pub(crate) chat_id: String,
    pub(crate) agent: String,
}

/// A counted turn: the lines its edits changed, by quarter hour (none for a turn without edits).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Counted {
    pub(crate) turn: Uncounted,
    pub(crate) buckets: BTreeMap<Millis, u64>,
}

/// Counts one pass of the newest ended turns not counted yet, on a read-only connection to the
/// profile's database, off the writer. Returns what it counted and whether turns still wait.
pub(crate) fn count_pass(
    db: &Path,
    attachments: &Attachments,
) -> rusqlite::Result<(Vec<Counted>, bool)> {
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(5))?;
    count_with(&conn, attachments)
}

/// [`count_pass`] on a connection.
pub(crate) fn count_with(
    conn: &Connection,
    attachments: &Attachments,
) -> rusqlite::Result<(Vec<Counted>, bool)> {
    let turns: Vec<Uncounted> = conn
        .prepare_cached(
            "SELECT t.id, t.chat_id, COALESCE(t.source_agent, s.agent_id, c.active_agent, '') \
             FROM turns t JOIN chats c ON c.id = t.chat_id \
             LEFT JOIN agent_sessions s ON s.id = t.agent_session_id \
             WHERE t.edits_counted_at IS NULL AND t.status <> 'running' \
             ORDER BY t.started_at DESC LIMIT ?1",
        )?
        .query_map(params![PASS_TURNS as i64 + 1], |row| {
            Ok(Uncounted {
                turn_id: row.get(0)?,
                chat_id: row.get(1)?,
                agent: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let more = turns.len() > PASS_TURNS;
    let mut counted = Vec::new();
    let mut read = 0u64;
    for turn in turns.into_iter().take(PASS_TURNS) {
        if read >= PASS_BYTES {
            return Ok((counted, true));
        }
        let (buckets, bytes) = count_turn(conn, attachments, &turn.turn_id)?;
        read = read.saturating_add(bytes);
        counted.push(Counted { turn, buckets });
    }
    Ok((counted, more))
}

/// Saves what a pass counted, in the caller's transaction. A turn is saved once: one that was
/// counted meanwhile (by another pass) keeps the figures it has.
pub(crate) fn save(conn: &Connection, counted: &[Counted], now: Millis) -> rusqlite::Result<()> {
    let mut mark = conn.prepare_cached(
        "UPDATE turns SET edits_counted_at = ?2 WHERE id = ?1 AND edits_counted_at IS NULL",
    )?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO line_edits (turn_id, chat_id, agent, at, lines) VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT (turn_id, at) DO UPDATE SET lines = excluded.lines",
    )?;
    for Counted { turn, buckets } in counted {
        if mark.execute(params![turn.turn_id, now])? == 0 {
            continue;
        }
        for (at, lines) in buckets {
            let lines = i64::try_from(*lines).unwrap_or(i64::MAX);
            insert.execute(params![turn.turn_id, turn.chat_id, turn.agent, at, lines])?;
        }
    }
    Ok(())
}

/// Every agent's line edits since `since`, by quarter hour, oldest first. Chats and projects that
/// were deleted are left out; archived ones stay, since their edits were made.
pub(crate) fn read(conn: &Connection, since: Millis) -> rusqlite::Result<Vec<LineEditBucket>> {
    let since = since - since.rem_euclid(BUCKET_MS);
    conn.prepare_cached(
        "SELECT e.agent, e.at, SUM(e.lines) FROM line_edits e \
         JOIN chats c ON c.id = e.chat_id JOIN projects p ON p.id = c.project_id \
         WHERE e.at >= ?1 AND c.deleted = 0 AND p.deleted = 0 \
         GROUP BY e.at, e.agent ORDER BY e.at, e.agent",
    )?
    .query_map(params![since], |row| {
        let lines: i64 = row.get(2)?;
        Ok(LineEditBucket {
            agent: row.get(0)?,
            at: row.get(1)?,
            lines: u32::try_from(lines.max(0)).unwrap_or(u32::MAX),
        })
    })?
    .collect()
}

/// An edit call folded from its stored events, with the cut events that last set its input and
/// its content. A streamed edit sends thousands of updates, each cut and each with a blob of the
/// whole input so far: only the last one that set a field matters, so only its blob is read, and
/// only for a completed call whose field is still a cut preview ([`restore`]).
struct Folded {
    call: ToolCall,
    at: Millis,
    input_cut: Option<Truncation>,
    content_cut: Option<Truncation>,
}

/// The lines one turn's completed edits changed, by quarter hour, and how many bytes it read. Only
/// the turn's edit calls and their updates are read: SQLite picks them out of the turn's events.
fn count_turn(
    conn: &Connection,
    attachments: &Attachments,
    turn_id: &str,
) -> rusqlite::Result<(BTreeMap<Millis, u64>, u64)> {
    let mut calls: HashMap<String, Folded> = HashMap::new();
    let mut read = 0u64;
    // A row that is not JSON (a salvaged one) reads as NULL here instead of failing the turn, and
    // with it every turn after it.
    {
        let mut stmt = conn.prepare_cached(
            "SELECT payload, created_at FROM events \
             WHERE turn_id = ?1 AND kind = 'tool_call' AND json_extract(\
             CASE WHEN json_valid(payload) THEN payload END, '$.kind') = 'edit' ORDER BY seq",
        )?;
        let mut rows = stmt.query(params![turn_id])?;
        while let Some(row) = rows.next()? {
            let payload: String = row.get(0)?;
            let at: Millis = row.get(1)?;
            read = read.saturating_add(payload.len() as u64);
            let Ok(O7Event::ToolCall(call)) = serde_json::from_str::<O7Event>(&payload) else {
                continue;
            };
            let at = calls.get(&call.tool_call_id).map_or(at, |folded| folded.at);
            let cut = call.truncated.clone();
            calls.insert(
                call.tool_call_id.clone(),
                Folded {
                    call,
                    at,
                    input_cut: cut.clone(),
                    content_cut: cut,
                },
            );
        }
    }
    if calls.is_empty() {
        return Ok((BTreeMap::new(), read));
    }
    let ids = serde_json::to_string(&calls.keys().collect::<Vec<_>>()).unwrap_or_default();
    let mut stmt = conn.prepare_cached(
        "SELECT payload FROM events \
         WHERE turn_id = ?1 AND kind = 'tool_update' AND json_extract(\
         CASE WHEN json_valid(payload) THEN payload END, '$.tool_call_id') \
         IN (SELECT value FROM json_each(?2)) ORDER BY seq",
    )?;
    let mut rows = stmt.query(params![turn_id, ids])?;
    while let Some(row) = rows.next()? {
        let payload: String = row.get(0)?;
        read = read.saturating_add(payload.len() as u64);
        let Ok(O7Event::ToolUpdate(update)) = serde_json::from_str::<O7Event>(&payload) else {
            continue;
        };
        let Some(mut folded) = calls.remove(&update.tool_call_id) else {
            continue;
        };
        if update.raw_input.is_some() {
            folded.input_cut = update.truncated.clone();
        }
        if update.content.is_some() {
            folded.content_cut = update.truncated.clone();
        }
        let id = update.tool_call_id.clone();
        folded.call = apply_update(folded.call, update);
        calls.insert(id, folded);
    }
    let mut buckets = BTreeMap::new();
    for folded in calls.into_values() {
        if folded.call.status != ToolStatus::Completed {
            continue;
        }
        let at = folded.at;
        let call = restore(folded, attachments, &mut read);
        let lines = edit_lines(&call, &mut |cut| blob(attachments, cut, &mut read));
        if lines > 0 {
            let bucket = buckets.entry(at - at.rem_euclid(BUCKET_MS)).or_insert(0u64);
            *bucket = bucket.saturating_add(lines);
        }
    }
    Ok((buckets, read))
}

/// The call with the input and content its agent sent, where what was kept is a cut preview and
/// the event that last set it holds it whole in its blob.
fn restore(folded: Folded, attachments: &Attachments, read: &mut u64) -> ToolCall {
    let Folded {
        mut call,
        input_cut,
        content_cut,
        ..
    } = folded;
    let id = call.tool_call_id.clone();
    let mut original = |cut: &Truncation| -> Option<(Option<Value>, Option<Vec<ToolContent>>)> {
        let bytes = blob(attachments, cut, read)?;
        match serde_json::from_slice::<O7Event>(&bytes).ok()? {
            O7Event::ToolCall(whole) if whole.tool_call_id == id => {
                Some((whole.raw_input, Some(whole.content)))
            }
            O7Event::ToolUpdate(whole) if whole.tool_call_id == id => {
                Some((whole.raw_input, whole.content))
            }
            _ => None,
        }
    };
    let input_previewed = call
        .raw_input
        .as_ref()
        .is_some_and(|input| input.get("_auracode_truncated").is_some());
    let content_cut_short = call.content.is_empty()
        || call.content.iter().any(|entry| match entry {
            ToolContent::Text { truncated, .. }
            | ToolContent::Diff { truncated, .. }
            | ToolContent::Terminal { truncated, .. } => truncated.is_some(),
        });
    let mut content_restored = false;
    if input_previewed
        && let Some(cut) = &input_cut
        && let Some((input, content)) = original(cut)
    {
        if input.is_some() {
            call.raw_input = input;
        }
        // One event cut both: its blob already holds the content too.
        if content_cut.as_ref() == Some(cut)
            && let Some(content) = content
        {
            call.content = content;
            content_restored = true;
        }
    }
    if !content_restored
        && content_cut_short
        && let Some(cut) = &content_cut
        && let Some((_, Some(content))) = original(cut)
    {
        call.content = content;
    }
    call
}

/// A blob's bytes, when it is small enough to count from; counted into `read`.
fn blob(attachments: &Attachments, cut: &Truncation, read: &mut u64) -> Option<Vec<u8>> {
    let bytes = attachments.read_all(cut.blob.as_deref()?, MAX_BLOB_READ)?;
    *read = read.saturating_add(bytes.len() as u64);
    Some(bytes)
}

/// The lines one completed call changed; 0 for a call that edits nothing readable here.
fn edit_lines(call: &ToolCall, blob: &mut impl FnMut(&Truncation) -> Option<Vec<u8>>) -> u64 {
    let mut diffs = false;
    let mut lines = 0u64;
    for content in &call.content {
        let ToolContent::Diff {
            old_text,
            new_text,
            truncated,
            ..
        } = content
        else {
            continue;
        };
        diffs = true;
        let emptied = new_text.is_empty() && old_text.as_deref().is_none_or(str::is_empty);
        let counted = match truncated.as_ref().filter(|_| emptied) {
            // An emptied diff: its texts are in the blob, as {"old_text", "new_text"}.
            Some(cut) => blob(cut)
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .map_or(0, |texts| {
                    changed(text(&texts, "old_text"), text(&texts, "new_text"))
                }),
            None => changed(old_text.as_deref().unwrap_or(""), new_text),
        };
        lines = lines.saturating_add(counted);
    }
    if diffs || call.kind != ToolKind::Edit {
        return lines;
    }
    call.raw_input.as_ref().map_or(0, input_lines)
}

/// The lines an edit tool's input changes, read by its fields' names: the text replaced and its
/// replacement, several of those, a file's whole new text, or Codex's changes.
fn input_lines(input: &Value) -> u64 {
    if let Some(edits) = input.get("edits").and_then(Value::as_array) {
        return edits.iter().map(input_lines).fold(0, u64::saturating_add);
    }
    if let Some(changes) = input.get("changes").and_then(Value::as_array) {
        return changes
            .iter()
            .map(|change| {
                let diff = text(change, "diff");
                match change.pointer("/kind/type").and_then(Value::as_str) {
                    Some("update") => patch_lines(diff),
                    // A new file's text, or a deleted one's.
                    _ => line_count(diff),
                }
            })
            .fold(0, u64::saturating_add);
    }
    for (old, new) in [("old_string", "new_string"), ("oldText", "newText")] {
        if input.get(old).is_some() || input.get(new).is_some() {
            return changed(text(input, old), text(input, new));
        }
    }
    for whole in ["content", "new_source"] {
        if let Some(written) = input.get(whole).and_then(Value::as_str) {
            return line_count(written);
        }
    }
    0
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Lines of `text`, without the empty entry a trailing newline would add (as the chat's diff
/// splits them), each without a carriage return.
fn split(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

fn line_count(text: &str) -> u64 {
    split(text).len() as u64
}

/// The lines a change from `old` to `new` edits: in each stretch of changed lines, the larger of
/// the lines removed and the lines added. A longest common subsequence over the lines, after
/// setting aside the lines both start and end with, as the chat's diff compares them.
pub(crate) fn changed(old: &str, new: &str) -> u64 {
    let before = split(old);
    let after = split(new);
    let head = before
        .iter()
        .zip(&after)
        .take_while(|(a, b)| a == b)
        .count();
    let tail = before[head..]
        .iter()
        .rev()
        .zip(after[head..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let old = &before[head..before.len() - tail];
    let new = &after[head..after.len() - tail];
    let (n, m) = (old.len(), new.len());
    if n == 0 || m == 0 || n > MAX_DIFF_LINES || m > MAX_DIFF_LINES {
        return n.max(m) as u64;
    }
    // `common[i][j]`: the longest common subsequence of `old[i..]` and `new[j..]`.
    let width = m + 1;
    let mut common = vec![0u16; (n + 1) * width];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            common[i * width + j] = if old[i] == new[j] {
                common[(i + 1) * width + j + 1] + 1
            } else {
                common[(i + 1) * width + j].max(common[i * width + j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let (mut removed, mut added, mut total) = (0u64, 0u64, 0u64);
    while i < n && j < m {
        if old[i] == new[j] {
            total += removed.max(added);
            (removed, added) = (0, 0);
            i += 1;
            j += 1;
        } else if common[(i + 1) * width + j] >= common[i * width + j + 1] {
            removed += 1;
            i += 1;
        } else {
            added += 1;
            j += 1;
        }
    }
    removed += (n - i) as u64;
    added += (m - j) as u64;
    total + removed.max(added)
}

/// The lines a unified diff's hunks edit, counted as [`changed`] counts them. Headers before the
/// first hunk are skipped; a diff with no header counts from its first line.
fn patch_lines(diff: &str) -> u64 {
    let mut in_hunk = !(diff.starts_with("--- ") || diff.starts_with("diff "));
    let (mut removed, mut added, mut total) = (0u64, 0u64, 0u64);
    for line in diff.lines() {
        if line.starts_with("@@") {
            in_hunk = true;
            total += removed.max(added);
            (removed, added) = (0, 0);
            continue;
        }
        if !in_hunk {
            continue;
        }
        match line.as_bytes().first() {
            Some(b'+') => added += 1,
            Some(b'-') => removed += 1,
            // "\ No newline at end of file"
            Some(b'\\') => {}
            _ => {
                total += removed.max(added);
                (removed, added) = (0, 0);
            }
        }
    }
    total + removed.max(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chatstore::test_support::{TestDb, event_row};
    use crate::chatstore::{EventRow, blobs};
    use o7_protocol::{StopReason, ToolUpdate};
    use serde_json::json;

    const DAY: Millis = 24 * 60 * 60 * 1000;

    fn call(id: &str, tool: &str, status: ToolStatus, raw: Value) -> ToolCall {
        ToolCall {
            tool_call_id: id.into(),
            kind: ToolKind::Edit,
            title: format!("{tool} file"),
            status,
            locations: Vec::new(),
            raw_input: Some(raw),
            tool_name: Some(tool.into()),
            content: Vec::new(),
            truncated: None,
        }
    }

    fn update(id: &str, status: ToolStatus) -> ToolUpdate {
        ToolUpdate {
            tool_call_id: id.into(),
            status: Some(status),
            title: None,
            kind: None,
            locations: None,
            raw_input: None,
            tool_name: None,
            content: None,
            truncated: None,
        }
    }

    fn at(seq: u32, turn: &str, created_at: Millis, event: &O7Event) -> EventRow {
        EventRow {
            created_at,
            ..event_row(seq, Some(turn), event)
        }
    }

    fn end(db: &TestDb, turn: &str) {
        db.conn()
            .execute(
                "UPDATE turns SET status = 'completed' WHERE id = ?1",
                params![turn],
            )
            .expect("end");
    }

    fn attachments() -> (tempfile::TempDir, Attachments) {
        let dir = tempfile::tempdir().expect("attachments");
        let attachments = Attachments::new(dir.path().to_path_buf());
        (dir, attachments)
    }

    /// Counts one pass and saves it, as the store does; returns whether turns still wait.
    fn pass(db: &TestDb, attachments: &Attachments, now: Millis) -> bool {
        let (counted, more) = count_with(db.conn(), attachments).expect("count");
        save(db.conn(), &counted, now).expect("save");
        more
    }

    fn count_all(db: &TestDb, attachments: &Attachments) {
        while pass(db, attachments, 99) {}
    }

    #[test]
    fn a_rewritten_line_counts_once_and_a_new_file_its_length() {
        assert_eq!(changed("a\nb\nc\n", "a\nB\nc\n"), 1);
        assert_eq!(changed("", "one\ntwo\nthree\n"), 3);
        assert_eq!(changed("one\ntwo\n", ""), 2);
        assert_eq!(changed("same\n", "same\n"), 0);
        // Two stretches apart, one a replacement of two by three lines, one a removal.
        assert_eq!(
            changed("a\nb\nc\nd\ne\nf\ng\n", "a\nB1\nB2\nB3\nd\ne\ng\n"),
            4
        );
        // Line endings do not make every line differ.
        assert_eq!(changed("a\r\nb\r\n", "a\nb\nc\n"), 1);
    }

    #[test]
    fn hunks_count_their_changed_stretches() {
        let diff = "@@ -1,3 +1,4 @@\n keep\n-old\n+new\n+added\n keep\n@@ -9 +10 @@\n-gone\n\\ No newline at end of file\n";
        assert_eq!(patch_lines(diff), 3);
        let with_headers = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
        assert_eq!(patch_lines(with_headers), 1);
        assert_eq!(patch_lines("+content for x"), 1);
    }

    #[test]
    fn edit_inputs_count_by_their_fields() {
        let count = |raw: Value| input_lines(&raw);
        assert_eq!(
            count(json!({"file_path":"a","old_string":"x\ny","new_string":"x\nz\nw"})),
            2
        );
        assert_eq!(
            count(
                json!({"edits":[{"old_string":"a","new_string":"b"},{"old_string":"","new_string":"c\nd"}]})
            ),
            3
        );
        assert_eq!(count(json!({"file_path":"a","content":"1\n2\n3\n"})), 3);
        assert_eq!(count(json!({"path":"a","oldText":"q","newText":"r"})), 1);
        assert_eq!(
            count(json!({"notebook_path":"n","new_source":"x = 1\ny = 2"})),
            2
        );
        assert_eq!(
            count(json!({"type":"fileChange","changes":[
                {"path":"a","kind":{"type":"update","move_path":null},"diff":"@@ -1 +1,2 @@\n-a\n+b\n+c\n"},
                {"path":"b","kind":{"type":"add"},"diff":"one\ntwo\n"}
            ]})),
            4
        );
        // A preview of a cut input names no edit.
        assert_eq!(
            count(json!({"_auracode_truncated":true,"bytes":9000,"preview":"{\"content\":"})),
            0
        );
    }

    #[test]
    fn a_turn_counts_its_completed_edits_once_by_quarter_hour() {
        let db = TestDb::new();
        let (_dir, attachments) = attachments();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        let start = 20 * DAY + 5 * 60 * 1000;
        let edit = call(
            "t1.a",
            "Edit",
            ToolStatus::InProgress,
            json!({"file_path":"a","old_string":"one","new_string":"two\nthree"}),
        );
        let write = call(
            "t1.b",
            "Write",
            ToolStatus::Completed,
            json!({"file_path":"b","content":"1\n2\n3\n4\n"}),
        );
        let failed = call(
            "t1.c",
            "Write",
            ToolStatus::Failed,
            json!({"file_path":"c","content":"x\n"}),
        );
        let mut reading = call(
            "t1.d",
            "Read",
            ToolStatus::Completed,
            json!({"content":"x\n"}),
        );
        reading.kind = ToolKind::Read;
        db.append(
            &chat,
            &[
                at(0, "t1", start, &O7Event::ToolCall(edit)),
                at(1, "t1", start + 1, &O7Event::ToolCall(failed)),
                at(2, "t1", start + 2, &O7Event::ToolCall(reading)),
                at(
                    3,
                    "t1",
                    start + 3,
                    &O7Event::ToolUpdate(update("t1.a", ToolStatus::Completed)),
                ),
                // The next quarter hour.
                at(4, "t1", start + BUCKET_MS, &O7Event::ToolCall(write)),
            ],
        );
        // A running turn waits.
        assert!(!pass(&db, &attachments, 7));
        assert!(read_all(&db).is_empty());
        end(&db, "t1");
        assert!(!pass(&db, &attachments, 7));
        let quarter = start - start.rem_euclid(BUCKET_MS);
        assert_eq!(
            read_all(&db),
            vec![
                LineEditBucket {
                    agent: "mock".into(),
                    at: quarter,
                    lines: 2
                },
                LineEditBucket {
                    agent: "mock".into(),
                    at: quarter + BUCKET_MS,
                    lines: 4
                },
            ]
        );
        // Counted once: a later pass leaves the figures as they are.
        assert!(!pass(&db, &attachments, 8));
        assert_eq!(read_all(&db).len(), 2);
        let counted: Option<i64> = db
            .conn()
            .query_row(
                "SELECT edits_counted_at FROM turns WHERE id = 't1'",
                [],
                |row| row.get(0),
            )
            .expect("counted");
        assert_eq!(counted, Some(7));
        // Only what is since the asked moment.
        assert_eq!(read(db.conn(), quarter + BUCKET_MS).expect("read").len(), 1);
    }

    #[test]
    fn a_cut_input_is_counted_whole_from_its_blob() {
        let db = TestDb::new();
        let (dir, attachments) = attachments();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        let content = "line\n".repeat(500);
        let original = O7Event::ToolCall(call(
            "t1.w",
            "Write",
            ToolStatus::Completed,
            json!({"file_path":"big","content":content}),
        ));
        let bytes = serde_json::to_vec(&original).expect("json");
        let sha = "ab".repeat(32);
        blobs::write(dir.path(), &sha, &bytes).expect("blob");
        let mut stored = call(
            "t1.w",
            "Write",
            ToolStatus::Completed,
            json!({"_auracode_truncated":true,"bytes":bytes.len(),"preview":"{"}),
        );
        stored.truncated = Some(Truncation {
            total_bytes: bytes.len() as u64,
            blob: Some(sha),
        });
        db.append(&chat, &[at(0, "t1", 1, &O7Event::ToolCall(stored))]);
        end(&db, "t1");
        count_all(&db, &attachments);
        assert_eq!(read_all(&db)[0].lines, 500);
    }

    /// A streamed edit: every update carries the input so far, cut, with a blob of its own. The
    /// last one that set the input decides; the earlier blobs are never needed.
    #[test]
    fn a_streamed_edit_counts_the_input_its_last_update_set() {
        let db = TestDb::new();
        let (dir, attachments) = attachments();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        let preview = json!({"_auracode_truncated":true,"bytes":9000,"preview":"{"});
        let mut rows = vec![at(
            0,
            "t1",
            1,
            &O7Event::ToolCall(call("t1.w", "Write", ToolStatus::InProgress, json!({}))),
        )];
        for (seq, lines, sha) in [(1, 7, "a1"), (2, 300, "b2"), (3, 0, "c3")] {
            let sha = sha.repeat(32);
            let mut whole = update("t1.w", ToolStatus::InProgress);
            if lines > 0 {
                whole.raw_input = Some(json!({"file_path":"big","content":"x\n".repeat(lines)}));
                let bytes = serde_json::to_vec(&O7Event::ToolUpdate(whole)).expect("json");
                blobs::write(dir.path(), &sha, &bytes).expect("blob");
                let mut cut = update("t1.w", ToolStatus::InProgress);
                cut.raw_input = Some(preview.clone());
                cut.truncated = Some(Truncation {
                    total_bytes: 9000,
                    blob: Some(sha),
                });
                rows.push(at(seq, "t1", 2, &O7Event::ToolUpdate(cut)));
            } else {
                // The last update sets only the status: the input stays the one before it.
                rows.push(at(
                    seq,
                    "t1",
                    3,
                    &O7Event::ToolUpdate(update("t1.w", ToolStatus::Completed)),
                ));
            }
        }
        db.append(&chat, &rows);
        end(&db, "t1");
        count_all(&db, &attachments);
        assert_eq!(read_all(&db)[0].lines, 300);
    }

    #[test]
    fn diffs_and_codex_changes_count_and_deleted_chats_drop_out() {
        let db = TestDb::new();
        let (_dir, attachments) = attachments();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        let mut diff = call("t1.d", "edit", ToolStatus::Completed, json!({}));
        diff.content = vec![ToolContent::Diff {
            path: "a".into(),
            old_text: Some("a\nb\n".into()),
            new_text: "a\nc\nd\n".into(),
            truncated: None,
        }];
        let mut codex = call(
            "t1.x",
            "",
            ToolStatus::InProgress,
            json!({"type":"fileChange","changes":[{"path":"a","kind":{"type":"update","move_path":null},"diff":"@@ -1 +1 @@\n-a\n+b\n"}]}),
        );
        codex.tool_name = None;
        let mut done = update("t1.x", ToolStatus::Completed);
        done.raw_input = codex.raw_input.clone();
        db.append(
            &chat,
            &[
                at(0, "t1", 1, &O7Event::ToolCall(diff)),
                at(1, "t1", 2, &O7Event::ToolCall(codex)),
                at(2, "t1", 3, &O7Event::ToolUpdate(done)),
                at(
                    3,
                    "t1",
                    4,
                    &O7Event::TurnEnded {
                        turn_id: "t1".into(),
                        stop_reason: StopReason::EndTurn,
                        usage: None,
                        duration_ms: None,
                        recovered: false,
                    },
                ),
            ],
        );
        // Rows that are not JSON (salvaged ones) are passed over, not a failed count.
        for (id, seq, kind) in [("bad1", 9, "tool_call"), ("bad2", 10, "tool_update")] {
            db.conn()
                .execute(
                    "INSERT INTO events (id, chat_id, turn_id, seq, kind, payload, created_at, \
                     device_id) VALUES (?1, ?2, 't1', ?3, ?4, '{not json', 5, 'dev')",
                    params![id, chat, seq, kind],
                )
                .expect("bad row");
        }
        end(&db, "t1");
        count_all(&db, &attachments);
        assert_eq!(read_all(&db)[0].lines, 3);
        db.conn()
            .execute("UPDATE chats SET deleted = 1 WHERE id = ?1", params![chat])
            .expect("delete");
        assert!(read_all(&db).is_empty());
    }

    #[test]
    fn a_pass_stops_at_its_turn_limit_and_the_rest_wait() {
        let db = TestDb::new();
        let (_dir, attachments) = attachments();
        let chat = db.chat("/work");
        for ordinal in 1..=(PASS_TURNS as u32 + 3) {
            let turn = format!("t{ordinal}");
            db.turn(&chat, &turn, ordinal, ordinal);
            end(&db, &turn);
        }
        assert!(pass(&db, &attachments, 1));
        assert!(!pass(&db, &attachments, 2));
        let waiting: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM turns WHERE edits_counted_at IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("waiting");
        assert_eq!(waiting, 0);
    }

    #[test]
    fn a_turn_counted_by_two_passes_is_saved_once() {
        let db = TestDb::new();
        let (_dir, attachments) = attachments();
        let chat = db.chat("/work");
        db.turn(&chat, "t1", 1, 0);
        let write = call(
            "t1.w",
            "Write",
            ToolStatus::Completed,
            json!({"file_path":"a","content":"1\n2\n"}),
        );
        db.append(&chat, &[at(0, "t1", 1, &O7Event::ToolCall(write))]);
        end(&db, "t1");
        let (first, _) = count_with(db.conn(), &attachments).expect("first");
        let (second, _) = count_with(db.conn(), &attachments).expect("second");
        assert_eq!(first, second);
        save(db.conn(), &first, 1).expect("save");
        save(db.conn(), &second, 2).expect("save again");
        assert_eq!(read_all(&db)[0].lines, 2);
        let counted: Option<i64> = db
            .conn()
            .query_row(
                "SELECT edits_counted_at FROM turns WHERE id = 't1'",
                [],
                |row| row.get(0),
            )
            .expect("counted");
        assert_eq!(counted, Some(1));
    }

    #[test]
    fn the_newest_turns_are_counted_first() {
        let db = TestDb::new();
        let (_dir, attachments) = attachments();
        let chat = db.chat("/work");
        for ordinal in 1..=(PASS_TURNS as u32 + 1) {
            let turn = format!("t{ordinal}");
            db.turn(&chat, &turn, ordinal, ordinal);
            db.conn()
                .execute(
                    "UPDATE turns SET status = 'completed', started_at = ?2 WHERE id = ?1",
                    params![turn, i64::from(ordinal)],
                )
                .expect("end");
        }
        let (counted, more) = count_with(db.conn(), &attachments).expect("count");
        assert!(more);
        assert_eq!(counted[0].turn.turn_id, format!("t{}", PASS_TURNS + 1));
        assert!(counted.iter().all(|turn| turn.turn.turn_id != "t1"));
    }

    fn read_all(db: &TestDb) -> Vec<LineEditBucket> {
        read(db.conn(), 0).expect("read")
    }
}
