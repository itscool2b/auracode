use super::*;
use aura_protocol::{UiAnswer, UiPrompt, UiQuestionAnswer};

async fn ready_vendor(dialect: &str) -> Harness {
    let mut h = Harness::start(setup(dialect)).await;
    let (id, params) = h.request("initialize").await;
    assert_eq!(params["protocolVersion"], 1);
    if dialect == "omp" {
        assert_eq!(
            params["clientCapabilities"]["elicitation"],
            json!({"form":{}})
        );
    } else {
        assert!(params["clientCapabilities"].get("elicitation").is_none());
    }
    h.reply(&id, init_result());
    let (id, _) = h.request("session/new").await;
    h.reply(&id, json!({"sessionId":SESSION}));
    let events = h
        .events_until(|event| matches!(event, DriverEvent::Ready(_)))
        .await;
    if dialect == "omp" {
        assert_eq!(
            ready_info(&events).capabilities.autonomy_levels,
            [Autonomy::FullAuto]
        );
        assert!(!ready_info(&events).capabilities.permissions);
    }
    h
}

async fn ui(h: &mut Harness) -> UiRequest {
    h.events_until(|event| matches!(event, DriverEvent::UiRequest { .. }))
        .await
        .into_iter()
        .find_map(|event| match event {
            DriverEvent::UiRequest { request, .. } => Some(request),
            _ => None,
        })
        .unwrap()
}

fn question(id: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"cursor/ask_question","params":{
        "toolCallId":"call","questions":[{"id":"q","prompt":"Choose","options":[{"id":"native","label":"Shown"}]}]}})
}

#[tokio::test(start_paused = true)]
async fn cursor_deferred_questions_allow_out_of_order_answers_and_ignore_late_answers() {
    let mut h = ready_vendor("cursor").await;
    h.prompt("T", "visible user prompt");
    let (prompt_id, _) = h.request("session/prompt").await;
    h.send(question(json!(7)));
    let first = ui(&mut h).await;
    h.send(question(json!("7")));
    let second = ui(&mut h).await;
    assert_ne!(first.request_id, second.request_id);
    h.no_line();
    h.command(DriverCommand::RespondUi {
        request_id: second.request_id.clone(),
        answer: Some(UiAnswer::Questions {
            answers: vec![UiQuestionAnswer {
                question_id: "q".into(),
                selected: vec![0],
                text: None,
            }],
        }),
    });
    let reply = h.line().await;
    assert_eq!(reply["id"], "7");
    assert_eq!(
        reply["result"]["outcome"]["answers"][0]["selectedOptionIds"],
        json!(["native"])
    );
    h.send(json!({"jsonrpc":"2.0","method":"$/cancel_request","params":{"requestId":7}}));
    let reply = h.line().await;
    assert_eq!(reply["id"], 7);
    assert_eq!(reply["result"], json!({"outcome":{"outcome":"cancelled"}}));
    h.events_until(|event| matches!(event, DriverEvent::UiWithdrawn { request_id } if request_id == &first.request_id)).await;
    h.command(DriverCommand::RespondUi {
        request_id: first.request_id,
        answer: Some(UiAnswer::Confirm { yes: true }),
    });
    h.command(DriverCommand::RespondUi {
        request_id: second.request_id,
        answer: None,
    });
    h.reply(&prompt_id, json!({"stopReason":"end_turn"}));
    h.events_until(|event| matches!(event, DriverEvent::TurnEnded { .. }))
        .await;
    h.no_line();
    h.exit_with(0);
    h.eof();
    h.finish().await;
}

#[tokio::test(start_paused = true)]
async fn cursor_plan_renders_full_text_before_explicit_approval_and_cancels_at_turn_end() {
    let mut h = ready_vendor("cursor").await;
    h.prompt("T", "plan my change");
    let (prompt_id, _) = h.request("session/prompt").await;
    let plan = "Plan details.\n".repeat(500);
    h.send(
        json!({"jsonrpc":"2.0","id":"plan","method":"cursor/create_plan","params":{
        "toolCallId":"p","plan":plan,"todos":[]}}),
    );
    let events = h
        .events_until(|event| matches!(event, DriverEvent::UiRequest { .. }))
        .await;
    assert!(events.iter().any(|event| matches!(event, DriverEvent::Event { event:AuraEvent::MessageDelta { text, .. }, .. } if text.contains(&plan))));
    assert!(matches!(
        events.last(),
        Some(DriverEvent::UiRequest {
            request: UiRequest {
                prompt: UiPrompt::Confirm { .. },
                ..
            },
            ..
        })
    ));
    h.no_line();
    h.reply(&prompt_id, json!({"stopReason":"end_turn"}));
    assert_eq!(
        h.line().await["result"],
        json!({"outcome":{"outcome":"cancelled"}})
    );
    h.events_until(|event| matches!(event, DriverEvent::TurnEnded { .. }))
        .await;
    h.exit_with(0);
    h.eof();
    h.finish().await;
}

#[tokio::test(start_paused = true)]
async fn omp_forms_are_advertised_and_shutdown_cancels_open_plan_approval() {
    let mut h = ready_vendor("omp").await;
    h.send(json!({"jsonrpc":"2.0","id":"form","method":"elicitation/create","params":{
        "mode":"form","sessionId":SESSION,"message":"Approve plan?","requestedSchema":{
            "type":"object","properties":{"value":{"type":"string","enum":["Approve","Refine"]}},"required":["value"]}}}));
    let request = ui(&mut h).await;
    h.no_line();
    h.command(DriverCommand::RespondUi {
        request_id: request.request_id.clone(),
        answer: Some(UiAnswer::Confirm { yes: true }),
    });
    h.command(DriverCommand::Shutdown {
        plan: StopPlan {
            cancel_grace: Duration::ZERO,
            process: ShutdownPlan::FORCE,
        },
    });
    assert_eq!(h.line().await["result"], json!({"action":"cancel"}));
    let (events, _) = h.finish().await;
    assert!(events.iter().any(|event| matches!(event, DriverEvent::UiWithdrawn { request_id } if request_id == &request.request_id)));
}

#[tokio::test(start_paused = true)]
async fn unsupported_omp_forms_and_foreign_sessions_cannot_approve() {
    let mut h = ready_vendor("omp").await;
    let form = |id, session, kind| {
        json!({"jsonrpc":"2.0","id":id,"method":"elicitation/create","params":{
        "mode":"form","sessionId":session,"message":"Input","requestedSchema":{"type":"object","properties":{"value":{"type":kind}}}}})
    };
    h.send(form(1, SESSION, "number"));
    assert_eq!(h.line().await["error"]["code"], codes::INVALID_PARAMS);
    h.send(form(2, "different-session", "boolean"));
    assert_eq!(h.line().await["result"], json!({"action":"cancel"}));
    let (tx, rx) = oneshot::channel();
    h.command(DriverCommand::SetAutonomy {
        autonomy: Autonomy::Ask,
        reply: tx,
    });
    assert!(rx.await.unwrap().is_err());
    h.exit_with(0);
    h.eof();
    h.finish().await;
}
