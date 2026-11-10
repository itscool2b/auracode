//! A stand-in desktop for trying remote sessions end to end without the app: the real connection
//! task and sealed channel, in front of a made-up project whose "agent" follows a script.
//!
//!     cargo run -p aura-remote --example demo_host -- ws://127.0.0.1:8799 http://localhost:1437 <folder>
//!
//! It turns remote access on, prints `PAIR <link>` and `BOT <address>`, and prints a new pairing
//! link for every line read from standard input. Each message sent to a chat starts a turn that
//! reads a file, asks permission to run the tests, and finishes once that is answered.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::print_stdout)]

use std::{
    collections::HashMap,
    io::BufRead,
    sync::{Arc, Mutex},
    time::Duration,
};

use aura_protocol::{
    AuraEvent, EventBatch, PermissionDecision, PermissionOption, PermissionOptionKind,
    PermissionRequest, ResolvedBy, SessionStatus, StopReason, ToolCall, ToolKind, ToolStatus,
    UiAnswer,
    session::{ChatAttach, ChatStatusUpdate, HistoryItem, HistoryPage, PromptAck},
    workspace::WorkspaceChat,
};
use aura_remote::{
    Backend, BackendError, BoxFuture, Config, Frames, Overview, RemoteAgent, Service, Statuses,
};
use serde_json::json;

struct Chat {
    title: String,
    status: SessionStatus,
    needs_attention: bool,
    events: Vec<AuraEvent>,
    updated_at: i64,
    /// The permission request the turn waits on, and what wakes it.
    waiting: Option<(String, Arc<tokio::sync::Notify>)>,
    stop: Arc<tokio::sync::Notify>,
    turns: u32,
}

#[derive(Default)]
struct Demo {
    chats: Mutex<Vec<(String, Chat)>>,
    frames: Mutex<HashMap<String, (String, Frames)>>,
    statuses: Mutex<HashMap<String, Statuses>>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

impl Demo {
    fn summary(id: &str, chat: &Chat) -> WorkspaceChat {
        serde_json::from_value(json!({
            "chat": {
                "id": id, "title": chat.title, "agent_id": "demo", "agent_host": { "type": "native" },
                "agent_name": "Demo agent", "folder": "/demo", "folder_state": "ok",
                "status": chat.status, "needs_attention": chat.needs_attention,
                "created_at": 0, "updated_at": chat.updated_at,
            },
            "project_id": "p1", "folder_id": "f1", "pinned": false, "archived": false,
        }))
        .expect("chat")
    }

    /// Records events in a chat and sends them to whoever follows it.
    fn emit(&self, chat_id: &str, events: Vec<AuraEvent>) {
        let seq_start = {
            let mut chats = self.chats.lock().unwrap();
            let Some((_, chat)) = chats.iter_mut().find(|(id, _)| id == chat_id) else {
                return;
            };
            let start = chat.events.len() as u32;
            chat.events.extend(events.iter().cloned());
            chat.updated_at = now();
            start
        };
        let batch = EventBatch {
            chat_id: chat_id.to_owned(),
            seq_start,
            events,
        };
        self.frames
            .lock()
            .unwrap()
            .retain(|_, (following, frames)| following != chat_id || frames(&batch));
    }

    fn status(&self, chat_id: &str, status: SessionStatus, needs_attention: bool) {
        let update = {
            let mut chats = self.chats.lock().unwrap();
            let Some((_, chat)) = chats.iter_mut().find(|(id, _)| id == chat_id) else {
                return;
            };
            chat.status = status;
            chat.needs_attention = needs_attention;
            chat.updated_at = now();
            ChatStatusUpdate {
                chat_id: chat_id.to_owned(),
                status,
                needs_attention,
                title: Some(chat.title.clone()),
                updated_at: chat.updated_at,
            }
        };
        self.statuses
            .lock()
            .unwrap()
            .retain(|_, statuses| statuses(&update));
    }

    /// One scripted turn: read a file, ask to run the tests, finish when that is answered.
    async fn turn(self: Arc<Self>, chat_id: String, text: String) {
        let (turn, stop) = {
            let mut chats = self.chats.lock().unwrap();
            let (_, chat) = chats.iter_mut().find(|(id, _)| *id == chat_id).unwrap();
            chat.turns += 1;
            (format!("{chat_id}-t{}", chat.turns), chat.stop.clone())
        };
        let request = format!("{turn}-p");
        let asked = Arc::new(tokio::sync::Notify::new());
        self.status(&chat_id, SessionStatus::Running, false);
        self.emit(
            &chat_id,
            vec![
                AuraEvent::TurnStarted {
                    turn_id: turn.clone(),
                    prompt_id: None,
                },
                AuraEvent::UserMessageDelta {
                    message_id: format!("{turn}.u"),
                    text,
                },
            ],
        );
        let work = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            self.emit(
                &chat_id,
                vec![
                    AuraEvent::MessageDelta {
                        message_id: format!("{turn}.m1"),
                        text: "I'll look at the **login form** first.".into(),
                    },
                    AuraEvent::ToolCall(ToolCall {
                        tool_call_id: format!("{turn}.x1"),
                        kind: ToolKind::Read,
                        title: "Read src/login.ts".into(),
                        status: ToolStatus::Completed,
                        locations: vec![],
                        raw_input: None,
                        tool_name: Some("Read".into()),
                        content: vec![],
                        truncated: None,
                    }),
                ],
            );
            tokio::time::sleep(Duration::from_millis(300)).await;
            self.chats
                .lock()
                .unwrap()
                .iter_mut()
                .find(|(id, _)| *id == chat_id)
                .unwrap()
                .1
                .waiting = Some((request.clone(), asked.clone()));
            self.emit(
                &chat_id,
                vec![AuraEvent::PermissionRequested(PermissionRequest {
                    request_id: request.clone(),
                    tool_call_id: None,
                    title: "Run `npm test`".into(),
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
                })],
            );
            self.status(&chat_id, SessionStatus::Running, true);
            asked.notified().await;
            self.status(&chat_id, SessionStatus::Running, false);
            tokio::time::sleep(Duration::from_millis(300)).await;
            self.emit(
                &chat_id,
                vec![AuraEvent::MessageDelta {
                    message_id: format!("{turn}.m2"),
                    text: "Done. The form now checks the email before it submits:\n\n- an empty address is refused\n- `a@b` is accepted\n\n```ts\nif (!email.includes(\"@\")) return;\n```".into(),
                }],
            );
            StopReason::EndTurn
        };
        let stop_reason = tokio::select! {
            reason = work => reason,
            () = stop.notified() => StopReason::Cancelled,
        };
        // A turn that ends takes its unanswered request with it.
        let open = self
            .chats
            .lock()
            .unwrap()
            .iter_mut()
            .find(|(id, _)| *id == chat_id)
            .and_then(|(_, chat)| chat.waiting.take());
        let mut last = Vec::new();
        if let Some((request_id, _)) = open {
            last.push(AuraEvent::PermissionResolved {
                request_id,
                decision: PermissionDecision::Cancelled,
                by: ResolvedBy::Turn,
            });
        }
        last.push(AuraEvent::TurnEnded {
            turn_id: turn,
            stop_reason,
            usage: None,
            duration_ms: Some(900),
            recovered: false,
        });
        self.emit(&chat_id, last);
        self.status(&chat_id, SessionStatus::Ready, false);
    }
}

fn missing() -> BackendError {
    BackendError::new("not_found", "That chat is no longer here.")
}

/// The backend the service drives. It holds the demo behind an `Arc` so a turn can outlive a call.
struct Shared(Arc<Demo>);

impl Backend for Shared {
    fn overview(&self) -> BoxFuture<'_, Result<Overview, BackendError>> {
        Box::pin(async move {
            let mut chats: Vec<WorkspaceChat> = self
                .0
                .chats
                .lock()
                .unwrap()
                .iter()
                .map(|(id, chat)| Demo::summary(id, chat))
                .collect();
            chats.sort_by_key(|entry| std::cmp::Reverse(entry.chat.updated_at));
            Ok(Overview {
                host_name: "Demo computer".into(),
                projects: vec![
                    serde_json::from_value(json!({
                        "id": "p1", "name": "demo", "color": null, "default_agent": "demo",
                        "default_model": null, "created_at": 0, "updated_at": 0,
                        "folders": [{
                            "id": "f1", "project_id": "p1", "display_name": "demo", "path": "/demo",
                            "folder_state": "ok", "unavailable_reason": null, "kind": "git",
                            "git_remote_url": null, "git_default_branch": "main",
                        }],
                    }))
                    .expect("project"),
                ],
                chats,
                agents: vec![RemoteAgent {
                    id: "demo".into(),
                    name: "Demo agent".into(),
                    available: true,
                }],
                default_agent: Some("demo".into()),
            })
        })
    }

    fn watch(&self, owner: &str, statuses: Statuses) -> Result<(), BackendError> {
        self.0
            .statuses
            .lock()
            .unwrap()
            .insert(owner.into(), statuses);
        Ok(())
    }

    fn attach<'a>(
        &'a self,
        chat_id: &'a str,
        owner: &'a str,
        frames: Frames,
    ) -> BoxFuture<'a, Result<ChatAttach, BackendError>> {
        Box::pin(async move {
            let chats = self.0.chats.lock().unwrap();
            let (id, chat) = chats
                .iter()
                .find(|(id, _)| id == chat_id)
                .ok_or_else(missing)?;
            self.0
                .frames
                .lock()
                .unwrap()
                .insert(owner.into(), (chat_id.into(), frames));
            let items: Vec<HistoryItem> = chat
                .events
                .iter()
                .enumerate()
                .map(|(seq, event)| HistoryItem {
                    seq: seq as u32,
                    turn_id: None,
                    at: 0,
                    event: event.clone(),
                })
                .collect();
            Ok(serde_json::from_value(json!({
                "subscription_id": owner,
                "next_seq": items.len(),
                "snapshot": {
                    "chat": Demo::summary(id, chat).chat,
                    "session": aura_protocol::SessionInfo { status: chat.status, ..Default::default() },
                    "queue": [], "open_turn_id": null, "usage": null, "limits": null,
                    "last_error": null, "auth": null,
                    "storage": aura_protocol::session::StorageStatus::default(),
                },
                "history": HistoryPage {
                    chat_id: chat_id.into(),
                    items,
                    has_more: false,
                    before_seq: None,
                    cut_turn_id: None,
                    unsaved_from: None,
                    skipped: 0,
                    turn_agents: vec![],
                },
            }))
            .expect("attach"))
        })
    }

    fn release(&self, owner: &str) {
        self.0.frames.lock().unwrap().remove(owner);
        self.0.statuses.lock().unwrap().remove(owner);
    }

    fn history<'a>(
        &'a self,
        chat_id: &'a str,
        before_seq: u32,
    ) -> BoxFuture<'a, Result<HistoryPage, BackendError>> {
        Box::pin(async move {
            let chats = self.0.chats.lock().unwrap();
            let (_, chat) = chats
                .iter()
                .find(|(id, _)| id == chat_id)
                .ok_or_else(missing)?;
            Ok(HistoryPage {
                chat_id: chat_id.into(),
                items: chat
                    .events
                    .iter()
                    .enumerate()
                    .filter(|(seq, _)| (*seq as u32) < before_seq)
                    .map(|(seq, event)| HistoryItem {
                        seq: seq as u32,
                        turn_id: None,
                        at: 0,
                        event: event.clone(),
                    })
                    .collect(),
                has_more: false,
                before_seq: None,
                cut_turn_id: None,
                unsaved_from: None,
                skipped: 0,
                turn_agents: vec![],
            })
        })
    }

    fn send<'a>(
        &'a self,
        chat_id: &'a str,
        text: String,
    ) -> BoxFuture<'a, Result<PromptAck, BackendError>> {
        Box::pin(async move {
            let busy = {
                let chats = self.0.chats.lock().unwrap();
                let (_, chat) = chats
                    .iter()
                    .find(|(id, _)| id == chat_id)
                    .ok_or_else(missing)?;
                chat.status == SessionStatus::Running
            };
            if busy {
                return Err(BackendError::new(
                    "queue_full",
                    "The demo agent takes one message at a time.",
                ));
            }
            tokio::spawn(self.0.clone().turn(chat_id.to_owned(), text));
            Ok(PromptAck {
                prompt_id: "prompt".into(),
                queued: false,
            })
        })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            let chats = self.0.chats.lock().unwrap();
            let (_, chat) = chats
                .iter()
                .find(|(id, _)| id == chat_id)
                .ok_or_else(missing)?;
            chat.stop.notify_one();
            Ok(())
        })
    }

    fn permission<'a>(
        &'a self,
        chat_id: &'a str,
        request_id: &'a str,
        option_id: Option<String>,
    ) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            let asked = {
                let mut chats = self.0.chats.lock().unwrap();
                let (_, chat) = chats
                    .iter_mut()
                    .find(|(id, _)| id == chat_id)
                    .ok_or_else(missing)?;
                match chat.waiting.take() {
                    Some((id, asked)) if id == request_id => asked,
                    other => {
                        chat.waiting = other;
                        return Err(BackendError::new(
                            "request_not_pending",
                            "That request is not waiting any more.",
                        ));
                    }
                }
            };
            self.0.emit(
                chat_id,
                vec![AuraEvent::PermissionResolved {
                    request_id: request_id.to_owned(),
                    decision: match option_id {
                        Some(option_id) => PermissionDecision::Selected { option_id },
                        None => PermissionDecision::Cancelled,
                    },
                    by: ResolvedBy::User,
                }],
            );
            asked.notify_one();
            Ok(())
        })
    }

    fn answer<'a>(
        &'a self,
        _chat_id: &'a str,
        _request_id: &'a str,
        _answer: Option<UiAnswer>,
    ) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            Err(BackendError::new(
                "request_not_pending",
                "That request is not waiting any more.",
            ))
        })
    }

    fn create<'a>(
        &'a self,
        folder_id: &'a str,
        _agent_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<WorkspaceChat, BackendError>> {
        Box::pin(async move {
            if folder_id != "f1" {
                return Err(BackendError::new(
                    "invalid",
                    "That folder is no longer here.",
                ));
            }
            let mut chats = self.0.chats.lock().unwrap();
            let id = format!("c{}", chats.len() + 1);
            chats.push((id.clone(), chat("New chat")));
            Ok(Demo::summary(&id, &chats.last().unwrap().1))
        })
    }
}

fn chat(title: &str) -> Chat {
    Chat {
        title: title.into(),
        status: SessionStatus::Stopped,
        needs_attention: false,
        events: Vec::new(),
        updated_at: now(),
        waiting: None,
        stop: Arc::new(tokio::sync::Notify::new()),
        turns: 0,
    }
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let (relay, site, folder) = (
        args.next().expect("the relay's ws:// origin"),
        args.next().expect("the site's origin"),
        args.next().expect("a folder for remote.json"),
    );
    std::fs::create_dir_all(&folder).expect("folder");
    let demo = Arc::new(Demo::default());
    {
        let mut first = chat("Fix the login form");
        first.status = SessionStatus::Ready;
        first.events = vec![
            AuraEvent::TurnStarted {
                turn_id: "c1-t0".into(),
                prompt_id: None,
            },
            AuraEvent::UserMessageDelta {
                message_id: "c1-t0.u".into(),
                text: "Why does the login form submit empty emails?".into(),
            },
            AuraEvent::MessageDelta {
                message_id: "c1-t0.m".into(),
                text: "The submit handler never checks the field. I can add a check.".into(),
            },
            AuraEvent::TurnEnded {
                turn_id: "c1-t0".into(),
                stop_reason: StopReason::EndTurn,
                usage: None,
                duration_ms: Some(1200),
                recovered: false,
            },
        ];
        first.turns = 1;
        demo.chats.lock().unwrap().push(("c1".into(), first));
    }
    let service = Service::start(
        Config {
            path: std::path::Path::new(&folder).join("remote.json"),
            relay,
            site,
            host_name: "Demo computer".into(),
            backend: Arc::new(Shared(demo)),
            changed: Arc::new(|| {}),
        },
        &tokio::runtime::Handle::current(),
    )
    .expect("service");
    service.set_enabled(true).expect("enable");
    println!("PAIR {}", service.pair().expect("pairing").url);
    println!("BOT {}", service.create_bot("Demo bot").expect("bot").url);
    // Each line on standard input asks for a fresh pairing link; its end stops the demo.
    let lines = tokio::task::spawn_blocking(move || {
        for line in std::io::stdin().lock().lines() {
            if line.is_err() {
                break;
            }
            println!("PAIR {}", service.pair().expect("pairing").url);
        }
        service.shutdown();
    });
    let _ = lines.await;
}
