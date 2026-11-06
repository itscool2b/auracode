//! A terminal chat's conversation, read back from its agent's own session file
//! (docs/superpowers/plans/2026-11-06-terminal-chats.md, decision 4): Claude Code's
//! `<config>/projects/<folder>/<session>.jsonl`, Codex's `<home>/sessions/**/rollout-*-<thread>.jsonl`.
//! Only what the terminal added is read (from the file's length when it opened), as turns of a
//! prompt and the agent's answer text; tool calls, thinking, injected context and lines that do not
//! parse are left out and counted. Reads are bounded; nothing here writes.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use aura_protocol::Millis;
use serde_json::Value;

/// The most a terminal's session can add that one import reads.
pub(crate) const READ_LIMIT: u64 = 64 * 1024 * 1024;
/// Folders a session file is looked for in, at most.
const DIRS_LIMIT: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Vendor {
    Claude,
    Codex,
}

/// One exchange from the terminal: what the person typed, and the agent's answer text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportedTurn {
    pub prompt: String,
    pub answer: String,
    pub started_at: Millis,
    pub ended_at: Millis,
}

/// The turns read, and how many lines were left out because they did not parse.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Imported {
    pub turns: Vec<ImportedTurn>,
    pub skipped: usize,
    /// The read stopped at `READ_LIMIT`; the rest of the session stays in the agent's file.
    pub truncated: bool,
}

/// Claude Code's session file for `session_id` under its config folder (an added account's
/// `CLAUDE_CONFIG_DIR`, or `~/.claude`): found by name in any project folder, since the folder's
/// name is Claude Code's own spelling of the path.
pub(crate) fn claude_session(config: &Path, session_id: &str) -> Option<PathBuf> {
    if !plain_id(session_id) {
        return None;
    }
    let name = format!("{session_id}.jsonl");
    std::fs::read_dir(config.join("projects"))
        .ok()?
        .flatten()
        .take(DIRS_LIMIT)
        .map(|entry| entry.path().join(&name))
        .find(|path| path.is_file())
}

/// Codex's rollout for `thread_id` under its home (`CODEX_HOME`, or `~/.codex`).
pub(crate) fn codex_session(home: &Path, thread_id: &str) -> Option<PathBuf> {
    if !plain_id(thread_id) {
        return None;
    }
    let suffix = format!("-{thread_id}.jsonl");
    rollouts(home).into_iter().find(|path| {
        path.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(&suffix))
    })
}

/// A new Codex terminal session names itself: the newest rollout begun in `folder` at or after
/// `since` (milliseconds), with its thread ID.
pub(crate) fn newest_codex_session(
    home: &Path,
    folder: &Path,
    since: Millis,
) -> Option<(PathBuf, String)> {
    let mut found: Option<(Millis, PathBuf, String)> = None;
    for path in rollouts(home) {
        let Some((id, cwd, at)) = codex_meta(&path) else {
            continue;
        };
        if at + 2000 < since || !same_folder(&cwd, folder) {
            continue;
        }
        if found.as_ref().is_none_or(|(best, _, _)| at > *best) {
            found = Some((at, path, id));
        }
    }
    found.map(|(_, path, id)| (path, id))
}

/// The file's length now: an import later starts after what is already there.
pub(crate) fn length(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |meta| meta.len())
}

/// The turns the file gained after `from` bytes. A file now shorter than `from` was rewritten, and
/// is read from its start.
pub(crate) fn read_since(vendor: Vendor, path: &Path, from: u64) -> Imported {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Imported::default();
    };
    let len = file.metadata().map_or(0, |meta| meta.len());
    let start = if from > len { 0 } else { from };
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Imported::default();
    }
    let mut bytes = Vec::new();
    let truncated = len.saturating_sub(start) > READ_LIMIT;
    if file.take(READ_LIMIT).read_to_end(&mut bytes).is_err() {
        return Imported::default();
    }
    // A partly written last line (the agent still writing) is left for later.
    if let Some(end) = bytes.iter().rposition(|byte| *byte == b'\n') {
        bytes.truncate(end + 1);
    } else {
        bytes.clear();
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut imported = match vendor {
        Vendor::Claude => parse_claude(&text),
        Vendor::Codex => parse_codex(&text),
    };
    imported.truncated = truncated;
    imported
}

/// Claude Code's lines: a user line with text (a string, or text parts) opens a turn; assistant
/// text parts are its answer. Tool results, thinking, tool calls, sidechains, meta lines and the
/// local-command wrappers Claude Code writes as user lines are left out.
pub(crate) fn parse_claude(text: &str) -> Imported {
    let mut out = Imported::default();
    let mut open: Option<ImportedTurn> = None;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            out.skipped += 1;
            continue;
        };
        if value["isSidechain"] == true || value["isMeta"] == true {
            continue;
        }
        let at = value["timestamp"]
            .as_str()
            .and_then(rfc3339_millis)
            .unwrap_or(0);
        let content = &value["message"]["content"];
        match value["type"].as_str() {
            Some("user") => {
                let prompt = match content {
                    Value::String(text) => text.clone(),
                    Value::Array(parts) => joined(parts, "text"),
                    _ => String::new(),
                };
                let prompt = prompt.trim();
                if prompt.is_empty() || wrapper(prompt) {
                    continue;
                }
                if let Some(turn) = open.take() {
                    out.turns.push(turn);
                }
                open = Some(ImportedTurn {
                    prompt: prompt.to_owned(),
                    answer: String::new(),
                    started_at: at,
                    ended_at: at,
                });
            }
            Some("assistant") => {
                let Some(turn) = open.as_mut() else {
                    continue;
                };
                let answer = match content {
                    Value::Array(parts) => joined(parts, "text"),
                    Value::String(text) => text.clone(),
                    _ => String::new(),
                };
                append(&mut turn.answer, &answer);
                turn.ended_at = turn.ended_at.max(at);
            }
            _ => {}
        }
    }
    out.turns.extend(open);
    out
}

/// Codex's rollout: a user message opens a turn, its parts without the context blocks Codex
/// injects (`<environment_context>`, instruction files); assistant `output_text` is its answer.
pub(crate) fn parse_codex(text: &str) -> Imported {
    let mut out = Imported::default();
    let mut open: Option<ImportedTurn> = None;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            out.skipped += 1;
            continue;
        };
        let at = value["timestamp"]
            .as_str()
            .and_then(rfc3339_millis)
            .unwrap_or(0);
        let payload = &value["payload"];
        if value["type"] != "response_item" || payload["type"] != "message" {
            continue;
        }
        let Value::Array(parts) = &payload["content"] else {
            continue;
        };
        match payload["role"].as_str() {
            Some("user") => {
                let prompt = parts
                    .iter()
                    .filter(|part| part["type"] == "input_text")
                    .filter_map(|part| part["text"].as_str())
                    .map(str::trim)
                    .filter(|text| !text.is_empty() && !injected(text))
                    .collect::<Vec<_>>()
                    .join("\n\n");
                if prompt.is_empty() {
                    continue;
                }
                if let Some(turn) = open.take() {
                    out.turns.push(turn);
                }
                open = Some(ImportedTurn {
                    prompt,
                    answer: String::new(),
                    started_at: at,
                    ended_at: at,
                });
            }
            Some("assistant") => {
                let Some(turn) = open.as_mut() else {
                    continue;
                };
                append(&mut turn.answer, &joined(parts, "output_text"));
                turn.ended_at = turn.ended_at.max(at);
            }
            _ => {}
        }
    }
    out.turns.extend(open);
    out
}

fn joined(parts: &[Value], kind: &str) -> String {
    parts
        .iter()
        .filter(|part| part["type"] == kind)
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn append(answer: &mut String, more: &str) {
    let more = more.trim();
    if more.is_empty() {
        return;
    }
    if !answer.is_empty() {
        answer.push_str("\n\n");
    }
    answer.push_str(more);
}

/// Claude Code's own wrappers around local commands and their output, written as user lines.
fn wrapper(text: &str) -> bool {
    [
        "<command-name>",
        "<command-message>",
        "<local-command-",
        "<bash-",
        "Caveat: ",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
}

/// Context Codex adds to the first user message: XML-tagged blocks and instruction files.
fn injected(text: &str) -> bool {
    text.starts_with('<') || text.starts_with("# AGENTS.md") || text.starts_with("# Instructions")
}

/// A vendor session ID auracode will look a file up by: no path separators or dots.
fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Every rollout under `<home>/sessions/YYYY/MM/DD`, newest days first, bounded.
fn rollouts(home: &Path) -> Vec<PathBuf> {
    let mut days = Vec::new();
    let level = |dir: &Path| -> Vec<PathBuf> {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
            .map(|read| {
                read.flatten()
                    .take(DIRS_LIMIT)
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect()
            })
            .unwrap_or_default();
        entries.sort_by(|a, b| b.cmp(a));
        entries
    };
    for year in level(&home.join("sessions")) {
        for month in level(&year) {
            days.extend(level(&month));
            if days.len() >= 62 {
                break;
            }
        }
        if days.len() >= 62 {
            break;
        }
    }
    let mut files = Vec::new();
    for day in days.into_iter().take(62) {
        if let Ok(read) = std::fs::read_dir(&day) {
            files.extend(
                read.flatten()
                    .take(DIRS_LIMIT)
                    .map(|e| e.path())
                    .filter(|path| {
                        path.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
                    }),
            );
        }
    }
    files
}

/// A rollout's thread ID, folder and start, from its first line (`session_meta`).
fn codex_meta(path: &Path) -> Option<(String, PathBuf, Millis)> {
    let file = std::fs::File::open(path).ok()?;
    let mut first = String::new();
    std::io::BufRead::read_line(
        &mut std::io::BufReader::new(file.take(256 * 1024)),
        &mut first,
    )
    .ok()?;
    let value: Value = serde_json::from_str(first.trim()).ok()?;
    if value["type"] != "session_meta" {
        return None;
    }
    let payload = &value["payload"];
    let id = payload["id"]
        .as_str()
        .or_else(|| payload["session_id"].as_str())?
        .to_owned();
    let cwd = PathBuf::from(payload["cwd"].as_str()?);
    let at = payload["timestamp"]
        .as_str()
        .or_else(|| value["timestamp"].as_str())
        .and_then(rfc3339_millis)?;
    plain_id(&id).then_some((id, cwd, at))
}

fn same_folder(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let text = p.to_string_lossy().replace('\\', "/");
        let text = text.trim_end_matches('/').to_owned();
        if cfg!(windows) {
            text.to_ascii_lowercase()
        } else {
            text
        }
    };
    norm(a) == norm(b)
}

/// `2026-11-06T07:45:16.764Z` (or with an offset) in milliseconds since the epoch.
pub(crate) fn rfc3339_millis(text: &str) -> Option<Millis> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = &text[19..];
    let mut millis = 0i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(char::is_ascii_digit).collect();
        rest = &fraction[digits.len()..];
        let padded = format!("{digits:0<3}");
        millis = padded.get(..3)?.parse().ok()?;
    }
    let offset = match rest {
        "Z" | "z" => 0,
        zone if zone.len() == 6 && (zone.starts_with('+') || zone.starts_with('-')) => {
            let hours: i64 = zone.get(1..3)?.parse().ok()?;
            let minutes: i64 = zone.get(4..6)?.parse().ok()?;
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            sign * (hours * 60 + minutes)
        }
        _ => return None,
    };
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offset * 60;
    Some(seconds * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_read_as_the_epoch_milliseconds_they_name() {
        assert_eq!(rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            rfc3339_millis("2026-11-06T07:45:16.764Z"),
            Some(1_793_951_116_764)
        );
        assert_eq!(
            rfc3339_millis("2026-11-06T02:45:16.764-05:00"),
            Some(1_793_951_116_764)
        );
        assert_eq!(
            rfc3339_millis("2026-11-06T07:45:16.7Z"),
            Some(1_793_951_116_700)
        );
        assert_eq!(rfc3339_millis("yesterday"), None);
        assert_eq!(rfc3339_millis("2026-13-06T07:45:16Z"), None);
    }

    #[test]
    fn claude_turns_keep_prompts_and_answer_text_only() {
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"Fix the header"},"timestamp":"2026-11-06T07:00:00.000Z"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"Looking."}]},"timestamp":"2026-11-06T07:00:01.000Z"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]},"timestamp":"2026-11-06T07:00:02.000Z"}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"file"}]},"timestamp":"2026-11-06T07:00:03.000Z"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed it."}]},"timestamp":"2026-11-06T07:00:09.000Z"}"#,
            r#"{"type":"user","isSidechain":true,"message":{"content":"subagent prompt"}}"#,
            r#"{"type":"user","message":{"content":"<command-name>/clear</command-name>"}}"#,
            "not json",
            r#"{"type":"user","message":{"content":[{"type":"text","text":"Now the footer"}]},"timestamp":"2026-11-06T07:01:00.000Z"}"#,
        ]
        .join("\n");
        let imported = parse_claude(&lines);
        assert_eq!(imported.skipped, 1);
        assert_eq!(imported.turns.len(), 2);
        assert_eq!(imported.turns[0].prompt, "Fix the header");
        assert_eq!(imported.turns[0].answer, "Looking.\n\nFixed it.");
        assert_eq!(
            imported.turns[0].ended_at - imported.turns[0].started_at,
            9000
        );
        assert_eq!(imported.turns[1].prompt, "Now the footer");
        assert_eq!(imported.turns[1].answer, "");
    }

    #[test]
    fn codex_turns_leave_out_injected_context() {
        let lines = [
            r#"{"type":"session_meta","payload":{"id":"t1","cwd":"/w","timestamp":"2026-11-06T07:00:00Z"}}"#,
            r#"{"type":"response_item","timestamp":"2026-11-06T07:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>cwd</environment_context>"},{"type":"input_text","text":"Add a test"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"rules"}]}}"#,
            r#"{"type":"response_item","timestamp":"2026-11-06T07:00:05Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Added."}]}}"#,
        ]
        .join("\n");
        let imported = parse_codex(&lines);
        assert_eq!(
            imported.turns,
            vec![ImportedTurn {
                prompt: "Add a test".into(),
                answer: "Added.".into(),
                started_at: rfc3339_millis("2026-11-06T07:00:01Z").unwrap(),
                ended_at: rfc3339_millis("2026-11-06T07:00:05Z").unwrap(),
            }]
        );
    }

    #[test]
    fn reads_only_what_the_terminal_added_and_never_a_half_written_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let before = r#"{"type":"user","message":{"content":"from Chat"}}"#.to_owned() + "\n";
        let added =
            r#"{"type":"user","message":{"content":"from the terminal"}}"#.to_owned() + "\n";
        let partial = r#"{"type":"user","message":{"content":"still wri"#;
        std::fs::write(&path, format!("{before}{added}{partial}")).unwrap();
        let imported = read_since(Vendor::Claude, &path, before.len() as u64);
        let prompts: Vec<_> = imported.turns.iter().map(|t| t.prompt.as_str()).collect();
        assert_eq!(prompts, ["from the terminal"]);
        // A file rewritten shorter than where the import began is read from its start.
        std::fs::write(&path, &added).unwrap();
        assert_eq!(read_since(Vendor::Claude, &path, 10_000).turns.len(), 1);
        assert_eq!(
            read_since(Vendor::Claude, &dir.path().join("missing"), 0),
            Imported::default()
        );
    }

    #[test]
    fn session_files_are_found_by_id_and_a_new_codex_session_by_folder_and_time() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("projects").join("C--work-app");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("abc-123.jsonl"), "").unwrap();
        assert_eq!(
            claude_session(dir.path(), "abc-123"),
            Some(project.join("abc-123.jsonl"))
        );
        assert_eq!(claude_session(dir.path(), "../escape"), None);

        let day = dir
            .path()
            .join("sessions")
            .join("2026")
            .join("11")
            .join("06");
        std::fs::create_dir_all(&day).unwrap();
        let meta = |id: &str, cwd: &str, at: &str| {
            format!(
                r#"{{"type":"session_meta","payload":{{"id":"{id}","cwd":"{cwd}","timestamp":"{at}"}}}}"#
            ) + "\n"
        };
        std::fs::write(
            day.join("rollout-2026-11-06T07-00-00-old.jsonl"),
            meta("old", "/work/app", "2026-11-06T06:00:00Z"),
        )
        .unwrap();
        std::fs::write(
            day.join("rollout-2026-11-06T07-10-00-other.jsonl"),
            meta("other", "/work/elsewhere", "2026-11-06T07:10:00Z"),
        )
        .unwrap();
        std::fs::write(
            day.join("rollout-2026-11-06T07-05-00-new.jsonl"),
            meta("new", "/work/app/", "2026-11-06T07:05:00Z"),
        )
        .unwrap();
        let since = rfc3339_millis("2026-11-06T07:04:00Z").unwrap();
        let (path, id) = newest_codex_session(dir.path(), Path::new("/work/app"), since).unwrap();
        assert_eq!(id, "new");
        assert_eq!(codex_session(dir.path(), "new"), Some(path));
    }
}
