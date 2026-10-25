//! Launch specs: how one start of an agent runs.
//!
//! A `Binary` agent runs its program with its args from the chat folder. An `NpmAdapter` runs as
//! `node <absolute entry>` from its own install folder, never the chat folder (which reaches the
//! adapter only as the ACP `cwd`), with the user's binary forced through the adapter's variable. A
//! `Builtin` agent has no process.

use std::path::PathBuf;

use aura_process::{LaunchSpec, ProcessCwd};

use crate::catalog::AgentSpec;

/// Why an agent cannot start. Every reason is a sentence the error card shows.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LaunchError {
    #[error("{reason}")]
    Missing { reason: String },
    #[error("{reason}")]
    Broken { reason: String },
    #[error("{reason}")]
    InstallFailed { reason: String },
}

/// The launch spec of a built-in agent: it runs inside auracode, so it names no program and is never
/// spawned.
pub(crate) fn builtin(spec: &AgentSpec) -> LaunchSpec {
    LaunchSpec {
        label: spec.id.to_owned(),
        program: PathBuf::new(),
        args: Vec::new(),
        cwd: ProcessCwd::ChatFolder,
        set_env: Vec::new(),
        daemons: spec.daemons.clone(),
        startup_timeout: spec.startup_timeout,
    }
}
