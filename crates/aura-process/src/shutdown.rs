//! The shutdown chain and the kill rule.
//!
//! The chain, on Unix: snapshot the agent's descendants (orphans reparent to init, so this comes
//! first), close stdin, wait `stdin_eof_grace`, `killpg(SIGTERM)` plus SIGTERM to every escaped
//! descendant, wait `sigterm_grace`, then SIGKILL to the group and to the escaped descendants still
//! alive, and wait `kill_confirm`. Windows skips SIGTERM (no signals across consoles) and terminates
//! the job.
//!
//! The kill rule: every member of the agent's process group dies, and so does every descendant the
//! parent walk finds in another group or session, unless it matches one of the agent's declared
//! daemons ([`DaemonMatch`](crate::spawn::DaemonMatch)), which is spared with its whole subtree.

use std::time::Duration;

use crate::control::ExitInfo;

/// How long each step of the chain waits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShutdownPlan {
    /// Zero skips closing stdin and goes straight to the signals.
    pub stdin_eof_grace: Duration,
    pub sigterm_grace: Duration,
    pub kill_confirm: Duration,
}

impl ShutdownPlan {
    /// A Stop: codex-acp needs more than 2 s after EOF, and Claude's SDKs wait 5 s.
    pub const STANDARD: ShutdownPlan = ShutdownPlan {
        stdin_eof_grace: Duration::from_secs(5),
        sigterm_grace: Duration::from_secs(3),
        kill_confirm: Duration::from_secs(2),
    };

    /// Quitting auracode.
    pub const QUIT: ShutdownPlan = ShutdownPlan {
        stdin_eof_grace: Duration::from_secs(3),
        sigterm_grace: Duration::from_secs(1),
        kill_confirm: Duration::from_secs(2),
    };

    /// A force stop: no EOF, SIGTERM at once.
    pub const FORCE: ShutdownPlan = ShutdownPlan {
        stdin_eof_grace: Duration::ZERO,
        sigterm_grace: Duration::from_secs(2),
        kill_confirm: Duration::from_secs(2),
    };
}

/// What the chain did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ShutdownReport {
    pub exit: Option<ExitInfo>,
    pub steps: Vec<ShutdownStep>,
    /// Processes still alive after the chain.
    pub leftovers: Vec<u32>,
    /// Declared daemons and their subtrees, left running on purpose.
    pub spared: Vec<u32>,
    pub took: Duration,
}

/// One step of the chain, in the order taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownStep {
    AlreadyExited,
    ClosedStdin,
    ExitedAfterEof,
    SentSigterm { processes: u32 },
    ExitedAfterSigterm,
    Killed { processes: u32 },
    TerminatedJob,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_match_the_spec() {
        assert_eq!(
            ShutdownPlan::STANDARD.stdin_eof_grace,
            Duration::from_secs(5)
        );
        assert_eq!(ShutdownPlan::QUIT.sigterm_grace, Duration::from_secs(1));
        assert!(ShutdownPlan::FORCE.stdin_eof_grace.is_zero());
        assert_eq!(ShutdownPlan::FORCE.kill_confirm, Duration::from_secs(2));
    }
}
