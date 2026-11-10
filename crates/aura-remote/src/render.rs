//! A chat as plain text, for a bot that reads it through a tool. A summary, not a record: the
//! person's words, the steps the agent took by title, what it said, and what it is waiting on.

use std::collections::HashMap;

use aura_protocol::{
    AuraEvent, PermissionRequest, SessionStatus, StopReason, ToolStatus, UiPrompt, UiRequest,
    session::{ChatSummary, HistoryItem},
};

/// The most of a prompt, of an agent's words and of a turn's steps one reading carries.
const PROMPT_CHARS: usize = 2_000;
const ANSWER_CHARS: usize = 6_000;
const STEPS: usize = 12;
/// How Aura begins the project memory it attaches after a prompt
/// (`crates/aura-core/src/chatstore/memory.rs`). It is reference context, not the person's words.
const MEMORY: &str = "\n\nProject memory (Aura reference context, revision ";

#[derive(Debug, Default, PartialEq)]
pub struct Turn {
    pub prompt: String,
    /// Messages the person sent while the turn ran.
    pub steers: Vec<String>,
    /// The agent's messages, in order.
    pub said: Vec<String>,
    /// Each step's title and how it ended.
    pub steps: Vec<(String, ToolStatus)>,
    pub errors: Vec<String>,
    /// `None` while the turn runs.
    pub ended: Option<StopReason>,
}

/// A request the agent is waiting on.
#[derive(Debug, PartialEq)]
pub enum Waiting {
    Permission(PermissionRequest),
    Question(UiRequest),
}

#[derive(Debug, Default, PartialEq)]
pub struct Digest {
    pub turns: Vec<Turn>,
    pub waiting: Vec<Waiting>,
}

/// Folds one page of history, oldest first, into its turns and open requests.
pub fn digest(items: &[HistoryItem]) -> Digest {
    let mut turns: Vec<Turn> = Vec::new();
    let mut open = false;
    let mut users: HashMap<&str, (usize, Option<usize>)> = HashMap::new();
    let mut messages: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut tools: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut waiting: Vec<Waiting> = Vec::new();
    // Events before the page's first turn start belong to a turn cut by the page.
    fn current(turns: &mut Vec<Turn>, open: &mut bool) -> usize {
        if !*open {
            turns.push(Turn::default());
            *open = true;
        }
        turns.len() - 1
    }
    for item in items {
        match &item.event {
            AuraEvent::TurnStarted { .. } => {
                turns.push(Turn::default());
                open = true;
            }
            AuraEvent::TurnEnded { stop_reason, .. } => {
                let at = current(&mut turns, &mut open);
                turns[at].ended = Some(*stop_reason);
                open = false;
            }
            AuraEvent::UserMessageDelta { message_id, text } => {
                let at = current(&mut turns, &mut open);
                let place = *users.entry(message_id).or_insert_with(|| {
                    if turns[at].prompt.is_empty() && turns[at].steers.is_empty() {
                        (at, None)
                    } else {
                        turns[at].steers.push(String::new());
                        (at, Some(turns[at].steers.len() - 1))
                    }
                });
                match place {
                    (turn, None) => turns[turn].prompt.push_str(text),
                    (turn, Some(steer)) => turns[turn].steers[steer].push_str(text),
                }
            }
            AuraEvent::MessageDelta { message_id, text } => {
                let at = current(&mut turns, &mut open);
                let (turn, message) = *messages.entry(message_id).or_insert_with(|| {
                    turns[at].said.push(String::new());
                    (at, turns[at].said.len() - 1)
                });
                turns[turn].said[message].push_str(text);
            }
            AuraEvent::ToolCall(call) => {
                let at = current(&mut turns, &mut open);
                let title = if call.title.trim().is_empty() {
                    call.tool_name.clone().unwrap_or_else(|| "Tool".into())
                } else {
                    call.title.clone()
                };
                turns[at].steps.push((title, call.status));
                tools.insert(&call.tool_call_id, (at, turns[at].steps.len() - 1));
            }
            AuraEvent::ToolUpdate(update) => {
                if let Some(&(turn, step)) = tools.get(update.tool_call_id.as_str()) {
                    let entry = &mut turns[turn].steps[step];
                    if let Some(title) = update.title.as_ref().filter(|t| !t.trim().is_empty()) {
                        entry.0.clone_from(title);
                    }
                    if let Some(status) = update.status {
                        entry.1 = status;
                    }
                }
            }
            AuraEvent::PermissionRequested(request) => {
                waiting.push(Waiting::Permission(request.clone()));
            }
            AuraEvent::UiRequest(request) => {
                // A notice asks nothing.
                if !matches!(request.prompt, UiPrompt::Notify { .. }) {
                    waiting.push(Waiting::Question(request.clone()));
                }
            }
            AuraEvent::PermissionResolved { request_id, .. }
            | AuraEvent::UiResolved { request_id, .. } => {
                waiting.retain(|request| request.id() != request_id);
            }
            AuraEvent::Error { message, .. } => {
                let at = current(&mut turns, &mut open);
                turns[at].errors.push(message.clone());
            }
            _ => {}
        }
    }
    Digest { turns, waiting }
}

impl Waiting {
    pub fn id(&self) -> &str {
        match self {
            Self::Permission(request) => &request.request_id,
            Self::Question(request) => &request.request_id,
        }
    }
}

/// A chat's status in the words the bot tools use.
pub fn status(chat: &ChatSummary) -> String {
    let status = match chat.status {
        SessionStatus::Running => "working",
        SessionStatus::Ready => "idle",
        SessionStatus::Stopped => "stopped (a message starts it again)",
        SessionStatus::Starting => "starting",
        SessionStatus::Cancelling | SessionStatus::Stopping => "stopping",
        SessionStatus::Failed => "failed",
        SessionStatus::AuthRequired => "needs its owner to sign in on the computer",
    };
    if chat.needs_attention {
        format!("{status}, waiting for an answer")
    } else {
        status.to_owned()
    }
}

/// Whether a chat is between turns with nothing to answer: waiting for it would wait for nothing.
pub fn settled(chat: &ChatSummary) -> bool {
    chat.needs_attention
        || !matches!(
            chat.status,
            SessionStatus::Running | SessionStatus::Starting | SessionStatus::Cancelling
        )
}

pub fn title(chat: &ChatSummary) -> String {
    one_line(chat.title.as_deref().unwrap_or("Untitled chat"), 120)
}

/// The last `turns` turns of a chat and what it waits on.
pub fn chat(chat: &ChatSummary, items: &[HistoryItem], turns: usize) -> String {
    let digest = digest(items);
    let mut out = format!(
        "Chat {} \"{}\" with {}: {}.\n",
        chat.id,
        title(chat),
        chat.agent_name,
        status(chat)
    );
    let total = digest.turns.len();
    if total == 0 {
        out.push_str("\nNo turns yet.\n");
    }
    for turn in digest.turns.iter().skip(total.saturating_sub(turns.max(1))) {
        out.push('\n');
        if !turn.prompt.is_empty() {
            out.push_str(&format!(
                "User: {}\n",
                head(person(&turn.prompt), PROMPT_CHARS)
            ));
        }
        for steer in &turn.steers {
            out.push_str(&format!(
                "User, during the turn: {}\n",
                head(steer, PROMPT_CHARS)
            ));
        }
        if !turn.steps.is_empty() {
            let shown = turn.steps.len().min(STEPS);
            let earlier = turn.steps.len() - shown;
            let steps: Vec<String> = turn.steps[earlier..]
                .iter()
                .map(|(title, status)| match status {
                    ToolStatus::Failed => format!("{} (failed)", one_line(title, 120)),
                    ToolStatus::Completed => one_line(title, 120),
                    _ => format!("{} (running)", one_line(title, 120)),
                })
                .collect();
            out.push_str(&format!(
                "Steps: {}{}\n",
                if earlier > 0 {
                    format!("{earlier} earlier, then ")
                } else {
                    String::new()
                },
                steps.join("; ")
            ));
        }
        let said = turn.said.join("\n\n");
        if !said.trim().is_empty() {
            out.push_str(&format!("Agent: {}\n", tail(said.trim(), ANSWER_CHARS)));
        }
        for error in &turn.errors {
            out.push_str(&format!("Error: {}\n", head(error, 500)));
        }
        out.push_str(match turn.ended {
            None => "The turn is still running.\n",
            Some(StopReason::EndTurn) => "The turn finished.\n",
            Some(StopReason::Cancelled | StopReason::Interrupted) => "The turn was stopped.\n",
            Some(StopReason::Refusal) => "The agent refused.\n",
            Some(StopReason::MaxTokens | StopReason::MaxTurnRequests) => {
                "The turn ended at a limit.\n"
            }
            Some(StopReason::Error) => "The turn ended with an error.\n",
            Some(StopReason::Other) => "The turn ended.\n",
        });
    }
    for request in &digest.waiting {
        out.push('\n');
        out.push_str(&waiting(request));
    }
    out
}

fn waiting(request: &Waiting) -> String {
    match request {
        Waiting::Permission(request) => {
            let options: Vec<String> = request
                .options
                .iter()
                .map(|option| format!("{} = {}", option.option_id, one_line(&option.label, 80)))
                .collect();
            format!(
                "Waiting request {} (permission): {}\nOptions for respond_to_request: {}\n",
                request.request_id,
                one_line(&request.title, 300),
                options.join("; ")
            )
        }
        Waiting::Question(request) => {
            let text = match &request.prompt {
                UiPrompt::Confirm { message }
                | UiPrompt::Input { message, .. }
                | UiPrompt::Notify { message }
                | UiPrompt::Form { message, .. }
                | UiPrompt::Link { message, .. } => message.clone(),
                UiPrompt::Select { message, options } => {
                    format!("{message} Choices: {}", options.join("; "))
                }
                UiPrompt::Questions { message, questions } => {
                    let asked: Vec<String> = questions
                        .iter()
                        .map(|question| {
                            let choices: Vec<&str> = question
                                .options
                                .iter()
                                .map(|option| option.label.as_str())
                                .collect();
                            if choices.is_empty() {
                                question.question.clone()
                            } else {
                                format!("{} Choices: {}", question.question, choices.join("; "))
                            }
                        })
                        .collect();
                    format!("{message} {}", asked.join(" "))
                }
            };
            format!(
                "Waiting request {} (question): {}\nTo answer, dismiss it with respond_to_request (no option_id), then send the answer with send_message.\n",
                request.request_id,
                head(text.trim(), 1_500)
            )
        }
    }
}

/// A prompt without the project memory Aura attached after it.
fn person(prompt: &str) -> &str {
    match prompt.find(MEMORY) {
        Some(at) if prompt[at..].contains("\nUse this as project background.") => &prompt[..at],
        _ => prompt,
    }
}

fn one_line(text: &str, chars: usize) -> String {
    head(
        &text.split_whitespace().collect::<Vec<_>>().join(" "),
        chars,
    )
}

fn head(text: &str, chars: usize) -> String {
    match text.char_indices().nth(chars) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_owned(),
    }
}

/// The end of a long text: an agent's answer finishes with what matters.
fn tail(text: &str, chars: usize) -> String {
    let count = text.chars().count();
    if count <= chars {
        return text.to_owned();
    }
    let at = text
        .char_indices()
        .nth(count - chars)
        .map_or(0, |(at, _)| at);
    format!("…{}", &text[at..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::{
        PermissionDecision, PermissionOption, PermissionOptionKind, ResolvedBy, ToolCall, ToolKind,
        ToolUpdate,
    };

    fn items(events: Vec<AuraEvent>) -> Vec<HistoryItem> {
        events
            .into_iter()
            .enumerate()
            .map(|(index, event)| HistoryItem {
                seq: index as u32,
                turn_id: None,
                at: 0,
                event,
            })
            .collect()
    }

    fn user(id: &str, text: &str) -> AuraEvent {
        AuraEvent::UserMessageDelta {
            message_id: id.into(),
            text: text.into(),
        }
    }

    fn said(id: &str, text: &str) -> AuraEvent {
        AuraEvent::MessageDelta {
            message_id: id.into(),
            text: text.into(),
        }
    }

    fn tool(id: &str, title: &str, status: ToolStatus) -> AuraEvent {
        AuraEvent::ToolCall(ToolCall {
            tool_call_id: id.into(),
            kind: ToolKind::Execute,
            title: title.into(),
            status,
            locations: vec![],
            raw_input: None,
            tool_name: Some("Bash".into()),
            content: vec![],
            truncated: None,
        })
    }

    fn started(id: &str) -> AuraEvent {
        AuraEvent::TurnStarted {
            turn_id: id.into(),
            prompt_id: None,
        }
    }

    fn ended(id: &str, stop_reason: StopReason) -> AuraEvent {
        AuraEvent::TurnEnded {
            turn_id: id.into(),
            stop_reason,
            usage: None,
            duration_ms: None,
            recovered: false,
        }
    }

    fn permission(id: &str) -> AuraEvent {
        AuraEvent::PermissionRequested(PermissionRequest {
            request_id: id.into(),
            tool_call_id: None,
            title: "Run `rm -rf build`".into(),
            kind: Some(ToolKind::Execute),
            raw_input: None,
            content: vec![],
            locations: vec![],
            options: vec![
                PermissionOption {
                    option_id: "allow".into(),
                    kind: PermissionOptionKind::AllowOnce,
                    label: "Allow once".into(),
                },
                PermissionOption {
                    option_id: "reject".into(),
                    kind: PermissionOptionKind::RejectOnce,
                    label: "Reject".into(),
                },
            ],
            truncated: None,
        })
    }

    fn summary(status: SessionStatus, needs_attention: bool) -> ChatSummary {
        serde_json::from_value(serde_json::json!({
            "id": "c1",
            "title": "Fix the\nlogin form",
            "agent_id": "claude-code",
            "agent_host": { "type": "native" },
            "agent_name": "Claude Code",
            "folder": "/work/app",
            "folder_state": "ok",
            "status": status,
            "needs_attention": needs_attention,
            "created_at": 0,
            "updated_at": 0,
        }))
        .expect("summary")
    }

    #[test]
    fn folds_turns_steps_answers_and_open_requests() {
        let memory = format!(
            "{MEMORY}r1)\nUse this as project background. More.\n\n# Notes\nsecret notes\n"
        );
        let digest = digest(&items(vec![
            // The page begins inside a turn whose start is on an older page.
            said("m0", "Earlier answer"),
            ended("t0", StopReason::EndTurn),
            started("t1"),
            user("u1", "Run the "),
            user("u1", &format!("tests{memory}")),
            tool("x1", "npm test", ToolStatus::InProgress),
            said("m1", "Running "),
            AuraEvent::ToolUpdate(ToolUpdate {
                tool_call_id: "x1".into(),
                status: Some(ToolStatus::Failed),
                title: None,
                kind: None,
                locations: None,
                raw_input: None,
                tool_name: None,
                content: None,
                truncated: None,
            }),
            said("m1", "them."),
            user("u2", "Use pnpm"),
            said("m2", "Two failed."),
            permission("p1"),
            permission("p2"),
            AuraEvent::PermissionResolved {
                request_id: "p1".into(),
                decision: PermissionDecision::Cancelled,
                by: ResolvedBy::User,
            },
        ]));
        assert_eq!(digest.turns.len(), 2);
        assert_eq!(digest.turns[0].said, ["Earlier answer"]);
        assert_eq!(digest.turns[0].ended, Some(StopReason::EndTurn));
        let turn = &digest.turns[1];
        assert!(turn.prompt.starts_with("Run the tests\n\nProject memory"));
        assert_eq!(turn.steers, ["Use pnpm"]);
        assert_eq!(turn.said, ["Running them.", "Two failed."]);
        assert_eq!(turn.steps, [("npm test".to_owned(), ToolStatus::Failed)]);
        assert_eq!(turn.ended, None);
        assert_eq!(digest.waiting.len(), 1);
        assert_eq!(digest.waiting[0].id(), "p2");
    }

    #[test]
    fn reads_as_text_without_attached_memory_and_names_what_to_answer() {
        let memory = format!("{MEMORY}r1)\nUse this as project background.\n\nsecret notes\n");
        let history = items(vec![
            started("t0"),
            user("u0", "First"),
            said("m0", "Done first."),
            ended("t0", StopReason::EndTurn),
            started("t1"),
            user("u1", &format!("Clean the build{memory}")),
            tool("x1", "Read package.json", ToolStatus::Completed),
            tool("x2", "", ToolStatus::InProgress),
            said("m1", "I need to delete the build folder."),
            permission("p1"),
        ]);
        let text = chat(&summary(SessionStatus::Running, true), &history, 1);
        assert_eq!(
            text,
            "Chat c1 \"Fix the login form\" with Claude Code: working, waiting for an answer.\n\
             \n\
             User: Clean the build\n\
             Steps: Read package.json; Bash (running)\n\
             Agent: I need to delete the build folder.\n\
             The turn is still running.\n\
             \n\
             Waiting request p1 (permission): Run `rm -rf build`\n\
             Options for respond_to_request: allow = Allow once; reject = Reject\n"
        );
        assert!(!text.contains("secret notes"));
        let both = chat(&summary(SessionStatus::Ready, false), &history, 5);
        assert!(both.contains("User: First\nAgent: Done first.\nThe turn finished.\n"));
        assert!(both.starts_with("Chat c1 \"Fix the login form\" with Claude Code: idle.\n"));
        assert_eq!(
            chat(&summary(SessionStatus::Stopped, false), &[], 2),
            "Chat c1 \"Fix the login form\" with Claude Code: stopped (a message starts it again).\n\nNo turns yet.\n"
        );
    }

    #[test]
    fn long_text_is_cut_on_characters_and_keeps_an_answers_end() {
        let history = items(vec![
            started("t"),
            user("u", &"é".repeat(PROMPT_CHARS + 10)),
            said("m", &format!("{}the end", "ü".repeat(ANSWER_CHARS))),
            ended("t", StopReason::Cancelled),
        ]);
        let text = chat(&summary(SessionStatus::Ready, false), &history, 1);
        let prompt = text
            .lines()
            .find(|line| line.starts_with("User: "))
            .expect("prompt");
        assert_eq!(prompt.chars().count(), "User: ".len() + PROMPT_CHARS + 1);
        let answer = text
            .lines()
            .find(|line| line.starts_with("Agent: "))
            .expect("answer");
        assert!(answer.starts_with("Agent: …ü") && answer.ends_with("the end"));
        assert_eq!(answer.chars().count(), "Agent: ".len() + ANSWER_CHARS + 1);
        assert!(text.ends_with("The turn was stopped.\n"));
        let many: Vec<AuraEvent> = std::iter::once(started("t"))
            .chain((0..20).map(|n| {
                tool(
                    &format!("x{n}"),
                    &format!("Step {n}"),
                    ToolStatus::Completed,
                )
            }))
            .collect();
        let text = chat(&summary(SessionStatus::Running, false), &items(many), 1);
        assert!(text.contains("Steps: 8 earlier, then Step 8; Step 9;"));
        assert!(text.contains("Step 19\n"));
    }

    #[test]
    fn waiting_is_over_when_a_chat_stops_working_or_asks() {
        assert!(!settled(&summary(SessionStatus::Running, false)));
        assert!(!settled(&summary(SessionStatus::Starting, false)));
        assert!(settled(&summary(SessionStatus::Running, true)));
        for status in [
            SessionStatus::Ready,
            SessionStatus::Stopped,
            SessionStatus::Failed,
            SessionStatus::AuthRequired,
        ] {
            assert!(settled(&summary(status, false)));
        }
    }
}
