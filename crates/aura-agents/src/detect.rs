//! Detection: whether each agent can start here, and the launch spec of one start.
//!
//! Probes run through `run_helper` with the resolved, scrubbed env, 10 s and 64 KiB of output;
//! binaries run in `$HOME`, adapter probes in the adapter folder. Results are cached, and every
//! caller shares the env resolution and the probe in flight. Detection never installs and never
//! runs an adapter: the install happens in [`Detector::prepare_launch`].
//!
//! - `Binary`: found on the env's `PATH`, its version command runs, and it meets its floor.
//! - `NativeBinary`: the user's executable override or CLI on `PATH` runs and meets its floor,
//!   with the same executable rules as adapters but without Node.js or npm.
//! - `NpmAdapter`: Node of the required major or newer; the user's binary (the adapter's variable
//!   when it names an executable file, else the one on `PATH`; `.exe` only on Windows) runs and
//!   meets its floor; `npm` is needed only until the adapter is installed. `Ready` names the user's
//!   binary, the one that will actually run.
//!
//! Other crates' tests use [`Detector::fixed`]: [`FixedAgent`]s answer as given, can read
//! `Checking` until a detection ends, send download details, and hold detection or a launch
//! preparation at a [`Gate`]; the detector records every [`Detector::forget_install`].

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use aura_process::{EnvResolver, LaunchSpec, LeftoverRegistry, find_program};
use aura_protocol::session::{AgentEntry, Availability};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch};

use crate::catalog::{AgentSpec, Recipe, catalog};
use crate::install::{self, InstallJob};
use crate::launch::{self, LaunchError};
use crate::probe::{self, BUILT_IN, Detection};
use crate::shared::SharedTask;

/// Detects agents and prepares their launches.
#[derive(Debug)]
pub struct Detector {
    mode: Mode,
    /// The agent of every `forget_install`, in order.
    forgotten: Mutex<Vec<String>>,
}

#[derive(Debug)]
enum Mode {
    Live(Arc<Live>),
    Fixed { agents: Vec<Fixed> },
}

/// A probe of one agent, shared by everyone waiting for it.
type Probe = SharedTask<Detection>;

/// An install of one adapter version, shared by every start waiting for it: when the last of them
/// stops waiting, the install is cancelled and npm is killed.
type Install = SharedTask<Result<PathBuf, LaunchError>>;

/// How often a probe or an install is started again when the one joined was cancelled under it.
const ATTEMPTS: usize = 3;

/// The real detector: the catalog's agents, probed with the resolved env.
struct Live {
    specs: Vec<AgentSpec>,
    env: Arc<EnvResolver>,
    registry: Arc<LeftoverRegistry>,
    adapters_dir: PathBuf,
    rt: Handle,
    state: Mutex<LiveState>,
}

#[derive(Default)]
struct LiveState {
    /// Each agent's latest detection, with the generation of the probe that made it.
    results: HashMap<String, (u64, Detection)>,
    probes: HashMap<String, Probe>,
    installs: HashMap<String, Install>,
    generation: u64,
}

impl std::fmt::Debug for Live {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let state = lock(&self.state);
        f.debug_struct("Live")
            .field("agents", &self.specs.len())
            .field("detected", &state.results.len())
            .field("adapters_dir", &self.adapters_dir)
            .finish_non_exhaustive()
    }
}

impl Live {
    /// The probe of `spec` in flight, or a new one (always a new one with `fresh`).
    fn probe(self: &Arc<Self>, spec: &AgentSpec, fresh: bool) -> Probe {
        let mut state = lock(&self.state);
        if !fresh && let Some(running) = state.probes.get(spec.id).filter(|probe| probe.is_live()) {
            return running.clone();
        }
        state.generation += 1;
        let generation = state.generation;
        let live = Arc::clone(self);
        let id = spec.id;
        let spec = spec.clone();
        let probe = SharedTask::spawn(&self.rt, async move {
            let env = live.env.get().await;
            let detection = probe::detect(&spec, &env, &live.registry, &live.adapters_dir).await;
            let mut state = lock(&live.state);
            let newer = state
                .results
                .get(spec.id)
                .is_some_and(|(known, _)| *known > generation);
            if !newer {
                state
                    .results
                    .insert(spec.id.to_owned(), (generation, detection.clone()));
            }
            detection
        });
        state.probes.insert(id.to_owned(), probe.clone());
        probe
    }

    fn cached(&self, spec: &AgentSpec) -> Option<Detection> {
        lock(&self.state)
            .results
            .get(spec.id)
            .map(|(_, detection)| detection.clone())
    }

    /// The cached detection, or the one in flight, or a new one.
    async fn detect(self: &Arc<Self>, spec: &AgentSpec) -> Detection {
        if let Some(detection) = self.cached(spec) {
            return detection;
        }
        for _ in 0..ATTEMPTS {
            if let Some(detection) = self.probe(spec, false).wait().await {
                return detection;
            }
        }
        Detection::missing(format!(
            "Checking {} was interrupted; try again.",
            spec.name
        ))
    }

    /// Probes every agent at once and waits for all of them.
    async fn detect_every(self: &Arc<Self>, fresh: bool) {
        let probes: Vec<Probe> = self
            .specs
            .iter()
            .map(|spec| self.probe(spec, fresh))
            .collect();
        // Held together, so one start leaving a probe early never cancels it under this wait.
        let _holds: Vec<_> = probes.iter().map(SharedTask::hold).collect();
        for probe in &probes {
            probe.wait().await;
        }
    }

    /// Updates the cached download state of an adapter.
    fn set_needs_download(&self, spec: &AgentSpec, needs_download: bool) {
        if let Some((_, detection)) = lock(&self.state).results.get_mut(spec.id) {
            detection.needs_download = needs_download;
        }
    }

    fn entry(&self, spec: &AgentSpec) -> AgentEntry {
        if matches!(spec.recipe, Recipe::Builtin) {
            return entry(
                spec,
                Availability::Ready {
                    version: None,
                    path: BUILT_IN.into(),
                },
                false,
            );
        }
        match self.cached(spec) {
            Some(detection) => entry(spec, detection.availability, detection.needs_download),
            None => entry(spec, Availability::Checking, false),
        }
    }

    async fn prepare_launch(
        self: &Arc<Self>,
        spec: &AgentSpec,
        progress: mpsc::UnboundedSender<String>,
    ) -> Result<LaunchSpec, LaunchError> {
        let detection = self.detect(spec).await;
        let located = match (&detection.availability, detection.located) {
            (Availability::Ready { .. }, located) => located,
            (availability, _) => return Err(unavailable(availability)),
        };
        match &spec.recipe {
            Recipe::Builtin => Ok(launch::builtin(spec)),
            Recipe::Binary { program, args, .. }
            | Recipe::QualifiedBinary { program, args, .. } => {
                let located = located.ok_or_else(|| LaunchError::Missing {
                    reason: format!("{program} was not found on your PATH."),
                })?;
                Ok(launch::binary(spec, &located.program, program, args))
            }
            Recipe::NativeBinary { user_binary, args } => {
                let located = located.ok_or_else(|| LaunchError::Missing {
                    reason: format!("{} was not found on your PATH.", user_binary.program),
                })?;
                Ok(launch::binary(
                    spec,
                    &located.program,
                    user_binary.program,
                    args,
                ))
            }
            Recipe::NpmAdapter {
                package,
                version,
                bin,
                user_binary,
                ..
            } => {
                let short = probe::short_name(user_binary);
                let Some(located) = located else {
                    return Err(LaunchError::Missing {
                        reason: format!("The {short} adapter can't start here."),
                    });
                };
                let node = located.node.clone().ok_or_else(|| LaunchError::Missing {
                    reason: "Node.js was not found on your PATH.".into(),
                })?;
                let folder = self
                    .adapters_dir
                    .join(install::folder_name(package, version));
                let entry = match install::installed_entry(&folder, package, version) {
                    Some(entry) => entry,
                    None => {
                        let _ = progress.send(format!(
                            "Downloading the {short} adapter ({package} {version}). This happens once and can take a few minutes."
                        ));
                        let env = self.env.get().await;
                        let npm = find_program("npm", &env.vars).ok_or_else(|| LaunchError::Missing {
                            reason: "npm was not found; auracode needs it once to download the adapter."
                                .into(),
                        })?;
                        let job = InstallJob {
                            package,
                            version,
                            bin,
                            short_name: short.to_owned(),
                            folder: folder.clone(),
                            npm,
                            node: node.clone(),
                            env,
                            registry: Arc::clone(&self.registry),
                        };
                        let entry = self.install(job).await?;
                        self.set_needs_download(spec, false);
                        entry
                    }
                };
                Ok(launch::adapter(
                    spec,
                    bin,
                    &node,
                    &entry,
                    &folder,
                    user_binary,
                    &located.program,
                ))
            }
        }
    }

    /// The install of this adapter version in flight, or a new one; waits for it.
    async fn install(&self, job: InstallJob) -> Result<PathBuf, LaunchError> {
        let key = format!("{}@{}", job.package, job.version);
        for _ in 0..ATTEMPTS {
            let install: Install = {
                let mut state = lock(&self.state);
                match state.installs.get(&key) {
                    // A finished install is never joined: the next start checks the marker itself.
                    Some(running) if running.is_running() => running.clone(),
                    _ => {
                        let install = SharedTask::spawn(&self.rt, install::install(job.clone()));
                        state.installs.insert(key.clone(), install.clone());
                        install
                    }
                }
            };
            if let Some(result) = install.wait().await {
                return result;
            }
        }
        Err(LaunchError::InstallFailed {
            reason: format!(
                "Could not download the {} adapter: the download was interrupted.",
                job.short_name
            ),
        })
    }

    fn forget_install(&self, spec: &AgentSpec) {
        let Recipe::NpmAdapter {
            package, version, ..
        } = &spec.recipe
        else {
            return;
        };
        let folder = self
            .adapters_dir
            .join(install::folder_name(package, version));
        if let Err(error) = install::forget(&folder) {
            tracing::warn!(agent = spec.id, %error, "could not delete an adapter's install marker");
        }
        self.set_needs_download(spec, true);
    }
}

/// An agent with fixed answers, for tests: no probes, no env, no installs.
///
/// Build one with [`FixedAgent::new`] and the `with_*` methods: the struct is `non_exhaustive`, so
/// later fields never break a test. By default `detect` answers `availability` at once,
/// `prepare_launch` answers `launch` at once, and nothing needs a download.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct FixedAgent {
    pub spec: AgentSpec,
    /// What [`Detector::cached`] reports until a [`Detector::detect`] of this agent ends, and what
    /// `detect` answers unless `detected` is set.
    pub availability: Availability,
    /// What `detect` answers, and `cached` reports from then on: an agent that reads `Checking`
    /// at first and that detection finds `Ready`, `Missing` or `Broken`.
    pub detected: Option<Availability>,
    /// `None` for a built-in agent, or to make `prepare_launch` fail with the availability's reason.
    pub launch: Option<LaunchSpec>,
    /// `prepare_launch` fails with this instead, after its download details and its gate (an
    /// `InstallFailed` download, say).
    pub launch_error: Option<LaunchError>,
    /// The adapter is not installed yet: `AgentEntry::needs_download` reads true, and the next
    /// `prepare_launch` sends `progress` before it answers. A successful `prepare_launch` installs
    /// it, and `forget_install` on an npm adapter makes the download needed again.
    pub needs_download: bool,
    /// The status details a download sends through `prepare_launch`'s `progress`, in order.
    pub progress: Vec<String>,
    /// Holds every `detect` of this agent until the gate opens.
    pub detect_gate: Option<Gate>,
    /// Holds every `prepare_launch` of this agent, after its download details, until the gate
    /// opens.
    pub launch_gate: Option<Gate>,
}

impl FixedAgent {
    /// An agent that reports `availability` and starts with `launch` (`None` for a built-in agent,
    /// or to make `prepare_launch` fail with the availability's reason).
    pub fn new(
        spec: AgentSpec,
        availability: Availability,
        launch: Option<LaunchSpec>,
    ) -> FixedAgent {
        FixedAgent {
            spec,
            availability,
            detected: None,
            launch,
            launch_error: None,
            needs_download: false,
            progress: Vec::new(),
            detect_gate: None,
            launch_gate: None,
        }
    }

    /// `detect` answers `availability`, and `cached` reports it from then on.
    pub fn with_detected(mut self, availability: Availability) -> FixedAgent {
        self.detected = Some(availability);
        self
    }

    /// The adapter is not installed: the next `prepare_launch` sends `progress` first.
    pub fn with_download(mut self, progress: Vec<String>) -> FixedAgent {
        self.needs_download = true;
        self.progress = progress;
        self
    }

    /// `prepare_launch` fails with `error`.
    pub fn with_launch_error(mut self, error: LaunchError) -> FixedAgent {
        self.launch_error = Some(error);
        self
    }

    /// `detect` waits until `gate` opens.
    pub fn with_detect_gate(mut self, gate: Gate) -> FixedAgent {
        self.detect_gate = Some(gate);
        self
    }

    /// `prepare_launch` waits until `gate` opens, after its download details.
    pub fn with_launch_gate(mut self, gate: Gate) -> FixedAgent {
        self.launch_gate = Some(gate);
        self
    }
}

/// Holds a fixed agent's detection or launch preparation until the test opens it, so a test can
/// act while a start is still preparing (an Esc during a download, say). Clones share one gate, and
/// it stays open once opened.
#[derive(Debug, Clone)]
pub struct Gate {
    inner: Arc<GateInner>,
}

#[derive(Debug)]
struct GateInner {
    open: watch::Sender<bool>,
    /// Calls waiting at the gate now.
    waiting: watch::Sender<usize>,
}

impl Gate {
    pub fn new() -> Gate {
        Gate {
            inner: Arc::new(GateInner {
                open: watch::Sender::new(false),
                waiting: watch::Sender::new(0),
            }),
        }
    }

    /// Lets every waiting call through, and every later one.
    pub fn open(&self) {
        self.inner.open.send_replace(true);
    }

    /// How many calls wait at the gate now. A call whose future was dropped while it waited (a
    /// start that was interrupted) no longer counts.
    pub fn waiting(&self) -> usize {
        *self.inner.waiting.borrow()
    }

    /// Resolves once exactly `count` calls wait at the gate: 1 when a preparation reached it, 0 once
    /// it passed or was dropped.
    pub async fn until_waiting(&self, count: usize) {
        let mut waiting = self.inner.waiting.subscribe();
        // The gate holds the sender, so the channel stays open while `self` lives.
        let _ = waiting.wait_for(|now| *now == count).await;
    }

    /// Waits until the gate is open, counted as waiting meanwhile.
    async fn pass(&self) {
        let mut open = self.inner.open.subscribe();
        if *open.borrow() {
            return;
        }
        self.inner.waiting.send_modify(|now| *now += 1);
        let _leave = Leave(&self.inner.waiting);
        let _ = open.wait_for(|open| *open).await;
    }
}

impl Default for Gate {
    fn default() -> Gate {
        Gate::new()
    }
}

/// Stops counting a call as waiting once it passes the gate or its future is dropped.
struct Leave<'a>(&'a watch::Sender<usize>);

impl Drop for Leave<'_> {
    fn drop(&mut self) {
        self.0.send_modify(|now| *now = now.saturating_sub(1));
    }
}

/// A fixed agent and what its answers have done so far.
#[derive(Debug)]
struct Fixed {
    agent: FixedAgent,
    state: Mutex<FixedState>,
}

#[derive(Debug, Clone, Copy)]
struct FixedState {
    /// A `detect` ended: `cached` reports the detected availability.
    detected: bool,
    needs_download: bool,
}

impl Fixed {
    fn new(agent: FixedAgent) -> Fixed {
        let state = FixedState {
            detected: false,
            needs_download: agent.needs_download,
        };
        Fixed {
            agent,
            state: Mutex::new(state),
        }
    }

    /// The availability detection ends with.
    fn detected(&self) -> &Availability {
        self.agent
            .detected
            .as_ref()
            .unwrap_or(&self.agent.availability)
    }

    fn entry(&self) -> AgentEntry {
        let state = *lock(&self.state);
        let availability = if state.detected {
            self.detected()
        } else {
            &self.agent.availability
        };
        entry(&self.agent.spec, availability.clone(), state.needs_download)
    }

    async fn detect(&self) -> Availability {
        if let Some(gate) = &self.agent.detect_gate {
            gate.pass().await;
        }
        lock(&self.state).detected = true;
        self.detected().clone()
    }

    async fn prepare_launch(
        &self,
        progress: mpsc::UnboundedSender<String>,
    ) -> Result<LaunchSpec, LaunchError> {
        let downloading = lock(&self.state).needs_download;
        if downloading {
            for detail in &self.agent.progress {
                // A start that no longer listens drops this future next.
                let _ = progress.send(detail.clone());
            }
        }
        if let Some(gate) = &self.agent.launch_gate {
            gate.pass().await;
        }
        let launch = self.launch()?;
        if downloading {
            lock(&self.state).needs_download = false;
        }
        Ok(launch)
    }

    fn launch(&self) -> Result<LaunchSpec, LaunchError> {
        if let Some(error) = &self.agent.launch_error {
            return Err(error.clone());
        }
        match (&self.agent.launch, &self.agent.spec.recipe) {
            (Some(launch), _) => Ok(launch.clone()),
            (None, Recipe::Builtin) => Ok(launch::builtin(&self.agent.spec)),
            (None, _) => Err(unavailable(self.detected())),
        }
    }
}

impl Detector {
    /// Detects the catalog's agents. Detection starts in the background on `rt` at once and probes
    /// once the env resolves; `adapters_dir` is `<data root>/adapters`.
    pub fn new(
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
        adapters_dir: PathBuf,
        rt: Handle,
    ) -> Arc<Detector> {
        let live = Arc::new(Live {
            specs: catalog().to_vec(),
            env,
            registry,
            adapters_dir,
            rt: rt.clone(),
            state: Mutex::new(LiveState::default()),
        });
        let background = Arc::clone(&live);
        rt.spawn(async move { background.detect_every(false).await });
        Arc::new(Detector {
            mode: Mode::Live(live),
            forgotten: Mutex::new(Vec::new()),
        })
    }

    /// Tests: these agents, in this order, with fixed answers (see [`FixedAgent`]); no probes, no
    /// env, no installs.
    pub fn fixed(agents: Vec<FixedAgent>) -> Arc<Detector> {
        Arc::new(Detector {
            mode: Mode::Fixed {
                agents: agents.into_iter().map(Fixed::new).collect(),
            },
            forgotten: Mutex::new(Vec::new()),
        })
    }

    /// The agent with this id. The session manager looks agents up here, never in `catalog()`, so
    /// tests can inject their own.
    pub fn spec(&self, id: &str) -> Option<AgentSpec> {
        match &self.mode {
            Mode::Live(live) => live.specs.iter().find(|spec| spec.id == id).cloned(),
            Mode::Fixed { agents } => find(agents, id).map(|fixed| fixed.agent.spec.clone()),
        }
    }

    /// Whether `spec` can start here. Cached; waits for the env resolution and the probe in flight,
    /// which it shares with every other caller, so it answers `Ready`, `Missing` or `Broken`, never
    /// `Checking`. A fixed agent answers its `detected` availability, or `availability` without one.
    pub async fn detect(&self, spec: &AgentSpec) -> Availability {
        match &self.mode {
            Mode::Live(live) => live.detect(spec).await.availability,
            Mode::Fixed { agents } => match find(agents, spec.id) {
                Some(fixed) => fixed.detect().await,
                None => Availability::Missing {
                    reason: unknown(spec),
                },
            },
        }
    }

    /// Every agent, in catalog order (a fixed detector's in the order given).
    ///
    /// `refresh: false` answers at once with [`cached`](Self::cached), never waiting: an agent whose
    /// first detection has not ended reads `Checking`, and detection runs in the background from
    /// [`new`](Self::new) on, once the env resolves. `refresh: true` resolves the env again, probes
    /// every agent, and waits for the results; a fixed detector runs `detect` for each agent in
    /// turn.
    pub async fn detect_all(&self, refresh: bool) -> Vec<AgentEntry> {
        if refresh {
            match &self.mode {
                Mode::Fixed { agents } => {
                    for fixed in agents {
                        fixed.detect().await;
                    }
                }
                Mode::Live(live) => {
                    live.env.refresh();
                    live.detect_every(true).await;
                }
            }
        }
        self.cached()
    }

    /// The last results, without waiting: `Checking` until an agent's first detection ends.
    pub fn cached(&self) -> Vec<AgentEntry> {
        match &self.mode {
            Mode::Live(live) => live.specs.iter().map(|spec| live.entry(spec)).collect(),
            Mode::Fixed { agents } => agents.iter().map(Fixed::entry).collect(),
        }
    }

    /// Installs an npm adapter when it is not installed (one shared attempt per package; `progress`
    /// receives status details), then builds the launch spec. Dropping the future kills a running
    /// install.
    pub async fn prepare_launch(
        &self,
        spec: &AgentSpec,
        progress: mpsc::UnboundedSender<String>,
    ) -> Result<LaunchSpec, LaunchError> {
        match &self.mode {
            Mode::Fixed { agents } => match find(agents, spec.id) {
                Some(fixed) => fixed.prepare_launch(progress).await,
                None => Err(LaunchError::Missing {
                    reason: unknown(spec),
                }),
            },
            Mode::Live(live) => live.prepare_launch(spec, progress).await,
        }
    }

    /// Deletes an adapter's install marker, so the next start installs it again (a start failed on
    /// a missing module). Every call is recorded ([`forgotten`](Self::forgotten)); a fixed npm
    /// adapter needs its download again.
    pub fn forget_install(&self, spec: &AgentSpec) {
        lock(&self.forgotten).push(spec.id.to_owned());
        match &self.mode {
            Mode::Live(live) => live.forget_install(spec),
            Mode::Fixed { agents } => {
                if let Some(fixed) = find(agents, spec.id)
                    && matches!(fixed.agent.spec.recipe, Recipe::NpmAdapter { .. })
                {
                    lock(&fixed.state).needs_download = true;
                }
            }
        }
    }

    /// Tests: the agent of every [`forget_install`](Self::forget_install) so far, in order.
    pub fn forgotten(&self) -> Vec<String> {
        lock(&self.forgotten).clone()
    }
}

fn find<'a>(agents: &'a [Fixed], id: &str) -> Option<&'a Fixed> {
    agents.iter().find(|fixed| fixed.agent.spec.id == id)
}

/// The reason an agent the detector does not know cannot start.
fn unknown(spec: &AgentSpec) -> String {
    format!("auracode doesn't know an agent called \"{}\".", spec.id)
}

/// The error for an agent that cannot start, from its availability.
fn unavailable(availability: &Availability) -> LaunchError {
    match availability {
        Availability::Missing { reason } => LaunchError::Missing {
            reason: reason.clone(),
        },
        Availability::Broken { reason } => LaunchError::Broken {
            reason: reason.clone(),
        },
        Availability::Checking | Availability::Ready { .. } => LaunchError::Missing {
            reason: "this test agent has no launch spec".into(),
        },
    }
}

/// An agent as the New chat screen lists it.
fn entry(spec: &AgentSpec, availability: Availability, needs_download: bool) -> AgentEntry {
    AgentEntry {
        id: spec.id.to_owned(),
        name: spec.name.to_owned(),
        description: spec.description.to_owned(),
        availability,
        launch: launch_label(spec),
        needs_download,
        last_verified: spec.last_verified.to_owned(),
    }
}

/// How the agent starts, for display.
fn launch_label(spec: &AgentSpec) -> String {
    match &spec.recipe {
        Recipe::Binary { program, args, .. } | Recipe::QualifiedBinary { program, args, .. } => {
            std::iter::once(*program)
                .chain(args.iter().copied())
                .collect::<Vec<_>>()
                .join(" ")
        }
        Recipe::NativeBinary { user_binary, args } => std::iter::once(user_binary.program)
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" "),
        Recipe::NpmAdapter {
            package,
            version,
            user_binary,
            ..
        } => format!("{package} {version} with your {}", user_binary.program),
        Recipe::Builtin => BUILT_IN.into(),
    }
}

/// Locks `mutex`, recovering the data of a thread that panicked while holding it: a test double
/// must keep answering after a test's own panic.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use aura_process::{EnvMap, EnvSource, ProcessCwd, ResolvedEnv};

    use super::*;
    use crate::catalog::get;

    fn live() -> Arc<Detector> {
        let env = EnvResolver::fixed(ResolvedEnv {
            vars: EnvMap::new(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        });
        Detector::new(
            env,
            LeftoverRegistry::disabled(),
            PathBuf::from("/data/adapters"),
            Handle::current(),
        )
    }

    fn progress() -> mpsc::UnboundedSender<String> {
        mpsc::unbounded_channel().0
    }

    fn ready(path: &str) -> Availability {
        Availability::Ready {
            version: Some("1.0.0".into()),
            path: path.into(),
        }
    }

    fn claude() -> AgentSpec {
        get("claude-acp").expect("claude").clone()
    }

    fn claude_launch() -> LaunchSpec {
        LaunchSpec {
            label: "claude-agent-acp".into(),
            program: PathBuf::from("/usr/local/bin/node"),
            args: vec!["/data/adapters/claude/entry.js".into()],
            cwd: ProcessCwd::Fixed(PathBuf::from("/data/adapters/claude")),
            set_env: Vec::new(),
            daemons: Vec::new(),
            startup_timeout: Duration::from_secs(60),
        }
    }

    const DOWNLOADING: &str = "Downloading the Claude adapter (@agentclientprotocol/claude-agent-acp 0.95.0). This happens once and can take a few minutes.";

    fn needs_download(detector: &Detector) -> bool {
        detector.cached()[0].needs_download
    }

    /// With nothing on `PATH`, detection finds nothing to run and probes nothing.
    #[tokio::test]
    async fn a_live_detector_with_an_empty_path_reports_why_each_agent_is_missing() {
        let detector = live();
        let entries = detector.detect_all(true).await;
        let ids: Vec<&str> = entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(
            ids,
            catalog().iter().map(|spec| spec.id).collect::<Vec<_>>()
        );
        for entry in entries.iter().filter(|entry| {
            matches!(
                entry.id.as_str(),
                "antigravity" | "cursor" | "grok" | "omp" | "opencode" | "opencode-v2"
            )
        }) {
            assert!(
                matches!(&entry.availability, Availability::Missing { reason } if reason.contains("official"))
            );
        }
        let reasons: Vec<Availability> = entries
            .iter()
            .filter(|entry| {
                matches!(
                    entry.id.as_str(),
                    "hermes" | "claude" | "claude-acp" | "codex-acp" | "pi" | "mock"
                )
            })
            .map(|entry| entry.availability.clone())
            .collect();
        assert_eq!(
            reasons,
            [
                Availability::Missing {
                    reason: "hermes was not found on your PATH.".into()
                },
                Availability::Missing {
                    reason: "claude was not found on your PATH.".into()
                },
                Availability::Missing {
                    reason: "Node.js 22 or newer is required (found none).".into()
                },
                Availability::Missing {
                    reason: "Node.js 22 or newer is required (found none).".into()
                },
                Availability::Missing {
                    reason: "pi was not found on your PATH.".into()
                },
                Availability::Ready {
                    version: None,
                    path: BUILT_IN.into()
                },
            ]
        );
        assert!(entries.iter().all(|entry| !entry.needs_download));
        assert_eq!(entries[0].launch, "hermes acp");
        assert_eq!(
            entries[2].launch,
            "@agentclientprotocol/claude-agent-acp 0.95.0 with your claude"
        );
        assert_eq!(detector.cached(), entries);

        let mock = detector.spec("mock").expect("mock");
        let launch = detector
            .prepare_launch(&mock, progress())
            .await
            .expect("the demo agent starts");
        assert_eq!(launch.label, "mock");
        assert_eq!(launch.program, PathBuf::new());
        assert_eq!(launch.cwd, ProcessCwd::ChatFolder);
        assert_eq!(launch.startup_timeout, Duration::from_secs(5));

        let hermes = detector.spec("hermes").expect("hermes");
        assert_eq!(
            detector.prepare_launch(&hermes, progress()).await,
            Err(LaunchError::Missing {
                reason: "hermes was not found on your PATH.".into()
            })
        );
        assert!(matches!(
            detector.detect(&hermes).await,
            Availability::Missing { .. }
        ));
        assert!(detector.spec("cursor").is_some());
        assert!(detector.spec("agent").is_none());
        detector.forget_install(&claude());
        assert_eq!(detector.forgotten(), ["claude-acp"]);
    }

    #[tokio::test]
    async fn the_demo_agent_is_ready_before_any_detection() {
        let detector = live();
        let entries = detector.cached();
        assert!(matches!(
            entries
                .iter()
                .find(|entry| entry.id == "mock")
                .expect("demo agent")
                .availability,
            Availability::Ready { .. }
        ));
    }

    #[tokio::test]
    async fn fixed_agents_answer_as_given() {
        let hermes = get("hermes").expect("hermes").clone();
        let launch = LaunchSpec {
            label: "hermes acp".into(),
            program: PathBuf::from("/opt/bin/hermes"),
            args: vec!["acp".into()],
            cwd: ProcessCwd::ChatFolder,
            set_env: Vec::new(),
            daemons: hermes.daemons.clone(),
            startup_timeout: hermes.startup_timeout,
        };
        let broken = AgentSpec {
            id: "broken",
            ..get("codex-acp").expect("codex").clone()
        };
        let detector = Detector::fixed(vec![
            FixedAgent::new(
                hermes.clone(),
                Availability::Ready {
                    version: Some("0.22.5".into()),
                    path: "/opt/bin/hermes".into(),
                },
                Some(launch.clone()),
            ),
            FixedAgent::new(
                broken.clone(),
                Availability::Broken {
                    reason: "auracode needs Codex 0.160.1 or newer (found 0.1.0).".into(),
                },
                None,
            ),
            FixedAgent::new(
                get("mock").expect("mock").clone(),
                Availability::Checking,
                None,
            ),
        ]);
        assert_eq!(detector.spec("hermes"), Some(hermes.clone()));
        assert!(
            detector.spec("claude-acp").is_none(),
            "only the given agents"
        );
        assert_eq!(
            detector.prepare_launch(&hermes, progress()).await,
            Ok(launch)
        );
        assert_eq!(
            detector.prepare_launch(&broken, progress()).await,
            Err(LaunchError::Broken {
                reason: "auracode needs Codex 0.160.1 or newer (found 0.1.0).".into()
            })
        );
        let mock = detector.spec("mock").expect("mock");
        assert_eq!(
            detector
                .prepare_launch(&mock, progress())
                .await
                .map(|launch| launch.label),
            Ok("mock".to_owned())
        );
        let entries = detector.detect_all(true).await;
        let ids: Vec<&str> = entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["hermes", "broken", "mock"]);
        assert!(entries.iter().all(|entry| !entry.needs_download));
        assert_eq!(detector.detect(&mock).await, Availability::Checking);
        let stranger = AgentSpec {
            id: "stranger",
            ..mock
        };
        assert!(matches!(
            detector.prepare_launch(&stranger, progress()).await,
            Err(LaunchError::Missing { .. })
        ));
        assert!(matches!(
            detector.detect(&stranger).await,
            Availability::Missing { .. }
        ));
        detector.forget_install(&broken);
        detector.forget_install(&hermes);
        assert_eq!(detector.forgotten(), ["broken", "hermes"]);
        let downloads: Vec<(String, bool)> = detector
            .cached()
            .into_iter()
            .map(|entry| (entry.id, entry.needs_download))
            .collect();
        assert_eq!(
            downloads,
            [
                ("hermes".to_owned(), false),
                ("broken".to_owned(), true),
                ("mock".to_owned(), false)
            ],
            "only an npm adapter has an install to forget"
        );
    }

    /// `Checking` proceeds at create time, and the start waits for detection, which may find the
    /// agent ready or missing.
    #[tokio::test]
    async fn a_fixed_agent_reads_checking_until_detection_ends() {
        let detector = Detector::fixed(vec![
            FixedAgent::new(claude(), Availability::Checking, Some(claude_launch()))
                .with_detected(ready("/usr/local/bin/claude")),
        ]);
        assert_eq!(detector.cached()[0].availability, Availability::Checking);
        assert_eq!(detector.detect_all(false).await, detector.cached());
        assert_eq!(
            detector.detect(&claude()).await,
            ready("/usr/local/bin/claude")
        );
        assert_eq!(
            detector.cached()[0].availability,
            ready("/usr/local/bin/claude")
        );

        let missing = Availability::Missing {
            reason: "The Claude adapter drives your own Claude Code, and claude was not found on your PATH.".into(),
        };
        let detector = Detector::fixed(vec![
            FixedAgent::new(claude(), Availability::Checking, None).with_detected(missing.clone()),
        ]);
        let entries = detector.detect_all(true).await;
        assert_eq!(entries[0].availability, missing);
        assert_eq!(
            detector.prepare_launch(&claude(), progress()).await,
            Err(LaunchError::Missing {
                reason: "The Claude adapter drives your own Claude Code, and claude was not found on your PATH.".into()
            }),
            "a failed launch reports the detected reason"
        );
    }

    #[tokio::test]
    async fn a_download_sends_its_details_once_and_forget_install_needs_it_again() {
        let detector = Detector::fixed(vec![
            FixedAgent::new(
                claude(),
                ready("/usr/local/bin/claude"),
                Some(claude_launch()),
            )
            .with_download(vec![DOWNLOADING.into()]),
        ]);
        assert!(needs_download(&detector));

        let (details, mut received) = mpsc::unbounded_channel();
        assert_eq!(
            detector.prepare_launch(&claude(), details.clone()).await,
            Ok(claude_launch())
        );
        assert_eq!(received.try_recv().as_deref(), Ok(DOWNLOADING));
        assert!(received.try_recv().is_err(), "one detail");
        assert!(!needs_download(&detector), "installed");

        assert_eq!(
            detector.prepare_launch(&claude(), details.clone()).await,
            Ok(claude_launch())
        );
        assert!(received.try_recv().is_err(), "no second download");

        detector.forget_install(&claude());
        assert_eq!(detector.forgotten(), ["claude-acp"]);
        assert!(needs_download(&detector));
        assert_eq!(
            detector.prepare_launch(&claude(), details).await,
            Ok(claude_launch())
        );
        assert_eq!(
            received.try_recv().as_deref(),
            Ok(DOWNLOADING),
            "Retry downloads again"
        );
    }

    #[tokio::test]
    async fn a_failed_download_installs_nothing() {
        let failure = LaunchError::InstallFailed {
            reason: "Could not download the Claude adapter: npm error code E404".into(),
        };
        let detector = Detector::fixed(vec![
            FixedAgent::new(
                claude(),
                ready("/usr/local/bin/claude"),
                Some(claude_launch()),
            )
            .with_download(vec![DOWNLOADING.into()])
            .with_launch_error(failure.clone()),
        ]);
        let (details, mut received) = mpsc::unbounded_channel();
        assert_eq!(
            detector.prepare_launch(&claude(), details).await,
            Err(failure)
        );
        assert_eq!(received.try_recv().as_deref(), Ok(DOWNLOADING));
        assert!(needs_download(&detector), "still not installed");
    }

    #[tokio::test]
    async fn gates_hold_detection_and_preparation_until_opened() {
        let detect_gate = Gate::new();
        let launch_gate = Gate::default();
        let detector = Detector::fixed(vec![
            FixedAgent::new(claude(), Availability::Checking, Some(claude_launch()))
                .with_detected(ready("/usr/local/bin/claude"))
                .with_download(vec![DOWNLOADING.into()])
                .with_detect_gate(detect_gate.clone())
                .with_launch_gate(launch_gate.clone()),
        ]);

        let detecting = tokio::spawn({
            let detector = Arc::clone(&detector);
            async move { detector.detect(&claude()).await }
        });
        detect_gate.until_waiting(1).await;
        assert_eq!(detector.cached()[0].availability, Availability::Checking);
        assert!(!detecting.is_finished());
        detect_gate.open();
        assert_eq!(
            detecting.await.expect("join"),
            ready("/usr/local/bin/claude")
        );
        assert_eq!(detect_gate.waiting(), 0);
        assert_eq!(
            detector.detect(&claude()).await,
            ready("/usr/local/bin/claude"),
            "an open gate stays open"
        );

        // An Esc during the download drops the preparation at the gate: nothing is installed.
        let (details, mut received) = mpsc::unbounded_channel();
        let preparing = tokio::spawn({
            let detector = Arc::clone(&detector);
            let details = details.clone();
            async move { detector.prepare_launch(&claude(), details).await }
        });
        launch_gate.until_waiting(1).await;
        assert_eq!(received.recv().await.as_deref(), Some(DOWNLOADING));
        preparing.abort();
        launch_gate.until_waiting(0).await;
        assert!(preparing.await.expect_err("aborted").is_cancelled());
        assert!(needs_download(&detector));

        // Retry, released: the download runs again and completes.
        let preparing = tokio::spawn({
            let detector = Arc::clone(&detector);
            async move { detector.prepare_launch(&claude(), details).await }
        });
        launch_gate.until_waiting(1).await;
        assert_eq!(received.recv().await.as_deref(), Some(DOWNLOADING));
        launch_gate.open();
        assert_eq!(preparing.await.expect("join"), Ok(claude_launch()));
        assert_eq!(launch_gate.waiting(), 0);
        assert!(!needs_download(&detector));
    }
}
