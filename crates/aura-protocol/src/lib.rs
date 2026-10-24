//! The shared vocabulary of auracode.
//!
//! Every agent driver (Claude Code, Codex, Pi, any ACP agent) translates its native stream into
//! [`AuraEvent`]s, the UI renders only `AuraEvent`s, and the sync layer stores them. The shape follows
//! the Agent Client Protocol's `session/update` vocabulary because that is already the cross-agent
//! standard; native-only extras (rate-limit windows, effort levels) are additive.
//!
//! Wire format: JSON, internally tagged with `"type"` in `snake_case`. Timestamps are Unix
//! milliseconds (`i64`), exported to TypeScript as `number` (safe up to 2^53).

use serde::{Deserialize, Serialize};
use specta::Type;

/// Unix time in milliseconds.
pub type Millis = i64;

/// Upper bound for one serialized [`EventBatch`] frame sent to the UI. Tauri evaluates JSON payloads
/// under 8 KiB inline and falls back to a slower fetch path above that, so producers split batches to
/// stay below this.
pub const MAX_FRAME_BYTES: usize = 8 * 1024;

/// One normalized event in a chat turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuraEvent {
    TurnStarted {
        turn_id: String,
    },
    TurnEnded {
        turn_id: String,
        stop_reason: StopReason,
        usage: Option<TokenUsage>,
    },
    MessageDelta {
        message_id: String,
        text: String,
    },
    MessageCompleted {
        message_id: String,
    },
    ThoughtDelta {
        thought_id: String,
        text: String,
    },
    ThoughtCompleted {
        thought_id: String,
        duration_ms: Option<u32>,
    },
    ToolCall(ToolCall),
    ToolUpdate(ToolUpdate),
    PermissionRequested(PermissionRequest),
    PermissionResolved {
        request_id: String,
        decision: PermissionDecision,
    },
    UiRequest(UiRequest),
    PlanUpdated {
        entries: Vec<PlanEntry>,
    },
    UsageUpdated(UsageInfo),
    LimitsUpdated {
        windows: Vec<LimitWindow>,
    },
    SessionUpdated(SessionInfo),
    Notice {
        level: NoticeLevel,
        message: String,
    },
    Error {
        message: String,
        recoverable: bool,
    },
}

/// Why a turn ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
    Error,
}

/// Token accounting for a turn, when the agent reports it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_input_tokens: Option<u32>,
    pub reasoning_tokens: Option<u32>,
}

/// A tool invocation started by the agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ToolCall {
    pub tool_call_id: String,
    pub kind: ToolKind,
    pub title: String,
    pub status: ToolStatus,
    pub locations: Vec<ToolLocation>,
    /// The tool's raw input as the agent sent it, for the expanded view.
    pub raw_input: Option<serde_json::Value>,
}

/// Progress or result for a previously announced [`ToolCall`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ToolUpdate {
    pub tool_call_id: String,
    pub status: Option<ToolStatus>,
    pub title: Option<String>,
    pub content: Vec<ToolContent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ToolLocation {
    pub path: String,
    pub line: Option<u32>,
}

/// Rich content attached to a tool update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolContent {
    Text {
        text: String,
    },
    Diff {
        path: String,
        /// `None` when the file is new.
        old_text: Option<String>,
        new_text: String,
    },
    Terminal {
        output: String,
        exit_code: Option<i32>,
        /// Set when `output` was cut for the UI; the full output lives on disk.
        truncated: bool,
    },
}

/// The agent asks the user before running a tool (only outside Full auto).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PermissionRequest {
    pub request_id: String,
    pub tool_call_id: Option<String>,
    pub title: String,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PermissionOption {
    pub option_id: String,
    pub kind: PermissionOptionKind,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PermissionDecision {
    Selected { option_id: String },
    Cancelled,
}

/// An agent asks the UI for input that isn't a tool permission (Pi extension UI, Cursor questions,
/// ACP elicitation).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct UiRequest {
    pub request_id: String,
    pub prompt: UiPrompt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UiPrompt {
    Confirm {
        message: String,
    },
    Select {
        message: String,
        options: Vec<String>,
    },
    Input {
        message: String,
        placeholder: Option<String>,
    },
    Notify {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PlanEntry {
    pub content: String,
    pub status: PlanStatus,
    pub priority: Option<PlanPriority>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanPriority {
    High,
    Medium,
    Low,
}

/// Context-window and spend information for the session.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct UsageInfo {
    pub context_used: Option<u32>,
    pub context_size: Option<u32>,
    pub cost: Option<Cost>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Cost {
    pub amount: f64,
    pub currency: String,
}

/// One account rate-limit window (Claude's five-hour/weekly windows, Codex's primary/secondary).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LimitWindow {
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<Millis>,
}

/// What the agent currently reports about the session.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SessionInfo {
    pub native_session_id: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: Option<String>,
    pub commands: Vec<SlashCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub input_hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NoticeLevel {
    Info,
    Warning,
}

/// How much an agent may do without asking.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Autonomy {
    #[default]
    FullAuto,
    AutoEdit,
    Ask,
}

/// What a driver supports. The UI shows or hides features from this, never from agent names.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Capabilities {
    pub images: bool,
    pub steer: bool,
    pub interrupt: bool,
    pub resume: bool,
    pub fork: bool,
    pub rewind: bool,
    pub set_model: bool,
    pub set_effort: bool,
    pub permissions: bool,
    pub plans: bool,
    pub usage: bool,
    pub limits: bool,
    pub slash_commands: bool,
    pub add_dirs: bool,
    pub autonomy_levels: Vec<Autonomy>,
}

/// A frame of events for one session, sent from the core to the UI over a Tauri channel.
///
/// `seq_start` is the session-wide sequence number of the first event, so the UI can detect gaps and
/// drop duplicates after a reconnect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct EventBatch {
    pub session_id: String,
    pub seq_start: u32,
    pub events: Vec<AuraEvent>,
}

impl EventBatch {
    /// Serialized size in bytes, used to keep frames under [`MAX_FRAME_BYTES`].
    pub fn encoded_len(&self) -> usize {
        serde_json::to_vec(self)
            .map(|v| v.len())
            .unwrap_or(usize::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn round_trip(event: &AuraEvent) -> AuraEvent {
        let text = serde_json::to_string(event).expect("serialize");
        serde_json::from_str(&text).expect("deserialize")
    }

    #[test]
    fn tags_are_snake_case() {
        let value = serde_json::to_value(AuraEvent::MessageDelta {
            message_id: "m1".into(),
            text: "hi".into(),
        })
        .expect("serialize");
        assert_eq!(
            value,
            json!({"type": "message_delta", "message_id": "m1", "text": "hi"})
        );
    }

    #[test]
    fn newtype_variants_flatten_their_struct() {
        let value = serde_json::to_value(AuraEvent::ToolCall(ToolCall {
            tool_call_id: "t1".into(),
            kind: ToolKind::Execute,
            title: "Ran npm test".into(),
            status: ToolStatus::InProgress,
            locations: vec![],
            raw_input: Some(json!({"command": "npm test"})),
        }))
        .expect("serialize");
        assert_eq!(value["type"], "tool_call");
        assert_eq!(value["kind"], "execute");
        assert_eq!(value["status"], "in_progress");
        assert_eq!(value["raw_input"]["command"], "npm test");
    }

    #[test]
    fn every_variant_round_trips() {
        let events = vec![
            AuraEvent::TurnStarted {
                turn_id: "t".into(),
            },
            AuraEvent::TurnEnded {
                turn_id: "t".into(),
                stop_reason: StopReason::Cancelled,
                usage: Some(TokenUsage {
                    input_tokens: 10,
                    output_tokens: 3,
                    ..Default::default()
                }),
            },
            AuraEvent::MessageDelta {
                message_id: "m".into(),
                text: "é 🚀".into(),
            },
            AuraEvent::MessageCompleted {
                message_id: "m".into(),
            },
            AuraEvent::ThoughtDelta {
                thought_id: "th".into(),
                text: "hmm".into(),
            },
            AuraEvent::ThoughtCompleted {
                thought_id: "th".into(),
                duration_ms: Some(1200),
            },
            AuraEvent::ToolUpdate(ToolUpdate {
                tool_call_id: "tc".into(),
                status: Some(ToolStatus::Completed),
                title: None,
                content: vec![
                    ToolContent::Text { text: "ok".into() },
                    ToolContent::Diff {
                        path: "a.rs".into(),
                        old_text: None,
                        new_text: "fn x(){}".into(),
                    },
                    ToolContent::Terminal {
                        output: "done".into(),
                        exit_code: Some(0),
                        truncated: false,
                    },
                ],
            }),
            AuraEvent::PermissionRequested(PermissionRequest {
                request_id: "p".into(),
                tool_call_id: Some("tc".into()),
                title: "Run rm -rf build?".into(),
                options: vec![PermissionOption {
                    option_id: "allow".into(),
                    kind: PermissionOptionKind::AllowOnce,
                    label: "Allow".into(),
                }],
            }),
            AuraEvent::PermissionResolved {
                request_id: "p".into(),
                decision: PermissionDecision::Cancelled,
            },
            AuraEvent::UiRequest(UiRequest {
                request_id: "u".into(),
                prompt: UiPrompt::Select {
                    message: "Pick".into(),
                    options: vec!["a".into(), "b".into()],
                },
            }),
            AuraEvent::PlanUpdated {
                entries: vec![PlanEntry {
                    content: "Write tests".into(),
                    status: PlanStatus::InProgress,
                    priority: Some(PlanPriority::High),
                }],
            },
            AuraEvent::UsageUpdated(UsageInfo {
                context_used: Some(1000),
                context_size: Some(200_000),
                cost: Some(Cost {
                    amount: 0.42,
                    currency: "USD".into(),
                }),
            }),
            AuraEvent::LimitsUpdated {
                windows: vec![LimitWindow {
                    label: "5h".into(),
                    used_percent: 37.5,
                    resets_at: Some(1_761_300_000_000),
                }],
            },
            AuraEvent::SessionUpdated(SessionInfo {
                native_session_id: Some("abc".into()),
                commands: vec![SlashCommand {
                    name: "review".into(),
                    description: "Review".into(),
                    input_hint: None,
                }],
                ..Default::default()
            }),
            AuraEvent::Notice {
                level: NoticeLevel::Warning,
                message: "untested version".into(),
            },
            AuraEvent::Error {
                message: "boom".into(),
                recoverable: true,
            },
        ];
        for event in &events {
            assert_eq!(&round_trip(event), event);
        }
    }

    #[test]
    fn unknown_event_type_is_an_error_not_a_panic() {
        let parsed: Result<AuraEvent, _> = serde_json::from_str(r#"{"type":"teleport","x":1}"#);
        assert!(parsed.is_err());
    }

    #[test]
    fn autonomy_defaults_to_full_auto() {
        assert_eq!(Autonomy::default(), Autonomy::FullAuto);
        assert_eq!(
            serde_json::to_value(Autonomy::AutoEdit).expect("serialize"),
            json!("auto_edit")
        );
    }

    #[test]
    fn batch_encoded_len_matches_serialization() {
        let batch = EventBatch {
            session_id: "s".into(),
            seq_start: 7,
            events: vec![AuraEvent::MessageDelta {
                message_id: "m".into(),
                text: "x".repeat(100),
            }],
        };
        assert_eq!(
            batch.encoded_len(),
            serde_json::to_vec(&batch).expect("serialize").len()
        );
        assert!(batch.encoded_len() < MAX_FRAME_BYTES);
    }
}
