//! `aura-cli probe <agent> [--env NAME=VALUE]... [--folder <dir>]`: the free probe steps of spec
//! 10.2 through the headless session manager. No prompt is ever sent.
//!
//! | Step | What it does |
//! |---|---|
//! | 0 install | npm adapters: the one-time install's time and size, no bundled platform CLI, `npm prefix` in the adapter folder; a first install is interrupted once (step 9's second half), then done cleanly |
//! | 1 initialize | from the protocol log: the agent's name and version, protocol version, capabilities, auth methods, time to answer; nothing used the hostile chat folder's npm files |
//! | 2 session | the options, the legacy models and modes, the current model, anything asked before ready |
//! | 3 commands | after 3 s: the slash commands and the largest commands update |
//! | 4 options, autonomy | every option set to its current value; the model switched and back (Hermes: what a second session reports meanwhile); Full auto, Auto-edit, Ask and back, against the dialect's candidates |
//! | 5 cancel | an interrupt while idle changes nothing |
//! | 6 close | Stop: stdin closed, the exit and the shutdown steps; nothing left in the process table (Unix) |
//! | 7 resume | Start again: the native session continues, no transcript comes back, the options are back |
//! | 8 auth | an agent that needs a sign-in: its card (codex-acp with `--env CODEX_HOME=<empty folder>`) |
//! | 9 interrupt | an interrupt right after initialize stops the start with nothing left, and the next start works |
//!
//! Step 10 (a Finder launch of a built app) stays manual. Each spawn leaves a protocol log, and the
//! probe ends by naming each log with the `probe-*` fixture it can become.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use aura_agents::{AgentSpec, Recipe};
use aura_drivers::acp::dialect::dialect_for;
use aura_process::ptable::ProcInfo;
use aura_process::{HelperEnv, HelperSpec, find_program, run_helper};
use aura_protocol::session::{
    Availability, ConfigCategory, ConfigChoice, ConfigKind, ConfigOption, ConfigValue, SessionLists,
};
use aura_protocol::{AuraEvent, AutoAnswer, Autonomy, AutonomyState, DriverKind, SessionStatus};
use serde_json::Value;

use crate::CliError;
use crate::args::ProbeArgs;
use crate::chat::{ChatRun, StartEnd};
use crate::headless::Headless;
use crate::logs;
use crate::out::Out;
use crate::ps;
use crate::repo::HOSTILE_MARK;
use crate::report::{Outcome, Report};
use crate::watch::Watch;

/// How long the probe waits for each thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProbeTimings {
    /// A start: an adapter's first install (10 min) and the agent's own start (60 s), with margin.
    pub start: Duration,
    /// A stop: the chain's 10 s and the session's forced stop at 15 s, with margin.
    pub stop: Duration,
    /// Step 3's wait for the slash commands.
    pub commands: Duration,
    /// How long the session must stay ready after step 5's interrupt.
    pub settle: Duration,
    /// How long a written record may take to reach the log file.
    pub log: Duration,
    /// How long a first install runs before step 9 interrupts it.
    pub install_run: Duration,
}

impl ProbeTimings {
    pub const STANDARD: ProbeTimings = ProbeTimings {
        start: Duration::from_secs(12 * 60),
        stop: Duration::from_secs(30),
        commands: Duration::from_secs(3),
        settle: Duration::from_millis(500),
        log: Duration::from_secs(5),
        install_run: Duration::from_secs(2),
    };
}

/// Words cheaper models carry in their ids or names, cheapest first.
const CHEAP_MARKERS: [&str; 8] = [
    "haiku",
    "nano",
    "mini",
    "flash-lite",
    "lite",
    "flash",
    "small",
    "fast",
];

/// The names `--env` sets, for messages; values are never printed.
fn env_names(args: &ProbeArgs) -> String {
    args.env
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn run(
    headless: &Headless,
    args: &ProbeArgs,
    folder: &Path,
    hostile: bool,
    timings: ProbeTimings,
    out: &Out,
) -> Result<Outcome, CliError> {
    let spec = headless
        .detector
        .spec(&args.agent)
        .ok_or_else(|| crate::unknown_agent(headless, &args.agent))?;
    let mut probe = Probe {
        headless,
        report: Report::new(out),
        spec,
        timings,
        hostile,
        folder: folder.to_path_buf(),
        before: None,
        user_binary: None,
        main_log: None,
        pids: Vec::new(),
        named_logs: Vec::new(),
    };
    probe.run(args).await;
    probe.report.note(probe.report.summary());
    Ok(probe.report.outcome())
}

struct Probe<'a> {
    headless: &'a Headless,
    report: Report,
    spec: AgentSpec,
    timings: ProbeTimings,
    /// Whether the chat folder is the probe's hostile repository (not `--folder`).
    hostile: bool,
    folder: PathBuf,
    /// The process table before the first start (Unix).
    before: Option<Vec<ProcInfo>>,
    /// The user's binary detection found (an adapter's), or the agent's program.
    user_binary: Option<String>,
    /// The protocol log of the session steps 1 to 6 probe.
    main_log: Option<PathBuf>,
    /// Every agent process the probe started, from the spawn notes.
    pids: Vec<u32>,
    /// Each protocol log with the fixture name it can become.
    named_logs: Vec<(PathBuf, &'static str)>,
}

impl Probe<'_> {
    fn demo(&self) -> bool {
        self.spec.kind == DriverKind::Mock
    }

    /// Cards the agent showed while a setting changed, and how the probe answered them.
    fn report_cards(&mut self, step: &str, cards: &[aura_protocol::PermissionRequest]) {
        for card in cards {
            let allowed = card
                .options
                .iter()
                .any(|option| option.kind == aura_protocol::PermissionOptionKind::AllowOnce);
            self.report.info(
                step,
                format!(
                    "the agent asked \"{}\" while a setting changed; the probe answered {}",
                    card.title,
                    if allowed { "allow once" } else { "cancelled" }
                ),
            );
        }
    }

    /// The log steps 1 to 6 read: the session's own, or (before it is ready) the newest.
    fn session_log(&self, chat: &ChatRun<'_>) -> Option<PathBuf> {
        self.main_log
            .clone()
            .or_else(|| chat.logs().last().cloned())
    }

    /// Notes the agent pid of a log's spawn, for the process table checks.
    fn note_pid(&mut self, log: &Path) {
        if let Some(pid) = logs::read(log)
            .ok()
            .and_then(|read| logs::spawn_pid(&read.records))
            && !self.pids.contains(&pid)
        {
            self.pids.push(pid);
        }
    }

    /// Names every log of `chat` not in `before` as the fixture `name` can become, and notes its
    /// pid.
    fn name_new_logs(&mut self, chat: &ChatRun<'_>, before: &[PathBuf], name: &'static str) {
        for log in chat.logs().into_iter().filter(|log| !before.contains(log)) {
            self.note_pid(&log);
            self.named_logs.push((log, name));
        }
    }

    async fn run(&mut self, args: &ProbeArgs) {
        let spec = self.spec.clone();
        self.report.info(
            "agent",
            format!("{} ({}), dialect {}", spec.name, spec.id, spec.dialect),
        );
        match self.headless.detector.detect(&spec).await {
            Availability::Ready { version, path } => {
                self.report.pass(
                    "detect",
                    format!("{} ({path})", version.as_deref().unwrap_or("ready")),
                );
                self.user_binary = Some(path);
            }
            Availability::Missing { reason } | Availability::Broken { reason } => {
                self.report.fail("detect", reason);
                return;
            }
            Availability::Checking => {
                self.report.fail("detect", "detection did not finish");
                return;
            }
        }
        if !args.env.is_empty() {
            self.report.info(
                "env",
                format!(
                    "set on every agent process, after the scrub: {}",
                    env_names(args)
                ),
            );
        }
        self.before = ps::snapshot();
        let watch = Watch::new();
        self.headless.manager.status_subscribe(watch.status_sink());
        let adapter = adapter_folder(self.headless, &spec);
        let installed_before = adapter.as_deref().is_some_and(is_installed);
        let started_at = Instant::now();
        let chat = match ChatRun::create(self.headless, &watch, &spec, &self.folder).await {
            Ok(chat) => chat,
            Err(error) => {
                self.report.fail("start", error);
                return;
            }
        };
        let mut details_mark = 0;
        let mut start_mark = 0;
        if let Some(adapter) = adapter.as_deref()
            && !installed_before
        {
            self.interrupt_install(&chat, adapter).await;
            details_mark = watch.with(|state| state.details.len());
            start_mark = chat.mark();
            if let Err(error) = self.headless.manager.start(&chat.chat_id, false).await {
                self.report.fail("start", error);
                self.end(&chat).await;
                return;
            }
        }
        let (end, asked) = chat.settle(self.timings.start).await;
        let took = started_at.elapsed();
        self.install_step(&chat, adapter.as_deref(), installed_before, details_mark)
            .await;
        match end {
            StartEnd::Ready => {
                self.report
                    .pass("start", format!("ready in {:.1} s", took.as_secs_f64()));
            }
            StartEnd::AuthRequired => {
                self.initialize_step(&chat).await;
                self.auth_step(&chat).await;
                self.end(&chat).await;
                return;
            }
            other => {
                self.start_failed(&chat, &other, start_mark).await;
                self.initialize_step(&chat).await;
                self.end(&chat).await;
                return;
            }
        }
        self.main_log = chat.logs().last().cloned();
        if let Some(log) = self.main_log.clone() {
            self.named_logs.push((log, "probe-session"));
        }
        self.initialize_step(&chat).await;
        let lists = self.session_step(&chat, &asked).await;
        self.commands_step(&chat).await;
        self.options_step(&chat, lists.as_ref(), &watch).await;
        self.autonomy_step(&chat).await;
        self.cancel_step(&chat).await;
        let before_stop = chat.lists().await.ok();
        let native = chat.info().and_then(|info| info.native_session_id);
        if self.close_step(&chat).await {
            self.resume_step(&chat, before_stop.as_ref(), native.as_deref())
                .await;
            self.interrupted_start_step(&chat).await;
        }
        self.end(&chat).await;
    }

    /// Spec 10.2 step 9's second half, for an adapter not installed yet: the first start's
    /// download is interrupted once, which must leave no npm running and no install marked.
    async fn interrupt_install(&mut self, chat: &ChatRun<'_>, adapter: &Path) {
        let step = "9 interrupt";
        let downloading = chat
            .watch
            .until(self.timings.start, |state| {
                let detail = state.info(&chat.chat_id)?.detail.clone()?;
                detail.starts_with("Downloading").then_some(detail)
            })
            .await;
        if downloading.is_none() {
            self.report
                .fail(step, "the first start never showed the adapter's download");
            return;
        }
        tokio::time::sleep(self.timings.install_run).await;
        if let Err(error) = self.headless.manager.interrupt(&chat.chat_id).await {
            self.report.fail(step, error);
            return;
        }
        if !chat
            .wait_status(SessionStatus::Stopped, self.timings.stop)
            .await
        {
            self.report.fail(
                step,
                format!(
                    "an interrupt during the first install left the chat {}",
                    status_name(chat.status())
                ),
            );
            return;
        }
        if is_installed(adapter) {
            self.report.info(
                step,
                "the install finished before the interrupt landed; the next start used it",
            );
        } else {
            self.report.pass(
                step,
                "an interrupt during the first install stopped it; nothing is marked installed",
            );
        }
        self.leftovers(
            step,
            &[
                adapter.display().to_string(),
                "--omit=optional --ignore-scripts".into(),
            ],
        );
    }

    async fn install_step(
        &mut self,
        chat: &ChatRun<'_>,
        adapter: Option<&Path>,
        installed_before: bool,
        details_mark: usize,
    ) {
        let step = "0 install";
        let Some(adapter) = adapter else {
            self.report
                .skip(step, format!("{} is not an npm adapter", self.spec.name));
            return;
        };
        if installed_before {
            self.report
                .info(step, format!("already installed in {}", adapter.display()));
        } else if let Some(took) = download_time(chat, details_mark) {
            self.report.pass(
                step,
                format!(
                    "installed in {:.1} s into {}",
                    took.as_secs_f64(),
                    adapter.display()
                ),
            );
        } else if is_installed(adapter) {
            self.report
                .info(step, format!("installed into {}", adapter.display()));
        }
        if !is_installed(adapter) {
            self.report
                .fail(step, "the adapter is not marked installed");
            return;
        }
        self.report.info(
            step,
            format!("the folder holds {}", megabytes(folder_size(adapter))),
        );
        let bundled = bundled_clis(adapter);
        if bundled.is_empty() {
            self.report.pass(
                step,
                "no bundled CLI: no @anthropic-ai/claude-agent-sdk-<platform> or @openai/codex-<platform> package",
            );
        } else {
            self.report.fail(
                step,
                format!("bundled CLI packages are installed: {}", bundled.join(", ")),
            );
        }
        self.npm_prefix(adapter).await;
    }

    /// `npm prefix` in the adapter folder must print that folder: npm treats it as its own
    /// project, so no folder above it decides what runs.
    async fn npm_prefix(&mut self, adapter: &Path) {
        let step = "0 install";
        let env = self.headless.env.get().await;
        let Some(npm) = find_program("npm", &env.vars) else {
            self.report
                .skip(step, "npm is not on PATH, so npm prefix was not checked");
            return;
        };
        let output = run_helper(
            &self.headless.registry,
            HelperSpec {
                program: npm,
                args: vec!["prefix".into()],
                cwd: adapter.to_path_buf(),
                env: HelperEnv::Resolved(env),
                set: vec![("npm_config_update_notifier".into(), "false".into())],
                new_session: false,
                timeout: Duration::from_secs(30),
                max_stdout: 64 * 1024,
            },
        )
        .await;
        match output {
            Ok(output) if output.exit.is_some_and(|exit| exit.code == Some(0)) => {
                let printed = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let same = prefix_names_folder(&printed, adapter);
                self.report.check(
                    same,
                    step,
                    format!("npm prefix in the adapter folder prints {printed}"),
                );
            }
            Ok(output) => self.report.fail(
                step,
                format!("npm prefix failed: {}", output.stderr_tail.trim()),
            ),
            Err(error) => self
                .report
                .fail(step, format!("npm prefix failed: {error}")),
        }
    }

    async fn start_failed(&mut self, chat: &ChatRun<'_>, end: &StartEnd, mark: usize) {
        let errors = chat
            .watch
            .with(|state| state.errors_since(&chat.chat_id, mark));
        let detail = errors
            .last()
            .map(|(kind, message, detail)| {
                let mut text = format!("{kind:?}: {message}");
                if let Some(detail) = detail {
                    text.push('\n');
                    text.push_str(detail);
                }
                text
            })
            .unwrap_or_else(|| "no error card".into());
        let what = match end {
            StartEnd::TimedOut => format!(
                "the start did not end within {} s",
                self.timings.start.as_secs()
            ),
            StartEnd::Stopped => "the agent stopped while it started".into(),
            _ => "the start failed".into(),
        };
        self.report.fail("start", format!("{what}: {detail}"));
        if *end == StartEnd::TimedOut {
            let _ = self.headless.manager.force_stop(&chat.chat_id).await;
        }
    }

    /// The main log's records, once `ready` holds for them (the log writer runs behind).
    async fn log_records(&self, log: &Path, ready: impl Fn(&[Value]) -> bool) -> Vec<Value> {
        let deadline = Instant::now() + self.timings.log;
        loop {
            let records = logs::read(log).map(|read| read.records).unwrap_or_default();
            if ready(&records) || Instant::now() >= deadline {
                return records;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    async fn initialize_step(&mut self, chat: &ChatRun<'_>) {
        let step = "1 initialize";
        if self.demo() {
            let info = chat.info();
            self.report.skip(
                step,
                format!(
                    "the demo agent runs inside auracode: no process and no protocol log ({} {})",
                    info.as_ref()
                        .and_then(|info| info.agent_name.clone())
                        .unwrap_or_default(),
                    info.and_then(|info| info.agent_version).unwrap_or_default()
                ),
            );
            return;
        }
        let Some(log) = self.session_log(chat) else {
            self.report.fail(step, "the start left no protocol log");
            return;
        };
        let records = self
            .log_records(&log, |records| {
                logs::exchange(records, "initialize").is_some()
            })
            .await;
        self.note_pid(&log);
        let Some((sent, answer)) = logs::exchange(&records, "initialize") else {
            self.report
                .fail(step, format!("no reply to initialize in {}", log.display()));
            return;
        };
        let msg = logs::message(answer).cloned().unwrap_or(Value::Null);
        let took = match (logs::t(sent), logs::t(answer)) {
            (Some(sent), Some(answered)) => format!(" in {} ms", answered - sent),
            _ => String::new(),
        };
        match msg.get("result") {
            Some(result) => {
                let name = text_at(result, "/agentInfo/name");
                let version = text_at(result, "/agentInfo/version");
                self.report.pass(
                    step,
                    format!(
                        "{name} {version} answered{took}; protocol version {}",
                        result
                            .get("protocolVersion")
                            .map_or_else(|| "?".into(), Value::to_string)
                    ),
                );
                self.report.info(
                    step,
                    format!(
                        "capabilities: {}; auth methods: {}",
                        result
                            .get("agentCapabilities")
                            .map_or_else(|| "none".into(), Value::to_string),
                        auth_method_ids(result)
                    ),
                );
            }
            None => self.report.fail(
                step,
                format!(
                    "initialize failed: {}",
                    msg.get("error")
                        .map_or_else(|| "?".into(), Value::to_string)
                ),
            ),
        }
        self.hostile_check(&records);
    }

    /// Nothing may run the chat folder's npm files: the mark of its fake adapters never shows,
    /// and an adapter runs in its own folder.
    fn hostile_check(&mut self, records: &[Value]) {
        let step = "1 initialize";
        if !self.hostile {
            self.report.skip(
                step,
                "the chat folder is your own (--folder), not the hostile one",
            );
            return;
        }
        if logs::mentions(records, HOSTILE_MARK) {
            self.report.fail(
                step,
                "the log shows HOSTILE: something ran the chat folder's fake adapter",
            );
            return;
        }
        let cwd = logs::note(records, "spawn")
            .and_then(|spawn| spawn.get("cwd"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        match &self.spec.recipe {
            Recipe::NpmAdapter { .. } => {
                let adapter = adapter_folder(self.headless, &self.spec).unwrap_or_default();
                self.report.check(
                    same_folder(Path::new(&cwd), &adapter),
                    step,
                    format!(
                        "nothing used the hostile chat folder's npm files; the adapter ran in {cwd}"
                    ),
                );
            }
            Recipe::Binary { .. } | Recipe::Builtin => self
                .report
                .pass(step, "nothing ran the hostile chat folder's fake adapters"),
        }
    }

    async fn auth_step(&mut self, chat: &ChatRun<'_>) {
        let step = "8 auth";
        match chat.snapshot().await {
            Ok(snapshot) => match snapshot.auth {
                Some(auth) => {
                    let commands = auth
                        .commands
                        .iter()
                        .map(|command| {
                            let mut text = command.argv.join(" ");
                            if !command.env.is_empty() {
                                let names: Vec<&str> =
                                    command.env.iter().map(|(name, _)| name.as_str()).collect();
                                text.push_str(&format!(" (sets {})", names.join(", ")));
                            }
                            format!("{}: {text}", command.label)
                        })
                        .collect::<Vec<_>>();
                    self.report.info(
                        step,
                        format!(
                            "the agent needs a sign-in: {}\n{}",
                            auth.message,
                            if commands.is_empty() {
                                "no sign-in command".to_owned()
                            } else {
                                commands.join("\n")
                            }
                        ),
                    );
                    self.report
                        .skip("2-9", "the other steps need an agent that is signed in");
                }
                None => self
                    .report
                    .fail(step, "the chat reads AuthRequired without an auth card"),
            },
            Err(error) => self.report.fail(step, error),
        }
    }

    async fn session_step(
        &mut self,
        chat: &ChatRun<'_>,
        asked: &[aura_protocol::PermissionRequest],
    ) -> Option<SessionLists> {
        let step = "2 session";
        let lists = match chat.lists().await {
            Ok(lists) => lists,
            Err(error) => {
                self.report.fail(step, error);
                return None;
            }
        };
        let native = chat
            .ready_info(self.timings.stop)
            .await
            .and_then(|info| info.native_session_id)
            .unwrap_or_default();
        self.report.pass(step, format!("opened session {native}"));
        self.report.info(step, options_text(&lists.options));
        if let Some(model) = lists
            .options
            .iter()
            .find(|option| option.category == ConfigCategory::Model)
        {
            self.report
                .info(step, format!("current model: {}", current_text(model)));
        }
        if !self.demo()
            && let Some(log) = self.session_log(chat)
        {
            let records = self
                .log_records(&log, |records| {
                    logs::first_open(records).is_some_and(|open| {
                        logs::message(open)
                            .and_then(|msg| msg.get("id"))
                            .is_some_and(|id| logs::reply(records, id).is_some())
                    })
                })
                .await;
            if let Some(result) = open_result(&records) {
                let models = result
                    .pointer("/models/availableModels")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                let modes: Vec<&str> = result
                    .pointer("/modes/availableModes")
                    .and_then(Value::as_array)
                    .map(|modes| {
                        modes
                            .iter()
                            .filter_map(|mode| mode.get("id").and_then(Value::as_str))
                            .collect()
                    })
                    .unwrap_or_default();
                self.report.info(
                    step,
                    format!(
                        "the open's reply: {models} legacy model(s) (current {}); modes {} (current {})",
                        text_at(result, "/models/currentModelId"),
                        if modes.is_empty() {
                            "none".to_owned()
                        } else {
                            modes.join(", ")
                        },
                        text_at(result, "/modes/currentModeId"),
                    ),
                );
            }
        }
        if asked.is_empty() {
            self.report.info(
                step,
                "nothing was asked before the session was ready (no folder trust question)",
            );
        } else {
            for card in asked {
                self.report.info(
                    step,
                    format!(
                        "asked before ready: \"{}\" (kind {:?}); the probe answered cancelled",
                        card.title, card.kind
                    ),
                );
            }
        }
        Some(lists)
    }

    async fn commands_step(&mut self, chat: &ChatRun<'_>) {
        let step = "3 commands";
        tokio::time::sleep(self.timings.commands).await;
        let count = match chat.lists().await {
            Ok(lists) => lists.commands.len(),
            Err(error) => {
                self.report.fail(step, error);
                return;
            }
        };
        let largest = if self.demo() {
            None
        } else {
            self.session_log(chat).and_then(|log| {
                let records = logs::read(&log).ok()?.records;
                logs::updates(&records, "available_commands_update")
                    .filter_map(|record| logs::message(record))
                    .map(|msg| msg.to_string().len())
                    .max()
            })
        };
        self.report.info(
            step,
            match largest {
                Some(bytes) => format!(
                    "{count} slash command(s) after {:.1} s; the largest commands update was {bytes} bytes",
                    self.timings.commands.as_secs_f64()
                ),
                None => format!(
                    "{count} slash command(s) after {:.1} s",
                    self.timings.commands.as_secs_f64()
                ),
            },
        );
    }

    async fn options_step(
        &mut self,
        chat: &ChatRun<'_>,
        lists: Option<&SessionLists>,
        watch: &std::sync::Arc<Watch>,
    ) {
        let step = "4 options";
        let Some(lists) = lists else {
            self.report.skip(step, "no options to set");
            return;
        };
        let mut failed = false;
        for option in &lists.options {
            let value = current_value(option);
            let (result, cards) = chat
                .answering(
                    self.headless
                        .manager
                        .set_option(&chat.chat_id, &option.id, value),
                )
                .await;
            self.report_cards(step, &cards);
            if let Err(error) = result {
                self.report.fail(
                    step,
                    format!("setting {} to its current value failed: {error}", option.id),
                );
                failed = true;
            }
        }
        if !failed {
            match chat.lists().await {
                Ok(after) => {
                    let changed = changed_options(&lists.options, &after.options);
                    self.report.check(
                        changed.is_empty(),
                        step,
                        if changed.is_empty() {
                            format!(
                                "every option set to its current value ({}); nothing changed",
                                lists.options.len()
                            )
                        } else {
                            format!("setting current values changed {}", changed.join(", "))
                        },
                    );
                }
                Err(error) => self.report.fail(step, error),
            }
        }
        self.model_switch(chat, lists, watch).await;
    }

    /// Switches the model to the cheapest-looking choice and back; both changes must show.
    async fn model_switch(
        &mut self,
        chat: &ChatRun<'_>,
        lists: &SessionLists,
        watch: &std::sync::Arc<Watch>,
    ) {
        let step = "4 options";
        let Some(model) = lists
            .options
            .iter()
            .find(|option| option.category == ConfigCategory::Model)
        else {
            self.report.skip(step, "the agent offers no model option");
            return;
        };
        let ConfigKind::Select { current, choices } = &model.kind else {
            self.report.skip(step, "the model option is not a list");
            return;
        };
        let Some(target) = switch_target(model) else {
            self.report.skip(step, "only one model is offered");
            return;
        };
        let original = current.clone();
        let name_of = |value: &str| {
            choices
                .iter()
                .find(|choice| choice.value == value)
                .map_or_else(|| value.to_owned(), |choice| choice.name.clone())
        };
        let switched = self.set_model(chat, &model.id, &target).await;
        if switched {
            self.report.pass(
                step,
                format!("the model switched to {} ({target})", name_of(&target)),
            );
            if self.spec.dialect == "hermes" {
                self.second_session(chat, watch, &original, &target).await;
            }
        }
        if self.set_model(chat, &model.id, &original).await {
            self.report.pass(
                step,
                format!(
                    "the model switched back to {} ({original})",
                    name_of(&original)
                ),
            );
        }
    }

    /// Sets the model and checks that the session reports it.
    async fn set_model(&mut self, chat: &ChatRun<'_>, option_id: &str, value: &str) -> bool {
        let step = "4 options";
        let (result, cards) = chat
            .answering(self.headless.manager.set_option(
                &chat.chat_id,
                option_id,
                ConfigValue::Choice {
                    value: value.to_owned(),
                },
            ))
            .await;
        self.report_cards(step, &cards);
        match result {
            Ok(_) => {
                // The reply can come before the session applied the agent's new option list, so
                // the change is read back until it shows.
                let wanted = ConfigValue::Choice {
                    value: value.to_owned(),
                };
                let deadline = Instant::now() + self.timings.log;
                let reported = loop {
                    let reported = chat.lists().await.ok().and_then(|lists| {
                        lists
                            .options
                            .iter()
                            .find(|option| option.id == option_id)
                            .map(current_value)
                    });
                    if reported.as_ref() == Some(&wanted) || Instant::now() >= deadline {
                        break reported;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                };
                let ok = reported.as_ref() == Some(&wanted);
                if !ok {
                    self.report.fail(
                        step,
                        format!(
                            "the model was set to {value}, but the session reports {reported:?}"
                        ),
                    );
                }
                ok
            }
            Err(error) => {
                self.report.fail(
                    step,
                    format!("switching the model to {value} failed: {error}"),
                );
                false
            }
        }
    }

    /// Hermes: while the first session is switched, what model a second `session/new` reports
    /// says whether the switch stays inside the session (spec 10.2 step 4).
    async fn second_session(
        &mut self,
        chat: &ChatRun<'_>,
        watch: &std::sync::Arc<Watch>,
        original: &str,
        target: &str,
    ) {
        let step = "4 options";
        let second = match ChatRun::create(self.headless, watch, &self.spec, &chat.folder).await {
            Ok(second) => second,
            Err(error) => {
                self.report
                    .fail(step, format!("a second session did not start: {error}"));
                return;
            }
        };
        let (end, _) = second.settle(self.timings.start).await;
        if end == StartEnd::Ready {
            self.name_new_logs(&second, &[], "probe-second-session");
            let reported = second.lists().await.ok().and_then(|lists| {
                lists
                    .options
                    .iter()
                    .find(|option| option.category == ConfigCategory::Model)
                    .map(current_value)
            });
            let reported = match reported {
                Some(ConfigValue::Choice { value }) => value,
                _ => "nothing".into(),
            };
            let meaning = if reported == original {
                "the switch stays inside the session"
            } else if reported == target {
                "the switch changed the agent's configured model"
            } else {
                "neither model"
            };
            self.report.info(
                step,
                format!("while switched, a second session reports {reported}: {meaning}"),
            );
        } else {
            self.report.fail(
                step,
                format!("a second session did not become ready ({end:?})"),
            );
        }
        if !matches!(second.stop(self.timings.stop).await, Ok(true)) {
            let _ = self.headless.manager.force_stop(&second.chat_id).await;
        }
    }

    /// Full auto, Auto-edit, Ask and back, each against the dialect's candidates (spec 5.5.2).
    async fn autonomy_step(&mut self, chat: &ChatRun<'_>) {
        let step = "4 autonomy";
        let original = match chat.lists().await {
            Ok(lists) => lists.autonomy.requested,
            Err(error) => {
                self.report.fail(step, error);
                return;
            }
        };
        for level in [
            Autonomy::FullAuto,
            Autonomy::AutoEdit,
            Autonomy::Ask,
            original,
        ] {
            let (result, cards) = chat
                .answering(self.headless.manager.set_autonomy(&chat.chat_id, level))
                .await;
            self.report_cards(step, &cards);
            let state = match result {
                Ok(lists) => lists.autonomy,
                Err(error) => {
                    self.report
                        .fail(step, format!("{}: {error}", level_name(level)));
                    continue;
                }
            };
            let expected = expected_modes(&self.spec, level);
            let text = autonomy_text(level, &state);
            if state.requested != level {
                self.report
                    .fail(step, format!("asked for {}, got {text}", level_name(level)));
            } else if expected.contains(&state.native_mode) {
                self.report.pass(step, text);
            } else {
                self.report.fail(
                    step,
                    format!(
                        "{text}; expected the mode {}",
                        expected
                            .iter()
                            .map(|mode| mode.clone().unwrap_or_else(|| "unchanged".into()))
                            .collect::<Vec<_>>()
                            .join(" or ")
                    ),
                );
            }
        }
    }

    /// An interrupt while no prompt runs: nothing happens, and no `session/cancel` is sent.
    async fn cancel_step(&mut self, chat: &ChatRun<'_>) {
        let step = "5 cancel";
        if let Err(error) = self.headless.manager.interrupt(&chat.chat_id).await {
            self.report.fail(step, error);
            return;
        }
        tokio::time::sleep(self.timings.settle).await;
        let status = chat.status();
        let cancels = if self.demo() {
            0
        } else {
            self.session_log(chat)
                .and_then(|log| logs::read(&log).ok())
                .map_or(0, |read| {
                    logs::requests_of(&read.records, &["session/cancel"]).count()
                })
        };
        self.report.check(
            status == Some(SessionStatus::Ready) && cancels == 0,
            step,
            format!(
                "an interrupt while idle left the session {} and sent {cancels} session/cancel (auracode sends none while no prompt runs)",
                status_name(status)
            ),
        );
    }

    /// Stop: stdin closes and the agent exits; nothing it started may be left. Returns whether
    /// the chat stopped.
    async fn close_step(&mut self, chat: &ChatRun<'_>) -> bool {
        let step = "6 close";
        match chat.stop(self.timings.stop).await {
            Ok(true) => {}
            Ok(false) => {
                self.report.fail(
                    step,
                    format!(
                        "the chat did not stop within {} s ({})",
                        self.timings.stop.as_secs(),
                        status_name(chat.status())
                    ),
                );
                return false;
            }
            Err(error) => {
                self.report.fail(step, error);
                return false;
            }
        }
        if self.demo() {
            self.report.pass(step, "the demo agent stopped");
            return true;
        }
        let Some(log) = self.session_log(chat) else {
            self.report.fail(step, "no protocol log");
            return true;
        };
        let records = self
            .log_records(&log, |records| logs::note(records, "shutdown").is_some())
            .await;
        self.report_exit(step, &records);
        self.leftovers(step, &[]);
        true
    }

    fn report_exit(&mut self, step: &str, records: &[Value]) {
        let exit = logs::note(records, "exit");
        let shutdown = logs::note(records, "shutdown");
        let steps: Vec<String> = shutdown
            .and_then(|shutdown| shutdown.get("steps"))
            .and_then(Value::as_array)
            .map(|steps| {
                steps
                    .iter()
                    .filter_map(|step| step.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let took = shutdown
            .and_then(|shutdown| shutdown.get("took_ms"))
            .and_then(Value::as_u64);
        let code = exit
            .and_then(|exit| exit.get("code"))
            .cloned()
            .unwrap_or(Value::Null);
        let signal = exit
            .and_then(|exit| exit.get("signal"))
            .cloned()
            .unwrap_or(Value::Null);
        let on_eof = steps.iter().any(|step| step == "ExitedAfterEof")
            && !steps
                .iter()
                .any(|step| step.starts_with("SentSigterm") || step.starts_with("Killed"));
        let text = format!(
            "steps {}, {}exit code {code}, signal {signal}",
            if steps.is_empty() {
                "none logged".to_owned()
            } else {
                steps.join(", ")
            },
            took.map(|took| format!("{took} ms, ")).unwrap_or_default(),
        );
        if on_eof {
            self.report
                .pass(step, format!("the agent exited when stdin closed: {text}"));
        } else {
            self.report.info(
                step,
                format!("the agent did not exit on stdin's end alone: {text}"),
            );
        }
    }

    /// The `ps` diff: nothing of any agent the probe started is left; declared daemons are listed.
    fn leftovers(&mut self, step: &str, extra: &[String]) {
        let (Some(before), Some(after)) = (self.before.as_deref(), ps::snapshot()) else {
            self.report
                .skip(step, "no process table here; the job object ends the tree");
            return;
        };
        let mut needles: Vec<String> = extra.to_vec();
        needles.push(self.folder.display().to_string());
        if let Some(binary) = &self.user_binary
            && binary != "built in"
        {
            needles.push(binary.clone());
        }
        if let Some(adapter) = adapter_folder(self.headless, &self.spec) {
            needles.push(adapter.display().to_string());
        }
        let found = ps::leftovers(
            before,
            &after,
            &self.pids,
            &needles,
            &self.spec.daemons,
            std::process::id(),
        );
        for spared in &found.spared {
            self.report.info(
                step,
                format!("spared (a declared daemon): {}", ps::describe(spared)),
            );
        }
        if found.is_clean() {
            self.report.pass(
                step,
                format!(
                    "nothing left running: no process in the group of agent(s) {:?}, no new process naming them",
                    self.pids
                ),
            );
        } else {
            let mut lines = vec!["processes left running:".to_owned()];
            lines.extend(
                found
                    .group
                    .iter()
                    .map(|info| format!("in the agent's group: {}", ps::describe(info))),
            );
            lines.extend(
                found
                    .related
                    .iter()
                    .map(|info| format!("started during the run: {}", ps::describe(info))),
            );
            self.report.fail(step, lines.join("\n"));
        }
    }

    async fn resume_step(
        &mut self,
        chat: &ChatRun<'_>,
        before: Option<&SessionLists>,
        native: Option<&str>,
    ) {
        let step = "7 resume";
        let mark = chat.mark();
        let logs_before = chat.logs();
        let (end, _) = match chat.start(self.timings.start).await {
            Ok(started) => started,
            Err(error) => {
                self.report.fail(step, error);
                return;
            }
        };
        if end != StartEnd::Ready {
            self.start_failed(chat, &end, mark).await;
            return;
        }
        let new_log = chat
            .logs()
            .into_iter()
            .find(|log| !logs_before.contains(log));
        self.name_new_logs(chat, &logs_before, "probe-resume");
        let now = chat
            .ready_info(self.timings.stop)
            .await
            .and_then(|info| info.native_session_id);
        let resumable = chat
            .lists()
            .await
            .ok()
            .and_then(|lists| lists.capabilities)
            .is_some_and(|capabilities| capabilities.resume);
        match (native, now.as_deref()) {
            (Some(was), Some(is)) if was == is => {
                self.report
                    .pass(step, format!("the session {is} continued"));
            }
            (was, is) if !resumable || self.demo() => self.report.info(
                step,
                format!(
                    "a new session ({}) replaced {}: this agent can't continue earlier sessions",
                    is.unwrap_or("none"),
                    was.unwrap_or("none")
                ),
            ),
            (was, is) => self.report.fail(
                step,
                format!(
                    "a new session ({}) replaced {}, although the agent can continue sessions",
                    is.unwrap_or("none"),
                    was.unwrap_or("none")
                ),
            ),
        }
        if let Some(log) = &new_log {
            let records = self
                .log_records(log, |records| logs::first_open(records).is_some())
                .await;
            let method = logs::first_open(&records)
                .and_then(logs::message)
                .and_then(|msg| msg.get("method"))
                .and_then(Value::as_str)
                .unwrap_or("nothing");
            let reapplied: Vec<String> = logs::requests_of(
                &records,
                &[
                    "session/set_config_option",
                    "session/set_mode",
                    "session/set_model",
                ],
            )
            .filter_map(logs::message)
            .map(|msg| {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                format!(
                    "{} {}",
                    msg.get("method").and_then(Value::as_str).unwrap_or("?"),
                    ["configId", "modeId", "modelId", "value"]
                        .iter()
                        .filter_map(|key| params.get(key).map(|value| format!("{key}={value}")))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            })
            .collect();
            self.report.info(
                step,
                format!(
                    "opened with {method}; settings sent after it: {}",
                    if reapplied.is_empty() {
                        "none".to_owned()
                    } else {
                        reapplied.join("; ")
                    }
                ),
            );
        }
        let replayed: Vec<&'static str> = chat.watch.with(|state| {
            state
                .since(&chat.chat_id, mark)
                .filter_map(|seen| transcript_kind(&seen.event))
                .collect()
        });
        self.report.check(
            replayed.is_empty(),
            step,
            if replayed.is_empty() {
                "no transcript came back while the session opened".to_owned()
            } else {
                format!(
                    "transcript came back while the session opened: {}",
                    replayed.join(", ")
                )
            },
        );
        let continued = chat
            .watch
            .with(|state| state.notices_since(&chat.chat_id, mark))
            .into_iter()
            .find(|notice| notice.contains("continued this session while auracode was away"));
        if let Some(notice) = continued {
            self.report.fail(
                step,
                format!("the replay differs from what was stored: {notice}"),
            );
        }
        if let Some(before) = before {
            match chat.lists().await {
                Ok(after) => {
                    let changed = changed_options(&before.options, &after.options);
                    self.report.check(
                        changed.is_empty(),
                        step,
                        if changed.is_empty() {
                            "the options are back as they were".to_owned()
                        } else {
                            format!("options differ after the resume: {}", changed.join(", "))
                        },
                    );
                }
                Err(error) => self.report.fail(step, error),
            }
        }
    }

    /// An interrupt right after initialize ends the start with nothing left; the next start works.
    async fn interrupted_start_step(&mut self, chat: &ChatRun<'_>) {
        let step = "9 interrupt";
        if !matches!(chat.stop(self.timings.stop).await, Ok(true)) {
            self.report
                .fail(step, "the chat did not stop before the interrupted start");
            return;
        }
        let logs_before = chat.logs();
        if let Err(error) = self.headless.manager.start(&chat.chat_id, false).await {
            self.report.fail(step, error);
            return;
        }
        if !self.demo() {
            self.wait_for_initialize(chat, &logs_before).await;
        }
        if let Err(error) = self.headless.manager.interrupt(&chat.chat_id).await {
            self.report.fail(step, error);
            return;
        }
        let ended = chat
            .watch
            .until(self.timings.stop, |state| {
                match state.status(&chat.chat_id) {
                    Some(
                        status @ (SessionStatus::Stopped
                        | SessionStatus::Ready
                        | SessionStatus::Failed),
                    ) => Some(status),
                    _ => None,
                }
            })
            .await;
        match ended {
            Some(SessionStatus::Stopped) => self.report.pass(
                step,
                if self.demo() {
                    "an interrupt during the start stopped it"
                } else {
                    "an interrupt after initialize stopped the start"
                },
            ),
            Some(SessionStatus::Ready) => {
                self.report.info(
                    step,
                    "the start finished before the interrupt landed, so this was not checked",
                );
                let _ = chat.stop(self.timings.stop).await;
            }
            other => {
                self.report.fail(
                    step,
                    format!("the interrupted start left the chat {}", status_name(other)),
                );
                let _ = self.headless.manager.force_stop(&chat.chat_id).await;
            }
        }
        self.name_new_logs(chat, &logs_before, "probe-interrupted-start");
        if !self.demo() {
            self.leftovers(step, &[]);
        }
        let logs_before = chat.logs();
        let mark = chat.mark();
        match chat.start(self.timings.start).await {
            Ok((StartEnd::Ready, _)) => {
                self.report.pass(step, "the next start was ready");
                self.name_new_logs(chat, &logs_before, "probe-restart");
            }
            Ok((end, _)) => self.start_failed(chat, &end, mark).await,
            Err(error) => self.report.fail(step, error),
        }
    }

    /// Waits until the new spawn's log holds the initialize reply (or the start ended).
    async fn wait_for_initialize(&self, chat: &ChatRun<'_>, logs_before: &[PathBuf]) {
        let deadline = Instant::now() + self.timings.start;
        while Instant::now() < deadline {
            if matches!(
                chat.status(),
                Some(SessionStatus::Ready | SessionStatus::Failed | SessionStatus::Stopped)
            ) {
                return;
            }
            let answered = chat
                .logs()
                .into_iter()
                .filter(|log| !logs_before.contains(log))
                .filter_map(|log| logs::read(&log).ok())
                .any(|read| logs::exchange(&read.records, "initialize").is_some());
            if answered {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Stops what still runs, checks the table once more, and names the logs.
    async fn end(&mut self, chat: &ChatRun<'_>) {
        if !matches!(chat.stop(self.timings.stop).await, Ok(true)) {
            let _ = self.headless.manager.force_stop(&chat.chat_id).await;
            let _ = chat
                .wait_status(SessionStatus::Stopped, self.timings.stop)
                .await;
        }
        if !self.demo() {
            for log in chat.logs() {
                self.note_pid(&log);
            }
            self.leftovers("end", &[]);
        }
        if self.named_logs.is_empty() {
            if self.demo() {
                self.report.note("The demo agent writes no protocol log.");
            }
            return;
        }
        let mut lines = vec!["Protocol logs, and the fixture each can become:".to_owned()];
        for (log, name) in &self.named_logs {
            lines.push(format!(
                "  aura-cli fixture {} --scenario {name} --out crates/aura-drivers/tests/fixtures/acp/{}/{name}.jsonl",
                log.display(),
                self.spec.id
            ));
        }
        self.report.note(lines.join("\n"));
    }
}

/// The install folder of an npm adapter: `<adapters>/<package without "@", "/" as "-">-<version>`
/// (spec 4).
pub fn adapter_folder(headless: &Headless, spec: &AgentSpec) -> Option<PathBuf> {
    match &spec.recipe {
        Recipe::NpmAdapter {
            package, version, ..
        } => Some(headless.adapters_dir().join(format!(
            "{}-{version}",
            package.trim_start_matches('@').replace('/', "-")
        ))),
        Recipe::Binary { .. } | Recipe::Builtin => None,
    }
}

/// Whether an adapter folder holds a complete install (its marker).
fn is_installed(folder: &Path) -> bool {
    folder.join("installed.json").is_file()
}

/// How long the start showed the download detail: from the first such detail after the first
/// `details_mark` details to the next detail.
fn download_time(chat: &ChatRun<'_>, details_mark: usize) -> Option<Duration> {
    chat.watch.with(|state| {
        let mut started: Option<Instant> = None;
        for (chat_id, at, detail) in state.details.iter().skip(details_mark) {
            if chat_id != &chat.chat_id {
                continue;
            }
            let downloading = detail
                .as_deref()
                .is_some_and(|detail| detail.starts_with("Downloading"));
            match (started, downloading) {
                (None, true) => started = Some(*at),
                (Some(begun), false) => return Some(at.duration_since(begun)),
                _ => {}
            }
        }
        None
    })
}

/// The bytes of every file under `folder` (links are not followed).
fn folder_size(folder: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file() {
                total += entry.metadata().map_or(0, |meta| meta.len());
            }
        }
    }
    total
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
}

/// The platform CLI packages the adapters bundle as optional dependencies, wherever they sit in
/// `node_modules`: `@anthropic-ai/claude-agent-sdk-<platform>` and `@openai/codex-<platform>`.
pub fn bundled_clis(folder: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![folder.join("node_modules")];
    while let Some(modules) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&modules) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if name.starts_with('@') {
                let Ok(scoped) = std::fs::read_dir(&path) else {
                    continue;
                };
                for package in scoped.filter_map(Result::ok) {
                    let package_name = package.file_name().to_string_lossy().into_owned();
                    let bundled = (name == "@anthropic-ai"
                        && package_name.starts_with("claude-agent-sdk-"))
                        || (name == "@openai" && package_name.starts_with("codex-"));
                    if bundled {
                        found.push(format!("{name}/{package_name}"));
                    }
                    stack.push(package.path().join("node_modules"));
                }
            } else {
                stack.push(path.join("node_modules"));
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

/// Whether what `npm prefix` printed names `folder`. npm masks every UUID it prints, so a folder
/// whose path holds one (a data root in a folder named after a session id) prints with `***`
/// there.
fn prefix_names_folder(printed: &str, folder: &Path) -> bool {
    if same_folder(Path::new(printed), folder) {
        return true;
    }
    let real = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    [real.as_path(), folder]
        .iter()
        .any(|path| mask_uuids(&path.to_string_lossy()) == printed)
}

/// `text` with every UUID as npm prints it: `***` (`@npmcli/redact` masks them, any case, as whole
/// words, since legacy npm tokens look like UUIDs).
fn mask_uuids(text: &str) -> String {
    let bytes = text.as_bytes();
    let is_word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut masked = String::with_capacity(text.len());
    let mut copied = 0;
    let mut at = 0;
    while at < bytes.len() {
        let word_starts = at == 0 || !is_word(bytes[at - 1]);
        match uuid_end(bytes, at) {
            Some(end) if word_starts && bytes.get(end).is_none_or(|&next| !is_word(next)) => {
                // A UUID is ASCII, so both ends are character boundaries.
                masked.push_str(text.get(copied..at).unwrap_or_default());
                masked.push_str("***");
                copied = end;
                at = end;
            }
            _ => at += 1,
        }
    }
    masked.push_str(text.get(copied..).unwrap_or_default());
    masked
}

/// Where a UUID (8-4-4-4-12 hex digits) starting at `start` ends.
fn uuid_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut at = start;
    for (index, digits) in [8, 4, 4, 4, 12].into_iter().enumerate() {
        if index > 0 {
            if bytes.get(at) != Some(&b'-') {
                return None;
            }
            at += 1;
        }
        let group = bytes.get(at..at + digits)?;
        if !group.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        at += digits;
    }
    Some(at)
}

/// Whether two paths name the same folder (through links, as `npm prefix` prints the real one).
fn same_folder(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn text_at<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or("?")
}

fn auth_method_ids(result: &Value) -> String {
    let ids: Vec<&str> = result
        .get("authMethods")
        .and_then(Value::as_array)
        .map(|methods| {
            methods
                .iter()
                .filter_map(|method| method.get("id").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        "none".into()
    } else {
        ids.join(", ")
    }
}

/// The result of the first session open, when the agent answered it.
fn open_result(records: &[Value]) -> Option<&Value> {
    let open = logs::first_open(records)?;
    let id = logs::message(open)?.get("id")?;
    logs::message(logs::reply(records, id)?)?.get("result")
}

/// The option's current value, as `set_option` takes it.
fn current_value(option: &ConfigOption) -> ConfigValue {
    match &option.kind {
        ConfigKind::Select { current, .. } => ConfigValue::Choice {
            value: current.clone(),
        },
        ConfigKind::Toggle { current } => ConfigValue::Toggle { value: *current },
    }
}

fn current_text(option: &ConfigOption) -> String {
    match &option.kind {
        ConfigKind::Select { current, choices } => choices
            .iter()
            .find(|choice| &choice.value == current)
            .map_or_else(
                || current.clone(),
                |choice| format!("{} ({current})", choice.name),
            ),
        ConfigKind::Toggle { current } => current.to_string(),
    }
}

/// `3 options: mode (Mode, 3 choices), fast (ModelConfig, toggle)`.
fn options_text(options: &[ConfigOption]) -> String {
    if options.is_empty() {
        return "no options".into();
    }
    let parts: Vec<String> = options
        .iter()
        .map(|option| {
            let kind = match &option.kind {
                ConfigKind::Select { choices, .. } => format!("{} choices", choices.len()),
                ConfigKind::Toggle { .. } => "toggle".into(),
            };
            format!("{} ({:?}, {kind})", option.id, option.category)
        })
        .collect();
    format!("{} option(s): {}", options.len(), parts.join(", "))
}

/// The ids of options whose current value differs between two lists (or that one lacks).
fn changed_options(before: &[ConfigOption], after: &[ConfigOption]) -> Vec<String> {
    let mut changed = Vec::new();
    for option in before {
        let now = after.iter().find(|other| other.id == option.id);
        match now {
            Some(now) if current_value(now) == current_value(option) => {}
            Some(now) => changed.push(format!(
                "{} ({} -> {})",
                option.id,
                current_text(option),
                current_text(now)
            )),
            None => changed.push(format!("{} (gone)", option.id)),
        }
    }
    for option in after {
        if !before.iter().any(|other| other.id == option.id) {
            changed.push(format!("{} (new)", option.id));
        }
    }
    changed
}

/// The model to switch to: the cheapest-looking choice that is not current, else any other.
pub fn switch_target(model: &ConfigOption) -> Option<String> {
    let ConfigKind::Select { current, choices } = &model.kind else {
        return None;
    };
    let others: Vec<&ConfigChoice> = choices
        .iter()
        .filter(|choice| &choice.value != current)
        .collect();
    cheapest_of(&others)
        .or_else(|| others.first().copied())
        .map(|choice| choice.value.clone())
}

/// The cheapest-looking choice of a model option, whether or not it is current.
pub fn cheapest(model: &ConfigOption) -> Option<String> {
    let ConfigKind::Select { choices, .. } = &model.kind else {
        return None;
    };
    let choices: Vec<&ConfigChoice> = choices.iter().collect();
    cheapest_of(&choices).map(|choice| choice.value.clone())
}

/// The first choice carrying the cheapest marker any of them carries.
fn cheapest_of<'a>(choices: &[&'a ConfigChoice]) -> Option<&'a ConfigChoice> {
    CHEAP_MARKERS.iter().find_map(|marker| {
        choices.iter().copied().find(|choice| {
            choice.value.to_lowercase().contains(marker)
                || choice.name.to_lowercase().contains(marker)
        })
    })
}

/// The native modes an autonomy level may land on: the dialect's candidates (spec 5.5.2), the
/// demo agent's own table for the demo agent.
pub fn expected_modes(spec: &AgentSpec, level: Autonomy) -> Vec<Option<String>> {
    if spec.kind == DriverKind::Mock {
        let mode = match level {
            Autonomy::FullAuto => "full_auto",
            Autonomy::AutoEdit => "auto_edit",
            Autonomy::Ask => "ask",
        };
        return vec![Some(mode.to_owned())];
    }
    dialect_for(spec.dialect)
        .autonomy_candidates(level)
        .into_iter()
        .map(|candidate| candidate.mode)
        .collect()
}

fn level_name(level: Autonomy) -> &'static str {
    match level {
        Autonomy::FullAuto => "Full auto",
        Autonomy::AutoEdit => "Auto-edit",
        Autonomy::Ask => "Ask",
    }
}

fn autonomy_text(level: Autonomy, state: &AutonomyState) -> String {
    let answers = match &state.auto_answer {
        AutoAnswer::Never => "asks before every action".to_owned(),
        AutoAnswer::All => "answers every tool kind itself".to_owned(),
        AutoAnswer::Kinds { kinds } => format!(
            "answers {} itself",
            kinds
                .iter()
                .map(|kind| format!("{kind:?}").to_lowercase())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    let mut text = format!(
        "{}: mode {}, {answers}",
        level_name(level),
        state.native_mode.as_deref().unwrap_or("unchanged")
    );
    if let Some(note) = &state.note {
        text.push_str(&format!(" (note: {note})"));
    }
    text
}

/// The kind of a transcript event (what a replayed open must not bring back).
fn transcript_kind(event: &AuraEvent) -> Option<&'static str> {
    match event {
        AuraEvent::UserMessageDelta { .. }
        | AuraEvent::MessageDelta { .. }
        | AuraEvent::ThoughtDelta { .. }
        | AuraEvent::ToolCall(_)
        | AuraEvent::ToolUpdate(_)
        | AuraEvent::PlanUpdated { .. } => Some(event.kind()),
        _ => None,
    }
}

pub(crate) fn status_name(status: Option<SessionStatus>) -> String {
    status.map_or_else(
        || "unknown".into(),
        |status| format!("{status:?}").to_lowercase(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(current: &str, choices: &[(&str, &str)]) -> ConfigOption {
        ConfigOption {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: ConfigCategory::Model,
            kind: ConfigKind::Select {
                current: current.into(),
                choices: choices
                    .iter()
                    .map(|(value, name)| ConfigChoice {
                        value: (*value).into(),
                        name: (*name).into(),
                        description: None,
                        group: None,
                    })
                    .collect(),
            },
            pending: None,
        }
    }

    #[test]
    fn the_switch_goes_to_the_cheapest_model_that_is_not_current() {
        let claude = model(
            "default",
            &[
                ("default", "Default (Opus)"),
                ("sonnet", "Sonnet"),
                ("haiku", "Haiku"),
            ],
        );
        assert_eq!(switch_target(&claude).as_deref(), Some("haiku"));
        assert_eq!(cheapest(&claude).as_deref(), Some("haiku"));
        let codex = model(
            "gpt-5.1-codex",
            &[
                ("gpt-5.1-codex", "gpt-5.1-codex"),
                ("gpt-5.1-codex-mini", "gpt-5.1-codex-mini"),
            ],
        );
        assert_eq!(switch_target(&codex).as_deref(), Some("gpt-5.1-codex-mini"));
        // The cheapest is current already: any other model shows the switch.
        let mock = model(
            "mock-fast",
            &[("mock-fast", "Mock Fast"), ("mock-smart", "Mock Smart")],
        );
        assert_eq!(switch_target(&mock).as_deref(), Some("mock-smart"));
        assert_eq!(cheapest(&mock).as_deref(), Some("mock-fast"));
        assert_eq!(switch_target(&model("only", &[("only", "Only")])), None);
    }

    #[test]
    fn expected_modes_follow_the_dialect_tables() {
        let hermes = aura_agents::get("hermes").expect("hermes").clone();
        assert_eq!(
            expected_modes(&hermes, Autonomy::FullAuto),
            [Some("dont_ask".to_owned())]
        );
        assert_eq!(
            expected_modes(&hermes, Autonomy::Ask),
            [Some("default".to_owned())]
        );
        let claude = aura_agents::get("claude-acp").expect("claude-acp").clone();
        assert_eq!(
            expected_modes(&claude, Autonomy::FullAuto),
            [
                Some("bypassPermissions".to_owned()),
                Some("acceptEdits".to_owned())
            ]
        );
        let mock = aura_agents::get("mock").expect("mock").clone();
        assert_eq!(
            expected_modes(&mock, Autonomy::AutoEdit),
            [Some("auto_edit".to_owned())]
        );
    }

    #[test]
    fn changed_options_name_what_moved() {
        let before = vec![model("a", &[("a", "A"), ("b", "B")])];
        let after = vec![model("b", &[("a", "A"), ("b", "B")])];
        assert_eq!(changed_options(&before, &before), Vec::<String>::new());
        assert_eq!(changed_options(&before, &after), ["model (A (a) -> B (b))"]);
        assert_eq!(changed_options(&before, &[]), ["model (gone)"]);
    }

    #[test]
    fn bundled_clis_are_found_wherever_npm_put_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        let modules = dir.path().join("node_modules");
        for package in [
            "@anthropic-ai/claude-agent-sdk",
            "@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64",
            "@openai/codex",
            "@openai/codex-linux-x64",
            "zod",
        ] {
            std::fs::create_dir_all(modules.join(package)).expect("package folder");
        }
        assert_eq!(
            bundled_clis(dir.path()),
            [
                "@anthropic-ai/claude-agent-sdk-darwin-arm64",
                "@openai/codex-linux-x64"
            ]
        );
        assert!(bundled_clis(&dir.path().join("missing")).is_empty());
        std::fs::write(modules.join("zod/index.js"), vec![0u8; 1500]).expect("a file");
        assert_eq!(folder_size(dir.path()), 1500);
        assert_eq!(megabytes(1_500_000), "1.5 MB");
    }

    /// npm masks every UUID it prints (`@npmcli/redact`), so `npm prefix` in a folder whose path
    /// holds one prints `***` there: seen with a data root in a folder named after a session id.
    #[test]
    fn npm_prefix_names_the_folder_through_npms_uuid_mask() {
        let dir = tempfile::tempdir().expect("tempdir");
        let uuid = "d8fa469e-d838-43CE-8a75-2cd4fce641be";
        let folder = dir.path().join(uuid).join("adapters");
        std::fs::create_dir_all(&folder).expect("the folder");
        let real = std::fs::canonicalize(&folder)
            .expect("canonical")
            .display()
            .to_string();
        assert!(prefix_names_folder(&real, &folder));
        assert!(prefix_names_folder(&real.replace(uuid, "***"), &folder));
        assert!(!prefix_names_folder(&real.replace(uuid, "x***"), &folder));
        assert!(!prefix_names_folder(
            &real.replace("adapters", "***"),
            &folder
        ));
        // A UUID inside a longer word is not one npm masks.
        assert_eq!(
            mask_uuids(&format!("/a/{uuid}/b-{uuid}/c_{uuid}x/{uuid}")),
            format!("/a/***/b-***/c_{uuid}x/***")
        );
    }

    #[test]
    fn the_open_reply_and_auth_methods_read_from_a_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../aura-drivers/tests/fixtures/acp/hermes/legacy-models-modes.jsonl");
        let records = logs::read(&path).expect("fixture").records;
        let result = open_result(&records).expect("the open's result");
        assert_eq!(text_at(result, "/modes/currentModeId"), "default");
        let (_, answer) = logs::exchange(&records, "initialize").expect("initialize");
        let init = logs::message(answer)
            .and_then(|msg| msg.get("result"))
            .expect("result");
        assert_eq!(auth_method_ids(init), "openrouter, hermes-setup");
    }
}
