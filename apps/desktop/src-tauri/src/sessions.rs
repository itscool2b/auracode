//! Chat sessions in the shell: the channels a chat view's frames and the chat list's updates travel
//! on, the startup wiring of the session manager, the page-load hook, the quit flow with its
//! question while saving is paused and its signals, and the answers of the folder picker and "Show
//! log".
//!
//! Everything here is glue over aura-core's [`SessionManager`]. The parts with decisions in them are
//! written against small seams ([`QuitHost`], [`SignalHost`], [`Outside`], plain closures), so their
//! tests drive them with fakes instead of a running app.
//!
//! - **Channels.** [`ChannelSink`] carries one open chat view's frames, [`StatusChannelSink`] one
//!   webview's chat-list updates. A failed send answers [`SinkGone`], which removes the subscriber;
//!   detaching drops the last Rust clone, so Tauri ends the JavaScript channel.
//! - **Page loads.** A reloaded page has new channel callbacks, so frames for the old ones would be
//!   lost without an error. [`page_load`] drops every subscription of the webview through the
//!   manager, and each sink also carries the [`PageToken`] of the page that asked for it, so a sink
//!   registered while the reload was starting fails its first send instead of lingering.
//! - **Startup** ([`start_chats`]): the chat store takes the opened store and the owner lock, then
//!   the leftover registry, the sweep and log retention (in the background), one redactor shared by
//!   the env resolver, the protocol logs and the manager, the detector, and the manager itself.
//! - **Quit** ([`Quit`], [`run_quit`]): the first exit request of any kind is prevented, the window
//!   hides, a paused store with unsaved data asks first, then every session stops within 8 s, the
//!   store commits and closes within 5 s, the registry file goes, and the app exits with the code
//!   it was asked for. `RunEvent::Exit` is the synchronous last resort ([`exit_last_resort`]).
//! - **Signals** (Unix, [`SignalListener`]): SIGTERM, SIGINT and SIGHUP start the same flow; a second
//!   one kills every agent at once and exits with 128 plus its number.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aura_agents::Detector;
use aura_core::chatstore::ChatStore;
use aura_core::profile::Profile;
use aura_core::session::{
    FrameSink, ManagerDeps, ManagerLimits, SessionManager, SessionTimings, ShutdownSummary,
    SinkGone, StatusSink,
};
use aura_drivers::driver::{AgentDriver, DriverContext, DriverError, DriverExit, DriverFactory};
use aura_process::{
    EnvResolver, EnvResolverConfig, LeftoverRegistry, LogFactory, ProcessSpawner, Redactor,
    RetentionPolicy, Spawner, SweepReport, sweep_stale,
};
use aura_protocol::session::{ChatStatusUpdate, PauseReason, StorageState, StorageStatus};
use aura_protocol::{DriverKind, ErrorKind, EventBatch};
use tauri::ipc::Channel;
use tauri::webview::PageLoadEvent;
use tokio::runtime::Handle;

use crate::boot::Booted;
use crate::error::{AppError, AppErrorCode};
use crate::sync::lock;

// ---------- Channels and pages ----------

/// Each webview's current page. A page that starts loading gets a new generation, and every
/// [`PageToken`] taken for the page before goes stale.
#[derive(Debug, Default)]
pub struct Pages {
    generations: Mutex<HashMap<String, Arc<AtomicU64>>>,
}

impl Pages {
    fn counter(&self, label: &str) -> Arc<AtomicU64> {
        Arc::clone(lock(&self.generations).entry(label.to_owned()).or_default())
    }

    /// The page `label` shows now, for a sink made now.
    pub fn current(&self, label: &str) -> PageToken {
        let counter = self.counter(label);
        let generation = counter.load(Ordering::Acquire);
        PageToken {
            counter,
            generation,
        }
    }

    /// A new page started loading in `label`.
    pub fn page_started(&self, label: &str) {
        self.counter(label).fetch_add(1, Ordering::AcqRel);
    }
}

/// The page a sink was made for.
#[derive(Debug, Clone)]
pub struct PageToken {
    counter: Arc<AtomicU64>,
    generation: u64,
}

impl PageToken {
    /// Whether that page is still the one its webview shows.
    pub fn is_current(&self) -> bool {
        self.counter.load(Ordering::Acquire) == self.generation
    }
}

/// What a page load does: one that starts has new channel callbacks, so the webview's old
/// subscriptions are dropped (`drop_owner`, the manager's) and their sinks fail from now on. A
/// finished load changes nothing. Returns whether the subscriptions were dropped.
pub fn page_load(
    pages: &Pages,
    label: &str,
    event: PageLoadEvent,
    drop_owner: impl FnOnce(&str),
) -> bool {
    match event {
        PageLoadEvent::Started => {
            pages.page_started(label);
            drop_owner(label);
            true
        }
        PageLoadEvent::Finished => false,
    }
}

/// One open chat view's frames: the view's channel, the webview it belongs to, and the page that
/// asked for it.
pub struct ChannelSink {
    channel: Channel<EventBatch>,
    owner: String,
    page: PageToken,
}

impl ChannelSink {
    pub fn new(channel: Channel<EventBatch>, owner: impl Into<String>, page: PageToken) -> Self {
        ChannelSink {
            channel,
            owner: owner.into(),
            page,
        }
    }
}

impl FrameSink for ChannelSink {
    fn send(&self, frame: &EventBatch) -> Result<(), SinkGone> {
        if !self.page.is_current() {
            return Err(SinkGone);
        }
        self.channel.send(frame.clone()).map_err(|error| {
            tracing::debug!(%error, owner = %self.owner, chat = %frame.chat_id, "a chat view's channel failed; removing it");
            SinkGone
        })
    }

    fn owner(&self) -> &str {
        &self.owner
    }
}

/// One webview's chat-list updates.
pub struct StatusChannelSink {
    channel: Channel<ChatStatusUpdate>,
    owner: String,
    page: PageToken,
}

impl StatusChannelSink {
    pub fn new(
        channel: Channel<ChatStatusUpdate>,
        owner: impl Into<String>,
        page: PageToken,
    ) -> Self {
        StatusChannelSink {
            channel,
            owner: owner.into(),
            page,
        }
    }
}

impl StatusSink for StatusChannelSink {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone> {
        if !self.page.is_current() {
            return Err(SinkGone);
        }
        self.channel.send(update.clone()).map_err(|error| {
            tracing::debug!(%error, owner = %self.owner, "a status channel failed; removing it");
            SinkGone
        })
    }

    fn owner(&self) -> &str {
        &self.owner
    }
}

// ---------- Startup ----------

/// What startup built for chats: the chat store, the session manager on top of it, and what
/// quitting needs.
pub struct ChatRuntime {
    pub store: Arc<ChatStore>,
    pub manager: SessionManager,
    pub registry: Arc<LeftoverRegistry>,
    /// Sentences that arrive after startup (the sweep's), shown with `app_info`'s notices.
    pub late_notices: Arc<Mutex<Vec<String>>>,
}

impl std::fmt::Debug for ChatRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatRuntime")
            .field("manager", &self.manager)
            .finish_non_exhaustive()
    }
}

/// The parts of the chat runtime that reach outside auracode: the login shell, agent probes and
/// adapter installs, real processes, agent drivers. Tests pass their own.
pub struct Outside {
    pub env: Arc<EnvResolver>,
    pub detector: Arc<Detector>,
    pub spawner: Arc<dyn ProcessSpawner>,
    pub drivers: Arc<dyn DriverFactory>,
}

impl Outside {
    /// The real ones: the user's login shell (its secret literals go to `redactor`), the catalog's
    /// agents with their adapters in `<data root>/adapters`, and processes registered in `registry`.
    pub fn real(
        registry: &Arc<LeftoverRegistry>,
        redactor: &Arc<Redactor>,
        data_dir: &Path,
        rt: &Handle,
    ) -> Outside {
        let env = EnvResolver::start(
            EnvResolverConfig {
                redactor: Some(Arc::clone(redactor)),
                ..EnvResolverConfig::standard()
            },
            Arc::clone(registry),
            rt.clone(),
        );
        let detector = Detector::new(
            Arc::clone(&env),
            Arc::clone(registry),
            data_dir.join(ADAPTERS_DIR),
            rt.clone(),
        );
        Outside {
            env,
            detector,
            spawner: Spawner::new(Arc::clone(registry), rt.clone()),
            drivers: Arc::new(UnbuiltDrivers),
        }
    }
}

/// `<data root>/run`: one leftover registry file per running auracode process.
pub const RUN_DIR: &str = "run";

/// `<data root>/adapters`: the npm adapters, one folder per package version.
pub const ADAPTERS_DIR: &str = "adapters";

/// Starts the chat store and the session manager on what [`crate::boot::boot`] opened: the store
/// and the profile's owner lock move into the chat store's writer thread. `None` when startup did
/// not get that far (its error screen shows instead), and when the chat store cannot start, which
/// then becomes startup's fatal error. Every constructor that spawns gets `rt`, since Tauri's
/// `setup` hook runs outside any Tokio context.
pub fn start_chats(
    booted: &mut Booted,
    app_version: &str,
    rt: &Handle,
    outside: impl FnOnce(&Arc<LeftoverRegistry>, &Arc<Redactor>, &Path, &Handle) -> Outside,
) -> Option<ChatRuntime> {
    if booted.fatal.is_some() {
        return None;
    }
    let (Some(data_dir), Some(meta), Some(dir), Some(device)) = (
        booted.data_dir.clone(),
        booted.profile.clone(),
        booted.profile_dir.clone(),
        booted.device.clone(),
    ) else {
        return None;
    };
    let (Some(store), Some(owner)) = (booted.store.take(), booted.owner.take()) else {
        return None;
    };
    let profile = Profile { meta, dir };
    let store = match ChatStore::start(store, owner, &profile, device.device_id.clone(), rt.clone())
    {
        Ok(store) => store,
        Err(error) => {
            tracing::error!(%error, "the chat store could not start");
            booted.fatal = Some(error.to_string());
            return None;
        }
    };

    let run_dir = data_dir.join(RUN_DIR);
    let registry = match LeftoverRegistry::open(&run_dir, rt.clone()) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(%error, path = %run_dir.display(), "the leftover registry is unavailable; agents run without it");
            LeftoverRegistry::disabled()
        }
    };
    let late_notices = Arc::new(Mutex::new(Vec::new()));
    let own = registry.own().clone();
    let notices = Arc::clone(&late_notices);
    rt.spawn(async move {
        let report = sweep_stale(&run_dir, &own).await;
        log_sweep(&report);
        if let Some(notice) = sweep_notice(&report) {
            lock(&notices).push(notice);
        }
    });

    let redactor = Arc::new(Redactor::standard());
    let Outside {
        env,
        detector,
        spawner,
        drivers,
    } = outside(&registry, &redactor, &data_dir, rt);
    let logs = LogFactory::new(
        profile.logs_dir().join("protocol"),
        Arc::clone(&redactor),
        rt.clone(),
    );
    let pruning = logs.clone();
    rt.spawn(async move {
        let report = pruning.prune(RetentionPolicy::STANDARD).await;
        if report.files_removed > 0 || !report.errors.is_empty() {
            tracing::info!(
                files = report.files_removed,
                bytes = report.bytes_removed,
                errors = report.errors.len(),
                "pruned old protocol logs"
            );
        }
    });
    let manager = SessionManager::new(ManagerDeps {
        store: Arc::clone(&store),
        env,
        spawner,
        detector,
        drivers,
        logs,
        redactor,
        device_id: device.device_id,
        app_version: app_version.to_owned(),
        limits: ManagerLimits::STANDARD,
        timings: SessionTimings::STANDARD,
        rt: rt.clone(),
    });
    Some(ChatRuntime {
        store,
        manager,
        registry,
        late_notices,
    })
}

fn log_sweep(report: &SweepReport) {
    if report.files_removed == 0 && report.killed.is_empty() && report.errors.is_empty() {
        return;
    }
    tracing::info!(
        files = report.files_removed,
        killed = report.killed.len(),
        live_owners = report.skipped_live_owner,
        reused = report.skipped_reused,
        errors = report.errors.len(),
        "swept what earlier sessions left running"
    );
}

/// The startup notice when the sweep stopped processes a crashed session left running.
pub fn sweep_notice(report: &SweepReport) -> Option<String> {
    match report.killed.len() {
        0 => None,
        1 => Some(
            "auracode stopped 1 agent process left running by an earlier session that ended unexpectedly."
                .into(),
        ),
        n => Some(format!(
            "auracode stopped {n} agent processes left running by an earlier session that ended unexpectedly."
        )),
    }
}

/// The driver factory the app starts agents with until package B's `StandardDriverFactory` (the
/// ACP driver and the demo agent's driver) lands at the merge. Every start fails with a sentence
/// that says why, as an error card in the chat.
struct UnbuiltDrivers;

impl DriverFactory for UnbuiltDrivers {
    fn create(&self, _kind: DriverKind) -> Box<dyn AgentDriver> {
        Box::new(UnbuiltDriver)
    }
}

struct UnbuiltDriver;

impl AgentDriver for UnbuiltDriver {
    fn run(
        self: Box<Self>,
        _ctx: DriverContext,
    ) -> Pin<Box<dyn Future<Output = DriverExit> + Send + 'static>> {
        Box::pin(async {
            DriverExit::StartFailed(DriverError {
                kind: ErrorKind::Internal,
                message: "This build of auracode can't start agents yet: its agent drivers aren't built in."
                    .into(),
                detail: None,
            })
        })
    }
}

// ---------- Quit ----------

/// `shutdown_all`'s deadline when quitting.
pub const QUIT_SESSIONS_DEADLINE: Duration = Duration::from_secs(8);
/// The chat store's deadline when quitting, after the sessions.
pub const QUIT_STORE_DEADLINE: Duration = Duration::from_secs(5);
/// How much longer than a step's own deadline the quit flow waits for it. The sessions and the
/// store keep their deadlines themselves; this bounds one that does not, since the window is
/// hidden and every other exit request waits for the flow.
pub const QUIT_STEP_MARGIN: Duration = Duration::from_secs(1);
/// The chat store's deadline at `RunEvent::Exit` when the quit flow did not close it.
pub const EXIT_STORE_DEADLINE: Duration = Duration::from_secs(1);

/// Where quitting stands, shared by the run-event callback, the quit task and the signal task.
#[derive(Debug, Default)]
pub struct Quit {
    phase: Mutex<QuitPhase>,
    store_closed: AtomicBool,
    /// Signals since auracode last kept running: the second one exits at once.
    signals: AtomicU32,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum QuitPhase {
    #[default]
    Running,
    Quitting,
    Done,
}

/// What to do with an exit request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitRequest {
    /// The quit flow finished: let the app exit.
    Allow,
    /// The first request: prevent it and run the quit flow.
    StartQuit,
    /// A quit flow already runs: prevent this one too; the flow exits when it is done.
    Wait,
}

impl Quit {
    /// Decides on one `RunEvent::ExitRequested`, whatever its code or cause.
    pub fn on_exit_requested(&self) -> ExitRequest {
        let mut phase = lock(&self.phase);
        match *phase {
            QuitPhase::Running => {
                *phase = QuitPhase::Quitting;
                ExitRequest::StartQuit
            }
            QuitPhase::Quitting => ExitRequest::Wait,
            QuitPhase::Done => ExitRequest::Allow,
        }
    }

    /// Whether the quit flow finished (the app is exiting).
    pub fn is_done(&self) -> bool {
        *lock(&self.phase) == QuitPhase::Done
    }

    /// Whether a quit flow runs or finished.
    pub fn is_quitting(&self) -> bool {
        *lock(&self.phase) != QuitPhase::Running
    }

    /// Whether the quit flow closed the chat store (`RunEvent::Exit` then leaves it alone).
    pub fn store_closed(&self) -> bool {
        self.store_closed.load(Ordering::Acquire)
    }

    /// Counts a signal; returns how many arrived since auracode last kept running, this one
    /// included.
    pub fn count_signal(&self) -> u32 {
        self.signals
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    /// The quit flow died before it finished: the next exit request passes, and `RunEvent::Exit`
    /// kills and closes whatever is left.
    pub fn abandon(&self) {
        self.finish();
    }

    /// The user kept auracode open: the flow is over, so a later signal starts a new one instead
    /// of counting as the second signal of this one.
    fn keep_running(&self) {
        *lock(&self.phase) = QuitPhase::Running;
        self.signals.store(0, Ordering::Release);
    }

    fn finish(&self) {
        *lock(&self.phase) = QuitPhase::Done;
    }

    fn mark_store_closed(&self) {
        self.store_closed.store(true, Ordering::Release);
    }
}

/// What the quit flow acts on: the window, the dialog, the sessions, the store, the registry and
/// the app. The app's host is [`AppQuitHost`]; tests record calls.
pub trait QuitHost: Send + Sync {
    fn hide_window(&self);
    fn show_window(&self);
    fn storage(&self) -> StorageStatus;
    /// Asks whether to quit although saving is paused; `true` quits.
    fn ask_to_quit_unsaved(&self, question: QuitQuestion) -> impl Future<Output = bool> + Send;
    fn stop_sessions(&self, deadline: Duration) -> impl Future<Output = ShutdownSummary> + Send;
    /// Commits what is queued and closes the store; `false` when not everything was saved.
    fn close_store(&self, deadline: Duration) -> impl Future<Output = bool> + Send;
    fn close_registry(&self);
    fn exit(&self, code: i32);
}

/// The question before quitting while saving is paused with unsaved data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuitQuestion {
    pub message: String,
    pub quit: String,
    pub keep: String,
}

/// The question to ask before quitting with `storage`, if any: only a paused store with unsaved
/// data loses something when auracode quits.
pub fn quit_question(storage: &StorageStatus) -> Option<QuitQuestion> {
    let StorageState::Paused { reason, .. } = &storage.state else {
        return None;
    };
    if storage.unsaved_bytes == 0 {
        return None;
    }
    let message = match reason {
        PauseReason::DiskFull => {
            "auracode can't save its latest messages because the disk is full. If you quit now, they are lost."
        }
        PauseReason::Busy => {
            "auracode can't save its latest messages because its database is busy. If you quit now, they are lost."
        }
    };
    Some(QuitQuestion {
        message: message.into(),
        quit: "Quit anyway".into(),
        keep: "Keep auracode open".into(),
    })
}

/// How a quit flow ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuitOutcome {
    /// The user kept auracode open; the window is back and the next exit request starts over.
    Kept,
    /// Everything stopped and the app was asked to exit with the request's code.
    Exited {
        /// `None` when the sessions did not stop within their deadline plus the margin.
        summary: Option<ShutdownSummary>,
        /// Whether the store saved everything before closing.
        saved: bool,
    },
}

/// The quit flow, after the first exit request was prevented: hide the window; when saving is
/// paused with unsaved data, ask first (keeping auracode open shows the window again and ends the
/// quit); then stop every session within 8 s, commit and close the store within 5 s, delete the
/// registry file, and exit with `code`. The next exit request passes ([`Quit::on_exit_requested`]).
///
/// The window is hidden and every other exit request waits for this flow, so a step that overruns
/// its deadline by [`QUIT_STEP_MARGIN`] is left behind and the flow carries on: `RunEvent::Exit`
/// then kills whatever runs, and closes the store if it did not close here.
pub async fn run_quit(quit: &Quit, host: &impl QuitHost, code: i32) -> QuitOutcome {
    host.hide_window();
    if let Some(question) = quit_question(&host.storage())
        && !host.ask_to_quit_unsaved(question).await
    {
        host.show_window();
        quit.keep_running();
        tracing::info!("kept auracode open: saving is paused");
        return QuitOutcome::Kept;
    }
    let summary = tokio::time::timeout(
        QUIT_SESSIONS_DEADLINE + QUIT_STEP_MARGIN,
        host.stop_sessions(QUIT_SESSIONS_DEADLINE),
    )
    .await
    .inspect_err(|_| {
        tracing::warn!("the sessions did not stop within their deadline; quitting anyway")
    })
    .ok();
    let saved = match tokio::time::timeout(
        QUIT_STORE_DEADLINE + QUIT_STEP_MARGIN,
        host.close_store(QUIT_STORE_DEADLINE),
    )
    .await
    {
        Ok(saved) => {
            quit.mark_store_closed();
            saved
        }
        Err(_) => {
            tracing::warn!(
                "the chat store did not close within its deadline; it gets one more second at exit"
            );
            false
        }
    };
    host.close_registry();
    match summary {
        Some(summary) => tracing::info!(
            sessions = summary.sessions,
            graceful = summary.graceful,
            forced = summary.forced,
            took_ms = u64::try_from(summary.took.as_millis()).unwrap_or(u64::MAX),
            saved,
            code,
            "quitting"
        ),
        None => tracing::info!(saved, code, "quitting"),
    }
    quit.finish();
    host.exit(code);
    QuitOutcome::Exited { summary, saved }
}

/// The app's quit host: the main window, tauri-plugin-dialog for the question, and the chat runtime.
pub struct AppQuitHost<'a> {
    pub app: &'a tauri::AppHandle,
    pub chats: &'a ChatRuntime,
}

impl QuitHost for AppQuitHost<'_> {
    fn hide_window(&self) {
        use tauri::Manager as _;
        if let Some(window) = self.app.get_webview_window(crate::window::MAIN_WINDOW)
            && let Err(error) = window.hide()
        {
            tracing::warn!(%error, "could not hide the window while quitting");
        }
    }

    fn show_window(&self) {
        if let Err(error) = crate::window::show_and_focus(self.app) {
            tracing::warn!(%error, "could not show the window again");
        }
    }

    fn storage(&self) -> StorageStatus {
        self.chats.manager.storage_status()
    }

    async fn ask_to_quit_unsaved(&self, question: QuitQuestion) -> bool {
        use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons, MessageDialogKind};
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.app
            .dialog()
            .message(question.message)
            .title("auracode")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                question.quit,
                question.keep,
            ))
            .show(move |quit| {
                // Nobody waits any more only when the quit task itself is gone.
                let _ = tx.send(quit);
            });
        match rx.await {
            Ok(quit) => quit,
            Err(_) => {
                // The dialog never answered: keeping auracode open loses nothing.
                tracing::warn!("the quit question was not answered; keeping auracode open");
                false
            }
        }
    }

    async fn stop_sessions(&self, deadline: Duration) -> ShutdownSummary {
        self.chats.manager.shutdown_all(deadline).await
    }

    async fn close_store(&self, deadline: Duration) -> bool {
        self.chats.store.shutdown(deadline).await
    }

    fn close_registry(&self) {
        if let Err(error) = self.chats.registry.close() {
            tracing::warn!(%error, "could not remove this instance's leftover registry file");
        }
    }

    fn exit(&self, code: i32) {
        self.app.exit(code);
    }
}

/// `RunEvent::Exit`, the synchronous last resort: Tauri runs it on the main thread outside any
/// Tokio context, after the quit flow or instead of it (macOS can end the app without an exit
/// request). Every recorded agent process is killed at once, and the store closes within 1 s
/// unless the quit flow closed it. Returns whether this closed the store.
pub fn exit_last_resort(quit: &Quit, chats: &ChatRuntime) -> bool {
    chats.manager.kill_all_now();
    if quit.store_closed() {
        return false;
    }
    if !chats.store.shutdown_blocking(EXIT_STORE_DEADLINE) {
        tracing::warn!("the chat store could not save everything before auracode exited");
    }
    quit.mark_store_closed();
    true
}

// ---------- Signals ----------

/// What a signal acts on. The app's host is [`AppSignals`]; tests record calls.
pub trait SignalHost: Send + Sync + 'static {
    /// The first signal: the quit flow, through an exit request (`app.exit(0)`).
    fn request_exit(&self);
    /// A later one: kill every agent now...
    fn kill_now(&self);
    /// ...close the store within 1 s...
    fn close_store_now(&self);
    /// ...and end the process with `code`.
    fn exit_now(&self, code: i32);
}

/// What one signal does: the first starts the quit flow, any later one (the flow is running) kills
/// every agent, closes the store within 1 s and exits with 128 plus the signal's number. Keeping
/// auracode open at the flow's question starts the count over. Returns the exit code of a hard
/// exit.
pub fn on_signal(quit: &Quit, host: &impl SignalHost, number: i32) -> Option<i32> {
    if quit.count_signal() == 1 {
        tracing::info!(signal = number, "quitting on a signal");
        host.request_exit();
        return None;
    }
    let code = 128 + number;
    tracing::warn!(
        signal = number,
        code,
        "another signal while quitting; exiting at once"
    );
    host.kill_now();
    host.close_store_now();
    host.exit_now(code);
    Some(code)
}

/// SIGHUP, SIGINT and SIGTERM: the same numbers on every Unix.
#[cfg(unix)]
pub const SIGHUP: i32 = 1;
#[cfg(unix)]
pub const SIGINT: i32 = 2;
#[cfg(unix)]
pub const SIGTERM: i32 = 15;

/// SIGTERM, SIGINT and SIGHUP, listened for from creation on: a Ctrl+C under `pnpm dev` or a
/// logout runs the quit flow.
#[cfg(unix)]
pub struct SignalListener {
    term: tokio::signal::unix::Signal,
    int: tokio::signal::unix::Signal,
    hup: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl SignalListener {
    /// Installs the handlers; needs a Tokio context (call it inside `rt.spawn` or `rt.enter`).
    pub fn new() -> std::io::Result<SignalListener> {
        use tokio::signal::unix::{SignalKind, signal};
        Ok(SignalListener {
            term: signal(SignalKind::terminate())?,
            int: signal(SignalKind::interrupt())?,
            hup: signal(SignalKind::hangup())?,
        })
    }

    /// Handles signals until a hard exit (which a real host never returns from).
    pub async fn run(mut self, quit: Arc<Quit>, host: impl SignalHost) {
        loop {
            let number = tokio::select! {
                Some(()) = self.term.recv() => SIGTERM,
                Some(()) = self.int.recv() => SIGINT,
                Some(()) = self.hup.recv() => SIGHUP,
                else => return,
            };
            if on_signal(&quit, &host, number).is_some() {
                return;
            }
        }
    }
}

/// The app's signal host.
pub struct AppSignals {
    pub app: tauri::AppHandle,
}

impl SignalHost for AppSignals {
    fn request_exit(&self) {
        self.app.exit(0);
    }

    fn kill_now(&self) {
        use tauri::Manager as _;
        if let Some(state) = self.app.try_state::<crate::state::AppState>()
            && let Some(chats) = state.chats()
        {
            chats.manager.kill_all_now();
        }
    }

    fn close_store_now(&self) {
        use tauri::Manager as _;
        if let Some(state) = self.app.try_state::<crate::state::AppState>()
            && let Some(chats) = state.chats()
            && !state.quit.store_closed()
            && !chats.store.shutdown_blocking(EXIT_STORE_DEADLINE)
        {
            tracing::warn!("the chat store could not save everything before auracode exited");
        }
    }

    fn exit_now(&self, code: i32) {
        std::process::exit(code);
    }
}

// ---------- Folder picker and protocol logs ----------

/// The folder picker's answer as `pick_folder` returns it: `None` when the user cancelled. A chat
/// folder must be valid Unicode (the agent gets it as a JSON string), so a name that is not reads
/// as a failure that says why rather than a mangled path.
pub fn picked_folder(
    picked: Option<tauri_plugin_dialog::FilePath>,
) -> Result<Option<String>, AppError> {
    let Some(picked) = picked else {
        return Ok(None);
    };
    // `simplified` drops a Windows `\\?\` prefix, which Node agents mishandle in a `cwd`.
    let path = picked.simplified().into_path().map_err(|error| {
        AppError::new(
            AppErrorCode::DialogFailed,
            format!("The folder picker returned something that isn't a folder: {error}"),
        )
    })?;
    path.into_os_string()
        .into_string()
        .map(Some)
        .map_err(|path| {
            AppError::new(
                AppErrorCode::DialogFailed,
                format!(
                    "{} can't be used: its name isn't valid Unicode.",
                    PathBuf::from(path).display()
                ),
            )
        })
}

/// The newest protocol log in a chat's log folder: logs are named `<spawn id>.jsonl` with UUIDv7
/// spawn ids, so the greatest name is the newest spawn; rotated files (`<spawn id>.1.jsonl`) are
/// older parts of a log. `None` when the folder holds none.
pub fn newest_log(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stem = name.strip_suffix(".jsonl")?;
            let current = !stem.is_empty() && !stem.contains('.');
            (current && entry.file_type().ok()?.is_file()).then_some(name)
        })
        .max()
        .map(|name| dir.join(name))
}

/// Reveals the newest protocol log in `dir` with `reveal` (the opener plugin's `reveal_item_in_dir`
/// in the app) and returns its path. Generic over `reveal` so tests can check what would be shown
/// without opening a file manager window.
pub fn reveal_newest_log<E: std::fmt::Display>(
    dir: &Path,
    reveal: impl FnOnce(&Path) -> Result<(), E>,
) -> Result<PathBuf, AppError> {
    let path = newest_log(dir).ok_or_else(|| {
        AppError::new(
            AppErrorCode::RevealFailed,
            "This chat has no protocol log yet: one is written once its agent starts.",
        )
    })?;
    reveal(&path).map_err(|error| {
        AppError::new(
            AppErrorCode::RevealFailed,
            format!(
                "Could not show {} in the file manager: {error}",
                path.display()
            ),
        )
    })?;
    Ok(path)
}

/// A chat id names one folder under the protocol log root and nothing else: a single normal path
/// component without separators. The page passes chat ids, so one like `../..` must never reach a
/// path join.
pub fn is_plain_id(id: &str) -> bool {
    let mut components = Path::new(id).components();
    !id.contains(['/', '\\'])
        && matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use aura_agents::FixedAgent;
    use aura_drivers::testing::ScriptedDriverFactory;
    use aura_process::testing::FakeSpawner;
    use aura_process::{EnvMap, EnvSource, ResolvedEnv};
    use aura_protocol::session::Availability;

    /// Nothing that reaches outside: a fixed env, the demo agent through a fixed detector, fake
    /// processes, no drivers.
    pub fn outside(
        _registry: &Arc<LeftoverRegistry>,
        _redactor: &Arc<Redactor>,
        _data_dir: &Path,
        _rt: &Handle,
    ) -> Outside {
        let mut vars = EnvMap::new();
        vars.insert("PATH".into(), "/usr/bin:/bin".into());
        let env = EnvResolver::fixed(ResolvedEnv {
            vars,
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        });
        let mock = aura_agents::get("mock").expect("the demo agent").clone();
        let detector = Detector::fixed(vec![FixedAgent::new(
            mock,
            Availability::Ready {
                version: None,
                path: "builtin".into(),
            },
            None,
        )]);
        let (spawner, _ends) = FakeSpawner::new();
        Outside {
            env,
            detector,
            spawner,
            drivers: ScriptedDriverFactory::new(Vec::new()),
        }
    }

    /// [`start_chats`] on the current runtime with [`outside`].
    pub fn start(booted: &mut Booted) -> Option<ChatRuntime> {
        start_chats(booted, "0.1.0", &Handle::current(), outside)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use aura_core::paths::DataRoot;
    use aura_core::store::OpenOutcome;
    use tauri::ipc::InvokeResponseBody;

    use super::*;
    use crate::boot::{boot, boot_next};

    fn frame(chat: &str, seq: u32) -> EventBatch {
        EventBatch {
            chat_id: chat.into(),
            seq_start: seq,
            events: vec![aura_protocol::AuraEvent::Notice {
                level: aura_protocol::NoticeLevel::Info,
                message: format!("frame {seq}"),
            }],
        }
    }

    /// A channel whose messages land in `seen`, failing every send once `fail` is set.
    fn recording<T>(seen: &Arc<Mutex<Vec<String>>>, fail: &Arc<AtomicBool>) -> Channel<T> {
        let seen = Arc::clone(seen);
        let fail = Arc::clone(fail);
        Channel::new(move |body| {
            if fail.load(Ordering::Acquire) {
                return Err(tauri::Error::Io(std::io::Error::other(
                    "the webview is gone",
                )));
            }
            match body {
                InvokeResponseBody::Json(json) => lock(&seen).push(json),
                InvokeResponseBody::Raw(bytes) => {
                    lock(&seen).push(format!("{} bytes", bytes.len()))
                }
            }
            Ok(())
        })
    }

    #[test]
    fn a_channel_sink_sends_frames_as_json_and_names_its_webview() {
        let pages = Pages::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let fail = Arc::new(AtomicBool::new(false));
        let sink = ChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        assert_eq!(sink.owner(), "main");
        sink.send(&frame("c1", 7)).expect("sent");
        let sent = lock(&seen).clone();
        assert_eq!(sent.len(), 1);
        let value: serde_json::Value = serde_json::from_str(&sent[0]).expect("JSON");
        assert_eq!(value["chat_id"], "c1");
        assert_eq!(value["seq_start"], 7);
        assert_eq!(value["events"][0]["type"], "notice");
    }

    /// A failed send answers `SinkGone`, which is how the manager removes a subscriber.
    #[test]
    fn a_channel_sink_removes_itself_on_a_send_error() {
        let pages = Pages::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let fail = Arc::new(AtomicBool::new(false));
        let sink = ChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        fail.store(true, Ordering::Release);
        assert_eq!(sink.send(&frame("c1", 0)), Err(SinkGone));

        let status = StatusChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        let update = ChatStatusUpdate {
            chat_id: "c1".into(),
            status: aura_protocol::SessionStatus::Ready,
            needs_attention: false,
            title: None,
            updated_at: 1,
        };
        assert_eq!(status.send(&update), Err(SinkGone));
        fail.store(false, Ordering::Release);
        status.send(&update).expect("sent once the channel works");
        assert!(lock(&seen)[0].contains("\"status\":\"ready\""));
    }

    /// Detaching drops the manager's clone of the sink, the last one: Tauri then ends the
    /// JavaScript channel.
    #[test]
    fn dropping_the_sink_drops_its_channel() {
        struct Counted(Arc<AtomicUsize>);
        impl Drop for Counted {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::AcqRel);
            }
        }
        let dropped = Arc::new(AtomicUsize::new(0));
        let guard = Counted(Arc::clone(&dropped));
        let channel = Channel::<EventBatch>::new(move |_| {
            let _keep = &guard;
            Ok(())
        });
        let pages = Pages::default();
        let sink: Arc<dyn FrameSink> =
            Arc::new(ChannelSink::new(channel, "main", pages.current("main")));
        let manager_clone = Arc::clone(&sink);
        drop(sink);
        assert_eq!(
            dropped.load(Ordering::Acquire),
            0,
            "the manager still holds it"
        );
        drop(manager_clone);
        assert_eq!(dropped.load(Ordering::Acquire), 1);
    }

    #[test]
    fn page_load_drops_subscriptions() {
        let pages = Pages::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let fail = Arc::new(AtomicBool::new(false));
        let old_view = ChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        let old_status =
            StatusChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        let other_window =
            ChannelSink::new(recording(&seen, &fail), "other", pages.current("other"));
        old_view.send(&frame("c1", 0)).expect("the page is current");

        let mut dropped = Vec::new();
        assert!(!page_load(
            &pages,
            "main",
            PageLoadEvent::Finished,
            |owner| { dropped.push(owner.to_owned()) }
        ));
        assert!(dropped.is_empty(), "a finished load changes nothing");
        old_view.send(&frame("c1", 1)).expect("still current");

        assert!(page_load(&pages, "main", PageLoadEvent::Started, |owner| {
            dropped.push(owner.to_owned())
        }));
        assert_eq!(
            dropped,
            ["main"],
            "the manager drops the webview's subscriptions"
        );
        // Every sink of the old page fails from now on, so one the manager registered while the
        // reload started is removed at its first frame instead of lingering.
        assert_eq!(old_view.send(&frame("c1", 2)), Err(SinkGone));
        let update = ChatStatusUpdate {
            chat_id: "c1".into(),
            status: aura_protocol::SessionStatus::Stopped,
            needs_attention: false,
            title: None,
            updated_at: 0,
        };
        assert_eq!(old_status.send(&update), Err(SinkGone));
        other_window
            .send(&frame("c2", 0))
            .expect("another webview keeps its subscriptions");
        let new_view = ChannelSink::new(recording(&seen, &fail), "main", pages.current("main"));
        new_view
            .send(&frame("c1", 3))
            .expect("the new page's views work");
        assert_eq!(lock(&seen).len(), 4);
    }

    #[test]
    fn the_sweep_notice_counts_what_it_stopped() {
        let mut report = SweepReport::default();
        assert_eq!(sweep_notice(&report), None);
        report.killed.push((5001, "hermes acp".into()));
        assert_eq!(
            sweep_notice(&report).as_deref(),
            Some(
                "auracode stopped 1 agent process left running by an earlier session that ended unexpectedly."
            )
        );
        report.killed.push((5002, "claude-agent-acp".into()));
        assert_eq!(
            sweep_notice(&report).as_deref(),
            Some(
                "auracode stopped 2 agent processes left running by an earlier session that ended unexpectedly."
            )
        );
    }

    #[tokio::test]
    async fn startup_moves_the_store_and_the_owner_lock_into_the_chat_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let mut booted = boot(Ok(root.clone()));
        let chats = testing::start(&mut booted).expect("chats start");
        assert!(
            booted.store.is_none() && booted.owner.is_none(),
            "both moved"
        );
        assert_eq!(booted.fatal, None);

        let agents = chats.manager.agents(false).await;
        assert_eq!(agents.len(), 1, "the detector given");
        assert_eq!(chats.manager.storage_status(), StorageStatus::default());
        assert!(
            chats
                .manager
                .protocol_log_dir("c1")
                .ends_with(Path::new("logs").join("protocol").join("c1"))
        );
        let second = boot(Ok(root.clone()));
        assert!(
            second
                .fatal
                .as_deref()
                .is_some_and(|fatal| fatal.starts_with("auracode is already running")),
            "the chat store holds the profile: {:?}",
            second.fatal
        );
        drop(second);

        assert!(chats.store.shutdown(QUIT_STORE_DEADLINE).await);
        drop(chats);
        let third = boot_next(&root);
        assert_eq!(third.fatal, None, "free once the store closed");
        assert_eq!(third.integrity_check, None, "and closed cleanly");
    }

    #[tokio::test]
    async fn a_failed_startup_starts_no_chats() {
        let mut booted = boot(Err(aura_core::CoreError::NoDataDir));
        assert!(testing::start(&mut booted).is_none());
        assert!(booted.fatal.is_some());
    }

    // ---------- the quit flow ----------

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Call {
        Hide,
        Show,
        Ask(String),
        StopSessions(Duration),
        CloseStore(Duration),
        CloseRegistry,
        Exit(i32),
    }

    /// Records every call; the store and the sessions are real when given, and either can be
    /// made to never finish.
    struct FakeHost {
        calls: Mutex<Vec<Call>>,
        storage: StorageStatus,
        quit_anyway: bool,
        chats: Option<ChatRuntime>,
        stuck_sessions: bool,
        stuck_store: bool,
    }

    impl FakeHost {
        fn new(storage: StorageStatus, quit_anyway: bool) -> FakeHost {
            FakeHost {
                calls: Mutex::new(Vec::new()),
                storage,
                quit_anyway,
                chats: None,
                stuck_sessions: false,
                stuck_store: false,
            }
        }

        fn calls(&self) -> Vec<Call> {
            lock(&self.calls).clone()
        }

        fn record(&self, call: Call) {
            lock(&self.calls).push(call);
        }
    }

    impl QuitHost for FakeHost {
        fn hide_window(&self) {
            self.record(Call::Hide);
        }

        fn show_window(&self) {
            self.record(Call::Show);
        }

        fn storage(&self) -> StorageStatus {
            self.storage.clone()
        }

        async fn ask_to_quit_unsaved(&self, question: QuitQuestion) -> bool {
            self.record(Call::Ask(question.message));
            self.quit_anyway
        }

        async fn stop_sessions(&self, deadline: Duration) -> ShutdownSummary {
            self.record(Call::StopSessions(deadline));
            if self.stuck_sessions {
                return std::future::pending().await;
            }
            match &self.chats {
                Some(chats) => chats.manager.shutdown_all(deadline).await,
                None => ShutdownSummary {
                    sessions: 2,
                    graceful: 1,
                    forced: 1,
                    took: Duration::from_secs(3),
                },
            }
        }

        async fn close_store(&self, deadline: Duration) -> bool {
            self.record(Call::CloseStore(deadline));
            if self.stuck_store {
                return std::future::pending().await;
            }
            match &self.chats {
                Some(chats) => chats.store.shutdown(deadline).await,
                None => true,
            }
        }

        fn close_registry(&self) {
            self.record(Call::CloseRegistry);
            if let Some(chats) = &self.chats {
                chats.registry.close().expect("close the registry");
            }
        }

        fn exit(&self, code: i32) {
            self.record(Call::Exit(code));
        }
    }

    fn paused(reason: PauseReason, unsaved_bytes: u64) -> StorageStatus {
        StorageStatus {
            state: StorageState::Paused { reason, since: 1 },
            unsaved_bytes,
        }
    }

    #[tokio::test]
    async fn quit_flow() {
        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        assert_eq!(
            quit.on_exit_requested(),
            ExitRequest::Wait,
            "a second request while quitting waits for the flow"
        );
        let host = FakeHost::new(StorageStatus::default(), false);
        let outcome = run_quit(&quit, &host, 1).await;
        assert!(matches!(
            outcome,
            QuitOutcome::Exited {
                summary: Some(_),
                saved: true
            }
        ));
        assert_eq!(
            host.calls(),
            [
                Call::Hide,
                Call::StopSessions(Duration::from_secs(8)),
                Call::CloseStore(Duration::from_secs(5)),
                Call::CloseRegistry,
                Call::Exit(1),
            ],
            "no question while saving runs; the exit keeps the code it was asked for (smoke runs)"
        );
        assert!(quit.store_closed() && quit.is_done());
        assert_eq!(
            quit.on_exit_requested(),
            ExitRequest::Allow,
            "the exit the flow asked for passes"
        );
    }

    #[tokio::test]
    async fn quit_asks_when_paused() {
        // Keep auracode open: the window comes back, nothing stops, and quitting starts over.
        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let host = FakeHost::new(paused(PauseReason::DiskFull, 4096), false);
        assert_eq!(run_quit(&quit, &host, 0).await, QuitOutcome::Kept);
        assert_eq!(
            host.calls(),
            [
                Call::Hide,
                Call::Ask(
                    "auracode can't save its latest messages because the disk is full. If you quit now, they are lost."
                        .into()
                ),
                Call::Show,
            ]
        );
        assert!(!quit.store_closed() && !quit.is_quitting());
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);

        // Quit anyway: the same bounded flow.
        let host = FakeHost::new(paused(PauseReason::Busy, 1), true);
        assert!(matches!(
            run_quit(&quit, &host, 0).await,
            QuitOutcome::Exited { .. }
        ));
        let calls = host.calls();
        assert!(
            matches!(&calls[1], Call::Ask(message) if message.contains("database is busy")),
            "{calls:?}"
        );
        assert_eq!(
            calls[2..],
            [
                Call::StopSessions(QUIT_SESSIONS_DEADLINE),
                Call::CloseStore(QUIT_STORE_DEADLINE),
                Call::CloseRegistry,
                Call::Exit(0),
            ]
        );
    }

    /// The window is hidden and every other exit request waits for the flow, so a step that never
    /// finishes is left behind at its deadline plus the margin, and the app still exits; the
    /// store, not closed here, gets its last second at `RunEvent::Exit`.
    #[tokio::test(start_paused = true)]
    async fn quit_carries_on_past_steps_that_never_finish() {
        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let mut host = FakeHost::new(StorageStatus::default(), false);
        host.stuck_sessions = true;
        host.stuck_store = true;
        let started = tokio::time::Instant::now();
        let outcome = run_quit(&quit, &host, 3).await;
        assert_eq!(
            started.elapsed(),
            QUIT_SESSIONS_DEADLINE + QUIT_STORE_DEADLINE + 2 * QUIT_STEP_MARGIN
        );
        assert_eq!(
            outcome,
            QuitOutcome::Exited {
                summary: None,
                saved: false
            }
        );
        assert_eq!(
            host.calls(),
            [
                Call::Hide,
                Call::StopSessions(QUIT_SESSIONS_DEADLINE),
                Call::CloseStore(QUIT_STORE_DEADLINE),
                Call::CloseRegistry,
                Call::Exit(3),
            ]
        );
        assert!(quit.is_done());
        assert!(
            !quit.store_closed(),
            "RunEvent::Exit still closes the store"
        );

        // Sessions that never stop do not keep a store that closes from closing.
        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let mut host = FakeHost::new(StorageStatus::default(), false);
        host.stuck_sessions = true;
        let outcome = run_quit(&quit, &host, 0).await;
        assert_eq!(
            outcome,
            QuitOutcome::Exited {
                summary: None,
                saved: true
            }
        );
        assert!(quit.store_closed());
    }

    #[test]
    fn an_abandoned_flow_lets_the_app_exit() {
        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        quit.abandon();
        assert_eq!(quit.on_exit_requested(), ExitRequest::Allow);
        assert!(
            !quit.store_closed(),
            "RunEvent::Exit still closes the store"
        );
    }

    /// The folder picker and the quit question are called from Rust: the page gets no dialog
    /// permission, so it cannot open file dialogs of its own.
    #[test]
    fn the_page_has_no_dialog_permission() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).expect("JSON");
        for entry in capability["permissions"].as_array().expect("permissions") {
            let id = entry
                .as_str()
                .or_else(|| entry["identifier"].as_str())
                .expect("an identifier");
            assert!(!id.starts_with("dialog:"), "the capability grants {id}");
        }
    }

    #[test]
    fn only_a_paused_store_with_unsaved_data_asks() {
        assert_eq!(quit_question(&StorageStatus::default()), None);
        assert_eq!(quit_question(&paused(PauseReason::DiskFull, 0)), None);
        let failed = StorageStatus {
            state: StorageState::Failed {
                message: "damaged".into(),
            },
            unsaved_bytes: 10,
        };
        assert_eq!(
            quit_question(&failed),
            None,
            "a damaged store writes to its dead-letter file"
        );
        let question = quit_question(&paused(PauseReason::DiskFull, 10)).expect("asks");
        assert_eq!(question.quit, "Quit anyway");
        assert_eq!(question.keep, "Keep auracode open");
    }

    /// Quitting with no live session still commits the store and closes it: the write-ahead log is
    /// folded back, so the next launch sees a clean shutdown and checks nothing.
    #[tokio::test]
    async fn quit_without_sessions_commits_and_closes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let mut booted = boot(Ok(root.clone()));
        let db = PathBuf::from(&booted.db.as_ref().expect("db").path);
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        let chats = testing::start(&mut booted).expect("chats");
        assert!(
            std::fs::metadata(&wal).is_ok_and(|meta| meta.len() > 0),
            "the session wrote to its log"
        );
        assert!(!chats.manager.has_live_sessions());

        let quit = Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let mut host = FakeHost::new(StorageStatus::default(), false);
        host.chats = Some(chats);
        let outcome = run_quit(&quit, &host, 0).await;
        assert!(
            matches!(outcome, QuitOutcome::Exited { saved: true, summary: Some(summary) } if summary.sessions == 0),
            "{outcome:?}"
        );
        assert!(!wal.exists(), "the log was folded back into the database");
        let chats = host.chats.take().expect("chats");
        assert!(
            !exit_last_resort(&quit, &chats),
            "RunEvent::Exit leaves a closed store alone"
        );
        drop(chats);

        let next = boot_next(&root);
        assert_eq!(next.fatal, None);
        assert_eq!(next.db.expect("db").outcome, OpenOutcome::Opened);
        assert_eq!(next.integrity_check, None, "a clean shutdown");
    }

    /// When the app ends without the quit flow (macOS can), `RunEvent::Exit` still kills the agents
    /// and closes the store.
    #[tokio::test]
    async fn exit_without_the_flow_closes_the_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let mut booted = boot(Ok(root.clone()));
        let chats = testing::start(&mut booted).expect("chats");
        let quit = Quit::default();
        assert!(exit_last_resort(&quit, &chats));
        assert!(quit.store_closed());
        assert!(!exit_last_resort(&quit, &chats), "only once");
        drop(chats);
        let next = boot_next(&root);
        assert_eq!(next.integrity_check, None);
    }

    // ---------- signals ----------

    #[derive(Default)]
    struct FakeSignals {
        calls: Mutex<Vec<String>>,
    }

    impl SignalHost for Arc<FakeSignals> {
        fn request_exit(&self) {
            lock(&self.calls).push("request_exit".into());
        }
        fn kill_now(&self) {
            lock(&self.calls).push("kill_now".into());
        }
        fn close_store_now(&self) {
            lock(&self.calls).push("close_store_now".into());
        }
        fn exit_now(&self, code: i32) {
            lock(&self.calls).push(format!("exit_now {code}"));
        }
    }

    #[test]
    fn the_first_signal_quits_and_a_second_exits_at_once() {
        let quit = Quit::default();
        let host = Arc::new(FakeSignals::default());
        assert_eq!(on_signal(&quit, &host, 15), None);
        assert_eq!(*lock(&host.calls), ["request_exit"]);
        assert_eq!(on_signal(&quit, &host, 2), Some(130));
        assert_eq!(
            *lock(&host.calls),
            [
                "request_exit",
                "kill_now",
                "close_store_now",
                "exit_now 130"
            ]
        );
    }

    /// Keeping auracode open at the quit question ends that flow: the next signal, however much
    /// later, starts a new one rather than exiting at once and losing the unsaved data the
    /// question protected. A second signal during the new flow still exits at once.
    #[tokio::test]
    async fn a_signal_after_keeping_auracode_open_quits_again() {
        let quit = Quit::default();
        let host = Arc::new(FakeSignals::default());
        assert_eq!(on_signal(&quit, &host, 15), None);
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let flow = FakeHost::new(paused(PauseReason::DiskFull, 10), false);
        assert_eq!(run_quit(&quit, &flow, 0).await, QuitOutcome::Kept);

        assert_eq!(on_signal(&quit, &host, 2), None, "a new flow");
        assert_eq!(*lock(&host.calls), ["request_exit", "request_exit"]);
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        assert_eq!(on_signal(&quit, &host, 1), Some(129));
        assert_eq!(
            *lock(&host.calls),
            [
                "request_exit",
                "request_exit",
                "kill_now",
                "close_store_now",
                "exit_now 129"
            ]
        );
    }

    /// Marks the re-executed copy of the test binary that receives real signals.
    #[cfg(unix)]
    const SIGNAL_CHILD: &str = "AURACODE_DESKTOP_TEST_SIGNAL_CHILD";

    /// Real signals, in a child copy of the test binary: once the handlers are installed, SIGTERM
    /// asks for the quit flow; after the user keeps auracode open, SIGHUP asks for it again; and
    /// SIGINT during that flow exits with 130 after killing the agents and closing the store. A
    /// child, because a handled SIGINT would stop Ctrl+C from ending the test run itself.
    #[cfg(unix)]
    #[test]
    fn signal_starts_quit_flow() {
        if std::env::var_os(SIGNAL_CHILD).is_none() {
            crate::test_support::run_child("sessions::tests::signal_starts_quit_flow", |child| {
                child.env(SIGNAL_CHILD, "1");
            });
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        rt.block_on(async {
            let quit = Arc::new(Quit::default());
            let host = Arc::new(FakeSignals::default());
            let listener = SignalListener::new().expect("install the handlers");
            let task = tokio::spawn(listener.run(Arc::clone(&quit), Arc::clone(&host)));
            let me = std::process::id().to_string();
            let send = |name: &str| {
                let status = std::process::Command::new("kill")
                    .args(["-s", name, &me])
                    .status()
                    .expect("run kill");
                assert!(status.success(), "kill -s {name}");
            };
            let wait_for = |count: usize| {
                let host = Arc::clone(&host);
                async move {
                    for _ in 0..500 {
                        if lock(&host.calls).len() >= count {
                            return;
                        }
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                    panic!("signal not handled: {:?}", lock(&host.calls));
                }
            };
            send("TERM");
            wait_for(1).await;
            assert_eq!(*lock(&host.calls), ["request_exit"]);
            // The quit question was answered with Keep auracode open.
            quit.keep_running();
            send("HUP");
            wait_for(2).await;
            assert_eq!(*lock(&host.calls), ["request_exit", "request_exit"]);
            send("INT");
            tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .expect("the listener ends after a hard exit")
                .expect("join");
            assert_eq!(
                *lock(&host.calls),
                [
                    "request_exit",
                    "request_exit",
                    "kill_now",
                    "close_store_now",
                    "exit_now 130"
                ]
            );
        });
    }

    // ---------- picker and logs ----------

    #[test]
    fn a_cancelled_picker_returns_nothing_and_a_folder_its_path() {
        assert_eq!(picked_folder(None).expect("cancelled"), None);
        let folder = tauri_plugin_dialog::FilePath::Path(PathBuf::from("/Users/me/code/app"));
        assert_eq!(
            picked_folder(Some(folder)).expect("picked").as_deref(),
            Some("/Users/me/code/app")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_name_that_is_not_unicode_is_refused() {
        use std::os::unix::ffi::OsStringExt as _;
        let name = std::ffi::OsString::from_vec(b"/tmp/caf\xe9".to_vec());
        let error = picked_folder(Some(tauri_plugin_dialog::FilePath::Path(PathBuf::from(
            name,
        ))))
        .expect_err("refused");
        assert_eq!(error.code, AppErrorCode::DialogFailed);
        assert!(
            error.message.ends_with("its name isn't valid Unicode."),
            "{}",
            error.message
        );
    }

    #[test]
    fn the_newest_log_is_the_greatest_current_spawn() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(newest_log(dir.path()), None, "an empty folder");
        assert_eq!(newest_log(&dir.path().join("missing")), None);
        for name in [
            "019a0000-0000-7000-8000-000000000001.jsonl",
            "019a0000-0000-7000-8000-000000000002.jsonl",
            "019a0000-0000-7000-8000-000000000003.1.jsonl",
            "notes.txt",
        ] {
            std::fs::write(dir.path().join(name), b"{}").expect("write");
        }
        std::fs::create_dir(
            dir.path()
                .join("019a0000-0000-7000-8000-000000000009.jsonl"),
        )
        .expect("a folder with a log's name");
        assert_eq!(
            newest_log(dir.path()),
            Some(
                dir.path()
                    .join("019a0000-0000-7000-8000-000000000002.jsonl")
            ),
            "rotated parts, other files and folders are skipped"
        );
    }

    #[test]
    fn show_log_reveals_the_newest_log_or_says_there_is_none() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut shown = Vec::new();
        let error = reveal_newest_log(dir.path(), |path| {
            shown.push(path.to_path_buf());
            Ok::<(), String>(())
        })
        .expect_err("no log yet");
        assert_eq!(error.code, AppErrorCode::RevealFailed);
        assert!(
            error
                .message
                .starts_with("This chat has no protocol log yet")
        );
        assert!(shown.is_empty());

        let log = dir
            .path()
            .join("019a0000-0000-7000-8000-000000000001.jsonl");
        std::fs::write(&log, b"{}").expect("write");
        let revealed = reveal_newest_log(dir.path(), |path| {
            shown.push(path.to_path_buf());
            Ok::<(), String>(())
        })
        .expect("revealed");
        assert_eq!(shown, std::slice::from_ref(&log));
        assert_eq!(revealed, log);

        let error = reveal_newest_log(dir.path(), |_| Err("no file manager is running"))
            .expect_err("failed");
        assert_eq!(error.code, AppErrorCode::RevealFailed);
        assert!(
            error
                .message
                .ends_with("in the file manager: no file manager is running"),
            "{}",
            error.message
        );
    }

    #[test]
    fn only_plain_ids_name_a_log_folder() {
        assert!(is_plain_id("019a0000-0000-7000-8000-000000000001"));
        for id in ["", "..", ".", "../etc", "a/b", "/abs", "a/", "./a"] {
            assert!(!is_plain_id(id), "{id:?}");
        }
    }
}
