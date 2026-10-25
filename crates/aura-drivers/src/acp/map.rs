//! `session/update` to events, pure, with the id minter: agent message, thought, permission and
//! tool ids per turn, message boundaries, and [`MAPPED_TAGS`], the update tags the mapping table
//! covers, which a conformance test checks against the schema.
//!
//! Ids: agent messages `<turn_id>.m<n>`, thoughts `<turn_id>.t<n>`, permission requests
//! `<turn_id>.p<n>` (counters from 1 per turn), tools `<turn_id>.<toolCallId>` fixed at first sight
//! in a session-wide map, so a late update to an earlier turn's tool lands on its block. A
//! `toolCallId` over 96 characters becomes the first 16 hex characters of its sha256. Outside a turn
//! the prefix is the spawn id.
//!
//! An agent message stays open while consecutive `agent_message_chunk`s share one `messageId` or
//! all lack one. It closes on a chunk with another `messageId`, on any transcript update of another
//! kind, when a turn begins, and before `TurnEnded`; state updates do not close it. Thoughts follow
//! the same rules. A completion carries the tag of its message.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use aura_protocol::{AuraEvent, SlashCommand, ToolCall, ToolKind, ToolStatus, ToolUpdate};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::time::Instant;

use super::options::truncate;
use super::wire::{Chunk, CommandEntry, TitleChange, ToolFields, Update};
use crate::driver::DriverEvent;

/// The tags of the mapping table's rows (spec 5.4), the unmapped ones included: every
/// `sessionUpdate` value of schema 1.12.0.
pub const MAPPED_TAGS: &[&str] = &[
    "user_message_chunk",
    "agent_message_chunk",
    "agent_thought_chunk",
    "tool_call",
    "tool_call_update",
    "plan",
    "available_commands_update",
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "usage_update",
    "notice",
    "compaction_update",
    "compaction_summary_chunk",
    "plan_update",
    "plan_removed",
    "subagent_update",
    "session_message",
    "session_message_chunk",
];

/// A `toolCallId` longer than this is replaced by a hash prefix.
pub const MAX_TOOL_CALL_ID_CHARS: usize = 96;

/// Slash command limits.
pub const MAX_COMMANDS: usize = 1000;
pub const MAX_COMMAND_NAME_CHARS: usize = 128;
pub const MAX_COMMAND_DESCRIPTION_CHARS: usize = 300;
pub const MAX_COMMAND_HINT_CHARS: usize = 200;

/// The title of a tool block the agent never named.
pub const UNNAMED_TOOL: &str = "Tool";

/// What one update means.
#[derive(Debug, Clone, PartialEq)]
pub enum Mapped {
    /// Events to hand over, in order (possibly none: an update that only closed nothing).
    Events(Vec<DriverEvent>),
    /// The full reduced command list, for the debounce.
    Commands(Vec<SlashCommand>),
    /// `current_mode_update`.
    Mode(String),
    /// `config_option_update`'s raw list.
    ConfigOptions(Vec<Value>),
    /// Nothing to show; the reason is for the log.
    Nothing(&'static str),
}

/// A message or thought still open.
#[derive(Debug, Clone)]
struct Open {
    id: String,
    /// The agent's `messageId`, when it sent one.
    agent_id: Option<String>,
    tag: Option<String>,
    started: Instant,
}

/// A tool block, by the agent's `toolCallId`.
#[derive(Debug, Clone)]
struct Tool {
    minted: String,
    kind: ToolKind,
    title: String,
}

/// Per-prefix counters, each from 1.
#[derive(Debug, Clone, Copy, Default)]
struct Counters {
    messages: u32,
    thoughts: u32,
    permissions: u32,
}

/// Maps updates to events for one agent process.
#[derive(Debug)]
pub struct Mapper {
    spawn_id: String,
    turn: Option<String>,
    counters: HashMap<String, Counters>,
    tools: HashMap<String, Tool>,
    /// Tool call ids seen only in permission requests (Hermes' `perm-check-N`): never blocks.
    permission_only: HashSet<String>,
    message: Option<Open>,
    thought: Option<Open>,
}

impl Mapper {
    pub fn new(spawn_id: impl Into<String>) -> Mapper {
        Mapper {
            spawn_id: spawn_id.into(),
            turn: None,
            counters: HashMap::new(),
            tools: HashMap::new(),
            permission_only: HashSet::new(),
            message: None,
            thought: None,
        }
    }

    /// The turn events are tagged with now (rule 8).
    pub fn turn(&self) -> Option<&str> {
        self.turn.as_deref()
    }

    /// A turn begins: what is open (outside it) closes first.
    pub fn begin_turn(&mut self, turn_id: &str, now: Instant) -> Vec<DriverEvent> {
        let closed = self.close_open(now);
        self.turn = Some(turn_id.to_owned());
        closed
    }

    /// The prompt's reply arrived: what is open closes (before `TurnEnded`) and later events are
    /// untagged.
    pub fn end_turn(&mut self, now: Instant) -> Vec<DriverEvent> {
        let closed = self.close_open(now);
        self.turn = None;
        closed
    }

    /// `MessageCompleted` and `ThoughtCompleted` for whatever is open.
    pub fn close_open(&mut self, now: Instant) -> Vec<DriverEvent> {
        let mut events = Vec::new();
        if let Some(open) = self.message.take() {
            events.push(tagged(
                open.tag,
                AuraEvent::MessageCompleted {
                    message_id: open.id,
                },
            ));
        }
        if let Some(open) = self.thought.take() {
            events.push(thought_completed(open, now));
        }
        events
    }

    /// Maps one parsed update.
    pub fn map(&mut self, update: Update, now: Instant) -> Mapped {
        let mut events = Vec::new();
        match update {
            Update::UserMessageChunk(_) => {
                events.extend(self.close_open(now));
                if events.is_empty() {
                    return Mapped::Nothing("a user message chunk");
                }
            }
            Update::AgentMessageChunk(chunk) => {
                if let Some(open) = self.thought.take() {
                    events.push(thought_completed(open, now));
                }
                events.extend(self.message_chunk(chunk, now));
            }
            Update::AgentThoughtChunk(chunk) => {
                if let Some(open) = self.message.take() {
                    events.push(tagged(
                        open.tag,
                        AuraEvent::MessageCompleted {
                            message_id: open.id,
                        },
                    ));
                }
                events.extend(self.thought_chunk(chunk, now));
            }
            Update::ToolCall(fields) => {
                events.extend(self.close_open(now));
                events.push(self.tool_call(fields));
            }
            Update::ToolCallUpdate(fields) => {
                events.extend(self.close_open(now));
                if self.permission_only.contains(&fields.tool_call_id) {
                    // The permission card already showed it; a block would be a stray "Tool".
                    if events.is_empty() {
                        return Mapped::Nothing("an update to a permission request's tool call");
                    }
                } else {
                    events.extend(self.tool_call_update(fields));
                }
            }
            Update::Plan(entries) => {
                events.extend(self.close_open(now));
                events.push(self.tag(AuraEvent::PlanUpdated { entries }));
            }
            Update::AvailableCommands(entries) => {
                return Mapped::Commands(reduce_commands(entries));
            }
            Update::CurrentMode(mode) => return Mapped::Mode(mode),
            Update::ConfigOptions(raw) => return Mapped::ConfigOptions(raw),
            Update::SessionInfo { title } => match title {
                TitleChange::Keep => {
                    return Mapped::Nothing("a session info update without a title");
                }
                TitleChange::Set(title) => events.push(DriverEvent::Title(Some(title))),
                TitleChange::Clear => events.push(DriverEvent::Title(None)),
            },
            Update::Usage(usage) => events.push(self.tag(AuraEvent::UsageUpdated(usage))),
            Update::Notice { level, message } => {
                events.push(self.tag(AuraEvent::Notice { level, message }));
            }
            Update::Unmapped(_) => return Mapped::Nothing("an update auracode does not advertise"),
            Update::Unknown(_) => return Mapped::Nothing("an unknown update"),
        }
        Mapped::Events(events)
    }

    fn message_chunk(&mut self, chunk: Chunk, now: Instant) -> Vec<DriverEvent> {
        let mut events = Vec::new();
        if let Some(open) = &self.message
            && (open.agent_id != chunk.message_id || open.tag != self.turn)
            && let Some(open) = self.message.take()
        {
            events.push(tagged(
                open.tag,
                AuraEvent::MessageCompleted {
                    message_id: open.id,
                },
            ));
        }
        if chunk.text.is_empty() {
            return events;
        }
        if self.message.is_none() {
            let id = self.mint('m');
            self.message = Some(Open {
                id,
                agent_id: chunk.message_id,
                tag: self.turn.clone(),
                started: now,
            });
        }
        if let Some(open) = &self.message {
            events.push(tagged(
                open.tag.clone(),
                AuraEvent::MessageDelta {
                    message_id: open.id.clone(),
                    text: chunk.text,
                },
            ));
        }
        events
    }

    fn thought_chunk(&mut self, chunk: Chunk, now: Instant) -> Vec<DriverEvent> {
        let mut events = Vec::new();
        if let Some(open) = &self.thought
            && (open.agent_id != chunk.message_id || open.tag != self.turn)
            && let Some(open) = self.thought.take()
        {
            events.push(thought_completed(open, now));
        }
        if chunk.text.is_empty() {
            return events;
        }
        if self.thought.is_none() {
            let id = self.mint('t');
            self.thought = Some(Open {
                id,
                agent_id: chunk.message_id,
                tag: self.turn.clone(),
                started: now,
            });
        }
        if let Some(open) = &self.thought {
            events.push(tagged(
                open.tag.clone(),
                AuraEvent::ThoughtDelta {
                    thought_id: open.id.clone(),
                    text: chunk.text,
                },
            ));
        }
        events
    }

    /// `tool_call`: a new block, or an update with every field for an id already seen.
    fn tool_call(&mut self, fields: ToolFields) -> DriverEvent {
        self.permission_only.remove(&fields.tool_call_id);
        let kind = fields.kind.unwrap_or(ToolKind::Other);
        let title = fields
            .title
            .clone()
            .filter(|title| !title.is_empty())
            .or_else(|| fields.name.clone().filter(|name| !name.is_empty()))
            .unwrap_or_else(|| UNNAMED_TOOL.to_owned());
        let status = fields.status.unwrap_or(ToolStatus::Pending);
        let content = fields.content.unwrap_or_default();
        let locations = fields.locations.unwrap_or_default();
        if let Some(tool) = self.tools.get_mut(&fields.tool_call_id) {
            tool.kind = kind;
            tool.title.clone_from(&title);
            let update = ToolUpdate {
                tool_call_id: tool.minted.clone(),
                status: Some(status),
                title: Some(title),
                kind: Some(kind),
                locations: Some(locations),
                raw_input: fields.raw_input,
                tool_name: fields.name,
                content: Some(content),
                truncated: None,
            };
            return self.tag(AuraEvent::ToolUpdate(update));
        }
        let minted = self.mint_tool(&fields.tool_call_id);
        self.tools.insert(
            fields.tool_call_id,
            Tool {
                minted: minted.clone(),
                kind,
                title: title.clone(),
            },
        );
        self.tag(AuraEvent::ToolCall(ToolCall {
            tool_call_id: minted,
            kind,
            title,
            status,
            locations,
            raw_input: fields.raw_input,
            tool_name: fields.name,
            content,
            truncated: None,
        }))
    }

    /// `tool_call_update`: only the present fields; an unknown id first gets a synthesized call.
    fn tool_call_update(&mut self, fields: ToolFields) -> Vec<DriverEvent> {
        let mut events = Vec::new();
        let minted = match self.tools.get_mut(&fields.tool_call_id) {
            Some(tool) => {
                if let Some(kind) = fields.kind {
                    tool.kind = kind;
                }
                if let Some(title) = fields.title.clone().filter(|title| !title.is_empty()) {
                    tool.title = title;
                }
                tool.minted.clone()
            }
            None => {
                let minted = self.mint_tool(&fields.tool_call_id);
                let title = fields
                    .title
                    .clone()
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| UNNAMED_TOOL.to_owned());
                self.tools.insert(
                    fields.tool_call_id.clone(),
                    Tool {
                        minted: minted.clone(),
                        kind: fields.kind.unwrap_or(ToolKind::Other),
                        title: title.clone(),
                    },
                );
                events.push(self.tag(AuraEvent::ToolCall(ToolCall {
                    tool_call_id: minted.clone(),
                    kind: ToolKind::Other,
                    title,
                    status: ToolStatus::Pending,
                    locations: Vec::new(),
                    raw_input: None,
                    tool_name: None,
                    content: Vec::new(),
                    truncated: None,
                })));
                minted
            }
        };
        events.push(self.tag(AuraEvent::ToolUpdate(ToolUpdate {
            tool_call_id: minted,
            status: fields.status,
            title: fields.title,
            kind: fields.kind,
            locations: fields.locations,
            raw_input: fields.raw_input,
            tool_name: fields.name,
            content: fields.content,
            truncated: None,
        })));
        events
    }

    /// A permission request names `tool_call_id`: the block's minted id, kind and title when the
    /// block is already shown; otherwise the id is remembered as a permission's own.
    pub fn permission_tool(&mut self, tool_call_id: &str) -> Option<(String, ToolKind, String)> {
        match self.tools.get(tool_call_id) {
            Some(tool) => Some((tool.minted.clone(), tool.kind, tool.title.clone())),
            None => {
                if !tool_call_id.is_empty() {
                    self.permission_only.insert(tool_call_id.to_owned());
                }
                None
            }
        }
    }

    /// The next permission request id under the current prefix.
    pub fn mint_permission(&mut self) -> String {
        self.mint('p')
    }

    fn mint(&mut self, kind: char) -> String {
        let prefix = self.prefix().to_owned();
        let counters = self.counters.entry(prefix.clone()).or_default();
        let counter = match kind {
            'm' => &mut counters.messages,
            't' => &mut counters.thoughts,
            _ => &mut counters.permissions,
        };
        *counter = counter.saturating_add(1);
        format!("{prefix}.{kind}{counter}")
    }

    fn mint_tool(&self, tool_call_id: &str) -> String {
        let id = if tool_call_id.chars().count() > MAX_TOOL_CALL_ID_CHARS {
            let digest = Sha256::digest(tool_call_id.as_bytes());
            hex(&digest)[..16].to_owned()
        } else {
            tool_call_id.to_owned()
        };
        format!("{}.{id}", self.prefix())
    }

    fn prefix(&self) -> &str {
        self.turn.as_deref().unwrap_or(&self.spawn_id)
    }

    fn tag(&self, event: AuraEvent) -> DriverEvent {
        tagged(self.turn.clone(), event)
    }
}

fn tagged(turn: Option<String>, event: AuraEvent) -> DriverEvent {
    DriverEvent::Event { turn, event }
}

fn thought_completed(open: Open, now: Instant) -> DriverEvent {
    let elapsed = now.saturating_duration_since(open.started);
    tagged(
        open.tag,
        AuraEvent::ThoughtCompleted {
            thought_id: open.id,
            duration_ms: Some(millis(elapsed)),
        },
    )
}

fn millis(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).unwrap_or(u32::MAX)
}

/// Lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}

/// The command list as the UI gets it: names, descriptions and hints cut to their limits,
/// de-duplicated by name (the first wins), at most 1,000.
pub fn reduce_commands(entries: Vec<CommandEntry>) -> Vec<SlashCommand> {
    let mut seen = HashSet::new();
    let mut commands = Vec::new();
    for entry in entries {
        if commands.len() == MAX_COMMANDS {
            break;
        }
        let name = truncate(&entry.name, MAX_COMMAND_NAME_CHARS);
        if !seen.insert(name.clone()) {
            continue;
        }
        commands.push(SlashCommand {
            name,
            description: truncate(&entry.description, MAX_COMMAND_DESCRIPTION_CHARS),
            input_hint: entry
                .hint
                .map(|hint| truncate(&hint, MAX_COMMAND_HINT_CHARS)),
        });
    }
    commands
}

#[cfg(test)]
mod tests {
    use aura_protocol::{
        Cost, NoticeLevel, PlanEntry, PlanPriority, PlanStatus, ToolContent, ToolLocation,
        UsageInfo,
    };
    use serde_json::json;

    use super::*;

    const SPAWN: &str = "019a0000-0000-7000-8000-000000000001";

    fn update(value: Value) -> Update {
        Update::parse(&value).expect("parses")
    }

    fn events(mapper: &mut Mapper, value: Value) -> Vec<DriverEvent> {
        match mapper.map(update(value), Instant::now()) {
            Mapped::Events(events) => events,
            other => panic!("expected events, got {other:?}"),
        }
    }

    fn single(mapper: &mut Mapper, value: Value) -> DriverEvent {
        let mut all = events(mapper, value);
        assert_eq!(all.len(), 1, "one event: {all:?}");
        all.remove(0)
    }

    fn event(turn: Option<&str>, event: AuraEvent) -> DriverEvent {
        DriverEvent::Event {
            turn: turn.map(str::to_owned),
            event,
        }
    }

    fn delta(turn: Option<&str>, id: &str, text: &str) -> DriverEvent {
        event(
            turn,
            AuraEvent::MessageDelta {
                message_id: id.into(),
                text: text.into(),
            },
        )
    }

    fn completed(turn: Option<&str>, id: &str) -> DriverEvent {
        event(
            turn,
            AuraEvent::MessageCompleted {
                message_id: id.into(),
            },
        )
    }

    fn chunk(text: &str, message_id: Option<&str>) -> Value {
        let mut value = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": text}});
        if let Some(id) = message_id {
            value["messageId"] = json!(id);
        }
        value
    }

    fn in_turn() -> Mapper {
        let mut mapper = Mapper::new(SPAWN);
        assert!(mapper.begin_turn("T", Instant::now()).is_empty());
        mapper
    }

    #[test]
    fn user_message_chunks_map_to_nothing() {
        let mut mapper = in_turn();
        assert_eq!(
            mapper.map(
                update(json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "hi"}})),
                Instant::now()
            ),
            Mapped::Nothing("a user message chunk")
        );
    }

    #[test]
    fn message_chunks_with_and_without_message_ids() {
        let mut mapper = in_turn();
        // Chunks without ids continue one message.
        assert_eq!(
            events(&mut mapper, chunk("Hel", None)),
            [delta(Some("T"), "T.m1", "Hel")]
        );
        assert_eq!(
            events(&mut mapper, chunk("lo", None)),
            [delta(Some("T"), "T.m1", "lo")]
        );
        // A chunk with an id after id-less chunks is another message.
        assert_eq!(
            events(&mut mapper, chunk("A", Some("a"))),
            [completed(Some("T"), "T.m1"), delta(Some("T"), "T.m2", "A")]
        );
        assert_eq!(
            events(&mut mapper, chunk("A2", Some("a"))),
            [delta(Some("T"), "T.m2", "A2")]
        );
        assert_eq!(
            events(&mut mapper, chunk("B", Some("b"))),
            [completed(Some("T"), "T.m2"), delta(Some("T"), "T.m3", "B")]
        );
        // State updates do not close it.
        events(
            &mut mapper,
            json!({"sessionUpdate": "usage_update", "used": 1, "size": 2}),
        );
        assert_eq!(
            events(&mut mapper, chunk("B2", Some("b"))),
            [delta(Some("T"), "T.m3", "B2")]
        );
        // An empty chunk adds nothing.
        assert!(events(&mut mapper, chunk("", Some("b"))).is_empty());
        // Before TurnEnded.
        assert_eq!(
            mapper.end_turn(Instant::now()),
            [completed(Some("T"), "T.m3")]
        );
        // After the reply, outside any turn: spawn-prefixed and untagged.
        assert_eq!(
            events(&mut mapper, chunk("late", None)),
            [delta(None, &format!("{SPAWN}.m1"), "late")]
        );
        // A new turn closes the untagged message first.
        assert_eq!(
            mapper.begin_turn("U", Instant::now()),
            [completed(None, &format!("{SPAWN}.m1"))]
        );
        assert_eq!(
            events(&mut mapper, chunk("x", None)),
            [delta(Some("U"), "U.m1", "x")]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn thoughts_close_on_other_kinds_with_their_duration() {
        let mut mapper = in_turn();
        let thought = |text: &str| json!({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": text}});
        assert_eq!(
            events(&mut mapper, thought("Let me")),
            [event(
                Some("T"),
                AuraEvent::ThoughtDelta {
                    thought_id: "T.t1".into(),
                    text: "Let me".into()
                }
            )]
        );
        tokio::time::advance(Duration::from_millis(1500)).await;
        assert_eq!(
            events(&mut mapper, chunk("Answer", None)),
            [
                event(
                    Some("T"),
                    AuraEvent::ThoughtCompleted {
                        thought_id: "T.t1".into(),
                        duration_ms: Some(1500)
                    }
                ),
                delta(Some("T"), "T.m1", "Answer"),
            ]
        );
        // A thought closes the open message.
        assert_eq!(
            events(&mut mapper, thought("more")),
            [
                completed(Some("T"), "T.m1"),
                event(
                    Some("T"),
                    AuraEvent::ThoughtDelta {
                        thought_id: "T.t2".into(),
                        text: "more".into()
                    }
                ),
            ]
        );
    }

    #[test]
    fn tool_calls_map_with_minted_ids_and_defaults() {
        let mut mapper = in_turn();
        assert_eq!(
            events(
                &mut mapper,
                json!({
                    "sessionUpdate": "tool_call", "toolCallId": "call_1", "title": "Read main.rs", "name": "Read",
                    "kind": "read", "status": "in_progress",
                    "content": [{"type": "content", "content": {"type": "text", "text": "fn main"}}],
                    "locations": [{"path": "/w/main.rs", "line": 1}], "rawInput": {"path": "/w/main.rs"},
                })
            ),
            [event(
                Some("T"),
                AuraEvent::ToolCall(ToolCall {
                    tool_call_id: "T.call_1".into(),
                    kind: ToolKind::Read,
                    title: "Read main.rs".into(),
                    status: ToolStatus::InProgress,
                    locations: vec![ToolLocation {
                        path: "/w/main.rs".into(),
                        line: Some(1)
                    }],
                    raw_input: Some(json!({"path": "/w/main.rs"})),
                    tool_name: Some("Read".into()),
                    content: vec![ToolContent::Text {
                        text: "fn main".into(),
                        truncated: None
                    }],
                    truncated: None,
                })
            )]
        );
        // Unknown kind and status, empty title: other, pending, the name.
        let DriverEvent::Event {
            event: AuraEvent::ToolCall(call),
            ..
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "c2", "title": "", "name": "Bash",
                "kind": "teleport", "status": "levitating",
            }),
        )
        else {
            panic!("a tool call");
        };
        assert_eq!(
            (call.kind, call.status, call.title.as_str()),
            (ToolKind::Other, ToolStatus::Pending, "Bash")
        );
        // No title and no name: "Tool"; no kind or status: other and pending.
        let DriverEvent::Event {
            event: AuraEvent::ToolCall(call),
            ..
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "c3",
            }),
        )
        else {
            panic!("a tool call");
        };
        assert_eq!(
            (call.kind, call.status, call.title.as_str()),
            (ToolKind::Other, ToolStatus::Pending, "Tool")
        );
    }

    #[test]
    fn a_tool_call_seen_before_becomes_an_update_with_every_field() {
        let mut mapper = in_turn();
        events(
            &mut mapper,
            json!({"sessionUpdate": "tool_call", "toolCallId": "c", "title": "Run", "kind": "execute"}),
        );
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "tool_call", "toolCallId": "c", "title": "Run ls", "kind": "execute", "status": "completed"})
            ),
            [event(
                Some("T"),
                AuraEvent::ToolUpdate(ToolUpdate {
                    tool_call_id: "T.c".into(),
                    status: Some(ToolStatus::Completed),
                    title: Some("Run ls".into()),
                    kind: Some(ToolKind::Execute),
                    locations: Some(Vec::new()),
                    raw_input: None,
                    tool_name: None,
                    content: Some(Vec::new()),
                    truncated: None,
                })
            )]
        );
    }

    #[test]
    fn tool_call_updates_carry_only_present_fields() {
        let mut mapper = in_turn();
        events(
            &mut mapper,
            json!({"sessionUpdate": "tool_call", "toolCallId": "c", "title": "Edit", "kind": "edit"}),
        );
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "tool_call_update", "toolCallId": "c", "status": "completed",
                "content": [{"type": "diff", "path": "/w/a.rs", "oldText": "a", "newText": "b"}],
                "rawOutput": {"dropped": true}})
            ),
            [event(
                Some("T"),
                AuraEvent::ToolUpdate(ToolUpdate {
                    tool_call_id: "T.c".into(),
                    status: Some(ToolStatus::Completed),
                    title: None,
                    kind: None,
                    locations: None,
                    raw_input: None,
                    tool_name: None,
                    content: Some(vec![ToolContent::Diff {
                        path: "/w/a.rs".into(),
                        old_text: Some("a".into()),
                        new_text: "b".into(),
                        truncated: None
                    }]),
                    truncated: None,
                })
            )]
        );
        // `content: []` clears; absent keeps.
        let DriverEvent::Event {
            event: AuraEvent::ToolUpdate(update),
            ..
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "c", "content": [], "name": "Edit"
            }),
        )
        else {
            panic!("an update");
        };
        assert_eq!(update.content, Some(Vec::new()));
        assert_eq!(update.tool_name.as_deref(), Some("Edit"));
    }

    #[test]
    fn orphan_tool_update_synthesizes_call() {
        let mut mapper = in_turn();
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "tool_call_update", "toolCallId": "late", "title": "Search", "kind": "search", "status": "in_progress"})
            ),
            [
                event(
                    Some("T"),
                    AuraEvent::ToolCall(ToolCall {
                        tool_call_id: "T.late".into(),
                        kind: ToolKind::Other,
                        title: "Search".into(),
                        status: ToolStatus::Pending,
                        locations: Vec::new(),
                        raw_input: None,
                        tool_name: None,
                        content: Vec::new(),
                        truncated: None,
                    })
                ),
                event(
                    Some("T"),
                    AuraEvent::ToolUpdate(ToolUpdate {
                        tool_call_id: "T.late".into(),
                        status: Some(ToolStatus::InProgress),
                        title: Some("Search".into()),
                        kind: Some(ToolKind::Search),
                        locations: None,
                        raw_input: None,
                        tool_name: None,
                        content: None,
                        truncated: None,
                    })
                ),
            ]
        );
        let synthesized = events(
            &mut mapper,
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "nameless"}),
        );
        assert!(
            matches!(&synthesized[0], DriverEvent::Event { event: AuraEvent::ToolCall(call), .. } if call.title == "Tool")
        );
    }

    #[test]
    fn a_late_update_lands_on_the_earlier_turns_block() {
        let mut mapper = in_turn();
        events(
            &mut mapper,
            json!({"sessionUpdate": "tool_call", "toolCallId": "bg", "title": "Background"}),
        );
        mapper.end_turn(Instant::now());
        mapper.begin_turn("U", Instant::now());
        let DriverEvent::Event {
            turn,
            event: AuraEvent::ToolUpdate(update),
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "bg", "status": "completed"
            }),
        )
        else {
            panic!("an update");
        };
        assert_eq!(update.tool_call_id, "T.bg", "the id fixed at first sight");
        assert_eq!(
            turn.as_deref(),
            Some("U"),
            "tagged with the turn it was read in"
        );
    }

    #[test]
    fn long_tool_call_ids_are_hashed_and_outside_turns_use_the_spawn_id() {
        let mut mapper = Mapper::new(SPAWN);
        let long = "x".repeat(97);
        let DriverEvent::Event {
            turn: None,
            event: AuraEvent::ToolCall(call),
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call", "toolCallId": long, "title": "t"
            }),
        )
        else {
            panic!("an untagged tool call");
        };
        let digest = hex(&Sha256::digest(long.as_bytes()));
        assert_eq!(call.tool_call_id, format!("{SPAWN}.{}", &digest[..16]));
        let exact = "y".repeat(96);
        let DriverEvent::Event {
            event: AuraEvent::ToolCall(call),
            ..
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call", "toolCallId": exact, "title": "t"
            }),
        )
        else {
            panic!("a tool call");
        };
        assert_eq!(call.tool_call_id, format!("{SPAWN}.{exact}"));
    }

    #[test]
    fn tool_content_rows() {
        let mut mapper = in_turn();
        let DriverEvent::Event {
            event: AuraEvent::ToolCall(call),
            ..
        } = single(
            &mut mapper,
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "c", "title": "t", "content": [
                    {"type": "content", "content": {"type": "image", "mimeType": "image/png", "data": "AAAA"}},
                    {"type": "diff", "path": "/w/new.rs", "newText": "fresh"},
                    {"type": "terminal", "terminalId": "term_1"},
                    {"type": "hologram", "data": 1},
                ]
            }),
        )
        else {
            panic!("a tool call");
        };
        assert_eq!(
            call.content,
            [
                ToolContent::Text {
                    text: "[image: image/png, 1 KB]".into(),
                    truncated: None
                },
                ToolContent::Diff {
                    path: "/w/new.rs".into(),
                    old_text: None,
                    new_text: "fresh".into(),
                    truncated: None
                },
                ToolContent::Text {
                    text: super::super::wire::TERMINAL_PLACEHOLDER.into(),
                    truncated: None
                },
            ]
        );
    }

    #[test]
    fn a_permissions_own_tool_call_never_becomes_a_block() {
        let mut mapper = in_turn();
        assert_eq!(mapper.permission_tool("perm-check-1"), None);
        assert_eq!(
            mapper.map(update(json!({"sessionUpdate": "tool_call_update", "toolCallId": "perm-check-1", "status": "completed"})), Instant::now()),
            Mapped::Nothing("an update to a permission request's tool call")
        );
        // A real tool call with that id later is a block after all.
        let shown = events(
            &mut mapper,
            json!({"sessionUpdate": "tool_call", "toolCallId": "perm-check-1", "title": "Run"}),
        );
        assert!(matches!(
            &shown[0],
            DriverEvent::Event {
                event: AuraEvent::ToolCall(_),
                ..
            }
        ));
        assert_eq!(
            mapper.permission_tool("perm-check-1"),
            Some(("T.perm-check-1".into(), ToolKind::Other, "Run".into()))
        );
        assert_eq!(mapper.mint_permission(), "T.p1");
        assert_eq!(mapper.mint_permission(), "T.p2");
    }

    #[test]
    fn plans_replace_with_lenient_entries() {
        let mut mapper = in_turn();
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "plan", "entries": [
                    {"content": "Read", "priority": "high", "status": "completed"},
                    {"content": "Edit", "priority": "urgent", "status": "blocked"},
                    {"priority": "low"},
                ]})
            ),
            [event(
                Some("T"),
                AuraEvent::PlanUpdated {
                    entries: vec![
                        PlanEntry {
                            content: "Read".into(),
                            status: PlanStatus::Completed,
                            priority: Some(PlanPriority::High)
                        },
                        PlanEntry {
                            content: "Edit".into(),
                            status: PlanStatus::Pending,
                            priority: None
                        },
                    ]
                }
            )]
        );
    }

    #[test]
    fn commands_are_reduced() {
        let mut mapper = in_turn();
        let mut commands: Vec<Value> = (0..1_100)
            .map(|index| json!({"name": format!("c{index}"), "description": "d"}))
            .collect();
        commands.insert(0, json!({"name": "n".repeat(200), "description": "d".repeat(400), "input": {"hint": "h".repeat(250)}}));
        commands.insert(1, json!({"name": "c0", "description": "duplicate"}));
        commands.insert(2, json!({"description": "no name"}));
        let Mapped::Commands(reduced) = mapper.map(
            update(json!({"sessionUpdate": "available_commands_update", "availableCommands": commands})),
            Instant::now(),
        ) else {
            panic!("commands");
        };
        assert_eq!(reduced.len(), MAX_COMMANDS);
        assert_eq!(reduced[0].name.chars().count(), MAX_COMMAND_NAME_CHARS);
        assert_eq!(
            reduced[0].description.chars().count(),
            MAX_COMMAND_DESCRIPTION_CHARS
        );
        assert_eq!(
            reduced[0]
                .input_hint
                .as_deref()
                .map(|hint| hint.chars().count()),
            Some(MAX_COMMAND_HINT_CHARS)
        );
        assert_eq!(reduced[1].description, "duplicate", "the first c0 wins");
        assert!(
            reduced
                .iter()
                .filter(|command| command.name == "c0")
                .count()
                == 1
        );
    }

    #[test]
    fn state_updates_pass_to_the_driver() {
        let mut mapper = in_turn();
        assert_eq!(
            mapper.map(
                update(json!({"sessionUpdate": "current_mode_update", "currentModeId": "plan"})),
                Instant::now()
            ),
            Mapped::Mode("plan".into())
        );
        assert_eq!(
            mapper.map(
                update(
                    json!({"sessionUpdate": "config_option_update", "configOptions": [{"id": "a"}]})
                ),
                Instant::now()
            ),
            Mapped::ConfigOptions(vec![json!({"id": "a"})])
        );
    }

    #[test]
    fn session_info_titles_set_clear_or_keep() {
        let mut mapper = in_turn();
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "session_info_update", "title": "Fix the build"})
            ),
            [DriverEvent::Title(Some("Fix the build".into()))]
        );
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "session_info_update", "title": null})
            ),
            [DriverEvent::Title(None)]
        );
        assert_eq!(
            mapper.map(update(json!({"sessionUpdate": "session_info_update", "updatedAt": "2026-10-24T10:00:00Z"})), Instant::now()),
            Mapped::Nothing("a session info update without a title")
        );
    }

    #[test]
    fn usage_updates_carry_the_cumulative_cost() {
        let mut mapper = in_turn();
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "usage_update", "used": 1200, "size": 200000, "cost": {"amount": 0.42, "currency": "USD"}})
            ),
            [event(
                Some("T"),
                AuraEvent::UsageUpdated(UsageInfo {
                    context_used: Some(1200),
                    context_size: Some(200_000),
                    cost: Some(Cost {
                        amount: 0.42,
                        currency: "USD".into()
                    }),
                })
            )]
        );
    }

    #[test]
    fn notices_map_severity_and_join_title_and_description() {
        let mut mapper = in_turn();
        for (severity, level) in [
            ("info", NoticeLevel::Info),
            ("warning", NoticeLevel::Warning),
            ("error", NoticeLevel::Error),
            ("debug", NoticeLevel::Info),
        ] {
            assert_eq!(
                events(
                    &mut mapper,
                    json!({"sessionUpdate": "notice", "severity": severity, "title": "Rate limited", "description": "Retrying in 30 s"})
                ),
                [event(
                    Some("T"),
                    AuraEvent::Notice {
                        level,
                        message: "Rate limited: Retrying in 30 s".into()
                    }
                )]
            );
        }
        assert_eq!(
            events(
                &mut mapper,
                json!({"sessionUpdate": "notice", "severity": "info", "title": "Only a title"})
            ),
            [event(
                Some("T"),
                AuraEvent::Notice {
                    level: NoticeLevel::Info,
                    message: "Only a title".into()
                }
            )]
        );
    }

    #[test]
    fn unmapped_and_unknown_tags_map_to_nothing() {
        let mut mapper = in_turn();
        for tag in [
            "compaction_update",
            "compaction_summary_chunk",
            "plan_update",
            "plan_removed",
            "subagent_update",
            "session_message",
            "session_message_chunk",
        ] {
            assert_eq!(
                mapper.map(update(json!({"sessionUpdate": tag})), Instant::now()),
                Mapped::Nothing("an update auracode does not advertise"),
                "{tag}"
            );
        }
        assert_eq!(
            mapper.map(update(json!({"sessionUpdate": "teleport"})), Instant::now()),
            Mapped::Nothing("an unknown update")
        );
        // Neither closes an open message.
        events(&mut mapper, chunk("open", None));
        mapper.map(update(json!({"sessionUpdate": "teleport"})), Instant::now());
        assert_eq!(
            events(&mut mapper, chunk(" still", None)),
            [delta(Some("T"), "T.m1", " still")]
        );
    }

    #[test]
    fn mapped_tags_cover_every_row_once() {
        let unique: HashSet<&&str> = MAPPED_TAGS.iter().collect();
        assert_eq!(unique.len(), MAPPED_TAGS.len());
        assert_eq!(MAPPED_TAGS.len(), 19);
        for tag in MAPPED_TAGS {
            assert!(
                !matches!(
                    Update::parse(&json!({"sessionUpdate": tag})),
                    Ok(Update::Unknown(_))
                ),
                "{tag}"
            );
        }
    }
}
