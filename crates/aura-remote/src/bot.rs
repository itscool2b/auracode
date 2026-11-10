//! The tools a linked bot calls (`apps/relay/src/tools.json` describes them to the bot). Each
//! call is one answer in plain text; a failure is text too, marked as an error, so the bot can
//! read why and try something else.

use std::{sync::Arc, time::Duration};

use aura_protocol::session::ChatSummary;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    backend::{Backend, BackendError, Statuses},
    render,
    wire::Overview,
};

/// Every tool the relay offers. A name outside this list is refused before anything runs.
pub const TOOLS: [&str; 8] = [
    "list_chats",
    "list_projects",
    "read_chat",
    "send_message",
    "wait_for_chat",
    "respond_to_request",
    "stop_chat",
    "start_chat",
];

const LISTED_CHATS: usize = 60;
/// The longest message a bot may send, in bytes.
const MAX_TEXT: usize = 64 * 1024;
const WAIT_DEFAULT: u64 = 30;
const WAIT_MAX: u64 = 45;

#[derive(Debug, PartialEq, Eq)]
pub struct Answer {
    pub text: String,
    pub error: bool,
}

impl Answer {
    fn ok(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            error: false,
        }
    }

    fn failed(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            error: true,
        }
    }
}

impl From<BackendError> for Answer {
    fn from(error: BackendError) -> Self {
        Self::failed(error.message)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChatOnly {
    chat_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Read {
    chat_id: String,
    turns: Option<u8>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Send {
    chat_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Wait {
    chat_id: String,
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Respond {
    chat_id: String,
    request_id: String,
    option_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    folder_id: String,
    agent_id: Option<String>,
    text: String,
}

fn arguments<T: for<'de> Deserialize<'de>>(args: &Value) -> Result<T, Answer> {
    // A bot may send no arguments at all for a tool that takes none.
    let args = if args.is_null() {
        Value::Object(Default::default())
    } else {
        args.clone()
    };
    serde_json::from_value(args)
        .map_err(|error| Answer::failed(format!("The tool's arguments are not valid: {error}.")))
}

fn message(text: &str) -> Result<(), Answer> {
    if text.trim().is_empty() {
        Err(Answer::failed("The message is empty."))
    } else if text.len() > MAX_TEXT {
        Err(Answer::failed(
            "The message is too long. Keep it under 64 KiB.",
        ))
    } else {
        Ok(())
    }
}

/// Runs one tool call. `owner` is unique to the call: whatever it watches is released at the end.
pub async fn call(backend: &Arc<dyn Backend>, owner: &str, tool: &str, args: &Value) -> Answer {
    match run(backend, owner, tool, args).await {
        Ok(answer) | Err(answer) => answer,
    }
}

async fn run(
    backend: &Arc<dyn Backend>,
    owner: &str,
    tool: &str,
    args: &Value,
) -> Result<Answer, Answer> {
    match tool {
        "list_chats" => {
            arguments::<Nothing>(args)?;
            Ok(Answer::ok(chats(&backend.overview().await?)))
        }
        "list_projects" => {
            arguments::<Nothing>(args)?;
            Ok(Answer::ok(projects(&backend.overview().await?)))
        }
        "read_chat" => {
            let args: Read = arguments(args)?;
            let turns = usize::from(args.turns.unwrap_or(2).clamp(1, 10));
            Ok(Answer::ok(read(backend, &args.chat_id, turns).await?))
        }
        "send_message" => {
            let args: Send = arguments(args)?;
            message(&args.text)?;
            let ack = backend.send(&args.chat_id, args.text).await?;
            Ok(Answer::ok(if ack.queued {
                "Queued: the agent is working, and gets this message when its turn ends. Call wait_for_chat for the result."
            } else {
                "Sent: the agent is working on it. Call wait_for_chat for the result."
            }))
        }
        "wait_for_chat" => {
            let args: Wait = arguments(args)?;
            let seconds = args
                .timeout_seconds
                .unwrap_or(WAIT_DEFAULT)
                .clamp(1, WAIT_MAX);
            let result = wait(backend, owner, &args.chat_id, Duration::from_secs(seconds)).await;
            backend.release(owner);
            Ok(Answer::ok(result?))
        }
        "respond_to_request" => {
            let args: Respond = arguments(args)?;
            match args.option_id {
                Some(option) => {
                    backend
                        .permission(&args.chat_id, &args.request_id, Some(option))
                        .await?;
                    Ok(Answer::ok(
                        "Answered. The agent continues; call wait_for_chat.",
                    ))
                }
                None => {
                    // Without an option the request is declined, whichever kind it is.
                    match backend
                        .permission(&args.chat_id, &args.request_id, None)
                        .await
                    {
                        Err(error) if error.not_pending() => {
                            backend
                                .answer(&args.chat_id, &args.request_id, None)
                                .await?;
                        }
                        other => other?,
                    }
                    Ok(Answer::ok(
                        "Declined. Send a message to tell the agent what to do instead.",
                    ))
                }
            }
        }
        "stop_chat" => {
            let args: ChatOnly = arguments(args)?;
            backend.interrupt(&args.chat_id).await?;
            Ok(Answer::ok("Stopping the turn."))
        }
        "start_chat" => {
            let args: Start = arguments(args)?;
            message(&args.text)?;
            let created = backend
                .create(&args.folder_id, args.agent_id.as_deref())
                .await?;
            let id = created.chat.id;
            match backend.send(&id, args.text).await {
                Ok(_) => Ok(Answer::ok(format!(
                    "Started chat {id} with {}. The agent is working on the message; call wait_for_chat with this chat id.",
                    created.chat.agent_name
                ))),
                Err(error) => Err(Answer::failed(format!(
                    "Chat {id} was created, but its first message was not sent: {} Send it with send_message.",
                    error.message
                ))),
            }
        }
        _ => Err(Answer::failed("There is no such tool.")),
    }
}

fn find<'a>(overview: &'a Overview, chat_id: &str) -> Result<&'a ChatSummary, Answer> {
    overview
        .chats
        .iter()
        .map(|entry| &entry.chat)
        .find(|chat| chat.id == chat_id)
        .ok_or_else(|| Answer::failed("There is no chat with that id. Call list_chats."))
}

async fn read(backend: &Arc<dyn Backend>, chat_id: &str, turns: usize) -> Result<String, Answer> {
    let overview = backend.overview().await?;
    let chat = find(&overview, chat_id)?;
    let page = backend.history(chat_id, u32::MAX).await?;
    Ok(render::chat(chat, &page.items, turns))
}

/// Waits until the chat is between turns or asks for something, then reads its last turn.
async fn wait(
    backend: &Arc<dyn Backend>,
    owner: &str,
    chat_id: &str,
    timeout: Duration,
) -> Result<String, Answer> {
    // Watch before looking, so a change between the two is not missed.
    let (changed, mut changes) = tokio::sync::watch::channel(());
    let watched = chat_id.to_owned();
    let statuses: Statuses = Arc::new(move |update| {
        if update.chat_id == watched {
            let _ = changed.send(());
        }
        !changed.is_closed()
    });
    backend.watch(owner, statuses)?;
    let deadline = tokio::time::Instant::now() + timeout;
    let timed_out = loop {
        let overview = backend.overview().await?;
        if render::settled(find(&overview, chat_id)?) {
            break false;
        }
        match tokio::time::timeout_at(deadline, changes.changed()).await {
            Ok(Ok(())) => {}
            // The watch ended (another profile opened): report what is known now.
            Ok(Err(_)) => break false,
            Err(_) => break true,
        }
    };
    let text = read(backend, chat_id, 1).await?;
    Ok(if timed_out {
        format!(
            "Still working after {} seconds. Call wait_for_chat again to keep waiting.\n\n{text}",
            timeout.as_secs()
        )
    } else {
        text
    })
}

fn chats(overview: &Overview) -> String {
    let open: Vec<_> = overview
        .chats
        .iter()
        .filter(|entry| !entry.archived)
        .collect();
    if open.is_empty() {
        return format!(
            "No chats are open on {}. Use list_projects and start_chat to start one.",
            overview.host_name
        );
    }
    let mut out = format!(
        "Chats on {}, most recently active first:\n",
        overview.host_name
    );
    for entry in open.iter().take(LISTED_CHATS) {
        let project = overview
            .projects
            .iter()
            .find(|project| project.id == entry.project_id)
            .map_or("no project", |project| project.name.as_str());
        out.push_str(&format!(
            "- {} \"{}\" in {} with {}: {}\n",
            entry.chat.id,
            render::title(&entry.chat),
            project,
            entry.chat.agent_name,
            render::status(&entry.chat)
        ));
    }
    if open.len() > LISTED_CHATS {
        out.push_str(&format!("And {} older chats.\n", open.len() - LISTED_CHATS));
    }
    out
}

fn projects(overview: &Overview) -> String {
    let mut out = String::new();
    if overview.projects.is_empty() {
        out.push_str("There are no projects yet. Its owner adds one in auracode.\n");
    }
    for project in &overview.projects {
        out.push_str(&format!("Project \"{}\"", project.name));
        if let Some(agent) = &project.default_agent {
            out.push_str(&format!(" (usual agent: {agent})"));
        }
        out.push('\n');
        for folder in &project.folders {
            out.push_str(&format!(
                "- folder {}: {}\n",
                folder.id, folder.display_name
            ));
        }
    }
    out.push_str("\nAgents:\n");
    for agent in &overview.agents {
        out.push_str(&format!(
            "- {}: {}{}\n",
            agent.id,
            agent.name,
            if agent.available {
                ""
            } else {
                " (not ready on this computer)"
            }
        ));
    }
    if let Some(agent) = &overview.default_agent {
        out.push_str(&format!(
            "New chats use {agent} unless the project names another.\n"
        ));
    }
    out
}
