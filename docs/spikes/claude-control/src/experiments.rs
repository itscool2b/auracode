//! The experiments, one function per subcommand.
//!
//! Model calls are budgeted (at most six short prompts across all experiments), so a prompt is
//! only sent after free control requests confirm which model would answer it, and the
//! session-level probes (resume, fork, environment comparison) use the built-in `/usage`
//! command, which completes a whole turn locally without calling the model.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};

use crate::Res;
use crate::env_scrub;
use crate::procs;
use crate::protocol;
use crate::redact::{self, Redactor};
use crate::session::{ExitInfo, Recv, Session, SpawnSpec};

const INIT_TIMEOUT: Duration = Duration::from_secs(90);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(45);
const TURN_TIMEOUT: Duration = Duration::from_secs(240);
const LOCAL_TURN_TIMEOUT: Duration = Duration::from_secs(60);
const EXIT_TIMEOUT: Duration = Duration::from_secs(20);
/// How long to keep reading after a `result`: state frames and receipts can trail it.
const AFTER_RESULT: Duration = Duration::from_millis(2000);

/// Set on every spawn, as both official SDKs do: it makes the CLI emit `session_state_changed`
/// frames, whose `idle` is the authoritative end of a run (background agents included).
const SESSION_STATE_ENV: &str = "CLAUDE_CODE_SDK_READS_SESSION_STATE";

const BASIC_PROMPT: &str = "Reply with exactly: ok";
/// `echo` is in Claude Code's read-only command set and never prompts, so it is the control; the
/// two `touch` calls are what produce permission requests (one allowed, one denied).
const PERMISSION_PROMPT: &str = "Use the Bash tool to run these three commands, as three separate Bash tool calls made \
one at a time: first `echo auracode-spike`, then `touch spike-allowed.txt`, then `touch spike-denied.txt`. If a command \
is denied, do not retry it. When finished, reply with exactly: done";
const COUNT_PROMPT: &str = "Count from 1 to 300, one number per line. Output only the numbers.";
const AFTER_INTERRUPT_PROMPT: &str =
    "What was the last number you wrote before you were stopped? Reply with only that number.";
const RESUME_PROMPT: &str =
    "What exact text did the first echo command print earlier in this conversation? Reply with only that text.";
const FORK_PROMPT: &str = "Reply with exactly: forked";
const PENDING_PROMPT: &str = "Use the Bash tool to run exactly this command: touch spike-pending.txt";
/// Built in, runs locally in print mode, and still produces `system/init` and `result`.
const LOCAL_COMMAND: &str = "/usage";

/// Shared settings and helpers for every experiment.
pub struct Ctx {
    claude: PathBuf,
    root: PathBuf,
    fixtures: PathBuf,
    model: String,
    config_dir: PathBuf,
    env: Vec<(OsString, OsString)>,
    redactor: Redactor,
}

struct State {
    session_id: String,
    dir_a: PathBuf,
    transcript: PathBuf,
}

impl Ctx {
    pub fn new(root: PathBuf, claude: Option<PathBuf>, fixtures: PathBuf, model: String) -> Res<Self> {
        let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("HOME is not set")?;
        std::fs::create_dir_all(root.join("raw"))?;
        std::fs::create_dir_all(&fixtures)?;
        // The CLI reports canonical paths (/private/tmp rather than /tmp), so match them.
        let root = root.canonicalize()?;
        let env: Vec<(OsString, OsString)> = std::env::vars_os().collect();
        let config_dir = std::env::var_os("CLAUDE_CONFIG_DIR").map_or_else(|| home.join(".claude"), PathBuf::from);
        let redactor = build_redactor(&home, &root, &env);
        let claude = claude.unwrap_or_else(|| home.join(".local/bin/claude"));
        Ok(Self { claude, root, fixtures, model, config_dir, env, redactor })
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn raw_path(&self, name: &str) -> PathBuf {
        self.root.join("raw").join(format!("{name}.log.jsonl"))
    }

    /// The flags auracode will use, plus whatever the experiment adds.
    fn args(&self, extra: &[String]) -> Vec<String> {
        let mut args = strings(&[
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
            "--model",
            &self.model,
        ]);
        args.extend_from_slice(extra);
        args
    }

    fn spawn(&self, name: &str, cwd: &Path, extra: &[String], env: Vec<(OsString, OsString)>) -> Res<Session> {
        let spec = SpawnSpec { program: self.claude.clone(), args: self.args(extra), cwd: cwd.to_path_buf(), env };
        Session::spawn(&spec, Some(self.raw_path(name)))
    }

    /// Our environment, scrubbed or not, plus the one variable set on purpose.
    fn child_env(&self, scrub: bool) -> (Vec<(OsString, OsString)>, Vec<String>) {
        let (mut env, dropped) =
            if scrub { env_scrub::scrub(self.env.clone()) } else { (self.env.clone(), Vec::new()) };
        env.retain(|(name, _)| name.as_os_str() != OsStr::new(SESSION_STATE_ENV));
        env.push((SESSION_STATE_ENV.into(), "1".into()));
        (env, dropped)
    }

    fn project_dir(&self, cwd: &Path) -> PathBuf {
        self.config_dir.join("projects").join(redact::encode_project_dir(&cwd.to_string_lossy()))
    }

    /// Transcript files under each folder's Claude project directory, with enough of each to tell
    /// which session wrote it and from which working directory.
    fn transcripts(&self, cwds: &[&Path]) -> Value {
        let mut out = Map::new();
        for cwd in cwds {
            let dir = self.project_dir(cwd);
            let mut files = Vec::new();
            for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.extension().and_then(OsStr::to_str) != Some("jsonl") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                files.push(transcript_facts(&path, &text));
            }
            files.sort_by(|a, b| a["file"].to_string().cmp(&b["file"].to_string()));
            out.insert(cwd.display().to_string(), json!({"project_dir": dir, "files": files}));
        }
        Value::Object(out)
    }

    /// Raw stdout lines `start..end` as a redacted fixture, plus a companion file holding what
    /// was written to stdin in that window, each entry positioned against the fixture's lines.
    fn write_fixture(&self, name: &str, s: &Session, start: usize, end: Option<usize>) -> Res<()> {
        let stop = end.unwrap_or(s.stdout_lines.len());
        let mut out = String::new();
        for line in s.stdout_lines.get(start..stop).unwrap_or_default() {
            out.push_str(&self.redactor.apply(line));
            out.push('\n');
        }
        std::fs::write(self.fixtures.join(format!("{name}.jsonl")), out)?;
        let mut sent = String::new();
        for entry in &s.sent {
            let inside = entry.after_stdout_line >= start && end.is_none_or(|end| entry.after_stdout_line < end);
            if inside {
                let line = json!({"after_stdout_line": entry.after_stdout_line - start, "t_ms": entry.t_ms,
                                  "message": entry.message});
                sent.push_str(&self.redactor.apply(&line.to_string()));
                sent.push('\n');
            }
        }
        std::fs::write(self.fixtures.join(format!("{name}.stdin.jsonl")), sent)?;
        Ok(())
    }

    /// Redacts and stores a summary, returning the text that gets printed.
    pub fn publish_summary(&self, name: &str, summary: &Value) -> Res<String> {
        let text = self.redactor.apply(&serde_json::to_string_pretty(summary)?);
        std::fs::write(self.root.join("raw").join(format!("{name}.summary.json")), &text)?;
        Ok(text)
    }

    fn write_state(&self, state: &Value) -> Res<()> {
        std::fs::write(self.root.join("state.json"), serde_json::to_string_pretty(state)?)?;
        Ok(())
    }

    fn read_state(&self) -> Res<State> {
        let text = std::fs::read_to_string(self.root.join("state.json"))
            .map_err(|e| format!("reading state.json (run p1 first): {e}"))?;
        let doc: Value = serde_json::from_str(&text)?;
        let field =
            |key: &str| -> Res<String> { Ok(doc[key].as_str().ok_or(format!("state.json has no {key}"))?.to_owned()) };
        Ok(State {
            session_id: field("session_id")?,
            dir_a: PathBuf::from(field("dir_a")?),
            transcript: PathBuf::from(field("transcript")?),
        })
    }
}

fn build_redactor(home: &Path, root: &Path, env: &[(OsString, OsString)]) -> Redactor {
    let mut redactor = Redactor::new();
    if let Ok(text) = std::fs::read_to_string(home.join(".claude.json"))
        && let Ok(doc) = serde_json::from_str::<Value>(&text)
    {
        for (needle, placeholder) in redact::account_needles(&doc) {
            redactor.add(&needle, placeholder);
        }
    }
    let home_text = home.to_string_lossy().into_owned();
    for (name, value) in env {
        let (Some(name), Some(value)) = (name.to_str(), value.to_str()) else { continue };
        let upper = name.to_ascii_uppercase();
        let secretish = ["TOKEN", "KEY", "SECRET", "PASSWORD", "AUTH"].iter().any(|word| upper.contains(word));
        // Paths under the home directory are covered by the path rule below, which reads better.
        if (env_scrub::is_scrubbed(OsStr::new(name)) || secretish) && !value.starts_with(&home_text) {
            // Short values here are flags, numbers and words that also occur in real output.
            redactor.add_min(value, &format!("<ENV:{name}>"), 16);
        }
    }
    // `/usage` prints reset times in the machine's zone, which says roughly where the user lives.
    if let Some(zone) = local_timezone() {
        redactor.add(&zone, "<TIMEZONE>");
    }
    redactor.add_path(&root.to_string_lossy(), "<SPIKE>", "<SPIKE_ENC>");
    redactor.add_path(&home_text, "<HOME>", "<HOME_ENC>");
    redactor
}

/// The IANA zone name, from `TZ` or the `/etc/localtime` link (`.../zoneinfo/Region/City`).
fn local_timezone() -> Option<String> {
    if let Some(zone) = std::env::var("TZ").ok().filter(|zone| zone.contains('/')) {
        return Some(zone.trim_start_matches(':').to_owned());
    }
    let target = std::fs::read_link("/etc/localtime").ok()?;
    let text = target.to_string_lossy();
    let (_, zone) = text.split_once("zoneinfo/")?;
    Some(zone.to_owned())
}

/// Re-applies the current redaction rules to every fixture in place, so tightening redaction
/// never requires re-running an experiment (and re-spending its prompts). Placeholders never
/// match a needle, so running it twice changes nothing.
pub fn redact_fixtures(ctx: &Ctx) -> Res<Value> {
    let mut changed = Vec::new();
    for entry in std::fs::read_dir(&ctx.fixtures)?.flatten() {
        let path = entry.path();
        if path.extension().and_then(OsStr::to_str) != Some("jsonl") {
            continue;
        }
        let before = std::fs::read_to_string(&path)?;
        let after: String = before.lines().map(|line| ctx.redactor.apply(line) + "\n").collect();
        if after != before {
            std::fs::write(&path, &after)?;
            changed.push(path.file_name().map(|name| name.to_string_lossy().into_owned()));
        }
    }
    Ok(json!({"rewritten": changed}))
}

fn transcript_facts(path: &Path, text: &str) -> Value {
    let mut cwds = BTreeSet::new();
    let mut session_ids = BTreeSet::new();
    let mut entrypoints = BTreeSet::new();
    let mut types = BTreeMap::<String, usize>::new();
    let mut lines = 0usize;
    for line in text.lines() {
        lines += 1;
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        if let Some(cwd) = entry["cwd"].as_str() {
            cwds.insert(cwd.to_owned());
        }
        if let Some(id) = entry["sessionId"].as_str() {
            session_ids.insert(id.to_owned());
        }
        if let Some(entrypoint) = entry["entrypoint"].as_str() {
            entrypoints.insert(entrypoint.to_owned());
        }
        *types.entry(entry["type"].as_str().unwrap_or("?").to_owned()).or_default() += 1;
    }
    json!({
        "file": path.file_name().map(|name| name.to_string_lossy().into_owned()),
        "bytes": text.len(),
        "lines": lines,
        "entry_types": types,
        "cwds": cwds,
        "session_ids": session_ids,
        "entrypoints": entrypoints,
    })
}

// ---------------------------------------------------------------------------------------------
// Turns and control requests

enum Decision {
    Allow,
    Deny {
        message: &'static str,
        interrupt: bool,
    },
    /// Leave the request unanswered and interrupt the turn instead: what a user pressing Esc on
    /// an open permission card does.
    HoldAndInterrupt,
}

/// A turn that only asks for text should never run a tool; refusing keeps a confused model from
/// touching anything.
fn deny_all(_tool: &str, _input: &Value) -> Decision {
    Decision::Deny { message: "auracode spike: no tools in this turn", interrupt: false }
}

fn hold_and_interrupt(_tool: &str, _input: &Value) -> Decision {
    Decision::HoldAndInterrupt
}

/// The permission experiment: approve everything except the one target meant to be refused,
/// whichever tool reaches for it (a model told "no" to `touch` might try `Write` instead).
fn spike_policy(_tool: &str, input: &Value) -> Decision {
    if input.to_string().contains("spike-denied") {
        Decision::Deny { message: "auracode spike: denied on purpose", interrupt: false }
    } else {
        Decision::Allow
    }
}

struct TurnPlan {
    prompt: &'static str,
    uuid: String,
    policy: fn(&str, &Value) -> Decision,
    interrupt_after_text_deltas: Option<usize>,
    timeout: Duration,
}

impl TurnPlan {
    fn new(prompt: &'static str) -> Self {
        Self {
            prompt,
            uuid: uuid::Uuid::now_v7().to_string(),
            policy: deny_all,
            interrupt_after_text_deltas: None,
            timeout: TURN_TIMEOUT,
        }
    }

    fn local(prompt: &'static str) -> Self {
        Self { timeout: LOCAL_TURN_TIMEOUT, ..Self::new(prompt) }
    }
}

/// Everything one turn produced, reduced to what the findings need.
#[derive(Default)]
struct Turn {
    uuid: String,
    sent_ms: u64,
    init: Option<Value>,
    result: Option<Value>,
    first_message_ms: Option<u64>,
    first_text_ms: Option<u64>,
    result_ms: Option<u64>,
    text: String,
    text_deltas: usize,
    kinds: Vec<String>,
    after_result: Vec<String>,
    permissions: Vec<Value>,
    other_requests: Vec<Value>,
    cancels: Vec<Value>,
    control_responses: Vec<Value>,
    interrupt: Option<Value>,
    timed_out: bool,
    closed: bool,
    send_failures: Vec<String>,
}

impl Turn {
    fn session_id(&self) -> Option<String> {
        let from = |message: &Option<Value>| message.as_ref().and_then(|m| m["session_id"].as_str().map(str::to_owned));
        from(&self.init).or_else(|| from(&self.result))
    }
}

/// Sends one prompt and handles everything up to (and shortly after) its `result`: answers
/// permission requests by `plan.policy`, refuses any other request, and interrupts after a set
/// number of text deltas when asked to. A runaway turn is interrupted at its deadline.
async fn run_turn(s: &mut Session, plan: TurnPlan) -> Res<Turn> {
    let mut turn = Turn { uuid: plan.uuid.clone(), sent_ms: s.elapsed_ms(), ..Turn::default() };
    s.send(&protocol::user_message(plan.prompt, &plan.uuid)).await?;
    let mut deadline = Instant::now() + plan.timeout;
    let mut interrupt_sent = false;
    let mut result_seen = false;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            if result_seen || interrupt_sent {
                turn.timed_out |= !result_seen;
                return Ok(turn);
            }
            // Stop the turn before giving up on it, so it can't keep spending.
            turn.timed_out = true;
            let request_id = s.control(json!({"subtype": "interrupt"})).await?;
            turn.interrupt = Some(json!({"request_id": request_id, "sent_ms": s.elapsed_ms(), "reason": "timeout"}));
            interrupt_sent = true;
            deadline = Instant::now() + Duration::from_secs(30);
            continue;
        }
        let message = match s.recv(left).await {
            Recv::Message(message) => message,
            Recv::Timeout => continue,
            Recv::Closed => {
                turn.closed = !result_seen;
                return Ok(turn);
            }
        };
        let now = s.elapsed_ms();
        let kind = protocol::kind(&message);
        if result_seen {
            turn.after_result.push(kind);
        } else {
            turn.kinds.push(kind);
        }
        turn.first_message_ms.get_or_insert(now.saturating_sub(turn.sent_ms));
        match message["type"].as_str().unwrap_or_default() {
            "system" if message["subtype"] == "init" && turn.init.is_none() => turn.init = Some(message),
            "stream_event" => {
                let Some(text) = protocol::main_text_delta(&message) else { continue };
                turn.first_text_ms.get_or_insert(now.saturating_sub(turn.sent_ms));
                turn.text.push_str(text);
                turn.text_deltas += 1;
                if !interrupt_sent && plan.interrupt_after_text_deltas == Some(turn.text_deltas) {
                    let request_id = s.control(json!({"subtype": "interrupt"})).await?;
                    turn.interrupt = Some(json!({
                        "request_id": request_id,
                        "sent_ms": s.elapsed_ms(),
                        "after_text_deltas": turn.text_deltas,
                        "text_so_far": turn.text,
                    }));
                    interrupt_sent = true;
                }
            }
            "control_request" => {
                let request_id = message["request_id"].as_str().unwrap_or_default().to_owned();
                let request = &message["request"];
                let is_permission = request["subtype"] == "can_use_tool";
                let reply = if is_permission {
                    match (plan.policy)(request["tool_name"].as_str().unwrap_or_default(), &request["input"]) {
                        Decision::Allow => Some(protocol::allow(&request_id, &request["input"])),
                        Decision::Deny { message: text, interrupt } => {
                            Some(protocol::deny(&request_id, text, interrupt))
                        }
                        Decision::HoldAndInterrupt => None,
                    }
                } else {
                    Some(protocol::error(&request_id, "not supported by the spike host"))
                };
                match &reply {
                    Some(reply) => {
                        if let Err(e) = s.send(reply).await {
                            turn.send_failures.push(e.to_string());
                        }
                    }
                    None if !interrupt_sent => {
                        let interrupt_id = s.control(json!({"subtype": "interrupt"})).await?;
                        turn.interrupt = Some(json!({
                            "request_id": interrupt_id,
                            "sent_ms": s.elapsed_ms(),
                            "while_permission_pending": request_id,
                        }));
                        interrupt_sent = true;
                    }
                    None => {}
                }
                let record =
                    json!({"received_ms": now, "answered_ms": s.elapsed_ms(), "request": message, "reply": reply});
                if is_permission {
                    turn.permissions.push(record);
                } else {
                    turn.other_requests.push(record);
                }
            }
            "control_cancel_request" => turn.cancels.push(json!({"received_ms": now, "message": message})),
            "control_response" => turn.control_responses.push(json!({"received_ms": now, "message": message})),
            "result" if !result_seen => {
                turn.result_ms = Some(now.saturating_sub(turn.sent_ms));
                turn.result = Some(message);
                result_seen = true;
                deadline = Instant::now() + AFTER_RESULT;
            }
            _ => {}
        }
    }
}

struct Outcome {
    ok: bool,
    body: Value,
    waited_ms: u64,
    meanwhile: Vec<String>,
}

enum Await {
    Answered(Outcome),
    Closed,
    TimedOut,
}

async fn await_control(s: &mut Session, request_id: &str, timeout: Duration) -> Await {
    let sent_ms = s.elapsed_ms();
    let deadline = Instant::now() + timeout;
    let mut meanwhile = Vec::new();
    loop {
        match s.recv(deadline.saturating_duration_since(Instant::now())).await {
            Recv::Timeout => return Await::TimedOut,
            Recv::Closed => return Await::Closed,
            Recv::Message(message) => {
                let response = &message["response"];
                if message["type"] == "control_response" && response["request_id"] == request_id {
                    let ok = response["subtype"] == "success";
                    let body = if ok { response["response"].clone() } else { response["error"].clone() };
                    let waited_ms = s.elapsed_ms().saturating_sub(sent_ms);
                    return Await::Answered(Outcome { ok, body, waited_ms, meanwhile });
                }
                meanwhile.push(protocol::kind(&message));
                answer_unexpected(s, &message).await;
            }
        }
    }
}

/// Between turns nothing should ask the host anything, but an unanswered request would block the
/// CLI, so anything that does is refused.
async fn answer_unexpected(s: &mut Session, message: &Value) {
    if message["type"] != "control_request" {
        return;
    }
    let request_id = message["request_id"].as_str().unwrap_or_default();
    let reply = if message["request"]["subtype"] == "can_use_tool" {
        protocol::deny(request_id, "auracode spike: unexpected permission request", false)
    } else {
        protocol::error(request_id, "not supported by the spike host")
    };
    let _ignored = s.send(&reply).await;
}

/// Sends `initialize` and waits for its answer. `None` means the CLI exited first, which is how a
/// refused `--resume` would show up.
async fn initialize(s: &mut Session) -> Res<Option<Outcome>> {
    let Ok(request_id) = s.control(protocol::initialize()).await else { return Ok(None) };
    match await_control(s, &request_id, INIT_TIMEOUT).await {
        Await::Answered(outcome) => Ok(Some(outcome)),
        Await::Closed => Ok(None),
        Await::TimedOut => Err("no answer to initialize".into()),
    }
}

/// One control request, its answer condensed for the findings.
async fn probe_control(s: &mut Session, label: &str, request: Value) -> Value {
    let request_id = match s.control(request.clone()).await {
        Ok(request_id) => request_id,
        Err(e) => return json!({"label": label, "request": request, "send_failed": e.to_string()}),
    };
    match await_control(s, &request_id, CONTROL_TIMEOUT).await {
        Await::Answered(outcome) => json!({
            "label": label,
            "request": request,
            "ok": outcome.ok,
            "ms": outcome.waited_ms,
            "response": condense(&request, &outcome.body),
            "meanwhile": outcome.meanwhile,
        }),
        Await::Closed => json!({"label": label, "request": request, "closed": true}),
        Await::TimedOut => json!({"label": label, "request": request, "timed_out": true}),
    }
}

/// The model a prompt sent now would run on, read through the free `get_context_usage`.
async fn current_model(s: &mut Session) -> (Option<String>, Value) {
    let probe =
        probe_control(s, "get_context_usage summary", json!({"subtype": "get_context_usage", "detail": "summary"}))
            .await;
    let model = if probe["ok"] == true { probe["response"]["model"].as_str().map(str::to_owned) } else { None };
    (model, probe)
}

/// Refuses to spend a prompt when the session reports a model other than the one asked for.
fn require_model(seen: Option<&str>, wanted: &str) -> Res<()> {
    match seen {
        Some(model) if !model.to_ascii_lowercase().contains(&wanted.to_ascii_lowercase()) => {
            Err(format!("the session would answer on {model}, not {wanted}; no prompt sent").into())
        }
        _ => Ok(()),
    }
}

/// Every control request the plan relies on, plus the error paths, against an idle session.
async fn run_controls(s: &mut Session, user_message_id: &str) -> Vec<Value> {
    let probes = [
        ("get_context_usage", json!({"subtype": "get_context_usage"})),
        ("list_models", json!({"subtype": "list_models"})),
        ("get_usage", json!({"subtype": "get_usage", "skip_behaviors": true})),
        ("set_model sonnet", json!({"subtype": "set_model", "model": "sonnet"})),
        ("model after set_model sonnet", json!({"subtype": "get_context_usage", "detail": "summary"})),
        ("set_model default", json!({"subtype": "set_model", "model": "default"})),
        ("model after set_model default", json!({"subtype": "get_context_usage", "detail": "summary"})),
        // Leave the session on the cheap model, since later experiments resume it.
        ("set_model haiku", json!({"subtype": "set_model", "model": "haiku"})),
        ("set_permission_mode acceptEdits", json!({"subtype": "set_permission_mode", "mode": "acceptEdits"})),
        ("set_permission_mode manual", json!({"subtype": "set_permission_mode", "mode": "manual"})),
        (
            "set_permission_mode bypassPermissions",
            json!({"subtype": "set_permission_mode", "mode": "bypassPermissions"}),
        ),
        ("set_permission_mode default", json!({"subtype": "set_permission_mode", "mode": "default"})),
        (
            "apply_flag_settings effortLevel low",
            json!({"subtype": "apply_flag_settings", "settings": {"effortLevel": "low"}}),
        ),
        (
            "apply_flag_settings effortLevel bogus",
            json!({"subtype": "apply_flag_settings", "settings": {"effortLevel": "bogus"}}),
        ),
        (
            "apply_flag_settings effortLevel null",
            json!({"subtype": "apply_flag_settings", "settings": {"effortLevel": null}}),
        ),
        ("interrupt while idle", json!({"subtype": "interrupt"})),
        (
            "rewind_files dry_run",
            json!({"subtype": "rewind_files", "user_message_id": user_message_id, "dry_run": true}),
        ),
        ("unknown subtype", json!({"subtype": "aura_spike_unknown"})),
    ];
    let mut out = Vec::new();
    for (label, request) in probes {
        let mut entry = probe_control(s, label, request).await;
        let trailing: Vec<String> = s.drain(Duration::from_millis(300)).await.iter().map(protocol::kind).collect();
        let closed = entry["closed"] == true;
        if let Some(map) = entry.as_object_mut() {
            map.insert("trailing".to_owned(), json!(trailing));
        }
        out.push(entry);
        if closed {
            break;
        }
    }
    out
}

/// The protocol's shutdown: close stdin and let the CLI exit on its own; signals only if it
/// doesn't.
async fn shut_down(s: &mut Session) -> Res<Value> {
    let closed_at = s.elapsed_ms();
    s.close_stdin();
    let mut info = s.wait_exit(EXIT_TIMEOUT).await?;
    let needed_signals = info.status.is_none();
    if needed_signals {
        info = s.terminate().await?;
    }
    Ok(json!({
        "close_to_exit_ms": s.elapsed_ms().saturating_sub(closed_at),
        "needed_signals": needed_signals,
        "exit": exit_summary(&info),
        "stderr_tail": s.stderr_tail(15),
    }))
}

/// Ends a session that won't be used, without caring how.
async fn abandon(s: &mut Session) {
    s.close_stdin();
    if let Ok(info) = s.wait_exit(EXIT_TIMEOUT).await
        && info.status.is_none()
    {
        let _ignored = s.terminate().await;
    }
}

/// When the CLI exits instead of answering `initialize`, the exit itself is the observation.
async fn early_exit_summary(s: &mut Session) -> Res<Value> {
    let mut info = s.wait_exit(EXIT_TIMEOUT).await?;
    if info.status.is_none() {
        info = s.terminate().await?;
    }
    let skip = s.stdout_lines.len().saturating_sub(5);
    Ok(json!({
        "answered_initialize": false,
        "exit": exit_summary(&info),
        "stdout_tail": s.stdout_lines[skip..].to_vec(),
        "stderr_tail": s.stderr_tail(20),
    }))
}

fn exit_summary(info: &ExitInfo) -> Value {
    let Some(status) = info.status else {
        return json!({"exited": false, "pipes_open": info.pipes_open});
    };
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status);
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    json!({"exited": true, "code": status.code(), "signal": signal, "pipes_open": info.pipes_open})
}

// ---------------------------------------------------------------------------------------------
// Summaries

fn keys(v: &Value) -> Vec<String> {
    v.as_object().map(|map| map.keys().cloned().collect()).unwrap_or_default()
}

fn clip_str(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        text.to_owned()
    } else {
        format!("{}... ({count} chars)", text.chars().take(max_chars).collect::<String>())
    }
}

fn clip(v: &Value, max_chars: usize) -> Value {
    match v {
        Value::String(text) => json!(clip_str(text, max_chars)),
        other => {
            let text = other.to_string();
            if text.chars().count() <= max_chars { other.clone() } else { json!(clip_str(&text, max_chars)) }
        }
    }
}

fn condense(request: &Value, body: &Value) -> Value {
    match request["subtype"].as_str().unwrap_or_default() {
        "get_context_usage" if body.is_object() => json!({
            "keys": keys(body),
            "model": body["model"],
            "totalTokens": body["totalTokens"],
            "maxTokens": body["maxTokens"],
            "rawMaxTokens": body["rawMaxTokens"],
            "percentage": body["percentage"],
            "isAutoCompactEnabled": body["isAutoCompactEnabled"],
            "autoCompactThreshold": body["autoCompactThreshold"],
            "categories": body["categories"].as_array().map(|rows| rows.iter().map(|row| json!({
                "id": row["id"], "name": row["name"], "tokens": row["tokens"], "kind": row["kind"],
            })).collect::<Vec<_>>()),
            "apiUsage": body["apiUsage"],
        }),
        "get_usage" if body.is_object() => json!({
            "keys": keys(body),
            "session": body["session"],
            "subscription_type": body["subscription_type"],
            "rate_limits_available": body["rate_limits_available"],
            "rate_limits": body["rate_limits"],
        }),
        "list_models" => clip(body, 6000),
        _ => clip(body, 3000),
    }
}

fn model_values(init: &Value) -> Vec<String> {
    init["models"]
        .as_array()
        .map(|models| models.iter().filter_map(|m| m["value"].as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// Whether a built-in command (by name or alias) is offered; only built-ins are sure to run
/// locally instead of reaching the model.
fn builtin_listed(init: &Value, name: &str) -> bool {
    init["commands"].as_array().is_some_and(|commands| {
        commands.iter().any(|c| {
            c["builtin"] == true
                && (c["name"] == name
                    || c["aliases"].as_array().is_some_and(|aliases| aliases.iter().any(|a| a == name)))
        })
    })
}

fn init_response_summary(body: &Value) -> Value {
    let commands = body["commands"].as_array();
    let builtins: Vec<Value> = commands
        .into_iter()
        .flatten()
        .filter(|c| c["builtin"] == true)
        .map(|c| json!({"name": c["name"], "aliases": c["aliases"], "argumentHint": c["argumentHint"]}))
        .collect();
    let account = &body["account"];
    json!({
        "keys": keys(body),
        "models": body["models"].as_array().map(|models| models.iter().map(|m| json!({
            "value": m["value"], "resolvedModel": m["resolvedModel"], "displayName": m["displayName"],
            "supportsEffort": m["supportsEffort"], "supportedEffortLevels": m["supportedEffortLevels"],
            "supportsAutoMode": m["supportsAutoMode"], "supportsFastMode": m["supportsFastMode"],
        })).collect::<Vec<_>>()),
        "commands_total": commands.map(Vec::len),
        "builtin_commands": builtins,
        "agents": body["agents"].as_array().map(|agents| agents.iter().map(|a| a["name"].clone()).collect::<Vec<_>>()),
        "output_style": body["output_style"],
        "available_output_styles": body["available_output_styles"],
        "account_keys": keys(account),
        "account_non_identifying": {
            "subscriptionType": account["subscriptionType"], "tokenSource": account["tokenSource"],
            "apiKeySource": account["apiKeySource"], "apiProvider": account["apiProvider"],
        },
        "claude_code_version": body["claude_code_version"],
        "fast_mode_state": body["fast_mode_state"],
        "fast_mode_disabled_reason": body["fast_mode_disabled_reason"],
        "other_fields": body.as_object().map(|map| map.iter()
            .filter(|(key, _)| !["commands", "models", "agents", "account", "output_style", "available_output_styles",
                                  "claude_code_version", "fast_mode_state", "fast_mode_disabled_reason"].contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), clip(value, 500)))
            .collect::<Map<_, _>>()),
    })
}

fn system_init_summary(v: &Value) -> Value {
    let len = |key: &str| v[key].as_array().map(Vec::len);
    json!({
        "keys": keys(v),
        "session_id": v["session_id"],
        "cwd": v["cwd"],
        "model": v["model"],
        "permissionMode": v["permissionMode"],
        "apiKeySource": v["apiKeySource"],
        "claude_code_version": v["claude_code_version"],
        "output_style": v["output_style"],
        "capabilities": v["capabilities"],
        "tools": len("tools"),
        "mcp_servers": v["mcp_servers"],
        "slash_commands": len("slash_commands"),
        "skills": len("skills"),
        "plugins": len("plugins"),
        "agents": v["agents"],
        "betas": v["betas"],
        "fast_mode_state": v["fast_mode_state"],
    })
}

fn result_summary(v: &Value) -> Value {
    json!({
        "keys": keys(v),
        "subtype": v["subtype"],
        "is_error": v["is_error"],
        "stop_reason": v["stop_reason"],
        "terminal_reason": v["terminal_reason"],
        "num_turns": v["num_turns"],
        "result": clip(&v["result"], 400),
        "errors": v["errors"],
        "duration_ms": v["duration_ms"],
        "duration_api_ms": v["duration_api_ms"],
        "total_cost_usd": v["total_cost_usd"],
        "usage": v["usage"],
        "modelUsage": v["modelUsage"],
        "permission_denials": v["permission_denials"],
        "user_message_uuid": v["user_message_uuid"],
        "user_message_uuids": v["user_message_uuids"],
        "result_index": v["result_index"],
        "queued_turn_count": v["queued_turn_count"],
        "local_command": v["local_command"],
        "api_error_status": v["api_error_status"],
        "session_id": v["session_id"],
    })
}

fn turn_summary(turn: &Turn) -> Value {
    json!({
        "user_message_uuid": turn.uuid,
        "ms_to_first_message": turn.first_message_ms,
        "ms_to_first_text": turn.first_text_ms,
        "ms_to_result": turn.result_ms,
        "text": clip_str(&turn.text, 600),
        "text_deltas": turn.text_deltas,
        "shape": protocol::run_lengths(&turn.kinds),
        "after_result": protocol::run_lengths(&turn.after_result),
        "system_init": turn.init.as_ref().map(system_init_summary),
        "result": turn.result.as_ref().map(result_summary),
        "permissions": turn.permissions,
        "other_requests": turn.other_requests,
        "cancels": turn.cancels,
        "control_responses": turn.control_responses,
        "interrupt": turn.interrupt,
        "timed_out": turn.timed_out,
        "closed_before_result": turn.closed,
        "send_failures": turn.send_failures,
    })
}

/// How often each message kind appeared on stdout over the whole session.
fn vocabulary(s: &Session) -> Value {
    let mut counts = BTreeMap::<String, usize>::new();
    for line in &s.stdout_lines {
        if let protocol::Parsed::Json(message) = protocol::parse_line(line) {
            *counts.entry(protocol::kind(&message)).or_default() += 1;
        }
    }
    json!(counts)
}

fn init_block(init: &Outcome) -> Value {
    json!({"ok": init.ok, "ms": init.waited_ms, "meanwhile": init.meanwhile, "response": init_response_summary(&init.body)})
}

// ---------------------------------------------------------------------------------------------
// Folders

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

fn git(dir: &Path, args: &[&str]) -> Res<String> {
    let out = std::process::Command::new("git").arg("-C").arg(dir).args(args).output()?;
    if !out.status.success() {
        return Err(format!("git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr)).into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// A fresh repository with one commit, so it can also grow a worktree later.
fn init_git_repo(dir: &Path) -> Res<()> {
    std::fs::create_dir_all(dir)?;
    git(dir, &["init", "-q", "-b", "main"])?;
    std::fs::write(dir.join("README.md"), "auracode claude-control spike repository\n")?;
    git(dir, &["add", "README.md"])?;
    git(
        dir,
        &[
            "-c",
            "user.name=auracode-spike",
            "-c",
            "user.email=spike@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "init",
        ],
    )?;
    Ok(())
}

/// The Isolated-folder case from the plan: a git worktree of the original repository.
fn add_worktree(repo: &Path, worktree: &Path) -> Res<()> {
    if !worktree.exists() {
        git(repo, &["worktree", "add", "-q", "-b", "aura/spike", &worktree.to_string_lossy()])?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Experiments

/// Free: what `initialize` returns and whether the planned model and local command exist.
pub async fn probe(ctx: &Ctx) -> Res<Value> {
    let dir = ctx.dir("dir-probe");
    std::fs::create_dir_all(&dir)?;
    let (env, dropped) = ctx.child_env(true);
    let extra = strings(&["--permission-mode", "default"]);
    let mut s = ctx.spawn("probe", &dir, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        return early_exit_summary(&mut s).await;
    };
    let (model, context) = current_model(&mut s).await;
    let models = probe_control(&mut s, "list_models", json!({"subtype": "list_models"})).await;
    let shutdown = shut_down(&mut s).await?;
    Ok(json!({
        "args": ctx.args(&extra),
        "scrubbed_env_names": dropped,
        "initialize": init_block(&init),
        "model_offered": model_values(&init.body).contains(&ctx.model),
        "usage_builtin_listed": builtin_listed(&init.body, "usage"),
        "current_model": model,
        "context_before_any_turn": context,
        "list_models": models,
        "shutdown": shutdown,
        "vocabulary": vocabulary(&s),
    }))
}

/// Experiments 1, 2, 4 and 5 in one session: a basic turn, the permission flow, every control
/// request, then shutdown with process-table snapshots around it.
pub async fn p1(ctx: &Ctx) -> Res<Value> {
    let dir_a = ctx.dir("dir-a");
    if dir_a.exists() {
        return Err(
            format!("{} exists; p1 spends prompts, so it only runs against a fresh --root", dir_a.display()).into()
        );
    }
    init_git_repo(&dir_a)?;
    let (env, dropped) = ctx.child_env(true);
    let extra = strings(&["--permission-mode", "default"]);
    let before = procs::snapshot()?;
    let mut s = ctx.spawn("p1", &dir_a, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        return early_exit_summary(&mut s).await;
    };
    let offered = model_values(&init.body);
    if !offered.contains(&ctx.model) {
        abandon(&mut s).await;
        return Err(format!("--model {} is not offered by initialize: {offered:?}", ctx.model).into());
    }
    let (model, _) = current_model(&mut s).await;
    if let Err(e) = require_model(model.as_deref(), &ctx.model) {
        abandon(&mut s).await;
        return Err(e);
    }

    let basic = run_turn(&mut s, TurnPlan::new(BASIC_PROMPT)).await?;
    let basic_end = s.stdout_lines.len();
    let idle = procs::snapshot()?;
    let permission = run_turn(&mut s, TurnPlan { policy: spike_policy, ..TurnPlan::new(PERMISSION_PROMPT) }).await?;
    let permission_end = s.stdout_lines.len();
    let controls = run_controls(&mut s, &permission.uuid).await;
    let loaded = procs::snapshot()?;
    let shutdown = shut_down(&mut s).await?;
    // Give anything that detached a moment to show itself (or to finish exiting).
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let after = procs::snapshot()?;

    let session_id = basic.session_id().or_else(|| permission.session_id()).ok_or("no turn reported a session_id")?;
    let transcript = ctx.project_dir(&dir_a).join(format!("{session_id}.jsonl"));
    ctx.write_state(&json!({"session_id": session_id, "dir_a": dir_a, "transcript": transcript}))?;
    ctx.write_fixture("turn-basic", &s, 0, Some(basic_end))?;
    ctx.write_fixture("turn-permission", &s, basic_end, Some(permission_end))?;
    ctx.write_fixture("controls", &s, permission_end, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "cwd": dir_a,
        "scrubbed_env_names": dropped,
        "initialize": init_block(&init),
        "model_before_first_turn": model,
        "basic": turn_summary(&basic),
        "permission": turn_summary(&permission),
        "files_after_permission_turn": {
            "spike-allowed.txt": dir_a.join("spike-allowed.txt").exists(),
            "spike-denied.txt": dir_a.join("spike-denied.txt").exists(),
        },
        "controls": controls,
        "shutdown": shutdown,
        "process_tree": procs::report(&before, &[&idle, &loaded], &after, s.pid()),
        "transcripts": ctx.transcripts(&[&dir_a]),
        "corrupt_stdout_lines": s.corrupt_lines,
        "vocabulary": vocabulary(&s),
        "session_id": session_id,
        "transcript": transcript,
    }))
}

/// Experiment 3, in the session from `p1` resumed from its own folder (which doubles as the
/// "resume from dir A" check): interrupt a long answer, then see whether the process still works.
pub async fn interrupt(ctx: &Ctx) -> Res<Value> {
    let state = ctx.read_state()?;
    let (env, _) = ctx.child_env(true);
    let extra = vec!["--permission-mode".to_owned(), "default".to_owned(), format!("--resume={}", state.session_id)];
    let mut s = ctx.spawn("interrupt", &state.dir_a, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        let outcome = early_exit_summary(&mut s).await?;
        ctx.write_fixture("turn-interrupt", &s, 0, None)?;
        return Ok(json!({"args": ctx.args(&extra), "outcome": outcome}));
    };
    let (model, context) = current_model(&mut s).await;
    if let Err(e) = require_model(model.as_deref(), &ctx.model) {
        abandon(&mut s).await;
        return Err(e);
    }
    let count =
        run_turn(&mut s, TurnPlan { interrupt_after_text_deltas: Some(3), ..TurnPlan::new(COUNT_PROMPT) }).await?;
    let count_end = s.stdout_lines.len();
    let follow_up = run_turn(&mut s, TurnPlan::new(AFTER_INTERRUPT_PROMPT)).await?;
    let shutdown = shut_down(&mut s).await?;
    ctx.write_fixture("turn-interrupt", &s, 0, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "initialize": init_block(&init),
        "context_after_resume": context,
        "resumed_same_session": count.session_id().as_deref() == Some(state.session_id.as_str()),
        "count": turn_summary(&count),
        "count_turn_ends_at_stdout_line": count_end,
        "follow_up": turn_summary(&follow_up),
        "shutdown": shutdown,
        "vocabulary": vocabulary(&s),
    }))
}

/// Experiment 6, worktree half: resume `p1`'s session from a git worktree of its folder, which is
/// what moving a chat from Direct to Isolated does.
pub async fn resume_worktree(ctx: &Ctx) -> Res<Value> {
    let state = ctx.read_state()?;
    let dir_b = ctx.dir("dir-b");
    add_worktree(&state.dir_a, &dir_b)?;
    let before = ctx.transcripts(&[&state.dir_a, &dir_b]);
    let (env, _) = ctx.child_env(true);
    let extra = vec!["--permission-mode".to_owned(), "default".to_owned(), format!("--resume={}", state.session_id)];
    let mut s = ctx.spawn("resume-worktree", &dir_b, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        let outcome = early_exit_summary(&mut s).await?;
        ctx.write_fixture("resume-worktree", &s, 0, None)?;
        return Ok(json!({"args": ctx.args(&extra), "outcome": outcome, "transcripts_before": before}));
    };
    let (model, context) = current_model(&mut s).await;
    if let Err(e) = require_model(model.as_deref(), &ctx.model) {
        abandon(&mut s).await;
        return Err(e);
    }
    let turn = run_turn(&mut s, TurnPlan::new(RESUME_PROMPT)).await?;
    let shutdown = shut_down(&mut s).await?;
    let after = ctx.transcripts(&[&state.dir_a, &dir_b]);
    ctx.write_fixture("resume-worktree", &s, 0, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "cwd": dir_b,
        "worktree_of": state.dir_a,
        "initialize": init_block(&init),
        "context_after_resume": context,
        "turn": turn_summary(&turn),
        "same_session_id": turn.session_id().as_deref() == Some(state.session_id.as_str()),
        "transcripts_before": before,
        "transcripts_after": after,
        "shutdown": shutdown,
    }))
}

/// Experiment 6, unrelated-folder half, without a model call: resume by id from a plain folder
/// that has nothing to do with the original. Also shows the permission mode this user's settings
/// give an auracode spawn, and whether bypass can be entered later when launch allowed it.
pub async fn resume_unrelated(ctx: &Ctx) -> Res<Value> {
    let state = ctx.read_state()?;
    let dir_c = ctx.dir("dir-c");
    std::fs::create_dir_all(&dir_c)?;
    let before = ctx.transcripts(&[&state.dir_a, &dir_c]);
    let (env, _) = ctx.child_env(true);
    let extra = vec!["--allow-dangerously-skip-permissions".to_owned(), format!("--resume={}", state.session_id)];
    let mut s = ctx.spawn("resume-unrelated", &dir_c, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        let outcome = early_exit_summary(&mut s).await?;
        ctx.write_fixture("resume-unrelated", &s, 0, None)?;
        return Ok(json!({"args": ctx.args(&extra), "outcome": outcome, "transcripts_before": before}));
    };
    let context =
        probe_control(&mut s, "get_context_usage after resume", json!({"subtype": "get_context_usage"})).await;
    let local = if builtin_listed(&init.body, "usage") {
        Some(run_turn(&mut s, TurnPlan::local(LOCAL_COMMAND)).await?)
    } else {
        None
    };
    let bypass = probe_control(
        &mut s,
        "set_permission_mode bypassPermissions (launched with --allow-dangerously-skip-permissions)",
        json!({"subtype": "set_permission_mode", "mode": "bypassPermissions"}),
    )
    .await;
    let back = probe_control(
        &mut s,
        "set_permission_mode default",
        json!({"subtype": "set_permission_mode", "mode": "default"}),
    )
    .await;
    let shutdown = shut_down(&mut s).await?;
    let after = ctx.transcripts(&[&state.dir_a, &dir_c]);
    ctx.write_fixture("resume-unrelated", &s, 0, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "cwd": dir_c,
        "initialize": init_block(&init),
        "context_after_resume": context,
        "local_turn": local.as_ref().map(turn_summary),
        "same_session_id": local.as_ref().and_then(Turn::session_id).as_deref() == Some(state.session_id.as_str()),
        "bypass": bypass,
        "back_to_default": back,
        "transcripts_before": before,
        "transcripts_after": after,
        "shutdown": shutdown,
    }))
}

/// Experiment 6, transcript-path variant, without a model call: `--resume` with the absolute
/// path of the session's `.jsonl`, from the unrelated folder.
pub async fn resume_path(ctx: &Ctx) -> Res<Value> {
    let state = ctx.read_state()?;
    let dir_c = ctx.dir("dir-c");
    std::fs::create_dir_all(&dir_c)?;
    let before = ctx.transcripts(&[&state.dir_a, &dir_c]);
    let (env, _) = ctx.child_env(true);
    let extra =
        vec!["--permission-mode".to_owned(), "default".to_owned(), format!("--resume={}", state.transcript.display())];
    let mut s = ctx.spawn("resume-path", &dir_c, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        let outcome = early_exit_summary(&mut s).await?;
        ctx.write_fixture("resume-path", &s, 0, None)?;
        return Ok(json!({"args": ctx.args(&extra), "outcome": outcome, "transcripts_before": before}));
    };
    let local = if builtin_listed(&init.body, "usage") {
        Some(run_turn(&mut s, TurnPlan::local(LOCAL_COMMAND)).await?)
    } else {
        None
    };
    let shutdown = shut_down(&mut s).await?;
    let after = ctx.transcripts(&[&state.dir_a, &dir_c]);
    ctx.write_fixture("resume-path", &s, 0, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "cwd": dir_c,
        "transcript_exists": state.transcript.exists(),
        "initialize": init_block(&init),
        "local_turn": local.as_ref().map(turn_summary),
        "same_session_id": local.as_ref().and_then(Turn::session_id).as_deref() == Some(state.session_id.as_str()),
        "transcripts_before": before,
        "transcripts_after": after,
        "shutdown": shutdown,
    }))
}

/// Experiment 6, fork variant, from the unrelated folder: first with `--session-id` choosing the
/// fork's id (which would let auracode know it before the first turn), then without if refused.
pub async fn fork(ctx: &Ctx, with_model_prompt: bool) -> Res<Value> {
    let state = ctx.read_state()?;
    let dir_c = ctx.dir("dir-c");
    std::fs::create_dir_all(&dir_c)?;
    let before = ctx.transcripts(&[&state.dir_a, &dir_c]);
    let chosen = uuid::Uuid::now_v7().to_string();
    let mut attempts = Vec::new();
    for choose_id in [true, false] {
        let name = if choose_id { "fork" } else { "fork-random-id" };
        let mut extra = strings(&["--permission-mode", "default", "--fork-session"]);
        extra.push(format!("--resume={}", state.session_id));
        if choose_id {
            extra.push(format!("--session-id={chosen}"));
        }
        let (env, _) = ctx.child_env(true);
        let mut s = ctx.spawn(name, &dir_c, &extra, env)?;
        let Some(init) = initialize(&mut s).await? else {
            let outcome = early_exit_summary(&mut s).await?;
            ctx.write_fixture(&format!("{name}-refused"), &s, 0, None)?;
            attempts.push(json!({"args": ctx.args(&extra), "outcome": outcome}));
            continue;
        };
        let local = if builtin_listed(&init.body, "usage") {
            Some(run_turn(&mut s, TurnPlan::local(LOCAL_COMMAND)).await?)
        } else {
            None
        };
        let mut prompt = None;
        if with_model_prompt {
            let (model, _) = current_model(&mut s).await;
            if let Err(e) = require_model(model.as_deref(), &ctx.model) {
                abandon(&mut s).await;
                return Err(e);
            }
            prompt = Some(run_turn(&mut s, TurnPlan::new(FORK_PROMPT)).await?);
        }
        let shutdown = shut_down(&mut s).await?;
        ctx.write_fixture(name, &s, 0, None)?;
        let forked = local.as_ref().and_then(Turn::session_id).or_else(|| prompt.as_ref().and_then(Turn::session_id));
        attempts.push(json!({
            "args": ctx.args(&extra),
            "initialize": init_block(&init),
            "local_turn": local.as_ref().map(turn_summary),
            "prompt_turn": prompt.as_ref().map(turn_summary),
            "forked_session_id": forked,
            "is_chosen_id": forked.as_deref() == Some(chosen.as_str()),
            "differs_from_original": forked.as_deref() != Some(state.session_id.as_str()),
            "shutdown": shutdown,
        }));
        break;
    }
    let after = ctx.transcripts(&[&state.dir_a, &dir_c]);
    Ok(json!({
        "original_session_id": state.session_id,
        "chosen_session_id": chosen,
        "attempts": attempts,
        "transcripts_before": before,
        "transcripts_after": after,
    }))
}

/// Interrupting while a permission request is still open (Esc on an open permission card), in a
/// fresh session in the first folder. Shows whether the CLI withdraws the request with
/// `control_cancel_request`, how the turn ends, and whether a late answer to the withdrawn
/// request is ignored rather than acted on.
pub async fn interrupt_permission(ctx: &Ctx) -> Res<Value> {
    let state = ctx.read_state()?;
    let dir = state.dir_a;
    let (env, _) = ctx.child_env(true);
    let extra = strings(&["--permission-mode", "default"]);
    let mut s = ctx.spawn("interrupt-permission", &dir, &extra, env)?;
    let Some(init) = initialize(&mut s).await? else {
        let outcome = early_exit_summary(&mut s).await?;
        ctx.write_fixture("turn-interrupt-permission", &s, 0, None)?;
        return Ok(json!({"args": ctx.args(&extra), "outcome": outcome}));
    };
    let (model, _) = current_model(&mut s).await;
    if let Err(e) = require_model(model.as_deref(), &ctx.model) {
        abandon(&mut s).await;
        return Err(e);
    }
    let turn = run_turn(&mut s, TurnPlan { policy: hold_and_interrupt, ..TurnPlan::new(PENDING_PROMPT) }).await?;
    // Answer the withdrawn request now, the way a slow UI would.
    let late = match turn.permissions.first() {
        Some(record) => {
            let request_id = record["request"]["request_id"].as_str().unwrap_or_default().to_owned();
            let input = record["request"]["request"]["input"].clone();
            s.send(&protocol::allow(&request_id, &input)).await?;
            let after: Vec<String> = s.drain(Duration::from_millis(2500)).await.iter().map(protocol::kind).collect();
            json!({"request_id": request_id, "messages_after_late_allow": after})
        }
        None => Value::Null,
    };
    let file_created = dir.join("spike-pending.txt").exists();
    let shutdown = shut_down(&mut s).await?;
    ctx.write_fixture("turn-interrupt-permission", &s, 0, None)?;
    Ok(json!({
        "args": ctx.args(&extra),
        "initialize": init_block(&init),
        "turn": turn_summary(&turn),
        "late_allow": late,
        "file_created_by_late_allow": file_created,
        "shutdown": shutdown,
        "vocabulary": vocabulary(&s),
    }))
}

/// The scrub check, without a model call: the same spawn with the scrubbed environment and with
/// everything inherited from this Claude Code session.
pub async fn env_compare(ctx: &Ctx) -> Res<Value> {
    let dir_d = ctx.dir("dir-d");
    std::fs::create_dir_all(&dir_d)?;
    let parent_socket = std::env::var_os("CLAUDE_CODE_MESSAGING_SOCKET").map(PathBuf::from);
    let socket_existed = parent_socket.as_ref().map(|path| path.exists());
    let extra = strings(&["--permission-mode", "default"]);
    let mut runs = Vec::new();
    for (name, scrub) in [("env-scrubbed", true), ("env-inherited", false)] {
        let (env, dropped) = ctx.child_env(scrub);
        let inherited_markers: Vec<String> = env
            .iter()
            .filter(|(key, _)| env_scrub::is_scrubbed(key))
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect();
        let before = ctx.transcripts(&[&dir_d]);
        let mut s = ctx.spawn(name, &dir_d, &extra, env)?;
        let init = initialize(&mut s).await?;
        let sockets = procs::unix_sockets(s.pid());
        let holds_parent_socket =
            parent_socket.as_ref().is_some_and(|path| sockets.iter().any(|socket| Path::new(socket) == path.as_path()));
        let (init_value, local, shutdown) = match &init {
            Some(init) => {
                let local = if builtin_listed(&init.body, "usage") {
                    Some(run_turn(&mut s, TurnPlan::local(LOCAL_COMMAND)).await?)
                } else {
                    None
                };
                (init_block(init), local, shut_down(&mut s).await?)
            }
            None => (Value::Null, None, early_exit_summary(&mut s).await?),
        };
        let after = ctx.transcripts(&[&dir_d]);
        ctx.write_fixture(name, &s, 0, None)?;
        runs.push(json!({
            "name": name,
            "scrubbed_env_names": dropped,
            "parent_markers_passed_to_child": inherited_markers,
            "answered_initialize": init.is_some(),
            "initialize": init_value,
            "local_turn": local.as_ref().map(turn_summary),
            "child_unix_sockets": sockets,
            "child_holds_parent_messaging_socket_path": holds_parent_socket,
            "shutdown": shutdown,
            "transcripts_before": before,
            "transcripts_after": after,
            "vocabulary": vocabulary(&s),
        }));
    }
    Ok(json!({
        "args": ctx.args(&extra),
        "parent_messaging_socket_existed_before": socket_existed,
        "parent_messaging_socket_exists_after": parent_socket.as_ref().map(|path| path.exists()),
        "runs": runs,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_marked_command_is_denied() {
        assert!(matches!(spike_policy("Bash", &json!({"command": "touch spike-allowed.txt"})), Decision::Allow));
        assert!(matches!(
            spike_policy("Bash", &json!({"command": "touch spike-denied.txt"})),
            Decision::Deny { interrupt: false, .. }
        ));
        assert!(matches!(
            spike_policy("Write", &json!({"file_path": "/x/spike-denied.txt", "content": ""})),
            Decision::Deny { .. }
        ));
        assert!(matches!(deny_all("Bash", &json!({"command": "ls"})), Decision::Deny { .. }));
        assert!(matches!(hold_and_interrupt("Bash", &json!({})), Decision::HoldAndInterrupt));
    }

    #[test]
    fn model_check_compares_case_insensitively_by_containment() {
        assert!(require_model(Some("claude-haiku-4-5-20251001"), "haiku").is_ok());
        assert!(require_model(Some("Claude-Haiku"), "haiku").is_ok());
        assert!(require_model(None, "haiku").is_ok());
        assert!(require_model(Some("claude-opus-5"), "haiku").is_err());
    }

    #[test]
    fn builtin_commands_are_matched_by_name_or_alias() {
        let init = json!({"commands": [
            {"name": "usage", "builtin": true, "aliases": ["cost", "stats"]},
            {"name": "review", "description": "a skill"},
        ]});
        assert!(builtin_listed(&init, "usage"));
        assert!(builtin_listed(&init, "cost"));
        assert!(!builtin_listed(&init, "review"));
        assert!(!builtin_listed(&json!({}), "usage"));
    }

    #[test]
    fn clipping_counts_characters_not_bytes() {
        assert_eq!(clip_str("héllo", 10), "héllo");
        assert_eq!(clip_str("ééééé", 2), "éé... (5 chars)");
        assert_eq!(clip(&json!({"a": 1}), 100), json!({"a": 1}));
    }

    #[test]
    fn transcript_facts_collect_distinct_fields() {
        let text = "{\"type\":\"user\",\"cwd\":\"/a\",\"sessionId\":\"s1\",\"entrypoint\":\"sdk-cli\"}\n{\"type\":\"assistant\",\"cwd\":\"/b\",\"sessionId\":\"s1\"}\nnot json\n";
        let facts = transcript_facts(Path::new("/x/s1.jsonl"), text);
        assert_eq!(facts["lines"], 3);
        assert_eq!(facts["cwds"], json!(["/a", "/b"]));
        assert_eq!(facts["session_ids"], json!(["s1"]));
        assert_eq!(facts["entrypoints"], json!(["sdk-cli"]));
        assert_eq!(facts["file"], "s1.jsonl");
    }

    /// A refused `--resume` makes the CLI print an error result and exit without answering
    /// `initialize`; that has to come back as an observation, not hang until the timeout.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_child_that_exits_before_answering_initialize_is_reported() {
        let spec = SpawnSpec {
            program: PathBuf::from("/bin/sh"),
            args: vec![
                "-c".to_owned(),
                "echo '{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true}'; exit 3"
                    .to_owned(),
            ],
            cwd: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            env: std::env::vars_os().collect(),
        };
        let mut s = Session::spawn(&spec, None).expect("spawn");
        assert!(initialize(&mut s).await.expect("no timeout").is_none());
        let summary = early_exit_summary(&mut s).await.expect("summary");
        assert_eq!(summary["exit"]["code"], 3);
        assert_eq!(summary["stdout_tail"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn the_session_state_variable_is_set_once_and_markers_are_gone() {
        let mut redactor = Redactor::new();
        redactor.add("unused-needle", "<X>");
        let ctx = Ctx {
            claude: PathBuf::from("claude"),
            root: PathBuf::from("/nonexistent"),
            fixtures: PathBuf::from("/nonexistent"),
            model: "haiku".to_owned(),
            config_dir: PathBuf::from("/nonexistent"),
            env: vec![
                ("PATH".into(), "/bin".into()),
                ("CLAUDECODE".into(), "1".into()),
                (SESSION_STATE_ENV.into(), "0".into()),
            ],
            redactor,
        };
        let (env, dropped) = ctx.child_env(true);
        let names: Vec<String> = env.iter().map(|(name, _)| name.to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["PATH".to_owned(), SESSION_STATE_ENV.to_owned()]);
        assert_eq!(env[1].1, OsString::from("1"));
        assert!(dropped.contains(&"CLAUDECODE".to_owned()));
        let (inherited, _) = ctx.child_env(false);
        assert!(inherited.iter().any(|(name, _)| name == "CLAUDECODE"));
        assert_eq!(inherited.iter().filter(|(name, _)| name == SESSION_STATE_ENV).count(), 1);
    }
}
