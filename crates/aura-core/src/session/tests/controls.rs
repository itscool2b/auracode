use super::*;
use aura_drivers::driver::{DriverCommand, LoggedCommand};
use aura_protocol::session::{ConfigValue, SessionControlChange, SessionControlPreferences};

struct NativeControls;
impl AgentDriver for NativeControls {
    fn run(self: Box<Self>, mut ctx: DriverContext) -> BoxFuture<'static, DriverExit> {
        async move {
            let mut access = "default".to_owned();
            let mut workflow = "execute".to_owned();
            let mut active = None;
            let options = |access: &str, workflow: &str| {
                DriverEvent::Options(vec![
                    aura_drivers::controls::select(
                        aura_drivers::controls::ACCESS,
                        "Access",
                        access,
                        vec![
                            aura_drivers::controls::choice("default", "Ask"),
                            aura_drivers::controls::choice("future-access", "Future native access"),
                        ],
                    ),
                    aura_drivers::controls::workflow(workflow),
                ])
            };
            let event = options(&access, &workflow);
            ctx.events
                .reserve(event.approx_bytes())
                .await
                .unwrap()
                .send(event);
            let Step::Emit(event) = ready_step("control-native") else {
                unreachable!()
            };
            ctx.events
                .reserve(event.approx_bytes())
                .await
                .unwrap()
                .send(event);
            while let Some(command) = ctx.commands.recv().await {
                match command {
                    DriverCommand::SetOption {
                        option_id,
                        value,
                        reply,
                    } => {
                        if let ConfigValue::Choice { value } = value {
                            if option_id == aura_drivers::controls::ACCESS {
                                access = value;
                            } else {
                                workflow = value;
                            }
                        }
                        let event = options(&access, &workflow);
                        ctx.events
                            .reserve(event.approx_bytes())
                            .await
                            .unwrap()
                            .send(event);
                        let _ = reply.send(Ok(()));
                    }
                    DriverCommand::Prompt { turn, .. } => {
                        active = Some(turn.turn_id);
                    }
                    DriverCommand::Interrupt => {
                        if let Some(turn_id) = active.take() {
                            let event = DriverEvent::TurnEnded {
                                turn_id,
                                stop_reason: StopReason::Cancelled,
                                usage: None,
                                error: None,
                            };
                            ctx.events
                                .reserve(event.approx_bytes())
                                .await
                                .unwrap()
                                .send(event);
                        }
                    }
                    DriverCommand::Shutdown { .. } => break,
                    _ => {}
                }
            }
            DriverExit::Closed
        }
        .boxed()
    }
}
fn native_rig() -> Rig {
    rig_with(
        Arc::new(OneDriver(Mutex::new(Some(Box::new(NativeControls))))),
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    )
}
#[tokio::test]
async fn native_controls_keep_custom_access_and_plan_persistence_separate_from_flat_options() {
    let rig = native_rig();
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let lists = rig
        .manager
        .set_control(
            &chat.id,
            SessionControlChange::Access {
                value: "future-access".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        lists.controls.access.effective.as_deref(),
        Some("future-access")
    );
    assert!(
        rig.manager
            .set_control(
                &chat.id,
                SessionControlChange::Access {
                    value: "not-offered".into()
                }
            )
            .await
            .is_err()
    );
    let lists = rig
        .manager
        .set_control(
            &chat.id,
            SessionControlChange::Workflow {
                value: "plan".into(),
                implementation_approved: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(lists.controls.workflow.effective.as_deref(), Some("plan"));
    assert!(
        rig.manager
            .set_control(
                &chat.id,
                SessionControlChange::Workflow {
                    value: "execute".into(),
                    implementation_approved: false
                }
            )
            .await
            .is_err()
    );
    assert!(
        rig.manager
            .set_option(
                &chat.id,
                aura_drivers::controls::WORKFLOW,
                ConfigValue::Choice {
                    value: "execute".into()
                }
            )
            .await
            .is_err()
    );
    let lists = rig
        .manager
        .set_control(
            &chat.id,
            SessionControlChange::Workflow {
                value: "execute".into(),
                implementation_approved: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        lists.controls.workflow.effective.as_deref(),
        Some("execute")
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
    let loaded = rig.store.load_chat(&chat.id).await.unwrap();
    let saved = loaded.agent_session.unwrap();
    let controls: SessionControlPreferences =
        serde_json::from_str(saved.controls_json.as_deref().unwrap()).unwrap();
    assert_eq!(controls.access.as_deref(), Some("future-access"));
    assert_eq!(controls.workflow.as_deref(), Some("execute"));
    let flat: serde_json::Value =
        serde_json::from_str(saved.config_json.as_deref().unwrap()).unwrap();
    assert!(flat.get(aura_drivers::controls::WORKFLOW).is_none());
    assert!(flat.get(aura_drivers::controls::ACCESS).is_none());
}
#[tokio::test]
async fn queued_or_running_work_cannot_cross_a_native_plan_transition() {
    let rig = native_rig();
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager.send(&chat.id, "first".into()).await.unwrap();
    assert!(
        rig.manager
            .send(&chat.id, "queued".into())
            .await
            .unwrap()
            .queued
    );
    assert!(
        rig.manager
            .set_control(
                &chat.id,
                SessionControlChange::Workflow {
                    value: "plan".into(),
                    implementation_approved: false
                }
            )
            .await
            .is_err()
    );
    rig.manager.interrupt(&chat.id).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert!(
        rig.manager
            .set_control(
                &chat.id,
                SessionControlChange::Workflow {
                    value: "plan".into(),
                    implementation_approved: false
                }
            )
            .await
            .is_err(),
        "a held queue also blocks idle transitions"
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
#[tokio::test]
async fn unsupported_access_is_not_presented_as_available() {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("limited"),
        Step::Expect(CommandMatch::Shutdown),
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert!(
        rig.manager
            .lists(&chat.id)
            .await
            .unwrap()
            .controls
            .access
            .choices
            .is_empty()
    );
    assert!(
        rig.manager
            .set_control(
                &chat.id,
                SessionControlChange::Access {
                    value: "legacy:full_auto".into()
                }
            )
            .await
            .is_err()
    );
    assert!(
        !handle
            .commands()
            .iter()
            .any(|c| matches!(c, LoggedCommand::SetAutonomy { .. }))
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}

#[tokio::test]
async fn only_explicit_native_plan_approval_allows_a_reported_execution_transition() {
    for approved in [false, true] {
        let options = |workflow: &str| {
            DriverEvent::Options(vec![
                aura_drivers::controls::select(
                    aura_drivers::controls::ACCESS,
                    "Access",
                    "default",
                    vec![aura_drivers::controls::choice("default", "Ask")],
                ),
                aura_drivers::controls::workflow(workflow),
            ])
        };
        let (driver, handle) =
            ScriptedDriver::new(vec![Step::Emit(options("plan")), ready_step("native-plan")]);
        let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
        let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
        status(&rig, &chat.id, SessionStatus::Ready).await;
        if approved {
            handle.emit(DriverEvent::Permission {
                turn: None,
                request: aura_protocol::PermissionRequest {
                    request_id: "implement".into(),
                    tool_call_id: None,
                    title: "Implement the plan?".into(),
                    kind: Some(aura_protocol::ToolKind::SwitchMode),
                    raw_input: None,
                    content: Vec::new(),
                    locations: Vec::new(),
                    options: vec![aura_protocol::PermissionOption {
                        option_id: "yes".into(),
                        kind: aura_protocol::PermissionOptionKind::AllowOnce,
                        label: "Approve".into(),
                    }],
                    truncated: None,
                },
            });
            eventually("native approval card", || {
                lock(&rig.statuses.updates)
                    .iter()
                    .rev()
                    .find(|u| u.chat_id == chat.id)
                    .is_some_and(|u| u.needs_attention)
            })
            .await;
            rig.manager
                .respond_permission(&chat.id, "implement", Some("yes".into()))
                .await
                .unwrap();
        }
        handle.emit(options("execute"));
        tokio::time::sleep(Duration::from_millis(20)).await;
        let lists = rig.manager.lists(&chat.id).await.unwrap();
        assert_eq!(
            lists.controls.workflow.requested.as_deref(),
            Some(if approved { "execute" } else { "plan" })
        );
        if !approved {
            assert!(rig.manager.send(&chat.id, "do work".into()).await.is_err());
        }
        rig.manager.shutdown_all(Duration::from_secs(5)).await;
    }
}

/// The owner's report: a plan approved during a turn, the turn stopped, and Send refused until
/// Execute was chosen again. The approval must carry the session out of Plan by itself.
#[tokio::test]
async fn a_plan_approved_mid_turn_still_sends_after_stop() {
    let options = |workflow: &str| {
        DriverEvent::Options(vec![
            aura_drivers::controls::select(
                aura_drivers::controls::ACCESS,
                "Access",
                "bypassPermissions",
                vec![aura_drivers::controls::choice(
                    "bypassPermissions",
                    "Full access",
                )],
            ),
            aura_drivers::controls::workflow(workflow),
        ])
    };
    let (driver, handle) = ScriptedDriver::new(vec![
        Step::Emit(options("plan")),
        ready_step("plan-then-stop"),
        Step::Expect(CommandMatch::Prompt),
        Step::Expect(CommandMatch::RespondPermission {
            request_id: Some("exit-plan".into()),
        }),
        Step::Expect(CommandMatch::Interrupt),
        Step::EndTurn {
            stop_reason: StopReason::Cancelled,
            usage: None,
            error: None,
        },
        Step::Expect(CommandMatch::Prompt),
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager.send(&chat.id, "plan it".into()).await.unwrap();
    handle.wait_for(CommandMatch::Prompt).await;
    handle.emit(DriverEvent::Permission {
        turn: None,
        request: aura_protocol::PermissionRequest {
            request_id: "exit-plan".into(),
            tool_call_id: None,
            title: "ExitPlanMode".into(),
            kind: Some(aura_protocol::ToolKind::SwitchMode),
            raw_input: Some(serde_json::json!({"plan": "# Plan"})),
            content: Vec::new(),
            locations: Vec::new(),
            options: vec![aura_protocol::PermissionOption {
                option_id: "allow".into(),
                kind: aura_protocol::PermissionOptionKind::AllowOnce,
                label: "Allow once".into(),
            }],
            truncated: None,
        },
    });
    eventually("plan approval card", || {
        lock(&rig.statuses.updates)
            .iter()
            .rev()
            .find(|u| u.chat_id == chat.id)
            .is_some_and(|u| u.needs_attention)
    })
    .await;
    rig.manager
        .respond_permission(&chat.id, "exit-plan", Some("allow".into()))
        .await
        .unwrap();
    // Claude leaves Plan on its own and reports it while the turn goes on.
    handle.emit(options("execute"));
    tokio::time::sleep(Duration::from_millis(20)).await;
    rig.manager.interrupt(&chat.id).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let lists = rig.manager.lists(&chat.id).await.unwrap();
    assert_eq!(
        lists.controls.workflow.requested.as_deref(),
        Some("execute")
    );
    rig.manager
        .send(&chat.id, "keep going".into())
        .await
        .expect("a message after Stop sends without choosing Execute again");
    handle.wait_for(CommandMatch::Prompt).await;
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}

#[tokio::test]
async fn legacy_live_access_obeys_native_idle_queue_and_approval_admission_but_stopped_defaults_remain_editable()
 {
    let (driver, handle) = ScriptedDriver::new(vec![
        ready_step("legacy-admission"),
        Step::Expect(CommandMatch::Prompt),
        Step::Expect(CommandMatch::Interrupt),
        Step::EndTurn {
            stop_reason: StopReason::Cancelled,
            usage: None,
            error: None,
        },
    ]);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager.send(&chat.id, "running".into()).await.unwrap();
    handle.wait_for(CommandMatch::Prompt).await;
    assert!(
        rig.manager
            .set_autonomy(&chat.id, Autonomy::Ask)
            .await
            .is_err()
    );
    let queued = rig.manager.send(&chat.id, "queued".into()).await.unwrap();
    assert!(queued.queued);
    rig.manager.interrupt(&chat.id).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert!(
        rig.manager
            .set_autonomy(&chat.id, Autonomy::Ask)
            .await
            .is_err(),
        "held queue blocks legacy access changes"
    );
    rig.manager
        .cancel_queued(&chat.id, &queued.prompt_id)
        .await
        .unwrap();
    rig.manager
        .set_autonomy(&chat.id, Autonomy::Ask)
        .await
        .unwrap();
    handle.emit(DriverEvent::Permission {
        turn: None,
        request: aura_protocol::PermissionRequest {
            request_id: "access-approval".into(),
            tool_call_id: None,
            title: "Allow read?".into(),
            kind: Some(aura_protocol::ToolKind::Read),
            raw_input: None,
            content: Vec::new(),
            locations: Vec::new(),
            options: vec![aura_protocol::PermissionOption {
                option_id: "allow".into(),
                kind: aura_protocol::PermissionOptionKind::AllowOnce,
                label: "Allow".into(),
            }],
            truncated: None,
        },
    });
    eventually("approval shown", || {
        lock(&rig.statuses.updates)
            .iter()
            .rev()
            .find(|u| u.chat_id == chat.id)
            .is_some_and(|u| u.needs_attention)
    })
    .await;
    assert!(
        rig.manager
            .set_autonomy(&chat.id, Autonomy::FullAuto)
            .await
            .is_err()
    );
    rig.manager
        .respond_permission(&chat.id, "access-approval", None)
        .await
        .unwrap();
    rig.manager.stop(&chat.id).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Stopped).await;
    let lists = rig
        .manager
        .set_autonomy(&chat.id, Autonomy::FullAuto)
        .await
        .unwrap();
    assert_eq!(lists.autonomy.requested, Autonomy::FullAuto);
    assert_eq!(
        handle
            .commands()
            .iter()
            .filter(|c| matches!(c, LoggedCommand::SetAutonomy { .. }))
            .count(),
        1,
        "only the idle live choice reached the native driver"
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
