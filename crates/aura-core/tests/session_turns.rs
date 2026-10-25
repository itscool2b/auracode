//! Turns, the prompt queue, interrupts, stops and crashes, through the session manager with
//! scripted drivers on paused time.

mod support;

use std::time::Duration;

use aura_drivers::driver::{DriverError, DriverEvent, DriverExit, LoggedCommand};
use aura_drivers::testing::{CommandMatch, ScriptedDriver, Step};
use aura_process::ExitInfo;
use aura_process::testing::FakeCall;
use aura_protocol::session::{AuthCommand, AuthPrompt};
use aura_protocol::{
    AuraEvent, ErrorKind, NoticeLevel, PermissionDecision, PromptPart, ResolvedBy, SessionStatus,
    StopReason, ToolCall, ToolKind, ToolStatus, ToolUpdate,
};
use support::*;

fn end_turn(stop_reason: StopReason) -> Step {
    Step::EndTurn {
        stop_reason,
        usage: None,
        error: None,
    }
}

fn prompt_text(command: &LoggedCommand) -> String {
    match command {
        LoggedCommand::Prompt { parts, .. } => match parts.as_slice() {
            [PromptPart::Text { text }] => text.clone(),
            other => panic!("one text part, got {other:?}"),
        },
        other => panic!("a prompt, got {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn a_turn_streams_to_views_and_is_stored() {
    let (driver, _handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(message("m1", "Hello ")),
        in_turn(message("m1", "world")),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let sink = Sink::new("main");
    let attach = h
        .manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    assert_eq!(attach.snapshot.session.status, SessionStatus::Ready);
    let ack = h
        .manager
        .send(&chat.id, "Hi there".into())
        .await
        .expect("send");
    assert!(!ack.queued);
    sink.wait_for("the turn ends", |event| {
        matches!(event, AuraEvent::TurnEnded { .. })
    })
    .await;
    let stored = h.stored(&chat.id).await;
    assert_eq!(
        kinds(&stored),
        [
            "turn_started",
            "user_message_delta",
            "message_delta",
            "message_completed",
            "turn_ended"
        ]
    );
    assert_eq!(stored[2], message("m1", "Hello world"));
    let live: Vec<u32> = sink.events().iter().map(|(seq, _)| *seq).collect();
    assert!(
        live.windows(2).all(|pair| pair[1] == pair[0] + 1),
        "frames never skip a seq: {live:?}"
    );
    assert!(live.first().is_some_and(|first| *first >= attach.next_seq));
}

/// S15: prompts typed during a turn queue up and run in order after a normal end.
#[tokio::test(start_paused = true)]
async fn queue_runs_prompts_in_order_after_a_normal_end() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Wait(Duration::from_secs(1)),
        end_turn(StopReason::EndTurn),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    assert!(
        !h.manager
            .send(&chat.id, "first".into())
            .await
            .expect("send")
            .queued
    );
    assert!(
        h.manager
            .send(&chat.id, "second".into())
            .await
            .expect("send")
            .queued
    );
    assert!(
        h.manager
            .send(&chat.id, "third".into())
            .await
            .expect("send")
            .queued
    );
    let texts = [
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
    ];
    assert_eq!(texts, ["first", "second", "third"]);
    h.status(&chat.id, SessionStatus::Ready).await;
    assert!(h.queue(&chat.id).await.is_empty());
}

/// S15 and A12: an interrupt holds the rows queued before it, even when the agent's `end_turn`
/// races the cancel; a prompt typed after the interrupt is sent when that turn ends.
#[tokio::test(start_paused = true)]
async fn interrupt_racing_end_turn_holds_queue() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Expect(CommandMatch::Interrupt),
        Step::Wait(Duration::from_secs(1)),
        // The agent finished first and says so.
        end_turn(StopReason::EndTurn),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    let before = h
        .manager
        .send(&chat.id, "queued before the stop".into())
        .await
        .expect("send");
    command(&handle, CommandMatch::Prompt).await;
    h.manager.interrupt(&chat.id).await.expect("interrupt");
    let after = h
        .manager
        .send(&chat.id, "typed after the stop".into())
        .await
        .expect("send");
    assert!(after.queued, "the turn is still being cancelled");
    let next = command(&handle, CommandMatch::Prompt).await;
    assert_eq!(prompt_text(&next), "typed after the stop");
    h.status(&chat.id, SessionStatus::Ready).await;
    let rows = h.queue(&chat.id).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].prompt_id, before.prompt_id);
    assert!(rows[0].held, "queued before the stop: held");
    let stored = h.stored(&chat.id).await;
    let first_end = stored
        .iter()
        .find_map(|event| match event {
            AuraEvent::TurnEnded { stop_reason, .. } => Some(*stop_reason),
            _ => None,
        })
        .expect("the first turn ended");
    assert_eq!(
        first_end,
        StopReason::EndTurn,
        "the agent's own reason is shown"
    );
    // Send queued releases the held row.
    h.manager.resume_queue(&chat.id).await.expect("resume");
    assert_eq!(
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        "queued before the stop"
    );
}

/// S15: a turn that ends in an error with no stop from the user holds the queue.
#[tokio::test(start_paused = true)]
async fn queue_is_held_after_an_agent_error() {
    let (driver, _handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Wait(Duration::from_secs(1)),
        Step::EndTurn {
            stop_reason: StopReason::Error,
            usage: None,
            error: Some(DriverError {
                kind: ErrorKind::AgentError,
                message: "The model is overloaded.".into(),
                detail: None,
            }),
        },
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    h.manager.send(&chat.id, "next".into()).await.expect("send");
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    sink.wait_for("the error card", |event| {
        matches!(event, AuraEvent::Error { .. })
    })
    .await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let rows = h.queue(&chat.id).await;
    assert_eq!(rows.len(), 1);
    assert!(rows[0].held);
    let stored = h.stored(&chat.id).await;
    assert!(stored.iter().any(|event| matches!(
        event,
        AuraEvent::Error { kind: ErrorKind::AgentError, message, .. } if message == "The model is overloaded."
    )));
}

/// S15: queued prompts can be removed; an unknown id is not pending.
#[tokio::test(start_paused = true)]
async fn queue_rows_can_be_removed() {
    let (driver, _handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Hang,
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    let queued = h
        .manager
        .send(&chat.id, "later".into())
        .await
        .expect("send");
    h.manager
        .cancel_queued(&chat.id, &queued.prompt_id)
        .await
        .expect("remove");
    assert!(h.queue(&chat.id).await.is_empty());
    assert!(matches!(
        h.manager.cancel_queued(&chat.id, &queued.prompt_id).await,
        Err(aura_core::session::SessionError::RequestNotPending)
    ));
}

/// S16: empty, oversized and over-queued prompts are refused.
#[tokio::test(start_paused = true)]
async fn send_validation() {
    let (driver, _handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Hang,
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    assert!(matches!(
        h.manager.send(&chat.id, " \n\t ".into()).await,
        Err(aura_core::session::SessionError::PromptEmpty)
    ));
    let huge = "x".repeat(1024 * 1024 + 1);
    assert!(matches!(
        h.manager.send(&chat.id, huge).await,
        Err(aura_core::session::SessionError::PromptTooLarge {
            bytes: 1_048_577,
            limit: 1_048_576
        })
    ));
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    for i in 0..20 {
        assert!(
            h.manager
                .send(&chat.id, format!("queued {i}"))
                .await
                .expect("send")
                .queued
        );
    }
    assert!(matches!(
        h.manager.send(&chat.id, "one too many".into()).await,
        Err(aura_core::session::SessionError::QueueFull(20))
    ));
    // The text itself is sent exactly as typed.
    assert!(matches!(
        h.manager.send("no-such-chat", "hi".into()).await,
        Err(aura_core::session::SessionError::ChatNotFound(_))
    ));
}

/// S17: a prompt to a stopped chat starts the agent and goes out at `Ready`, not held.
#[tokio::test(start_paused = true)]
async fn send_starts_agent() {
    let (first, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let (second, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.stop(&chat.id).await.expect("stop");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let ack = h
        .manager
        .send(&chat.id, "wake up".into())
        .await
        .expect("send");
    assert!(ack.queued);
    assert_eq!(
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        "wake up"
    );
    h.status(&chat.id, SessionStatus::Ready).await;
    assert_eq!(
        h.factory.setups()[1].resume.as_deref(),
        Some("n1"),
        "native resume"
    );
}

/// S39: a prompt typed while the agent stops is queued, not held, and starts the agent again
/// once it stopped.
#[tokio::test(start_paused = true)]
async fn send_while_stopping_restarts() {
    let (first, first_handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Shutdown),
        Step::Wait(Duration::from_secs(2)),
        Step::Exit(DriverExit::Closed),
    ]);
    let (second, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.stop(&chat.id).await.expect("stop");
    command(&first_handle, CommandMatch::Shutdown).await;
    h.status(&chat.id, SessionStatus::Stopping).await;
    let ack = h
        .manager
        .send(&chat.id, "after the stop".into())
        .await
        .expect("send");
    assert!(ack.queued);
    assert_eq!(
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        "after the stop"
    );
}

/// S15: a crash holds the queue, and a prompt typed after the crash goes out at the next `Ready`.
#[tokio::test(start_paused = true)]
async fn queue_is_held_after_a_crash_and_new_prompts_go_first() {
    let (first, first_handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Wait(Duration::from_secs(1)),
        Step::Exit(DriverExit::Crashed {
            exit: None,
            stderr_tail: String::new(),
        }),
    ]);
    let (second, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    let held = h
        .manager
        .send(&chat.id, "queued before the crash".into())
        .await
        .expect("send");
    command(&first_handle, CommandMatch::Prompt).await;
    h.status(&chat.id, SessionStatus::Stopped).await;
    h.manager
        .send(&chat.id, "typed after the crash".into())
        .await
        .expect("send");
    assert_eq!(
        prompt_text(&command(&handle, CommandMatch::Prompt).await),
        "typed after the crash"
    );
    let rows = h.queue(&chat.id).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].prompt_id, held.prompt_id);
    assert!(rows[0].held);
}

/// P10: a crash mid-turn force-stops the processes, shows the error with the stderr tail, ends
/// the turn with `Error`, resolves its card `System`, holds the queue, and Retry resumes.
#[tokio::test(start_paused = true)]
async fn crash_mid_turn() {
    let (first, _) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(message("m1", "Working on it")),
        Step::EmitInTurn(DriverEvent::Permission {
            turn: None,
            request: permission("p1", Some(ToolKind::Execute)),
        }),
        Step::Wait(Duration::from_millis(10)),
        Step::Exit(DriverExit::Crashed {
            exit: Some(ExitInfo {
                code: Some(3),
                signal: None,
                at_ms: 0,
            }),
            stderr_tail: "thread main panicked: boom\n".into(),
        }),
    ]);
    let (second, _) = ScriptedDriver::new(vec![Step::Spawn(launch()), ready_step("n1")]);
    let options = Options {
        agents: vec![aura_agents::FixedAgent::new(
            mock_spec(),
            ready(),
            Some(launch()),
        )],
        ..Options::default()
    };
    let h = Harness::with(vec![first, second], options);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    // The scripted agent reports no autonomy state, so every request is asked and the card stays open.
    h.manager
        .send(&chat.id, "do it".into())
        .await
        .expect("send");
    h.manager
        .send(&chat.id, "and then this".into())
        .await
        .expect("send");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let controls = h.spawner.controls();
    assert!(
        controls[0]
            .calls()
            .contains(&FakeCall::Shutdown(aura_process::ShutdownPlan::FORCE))
            || controls[0].was_killed(),
        "{:?}",
        controls[0].calls()
    );
    let stored = h.stored(&chat.id).await;
    let tail: Vec<&AuraEvent> = stored.iter().rev().take(4).collect();
    assert!(
        matches!(
            tail[0],
            AuraEvent::TurnEnded {
                stop_reason: StopReason::Error,
                ..
            }
        ),
        "{tail:?}"
    );
    assert!(stored.iter().any(|event| matches!(
        event,
        AuraEvent::Error { kind: ErrorKind::AgentExited, message, detail: Some(detail), .. }
            if message == "The agent stopped unexpectedly (exit code 3)." && detail.contains("boom")
    )));
    assert!(stored.iter().any(|event| matches!(
        event,
        AuraEvent::PermissionResolved { request_id, decision: PermissionDecision::Cancelled, by: ResolvedBy::System } if request_id == "p1"
    )));
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("other"))
        .await
        .expect("attach");
    assert!(attach.snapshot.queue.iter().all(|row| row.held));
    assert_eq!(attach.snapshot.queue.len(), 1);
    assert_eq!(
        attach.snapshot.last_error.map(|error| error.kind),
        Some(ErrorKind::AgentExited)
    );
    // Retry resumes the native session.
    h.manager.start(&chat.id, false).await.expect("retry");
    h.status(&chat.id, SessionStatus::Ready).await;
    assert_eq!(h.factory.setups()[1].resume.as_deref(), Some("n1"));
}

/// P47 and S23: a driver task that panics mid-turn: every recorded process is force-stopped, an
/// error card, `Stopped`.
#[tokio::test(start_paused = true)]
async fn driver_panic_kills_processes() {
    let (driver, _) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(message("m1", "about to fail")),
        // The interrupt below does not match: the driver task panics.
        Step::Expect(CommandMatch::Shutdown),
    ]);
    let options = Options {
        agents: vec![aura_agents::FixedAgent::new(
            mock_spec(),
            ready(),
            Some(launch()),
        )],
        ..Options::default()
    };
    let h = Harness::with(vec![driver], options);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    h.status(&chat.id, SessionStatus::Running).await;
    h.manager.interrupt(&chat.id).await.expect("interrupt");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let control = &h.spawner.controls()[0];
    eventually("the process is force-stopped", || {
        control
            .calls()
            .contains(&FakeCall::Shutdown(aura_process::ShutdownPlan::FORCE))
    })
    .await;
    let stored = h.stored(&chat.id).await;
    assert!(stored.iter().any(|event| matches!(
        event,
        AuraEvent::Error { kind: ErrorKind::AgentExited, message, .. } if message.contains("driver for it failed")
    )));
    assert!(matches!(
        stored.last(),
        Some(AuraEvent::TurnEnded {
            stop_reason: StopReason::Error,
            ..
        })
    ));
}

/// S30: secrets in a crash's stderr tail are redacted before the error is stored or shown.
#[tokio::test(start_paused = true)]
async fn stderr_tail_redacted_before_persist() {
    let secret = "sk-proj-secret-literal-123456";
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Exit(DriverExit::Crashed {
            exit: Some(ExitInfo {
                code: Some(1),
                signal: None,
                at_ms: 0,
            }),
            stderr_tail: format!("Error: invalid key {secret}\n"),
        }),
    ]);
    let h = Harness::new(vec![driver]);
    h.redactor.set_secrets(vec![secret.into()]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let detail = h
        .stored(&chat.id)
        .await
        .into_iter()
        .find_map(|event| match event {
            AuraEvent::Error { detail, .. } => detail,
            _ => None,
        })
        .expect("an error with the tail");
    assert!(detail.contains("<SECRET>"), "{detail}");
    assert!(!detail.contains(secret));
    assert!(
        !sink
            .events()
            .iter()
            .any(|(_, event)| serde_json::to_string(event).expect("json").contains(secret))
    );
}

/// A18: a sign-in error mid-turn ends the turn with an error, puts the prompt back in the queue
/// held, stops the process and shows the auth card; Retry starts exactly one process and resends
/// the prompt.
#[tokio::test(start_paused = true)]
async fn auth_mid_turn_stops_process_then_retry_resends() {
    let auth = AuthPrompt {
        message:
            "Demo needs you to sign in. Run the command below in a terminal, then press Retry."
                .into(),
        commands: vec![AuthCommand {
            label: "Sign in".into(),
            argv: vec!["demo".into(), "login".into()],
            env: Vec::new(),
        }],
    };
    let (first, first_handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Emit(DriverEvent::AuthRequired(auth.clone())),
        Step::EndTurn {
            stop_reason: StopReason::Error,
            usage: None,
            error: Some(DriverError {
                kind: ErrorKind::AuthRequired,
                message: "Authentication required".into(),
                detail: None,
            }),
        },
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let (second, second_handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let options = Options {
        agents: vec![aura_agents::FixedAgent::new(
            mock_spec(),
            ready(),
            Some(launch()),
        )],
        ..Options::default()
    };
    let h = Harness::with(vec![first, second], options);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let ack = h
        .manager
        .send(&chat.id, "hello".into())
        .await
        .expect("send");
    h.status(&chat.id, SessionStatus::AuthRequired).await;
    assert_eq!(
        first_handle.commands().last(),
        Some(&LoggedCommand::Shutdown)
    );
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("main"))
        .await
        .expect("attach");
    assert_eq!(attach.snapshot.auth, Some(auth));
    assert_eq!(attach.snapshot.queue.len(), 1);
    assert_eq!(
        attach.snapshot.queue[0].prompt_id, ack.prompt_id,
        "the same prompt"
    );
    assert!(attach.snapshot.queue[0].held);
    assert_eq!(h.spawner.controls().len(), 1);
    h.manager.resume_queue(&chat.id).await.expect("retry");
    assert_eq!(
        prompt_text(&command(&second_handle, CommandMatch::Prompt).await),
        "hello"
    );
    assert_eq!(h.spawner.controls().len(), 2, "exactly one more process");
    assert_eq!(h.factory.setups()[1].resume.as_deref(), Some("n1"));
    h.status(&chat.id, SessionStatus::Ready).await;
}

/// S27: the first line titles a chat; the agent's title replaces it.
#[tokio::test(start_paused = true)]
async fn titles() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
        Step::Emit(DriverEvent::Title(Some("Fixing the login flow".into()))),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    assert_eq!(chat.title, None);
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(
            &chat.id,
            "\n  Please fix the login bug  \nIt fails on Safari.".into(),
        )
        .await
        .expect("send");
    let statuses = h.statuses.clone();
    let id = chat.id.clone();
    eventually("the agent's title replaces the first line", || {
        statuses
            .last(&id)
            .and_then(|update| update.title)
            .as_deref()
            == Some("Fixing the login flow")
    })
    .await;
    let titles: Vec<Option<String>> = h
        .statuses
        .all(&chat.id)
        .into_iter()
        .map(|update| update.title)
        .collect();
    let first = titles
        .iter()
        .position(|title| title.as_deref() == Some("Please fix the login bug"));
    let agent = titles
        .iter()
        .position(|title| title.as_deref() == Some("Fixing the login flow"));
    assert!(first.is_some() && first < agent, "{titles:?}");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "another prompt".into())
        .await
        .expect("send");
    h.status(&chat.id, SessionStatus::Ready).await;
    let chats = h.manager.chats().await.expect("chats");
    assert_eq!(chats[0].title.as_deref(), Some("Fixing the login flow"));
}

/// S26: near the end of the seq space, new turns are refused with a message.
#[tokio::test(start_paused = true)]
async fn seq_limit() {
    let h = Harness::new(Vec::new());
    let record = h
        .store
        .create_chat(aura_core::chatstore::NewChat {
            agent_id: MOCK.into(),
            folder: h.folder.clone(),
            device_id: "device".into(),
            now: 1,
        })
        .await
        .expect("chat");
    let conn = rusqlite::Connection::open(h.profile.db_path()).expect("raw");
    conn.busy_timeout(Duration::from_secs(5)).expect("busy");
    conn.execute(
        "INSERT INTO events (id, chat_id, seq, kind, payload, created_at, device_id) \
         VALUES ('e', ?1, ?2, 'notice', '{\"type\":\"notice\",\"level\":\"info\",\"message\":\"old\"}', 1, 'd')",
        rusqlite::params![record.id, i64::from(u32::MAX - 100)],
    )
    .expect("a row near the end");
    drop(conn);
    let result = h.manager.send(&record.id, "one more".into()).await;
    assert!(
        matches!(&result, Err(aura_core::session::SessionError::Internal(message)) if message == "This chat is too long to continue; start a new chat."),
        "{result:?}"
    );
}

/// S29: an agent silent for an hour hits no timeout anywhere.
#[tokio::test(start_paused = true)]
async fn running_turn_has_no_timeout() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Wait(Duration::from_secs(3600)),
        in_turn(message("m1", "Finally.")),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "think hard".into())
        .await
        .expect("send");
    tokio::time::sleep(Duration::from_secs(3590)).await;
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Running)
    );
    tokio::time::sleep(Duration::from_secs(20)).await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let stored = h.stored(&chat.id).await;
    assert!(matches!(
        stored.last(),
        Some(AuraEvent::TurnEnded {
            stop_reason: StopReason::EndTurn,
            ..
        })
    ));
}

/// S21: a `Ready` agent nobody views stops after 10 idle minutes, unless a card is open; the next
/// use restarts it with native resume.
#[tokio::test(start_paused = true)]
async fn idle_eviction() {
    let (first, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let (second, second_handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Emit(DriverEvent::Permission {
            turn: None,
            request: permission("bg", None),
        }),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    tokio::time::sleep(Duration::from_secs(9 * 60)).await;
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Ready)
    );
    tokio::time::sleep(Duration::from_secs(2 * 60)).await;
    h.status(&chat.id, SessionStatus::Stopped).await;
    // The next use restarts it with resume; an open card keeps it alive however long it waits.
    h.manager.send(&chat.id, "back".into()).await.expect("send");
    command(&second_handle, CommandMatch::Prompt).await;
    h.status(&chat.id, SessionStatus::Ready).await;
    assert_eq!(h.factory.setups()[1].resume.as_deref(), Some("n1"));
    tokio::time::sleep(Duration::from_secs(30 * 60)).await;
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Ready)
    );
}

/// S21: a viewer keeps an idle agent alive.
#[tokio::test(start_paused = true)]
async fn a_viewer_keeps_an_idle_agent_alive() {
    let (driver, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("main"))
        .await
        .expect("attach");
    tokio::time::sleep(Duration::from_secs(30 * 60)).await;
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Ready)
    );
    h.manager.detach(&attach.subscription_id);
    tokio::time::sleep(Duration::from_secs(11 * 60)).await;
    h.status(&chat.id, SessionStatus::Stopped).await;
}

/// A13: an agent that ignores the cancel stays `Cancelling`; the second Esc force-stops it.
#[tokio::test(start_paused = true)]
async fn ignored_cancel_then_force_stop() {
    let (driver, handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(message("m1", "counting...")),
        Step::Expect(CommandMatch::Interrupt),
        Step::Hang,
    ]);
    let options = Options {
        agents: vec![aura_agents::FixedAgent::new(
            mock_spec(),
            ready(),
            Some(launch()),
        )],
        ..Options::default()
    };
    let h = Harness::with(vec![driver], options);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "count".into())
        .await
        .expect("send");
    command(&handle, CommandMatch::Prompt).await;
    h.manager.interrupt(&chat.id).await.expect("interrupt");
    h.status(&chat.id, SessionStatus::Cancelling).await;
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Cancelling)
    );
    h.manager.interrupt(&chat.id).await.expect("the second Esc");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let control = &h.spawner.controls()[0];
    eventually("the FORCE chain ran", || {
        control
            .calls()
            .contains(&FakeCall::Shutdown(aura_process::ShutdownPlan::FORCE))
    })
    .await;
    let stored = h.stored(&chat.id).await;
    assert!(matches!(
        stored
            .iter()
            .rev()
            .find(|event| matches!(event, AuraEvent::TurnEnded { .. })),
        Some(AuraEvent::TurnEnded {
            stop_reason: StopReason::Interrupted,
            ..
        })
    ));
    assert!(stored.iter().any(|event| matches!(
        event,
        AuraEvent::Notice { level: NoticeLevel::Warning, message } if message == "Force stopped: auracode ended the agent's processes."
    )));
}

/// S33: events a force-stopped driver sends afterwards are never applied.
#[tokio::test(start_paused = true)]
async fn late_events_after_force_stop_ignored() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Expect(CommandMatch::Interrupt),
        Step::Wait(Duration::from_secs(1)),
        in_turn(message("late", "this must not show")),
        end_turn(StopReason::Cancelled),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    command(&handle, CommandMatch::Prompt).await;
    h.manager.force_stop(&chat.id).await.expect("force stop");
    h.status(&chat.id, SessionStatus::Stopped).await;
    tokio::time::sleep(Duration::from_secs(10)).await;
    let stored = h.stored(&chat.id).await;
    assert!(!stored.iter().any(
        |event| matches!(event, AuraEvent::MessageDelta { message_id, .. } if message_id == "late")
    ));
    assert_eq!(
        stored
            .iter()
            .filter(|event| matches!(event, AuraEvent::TurnEnded { .. }))
            .count(),
        1
    );
}

/// S32: Esc during a start drops the preparation (a running install is killed), reaches
/// `Stopped`, and holds the prompt that triggered the start.
#[tokio::test(start_paused = true)]
async fn interrupt_during_start() {
    let gate = aura_agents::Gate::new();
    let options = Options {
        agents: vec![
            aura_agents::FixedAgent::new(mock_spec(), ready(), None)
                .with_download(vec!["Downloading the demo adapter".into()])
                .with_launch_gate(gate.clone()),
        ],
        ..Options::default()
    };
    let h = Harness::with(Vec::new(), options);
    let chat = h.chat().await;
    gate.until_waiting(1).await;
    let ack = h
        .manager
        .send(&chat.id, "hello".into())
        .await
        .expect("send");
    assert!(ack.queued);
    h.manager.interrupt(&chat.id).await.expect("Esc");
    gate.until_waiting(0).await;
    h.status(&chat.id, SessionStatus::Stopped).await;
    let rows = h.queue(&chat.id).await;
    assert_eq!(rows.len(), 1);
    assert!(rows[0].held);
    assert!(h.factory.setups().is_empty(), "no driver ever started");
}

/// A14: updates after a prompt's reply are untagged: stored outside any turn even when the next
/// queued turn already started, and a background permission request outlives that turn.
#[tokio::test(start_paused = true)]
async fn late_events_are_untagged() {
    let tool = ToolCall {
        tool_call_id: "tool-1".into(),
        kind: ToolKind::Execute,
        title: "Run the build".into(),
        status: ToolStatus::InProgress,
        locations: Vec::new(),
        raw_input: None,
        tool_name: None,
        content: Vec::new(),
        truncated: None,
    };
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Wait(Duration::from_secs(1)),
        in_turn(AuraEvent::ToolCall(tool)),
        end_turn(StopReason::EndTurn),
        Step::Emit(DriverEvent::Event {
            turn: None,
            event: AuraEvent::ToolUpdate(ToolUpdate {
                tool_call_id: "tool-1".into(),
                status: Some(ToolStatus::Completed),
                title: None,
                kind: None,
                locations: None,
                raw_input: None,
                tool_name: None,
                content: None,
                truncated: None,
            }),
        }),
        Step::Emit(DriverEvent::Permission {
            turn: None,
            request: permission("bg", Some(ToolKind::Other)),
        }),
        Step::Expect(CommandMatch::Prompt),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "first".into())
        .await
        .expect("send");
    h.manager
        .send(&chat.id, "second".into())
        .await
        .expect("send");
    command(&handle, CommandMatch::Prompt).await;
    command(&handle, CommandMatch::Prompt).await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let history = h.history(&chat.id).await;
    let update = history
        .iter()
        .find(|item| matches!(&item.event, AuraEvent::ToolUpdate(update) if update.tool_call_id == "tool-1"))
        .expect("the late update is stored");
    assert_eq!(update.turn_id, None);
    let request = history
        .iter()
        .find(|item| matches!(&item.event, AuraEvent::PermissionRequested(request) if request.request_id == "bg"))
        .expect("the background request is stored");
    assert_eq!(request.turn_id, None);
    assert!(
        !history.iter().any(|item| matches!(&item.event, AuraEvent::PermissionResolved { request_id, .. } if request_id == "bg")),
        "the background card survives the second turn's end"
    );
    let second_turn_start = history
        .iter()
        .filter(|item| matches!(item.event, AuraEvent::TurnStarted { .. }))
        .nth(1)
        .expect("a second turn")
        .seq;
    assert!(
        update.seq > second_turn_start,
        "it landed inside the second turn's span, untagged"
    );
    // The card still answers.
    h.manager
        .respond_permission(&chat.id, "bg", Some("once".into()))
        .await
        .expect("answer");
}

/// A42: an update to an earlier turn's tool applies live, stays an update after compaction, and
/// the tool reads the same before and after.
#[tokio::test(start_paused = true)]
async fn cross_turn_tool_update_compaction() {
    let call = ToolCall {
        tool_call_id: "tool-1".into(),
        kind: ToolKind::Execute,
        title: "Long build".into(),
        status: ToolStatus::InProgress,
        locations: Vec::new(),
        raw_input: None,
        tool_name: None,
        content: Vec::new(),
        truncated: None,
    };
    let done = ToolUpdate {
        tool_call_id: "tool-1".into(),
        status: Some(ToolStatus::Completed),
        title: Some("Long build (done)".into()),
        kind: None,
        locations: None,
        raw_input: None,
        tool_name: None,
        content: None,
        truncated: None,
    };
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(AuraEvent::ToolCall(call.clone())),
        end_turn(StopReason::EndTurn),
        Step::Expect(CommandMatch::Prompt),
        in_turn(AuraEvent::ToolUpdate(done.clone())),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "start the build".into())
        .await
        .expect("send");
    h.manager
        .send(&chat.id, "is it done?".into())
        .await
        .expect("send");
    sink.wait_for("the update arrives live", |event| {
        matches!(event, AuraEvent::ToolUpdate(_))
    })
    .await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let fold = |events: Vec<AuraEvent>| {
        let mut tool: Option<ToolCall> = None;
        for event in events {
            match event {
                AuraEvent::ToolCall(call) => tool = Some(call),
                AuraEvent::ToolUpdate(update) => {
                    if let Some(tool) = &mut tool {
                        if let Some(status) = update.status {
                            tool.status = status;
                        }
                        if let Some(title) = update.title {
                            tool.title = title;
                        }
                    }
                }
                _ => {}
            }
        }
        tool
    };
    let live = fold(sink.events().into_iter().map(|(_, event)| event).collect());
    let history = h.history(&chat.id).await;
    let stored_update = history
        .iter()
        .find(|item| matches!(item.event, AuraEvent::ToolUpdate(_)))
        .expect("compaction keeps it as an update");
    assert!(
        stored_update.turn_id.is_some(),
        "tagged with the second turn"
    );
    let compacted = fold(history.into_iter().map(|item| item.event).collect());
    assert_eq!(compacted, live);
    assert_eq!(
        compacted.map(|tool| tool.status),
        Some(ToolStatus::Completed)
    );
}
