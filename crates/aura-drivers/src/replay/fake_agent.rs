//! The fake agent: walks a fixture's records, writing `in` lines to the driver (response ids
//! rewritten to the live ids), reading and comparing the driver's `out` lines, and acting on
//! `agent` records (EOF, exit, oversized lines, waits).
//!
//! An `out` record compares the message kind, the method, id correspondence (a request's recorded
//! id maps to the live one at first sight; a reply echoes the agent's id), a reply's error code,
//! a permission reply's `outcome`, and the params of `session/prompt`, `session/set_config_option`,
//! `session/set_mode` and `session/set_model` (paths and session ids are placeholders on both sides).
//! It also checks contract rule 3: every request the agent made is answered, unless the agent ended
//! first.

use std::collections::HashMap;
use std::time::Duration;

use aura_process::testing::{FakeAgentEnd, FakeLine};
use aura_process::{ExitInfo, TopKeys};
use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::fixture::AgentAction;
use crate::acp::requests::methods;

/// How long an `out` record waits for the driver's line, in virtual time.
pub const OUT_TIMEOUT: Duration = Duration::from_secs(5);

/// The methods whose params an `out` record compares.
const COMPARED_PARAMS: [&str; 4] = [
    methods::SESSION_PROMPT,
    methods::SESSION_SET_CONFIG_OPTION,
    methods::SESSION_SET_MODE,
    methods::SESSION_SET_MODEL,
];

/// A request the agent made, until the driver answers it.
#[derive(Debug)]
struct AgentRequest {
    method: String,
    answered: bool,
    /// The agent ended before an answer could reach it.
    orphaned: bool,
}

/// The agent's side of the pipes, playing a fixture.
pub(crate) struct FakeAgent {
    end: FakeAgentEnd,
    exit: Option<oneshot::Sender<ExitInfo>>,
    eof_sent: bool,
    /// Recorded request id (as JSON text) to the live id the driver used.
    ids: HashMap<String, Value>,
    /// The agent's requests by id (as JSON text), in the order made.
    requests: Vec<(String, AgentRequest)>,
    pub(crate) mismatches: Vec<String>,
}

impl FakeAgent {
    pub(crate) fn new(mut end: FakeAgentEnd) -> FakeAgent {
        let (stand_in, _) = oneshot::channel();
        let exit = std::mem::replace(&mut end.exit, stand_in);
        FakeAgent {
            end,
            exit: Some(exit),
            eof_sent: false,
            ids: HashMap::new(),
            requests: Vec::new(),
            mismatches: Vec::new(),
        }
    }

    fn mismatch(&mut self, record: usize, what: String) {
        self.mismatches
            .push(format!("record {}: {what}", record + 1));
    }

    /// An `in` message: an agent request is remembered; a reply gets the live id of the request
    /// it answers.
    pub(crate) fn write_in(&mut self, record: usize, message: &Value) {
        let mut message = message.clone();
        let is_reply = message.get("method").is_none()
            && (message.get("result").is_some() || message.get("error").is_some());
        if is_reply {
            let recorded = message.get("id").map(Value::to_string).unwrap_or_default();
            match self.ids.get(&recorded) {
                Some(live) => message["id"] = live.clone(),
                None => self.mismatch(
                    record,
                    format!("a reply to request {recorded}, which the driver never sent"),
                ),
            }
        } else if let (Some(id), Some(method)) = (
            message.get("id"),
            message.get("method").and_then(Value::as_str),
        ) {
            self.requests.push((
                id.to_string(),
                AgentRequest {
                    method: method.to_owned(),
                    answered: false,
                    orphaned: false,
                },
            ));
        }
        self.line(FakeLine::Line(message.to_string()));
    }

    pub(crate) fn write_raw(&mut self, raw: &str) {
        self.line(FakeLine::Line(raw.to_owned()));
    }

    pub(crate) fn stderr(&self, line: &str) {
        let _ = self.end.stderr.send(line.to_owned());
    }

    fn line(&mut self, line: FakeLine) {
        // A stdout that already ended takes nothing; the fixture says so itself.
        let _ = self.end.to_client.send(line);
    }

    pub(crate) async fn act(&mut self, action: &AgentAction) {
        match action {
            AgentAction::Eof => self.eof(),
            AgentAction::Exit { code } => self.exit(Some(*code)),
            AgentAction::Oversized { bytes, keys } => {
                let keys = TopKeys {
                    id: keys.get("id").filter(|id| !id.is_null()).cloned(),
                    method: keys
                        .get("method")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    kind: keys.get("type").and_then(Value::as_str).map(str::to_owned),
                };
                if let (Some(id), Some(method)) = (&keys.id, &keys.method) {
                    self.requests.push((
                        id.to_string(),
                        AgentRequest {
                            method: method.clone(),
                            answered: false,
                            orphaned: false,
                        },
                    ));
                }
                self.line(FakeLine::Oversized {
                    bytes: *bytes,
                    keys,
                });
            }
            AgentAction::Wait { ms } => tokio::time::sleep(Duration::from_millis(*ms)).await,
        }
    }

    pub(crate) fn eof(&mut self) {
        if !self.eof_sent {
            self.eof_sent = true;
            self.orphan_requests();
            let _ = self.end.to_client.send(FakeLine::Eof);
        }
    }

    pub(crate) fn exit(&mut self, code: Option<i32>) {
        if let Some(exit) = self.exit.take() {
            self.orphan_requests();
            let _ = exit.send(ExitInfo {
                code,
                signal: None,
                at_ms: 0,
            });
        }
    }

    pub(crate) fn exited(&self) -> bool {
        self.exit.is_none()
    }

    /// The agent ended: what it still waits on can no longer be answered.
    fn orphan_requests(&mut self) {
        for (_, request) in &mut self.requests {
            if !request.answered {
                request.orphaned = true;
            }
        }
    }

    /// An `out` record: the next line the driver wrote, compared.
    pub(crate) async fn expect_out(&mut self, record: usize, expected: &Value) {
        let line = match timeout(OUT_TIMEOUT, self.end.from_client.recv()).await {
            Ok(Some(line)) => line,
            Ok(None) => {
                self.mismatch(
                    record,
                    format!("expected {}, but stdin was closed", describe(expected)),
                );
                return;
            }
            Err(_) => {
                self.mismatch(
                    record,
                    format!("expected {}, the driver wrote nothing", describe(expected)),
                );
                return;
            }
        };
        let actual: Value = match serde_json::from_str(&line) {
            Ok(actual) => actual,
            Err(_) => {
                self.mismatch(
                    record,
                    format!("the driver wrote a line that is not JSON: {line}"),
                );
                return;
            }
        };
        self.observe(&actual);
        for what in self.compare(expected, &actual) {
            self.mismatch(record, what);
        }
    }

    /// Notes a reply the driver wrote to one of the agent's requests.
    fn observe(&mut self, actual: &Value) {
        if actual.get("method").is_none()
            && let Some(id) = actual.get("id").map(Value::to_string)
            && let Some((_, request)) = self.requests.iter_mut().find(|(known, _)| *known == id)
        {
            request.answered = true;
        }
    }

    fn compare(&mut self, expected: &Value, actual: &Value) -> Vec<String> {
        let mut found = Vec::new();
        let (expected_kind, actual_kind) = (kind(expected), kind(actual));
        if expected_kind != actual_kind {
            found.push(format!(
                "expected a {expected_kind} ({}), the driver wrote a {actual_kind} ({})",
                describe(expected),
                describe(actual)
            ));
            return found;
        }
        let method = expected.get("method").and_then(Value::as_str);
        if method != actual.get("method").and_then(Value::as_str) {
            found.push(format!(
                "expected {}, the driver wrote {}",
                describe(expected),
                describe(actual)
            ));
            return found;
        }
        match expected_kind {
            "request" => {
                let recorded = expected.get("id").map(Value::to_string).unwrap_or_default();
                let live = actual.get("id").cloned().unwrap_or(Value::Null);
                match self.ids.get(&recorded) {
                    Some(known) if *known != live => found.push(format!(
                        "request {recorded} was sent as {known} before and as {live} now"
                    )),
                    Some(_) => {}
                    None => {
                        self.ids.insert(recorded, live);
                    }
                }
            }
            "reply" | "error reply" => {
                if expected.get("id") != actual.get("id") {
                    found.push(format!(
                        "expected a reply to {}, the driver answered {}",
                        expected.get("id").map(Value::to_string).unwrap_or_default(),
                        actual.get("id").map(Value::to_string).unwrap_or_default()
                    ));
                }
                if expected_kind == "error reply"
                    && expected.pointer("/error/code") != actual.pointer("/error/code")
                {
                    found.push(format!(
                        "expected {}, the driver wrote {}",
                        describe(expected),
                        describe(actual)
                    ));
                }
                let answers_permission = expected
                    .get("id")
                    .map(Value::to_string)
                    .and_then(|id| self.requests.iter().find(|(known, _)| *known == id))
                    .is_some_and(|(_, request)| {
                        request.method == methods::SESSION_REQUEST_PERMISSION
                    });
                if answers_permission
                    && expected.pointer("/result/outcome") != actual.pointer("/result/outcome")
                {
                    found.push(format!(
                        "expected the outcome {}, the driver answered {}",
                        expected
                            .pointer("/result/outcome")
                            .map(Value::to_string)
                            .unwrap_or_default(),
                        actual
                            .pointer("/result/outcome")
                            .map(Value::to_string)
                            .unwrap_or_default()
                    ));
                }
            }
            _ => {}
        }
        if let Some(method) = method
            && COMPARED_PARAMS.contains(&method)
            && expected.get("params") != actual.get("params")
        {
            found.push(format!(
                "{method} params differ: expected {}, the driver wrote {}",
                expected
                    .get("params")
                    .map(Value::to_string)
                    .unwrap_or_default(),
                actual
                    .get("params")
                    .map(Value::to_string)
                    .unwrap_or_default()
            ));
        }
        found
    }

    /// Lines the driver wrote that no `out` record read.
    pub(crate) fn unexpected_lines(&mut self) {
        while let Ok(line) = self.end.from_client.try_recv() {
            let summary = match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    self.observe(&value);
                    describe(&value)
                }
                Err(_) => line,
            };
            self.mismatches.push(format!(
                "the driver wrote {summary}, which the fixture does not expect"
            ));
        }
    }

    /// After the last record: reads what the driver still writes (noting answers), and exits on
    /// stdin EOF as a well-behaved agent does. Returns once stdin closed or the process ended.
    pub(crate) async fn serve_until_closed(&mut self, limit: Duration) {
        let deadline = tokio::time::Instant::now() + limit;
        while let Ok(Some(line)) =
            tokio::time::timeout_at(deadline, self.end.from_client.recv()).await
        {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                self.observe(&value);
            }
        }
        self.exit(Some(0));
        self.eof();
    }

    /// Contract rule 3: what the agent asked and the driver never answered, while the agent lived.
    pub(crate) fn unanswered(&self) -> Vec<String> {
        self.requests
            .iter()
            .filter(|(_, request)| !request.answered && !request.orphaned)
            .map(|(id, request)| {
                format!(
                    "the agent's {} request {id} was never answered",
                    request.method
                )
            })
            .collect()
    }
}

fn kind(message: &Value) -> &'static str {
    match (message.get("method").is_some(), message.get("id").is_some()) {
        (true, true) => "request",
        (true, false) => "notification",
        (false, _) if message.get("error").is_some() => "error reply",
        (false, _) if message.get("result").is_some() => "reply",
        _ => "message of no known kind",
    }
}

/// A short description of a message for a mismatch.
fn describe(message: &Value) -> String {
    let text = message.to_string();
    if text.len() <= 300 {
        return text;
    }
    let mut end = 300;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &text[..end])
}
