//! Admission, descriptors and per-native-session persistence for native controls.
use super::*;
use aura_drivers::controls::{ACCESS, WORKFLOW};
use aura_protocol::session::{
    SessionControl, SessionControlChange, SessionControlChoice, SessionControlPreferences,
    SessionControls,
};

pub(super) fn is_control(id: &str) -> bool {
    matches!(id, ACCESS | WORKFLOW)
}
pub(super) fn preferences(session: Option<&AgentSessionRow>) -> SessionControlPreferences {
    match session.and_then(|s| s.controls_json.as_deref()) {
        None => SessionControlPreferences::default(),
        Some(json) => serde_json::from_str(json).unwrap_or(SessionControlPreferences {
            version: u32::MAX,
            access: None,
            workflow: Some("invalid_saved_controls".into()),
        }),
    }
}
fn legacy(value: Autonomy) -> (&'static str, &'static str) {
    match value {
        Autonomy::FullAuto => ("legacy:full_auto", "Full access"),
        Autonomy::AutoEdit => ("legacy:auto_edit", "Allow edits"),
        Autonomy::Ask => ("legacy:ask", "Ask for approval"),
    }
}
fn descriptor(options: &[ConfigOption], id: &str, requested: Option<String>) -> SessionControl {
    let mut result = SessionControl {
        requested,
        ..Default::default()
    };
    if let Some(option) = options.iter().find(|o| o.id == id) {
        if let ConfigKind::Select { current, choices } = &option.kind {
            result.effective = Some(current.clone());
            result.choices = choices
                .iter()
                .map(|c| SessionControlChoice {
                    value: c.value.clone(),
                    name: c.name.clone(),
                    description: c.description.clone(),
                    legacy_autonomy: None,
                })
                .collect();
        }
        result.pending = option.pending.as_ref().and_then(choice_value);
        result.note = option.description.clone();
    }
    if result.requested.is_none() {
        result.requested = result.effective.clone();
    }
    if result
        .requested
        .as_ref()
        .is_some_and(|v| !result.choices.iter().any(|c| &c.value == v))
    {
        result.note = Some(
            "The saved native setting is unavailable. Select an offered value before sending."
                .into(),
        );
    }
    if result.note.is_none() && result.requested.is_some() && result.requested != result.effective {
        result.note = Some("The requested native setting has not taken effect. Sending is paused until it is applied or you select another setting.".into());
    }
    result
}
fn choice_value(value: &ConfigValue) -> Option<String> {
    match value {
        ConfigValue::Choice { value } => Some(value.clone()),
        _ => None,
    }
}
impl ChatActor {
    pub(super) fn control_lists(&self) -> SessionControls {
        let mut access = descriptor(&self.options, ACCESS, self.controls.access.clone());
        if access.choices.is_empty() {
            access.requested = self
                .controls
                .access
                .clone()
                .or_else(|| Some(legacy(self.autonomy).0.into()));
            access.effective = if self
                .autonomy_state
                .note
                .as_ref()
                .is_some_and(|s| s.contains("refused"))
            {
                None
            } else {
                Some(legacy(self.autonomy_state.requested).0.into())
            };
            if self.controls.access.is_some() {
                access.effective = None;
            }
            access.choices = self.capabilities.as_ref().map(|c| c.autonomy_levels.iter().map(|v| { let (id,name) = legacy(*v); SessionControlChoice { value: id.into(), name: name.into(), description: Some(match v { Autonomy::FullAuto => "Use this connection full native access setting; native restrictions remain in effect.", Autonomy::AutoEdit => "Allow native file edits, with other operations governed by this connection approval policy.", Autonomy::Ask => "Use this connection approval policy for access requests." }.into()), legacy_autonomy: Some(*v) } }).collect()).unwrap_or_default();
        }
        access.native_mode = self.autonomy_state.native_mode.clone();
        access.note = access.note.or_else(|| self.autonomy_state.note.clone());
        let mut workflow = descriptor(&self.options, WORKFLOW, self.controls.workflow.clone());
        if workflow.choices.is_empty() && workflow.note.is_none() {
            workflow.note =
                Some("This connection does not advertise a native Plan control.".into());
        }
        if let Some((id, value)) = &self.control_pending {
            let target = if id == ACCESS {
                &mut access
            } else {
                &mut workflow
            };
            target.pending = choice_value(value);
            target.requested = target.pending.clone();
        }
        SessionControls {
            version: 1,
            access,
            workflow,
        }
    }
    pub(super) fn native_desired(&self) -> BTreeMap<String, ConfigValue> {
        let mut desired = self.desired.clone();
        if let Some(value) = &self.controls.access {
            desired.insert(
                ACCESS.into(),
                ConfigValue::Choice {
                    value: value.clone(),
                },
            );
        }
        if let Some(value) = &self.controls.workflow {
            desired.insert(
                WORKFLOW.into(),
                ConfigValue::Choice {
                    value: value.clone(),
                },
            );
        }
        desired
    }
    pub(super) fn controls_valid(&self) -> bool {
        preferences_match(&self.controls, &self.options)
            && self.desired.iter().all(|(id, value)| {
                let mode = self
                    .options
                    .iter()
                    .find(|o| &o.id == id && o.category == ConfigCategory::Mode);
                if mode.is_none() && !matches!(id.as_str(), "mode" | "legacy-mode") {
                    return true;
                }
                mode.is_some_and(|option| match (&option.kind, value) {
                    (ConfigKind::Select { current, choices }, ConfigValue::Choice { value }) => {
                        current == value && choices.iter().any(|c| c.value == *value)
                    }
                    (ConfigKind::Toggle { current }, ConfigValue::Toggle { value }) => {
                        current == value
                    }
                    _ => false,
                })
            })
    }
    pub(super) fn controls_idle(&self) -> bool {
        self.status == SessionStatus::Ready
            && self.turn.is_none()
            && self.queue.is_empty()
            && !self.normalizer.has_open_requests()
            && self.control_pending.is_none()
            && !self.organizing
            && !self.mcp_pending
            && !self.steering_pending
            && self.git_reservation.is_none()
            && self.checkpointing.is_none()
            && self.native_identity_pending.is_none()
            && self.driver.as_ref().is_some_and(|d| {
                d.ready && d.stop == Stop::None && d.run_idle.is_none_or(|idle| idle)
            })
    }
    pub(super) fn set_control(
        &mut self,
        change: SessionControlChange,
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    ) {
        if !self.controls_idle() {
            let _ = reply.send(Err(SessionError::OptionInvalid("Wait until the agent is idle, clear queued messages and answer pending approvals before changing native controls.".into())));
            return;
        }
        let controls = self.control_lists();
        let (id, value) = match change {
            SessionControlChange::Access { value } => {
                let Some(choice) = controls.access.choices.iter().find(|c| c.value == value) else {
                    let _ = reply.send(Err(SessionError::OptionInvalid(
                        "This connection does not offer that access setting.".into(),
                    )));
                    return;
                };
                if controls.workflow.effective.as_deref() == Some("plan") {
                    let _ = reply.send(Err(SessionError::OptionInvalid(
                        "Leave Plan with implementation approval before changing execution access."
                            .into(),
                    )));
                    return;
                }
                if let Some(autonomy) = choice.legacy_autonomy {
                    self.control_pending = Some((
                        ACCESS.into(),
                        ConfigValue::Choice {
                            value: value.clone(),
                        },
                    ));
                    self.info_dirty = true;
                    self.schedule_flush();
                    self.set_autonomy_inner(autonomy, reply, true);
                    return;
                }
                (ACCESS, value)
            }
            SessionControlChange::Workflow {
                value,
                implementation_approved,
            } => {
                if !controls.workflow.choices.iter().any(|c| c.value == value) {
                    let _ = reply.send(Err(SessionError::OptionInvalid(
                        "This connection does not offer that workflow.".into(),
                    )));
                    return;
                }
                if value == "execute"
                    && controls.workflow.effective.as_deref() != Some("execute")
                    && !implementation_approved
                {
                    let _ = reply.send(Err(SessionError::OptionInvalid(
                        "Approve implementation explicitly before leaving Plan.".into(),
                    )));
                    return;
                }
                (WORKFLOW, value)
            }
        };
        let value = ConfigValue::Choice { value };
        self.control_pending = Some((id.into(), value.clone()));
        self.revision = self.revision.wrapping_add(1);
        self.info_dirty = true;
        self.schedule_flush();
        self.set_option_inner(id.into(), value, reply, true);
    }
    pub(super) fn observe_native_controls(&mut self) {
        if self.controls.version != 1 || self.control_pending.is_some() {
            return;
        }
        let effective = self.control_lists().workflow.effective;
        if effective.as_deref() == Some("plan") && self.controls.workflow.is_none() {
            self.control_applied(
                WORKFLOW,
                &ConfigValue::Choice {
                    value: "plan".into(),
                },
            );
        } else if effective.as_deref() == Some("execute")
            && self.controls.workflow.as_deref() == Some("plan")
            && self.implementation_approved
        {
            self.implementation_approved = false;
            self.controls.access =
                self.options
                    .iter()
                    .find(|o| o.id == ACCESS)
                    .and_then(|o| match &o.kind {
                        ConfigKind::Select { current, choices }
                            if choices.iter().any(|c| c.value == *current) =>
                        {
                            Some(current.clone())
                        }
                        _ => None,
                    });
            self.control_applied(
                WORKFLOW,
                &ConfigValue::Choice {
                    value: "execute".into(),
                },
            );
        }
    }
    pub(super) fn control_applied(&mut self, id: &str, value: &ConfigValue) {
        let Some(value) = choice_value(value) else {
            return;
        };
        self.controls.version = 1;
        if id == ACCESS {
            self.controls.access = Some(value);
        } else {
            if value == "plan" && self.controls.access.is_none() {
                self.controls.access =
                    self.options
                        .iter()
                        .find(|o| o.id == ACCESS)
                        .and_then(|o| match &o.kind {
                            ConfigKind::Select { current, choices }
                                if !current.is_empty()
                                    && choices.iter().any(|c| c.value == *current) =>
                            {
                                Some(current.clone())
                            }
                            _ => None,
                        });
            }
            self.controls.workflow = Some(value);
        }
        let mut legacy_changed = false;
        for option in &self.options {
            if option.category == ConfigCategory::Mode && self.desired.contains_key(&option.id) {
                let value = match &option.kind {
                    ConfigKind::Select { current, .. } => ConfigValue::Choice {
                        value: current.clone(),
                    },
                    ConfigKind::Toggle { current } => ConfigValue::Toggle { value: *current },
                };
                self.desired.insert(option.id.clone(), value);
                legacy_changed = true;
            }
        }
        if legacy_changed {
            self.persist_desired();
        }
        let Some(session) = &mut self.agent_session else {
            return;
        };
        let controls_json = serde_json::to_string(&self.controls).ok();
        session.controls_json = controls_json.clone();
        let id = session.id.clone();
        self.queue_op(Op::UpdateAgentSession {
            id,
            patch: AgentSessionPatch {
                capabilities: None,
                native_session_id: None,
                model: None,
                effort: None,
                autonomy: None,
                config_json: None,
                controls_json,
                updated_at: now_millis(),
            },
        });
    }
}

fn preferences_match(preferences: &SessionControlPreferences, options: &[ConfigOption]) -> bool {
    preferences.version == 1 && [(ACCESS, &preferences.access), (WORKFLOW, &preferences.workflow)].iter().all(|(id,value)| {
        value.as_ref().is_none_or(|v| options.iter().any(|o| o.id == *id && matches!(&o.kind, ConfigKind::Select { current, choices } if current == v && choices.iter().any(|c| c.value == *v))))
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_legacy_preferences_are_compatible_but_unknown_or_unapplied_values_block_execution() {
        let options = vec![aura_drivers::controls::workflow("execute")];
        let mut preferences = SessionControlPreferences::default();
        assert!(preferences_match(&preferences, &options));
        preferences.workflow = Some("future-mode".into());
        assert!(!preferences_match(&preferences, &options));
        preferences.workflow = Some("plan".into());
        assert!(!preferences_match(&preferences, &options));
        preferences.workflow = Some("execute".into());
        assert!(preferences_match(&preferences, &options));
        preferences.version = 2;
        assert!(!preferences_match(&preferences, &options));
        assert_eq!(
            self::super::preferences(None),
            SessionControlPreferences::default()
        );
    }
}
