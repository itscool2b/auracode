import { TimelineBuilder } from "./timeline";
import type { ChatRecording } from "./types";
import { CHAT_ACP } from "./workspace";

/**
 * The second fixture: Codex (GPT-5.5 Codex, medium effort, Auto-edit) writes an ACP client, then
 * stops to ask before running the tests, since Auto-edit lets it edit files but not run commands.
 * About 10 s, ending on a pending permission request with three answers.
 */

export const APPROVAL_PROMPT =
  "Wire up the ACP client in aura-drivers: spawn the agent, run initialize and session/new, and map session/update into AuraEvents.";

export const APPROVAL_TURN_ID = "turn-acp-client";
export const APPROVAL_REQUEST_ID = "perm-cargo-test";
const TEST_COMMAND = "cargo test -p aura-drivers";

const LIB = "crates/aura-drivers/src/lib.rs";
const MOCK = "crates/aura-drivers/src/mock.rs";
const ACP = "crates/aura-drivers/src/acp.rs";

export const APPROVAL_THOUGHT = `**Planning the ACP client**

I'll check how aura-drivers is laid out, add an acp module that talks to the agent over stdio, and confirm the handshake with the driver tests.`;

export const APPROVAL_MESSAGE = `The client is in place: it spawns the agent with piped stdio, sends \`initialize\` (with fs and terminal off) and \`session/new\`, and maps message and thought chunks from \`session/update\` to \`AuraEvent\`s. Next I need to run the driver tests to check the handshake.`;

const LIB_BEFORE = `//! Agent drivers: everything that turns an agent's native stream into frames of [\`AuraEvent\`]s.
//!
//! M0 ships the two pieces every later driver builds on: [\`batch::FrameBatcher\`], which packs events
//! into size-limited, sequence-numbered frames for the UI, and [\`mock\`], a scripted agent that powers
//! the UI demo, the streaming stress test, and later the replay harness. The protocol drivers (ACP,
//! Claude stream-json, Codex app-server, Pi RPC) arrive in M1.
//!
//! [\`AuraEvent\`]: aura_protocol::AuraEvent

pub mod batch;
pub mod mock;
`;

const LIB_AFTER = LIB_BEFORE.replace("pub mod batch;\n", "pub mod acp;\npub mod batch;\n");

const ACP_SOURCE = `//! ACP client: drives any Agent Client Protocol agent over stdio and maps its \`session/update\`
//! notifications to [\`AuraEvent\`]s.

use std::io;
use std::process::Stdio;

use aura_protocol::AuraEvent;
use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

/// The ACP version this client speaks.
pub const PROTOCOL_VERSION: u64 = 1;

pub struct AcpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl AcpClient {
    /// Spawns the agent. Call [\`AcpClient::initialize\`] next.
    pub fn spawn(program: &str, args: &[String]) -> io::Result<Self> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| io::Error::other("agent stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| io::Error::other("agent stdout"))?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout), next_id: 0 })
    }

    /// Sends one JSON-RPC request and returns its id.
    async fn request(&mut self, method: &str, params: Value) -> io::Result<u64> {
        self.next_id += 1;
        let frame = json!({ "jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params });
        let mut line = serde_json::to_vec(&frame)?;
        line.push(b'\\n');
        self.stdin.write_all(&line).await?;
        Ok(self.next_id)
    }

    /// \`initialize\`, with fs and terminal off: agents keep their own file I/O and shells.
    pub async fn initialize(&mut self) -> io::Result<u64> {
        let capabilities = json!({ "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false });
        self.request("initialize", json!({ "protocolVersion": PROTOCOL_VERSION, "clientCapabilities": capabilities }))
            .await
    }

    /// \`session/new\` in \`cwd\`, with no MCP servers of our own.
    pub async fn new_session(&mut self, cwd: &str) -> io::Result<u64> {
        self.request("session/new", json!({ "cwd": cwd, "mcpServers": [] })).await
    }
}

/// Maps one \`session/update\` notification to an event; \`None\` for updates the UI ignores.
pub fn map_update(update: &Value) -> Option<AuraEvent> {
    let text = update.pointer("/content/text")?.as_str()?.to_owned();
    match update.get("sessionUpdate")?.as_str()? {
        "agent_message_chunk" => Some(AuraEvent::MessageDelta { message_id: "agent".into(), text }),
        "agent_thought_chunk" => Some(AuraEvent::ThoughtDelta { thought_id: "agent".into(), text }),
        _ => None,
    }
}
`;

function buildApproval(): ChatRecording {
  const t = new TimelineBuilder();
  t.at(0, {
    type: "user_message",
    message_id: "msg-user-acp",
    text: APPROVAL_PROMPT,
    agent: "codex",
  })
    .at(0.3, { type: "turn_started", turn_id: APPROVAL_TURN_ID })
    .at(0.35, {
      type: "session_updated",
      native_session_id: "0199f3c2-5a7d-7c41-b8e6-93d2a1f04c7b",
      title: "Wire up the ACP client",
      model: "gpt-5.5-codex",
      effort: "medium",
      mode: "on-request",
      commands: [],
    })
    .stream(0.9, 2.9, APPROVAL_THOUGHT, "acp-thought", (text) => ({
      type: "thought_delta",
      thought_id: "thought-acp",
      text,
    }))
    .at(2.95, { type: "thought_completed", thought_id: "thought-acp", duration_ms: 2100 })
    .at(3.5, {
      type: "tool_call",
      tool_call_id: "call-read-lib",
      kind: "read",
      title: `Read ${LIB}`,
      status: "in_progress",
      locations: [{ path: LIB, line: null }],
      raw_input: { path: LIB },
    })
    .at(3.8, {
      type: "tool_update",
      tool_call_id: "call-read-lib",
      status: "completed",
      title: null,
      content: [],
    })
    .at(3.95, {
      type: "tool_call",
      tool_call_id: "call-read-mock",
      kind: "read",
      title: `Read ${MOCK}`,
      status: "in_progress",
      locations: [{ path: MOCK, line: null }],
      raw_input: { path: MOCK },
    })
    .at(4.25, {
      type: "tool_update",
      tool_call_id: "call-read-mock",
      status: "completed",
      title: null,
      content: [],
    })
    .at(5.4, {
      type: "tool_call",
      tool_call_id: "call-edit-acp",
      kind: "edit",
      title: `Add ${ACP}`,
      status: "in_progress",
      locations: [{ path: ACP, line: 1 }],
      raw_input: { path: ACP },
    })
    .at(6.3, {
      type: "tool_update",
      tool_call_id: "call-edit-acp",
      status: "completed",
      title: null,
      content: [{ type: "diff", path: ACP, old_text: null, new_text: ACP_SOURCE }],
    })
    .at(6.5, {
      type: "tool_call",
      tool_call_id: "call-edit-lib",
      kind: "edit",
      title: `Edit ${LIB}`,
      status: "in_progress",
      locations: [{ path: LIB, line: 10 }],
      raw_input: { path: LIB },
    })
    .at(6.8, {
      type: "tool_update",
      tool_call_id: "call-edit-lib",
      status: "completed",
      title: null,
      content: [{ type: "diff", path: LIB, old_text: LIB_BEFORE, new_text: LIB_AFTER }],
    })
    .stream(7.4, 9.3, APPROVAL_MESSAGE, "acp-message", (text) => ({
      type: "message_delta",
      message_id: "msg-acp",
      text,
    }))
    .at(9.35, { type: "message_completed", message_id: "msg-acp" })
    .at(9.8, {
      type: "tool_call",
      tool_call_id: "call-cargo-test",
      kind: "execute",
      title: TEST_COMMAND,
      status: "pending",
      locations: [],
      raw_input: { command: ["cargo", "test", "-p", "aura-drivers"], workdir: "." },
    })
    .at(10.0, {
      type: "permission_requested",
      request_id: APPROVAL_REQUEST_ID,
      tool_call_id: "call-cargo-test",
      title: `Run ${TEST_COMMAND}?`,
      options: [
        { option_id: "allow-once", kind: "allow_once", label: "Allow once" },
        { option_id: "allow-always", kind: "allow_always", label: "Always allow" },
        { option_id: "reject", kind: "reject_once", label: "Reject" },
      ],
    });
  const events = t.build();
  return { chatId: CHAT_ACP, events, duration: events[events.length - 1]?.at ?? 0 };
}

export const APPROVAL: ChatRecording = buildApproval();
