//! What to run and how it starts: launch specs, the spawner seam, and short-lived helpers.
//!
//! Every spawn gets an absolute program path, the complete environment (`env_clear` plus
//! [`child_env`](crate::env::child_env): resolved, scrubbed, then `set_env`), its own process group on
//! Unix (a new session for helpers that ask for one) or a kill-on-close job object with
//! `CREATE_NO_WINDOW` on Windows, and all three pipes. The process cwd is checked first, on the
//! blocking pool, because Unix reports a missing cwd as a missing program and a macOS privacy prompt
//! can hold the call until the user answers.

use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures::FutureExt;
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;

use crate::control::{ExitInfo, ProcessControl};
use crate::env::ResolvedEnv;
use crate::io::AgentIo;
use crate::log::ProtocolLog;
use crate::registry::LeftoverRegistry;

/// What a stub body answers until package A builds it.
const NOT_BUILT: &str = "not implemented in this build";

/// Where the agent process runs. An ACP agent always gets the chat folder as the protocol's `cwd`,
/// wherever its process runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessCwd {
    /// The chat's folder ([`SpawnSpec::folder`]).
    ChatFolder,
    /// A folder of its own, such as an npm adapter's install folder, so nothing in the chat folder
    /// (a `.npmrc`, a committed `node_modules`) decides what runs.
    Fixed(PathBuf),
}

/// A descendant that is a vendor daemon and must survive shutdown (Hermes' gateway, Claude's
/// daemon): the file name of `argv[0]` equals `program` when set, and the words of `args_in_order`
/// appear in argv in that order (not necessarily adjacent). A match is spared with its whole subtree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonMatch {
    pub program: Option<String>,
    pub args_in_order: Vec<String>,
}

/// How to start one agent.
#[derive(Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    /// "hermes acp", for logs and status text.
    pub label: String,
    /// Absolute; symlinks are not resolved (agents launch through their stable symlink or shim).
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: ProcessCwd,
    /// Always set, after the scrub. Names are logged, values never.
    pub set_env: Vec<(OsString, OsString)>,
    /// Spared by the kill rule.
    pub daemons: Vec<DaemonMatch>,
    pub startup_timeout: Duration,
}

/// Prints `set_env` names only: values can be credentials.
impl fmt::Debug for LaunchSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let set_env: Vec<_> = self.set_env.iter().map(|(name, _)| name).collect();
        f.debug_struct("LaunchSpec")
            .field("label", &self.label)
            .field("program", &self.program)
            .field("args", &self.args)
            .field("cwd", &self.cwd)
            .field("set_env", &set_env)
            .field("daemons", &self.daemons)
            .field("startup_timeout", &self.startup_timeout)
            .finish()
    }
}

/// One spawn: the launch, the chat folder ([`ProcessCwd::ChatFolder`] resolves to it), the env the
/// session started with, and the stdout line cap ([`crate::MAX_LINE_BYTES`] for agents).
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub launch: LaunchSpec,
    pub folder: PathBuf,
    pub env: Arc<ResolvedEnv>,
    pub max_line_bytes: usize,
}

/// Starts agent processes. [`Spawner`] is the real one; tests use `testing::FakeSpawner`.
pub trait ProcessSpawner: Send + Sync + 'static {
    /// Spawns an agent with all three pipes; `log` receives every stdin, stdout and stderr line.
    fn spawn(
        &self,
        spec: SpawnSpec,
        log: ProtocolLog,
    ) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>>;
}

/// Spawns real processes and records each agent in the leftover registry.
#[derive(Debug)]
pub struct Spawner {
    registry: Arc<LeftoverRegistry>,
    /// Where the pipe tasks and the waiter run: constructors never assume a runtime context.
    #[expect(dead_code, reason = "the spawn body (package A) runs its tasks here")]
    rt: Handle,
}

impl Spawner {
    pub fn new(registry: Arc<LeftoverRegistry>, rt: Handle) -> Arc<Spawner> {
        Arc::new(Spawner { registry, rt })
    }

    pub fn registry(&self) -> &Arc<LeftoverRegistry> {
        &self.registry
    }
}

impl ProcessSpawner for Spawner {
    fn spawn(
        &self,
        spec: SpawnSpec,
        _log: ProtocolLog,
    ) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>> {
        let program = spec.launch.program.display().to_string();
        async move {
            Err(SpawnError::Spawn {
                program,
                source: io::Error::other(NOT_BUILT),
            })
        }
        .boxed()
    }
}

/// A running agent: its pipes, its control, and its protocol log.
#[derive(Debug)]
pub struct SpawnedProcess {
    /// Copied from [`ProtocolLog::spawn_id`]: names the log file and prefixes ids minted outside a
    /// turn.
    pub spawn_id: String,
    pub io: AgentIo,
    pub control: ProcessControl,
    pub log: ProtocolLog,
}

/// Why a spawn failed. Every message is a sentence the UI can show.
#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    #[error("{program} was not found")]
    ProgramNotFound { program: String },
    #[error("{program} can't be run: permission denied")]
    PermissionDenied { program: String },
    #[error("the folder {} can't be used: {reason}", path.display())]
    InvalidCwd { path: PathBuf, reason: String },
    #[error("auracode isn't allowed to open {}", path.display())]
    CwdNotAllowed { path: PathBuf },
    #[error("spawning needs a Tokio runtime")]
    NoRuntime,
    #[error("could not start {program}")]
    Spawn {
        program: String,
        #[source]
        source: io::Error,
    },
}

/// The environment a helper starts with. Both are scrubbed.
#[derive(Debug, Clone)]
pub enum HelperEnv {
    /// auracode's own env minus `strip_launch_context`: the env resolver's shell, which must not
    /// wait for the resolver.
    ProcessEnv,
    Resolved(Arc<ResolvedEnv>),
}

/// A short-lived helper: the env resolver's shell, a `--version` probe, the adapter install.
#[derive(Debug, Clone)]
pub struct HelperSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub env: HelperEnv,
    /// Always set, after the scrub.
    pub set: Vec<(OsString, OsString)>,
    /// Starts the helper in a new session (Unix), so an interactive shell never takes the
    /// foreground of the terminal auracode was started from.
    pub new_session: bool,
    pub timeout: Duration,
    /// stdout beyond this is dropped (`stdout_truncated`).
    pub max_stdout: usize,
}

/// What a helper produced.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HelperOutput {
    /// `None` when it was killed on timeout before it exited.
    pub exit: Option<ExitInfo>,
    pub stdout: Vec<u8>,
    pub stdout_truncated: bool,
    /// Lossy and not redacted.
    pub stderr_tail: String,
    pub timed_out: bool,
}

/// Runs a short-lived helper: stdin `/dev/null`, registered for the sweep, the whole tree killed on
/// timeout and when the returned future is dropped.
pub async fn run_helper(
    _registry: &LeftoverRegistry,
    spec: HelperSpec,
) -> Result<HelperOutput, SpawnError> {
    Err(SpawnError::Spawn {
        program: spec.program.display().to_string(),
        source: io::Error::other(NOT_BUILT),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_spec_debug_shows_variable_names_but_never_values() {
        let launch = LaunchSpec {
            label: "claude-agent-acp".into(),
            program: PathBuf::from("/usr/local/bin/node"),
            args: vec!["entry.js".into()],
            cwd: ProcessCwd::Fixed(PathBuf::from("/data/adapters/x")),
            set_env: vec![("ANTHROPIC_API_KEY".into(), "sk-ant-secret-value".into())],
            daemons: Vec::new(),
            startup_timeout: Duration::from_secs(60),
        };
        let text = format!("{launch:?}");
        assert!(text.contains("ANTHROPIC_API_KEY"), "{text}");
        assert!(!text.contains("sk-ant-secret-value"), "{text}");
    }

    #[test]
    fn daemon_matches_serialize_for_the_registry() {
        let daemon = DaemonMatch {
            program: None,
            args_in_order: vec!["hermes_cli.main".into(), "gateway".into(), "run".into()],
        };
        assert_eq!(
            serde_json::to_value(&daemon).expect("serialize"),
            serde_json::json!({"program": null, "args_in_order": ["hermes_cli.main", "gateway", "run"]})
        );
    }

    #[test]
    fn spawn_errors_read_as_sentences() {
        let missing = SpawnError::InvalidCwd {
            path: PathBuf::from("/gone"),
            reason: "it does not exist".into(),
        };
        assert_eq!(
            missing.to_string(),
            "the folder /gone can't be used: it does not exist"
        );
        assert_eq!(
            SpawnError::CwdNotAllowed {
                path: PathBuf::from("/Users/me/Desktop/x")
            }
            .to_string(),
            "auracode isn't allowed to open /Users/me/Desktop/x"
        );
    }
}
