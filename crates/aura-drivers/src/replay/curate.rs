//! Curation: a raw protocol log into a fixture (the log's redaction re-run, then home, user, host
//! and folder placeholders, session ids and timestamps), and [`scan_clean`], which must find nothing
//! in a committed fixture.
//!
//! Placeholders: `<CWD>` and `<HOME>` (and Claude Code's project-directory spelling of each,
//! `<CWD_ENC>` and `<HOME_ENC>`), `<USER>`, `<HOST>`, native session ids as `<SESSION_n>` in order of
//! first appearance, ISO timestamps as `<TIME>`; `t` becomes milliseconds since the first record.

use std::sync::LazyLock;

use aura_process::Redactor;
use regex::Regex;
use serde_json::{Map, Value};

/// Shorter needles would shred unrelated text (a short user name, a small number).
const MIN_NEEDLE: usize = 4;

/// Why a log could not become a fixture.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CurateError {
    #[error("line {line} is not a protocol log record")]
    NotARecord { line: usize },
    #[error("the curated fixture still holds personal data: {}", .findings.join("; "))]
    Unclean { findings: Vec<String> },
}

static TIMESTAMP: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?").ok()
});

/// Token shapes, with the name a finding gives each.
static TOKENS: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    [
        ("an Anthropic key", r"sk-ant-[A-Za-z0-9_-]{10,}"),
        ("an API key", r"sk-[A-Za-z0-9_-]{20,}"),
        ("a GitHub token", r"gh[pousr]_[A-Za-z0-9]{20,}"),
        ("a GitHub token", r"github_pat_[A-Za-z0-9_]{20,}"),
        ("a Slack token", r"xox[abpr]-[A-Za-z0-9-]{10,}"),
        ("an AWS key", r"AKIA[0-9A-Z]{16}"),
        ("a Google key", r"AIza[0-9A-Za-z_-]{35}"),
        ("a GitLab token", r"glpat-[A-Za-z0-9_-]{20,}"),
        (
            "a JWT",
            r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
        ),
        ("a bearer token", r"Bearer [A-Za-z0-9._~+/=-]{16,}"),
    ]
    .into_iter()
    .filter_map(|(name, pattern)| Some((name, Regex::new(pattern).ok()?)))
    .collect()
});

/// Home folders on macOS, Linux and Windows (the last as written raw and as JSON escapes it).
const HOME_PREFIXES: [&str; 4] = ["/Users/", "/home/", "C:\\Users\\", "C:\\\\Users\\\\"];

/// A raw protocol log into a fixture. `home`, `cwd`, `user` and `host` are the literal values to
/// replace; empty or short ones are skipped.
pub fn curate(
    log_text: &str,
    home: &str,
    cwd: &str,
    user: &str,
    host: &str,
) -> Result<String, CurateError> {
    let redactor = Redactor::standard();
    let mut records = Vec::new();
    for (index, line) in log_text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let mut record: Value =
            serde_json::from_str(line).map_err(|_| CurateError::NotARecord { line: index + 1 })?;
        if !record.is_object() {
            return Err(CurateError::NotARecord { line: index + 1 });
        }
        redactor.redact_value(&mut record);
        records.push(record);
    }

    let mut needles: Vec<(String, String)> = Vec::new();
    let mut add = |needle: &str, placeholder: &str| {
        if needle.chars().count() >= MIN_NEEDLE && !needles.iter().any(|(known, _)| known == needle)
        {
            needles.push((needle.to_owned(), placeholder.to_owned()));
        }
    };
    add(cwd, "<CWD>");
    add(&encode_project_dir(cwd), "<CWD_ENC>");
    add(home, "<HOME>");
    add(&encode_project_dir(home), "<HOME_ENC>");
    add(user, "<USER>");
    add(host, "<HOST>");
    let mut sessions = Vec::new();
    for record in &records {
        collect_sessions(record, &mut sessions);
    }
    for (index, session) in sessions.iter().enumerate() {
        add(session, &format!("<SESSION_{}>", index + 1));
    }
    // Longest first, so a path holding the home folder is replaced whole.
    needles.sort_by_key(|(needle, _)| std::cmp::Reverse(needle.len()));

    let first_t = records
        .iter()
        .find_map(|record| record.get("t").and_then(Value::as_i64));
    let mut out = String::new();
    for mut record in records {
        if let (Some(first), Some(t)) = (first_t, record.get("t").and_then(Value::as_i64)) {
            record["t"] = Value::from(t.saturating_sub(first));
        }
        replace_strings(&mut record, &needles);
        out.push_str(&record.to_string());
        out.push('\n');
    }
    let findings = scan_clean(&out);
    if findings.is_empty() {
        Ok(out)
    } else {
        Err(CurateError::Unclean { findings })
    }
}

/// What makes a fixture unfit to commit: email addresses, token shapes, home folders. Each finding
/// names the line and the kind, never the value.
pub fn scan_clean(text: &str) -> Vec<String> {
    let mut findings = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let number = index + 1;
        if has_email(line) {
            findings.push(format!("line {number}: an email address"));
        }
        for (name, pattern) in TOKENS.iter() {
            if pattern.is_match(line) {
                findings.push(format!("line {number}: {name}"));
            }
        }
        if HOME_PREFIXES.iter().any(|prefix| line.contains(prefix)) {
            findings.push(format!("line {number}: a home folder path"));
        }
    }
    findings.dedup();
    findings
}

/// Claude Code's name for a working directory under `~/.claude/projects/`: every character that is
/// not ASCII alphanumeric becomes `-`.
pub fn encode_project_dir(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Every `sessionId` value, and the start note's `resume`, in order of first appearance.
fn collect_sessions(value: &Value, sessions: &mut Vec<String>) {
    let mut note = |id: &str| {
        if !id.is_empty() && !sessions.iter().any(|known| known == id) {
            sessions.push(id.to_owned());
        }
    };
    if let Some(resume) = value.pointer("/note/start/resume").and_then(Value::as_str) {
        note(resume);
    }
    walk_objects(value, &mut |object| {
        if let Some(id) = object.get("sessionId").and_then(Value::as_str) {
            note(id);
        }
    });
}

fn walk_objects(value: &Value, visit: &mut impl FnMut(&Map<String, Value>)) {
    match value {
        Value::Object(object) => {
            visit(object);
            for child in object.values() {
                walk_objects(child, visit);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk_objects(item, visit);
            }
        }
        _ => {}
    }
}

fn replace_strings(value: &mut Value, needles: &[(String, String)]) {
    match value {
        Value::String(text) => {
            for (needle, placeholder) in needles {
                if text.contains(needle.as_str()) {
                    *text = text.replace(needle.as_str(), placeholder);
                }
            }
            if let Some(timestamp) = TIMESTAMP.as_ref()
                && timestamp.is_match(text)
            {
                *text = timestamp.replace_all(text, "<TIME>").into_owned();
            }
        }
        Value::Array(items) => {
            for item in items {
                replace_strings(item, needles);
            }
        }
        Value::Object(object) => {
            for child in object.values_mut() {
                replace_strings(child, needles);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn is_local_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"._%+-".contains(&byte)
}

fn is_domain_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'
}

/// A dotted domain whose last label is at least two letters, so `react@18.3.1` and `user@localhost`
/// are not emails.
fn is_domain(domain: &[u8]) -> bool {
    let Some(dot) = domain.iter().rposition(|&byte| byte == b'.') else {
        return false;
    };
    let tld = &domain[dot + 1..];
    dot > 0 && tld.len() >= 2 && tld.iter().all(u8::is_ascii_alphabetic)
}

/// Whether `text` holds `local@domain.tld` (the spike's email rules).
fn has_email(text: &str) -> bool {
    let bytes = text.as_bytes();
    for (at, _) in text.match_indices('@') {
        let mut start = at;
        while start > 0 && is_local_char(bytes[start - 1]) {
            start -= 1;
        }
        let mut end = at + 1;
        while end < bytes.len() && is_domain_char(bytes[end]) {
            end += 1;
        }
        while end > at + 1 && matches!(bytes[end - 1], b'.' | b'-') {
            end -= 1;
        }
        if start < at && is_domain(&bytes[at + 1..end]) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const HOME: &str = "/Users/someone";
    const CWD: &str = "/Users/someone/scratch/repo-a";

    fn log(records: &[Value]) -> String {
        records.iter().map(|record| format!("{record}\n")).collect()
    }

    #[test]
    fn placeholders_replace_paths_sessions_timestamps_and_t() {
        let text = log(&[
            json!({"t": 1_792_840_001_230_i64, "d": "note", "note": {"spawn": {"label": "hermes acp",
                "program": "/Users/someone/.local/bin/hermes", "cwd": CWD, "pid": 5001}}}),
            json!({"t": 1_792_840_001_231_i64, "d": "note", "note": {"start": {"agent_id": "hermes",
                "resume": "4f7c-old-session", "spawn_id": "019a0000-0000-7000-8000-000000000001"}}}),
            json!({"t": 1_792_840_001_240_i64, "d": "out", "msg": {"jsonrpc": "2.0", "id": 2,
                "method": "session/load", "params": {"sessionId": "4f7c-old-session", "cwd": CWD}}}),
            json!({"t": 1_792_840_001_300_i64, "d": "in", "msg": {"jsonrpc": "2.0", "method": "session/update",
                "params": {"sessionId": "4f7c-old-session", "update": {"sessionUpdate": "session_info_update",
                "title": "Fix", "updatedAt": "2026-10-24T10:00:00.123Z"}}}}),
            json!({"t": 1_792_840_001_400_i64, "d": "in", "msg": {"jsonrpc": "2.0", "id": 3, "result": {
                "sessionId": "9b1e-new-session", "_meta": {"transcript":
                "/Users/someone/.claude/projects/-Users-someone-scratch-repo-a/9b1e-new-session.jsonl",
                "host": "someones-macbook", "who": "someone"}}}}),
            json!({"t": 1_792_840_001_500_i64, "d": "err", "line": "INFO started at 2026-10-24 10:00:01"}),
        ]);
        let curated = curate(&text, HOME, CWD, "someone", "someones-macbook").expect("clean");
        let lines: Vec<Value> = curated
            .lines()
            .map(|line| serde_json::from_str(line).expect("json"))
            .collect();
        assert_eq!(lines[0]["t"], 0);
        assert_eq!(lines[5]["t"], 270);
        assert_eq!(
            lines[0]["note"]["spawn"]["program"],
            "<HOME>/.local/bin/hermes"
        );
        assert_eq!(lines[0]["note"]["spawn"]["cwd"], "<CWD>");
        assert_eq!(lines[1]["note"]["start"]["resume"], "<SESSION_1>");
        assert_eq!(
            lines[1]["note"]["start"]["spawn_id"],
            "019a0000-0000-7000-8000-000000000001"
        );
        assert_eq!(
            lines[2]["msg"]["params"],
            json!({"sessionId": "<SESSION_1>", "cwd": "<CWD>"})
        );
        assert_eq!(lines[3]["msg"]["params"]["update"]["updatedAt"], "<TIME>");
        assert_eq!(
            lines[4]["msg"]["result"]["_meta"],
            json!({"transcript": "<HOME>/.claude/projects/<CWD_ENC>/<SESSION_2>.jsonl",
                   "host": "<HOST>", "who": "<USER>"})
        );
        assert_eq!(lines[5]["line"], "INFO started at <TIME>");
        assert!(scan_clean(&curated).is_empty());
    }

    #[test]
    fn what_redaction_misses_fails_the_scan() {
        // A home folder this machine does not own, and token shapes nothing replaced.
        let text = log(&[json!({"d": "err", "line": "loading /home/other/.config"})]);
        let error = curate(&text, HOME, CWD, "someone", "host-name").expect_err("unclean");
        assert_eq!(
            error,
            CurateError::Unclean {
                findings: vec!["line 1: a home folder path".into()]
            }
        );
        assert!(matches!(
            curate("not json\n", HOME, CWD, "u", "h"),
            Err(CurateError::NotARecord { line: 1 })
        ));
        assert!(matches!(
            curate("[1]\n", HOME, CWD, "u", "h"),
            Err(CurateError::NotARecord { line: 1 })
        ));
    }

    #[test]
    fn the_scan_finds_emails_tokens_and_home_paths_without_quoting_them() {
        let findings = scan_clean(
            "fine line\n\
             contact a.b+c@example.com\n\
             key sk-ant-api03-abcdefghijklmn\n\
             gh ghp_abcdefghijklmnopqrstuvwxyz\n\
             jwt eyJhbGciOiJ.eyJzdWIiOiIx.c2lnbmF0dXJl\n\
             auth Bearer abcdefghijklmnopqrstuvwx\n\
             aws AKIAABCDEFGHIJKLMNOP\n\
             path /Users/x/y and C:\\Users\\x\n",
        );
        assert_eq!(
            findings,
            [
                "line 2: an email address",
                "line 3: an Anthropic key",
                "line 3: an API key",
                "line 4: a GitHub token",
                "line 5: a JWT",
                "line 6: a bearer token",
                "line 7: an AWS key",
                "line 8: a home folder path",
            ]
        );
        assert!(
            !findings
                .iter()
                .any(|finding| finding.contains("example.com"))
        );
        // Lookalikes stay.
        assert!(
            scan_clean("@anthropic-ai/claude-code react@18.3.1 user@localhost a@b.c <EMAIL>")
                .is_empty()
        );
    }

    #[test]
    fn project_dir_encoding_matches_claude_code() {
        assert_eq!(
            encode_project_dir("/Users/me/Desktop/coding-folder/auracode"),
            "-Users-me-Desktop-coding-folder-auracode"
        );
        assert_eq!(encode_project_dir("/tmp/a_b.c"), "-tmp-a-b-c");
    }

    #[test]
    fn short_needles_are_skipped() {
        let text = log(&[json!({"d": "err", "line": "the bob ran in /srv/x"})]);
        let curated = curate(&text, "", "/srv/x", "bob", "").expect("clean");
        assert!(curated.contains("the bob ran in <CWD>"), "{curated}");
    }
}
