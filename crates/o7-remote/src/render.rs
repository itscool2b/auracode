//! A chat as plain text, for a bot that reads it through a tool. A summary, not a record: the
//! person's words, the steps the agent took by title, what it said, and what it is waiting on.

use std::collections::HashMap;

use o7_protocol::{
    O7Event, PermissionRequest, SessionStatus, StopReason, ToolStatus, UiPrompt, UiRequest,
    session::{ChatSummary, HistoryItem},
};

/// The most of a prompt, of an agent's words and of a turn's steps one reading carries. A bot
/// pays for every character it reads, on every later step of its own turn, so the tools a
/// current relay lists read less unless more is asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub prompt: usize,
    pub answer: usize,
    pub steps: usize,
    /// The short tool names (`answer`, `wait`) in what a reading says to do next.
    pub lean: bool,
}

impl Limits {
    /// What the first tools read (`read_chat`, `wait_for_chat`).
    pub const FIRST: Self = Self {
        prompt: 2_000,
        answer: 6_000,
        steps: 12,
        lean: false,
    };
    /// A reading for a bot that follows a chat: the end of the answer, the last few steps.
    pub const LEAN: Self = Self {
        prompt: 400,
        answer: 3_000,
        steps: 5,
        lean: true,
    };
    /// The same reading when the bot asks for all of it.
    pub const WIDE: Self = Self {
        prompt: 2_000,
        answer: 12_000,
        steps: 20,
        lean: true,
    };
}
/// How o7 begins the project memory it attaches after a prompt
/// (`crates/o7-core/src/chatstore/memory.rs`). It is reference context, not the person's words.
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
            O7Event::TurnStarted { .. } => {
                turns.push(Turn::default());
                open = true;
            }
            O7Event::TurnEnded { stop_reason, .. } => {
                let at = current(&mut turns, &mut open);
                turns[at].ended = Some(*stop_reason);
                open = false;
            }
            O7Event::UserMessageDelta { message_id, text } => {
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
            O7Event::MessageDelta { message_id, text } => {
                let at = current(&mut turns, &mut open);
                let (turn, message) = *messages.entry(message_id).or_insert_with(|| {
                    turns[at].said.push(String::new());
                    (at, turns[at].said.len() - 1)
                });
                turns[turn].said[message].push_str(text);
            }
            O7Event::ToolCall(call) => {
                let at = current(&mut turns, &mut open);
                let title = if call.title.trim().is_empty() {
                    call.tool_name.clone().unwrap_or_else(|| "Tool".into())
                } else {
                    call.title.clone()
                };
                turns[at].steps.push((title, call.status));
                tools.insert(&call.tool_call_id, (at, turns[at].steps.len() - 1));
            }
            O7Event::ToolUpdate(update) => {
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
            O7Event::PermissionRequested(request) => {
                waiting.push(Waiting::Permission(request.clone()));
            }
            O7Event::UiRequest(request) => {
                // A notice asks nothing.
                if !matches!(request.prompt, UiPrompt::Notify { .. }) {
                    waiting.push(Waiting::Question(request.clone()));
                }
            }
            O7Event::PermissionResolved { request_id, .. }
            | O7Event::UiResolved { request_id, .. } => {
                waiting.retain(|request| request.id() != request_id);
            }
            O7Event::Error { message, .. } => {
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
    chat_with(chat, items, turns, &Limits::FIRST)
}

/// A turn in progress in two lines: how far it is, not what it has said so far. A bot that waits
/// reads this each time it asks, so it is short; the whole turn is read once, when it ends.
pub fn progress(chat: &ChatSummary, items: &[HistoryItem]) -> String {
    let digest = digest(items);
    let mut out = format!("Chat {}: {}.", chat.id, status(chat));
    if let Some(turn) = digest.turns.last() {
        let done = turn.steps.len();
        if done > 0 {
            let latest: Vec<String> = turn.steps[done.saturating_sub(3)..]
                .iter()
                .map(|(title, _)| one_line(title, 80))
                .collect();
            out.push_str(&format!(
                " {done} step{} so far; latest: {}.",
                if done == 1 { "" } else { "s" },
                latest.join("; ")
            ));
        }
    }
    out
}

/// The request a chat waits on, by id.
pub fn request(items: &[HistoryItem], request_id: &str) -> Option<Waiting> {
    digest(items)
        .waiting
        .into_iter()
        .find(|request| request.id() == request_id)
}

/// One changed file as the lines that differ, with two lines around them: what is the same at
/// the file's start and end is left out, so a small edit to a large file reads small.
pub fn change(before: Option<&str>, after: Option<&str>, chars: usize) -> String {
    const AROUND: usize = 2;
    let old: Vec<&str> = before
        .map(|text| text.lines().collect())
        .unwrap_or_default();
    let new: Vec<&str> = after.map(|text| text.lines().collect()).unwrap_or_default();
    let same_start = old
        .iter()
        .zip(&new)
        .take_while(|(old, new)| old == new)
        .count();
    let same_end = old[same_start..]
        .iter()
        .rev()
        .zip(new[same_start..].iter().rev())
        .take_while(|(old, new)| old == new)
        .count();
    if same_start == old.len() && same_start == new.len() {
        return "The file reads the same before and after.\n".into();
    }
    let from = same_start.saturating_sub(AROUND);
    let mut out = match (before, after) {
        (None, _) => "New file:\n".to_owned(),
        (_, None) => "Deleted file:\n".to_owned(),
        _ => format!("From line {}:\n", from + 1),
    };
    for line in &old[from..same_start] {
        out.push_str(&format!("  {line}\n"));
    }
    for line in &old[same_start..old.len() - same_end] {
        out.push_str(&format!("- {line}\n"));
    }
    for line in &new[same_start..new.len() - same_end] {
        out.push_str(&format!("+ {line}\n"));
    }
    let after_end = new.len() - same_end;
    for line in &new[after_end..(after_end + AROUND).min(new.len())] {
        out.push_str(&format!("  {line}\n"));
    }
    head(&out, chars)
}

/// The last `turns` turns of a chat and what it waits on, within `limits`.
pub fn chat_with(
    chat: &ChatSummary,
    items: &[HistoryItem],
    turns: usize,
    limits: &Limits,
) -> String {
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
                head(person(&turn.prompt), limits.prompt)
            ));
        }
        for steer in &turn.steers {
            out.push_str(&format!(
                "User, during the turn: {}\n",
                head(steer, limits.prompt)
            ));
        }
        if !turn.steps.is_empty() {
            let shown = turn.steps.len().min(limits.steps);
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
            out.push_str(&format!("Agent: {}\n", tail(said.trim(), limits.answer)));
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
        out.push_str(&waiting(request, limits.lean));
    }
    out
}

fn waiting(request: &Waiting, lean: bool) -> String {
    match request {
        Waiting::Permission(request) => {
            let options: Vec<String> = request
                .options
                .iter()
                .map(|option| format!("{} = {}", option.option_id, one_line(&option.label, 80)))
                .collect();
            format!(
                "Waiting request {} (permission): {}\n{}: {}\n",
                request.request_id,
                one_line(&request.title, 300),
                if lean {
                    "Options for answer"
                } else {
                    "Options for respond_to_request"
                },
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
                "Waiting request {} (question): {}\n{}\n",
                request.request_id,
                head(text.trim(), 1_500),
                if lean {
                    "Answer it with answer and text."
                } else {
                    "To answer, dismiss it with respond_to_request (no option_id), then send the answer with send_message."
                }
            )
        }
    }
}

/// A prompt without the project memory o7 attached after it.
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

/// The start of a long text, marked where it was cut.
pub fn cut(text: &str, chars: usize) -> String {
    head(text, chars)
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
    use o7_protocol::{
        PermissionDecision, PermissionOption, PermissionOptionKind, ResolvedBy, ToolCall, ToolKind,
        ToolUpdate,
    };

    fn items(events: Vec<O7Event>) -> Vec<HistoryItem> {
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

    fn user(id: &str, text: &str) -> O7Event {
        O7Event::UserMessageDelta {
            message_id: id.into(),
            text: text.into(),
        }
    }

    fn said(id: &str, text: &str) -> O7Event {
        O7Event::MessageDelta {
            message_id: id.into(),
            text: text.into(),
        }
    }

    fn tool(id: &str, title: &str, status: ToolStatus) -> O7Event {
        O7Event::ToolCall(ToolCall {
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

    fn started(id: &str) -> O7Event {
        O7Event::TurnStarted {
            turn_id: id.into(),
            prompt_id: None,
        }
    }

    fn ended(id: &str, stop_reason: StopReason) -> O7Event {
        O7Event::TurnEnded {
            turn_id: id.into(),
            stop_reason,
            usage: None,
            duration_ms: None,
            recovered: false,
        }
    }

    fn permission(id: &str) -> O7Event {
        O7Event::PermissionRequested(PermissionRequest {
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
            O7Event::ToolUpdate(ToolUpdate {
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
            O7Event::PermissionResolved {
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
            user("u", &"é".repeat(Limits::FIRST.prompt + 10)),
            said("m", &format!("{}the end", "ü".repeat(Limits::FIRST.answer))),
            ended("t", StopReason::Cancelled),
        ]);
        let text = chat(&summary(SessionStatus::Ready, false), &history, 1);
        let prompt = text
            .lines()
            .find(|line| line.starts_with("User: "))
            .expect("prompt");
        assert_eq!(
            prompt.chars().count(),
            "User: ".len() + Limits::FIRST.prompt + 1
        );
        let answer = text
            .lines()
            .find(|line| line.starts_with("Agent: "))
            .expect("answer");
        assert!(answer.starts_with("Agent: …ü") && answer.ends_with("the end"));
        assert_eq!(
            answer.chars().count(),
            "Agent: ".len() + Limits::FIRST.answer + 1
        );
        assert!(text.ends_with("The turn was stopped.\n"));
        let many: Vec<O7Event> = std::iter::once(started("t"))
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
    fn a_lean_reading_is_shorter_and_names_the_current_tools() {
        let history = items(vec![
            started("t1"),
            user("u", &"a".repeat(1_000)),
            tool("1", "Read a.rs", ToolStatus::Completed),
            tool("2", "Read b.rs", ToolStatus::Completed),
            tool("3", "Read c.rs", ToolStatus::Completed),
            tool("4", "Read d.rs", ToolStatus::Completed),
            tool("5", "Read e.rs", ToolStatus::Completed),
            tool("6", "Run tests", ToolStatus::InProgress),
            said("m", &"b".repeat(5_000)),
            permission("p1"),
        ]);
        let chat = summary(SessionStatus::Running, true);
        let first = super::chat(&chat, &history, 1);
        let lean = chat_with(&chat, &history, 1, &Limits::LEAN);
        assert!(
            lean.len() < first.len() * 3 / 4,
            "{} of {}",
            lean.len(),
            first.len()
        );
        assert!(lean.contains("Steps: 1 earlier, then Read b.rs;"), "{lean}");
        assert!(lean.contains("Options for answer: "), "{lean}");
        assert!(first.contains("Options for respond_to_request: "));
        // A turn in progress is a line, whatever it has said so far.
        assert_eq!(
            progress(&chat, &history),
            format!(
                "Chat {}: working, waiting for an answer. 6 steps so far; latest: Read d.rs; Read e.rs; Run tests.",
                chat.id
            )
        );
        assert!(request(&history, "p1").is_some());
        assert!(request(&history, "p2").is_none());
    }

    #[test]
    fn a_change_is_its_differing_lines_with_two_around_them() {
        let before = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
        let after = "one\ntwo\nthree\nFOUR\nfour and a half\nfive\nsix\nseven\n";
        assert_eq!(
            change(Some(before), Some(after), 1_000),
            "From line 2:\n  two\n  three\n- four\n+ FOUR\n+ four and a half\n  five\n  six\n"
        );
        assert_eq!(change(None, Some("a\nb\n"), 1_000), "New file:\n+ a\n+ b\n");
        assert_eq!(change(Some("a\n"), None, 1_000), "Deleted file:\n- a\n");
        assert_eq!(
            change(Some("a\n"), Some("a\n"), 1_000),
            "The file reads the same before and after.\n"
        );
        // Lines repeated around an insertion are not counted twice.
        assert_eq!(
            change(Some("x\nx\n"), Some("x\nx\nx\n"), 1_000),
            "From line 1:\n  x\n  x\n+ x\n"
        );
        assert!(change(None, Some(&"long line\n".repeat(500)), 100).ends_with('…'));
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
