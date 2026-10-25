//! The session manager: one actor per chat, the chats' agents, their queues and their storage.
//!
//! Each chat gets an actor on its first call, kept for the app run (a stopped chat's actor is a parked
//! task). The actor owns the chat's state, its frame batcher, its subscribers, its prompt queue, the
//! open turn and the live driver, and never awaits anything inline: every wait is a future it polls
//! beside its mailbox. Drivers spawn through a per-chat spawner that records every process, so force
//! stop and quit reach them even when a driver is wedged. The desktop's commands are thin wrappers
//! over [`SessionManager`].
//!
//! The body is package C's; this build lists agents through the detector, reports the environment
//! and storage status, and answers every chat call with an internal error.

mod actor;
mod live;
mod normalize;
mod policy;
mod spawner;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aura_agents::Detector;
use aura_drivers::driver::DriverFactory;
use aura_process::{
    EnvResolver, EnvSource, LogFactory, ProcessSpawner, Redactor, ResolverStatus, child_env,
};
use aura_protocol::session::{
    AgentEntry, BlobText, ChatAttach, ChatStatusUpdate, ChatSummary, ConfigValue, EnvState,
    EnvStatus, HistoryPage, PromptAck, SessionLists, StorageStatus,
};
use aura_protocol::{Autonomy, EventBatch, UiAnswer};
use tokio::runtime::Handle;

use crate::chatstore::ChatStore;

/// What every chat call answers until package C builds the actors.
const NOT_BUILT: &str = "chat sessions are not implemented in this build";

/// Everything the manager runs on. Every constructor that spawns tasks takes `rt`, because Tauri's
/// `setup` hook and run-event callbacks run outside any Tokio context.
pub struct ManagerDeps {
    pub store: Arc<ChatStore>,
    pub env: Arc<EnvResolver>,
    /// `aura_process::Spawner`, or `FakeSpawner` in tests.
    pub spawner: Arc<dyn ProcessSpawner>,
    pub detector: Arc<Detector>,
    pub drivers: Arc<dyn DriverFactory>,
    pub logs: LogFactory,
    pub redactor: Arc<Redactor>,
    pub device_id: String,
    pub app_version: String,
    pub limits: ManagerLimits,
    pub timings: SessionTimings,
    pub rt: Handle,
}

impl fmt::Debug for ManagerDeps {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ManagerDeps")
            .field("device_id", &self.device_id)
            .field("app_version", &self.app_version)
            .field("limits", &self.limits)
            .field("timings", &self.timings)
            .finish_non_exhaustive()
    }
}

/// How much the manager allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ManagerLimits {
    /// A start beyond this fails; nothing is evicted to make room.
    pub max_live_agents: usize,
    pub max_queue: usize,
    pub max_prompt_bytes: usize,
    /// A `Ready` agent nobody views, with nothing open or queued, stops after this long.
    pub idle_eviction: Duration,
    pub subscribers_per_chat: usize,
    pub subscribers_per_owner: usize,
}

impl ManagerLimits {
    /// 12 live agents, 20 queued prompts, 1 MiB per prompt, 10 minutes idle, 4 views per chat, 16
    /// per webview.
    pub const STANDARD: ManagerLimits = ManagerLimits {
        max_live_agents: 12,
        max_queue: 20,
        max_prompt_bytes: 1024 * 1024,
        idle_eviction: Duration::from_secs(10 * 60),
        subscribers_per_chat: 4,
        subscribers_per_owner: 16,
    };
}

/// The manager's timers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionTimings {
    /// Frames flush this often while a chat has a subscriber...
    pub flush_live: Duration,
    /// ...and this often without one.
    pub flush_idle: Duration,
    /// A force stop waits this long for the turn's own end...
    pub force_cancel_wait: Duration,
    /// ...or this long when the agent's turns outlive its process (Hermes).
    pub daemon_cancel_wait: Duration,
    /// A Stop's cancel grace.
    pub stop_cancel_grace: Duration,
    /// Quitting's cancel grace.
    pub quit_cancel_grace: Duration,
    /// A Stop not done after this long is forced.
    pub stop_kill_after: Duration,
    /// `attach` fails after this long.
    pub attach_timeout: Duration,
}

impl SessionTimings {
    /// 16 ms, 100 ms, 200 ms, 5 s, 3 s, 2 s, 15 s, 5 s.
    pub const STANDARD: SessionTimings = SessionTimings {
        flush_live: Duration::from_millis(16),
        flush_idle: Duration::from_millis(100),
        force_cancel_wait: Duration::from_millis(200),
        daemon_cancel_wait: Duration::from_secs(5),
        stop_cancel_grace: Duration::from_secs(3),
        quit_cancel_grace: Duration::from_secs(2),
        stop_kill_after: Duration::from_secs(15),
        attach_timeout: Duration::from_secs(5),
    };
}

/// Where one open chat view's frames go (a Tauri channel in the app).
pub trait FrameSink: Send + Sync + 'static {
    /// Called on the actor task; must not block. An error removes the subscriber.
    fn send(&self, frame: &EventBatch) -> Result<(), SinkGone>;
    /// The webview label the subscription belongs to.
    fn owner(&self) -> &str;
}

/// Where one webview's chat-list updates go.
pub trait StatusSink: Send + Sync + 'static {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone>;
    fn owner(&self) -> &str;
}

/// The sink's receiver is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SinkGone;

/// The session manager. Cloning shares it.
#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<Inner>,
}

struct Inner {
    deps: ManagerDeps,
}

impl fmt::Debug for SessionManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionManager")
            .field("deps", &self.inner.deps)
            .finish()
    }
}

fn not_built<T>() -> Result<T, SessionError> {
    Err(SessionError::Internal(NOT_BUILT.into()))
}

impl SessionManager {
    pub fn new(deps: ManagerDeps) -> SessionManager {
        SessionManager {
            inner: Arc::new(Inner { deps }),
        }
    }

    fn deps(&self) -> &ManagerDeps {
        &self.inner.deps
    }

    /// Every agent with its availability. `refresh: false` answers at once from the detector's cache
    /// and never waits (`agents_list`): an agent whose first detection has not ended reads
    /// `Checking`. `refresh: true` resolves the env again, probes every agent, and waits for the
    /// results (`agents_refresh`).
    pub async fn agents(&self, refresh: bool) -> Vec<AgentEntry> {
        self.deps().detector.detect_all(refresh).await
    }

    /// The env agents start with: how it was resolved, and the names the scrub removes.
    pub fn env_status(&self) -> EnvStatus {
        let env = &self.deps().env;
        let state = match env.status() {
            ResolverStatus::Resolving => EnvState::Resolving,
            ResolverStatus::Ready {
                source,
                took_ms,
                vars,
            } => EnvState::Ready {
                source: source_label(&source),
                took_ms: u32::try_from(took_ms).unwrap_or(u32::MAX),
                vars: u32::try_from(vars).unwrap_or(u32::MAX),
            },
            ResolverStatus::Fallback { reason } => EnvState::Fallback { reason },
        };
        let removed = env
            .current()
            .map(|resolved| child_env(&resolved, &[]).1.removed)
            .unwrap_or_default();
        EnvStatus { state, removed }
    }

    /// Starts a new resolution and returns the status.
    pub fn env_refresh(&self) -> EnvStatus {
        self.deps().env.refresh();
        self.env_status()
    }

    pub async fn chats(&self) -> Result<Vec<ChatSummary>, SessionError> {
        not_built()
    }

    pub async fn create_chat(
        &self,
        _agent_id: &str,
        _folder: &Path,
    ) -> Result<ChatSummary, SessionError> {
        not_built()
    }

    /// The join protocol: flushes, fixes `next_seq`, reads the newest page behind every earlier
    /// write, and registers `sink` for every frame from `next_seq` on.
    pub async fn attach(
        &self,
        _chat_id: &str,
        _sink: Arc<dyn FrameSink>,
    ) -> Result<ChatAttach, SessionError> {
        not_built()
    }

    pub fn detach(&self, _subscription_id: &str) {}

    /// Drops every subscription of one webview (its page reloaded).
    pub fn drop_owner(&self, _owner: &str) {}

    pub async fn history(
        &self,
        _chat_id: &str,
        _before_seq: u32,
        _max_bytes: Option<u32>,
    ) -> Result<HistoryPage, SessionError> {
        not_built()
    }

    pub async fn lists(&self, _chat_id: &str) -> Result<SessionLists, SessionError> {
        not_built()
    }

    pub async fn send(&self, _chat_id: &str, _text: String) -> Result<PromptAck, SessionError> {
        not_built()
    }

    pub async fn cancel_queued(
        &self,
        _chat_id: &str,
        _prompt_id: &str,
    ) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn resume_queue(&self, _chat_id: &str) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn interrupt(&self, _chat_id: &str) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn force_stop(&self, _chat_id: &str) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn start(&self, _chat_id: &str, _fresh: bool) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn stop(&self, _chat_id: &str) -> Result<(), SessionError> {
        not_built()
    }

    /// `option_id: None` cancels the request.
    pub async fn respond_permission(
        &self,
        _chat_id: &str,
        _request_id: &str,
        _option_id: Option<String>,
    ) -> Result<(), SessionError> {
        not_built()
    }

    /// `answer: None` dismisses the question.
    pub async fn respond_ui(
        &self,
        _chat_id: &str,
        _request_id: &str,
        _answer: Option<UiAnswer>,
    ) -> Result<(), SessionError> {
        not_built()
    }

    pub async fn set_option(
        &self,
        _chat_id: &str,
        _option_id: &str,
        _value: ConfigValue,
    ) -> Result<SessionLists, SessionError> {
        not_built()
    }

    pub async fn set_autonomy(
        &self,
        _chat_id: &str,
        _autonomy: Autonomy,
    ) -> Result<SessionLists, SessionError> {
        not_built()
    }

    pub async fn blob(
        &self,
        _chat_id: &str,
        _sha256: &str,
        _offset: u64,
        _len: u32,
    ) -> Result<BlobText, SessionError> {
        not_built()
    }

    /// The folder of the chat's protocol logs, the one "Show log" reveals.
    pub fn protocol_log_dir(&self, chat_id: &str) -> PathBuf {
        self.deps().logs.chat_dir(chat_id)
    }

    /// Registers the webview's status channel (replacing its earlier one); returns its id.
    pub fn status_subscribe(&self, _sink: Arc<dyn StatusSink>) -> String {
        crate::ids::new_id()
    }

    pub fn storage_status(&self) -> StorageStatus {
        self.deps().store.status().borrow().clone()
    }

    /// Whether any chat has a live agent process.
    pub fn has_live_sessions(&self) -> bool {
        false
    }

    /// Stops every live agent gracefully within `deadline`, then kills what is left.
    pub async fn shutdown_all(&self, _deadline: Duration) -> ShutdownSummary {
        ShutdownSummary {
            sessions: 0,
            graceful: 0,
            forced: 0,
            took: Duration::ZERO,
        }
    }

    /// `kill_tree()` on every recorded process of every chat; synchronous, callable from any
    /// thread, never panics.
    pub fn kill_all_now(&self) {}
}

/// How the env was resolved, for the banner.
fn source_label(source: &EnvSource) -> String {
    match source {
        EnvSource::LoginShell {
            shell, interactive, ..
        } => {
            let name = shell.file_name().map_or_else(
                || shell.display().to_string(),
                |name| name.to_string_lossy().into_owned(),
            );
            if *interactive {
                format!("{name} login shell")
            } else {
                format!("{name} login shell (non-interactive)")
            }
        }
        EnvSource::WindowsRegistry => "Windows registry".into(),
        EnvSource::Fallback { .. } => "fallback".into(),
    }
}

/// What [`SessionManager::shutdown_all`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShutdownSummary {
    pub sessions: usize,
    pub graceful: usize,
    pub forced: usize,
    pub took: Duration,
}

/// Why a session call failed. Each variant maps to one IPC error code; the message is the sentence
/// the UI shows.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("There is no chat with id {0}.")]
    ChatNotFound(String),
    #[error("auracode doesn't know an agent called \"{0}\".")]
    UnknownAgent(String),
    #[error("{0}")]
    AgentUnavailable(String),
    #[error("{path} can't be used as the chat's folder: {reason}")]
    InvalidFolder { path: String, reason: String },
    #[error("The message is empty.")]
    PromptEmpty,
    #[error("The message is too long ({bytes} bytes; the limit is {limit}).")]
    PromptTooLarge { bytes: usize, limit: usize },
    #[error("{0} messages are already waiting in this chat. Remove one or wait for one to start.")]
    QueueFull(usize),
    #[error("This request is no longer waiting for an answer.")]
    RequestNotPending,
    #[error("{0}")]
    OptionInvalid(String),
    #[error("The agent isn't running in this chat. Start it, then try again.")]
    SessionNotReady,
    #[error("{0} agents are already running. Stop one, then try again.")]
    TooManyAgents(usize),
    #[error("Too many views are open for this chat.")]
    TooManySubscriptions,
    #[error("auracode's database is not available: {0}")]
    StorageUnavailable(String),
    /// The chat store's sentence ([`StoreError::BlobMissing`](crate::chatstore::StoreError::BlobMissing)),
    /// passed on as is: the output is no longer kept, or not saved yet while the disk is full.
    #[error("{0}")]
    BlobMissing(String),
    #[error("auracode is shutting down.")]
    ShuttingDown,
    #[error("Something went wrong inside auracode: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use aura_agents::Detector;
    use aura_drivers::testing::ScriptedDriverFactory;
    use aura_process::testing::FakeSpawner;
    use aura_process::{EnvMap, EnvSource, LeftoverRegistry, ResolvedEnv};

    use super::*;
    use crate::owner::ProfileOwner;
    use crate::paths::DataRoot;
    use crate::profile::Profiles;
    use crate::store::Store;

    #[tokio::test]
    async fn the_skeleton_lists_agents_and_status_and_refuses_chat_calls() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
            .open_active()
            .expect("profile");
        let owner = ProfileOwner::acquire(&profile).expect("owner");
        let (store, _) = Store::open(&profile).expect("store");
        let rt = Handle::current();
        let store =
            ChatStore::start(store, owner, &profile, "device".into(), rt.clone()).expect("store");
        let mut vars = EnvMap::new();
        vars.insert("PATH".into(), "/usr/bin".into());
        vars.insert("CLAUDECODE".into(), "1".into());
        let env = EnvResolver::fixed(ResolvedEnv {
            vars,
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        });
        let detector = Detector::new(
            env.clone(),
            LeftoverRegistry::disabled(),
            dir.path().join("adapters"),
            rt.clone(),
        );
        let (spawner, _ends) = FakeSpawner::new();
        let redactor = Arc::new(Redactor::standard());
        let logs = LogFactory::new(
            profile.logs_dir().join("protocol"),
            Arc::clone(&redactor),
            rt.clone(),
        );
        let manager = SessionManager::new(ManagerDeps {
            store,
            env,
            spawner,
            detector,
            drivers: ScriptedDriverFactory::new(Vec::new()),
            logs,
            redactor,
            device_id: "device".into(),
            app_version: "0.1.0".into(),
            limits: ManagerLimits::STANDARD,
            timings: SessionTimings::STANDARD,
            rt,
        });

        let agents = manager.agents(false).await;
        assert_eq!(agents.len(), aura_agents::catalog().len());
        let status = manager.env_status();
        assert!(matches!(status.state, EnvState::Fallback { .. }));
        assert_eq!(status.removed, ["CLAUDECODE"]);
        assert_eq!(manager.storage_status(), StorageStatus::default());
        assert!(
            manager
                .protocol_log_dir("chat")
                .ends_with(Path::new("logs").join("protocol").join("chat"))
        );
        assert!(matches!(
            manager.chats().await,
            Err(SessionError::Internal(_))
        ));
        assert!(!manager.has_live_sessions());
        assert_eq!(
            manager.shutdown_all(Duration::from_secs(8)).await.sessions,
            0
        );
        manager.kill_all_now();
    }

    #[test]
    fn limits_and_timings_match_the_spec() {
        assert_eq!(ManagerLimits::STANDARD.max_live_agents, 12);
        assert_eq!(ManagerLimits::STANDARD.max_prompt_bytes, 1024 * 1024);
        assert_eq!(
            SessionTimings::STANDARD.force_cancel_wait,
            Duration::from_millis(200)
        );
        assert_eq!(
            SessionTimings::STANDARD.stop_kill_after,
            Duration::from_secs(15)
        );
    }

    #[test]
    fn session_errors_read_as_sentences() {
        assert_eq!(
            SessionError::TooManyAgents(12).to_string(),
            "12 agents are already running. Stop one, then try again."
        );
        assert_eq!(
            SessionError::QueueFull(20).to_string(),
            "20 messages are already waiting in this chat. Remove one or wait for one to start."
        );
        assert_eq!(
            SessionError::PromptTooLarge {
                bytes: 2_000_000,
                limit: 1_048_576
            }
            .to_string(),
            "The message is too long (2000000 bytes; the limit is 1048576)."
        );
        assert_eq!(
            SessionError::BlobMissing(
                "The full output isn't saved yet because the disk is full.".into()
            )
            .to_string(),
            "The full output isn't saved yet because the disk is full."
        );
    }
}
