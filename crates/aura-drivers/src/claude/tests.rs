use super::*;
use crate::driver::{
    AgentSpawner, DriverCommand, DriverEvent, DriverTimings, EventReceiver, NativeStartOptions,
    SessionSetup, StopPlan, TurnRef, event_channel,
};
use aura_process::testing::{FakeAgentEnd, FakeLine, FakeSpawner};
use aura_process::{
    EnvMap, EnvSource, LaunchSpec, ProcessCwd, ProcessSpawner, ProtocolLog, ResolvedEnv,
    ShutdownPlan, SpawnError, SpawnSpec, SpawnedProcess,
};
use aura_protocol::{Autonomy, PromptPart, StopReason};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio::time::timeout;

mod failures;
mod identity;
mod results;
mod rewind;

struct Quiet(Arc<FakeSpawner>);
impl AgentSpawner for Quiet {
    fn spawn(&self, spec: SpawnSpec) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>> {
        self.0.spawn(spec, ProtocolLog::disabled())
    }
}
fn setup() -> SessionSetup {
    SessionSetup {
        mcp_servers: Vec::new(),
        attachment_dir: None,
        attachment_reader: None,
        chat_id: "019a0000-0000-7000-8000-000000000001".into(),
        agent_id: "claude".into(),
        dialect: "claude".into(),
        folder: PathBuf::from("/work"),
        agent_folder: "/work".into(),
        add_dirs: vec![],
        launch: LaunchSpec {
            label: "claude".into(),
            program: "/bin/claude".into(),
            args: vec![],
            cwd: ProcessCwd::ChatFolder,
            set_env: vec![],
            daemons: vec![],
            startup_timeout: Duration::from_secs(60),
        },
        env: Arc::new(ResolvedEnv {
            vars: EnvMap::new(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        }),
        resume: None,
        native_start: Default::default(),
        autonomy: Autonomy::Ask,
        desired: BTreeMap::new(),
        timings: DriverTimings::STANDARD,
        client_version: "0.1".into(),
    }
}
pub(super) struct Harness {
    pub(super) tx: mpsc::UnboundedSender<DriverCommand>,
    pub(super) events: EventReceiver,
    pub(super) end: FakeAgentEnd,
    pub(super) run: tokio::task::JoinHandle<DriverExit>,
}
impl Harness {
    pub(super) async fn start() -> Self {
        Self::start_with(setup()).await
    }
    async fn start_with(setup: SessionSetup) -> Self {
        let (spawner, mut ends) = FakeSpawner::new();
        let (tx, commands) = mpsc::unbounded_channel();
        let (events, rx) = event_channel();
        let run = tokio::spawn(Box::new(ClaudeDriver::new()).run(DriverContext {
            commands,
            events,
            spawner: Arc::new(Quiet(spawner)),
            setup,
        }));
        let end = timeout(Duration::from_secs(2), ends.recv())
            .await
            .expect("spawn deadline")
            .expect("spawn");
        Self {
            tx,
            events: rx,
            end,
            run,
        }
    }
    pub(super) async fn wire(&mut self) -> Value {
        loop {
            let frame = self.wire_raw().await;
            if matches!(
                frame["request"]["subtype"].as_str(),
                Some("get_context_usage" | "get_usage")
            ) {
                self.reply_telemetry(&frame).await;
            } else {
                return frame;
            }
        }
    }
    async fn reply_telemetry(&self, frame: &Value) {
        match frame["request"]["subtype"].as_str() {
            Some("get_context_usage") => assert_eq!(frame["request"]["detail"], "summary"),
            Some("get_usage") => assert_eq!(frame["request"]["skip_behaviors"], true),
            _ => panic!("expected a free telemetry request"),
        }
        self.send(json!({"type":"control_response","response":{"subtype":"success","request_id":frame["request_id"],"response":{}}})).await;
    }
    pub(super) async fn wire_raw(&mut self) -> Value {
        serde_json::from_str(
            &timeout(Duration::from_secs(2), self.end.from_client.recv())
                .await
                .expect("wire deadline")
                .expect("wire"),
        )
        .expect("json")
    }
    pub(super) async fn send(&self, v: Value) {
        self.end
            .to_client
            .send(FakeLine::Line(v.to_string()))
            .expect("stdout");
    }
    pub(super) async fn event(&mut self) -> DriverEvent {
        timeout(Duration::from_secs(2), self.events.recv())
            .await
            .expect("event deadline")
            .expect("event")
    }
    fn native_id(&self) -> &str {
        let args = &self.end.spec.launch.args;
        args.iter()
            .find_map(|arg| arg.to_str()?.strip_prefix("--session-id="))
            .or_else(|| {
                args.iter()
                    .find_map(|arg| arg.to_str()?.strip_prefix("--resume="))
            })
            .expect("native session identity")
    }
    pub(super) async fn ready(&mut self) {
        let init = self.wire().await;
        assert_eq!(init["request"]["subtype"], "initialize");
        self.send(json!({"type":"system","subtype":"hook_started","hook_id":"h"}))
            .await;
        self.send(json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],
            "response":{"claude_code_version":"2.1.310","current_permission_mode":"default","session_state":"idle","models":[],"commands":[]}}})).await;
        loop {
            if let DriverEvent::Ready(info) = self.event().await {
                let args = &self.end.spec.launch.args;
                assert_eq!(info.native_session_id.as_deref(), Some(self.native_id()));
                assert_eq!(
                    info.resumed,
                    if args.iter().any(|arg| arg == "--fork-session")
                        || !args
                            .iter()
                            .any(|arg| arg.to_string_lossy().starts_with("--resume="))
                    {
                        crate::driver::ResumeOutcome::New
                    } else {
                        crate::driver::ResumeOutcome::Resumed
                    }
                );
                assert!(!info.capabilities.fork && !info.capabilities.rewind);
                break;
            }
        }
        for _ in 0..2 {
            let frame = self.wire_raw().await;
            self.reply_telemetry(&frame).await;
        }
    }
    pub(super) fn prompt(&self) {
        self.tx
            .send(DriverCommand::Prompt {
                turn: TurnRef {
                    turn_id: "t1".into(),
                },
                parts: vec![PromptPart::Text {
                    text: "hello".into(),
                }],
            })
            .expect("command");
    }
    pub(super) async fn stop(mut self) {
        self.tx
            .send(DriverCommand::Shutdown {
                plan: StopPlan {
                    cancel_grace: Duration::ZERO,
                    process: ShutdownPlan::FORCE,
                },
            })
            .expect("stop");
        while self.events.recv().await.is_some() {}
        assert_eq!(self.run.await.expect("driver task"), DriverExit::Closed);
    }
}

#[tokio::test(start_paused = true)]
async fn fresh_starts_of_the_same_chat_get_distinct_transcript_ids() {
    let mut first = Harness::start().await;
    first.ready().await;
    let first_id = first.native_id().to_owned();
    first.stop().await;
    let mut second = Harness::start().await;
    second.ready().await;
    let second_id = second.native_id().to_owned();
    assert_ne!(first_id, second_id);
    assert_ne!(first_id, setup().chat_id);
    assert_ne!(second_id, setup().chat_id);
    for id in [first_id, second_id] {
        assert_eq!(
            uuid::Uuid::parse_str(&id).expect("UUID").get_version_num(),
            7
        );
    }
    second.stop().await;
}

#[tokio::test(start_paused = true)]
async fn ordinary_resume_retains_the_source_and_has_no_new_session_flag() {
    for source in [
        "019a0000-0000-7000-8000-000000000009",
        "C:\\transcripts\\session with spaces.jsonl",
    ] {
        let mut settings = setup();
        settings.resume = Some(source.into());
        let mut h = Harness::start_with(settings).await;
        h.ready().await;
        assert_eq!(h.native_id(), source);
        assert!(!h.end.spec.launch.args.iter().any(|arg| {
            arg.to_string_lossy().starts_with("--session-id=") || arg == "--fork-session"
        }));
        h.stop().await;
    }
}

#[tokio::test(start_paused = true)]
async fn fork_uses_a_new_id_and_explicit_resume_at_and_checkpointing_options() {
    let source = "019a0000-0000-7000-8000-000000000009";
    let message = "019a0000-0000-7000-8000-000000000008";
    for seed in [None, Some("019a0000-0000-7000-8000-000000000007")] {
        let mut settings = setup();
        settings.resume = Some(source.into());
        settings.native_start = NativeStartOptions {
            new_session_id: seed.map(str::to_owned),
            fork: true,
            resume_at: Some(message.into()),
            file_checkpointing: true,
        };
        let mut h = Harness::start_with(settings.clone()).await;
        h.ready().await;
        assert_ne!(h.native_id(), source);
        if let Some(seed) = seed {
            assert_eq!(h.native_id(), seed);
        }
        let args = &h.end.spec.launch.args;
        assert!(
            args.iter()
                .any(|arg| arg == format!("--resume={source}").as_str())
        );
        assert!(args.iter().any(|arg| arg == "--fork-session"));
        assert!(
            args.iter()
                .any(|arg| arg == format!("--resume-session-at={message}").as_str())
        );
        assert!(
            !args.iter().any(|arg| arg == "--resume"
                || arg == "--session-id"
                || arg == "--resume-session-at")
        );
        assert!(h.end.spec.launch.set_env.iter().any(|(key, value)| key
            == "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"
            && value == "true"));
        assert_eq!(settings.resume.as_deref(), Some(source));
        assert!(settings.launch.args.is_empty());
        assert!(settings.launch.set_env.is_empty());
        h.stop().await;
    }
}

#[tokio::test(start_paused = true)]
async fn malformed_native_startup_is_rejected_before_spawning() {
    let source = "019a0000-0000-7000-8000-000000000009";
    let cases = [
        (
            None,
            NativeStartOptions {
                fork: true,
                ..Default::default()
            },
        ),
        (
            None,
            NativeStartOptions {
                resume_at: Some(source.into()),
                ..Default::default()
            },
        ),
        (
            None,
            NativeStartOptions {
                new_session_id: Some("invalid".into()),
                ..Default::default()
            },
        ),
        (
            Some(source),
            NativeStartOptions {
                resume_at: Some("--not-a-uuid".into()),
                ..Default::default()
            },
        ),
        (
            Some(source),
            NativeStartOptions {
                new_session_id: Some(source.into()),
                ..Default::default()
            },
        ),
        (
            Some(source),
            NativeStartOptions {
                fork: true,
                new_session_id: Some(source.into()),
                ..Default::default()
            },
        ),
        (Some(" "), NativeStartOptions::default()),
        (Some("a\0b"), NativeStartOptions::default()),
    ];
    for (source, native_start) in cases {
        let (spawner, mut ends) = FakeSpawner::new();
        let (_tx, commands) = mpsc::unbounded_channel();
        let (events, mut rx) = event_channel();
        let mut settings = setup();
        settings.resume = source.map(str::to_owned);
        settings.native_start = native_start;
        let exit = Box::new(ClaudeDriver::new())
            .run(DriverContext {
                commands,
                events,
                spawner: Arc::new(Quiet(spawner)),
                setup: settings,
            })
            .await;
        assert!(
            matches!(exit, DriverExit::StartFailed(error) if error.kind == aura_protocol::ErrorKind::ProtocolError)
        );
        assert!(ends.try_recv().is_err(), "invalid startup must never spawn");
        assert!(
            rx.recv().await.is_none(),
            "invalid startup must never become Ready"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn initializes_after_hooks_and_sends_native_prompt_without_hidden_fields() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    let frame = h.wire().await;
    assert_eq!(frame["type"], "user");
    assert_eq!(frame["message"]["content"], "hello");
    assert_eq!(frame["uuid"], "t1");
    assert!(frame.get("client_composed").is_none());
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn result_ends_turn_but_idle_is_a_separate_event() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    h.wire().await;
    h.send(json!({"type":"system","subtype":"session_state_changed","state":"running"}))
        .await;
    h.send(json!({"type":"result","subtype":"success","user_message_uuid":"t1","usage":{"input_tokens":3,"output_tokens":4}})).await;
    loop {
        if let DriverEvent::TurnEnded {
            turn_id,
            stop_reason,
            ..
        } = h.event().await
        {
            assert_eq!(turn_id, "t1");
            assert_eq!(stop_reason, StopReason::EndTurn);
            break;
        }
    }
    let fixture = include_str!("../../../../docs/spikes/claude-control/fixtures/turn-basic.jsonl");
    let idle = fixture
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|frame| frame["subtype"] == "session_state_changed" && frame["state"] == "idle")
        .expect("real idle frame");
    h.send(idle).await;
    assert!(matches!(
        h.event().await,
        DriverEvent::RunState { idle: true }
    ));
    h.prompt();
    assert_eq!(h.wire().await["type"], "user");
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn interrupt_cancels_a_prompt_waiting_for_configuration() {
    use aura_protocol::session::ConfigValue;
    let mut h = Harness::start().await;
    h.ready().await;
    let (reply, _receive) = tokio::sync::oneshot::channel();
    h.tx.send(DriverCommand::SetOption {
        option_id: "model".into(),
        value: ConfigValue::Choice {
            value: "sonnet".into(),
        },
        reply,
    })
    .expect("option");
    let change = h.wire().await;
    h.prompt();
    h.tx.send(DriverCommand::Interrupt).expect("interrupt");
    let interrupt = h.wire().await;
    assert_eq!(interrupt["request"]["subtype"], "interrupt");
    h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":change["request_id"],"response":{"model":"sonnet"}}})).await;
    loop {
        if let DriverEvent::TurnEnded {
            turn_id,
            stop_reason,
            ..
        } = h.event().await
        {
            assert_eq!(turn_id, "t1");
            assert_eq!(stop_reason, StopReason::Cancelled);
            break;
        }
    }
    assert!(
        timeout(Duration::from_millis(5), h.end.from_client.recv())
            .await
            .is_err(),
        "cancelled prompt never reaches agent"
    );
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn exit_drain_budget_pauses_while_the_event_receiver_is_full() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    h.wire().await;
    for _ in 0..420 {
        h.send(json!({"type":"control_response"})).await;
    }
    h.send(json!({"type":"result","subtype":"success","user_message_uuid":"t1"}))
        .await;
    h.end.to_client.send(FakeLine::Eof).expect("eof");
    // Fill both the event channel and outbox before the child exits.
    for _ in 0..500 {
        tokio::task::yield_now().await;
    }
    let (replacement, _) = tokio::sync::oneshot::channel();
    std::mem::replace(&mut h.end.exit, replacement)
        .send(aura_process::ExitInfo {
            code: Some(0),
            signal: None,
            at_ms: 0,
        })
        .expect("exit");
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(Duration::from_secs(20)).await;
    let mut notices = BTreeMap::<String, usize>::new();
    let mut ended = 0;
    while let Some(event) = timeout(Duration::from_secs(2), h.events.recv())
        .await
        .expect("drain")
    {
        match event {
            DriverEvent::Event {
                event: aura_protocol::AuraEvent::Notice { message, .. },
                ..
            } => *notices.entry(message).or_default() += 1,
            DriverEvent::TurnEnded { .. } => ended += 1,
            _ => {}
        }
    }
    assert_eq!(
        notices.values().sum::<usize>(),
        420,
        "all buffered protocol frames drained: {notices:?}"
    );
    assert_eq!(ended, 1);
    assert!(matches!(
        h.run.await.expect("task"),
        DriverExit::Crashed { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn late_initialize_after_start_timeout_cannot_report_ready() {
    let mut h = Harness::start().await;
    let init = h.wire().await;
    tokio::time::advance(Duration::from_secs(60)).await;
    assert_eq!(
        h.end.from_client.recv().await,
        None,
        "startup failure closes input"
    );
    h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],"response":{"current_permission_mode":"default","session_state":"idle"}}})).await;
    while let Some(event) = h.events.recv().await {
        assert!(
            !matches!(event, DriverEvent::Ready(_)),
            "failed startup remains failed"
        );
    }
    assert!(matches!(
        h.run.await.expect("run"),
        DriverExit::StartFailed(_)
    ));
}

#[tokio::test(start_paused = true)]
async fn questions_return_selected_labels_and_free_text_with_original_input() {
    use aura_protocol::{UiAnswer, UiQuestionAnswer};
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    h.wire().await;
    let input = json!({"questions":[{"header":"Scope","question":"Which parts?","multiSelect":true,"options":[{"label":"Core","description":"Backend"},{"label":"UI","description":"Interface"}]}],"extra":"preserved"});
    h.send(json!({"type":"control_request","request_id":"q1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":input}})).await;
    loop {
        if let DriverEvent::UiRequest { request, .. } = h.event().await {
            assert_eq!(request.request_id, "q1");
            break;
        }
    }
    h.tx.send(DriverCommand::RespondUi {
        request_id: "q1".into(),
        answer: Some(UiAnswer::Questions {
            answers: vec![UiQuestionAnswer {
                question_id: "q0".into(),
                selected: vec![0, 1],
                text: Some("also docs".into()),
            }],
        }),
    })
    .expect("answer");
    let reply = h.wire().await;
    assert_eq!(reply["response"]["response"]["behavior"], "allow");
    assert_eq!(
        reply["response"]["response"]["updatedInput"]["answers"]["Which parts?"],
        "Core, UI, also docs"
    );
    assert_eq!(
        reply["response"]["response"]["updatedInput"]["extra"],
        "preserved"
    );
    assert_eq!(
        reply["response"]["response"]["updatedInput"]["questions"],
        input["questions"]
    );
    h.stop().await;
}

#[test]
fn launch_preserves_harness_and_uses_unambiguous_resume_values() {
    let mut settings = setup();
    settings.resume = Some("--a-native-id".into());
    settings.add_dirs.push(PathBuf::from("folder with spaces"));
    let launch = super::session::launch(&settings, "new-id");
    assert!(launch.args.iter().any(|a| a == "--resume=--a-native-id"));
    assert!(
        !launch
            .args
            .iter()
            .any(|a| a == "--bare" || a == "--system-prompt")
    );
    assert!(
        launch
            .set_env
            .iter()
            .any(|(key, value)| key == "CLAUDE_CODE_SDK_READS_SESSION_STATE" && value == "1")
    );
    assert_eq!(launch.program, settings.launch.program);
    assert!(
        !launch
            .set_env
            .iter()
            .any(|(key, _)| key == "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING")
    );
}

#[tokio::test(start_paused = true)]
async fn permissions_preserve_input_and_withdrawal_ignores_late_answers() {
    use crate::driver::PermissionOutcome;
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    h.wire().await;
    let input = json!({"command":"echo a", "description":"Keep all fields", "future":{"key":12}});
    for id in ["allow-request", "cancel-request"] {
        h.send(json!({"type":"control_request","request_id":id,"request":{"subtype":"can_use_tool","tool_name":"Bash","requires_user_interaction":true,"suppress_always_allow_rule":true,"permission_suggestions":[{"type":"addRules","behavior":"allow"}],"input":input}})).await;
        loop {
            if let DriverEvent::Permission { request, .. } = h.event().await {
                assert_eq!(request.kind, None, "always-ask cannot autoapprove");
                assert_eq!(
                    request.options.len(),
                    2,
                    "suppressed always option is absent"
                );
                break;
            }
        }
    }
    h.tx.send(DriverCommand::RespondPermission {
        request_id: "allow-request".into(),
        outcome: PermissionOutcome::Selected("allow".into()),
    })
    .expect("allow");
    assert_eq!(
        h.wire().await["response"]["response"]["updatedInput"],
        input
    );
    h.send(json!({"type":"control_cancel_request","request_id":"cancel-request"}))
        .await;
    assert!(matches!(
        h.event().await,
        DriverEvent::PermissionWithdrawn { .. }
    ));
    h.tx.send(DriverCommand::RespondPermission {
        request_id: "cancel-request".into(),
        outcome: PermissionOutcome::Selected("allow".into()),
    })
    .expect("late answer");
    assert!(
        timeout(Duration::from_millis(5), h.end.from_client.recv())
            .await
            .is_err()
    );
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn unsupported_effort_never_reaches_the_cli() {
    let mut h = Harness::start().await;
    h.ready().await;
    let (reply, receive) = tokio::sync::oneshot::channel();
    h.tx.send(DriverCommand::SetOption {
        option_id: "effort".into(),
        value: aura_protocol::session::ConfigValue::Choice {
            value: "bogus".into(),
        },
        reply,
    })
    .expect("option");
    assert!(receive.await.expect("reply").is_err());
    assert!(
        timeout(Duration::from_millis(5), h.end.from_client.recv())
            .await
            .is_err()
    );
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn closing_before_initialize_never_becomes_ready() {
    let mut h = Harness::start().await;
    let init = h.wire().await;
    h.tx.send(DriverCommand::Shutdown {
        plan: StopPlan {
            cancel_grace: Duration::ZERO,
            process: ShutdownPlan::STANDARD,
        },
    })
    .expect("stop");
    loop {
        if matches!(
            h.event().await,
            DriverEvent::Status(crate::driver::DriverStatus::Closing)
        ) {
            break;
        }
    }
    h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],"response":{"current_permission_mode":"default","session_state":"idle"}}})).await;
    while let Some(event) = h.events.recv().await {
        assert!(!matches!(event, DriverEvent::Ready(_)));
    }
    assert_eq!(h.run.await.expect("task"), DriverExit::Closed);
}

#[tokio::test(start_paused = true)]
async fn a_timed_out_mutation_cannot_release_queued_work() {
    use aura_protocol::session::ConfigValue;
    let mut h = Harness::start().await;
    h.ready().await;
    let (reply, first) = tokio::sync::oneshot::channel();
    h.tx.send(DriverCommand::SetOption {
        option_id: "model".into(),
        value: ConfigValue::Choice {
            value: "sonnet".into(),
        },
        reply,
    })
    .expect("first");
    let change = h.wire().await;
    let (reply, second) = tokio::sync::oneshot::channel();
    h.tx.send(DriverCommand::SetOption {
        option_id: "model".into(),
        value: ConfigValue::Choice {
            value: "haiku".into(),
        },
        reply,
    })
    .expect("second");
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(Duration::from_secs(31)).await;
    assert!(first.await.expect("first timeout").is_err());
    assert!(second.await.expect("second timeout").is_err());
    // Late success cannot dispatch the expired second change.
    h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":change["request_id"],"response":{"model":"sonnet"}}})).await;
    assert_eq!(
        h.end.from_client.recv().await,
        None,
        "ambiguous settings close the session"
    );
    while h.events.recv().await.is_some() {}
    assert!(matches!(
        h.run.await.expect("task"),
        DriverExit::Crashed { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn abandoned_setting_receivers_never_mutate() {
    use aura_protocol::session::ConfigValue;
    let mut h = Harness::start().await;
    h.ready().await;
    let (reply, receive) = tokio::sync::oneshot::channel();
    drop(receive);
    h.tx.send(DriverCommand::SetOption {
        option_id: "model".into(),
        value: ConfigValue::Choice {
            value: "haiku".into(),
        },
        reply,
    })
    .expect("abandoned");
    assert!(
        timeout(Duration::from_millis(5), h.end.from_client.recv())
            .await
            .is_err()
    );
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn authentication_failure_exposes_vendor_sign_in_but_policy_forbidden_does_not() {
    for (status, auth) in [(401, true), (403, false)] {
        let mut h = Harness::start().await;
        h.ready().await;
        h.prompt();
        h.wire().await;
        h.send(json!({"type":"result","subtype":"error_during_execution","is_error":true,"api_error_status":status,"user_message_uuid":"t1","errors":["request failed"]})).await;
        loop {
            if let DriverEvent::TurnEnded {
                error: Some(error), ..
            } = h.event().await
            {
                assert_eq!(
                    error.kind,
                    if auth {
                        aura_protocol::ErrorKind::AuthRequired
                    } else {
                        aura_protocol::ErrorKind::AgentError
                    }
                );
                break;
            }
        }
        if auth {
            let DriverEvent::AuthRequired(prompt) = h.event().await else {
                panic!("sign-in prompt");
            };
            assert!(
                prompt
                    .commands
                    .iter()
                    .any(|command| command.argv == ["/bin/claude", "auth", "login"])
            );
        } else {
            while let Ok(Some(event)) = timeout(Duration::from_millis(5), h.events.recv()).await {
                assert!(!matches!(event, DriverEvent::AuthRequired(_)));
            }
        }
        h.stop().await;
    }
}

#[tokio::test(start_paused = true)]
async fn native_plan_restores_the_previous_execution_access() {
    let mut h = Harness::start().await;
    h.ready().await;
    for (id, value, native) in [
        (crate::controls::ACCESS, "acceptEdits", "acceptEdits"),
        (crate::controls::WORKFLOW, "plan", "plan"),
        (crate::controls::WORKFLOW, "execute", "acceptEdits"),
    ] {
        let (reply, result) = tokio::sync::oneshot::channel();
        h.tx.send(DriverCommand::SetOption {
            option_id: id.into(),
            value: aura_protocol::session::ConfigValue::Choice {
                value: value.into(),
            },
            reply,
        })
        .unwrap();
        let request = h.wire().await;
        assert_eq!(
            request["request"],
            json!({"subtype":"set_permission_mode","mode":native})
        );
        h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":request["request_id"],"response":{"mode":native}}})).await;
        result.await.unwrap().unwrap();
    }
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn invalid_saved_native_workflow_never_opens_an_execution_session() {
    let mut setup = setup();
    setup.desired.insert(
        crate::controls::WORKFLOW.into(),
        aura_protocol::session::ConfigValue::Choice {
            value: "future-unknown".into(),
        },
    );
    let mut h = Harness::start_with(setup).await;
    let init = h.wire().await;
    h.send(json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],"response":{"session_state":"idle","current_permission_mode":"default"}}})).await;
    while let Some(event) = h.events.recv().await {
        assert!(!matches!(event, DriverEvent::Ready(_)));
    }
    assert!(matches!(h.run.await.unwrap(), DriverExit::StartFailed(_)));
}
