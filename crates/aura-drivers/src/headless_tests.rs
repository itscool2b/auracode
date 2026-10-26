use super::*;
use crate::driver::{DriverTimings, EventReceiver, TurnRef, event_channel};
use aura_process::testing::{FakeAgentEnd, FakeLine, FakeSpawner};
use aura_process::{
    EnvMap, EnvSource, ExitInfo, LaunchSpec, ProcessCwd, ProtocolLog, ResolvedEnv, SpawnError,
    SpawnedProcess,
};
use std::{collections::BTreeMap, path::PathBuf};
use tokio::sync::oneshot;

const SESSION: &str = "019a0000-0000-7000-8000-000000000051";

#[test]
fn documented_agy_stream_reconciles_result_and_reports_session_totals() {
    let mut turn = Turn::new("T".into());
    let mut out = VecDeque::new();
    assert!(!frame(&mut turn, &json!({"event":"step_update","step_update":{"conversation_id":SESSION,"step_type":"agent_response","text_delta":"one"}}), Family::Agy, SESSION, &mut out).unwrap());
    assert!(frame(&mut turn, &json!({"event":"result","result":{"conversation_id":SESSION,"status":"SUCCESS","response":"one\n","usage":{"input_tokens":8,"output_tokens":2,"thinking_tokens":1}}}), Family::Agy, SESSION, &mut out).unwrap());
    assert_eq!(
        turn.terminal.as_ref().unwrap().1.as_ref().unwrap().scope,
        UsageScope::Session
    );
    turn.finish(&mut out);
    let text: String = out
        .iter()
        .filter_map(|event| match event {
            DriverEvent::Event {
                event: AuraEvent::MessageDelta { text, .. },
                ..
            } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "one\n");
    assert!(matches!(
        out.back(),
        Some(DriverEvent::TurnEnded {
            stop_reason: StopReason::EndTurn,
            ..
        })
    ));
}

#[test]
fn fallback_identity_and_final_text_mismatches_fail_explicitly() {
    let mut turn = Turn::new("T".into());
    let mut out = VecDeque::new();
    turn.delta("first", &mut out);
    assert!(frame(&mut turn, &json!({"event":"result","result":{"conversation_id":SESSION,"status":"SUCCESS","response":"other"}}), Family::Agy, SESSION, &mut out).is_err());
    assert!(
        frame(
            &mut turn,
            &json!({"type":"end","sessionId":"foreign","stopReason":"end_turn"}),
            Family::Grok,
            SESSION,
            &mut out
        )
        .is_err()
    );
}

#[test]
fn grok_end_uses_turn_usage_and_ignores_future_metadata() {
    let mut turn = Turn::new("T".into());
    let mut out = VecDeque::new();
    frame(
        &mut turn,
        &json!({"type":"text","data":"hello"}),
        Family::Grok,
        SESSION,
        &mut out,
    )
    .unwrap();
    assert!(frame(&mut turn, &json!({"type":"end","sessionId":SESSION,"stopReason":"max_tokens","usage":{"input_tokens":3,"output_tokens":4},"future":true}), Family::Grok, SESSION, &mut out).unwrap());
    assert_eq!(turn.terminal.as_ref().unwrap().0, StopReason::MaxTokens);
    assert_eq!(
        turn.terminal.as_ref().unwrap().1.as_ref().unwrap().scope,
        UsageScope::Turn
    );
    frame(
        &mut turn,
        &json!({"type":"text","data":"late"}),
        Family::Grok,
        SESSION,
        &mut out,
    )
    .unwrap();
    assert_eq!(turn.bytes, 5);
}

struct Quiet(Arc<FakeSpawner>);
impl AgentSpawner for Quiet {
    fn spawn(&self, spec: SpawnSpec) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>> {
        aura_process::ProcessSpawner::spawn(&*self.0, spec, ProtocolLog::disabled())
    }
}

fn setup(family: Family) -> SessionSetup {
    SessionSetup {
        chat_id: "chat".into(),
        agent_id: if family == Family::Agy {
            "agy-stream"
        } else {
            "grok-stream"
        }
        .into(),
        dialect: if family == Family::Agy {
            "agy-stream"
        } else {
            "grok-stream"
        }
        .into(),
        folder: PathBuf::from("/work"),
        agent_folder: "/work".into(),
        add_dirs: Vec::new(),
        launch: LaunchSpec {
            label: "fake fallback".into(),
            program: PathBuf::from("/fake/agent"),
            args: Vec::new(),
            cwd: ProcessCwd::ChatFolder,
            set_env: Vec::new(),
            daemons: Vec::new(),
            startup_timeout: Duration::from_secs(5),
        },
        env: Arc::new(ResolvedEnv {
            vars: EnvMap::new(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        }),
        resume: Some(SESSION.into()),
        native_start: Default::default(),
        autonomy: Autonomy::FullAuto,
        desired: BTreeMap::new(),
        timings: DriverTimings::STANDARD,
        client_version: "test".into(),
    }
}

async fn next(events: &mut EventReceiver) -> DriverEvent {
    tokio::time::timeout(Duration::from_secs(10), events.recv())
        .await
        .unwrap()
        .unwrap()
}

fn send(end: &FakeAgentEnd, value: Value) {
    end.to_client
        .send(FakeLine::Line(value.to_string()))
        .unwrap();
}

fn exit(end: &mut FakeAgentEnd) {
    let (stand_in, _) = oneshot::channel();
    std::mem::replace(&mut end.exit, stand_in)
        .send(ExitInfo {
            code: Some(0),
            signal: None,
            at_ms: 0,
        })
        .unwrap();
    end.to_client.send(FakeLine::Eof).unwrap();
}

#[tokio::test(start_paused = true)]
async fn grok_starts_only_for_visible_prompts_and_does_not_dispatch_a_queue_after_stop() {
    let (fake, mut ends) = FakeSpawner::new();
    let (tx, commands) = mpsc::unbounded_channel();
    let (events, mut receive) = event_channel();
    let run = tokio::spawn(Box::new(HeadlessDriver).run(DriverContext {
        commands,
        events,
        spawner: Arc::new(Quiet(fake.clone())),
        setup: setup(Family::Grok),
    }));
    while !matches!(next(&mut receive).await, DriverEvent::Ready(_)) {}
    assert!(ends.try_recv().is_err());
    tx.send(DriverCommand::Prompt {
        turn: TurnRef {
            turn_id: "T".into(),
        },
        parts: vec![PromptPart::Text {
            text: "Visible\n$literal".into(),
        }],
    })
    .unwrap();
    let mut end = ends.recv().await.unwrap();
    assert_eq!(
        end.spec.launch.args,
        ["-p", "Visible\n$literal", "--resume", SESSION]
    );
    send(&end, json!({"type":"text","data":"Done"}));
    send(
        &end,
        json!({"type":"end","stopReason":"end_turn","sessionId":SESSION}),
    );
    exit(&mut end);
    while !matches!(next(&mut receive).await, DriverEvent::TurnEnded { .. }) {}
    tx.send(DriverCommand::Interrupt).unwrap();
    tx.send(DriverCommand::Prompt {
        turn: TurnRef {
            turn_id: "late".into(),
        },
        parts: vec![PromptPart::Text {
            text: "must not run".into(),
        }],
    })
    .unwrap();
    assert_eq!(run.await.unwrap(), DriverExit::Closed);
    assert!(ends.try_recv().is_err());
}

#[tokio::test(start_paused = true)]
async fn agy_waits_for_its_identity_then_sends_the_documented_stdin_shape() {
    let (fake, mut ends) = FakeSpawner::new();
    let (tx, commands) = mpsc::unbounded_channel();
    let (events, mut receive) = event_channel();
    let run = tokio::spawn(Box::new(HeadlessDriver).run(DriverContext {
        commands,
        events,
        spawner: Arc::new(Quiet(fake)),
        setup: setup(Family::Agy),
    }));
    let mut end = ends.recv().await.unwrap();
    send(
        &end,
        json!({"event":"init","conversation_id":SESSION,"init":{"permission_mode":"request-review"}}),
    );
    while !matches!(next(&mut receive).await, DriverEvent::Ready(_)) {}
    tx.send(DriverCommand::Prompt {
        turn: TurnRef {
            turn_id: "T".into(),
        },
        parts: vec![PromptPart::Text {
            text: "Visible prompt".into(),
        }],
    })
    .unwrap();
    let line = end.from_client.recv().await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap(),
        json!({"event":"user","message":{"content":"Visible prompt"}})
    );
    send(
        &end,
        json!({"event":"result","result":{"conversation_id":SESSION,"status":"SUCCESS","response":"Done"}}),
    );
    while !matches!(next(&mut receive).await, DriverEvent::TurnEnded { .. }) {}
    tx.send(DriverCommand::Interrupt).unwrap();
    while receive.recv().await.is_some() {}
    assert_eq!(run.await.unwrap(), DriverExit::Closed);
}

#[tokio::test(start_paused = true)]
async fn grok_confirms_identity_only_after_a_vendor_terminal_frame() {
    let (fake, mut ends) = FakeSpawner::new();
    let (tx, commands) = mpsc::unbounded_channel();
    let (events, mut receive) = event_channel();
    let mut initial = setup(Family::Grok);
    initial.resume = None;
    let run = tokio::spawn(Box::new(HeadlessDriver).run(DriverContext {
        commands,
        events,
        spawner: Arc::new(Quiet(fake)),
        setup: initial,
    }));
    loop {
        if let DriverEvent::Ready(info) = next(&mut receive).await {
            assert_eq!(info.native_session_id, None);
            break;
        }
    }
    for (number, expected_flag) in [(0, "--session-id"), (1, "--session-id"), (2, "--resume")] {
        tx.send(DriverCommand::Prompt {
            turn: TurnRef {
                turn_id: format!("T{number}"),
            },
            parts: vec![PromptPart::Text {
                text: "visible".into(),
            }],
        })
        .unwrap();
        let mut end = ends.recv().await.unwrap();
        assert_eq!(end.spec.launch.args[2], expected_flag);
        let native_id = end.spec.launch.args[3].to_string_lossy().into_owned();
        assert!(uuid::Uuid::parse_str(&native_id).is_ok());
        if number == 0 {
            send(
                &end,
                json!({"type":"error", "message":"failed before session creation"}),
            );
        } else {
            send(
                &end,
                json!({"type":"end", "sessionId":native_id, "stopReason":"end_turn"}),
            );
        }
        exit(&mut end);
        let mut identity_seen = false;
        loop {
            match next(&mut receive).await {
                DriverEvent::NativeSessionId(id) => {
                    assert_eq!(id, native_id);
                    identity_seen = true;
                }
                DriverEvent::TurnEnded { .. } => break,
                _ => {}
            }
        }
        assert_eq!(identity_seen, number == 1);
    }
    tx.send(DriverCommand::Interrupt).unwrap();
    assert_eq!(run.await.unwrap(), DriverExit::Closed);
}

#[tokio::test(start_paused = true)]
async fn fallback_rejects_unenforceable_autonomy_before_spawning() {
    for family in [Family::Agy, Family::Grok] {
        let (fake, mut ends) = FakeSpawner::new();
        let (_tx, commands) = mpsc::unbounded_channel();
        let (events, _receive) = event_channel();
        let mut initial = setup(family);
        initial.autonomy = Autonomy::Ask;
        let result = Box::new(HeadlessDriver)
            .run(DriverContext {
                commands,
                events,
                spawner: Arc::new(Quiet(fake)),
                setup: initial,
            })
            .await;
        assert!(matches!(result, DriverExit::StartFailed(_)));
        assert!(ends.try_recv().is_err());
    }
}

#[tokio::test(start_paused = true)]
async fn agy_oversized_result_ends_turn_with_error_and_stops_its_process() {
    let (fake, mut ends) = FakeSpawner::new();
    let (tx, commands) = mpsc::unbounded_channel();
    let (events, mut receive) = event_channel();
    let run = tokio::spawn(Box::new(HeadlessDriver).run(DriverContext {
        commands,
        events,
        spawner: Arc::new(Quiet(fake.clone())),
        setup: setup(Family::Agy),
    }));
    let mut end = ends.recv().await.unwrap();
    send(&end, json!({"event":"init", "conversation_id":SESSION}));
    while !matches!(next(&mut receive).await, DriverEvent::Ready(_)) {}
    tx.send(DriverCommand::Prompt {
        turn: TurnRef {
            turn_id: "T".into(),
        },
        parts: vec![PromptPart::Text {
            text: "visible".into(),
        }],
    })
    .unwrap();
    end.from_client.recv().await.unwrap();
    end.to_client
        .send(FakeLine::Oversized {
            bytes: (MAX_LINE_BYTES + 1) as u64,
            keys: Default::default(),
        })
        .unwrap();
    loop {
        if let DriverEvent::TurnEnded {
            stop_reason, error, ..
        } = next(&mut receive).await
        {
            assert_eq!(stop_reason, StopReason::Error);
            assert!(error.unwrap().message.contains("oversized"));
            break;
        }
    }
    while receive.recv().await.is_some() {}
    assert!(matches!(run.await.unwrap(), DriverExit::Crashed { .. }));
    assert!(fake.controls()[0].was_killed());
}
