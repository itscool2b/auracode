//! The stream-json control protocol as Claude Code 2.1.310 speaks it.
//!
//! Shapes follow the official Agent SDKs pinned to this CLI version (Python
//! `claude-agent-sdk` 0.2.174 `_internal/query.py` and `transport/subprocess_cli.py`, TypeScript
//! `@anthropic-ai/claude-agent-sdk` 0.3.310 `sdk.d.ts`). Only what the host sends or must answer
//! is built here; everything received stays raw JSON, so nothing unknown can fail to parse.

use serde_json::{Value, json};

/// A prompt. `uuid` is the client's id for the message: the CLI echoes it back as
/// `user_message_uuid` on the turn's `result`, which is how a reply is bound to its send.
pub fn user_message(text: &str, uuid: &str) -> Value {
    json!({
        "type": "user",
        "message": {"role": "user", "content": text},
        "parent_tool_use_id": null,
        "session_id": "default",
        "uuid": uuid,
    })
}

/// The envelope for every request the host originates (`initialize`, `interrupt`, ...).
pub fn control_request(request_id: &str, request: Value) -> Value {
    json!({"type": "control_request", "request_id": request_id, "request": request})
}

/// The SDKs always open with this; `hooks: null` registers no host-side hook callbacks.
pub fn initialize() -> Value {
    json!({"subtype": "initialize", "hooks": null})
}

/// Approves a `can_use_tool` request. The SDKs send the original input back as `updatedInput`
/// when the host doesn't change it.
pub fn allow(request_id: &str, input: &Value) -> Value {
    success(request_id, json!({"behavior": "allow", "updatedInput": input}))
}

/// Refuses a `can_use_tool` request. `interrupt: true` also stops the whole turn; without it the
/// model gets the message as the tool's error and carries on.
pub fn deny(request_id: &str, message: &str, interrupt: bool) -> Value {
    let body = if interrupt {
        json!({"behavior": "deny", "message": message, "interrupt": true})
    } else {
        json!({"behavior": "deny", "message": message})
    };
    success(request_id, body)
}

pub fn success(request_id: &str, response: Value) -> Value {
    json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id, "response": response}})
}

/// The answer to a request the host can't serve, so the CLI never waits on it.
pub fn error(request_id: &str, message: &str) -> Value {
    json!({"type": "control_response", "response": {"subtype": "error", "request_id": request_id, "error": message}})
}

pub enum Parsed {
    Json(Value),
    /// Blank lines and non-JSON noise; some CLI builds print debug lines on stdout.
    NotJson,
    /// Looks like JSON but doesn't parse. With correct framing nothing can complete it later.
    Corrupt,
}

pub fn parse_line(line: &str) -> Parsed {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return Parsed::NotJson;
    }
    match serde_json::from_str(trimmed) {
        Ok(value) => Parsed::Json(value),
        Err(_) => Parsed::Corrupt,
    }
}

/// A short label for a message, used to describe the shape of a stream in the findings.
pub fn kind(v: &Value) -> String {
    let ty = v["type"].as_str().unwrap_or("?");
    match ty {
        "system" | "result" => format!("{ty}/{}", v["subtype"].as_str().unwrap_or("?")),
        "control_request" => format!("{ty}/{}", v["request"]["subtype"].as_str().unwrap_or("?")),
        "control_response" => format!("{ty}/{}", v["response"]["subtype"].as_str().unwrap_or("?")),
        "stream_event" => {
            let event = &v["event"];
            let event_type = event["type"].as_str().unwrap_or("?");
            let detail = match event_type {
                "content_block_delta" => event["delta"]["type"].as_str(),
                "content_block_start" => event["content_block"]["type"].as_str(),
                _ => None,
            };
            let scope = if v["parent_tool_use_id"].is_null() { "" } else { " (subagent)" };
            match detail {
                Some(detail) => format!("stream_event/{event_type}/{detail}{scope}"),
                None => format!("stream_event/{event_type}{scope}"),
            }
        }
        "assistant" | "user" => {
            let blocks = match &v["message"]["content"] {
                Value::Array(items) => {
                    items.iter().map(|block| block["type"].as_str().unwrap_or("?")).collect::<Vec<_>>().join("+")
                }
                Value::String(_) => "text".to_owned(),
                _ => "?".to_owned(),
            };
            format!("{ty}/{blocks}")
        }
        other => other.to_owned(),
    }
}

/// Text the main agent (not a subagent) is streaming, from a partial-message event.
pub fn main_text_delta(v: &Value) -> Option<&str> {
    if v["type"] != "stream_event" || !v["parent_tool_use_id"].is_null() {
        return None;
    }
    let event = &v["event"];
    if event["type"] != "content_block_delta" || event["delta"]["type"] != "text_delta" {
        return None;
    }
    event["delta"]["text"].as_str()
}

/// Collapses consecutive repeats: `["a", "a", "b"]` becomes `["a x2", "b"]`.
pub fn run_lengths(kinds: &[String]) -> Vec<String> {
    let mut runs: Vec<(String, usize)> = Vec::new();
    for kind in kinds {
        match runs.last_mut() {
            Some((last, count)) if last == kind => *count += 1,
            _ => runs.push((kind.clone(), 1)),
        }
    }
    runs.into_iter().map(|(kind, count)| if count == 1 { kind } else { format!("{kind} x{count}") }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_message_matches_the_sdk_shape() {
        assert_eq!(
            user_message("hi", "u-1"),
            json!({"type": "user", "message": {"role": "user", "content": "hi"}, "parent_tool_use_id": null,
                   "session_id": "default", "uuid": "u-1"})
        );
    }

    #[test]
    fn permission_answers_match_the_sdk_shape() {
        let input = json!({"command": "touch a"});
        assert_eq!(
            allow("r1", &input),
            json!({"type": "control_response", "response": {"subtype": "success", "request_id": "r1",
                   "response": {"behavior": "allow", "updatedInput": {"command": "touch a"}}}})
        );
        assert_eq!(deny("r2", "no", false)["response"]["response"], json!({"behavior": "deny", "message": "no"}));
        assert_eq!(deny("r3", "stop", true)["response"]["response"]["interrupt"], json!(true));
        assert_eq!(error("r4", "nope")["response"], json!({"subtype": "error", "request_id": "r4", "error": "nope"}));
    }

    #[test]
    fn control_requests_wrap_their_payload() {
        assert_eq!(
            control_request("req_1", initialize()),
            json!({"type": "control_request", "request_id": "req_1", "request": {"subtype": "initialize", "hooks": null}})
        );
    }

    #[test]
    fn lines_parse_leniently() {
        assert!(matches!(parse_line(" {\"type\":\"x\"}\r"), Parsed::Json(_)));
        assert!(matches!(parse_line("[SandboxDebug] hello"), Parsed::NotJson));
        assert!(matches!(parse_line(""), Parsed::NotJson));
        assert!(matches!(parse_line("{\"type\":"), Parsed::Corrupt));
    }

    #[test]
    fn kinds_name_the_interesting_part() {
        assert_eq!(kind(&json!({"type": "system", "subtype": "init"})), "system/init");
        assert_eq!(
            kind(&json!({"type": "control_request", "request": {"subtype": "can_use_tool"}})),
            "control_request/can_use_tool"
        );
        assert_eq!(
            kind(&json!({"type": "stream_event", "parent_tool_use_id": null,
                         "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "x"}}})),
            "stream_event/content_block_delta/text_delta"
        );
        assert_eq!(
            kind(&json!({"type": "assistant", "message": {"content": [{"type": "text"}, {"type": "tool_use"}]}})),
            "assistant/text+tool_use"
        );
        assert_eq!(kind(&json!({"type": "rate_limit_event"})), "rate_limit_event");
        assert_eq!(kind(&json!({"no": "type"})), "?");
    }

    #[test]
    fn only_main_thread_text_deltas_count() {
        let delta = |parent: Value| {
            json!({"type": "stream_event", "parent_tool_use_id": parent,
                   "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "7\n"}}})
        };
        assert_eq!(main_text_delta(&delta(Value::Null)), Some("7\n"));
        assert_eq!(main_text_delta(&delta(json!("toolu_1"))), None);
        assert_eq!(main_text_delta(&json!({"type": "assistant"})), None);
    }

    #[test]
    fn runs_collapse() {
        let kinds: Vec<String> = ["a", "a", "b", "a"].iter().map(|s| (*s).to_owned()).collect();
        assert_eq!(run_lengths(&kinds), vec!["a x2", "b", "a"]);
    }
}
