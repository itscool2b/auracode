//! Permission cards, questions, options and autonomy, through the session manager with scripted
//! drivers on paused time.

mod support;

use std::time::Duration;

use aura_core::session::SessionError;
use aura_drivers::driver::{DriverError, DriverEvent, DriverExit, LoggedCommand};
use aura_drivers::testing::{CommandMatch, ScriptedDriver, Step};
use aura_protocol::session::{ConfigCategory, ConfigChoice, ConfigKind, ConfigOption, ConfigValue};
use aura_protocol::{
    AuraEvent, AutoAnswer, Autonomy, AutonomyState, ErrorKind, NoticeLevel, PermissionDecision,
    ResolvedBy, SessionStatus, StopReason, ToolKind, UiAnswer, UiPrompt, UiRequest,
};
use support::*;

fn end_turn(stop_reason: StopReason) -> Step {
    Step::EndTurn {
        stop_reason,
        usage: None,
        error: None,
    }
}

fn card(id: &str, kind: Option<ToolKind>) -> Step {
    Step::EmitInTurn(DriverEvent::Permission {
        turn: None,
        request: permission(id, kind),
    })
}

fn resolution(events: &[(u32, AuraEvent)], id: &str) -> Vec<(PermissionDecision, ResolvedBy)> {
    events
        .iter()
        .filter_map(|(_, event)| match event {
            AuraEvent::PermissionResolved {
                request_id,
                decision,
                by,
            } if request_id == id => Some((decision.clone(), *by)),
            _ => None,
        })
        .collect()
}

fn full_auto() -> AutonomyState {
    AutonomyState {
        requested: Autonomy::FullAuto,
        native_mode: Some("full_auto".into()),
        auto_answer: AutoAnswer::All,
        note: None,
    }
}

/// A9: an answer that comes after the agent withdrew the request is not pending, and nothing
/// reaches the agent.
#[tokio::test(start_paused = true)]
async fn late_answer_after_withdrawal() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("p1", Some(ToolKind::Edit)),
        Step::Wait(Duration::from_secs(1)),
        Step::Emit(DriverEvent::PermissionWithdrawn {
            request_id: "p1".into(),
        }),
        Step::Hang,
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "edit".into()).await.expect("send");
    sink.wait_for("the withdrawal", |event| {
        matches!(
            event,
            AuraEvent::PermissionResolved {
                by: ResolvedBy::Agent,
                ..
            }
        )
    })
    .await;
    assert!(matches!(
        h.manager
            .respond_permission(&chat.id, "p1", Some("once".into()))
            .await,
        Err(SessionError::RequestNotPending)
    ));
    assert!(
        !handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::RespondPermission { .. }))
    );
}

/// S38: the user's answer crossing the agent's withdrawal gives one resolution (the user's) and
/// an info notice.
#[tokio::test(start_paused = true)]
async fn answer_crossing_withdrawal() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("p1", Some(ToolKind::Edit)),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("p1".into()),
        }),
        Step::Emit(DriverEvent::PermissionWithdrawn {
            request_id: "p1".into(),
        }),
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
    h.manager.send(&chat.id, "edit".into()).await.expect("send");
    sink.wait_for("the card", |event| {
        matches!(event, AuraEvent::PermissionRequested(_))
    })
    .await;
    h.manager
        .respond_permission(&chat.id, "p1", Some("once".into()))
        .await
        .expect("answer");
    sink.wait_for("the turn ends", |event| {
        matches!(event, AuraEvent::TurnEnded { .. })
    })
    .await;
    let events = sink.events();
    assert_eq!(
        resolution(&events, "p1"),
        [(
            PermissionDecision::Selected {
                option_id: "once".into()
            },
            ResolvedBy::User
        )]
    );
    assert!(events.iter().any(|(_, event)| matches!(
        event,
        AuraEvent::Notice { level: NoticeLevel::Info, message } if message == "The agent withdrew \"May I p1?\" before your answer reached it."
    )));
}

/// A33: two requests at once are two independent cards: answering one leaves the other open.
#[tokio::test(start_paused = true)]
async fn concurrent_permissions() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("p1", Some(ToolKind::Edit)),
        card("p2", Some(ToolKind::Execute)),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("p2".into()),
        }),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("p1".into()),
        }),
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
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    let cards = sink.clone();
    eventually("both cards show", || {
        cards
            .events()
            .iter()
            .filter(|(_, event)| matches!(event, AuraEvent::PermissionRequested(_)))
            .count()
            == 2
    })
    .await;
    h.manager
        .respond_permission(&chat.id, "p2", Some("no".into()))
        .await
        .expect("answer p2");
    assert!(
        resolution(&sink.events(), "p1").is_empty(),
        "p1 is still open"
    );
    assert!(matches!(
        h.manager
            .respond_permission(&chat.id, "p1", Some("bogus".into()))
            .await,
        Err(SessionError::OptionInvalid(_))
    ));
    h.manager
        .respond_permission(&chat.id, "p1", None)
        .await
        .expect("cancel p1");
    sink.wait_for("the turn ends", |event| {
        matches!(event, AuraEvent::TurnEnded { .. })
    })
    .await;
    assert_eq!(
        handle
            .commands()
            .iter()
            .filter_map(|command| match command {
                LoggedCommand::RespondPermission {
                    request_id,
                    option_id,
                } => Some((request_id.clone(), option_id.clone())),
                _ => None,
            })
            .collect::<Vec<_>>(),
        [
            ("p2".to_owned(), Some("no".to_owned())),
            ("p1".to_owned(), None)
        ]
    );
    let events = sink.events();
    assert_eq!(
        resolution(&events, "p2"),
        [(
            PermissionDecision::Selected {
                option_id: "no".into()
            },
            ResolvedBy::User
        )]
    );
    assert_eq!(
        resolution(&events, "p1"),
        [(PermissionDecision::Cancelled, ResolvedBy::User)]
    );
}

/// S11: two views get identical frames, and the first answer to a card wins.
#[tokio::test(start_paused = true)]
async fn two_subscribers() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        in_turn(message("m1", "Shall I?")),
        card("p1", Some(ToolKind::Edit)),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("p1".into()),
        }),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let first = Sink::new("window-1");
    let second = Sink::new("window-2");
    h.manager
        .attach(&chat.id, first.clone())
        .await
        .expect("attach");
    let b = h
        .manager
        .attach(&chat.id, second.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    second
        .wait_for("the card", |event| {
            matches!(event, AuraEvent::PermissionRequested(_))
        })
        .await;
    h.manager
        .respond_permission(&chat.id, "p1", Some("once".into()))
        .await
        .expect("the first answer");
    assert!(
        matches!(
            h.manager
                .respond_permission(&chat.id, "p1", Some("no".into()))
                .await,
            Err(SessionError::RequestNotPending)
        ),
        "the second view's answer comes too late"
    );
    first
        .wait_for("the turn ends", |event| {
            matches!(event, AuraEvent::TurnEnded { .. })
        })
        .await;
    second
        .wait_for("the turn ends", |event| {
            matches!(event, AuraEvent::TurnEnded { .. })
        })
        .await;
    let from_both: Vec<(u32, AuraEvent)> = first
        .events()
        .into_iter()
        .filter(|(seq, _)| *seq >= b.next_seq)
        .collect();
    assert_eq!(
        from_both,
        second.events(),
        "identical frames once both are attached"
    );
    assert_eq!(
        resolution(&second.events(), "p1"),
        [(
            PermissionDecision::Selected {
                option_id: "once".into()
            },
            ResolvedBy::User
        )]
    );
}

/// A question that only notifies is never open, so nothing answers it; a stopped chat's autonomy
/// change that the agent refused asks before every action.
#[tokio::test(start_paused = true)]
async fn notifications_are_never_open_and_a_refused_autonomy_asks() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Emit(DriverEvent::UiRequest {
            turn: None,
            request: UiRequest {
                request_id: "n".into(),
                prompt: UiPrompt::Notify {
                    message: "FYI".into(),
                },
            },
        }),
        Step::Expect(CommandMatch::SetAutonomy),
        Step::Hang,
    ]);
    handle.set_autonomy_result(Err(DriverError {
        kind: ErrorKind::AgentError,
        message: "mode not found".into(),
        detail: None,
    }));
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    sink.wait_for("the notification", |event| {
        matches!(event, AuraEvent::UiRequest(_))
    })
    .await;
    assert!(matches!(
        h.manager.respond_ui(&chat.id, "n", None).await,
        Err(SessionError::RequestNotPending)
    ));
    assert!(
        !h.statuses
            .last(&chat.id)
            .is_some_and(|update| update.needs_attention)
    );
    let lists = h
        .manager
        .set_autonomy(&chat.id, Autonomy::FullAuto)
        .await
        .expect("autonomy");
    assert_eq!(lists.autonomy.auto_answer, AutoAnswer::Never);
    assert!(
        lists
            .autonomy
            .note
            .as_deref()
            .is_some_and(|note| note.contains("mode not found")),
        "{:?}",
        lists.autonomy.note
    );
}

/// S31: a card waiting while nobody views the chat sets `needs_attention` on the status channel.
#[tokio::test(start_paused = true)]
async fn needs_attention_on_permission() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("p1", Some(ToolKind::Delete)),
        Step::Expect(CommandMatch::RespondPermission { request_id: None }),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "clean up".into())
        .await
        .expect("send");
    let statuses = h.statuses.clone();
    let id = chat.id.clone();
    eventually("the chat needs attention", || {
        statuses
            .last(&id)
            .is_some_and(|update| update.needs_attention)
    })
    .await;
    let listed = h.manager.chats().await.expect("chats");
    assert!(listed[0].needs_attention);
    h.manager
        .respond_permission(&chat.id, "p1", Some("once".into()))
        .await
        .expect("answer");
    let statuses = h.statuses.clone();
    eventually("attention is cleared", || {
        statuses
            .last(&id)
            .is_some_and(|update| !update.needs_attention)
    })
    .await;
}

/// A36: a request before `Ready` is forwarded untagged, shows while `Starting`, and the answer
/// reaches the agent.
#[tokio::test(start_paused = true)]
async fn card_before_ready() {
    let (driver, handle) = ScriptedDriver::new(vec![
        Step::Emit(DriverEvent::Permission {
            turn: None,
            request: permission("guarded-model", Some(ToolKind::Other)),
        }),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("guarded-model".into()),
        }),
        ready_step("n1"),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    let attach = h
        .manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    let is_card = |event: &AuraEvent| matches!(event, AuraEvent::PermissionRequested(request) if request.request_id == "guarded-model");
    // The card is in the attach's page when it reached the store first, else it arrives live.
    if !attach.history.items.iter().any(|item| is_card(&item.event)) {
        sink.wait_for("the card", is_card).await;
    }
    assert_eq!(attach.snapshot.session.status, SessionStatus::Starting);
    assert_eq!(
        h.statuses.last(&chat.id).map(|update| update.status),
        Some(SessionStatus::Starting)
    );
    h.manager
        .respond_permission(&chat.id, "guarded-model", Some("once".into()))
        .await
        .expect("answer");
    h.status(&chat.id, SessionStatus::Ready).await;
    assert!(
        handle
            .commands()
            .contains(&LoggedCommand::RespondPermission {
                request_id: "guarded-model".into(),
                option_id: Some("once".into()),
            })
    );
}

/// A27: switching to Full auto answers the open cards the new state covers, at once; a question
/// (kind `other`) stays.
#[tokio::test(start_paused = true)]
async fn autonomy_switch_answers_open_cards() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("edit", Some(ToolKind::Edit)),
        card("question", Some(ToolKind::Other)),
        Step::Expect(CommandMatch::SetAutonomy),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("edit".into()),
        }),
        Step::Hang,
    ]);
    handle.set_autonomy_reply(full_auto());
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    let cards = sink.clone();
    eventually("both cards show", || {
        cards
            .events()
            .iter()
            .filter(|(_, event)| matches!(event, AuraEvent::PermissionRequested(_)))
            .count()
            == 2
    })
    .await;
    let lists = h
        .manager
        .set_autonomy(&chat.id, Autonomy::FullAuto)
        .await
        .expect("autonomy");
    assert_eq!(lists.autonomy, full_auto());
    command(
        &handle,
        CommandMatch::RespondPermission {
            request_id: Some("edit".into()),
        },
    )
    .await;
    sink.wait_for("the auto answer", |event| {
        matches!(
            event,
            AuraEvent::PermissionResolved {
                by: ResolvedBy::Auto,
                ..
            }
        )
    })
    .await;
    let events = sink.events();
    assert_eq!(
        resolution(&events, "edit"),
        [(
            PermissionDecision::Selected {
                option_id: "once".into()
            },
            ResolvedBy::Auto
        )]
    );
    assert!(
        resolution(&events, "question").is_empty(),
        "questions are never auto-answered"
    );
}

/// S19 and A37: a change of autonomy mid-turn applies to the next decision at once; under Full
/// auto, kind `other` is still asked.
#[tokio::test(start_paused = true)]
async fn autonomy_change_is_immediate() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("asked", Some(ToolKind::Execute)),
        Step::Expect(CommandMatch::SetAutonomy),
        card("auto", Some(ToolKind::Execute)),
        card("other", Some(ToolKind::Other)),
        Step::Hang,
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "go".into()).await.expect("send");
    sink.wait_for("the first card", |event| {
        matches!(event, AuraEvent::PermissionRequested(_))
    })
    .await;
    handle.set_autonomy_reply(full_auto());
    h.manager
        .set_autonomy(&chat.id, Autonomy::FullAuto)
        .await
        .expect("autonomy");
    let probe = sink.clone();
    eventually("the third card shows", || {
        probe
            .events()
            .iter()
            .filter(|(_, event)| matches!(event, AuraEvent::PermissionRequested(_)))
            .count()
            == 3
    })
    .await;
    let events = sink.events();
    assert_eq!(
        resolution(&events, "auto"),
        [(
            PermissionDecision::Selected {
                option_id: "once".into()
            },
            ResolvedBy::Auto
        )]
    );
    assert_eq!(
        resolution(&events, "asked"),
        [(
            PermissionDecision::Selected {
                option_id: "once".into()
            },
            ResolvedBy::Auto
        )],
        "answered when the state changed"
    );
    assert!(resolution(&events, "other").is_empty());
    assert!(
        handle
            .commands()
            .contains(&LoggedCommand::RespondPermission {
                request_id: "auto".into(),
                option_id: Some("once".into()),
            })
    );
}

/// The agent's own autonomy report (a mode picked by hand turns auto-answers off) applies too.
#[tokio::test(start_paused = true)]
async fn an_autonomy_report_from_the_agent_applies() {
    let (driver, _) = ScriptedDriver::new(vec![
        Step::Emit(DriverEvent::Autonomy(full_auto())),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("auto", Some(ToolKind::Read)),
        Step::Emit(DriverEvent::Autonomy(AutonomyState {
            requested: Autonomy::FullAuto,
            native_mode: Some("ask".into()),
            auto_answer: AutoAnswer::Never,
            note: Some(
                "You picked the Ask mode by hand, so auracode asks before every action.".into(),
            ),
        })),
        card("asked", Some(ToolKind::Read)),
        Step::Hang,
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "read".into()).await.expect("send");
    let probe = sink.clone();
    eventually("both cards show", || {
        probe
            .events()
            .iter()
            .filter(|(_, event)| matches!(event, AuraEvent::PermissionRequested(_)))
            .count()
            == 2
    })
    .await;
    let events = sink.events();
    assert_eq!(resolution(&events, "auto").len(), 1);
    assert!(resolution(&events, "asked").is_empty());
    let lists = h.manager.lists(&chat.id).await.expect("lists");
    assert_eq!(lists.autonomy.native_mode.as_deref(), Some("ask"));
}

/// 7.1: autonomy set while stopped is stored and applied at the next start.
#[tokio::test(start_paused = true)]
async fn autonomy_while_stopped_applies_at_the_next_start() {
    let (first, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let (second, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.stop(&chat.id).await.expect("stop");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let lists = h
        .manager
        .set_autonomy(&chat.id, Autonomy::Ask)
        .await
        .expect("autonomy");
    assert_eq!(lists.autonomy.requested, Autonomy::Ask);
    assert_eq!(
        lists.autonomy.note.as_deref(),
        Some("Applies when the agent starts.")
    );
    assert_eq!(lists.autonomy.auto_answer, AutoAnswer::Never);
    h.manager.start(&chat.id, false).await.expect("start");
    h.status(&chat.id, SessionStatus::Ready).await;
    assert_eq!(h.factory.setups()[1].autonomy, Autonomy::Ask);
}

fn model_option() -> ConfigOption {
    ConfigOption {
        id: "model".into(),
        name: "Model".into(),
        description: None,
        category: ConfigCategory::Model,
        kind: ConfigKind::Select {
            current: "fast".into(),
            choices: vec![
                ConfigChoice {
                    value: "fast".into(),
                    name: "Fast".into(),
                    description: None,
                    group: None,
                },
                ConfigChoice {
                    value: "smart".into(),
                    name: "Smart".into(),
                    description: None,
                    group: None,
                },
            ],
        },
        pending: None,
    }
}

/// S18: an option change during a turn is sent at once; the choice is remembered for the next
/// start; invalid values and an agent's refusal read as `OptionInvalid`.
#[tokio::test(start_paused = true)]
async fn option_change_during_turn() {
    let (first, handle) = ScriptedDriver::new(vec![
        Step::Emit(DriverEvent::Options(vec![model_option()])),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Expect(CommandMatch::SetOption),
        Step::Expect(CommandMatch::SetOption),
        end_turn(StopReason::EndTurn),
    ]);
    let (second, _) = ScriptedDriver::new(vec![ready_step("n1")]);
    let h = Harness::new(vec![first, second]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let lists = h.manager.lists(&chat.id).await.expect("lists");
    assert_eq!(lists.options, [model_option()]);
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("main"))
        .await
        .expect("attach");
    assert_eq!(attach.snapshot.session.model.as_deref(), Some("Fast"));
    h.manager.send(&chat.id, "work".into()).await.expect("send");
    h.status(&chat.id, SessionStatus::Running).await;
    let smart = ConfigValue::Choice {
        value: "smart".into(),
    };
    h.manager
        .set_option(&chat.id, "model", smart.clone())
        .await
        .expect("set during the turn");
    assert!(matches!(
        h.manager
            .set_option(
                &chat.id,
                "model",
                ConfigValue::Choice {
                    value: "huge".into()
                }
            )
            .await,
        Err(SessionError::OptionInvalid(_))
    ));
    assert!(matches!(
        h.manager.set_option(&chat.id, "nope", smart.clone()).await,
        Err(SessionError::OptionInvalid(_))
    ));
    handle.set_option_reply(Err(DriverError {
        kind: ErrorKind::AgentError,
        message: "That model isn't available on your plan.".into(),
        detail: None,
    }));
    assert!(matches!(
        h.manager.set_option(&chat.id, "model", ConfigValue::Choice { value: "fast".into() }).await,
        Err(SessionError::OptionInvalid(message)) if message == "That model isn't available on your plan."
    ));
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.stop(&chat.id).await.expect("stop");
    h.status(&chat.id, SessionStatus::Stopped).await;
    assert!(matches!(
        h.manager.set_option(&chat.id, "model", smart.clone()).await,
        Err(SessionError::SessionNotReady)
    ));
    h.manager.start(&chat.id, false).await.expect("start");
    h.status(&chat.id, SessionStatus::Ready).await;
    assert_eq!(
        h.factory.setups()[1].desired.get("model"),
        Some(&smart),
        "re-applied at the next start"
    );
}

fn color_question() -> UiRequest {
    UiRequest {
        request_id: "q1".into(),
        prompt: UiPrompt::Select {
            message: "Which color?".into(),
            options: vec!["Red".into(), "Green".into(), "Blue".into()],
        },
    }
}

/// A41: the question round trip: answers that do not fit are refused, an answer reaches the
/// agent and resolves the card `User`; a dismissal; a withdrawal; a question open when the agent
/// stops is closed `System`.
#[tokio::test(start_paused = true)]
async fn question_round_trip() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::EmitInTurn(DriverEvent::UiRequest {
            turn: None,
            request: color_question(),
        }),
        Step::Expect(CommandMatch::RespondUi {
            request_id: Some("q1".into()),
        }),
        Step::EmitInTurn(DriverEvent::UiRequest {
            turn: None,
            request: UiRequest {
                request_id: "q2".into(),
                prompt: UiPrompt::Confirm {
                    message: "Sure?".into(),
                },
            },
        }),
        Step::Expect(CommandMatch::RespondUi {
            request_id: Some("q2".into()),
        }),
        Step::EmitInTurn(DriverEvent::UiRequest {
            turn: None,
            request: UiRequest {
                request_id: "q3".into(),
                prompt: UiPrompt::Input {
                    message: "Name?".into(),
                    placeholder: None,
                },
            },
        }),
        Step::Emit(DriverEvent::UiWithdrawn {
            request_id: "q3".into(),
        }),
        end_turn(StopReason::EndTurn),
        Step::Emit(DriverEvent::UiRequest {
            turn: None,
            request: UiRequest {
                request_id: "q4".into(),
                prompt: UiPrompt::Confirm {
                    message: "Later?".into(),
                },
            },
        }),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    let sink = Sink::new("main");
    h.manager
        .attach(&chat.id, sink.clone())
        .await
        .expect("attach");
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager.send(&chat.id, "/ask".into()).await.expect("send");
    sink.wait_for(
        "the question",
        |event| matches!(event, AuraEvent::UiRequest(request) if request.request_id == "q1"),
    )
    .await;
    for wrong in [
        UiAnswer::Select { index: 3 },
        UiAnswer::Confirm { yes: true },
    ] {
        assert!(matches!(
            h.manager.respond_ui(&chat.id, "q1", Some(wrong)).await,
            Err(SessionError::OptionInvalid(_))
        ));
    }
    h.manager
        .respond_ui(&chat.id, "q1", Some(UiAnswer::Select { index: 1 }))
        .await
        .expect("answer");
    assert!(matches!(
        h.manager.respond_ui(&chat.id, "q1", None).await,
        Err(SessionError::RequestNotPending)
    ));
    sink.wait_for(
        "the second question",
        |event| matches!(event, AuraEvent::UiRequest(request) if request.request_id == "q2"),
    )
    .await;
    h.manager
        .respond_ui(&chat.id, "q2", None)
        .await
        .expect("dismiss");
    sink.wait_for(
        "the late question",
        |event| matches!(event, AuraEvent::UiRequest(request) if request.request_id == "q4"),
    )
    .await;
    h.manager.stop(&chat.id).await.expect("stop");
    h.status(&chat.id, SessionStatus::Stopped).await;
    let resolutions: Vec<(String, Option<UiAnswer>, ResolvedBy)> = h
        .stored(&chat.id)
        .await
        .into_iter()
        .filter_map(|event| match event {
            AuraEvent::UiResolved {
                request_id,
                answer,
                by,
            } => Some((request_id, answer, by)),
            _ => None,
        })
        .collect();
    assert_eq!(
        resolutions,
        [
            (
                "q1".into(),
                Some(UiAnswer::Select { index: 1 }),
                ResolvedBy::User
            ),
            ("q2".into(), None, ResolvedBy::User),
            ("q3".into(), None, ResolvedBy::Agent),
            ("q4".into(), None, ResolvedBy::System),
        ]
    );
    assert!(handle.commands().contains(&LoggedCommand::RespondUi {
        request_id: "q1".into(),
        answer: Some(UiAnswer::Select { index: 1 }),
    }));
}

/// A26 through the actor: under Full auto an `execute` request is answered and recorded as
/// requested and resolved `Auto`; `allow_always` is never chosen.
#[tokio::test(start_paused = true)]
async fn full_auto_records_auto_answers() {
    let (driver, handle) = ScriptedDriver::new(vec![
        Step::Emit(DriverEvent::Autonomy(full_auto())),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        card("run", Some(ToolKind::Execute)),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("run".into()),
        }),
        end_turn(StopReason::EndTurn),
    ]);
    let h = Harness::new(vec![driver]);
    let chat = h.chat().await;
    h.status(&chat.id, SessionStatus::Ready).await;
    h.manager
        .send(&chat.id, "run the tests".into())
        .await
        .expect("send");
    command(
        &handle,
        CommandMatch::RespondPermission {
            request_id: Some("run".into()),
        },
    )
    .await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let stored = h.stored(&chat.id).await;
    let request = stored
        .iter()
        .position(|event| matches!(event, AuraEvent::PermissionRequested(_)))
        .expect("requested");
    assert_eq!(
        stored[request + 1],
        AuraEvent::PermissionResolved {
            request_id: "run".into(),
            decision: PermissionDecision::Selected {
                option_id: "once".into()
            },
            by: ResolvedBy::Auto,
        }
    );
}
