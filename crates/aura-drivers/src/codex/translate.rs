//! Native item streams mapped to the shared transcript vocabulary.
use aura_protocol::{
    AuraEvent, PlanEntry, PlanStatus, ToolCall, ToolContent, ToolKind, ToolStatus, ToolUpdate,
    Truncation, UsageInfo,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Default)]
struct Item {
    emitted: usize,
    complete: bool,
    tool: bool,
    thought_raw: Option<bool>,
    summary_index: Option<u64>,
    output: String,
    output_bytes: usize,
}

pub(super) struct Translator {
    prefix: String,
    items: BTreeMap<String, Item>,
    overflow: bool,
}
impl Translator {
    pub fn new(prefix: String) -> Self {
        Self {
            prefix,
            items: BTreeMap::new(),
            overflow: false,
        }
    }
    fn id(&self, native: &str) -> String {
        if native.len() <= 96 {
            native.into()
        } else {
            format!(
                "codex.{}",
                hex(&Sha256::digest(
                    format!("{}:{native}", self.prefix).as_bytes()
                ))
            )
        }
    }
    pub fn finish_turn(&mut self) {
        self.items.clear();
        self.overflow = false;
    }
    pub fn overflowed(&self) -> bool {
        self.overflow
    }
    pub fn notification(&mut self, method: &str, params: &Value) -> Vec<AuraEvent> {
        let mut events = Vec::new();
        if self.items.len() >= 4096 {
            self.overflow = true;
            return events;
        }
        match method {
            "item/agentMessage/delta"
            | "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta" => {
                let (Some(native), Some(text)) =
                    (params["itemId"].as_str(), params["delta"].as_str())
                else {
                    return events;
                };
                let thought = method != "item/agentMessage/delta";
                let id = self.id(native);
                let state = self.items.entry(id.clone()).or_default();
                if thought {
                    let raw = method == "item/reasoning/textDelta";
                    if state.thought_raw.is_some_and(|selected| selected != raw) {
                        return events;
                    }
                    state.thought_raw = Some(raw);
                    if !raw {
                        let index = params["summaryIndex"].as_u64().unwrap_or(0);
                        if state
                            .summary_index
                            .is_some_and(|previous| previous != index)
                        {
                            events.push(AuraEvent::ThoughtDelta {
                                thought_id: id.clone(),
                                text: "\n".into(),
                            });
                            state.emitted += 1;
                        }
                        state.summary_index = Some(index);
                    }
                }
                if !state.complete {
                    state.emitted = state.emitted.saturating_add(text.len());
                    events.push(if thought {
                        AuraEvent::ThoughtDelta {
                            thought_id: id,
                            text: text.into(),
                        }
                    } else {
                        AuraEvent::MessageDelta {
                            message_id: id,
                            text: text.into(),
                        }
                    });
                }
            }
            "item/started" | "item/completed" => {
                let item = &params["item"];
                let Some(native) = item["id"].as_str().filter(|id| !id.is_empty()) else {
                    return events;
                };
                let id = self.id(native);
                let finished = method == "item/completed";
                let state = self.items.entry(id.clone()).or_default();
                if state.complete {
                    return events;
                }
                match item["type"].as_str() {
                    Some("agentMessage" | "reasoning") => {
                        let thought = item["type"] == "reasoning";
                        let text = if thought {
                            let summary = item["summary"]
                                .as_array()
                                .filter(|values| !values.is_empty());
                            let parts = if state.thought_raw == Some(true) {
                                item["content"].as_array()
                            } else {
                                summary.or_else(|| item["content"].as_array())
                            };
                            parts
                                .map(|values| {
                                    values
                                        .iter()
                                        .filter_map(Value::as_str)
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                })
                                .unwrap_or_default()
                        } else {
                            item["text"].as_str().unwrap_or("").into()
                        };
                        if let Some(suffix) = text.get(state.emitted..)
                            && !suffix.is_empty()
                        {
                            events.push(if thought {
                                AuraEvent::ThoughtDelta {
                                    thought_id: id.clone(),
                                    text: suffix.into(),
                                }
                            } else {
                                AuraEvent::MessageDelta {
                                    message_id: id.clone(),
                                    text: suffix.into(),
                                }
                            });
                            state.emitted = text.len();
                        }
                        if finished {
                            events.push(if thought {
                                AuraEvent::ThoughtCompleted {
                                    thought_id: id,
                                    duration_ms: None,
                                }
                            } else {
                                AuraEvent::MessageCompleted { message_id: id }
                            });
                        }
                    }
                    Some(
                        "commandExecution"
                        | "fileChange"
                        | "mcpToolCall"
                        | "dynamicToolCall"
                        | "webSearch"
                        | "imageView"
                        | "collabAgentToolCall"
                        | "contextCompaction",
                    ) => {
                        let (kind, title) = tool_identity(item);
                        let status = if finished {
                            match item["status"].as_str() {
                                Some("failed" | "declined") => ToolStatus::Failed,
                                Some("completed" | "succeeded") => ToolStatus::Completed,
                                None if matches!(
                                    item["type"].as_str(),
                                    Some("webSearch" | "imageView" | "contextCompaction")
                                ) =>
                                {
                                    ToolStatus::Completed
                                }
                                _ => ToolStatus::Pending,
                            }
                        } else {
                            ToolStatus::InProgress
                        };
                        let content = content(item);
                        if !state.tool {
                            state.tool = true;
                            events.push(AuraEvent::ToolCall(ToolCall {
                                tool_call_id: id.clone(),
                                kind,
                                title: title.clone(),
                                status,
                                locations: Vec::new(),
                                raw_input: Some(item.clone()),
                                tool_name: item["tool"].as_str().map(str::to_owned),
                                content: content.clone(),
                                truncated: None,
                            }));
                        } else {
                            events.push(AuraEvent::ToolUpdate(ToolUpdate {
                                tool_call_id: id,
                                status: Some(status),
                                title: Some(title),
                                kind: Some(kind),
                                locations: None,
                                raw_input: None,
                                tool_name: None,
                                content: Some(content),
                                truncated: None,
                            }));
                        }
                    }
                    _ => {}
                }
                state.complete = finished;
            }
            "turn/diff/updated" => {
                if let (Some(turn), Some(diff)) =
                    (params["turnId"].as_str(), params["diff"].as_str())
                {
                    let id = self.id(&format!("{turn}.diff"));
                    let state = self.items.entry(id.clone()).or_default();
                    let content = vec![ToolContent::Text {
                        text: diff.into(),
                        truncated: None,
                    }];
                    if state.tool {
                        events.push(AuraEvent::ToolUpdate(ToolUpdate {
                            tool_call_id: id,
                            status: None,
                            title: None,
                            kind: None,
                            locations: None,
                            raw_input: None,
                            tool_name: None,
                            content: Some(content),
                            truncated: None,
                        }));
                    } else {
                        state.tool = true;
                        events.push(AuraEvent::ToolCall(ToolCall {
                            tool_call_id: id,
                            kind: ToolKind::Edit,
                            title: "Turn changes".into(),
                            status: ToolStatus::Completed,
                            locations: Vec::new(),
                            raw_input: None,
                            tool_name: None,
                            content,
                            truncated: None,
                        }));
                    }
                }
            }
            "turn/plan/updated" => {
                if let Some(plan) = params["plan"].as_array() {
                    events.push(AuraEvent::PlanUpdated {
                        entries: plan
                            .iter()
                            .filter_map(|entry| {
                                Some(PlanEntry {
                                    content: entry["step"].as_str()?.into(),
                                    status: match entry["status"].as_str() {
                                        Some("completed") => PlanStatus::Completed,
                                        Some("inProgress") => PlanStatus::InProgress,
                                        _ => PlanStatus::Pending,
                                    },
                                    priority: None,
                                })
                            })
                            .collect(),
                    });
                }
            }
            "thread/tokenUsage/updated" => {
                let usage = &params["tokenUsage"];
                events.push(AuraEvent::UsageUpdated(UsageInfo {
                    context_used: usage["last"]["totalTokens"].as_u64(),
                    context_size: usage["modelContextWindow"].as_u64(),
                    cost: None,
                }));
            }
            // Accumulate a bounded preview because ToolUpdate content replaces earlier content.
            // Final native snapshots still pass through the normalizer for complete storage.
            "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" => {
                if let (Some(native), Some(delta)) =
                    (params["itemId"].as_str(), params["delta"].as_str())
                {
                    let id = self.id(native);
                    if let Some(state) = self
                        .items
                        .get_mut(&id)
                        .filter(|item| item.tool && !item.complete)
                    {
                        state.output_bytes = state.output_bytes.saturating_add(delta.len());
                        let remaining = (256 * 1024_usize).saturating_sub(state.output.len());
                        let mut end = remaining.min(delta.len());
                        while !delta.is_char_boundary(end) {
                            end -= 1;
                        }
                        state.output.push_str(&delta[..end]);
                        events.push(AuraEvent::ToolUpdate(ToolUpdate {
                            tool_call_id: id,
                            status: None,
                            title: None,
                            kind: None,
                            locations: None,
                            raw_input: None,
                            tool_name: None,
                            content: Some(vec![ToolContent::Text {
                                text: state.output.clone(),
                                truncated: (state.output_bytes > state.output.len()).then_some(
                                    Truncation {
                                        total_bytes: state.output_bytes as u64,
                                        blob: None,
                                    },
                                ),
                            }]),
                            truncated: None,
                        }));
                    }
                }
            }
            _ => {}
        }
        events
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn tool_identity(item: &Value) -> (ToolKind, String) {
    match item["type"].as_str() {
        Some("commandExecution") => (
            ToolKind::Execute,
            item["command"].as_str().unwrap_or("Command").into(),
        ),
        Some("fileChange") => (ToolKind::Edit, "File changes".into()),
        Some("webSearch") => (ToolKind::Search, "Web search".into()),
        Some("imageView") => (ToolKind::Read, "View image".into()),
        Some("contextCompaction") => (ToolKind::Think, "Compact context".into()),
        _ => (
            ToolKind::Other,
            item["tool"].as_str().unwrap_or("Codex tool").into(),
        ),
    }
}
fn content(item: &Value) -> Vec<ToolContent> {
    if item["type"] == "commandExecution" {
        return item["aggregatedOutput"]
            .as_str()
            .map(|output| {
                vec![ToolContent::Terminal {
                    output: output.into(),
                    exit_code: item["exitCode"]
                        .as_i64()
                        .and_then(|code| i32::try_from(code).ok()),
                    truncated: None,
                }]
            })
            .unwrap_or_default();
    }
    if item["type"] == "fileChange" {
        return item["changes"]
            .as_array()
            .map(|changes| {
                changes
                    .iter()
                    .filter_map(|change| {
                        Some(ToolContent::Text {
                            text: format!(
                                "{}\n{}",
                                change["path"].as_str()?,
                                change["diff"].as_str().unwrap_or("")
                            ),
                            truncated: None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
    }
    item.get("result")
        .filter(|result| !result.is_null())
        .map(|result| {
            vec![ToolContent::Text {
                text: result.to_string(),
                truncated: None,
            }]
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshots_complete_partial_text_without_repeating_it() {
        let mut translator = Translator::new("spawn".into());
        assert_eq!(
            translator.notification(
                "item/agentMessage/delta",
                &json!({"itemId":"m","delta":"hel"})
            ),
            vec![AuraEvent::MessageDelta {
                message_id: "m".into(),
                text: "hel".into()
            }]
        );
        let complete = json!({"item":{"type":"agentMessage","id":"m","text":"hello"}});
        assert_eq!(
            translator.notification("item/completed", &complete),
            vec![
                AuraEvent::MessageDelta {
                    message_id: "m".into(),
                    text: "lo".into()
                },
                AuraEvent::MessageCompleted {
                    message_id: "m".into()
                }
            ]
        );
        assert!(
            translator
                .notification("item/completed", &complete)
                .is_empty()
        );
    }

    #[test]
    fn tool_delta_previews_accumulate_with_bounded_honest_truncation() {
        let mut translator = Translator::new("spawn".into());
        translator.notification("item/started",&json!({"item":{"type":"commandExecution","id":"cmd","command":"test","status":"inProgress"}}));
        translator.notification(
            "item/commandExecution/outputDelta",
            &json!({"itemId":"cmd","delta":"one"}),
        );
        let events = translator.notification(
            "item/commandExecution/outputDelta",
            &json!({"itemId":"cmd","delta":"two"}),
        );
        let AuraEvent::ToolUpdate(update) = &events[0] else {
            panic!("tool update");
        };
        assert!(
            matches!(&update.content.as_ref().unwrap()[0],ToolContent::Text {text,..} if text=="onetwo")
        );
        let events = translator.notification(
            "item/commandExecution/outputDelta",
            &json!({"itemId":"cmd","delta":"x".repeat(300_000)}),
        );
        let AuraEvent::ToolUpdate(update) = &events[0] else {
            panic!("tool update");
        };
        assert!(
            matches!(&update.content.as_ref().unwrap()[0],ToolContent::Text {text,truncated:Some(info)} if text.len()==256*1024 && info.total_bytes==300_006)
        );
        translator.finish_turn();
        assert!(translator.items.is_empty());
    }

    #[test]
    fn reasoning_channels_are_not_duplicated_and_long_ids_are_bounded() {
        let mut translator = Translator::new("spawn".repeat(30));
        let long = "id".repeat(100);
        let first = translator.notification(
            "item/reasoning/summaryTextDelta",
            &json!({"itemId":long,"summaryIndex":0,"delta":"summary"}),
        );
        let AuraEvent::ThoughtDelta { thought_id, .. } = &first[0] else {
            panic!("thought");
        };
        assert!(thought_id.len() <= 96);
        assert!(
            translator
                .notification(
                    "item/reasoning/textDelta",
                    &json!({"itemId":long,"delta":"raw duplicate"})
                )
                .is_empty()
        );
        let completed=translator.notification("item/completed",&json!({"item":{"type":"reasoning","id":long,"summary":["summary"],"content":["raw duplicate"]}}));
        assert_eq!(completed.len(), 1);
        assert!(matches!(completed[0], AuraEvent::ThoughtCompleted { .. }));
    }

    #[test]
    fn unknown_tool_status_never_claims_success() {
        let mut translator = Translator::new("spawn".into());
        let events=translator.notification("item/completed",&json!({"item":{"type":"commandExecution","id":"cmd","command":"test","status":"future"}}));
        assert!(matches!(&events[0],AuraEvent::ToolCall(call) if call.status==ToolStatus::Pending));
    }
}
