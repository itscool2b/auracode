use super::*;
use crate::driver::{
    AgentSpawner, DriverCommand, DriverEvent, DriverTimings, EventReceiver, SessionSetup, StopPlan,
    TurnRef, event_channel,
};
use aura_process::testing::{FakeAgentEnd, FakeLine, FakeSpawner};
use aura_process::{
    EnvMap, EnvSource, LaunchSpec, ProcessCwd, ProcessSpawner, ProtocolLog, ResolvedEnv,
    ShutdownPlan, SpawnError, SpawnSpec, SpawnedProcess,
};
use aura_protocol::{AuraEvent, Autonomy, PromptPart, StopReason};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio::time::timeout;

struct Quiet(Arc<FakeSpawner>);
impl AgentSpawner for Quiet {
    fn spawn(&self, spec: SpawnSpec) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>> {
        self.0
            .spawn(spec, ProtocolLog::disabled_with_id("codex-test"))
    }
}
fn setup() -> SessionSetup {
    SessionSetup {
        chat_id: "chat".into(),
        agent_id: "codex".into(),
        dialect: "codex".into(),
        folder: PathBuf::from("/work"),
        agent_folder: "/work".into(),
        add_dirs: vec![],
        launch: LaunchSpec {
            label: "codex".into(),
            program: "/bin/codex".into(),
            args: vec!["app-server".into(), "--listen".into(), "stdio://".into()],
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
        autonomy: Autonomy::Ask,
        desired: BTreeMap::new(),
        timings: DriverTimings::STANDARD,
        client_version: "0.1".into(),
    }
}
struct Harness {
    tx: mpsc::UnboundedSender<DriverCommand>,
    events: EventReceiver,
    end: FakeAgentEnd,
    run: tokio::task::JoinHandle<DriverExit>,
}
impl Harness {
    async fn start_with(setup: SessionSetup) -> Self {
        let (spawner, mut ends) = FakeSpawner::new();
        let (tx, commands) = mpsc::unbounded_channel();
        let (events, rx) = event_channel();
        let run = tokio::spawn(Box::new(CodexDriver::new()).run(DriverContext {
            commands,
            events,
            spawner: Arc::new(Quiet(spawner)),
            setup,
        }));
        let end = timeout(Duration::from_secs(2), ends.recv())
            .await
            .unwrap()
            .unwrap();
        Self {
            tx,
            events: rx,
            end,
            run,
        }
    }
    async fn start() -> Self {
        Self::start_with(setup()).await
    }
    async fn wire(&mut self) -> Value {
        loop {
            let frame: Value = serde_json::from_str(
                &timeout(Duration::from_secs(2), self.end.from_client.recv())
                    .await
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            assert!(frame.get("jsonrpc").is_none());
            if frame["method"] == "account/rateLimits/read" {
                self.send(json!({"id":frame["id"],"result":{"rateLimits":{}}}));
            } else {
                return frame;
            }
        }
    }
    fn send(&self, v: Value) {
        self.end
            .to_client
            .send(FakeLine::Line(v.to_string()))
            .unwrap();
    }
    async fn event(&mut self) -> DriverEvent {
        timeout(Duration::from_secs(2), self.events.recv())
            .await
            .unwrap()
            .unwrap()
    }
    async fn ready(&mut self) -> crate::driver::ReadyInfo {
        let init = self.wire().await;
        assert_eq!(init["method"], "initialize");
        assert_eq!(init["params"]["clientInfo"]["name"], "auracode");
        self.send(json!({"id":init["id"],"result":{"userAgent":"codex/0.162.1"}}));
        assert_eq!(self.wire().await["method"], "initialized");
        let open = self.wire().await;
        assert!(matches!(
            open["method"].as_str(),
            Some("thread/start" | "thread/resume")
        ));
        let models = self.wire().await;
        assert_eq!(models["method"], "model/list");
        self.send(json!({"id":models["id"],"result":{"data":[{"id":"m","model":"model-a","displayName":"Model A","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"Balanced"},{"reasoningEffort":"high","description":"High"}]}],"nextCursor":null}}));
        self.send(json!({"id":open["id"],"result":{"thread":{"id":"thread-1","sessionId":"tree-1","status":{"type":"idle"},"cliVersion":"0.162.1"},"model":"model-a","approvalPolicy":"untrusted","sandbox":{"type":"workspaceWrite"}}}));
        loop {
            if let DriverEvent::Ready(info) = self.event().await {
                return info;
            }
        }
    }
    fn prompt(&self) {
        self.tx
            .send(DriverCommand::Prompt {
                turn: TurnRef {
                    turn_id: "aura-turn".into(),
                },
                parts: vec![PromptPart::Text {
                    text: "hello".into(),
                }],
            })
            .unwrap();
    }
    async fn begin(&mut self) {
        self.prompt();
        let request = self.wire().await;
        assert_eq!(request["method"], "turn/start");
        self.send(json!({"id":request["id"],"result":{"turn":{"id":"turn-1","status":"inProgress","items":[]}}}));
        self.send(json!({"method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"inProgress","items":[]}}}));
    }
    async fn stop(mut self) {
        self.tx
            .send(DriverCommand::Shutdown {
                plan: StopPlan {
                    cancel_grace: Duration::ZERO,
                    process: ShutdownPlan::FORCE,
                },
            })
            .unwrap();
        while self.events.recv().await.is_some() {}
        assert_eq!(self.run.await.unwrap(), DriverExit::Closed);
    }
}

#[tokio::test(start_paused = true)]
async fn handshake_uses_thread_identity_and_advertises_only_implemented_capabilities() {
    let mut h = Harness::start().await;
    let ready = h.ready().await;
    assert_eq!(ready.native_session_id, "thread-1");
    assert_eq!(ready.agent_version.as_deref(), Some("0.162.1"));
    assert!(
        !ready.capabilities.steer
            && !ready.capabilities.fork
            && !ready.capabilities.images
            && !ready.capabilities.add_dirs
    );
    h.prompt();
    let request = h.wire().await;
    assert_eq!(
        request["params"]["input"],
        json!([{"type":"text","text":"hello"}])
    );
    assert_eq!(request["params"]["threadId"], "thread-1");
    assert!(request["params"].get("developerInstructions").is_none());
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn turn_completion_and_idle_are_separate_and_foreign_events_are_ignored() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    h.send(json!({"method":"item/agentMessage/delta","params":{"threadId":"other","turnId":"turn-1","itemId":"m","delta":"foreign"}}));
    h.send(json!({"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"m","delta":"hello"}}));
    h.send(json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}}));
    let mut text = String::new();
    loop {
        match h.event().await {
            DriverEvent::Event {
                event: AuraEvent::MessageDelta { text: delta, .. },
                ..
            } => text += &delta,
            DriverEvent::TurnEnded {
                turn_id,
                stop_reason,
                ..
            } => {
                assert_eq!(turn_id, "aura-turn");
                assert_eq!(stop_reason, StopReason::EndTurn);
                break;
            }
            DriverEvent::RunState { idle: true } => panic!("completion is not idle"),
            _ => {}
        }
    }
    assert_eq!(text, "hello");
    h.send(json!({"method":"thread/status/changed","params":{"threadId":"thread-1","status":{"type":"idle"}}}));
    assert!(matches!(
        h.event().await,
        DriverEvent::RunState { idle: true }
    ));
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn approval_ids_remain_exact_and_withdrawals_do_not_answer_twice() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    for id in [json!(17), json!("17")] {
        h.send(json!({"id":id,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"same-item","command":"echo test","startedAtMs":1}}));
    }
    let mut ids = Vec::new();
    while ids.len() < 2 {
        if let DriverEvent::Permission { request, .. } = h.event().await {
            ids.push(request.request_id);
        }
    }
    h.tx.send(DriverCommand::RespondPermission {
        request_id: ids[0].clone(),
        outcome: crate::driver::PermissionOutcome::Selected("accept".into()),
    })
    .unwrap();
    assert_eq!(
        h.wire().await,
        json!({"id":17,"result":{"decision":"accept"}})
    );
    h.send(json!({"method":"serverRequest/resolved","params":{"threadId":"thread-1","requestId":"17"}}));
    assert!(
        matches!(h.event().await,DriverEvent::PermissionWithdrawn {request_id} if request_id==ids[1])
    );
    h.tx.send(DriverCommand::RespondPermission {
        request_id: ids[1].clone(),
        outcome: crate::driver::PermissionOutcome::Selected("accept".into()),
    })
    .unwrap();
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn interrupt_waits_for_start_id_and_does_not_complete_on_acknowledgement() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.prompt();
    let start = h.wire().await;
    h.tx.send(DriverCommand::Interrupt).unwrap();
    h.send(json!({"id":start["id"],"result":{"turn":{"id":"turn-1","status":"inProgress","items":[]}}}));
    let interrupt = h.wire().await;
    assert_eq!(interrupt["method"], "turn/interrupt");
    assert_eq!(
        interrupt["params"],
        json!({"threadId":"thread-1","turnId":"turn-1"})
    );
    h.send(json!({"id":interrupt["id"],"result":{}}));
    h.send(json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"interrupted","items":[]}}}));
    loop {
        if let DriverEvent::TurnEnded { stop_reason, .. } = h.event().await {
            assert_eq!(stop_reason, StopReason::Cancelled);
            break;
        }
    }
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn secret_questions_are_cancelled_without_forwarding_a_persisted_prompt() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    h.send(json!({"id":"secret","method":"item/tool/requestUserInput","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"i","isBlocking":true,"questions":[{"id":"q","header":"Secret","question":"Enter a private value","isSecret":true}]}}));
    assert_eq!(
        h.wire().await,
        json!({"id":"secret","result":{"answers":{}}})
    );
    loop {
        match h.event().await {
            DriverEvent::UiRequest { .. } => panic!("secret prompt must not be persisted"),
            DriverEvent::Event {
                event: AuraEvent::Notice { message, .. },
                ..
            } if message.starts_with("Secret input") => break,
            _ => {}
        }
    }
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn setting_default_effort_clears_previous_turn_override() {
    let mut h = Harness::start().await;
    h.ready().await;
    for effort in ["high", "default"] {
        let (reply, wait) = tokio::sync::oneshot::channel();
        h.tx.send(DriverCommand::SetOption {
            option_id: "effort".into(),
            value: aura_protocol::session::ConfigValue::Choice {
                value: effort.into(),
            },
            reply,
        })
        .unwrap();
        assert!(wait.await.unwrap().is_ok());
    }
    h.prompt();
    assert_eq!(h.wire().await["params"]["effort"], "medium");
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn a_missing_initialize_reply_stops_only_the_owned_process() {
    let mut h = Harness::start().await;
    h.wire().await;
    let events = async {
        let mut seen = Vec::new();
        while let Some(event) = h.events.recv().await {
            seen.push(event);
        }
        seen
    };
    let seen = timeout(Duration::from_secs(80), events)
        .await
        .expect("bounded startup and kill");
    assert!(
        !seen
            .iter()
            .any(|event| matches!(event, DriverEvent::Ready(_)))
    );
    assert!(matches!(h.run.await.unwrap(), DriverExit::StartFailed(_)));
    assert!(*h.end.killed.borrow());
}

#[tokio::test(start_paused = true)]
async fn a_dropped_receiver_force_stops_even_when_stdout_is_backpressured() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    for _ in 0..1000 {
        h.send(json!({"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"m","delta":"text"}}));
    }
    drop(h.events);
    assert_eq!(
        timeout(Duration::from_secs(2), h.run)
            .await
            .unwrap()
            .unwrap(),
        DriverExit::Closed
    );
    assert!(*h.end.killed.borrow());
}

#[tokio::test(start_paused = true)]
async fn a_late_start_reply_cannot_finish_a_different_turn_or_change_its_identity() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    h.send(json!({"id":999,"result":{"turn":{"id":"wrong","status":"completed","items":[]}}}));
    h.send(json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}}));
    let mut ends = 0;
    while ends == 0 {
        if let DriverEvent::TurnEnded { turn_id, .. } = h.event().await {
            assert_eq!(turn_id, "aura-turn");
            ends += 1;
        }
    }
    h.stop().await;
}

#[tokio::test(start_paused = true)]
async fn explicit_vendor_auth_failure_offers_native_login_without_reading_credentials() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    h.send(json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"failed","items":[],"error":{"message":"Sign in","codexErrorInfo":"unauthorized"}}}}));
    loop {
        if let DriverEvent::AuthRequired(prompt) = h.event().await {
            assert_eq!(prompt.commands[0].argv, ["/bin/codex", "login"]);
            assert!(prompt.commands[0].env.is_empty());
            break;
        }
    }
    while h.events.recv().await.is_some() {}
    assert!(matches!(h.run.await.unwrap(), DriverExit::Crashed { .. }));
}

#[tokio::test(start_paused = true)]
async fn rejected_permission_mode_never_retries_or_sends_a_hidden_prompt() {
    let mut settings = setup();
    settings.autonomy = Autonomy::FullAuto;
    let mut h = Harness::start_with(settings).await;
    let init = h.wire().await;
    h.send(json!({"id":init["id"],"result":{"userAgent":"codex/0.162.1"}}));
    h.wire().await;
    let open = h.wire().await;
    assert_eq!(open["params"]["approvalPolicy"], "never");
    h.wire().await;
    h.send(
        json!({"id":open["id"],"error":{"code":-32600,"message":"Policy disallows full access"}}),
    );
    while h.events.recv().await.is_some() {}
    assert!(matches!(h.run.await.unwrap(), DriverExit::StartFailed(_)));
    while let Ok(line) = h.end.from_client.try_recv() {
        assert!(!line.contains("turn/start"));
    }
}

#[tokio::test(start_paused = true)]
async fn writer_failure_after_an_accepted_send_does_not_wait_for_request_timeout() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.end.from_client.close();
    h.prompt();
    let mut observed = false;
    timeout(Duration::from_secs(12), async {
        while let Some(event) = h.events.recv().await {
            if let DriverEvent::Event {
                event:
                    AuraEvent::Error {
                        kind: aura_protocol::ErrorKind::AgentExited,
                        ..
                    },
                ..
            } = event
            {
                observed = true;
            }
        }
    })
    .await
    .expect("writer failure and owned shutdown are prompt");
    assert!(observed);
    assert!(*h.end.killed.borrow());
    assert!(matches!(h.run.await.unwrap(), DriverExit::Crashed { .. }));
}

#[tokio::test(start_paused = true)]
async fn an_unanswered_callback_is_cancelled_before_turn_completion() {
    let mut h = Harness::start().await;
    h.ready().await;
    h.begin().await;
    h.send(json!({"id":"approval","method":"item/fileChange/requestApproval","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"files","startedAtMs":1}}));
    loop {
        if matches!(h.event().await, DriverEvent::Permission { .. }) {
            break;
        }
    }
    h.send(json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}}));
    assert_eq!(
        h.wire().await,
        json!({"id":"approval","result":{"decision":"cancel"}})
    );
    assert!(matches!(
        h.event().await,
        DriverEvent::PermissionWithdrawn { .. }
    ));
    assert!(matches!(h.event().await, DriverEvent::TurnEnded { .. }));
    h.stop().await;
}
