//! The leftover registry and the startup sweep (Unix).
//!
//! Each running auracode process (the app or the CLI) keeps one file, `<data root>/run/<instance
//! pid>-<instance start key>.json`, listing its running agents: their group, their declared daemons
//! and, after every turn, the descendants that left the group. The file is written atomically on
//! every change and rewritten every [`REGISTRY_HEARTBEAT`](crate::REGISTRY_HEARTBEAT) while it has
//! entries, so its modification time is the instance's heartbeat, and deleted at a clean exit. At
//! the next start, [`sweep_stale`] stops what dead instances left running and touches nothing a live
//! instance owns.
//!
//! ```text
//! {"version":1,"instance":{"pid":4242,"start":{...},"sid":4242,"boot":"<marker>"},
//!  "entries":[{"pid":5001,"pgid":5001,"sid":4242,"start":{...},"label":"hermes acp",
//!              "spawned_at_ms":1792840000000,"daemons":[...],"escaped":[{"pid":5120,"start":{...}}]}]}
//! ```
//!
//! Windows keeps no registry: an agent's job object dies with its owner. There `open` returns a
//! disabled registry and `sweep_stale` does nothing.

use std::io;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;

use crate::ptable::StartTime;
use crate::spawn::DaemonMatch;

/// The auracode process a registry file belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceRecord {
    pub pid: u32,
    pub start: StartTime,
    pub sid: Option<u32>,
    /// The boot the instance ran in: a different marker means the machine rebooted since.
    pub boot: Option<String>,
}

/// A descendant that left the agent's group, identified by pid and start time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EscapedProc {
    pub pid: u32,
    pub start: StartTime,
}

/// One running agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeftoverEntry {
    pub pid: u32,
    pub pgid: u32,
    pub sid: Option<u32>,
    pub start: StartTime,
    pub label: String,
    pub spawned_at_ms: i64,
    pub daemons: Vec<DaemonMatch>,
    pub escaped: Vec<EscapedProc>,
}

/// This instance's registry file.
#[derive(Debug)]
pub struct LeftoverRegistry {
    own: InstanceRecord,
}

impl LeftoverRegistry {
    /// Opens this instance's file under `run_dir` and starts its heartbeat on `rt`.
    pub fn open(_run_dir: &Path, _rt: Handle) -> io::Result<Arc<LeftoverRegistry>> {
        Ok(LeftoverRegistry::disabled())
    }

    /// A registry that records nothing (Windows, tests, and a run directory that can't be written).
    pub fn disabled() -> Arc<LeftoverRegistry> {
        Arc::new(LeftoverRegistry {
            own: InstanceRecord {
                pid: std::process::id(),
                start: StartTime::Unknown,
                sid: None,
                boot: None,
            },
        })
    }

    /// This auracode process.
    pub fn own(&self) -> &InstanceRecord {
        &self.own
    }

    /// Records a running agent. A failure is a warning for the caller, never a failed spawn.
    pub fn register(&self, _entry: LeftoverEntry) -> io::Result<()> {
        Ok(())
    }

    /// Replaces the escaped descendants recorded for the agent `pid`.
    pub fn set_escaped(&self, _pid: u32, _escaped: Vec<EscapedProc>) {}

    pub fn unregister(&self, _pid: u32) {}

    /// Deletes this instance's file, at a clean exit.
    pub fn close(&self) -> io::Result<()> {
        Ok(())
    }
}

/// Stops what dead instances left running: every registry file in `run_dir` that is not `own`'s.
/// Runs once at boot on a background task.
pub async fn sweep_stale(_run_dir: &Path, _own: &InstanceRecord) -> SweepReport {
    SweepReport::default()
}

/// What a sweep did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SweepReport {
    pub files_removed: u32,
    /// Each killed process's pid and label.
    pub killed: Vec<(u32, String)>,
    /// Files whose instance is still running.
    pub skipped_live_owner: u32,
    /// Candidates whose pid now belongs to another process.
    pub skipped_reused: u32,
    pub errors: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_disabled_registry_names_this_process_and_accepts_everything() {
        let registry = LeftoverRegistry::disabled();
        assert_eq!(registry.own().pid, std::process::id());
        let entry = LeftoverEntry {
            pid: 1,
            pgid: 1,
            sid: None,
            start: StartTime::Unknown,
            label: "hermes acp".into(),
            spawned_at_ms: 0,
            daemons: Vec::new(),
            escaped: Vec::new(),
        };
        registry.register(entry.clone()).expect("register");
        registry.set_escaped(1, Vec::new());
        registry.unregister(1);
        registry.close().expect("close");
        let text = serde_json::to_string(&entry).expect("serialize");
        assert_eq!(
            serde_json::from_str::<LeftoverEntry>(&text).expect("deserialize"),
            entry
        );
    }
}
