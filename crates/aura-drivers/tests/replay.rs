//! Every fixture under `tests/fixtures/acp` replays to its golden, keeps the driver contract, and
//! holds no personal data. `AURA_UPDATE_GOLDEN=1` rewrites the goldens.
#![cfg(feature = "replay")]

#[cfg(test)]
mod replay {
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::{Path, PathBuf};

    use aura_drivers::driver::{DriverEvent, LoggedCommand};
    use aura_drivers::replay::{
        Fixture, FixtureRecord, ReplayReport, assert_golden, golden_path, run, scan_clean,
    };
    use aura_protocol::AuraEvent;
    use serde_json::Value;

    fn fixture_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/acp")
    }

    /// Every `.jsonl` fixture, sorted.
    fn fixtures() -> Vec<PathBuf> {
        let mut found = Vec::new();
        let mut folders = vec![fixture_root()];
        while let Some(folder) = folders.pop() {
            for entry in std::fs::read_dir(&folder).expect("a fixture folder") {
                let path = entry.expect("an entry").path();
                if path.is_dir() {
                    folders.push(path);
                } else if path
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
                {
                    found.push(path);
                }
            }
        }
        found.sort();
        found
    }

    fn events_of(report: &ReplayReport) -> Vec<DriverEvent> {
        report
            .events
            .iter()
            .map(|event| serde_json::from_value(event.clone()).expect("a driver event"))
            .collect()
    }

    /// The driver contract (spec 5.1) over one replay: what may come before `Ready`, exactly one
    /// `TurnEnded` per prompt after every event tagged with its turn, tags that name prompted
    /// turns, and the events a driver never emits.
    fn contract_violations(fixture: &Fixture, report: &ReplayReport) -> Vec<String> {
        let events = events_of(report);
        let mut violations = Vec::new();
        let prompts: Vec<String> = fixture
            .records
            .iter()
            .filter_map(|record| match record {
                FixtureRecord::Cmd(LoggedCommand::Prompt { turn_id, .. }) => Some(turn_id.clone()),
                _ => None,
            })
            .collect();
        let readies = events
            .iter()
            .filter(|event| matches!(event, DriverEvent::Ready(_)))
            .count();
        let exit_type = report
            .exit
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if readies > 1 {
            violations.push(format!("{readies} Ready events"));
        }
        if (readies == 0) != (exit_type == "start_failed") {
            violations.push(format!("{readies} Ready events and the exit {exit_type}"));
        }

        // Rule 1.
        let before_ready = events
            .iter()
            .take_while(|event| !matches!(event, DriverEvent::Ready(_)));
        for event in before_ready {
            let allowed = match event {
                DriverEvent::Status(_)
                | DriverEvent::Options(_)
                | DriverEvent::Commands(_)
                | DriverEvent::Title(_)
                | DriverEvent::Autonomy(_)
                | DriverEvent::AuthRequired(_) => true,
                DriverEvent::Event { turn: None, event } => {
                    matches!(event, AuraEvent::Notice { .. } | AuraEvent::UsageUpdated(_))
                }
                DriverEvent::Permission { turn: None, .. }
                | DriverEvent::UiRequest { turn: None, .. } => true,
                _ => false,
            };
            if !allowed {
                violations.push(format!("before Ready: {event:?}"));
            }
        }

        // Rules 2 and 8.
        let mut ended: BTreeMap<String, usize> = BTreeMap::new();
        for (index, event) in events.iter().enumerate() {
            let tag = match event {
                DriverEvent::Event { turn, .. }
                | DriverEvent::Permission { turn, .. }
                | DriverEvent::UiRequest { turn, .. } => turn.clone(),
                DriverEvent::TurnEnded { turn_id, .. } => {
                    if !prompts.contains(turn_id) {
                        violations
                            .push(format!("TurnEnded for {turn_id}, which no prompt started"));
                    }
                    if ended.insert(turn_id.clone(), index).is_some() {
                        violations.push(format!("a second TurnEnded for {turn_id}"));
                    }
                    None
                }
                _ => None,
            };
            if let Some(tag) = tag {
                if !prompts.contains(&tag) {
                    violations.push(format!("an event tagged {tag}, which no prompt started"));
                }
                if ended.contains_key(&tag) {
                    violations.push(format!(
                        "an event tagged {tag} after its TurnEnded: {event:?}"
                    ));
                }
            }
            if let DriverEvent::Event { event, .. } = event
                && matches!(
                    event,
                    AuraEvent::TurnStarted { .. }
                        | AuraEvent::TurnEnded { .. }
                        | AuraEvent::UserMessageDelta { .. }
                        | AuraEvent::SessionUpdated(_)
                        | AuraEvent::PromptLifecycle { .. }
                        | AuraEvent::PermissionRequested(_)
                        | AuraEvent::PermissionResolved { .. }
                        | AuraEvent::UiRequest(_)
                        | AuraEvent::UiResolved { .. }
                )
            {
                violations.push(format!("a driver never emits {event:?}"));
            }
        }
        for (position, turn_id) in prompts.iter().enumerate() {
            let last = position + 1 == prompts.len();
            let run_ended_first = matches!(exit_type, "crashed" | "closed");
            if !ended.contains_key(turn_id) && !(last && run_ended_first) {
                violations.push(format!("no TurnEnded for {turn_id}"));
            }
        }
        violations
    }

    #[tokio::test(start_paused = true)]
    async fn every_fixture_replays_to_its_golden_and_keeps_the_contract() {
        let paths = fixtures();
        assert!(
            paths.len() >= 32,
            "the synthetic fixtures are there: {}",
            paths.len()
        );
        let mut failures = Vec::new();
        for path in &paths {
            let fixture = Fixture::load(path).expect("the fixture parses");
            let report = run(&fixture).await;
            let violations = contract_violations(&fixture, &report);
            if !violations.is_empty() {
                failures.push(format!("{}: {}", fixture.name, violations.join("; ")));
            }
            let golden = golden_path(path);
            if let Err(panic) = std::panic::catch_unwind(|| assert_golden(&report, &golden)) {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|text| (*text).to_owned()))
                    .unwrap_or_default();
                failures.push(message);
            }
        }
        assert!(failures.is_empty(), "\n{}", failures.join("\n\n"));
    }

    #[test]
    fn committed_fixtures_and_goldens_hold_no_personal_data() {
        for path in fixtures() {
            for file in [path.clone(), golden_path(&path)] {
                let Ok(text) = std::fs::read_to_string(&file) else {
                    continue;
                };
                let findings = scan_clean(&text);
                assert!(
                    findings.is_empty(),
                    "{}: {}",
                    file.display(),
                    findings.join("; ")
                );
            }
        }
    }

    #[test]
    fn every_spec_scenario_has_a_fixture() {
        let names: BTreeSet<String> = fixtures()
            .iter()
            .filter_map(|path| {
                path.file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
            })
            .collect();
        for scenario in [
            "new-session",
            "new-session-early-update",
            "legacy-models-modes",
            "load-replay",
            "open-replay-long",
            "resume-fallback",
            "resume-fallback-method",
            "resume-error-keeps-id",
            "hermes-continued-after-quit",
            "hermes-replay-matches",
            "auth-required",
            "protocol-mismatch",
            "turn-basic",
            "unknown-update",
            "prompt-auth-error",
            "prompt-error",
            "permission-ask",
            "permission-full-auto",
            "permission-withdrawn",
            "permission-outside-turn",
            "permission-during-setup",
            "question-kind-other",
            "updates-after-reply",
            "hand-picked-mode",
            "cancel",
            "agent-requests",
            "garbage",
            "oversized",
            "eof-mid-turn",
            "exit-with-buffered-output",
            "mode-idle-only",
            "claude-no-bypass",
            "hermes-usage-session",
        ] {
            assert!(names.contains(scenario), "no fixture for {scenario}");
        }
    }
}
