//! The process table: snapshots, start times, descendants, and daemon matching.
//!
//! Unix only for anything that reads the system (Windows needs no process table in M1a: the job
//! tracks the tree and no sweep runs there). The types and the pure functions (matching and the
//! parsers, tested on captured text) build on every OS, so the leftover registry's records do too.
//!
//! macOS reads `ps -axo pid=,ppid=,pgid=,lstart=,command=` with `LC_ALL=C TZ=UTC0` (`lstart` is five
//! fixed tokens, one-second resolution) and session ids through `getsid` (macOS `ps -o sess` prints
//! 0); Linux reads `/proc/<pid>/stat` (start time in clock ticks since boot, field 22) with the boot
//! id.

mod linux;
mod macos;

#[cfg(unix)]
use std::io;

use serde::{Deserialize, Serialize};

use crate::spawn::DaemonMatch;

/// One process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub sid: Option<u32>,
    pub start: StartTime,
    /// macOS: `ps -o command=` split on spaces; Linux: `/proc/<pid>/cmdline` split on NUL.
    pub argv: Vec<String>,
}

/// When a process started, in a form that tells a recycled pid from the original.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartTime {
    /// Clock ticks since boot (`/proc/<pid>/stat` field 22), with the boot it counts from.
    LinuxTicks {
        ticks: u64,
        boot_id: String,
    },
    /// `ps -o lstart=` as printed with `LC_ALL=C TZ=UTC0`.
    MacLstart(String),
    Unknown,
}

/// Every process, read once.
#[cfg(unix)]
pub fn snapshot() -> io::Result<Vec<ProcInfo>> {
    Err(io::Error::other("not implemented in this build"))
}

/// One process's start time.
#[cfg(unix)]
pub fn start_time(_pid: u32) -> io::Result<StartTime> {
    Err(io::Error::other("not implemented in this build"))
}

/// Every process whose parent chain in `table` leads to `root`, `root` excluded.
pub fn descendants(_table: &[ProcInfo], _root: u32) -> Vec<ProcInfo> {
    Vec::new()
}

/// Whether `info` is one of `daemons` (see [`DaemonMatch`]). Pure.
pub fn matches_daemon(_info: &ProcInfo, _daemons: &[DaemonMatch]) -> bool {
    false
}

/// What identifies this boot: Linux's boot id, macOS's `kern.boottime`.
#[cfg(unix)]
pub fn boot_marker() -> Option<String> {
    None
}

/// Parses `ps -axo pid=,ppid=,pgid=,lstart=,command=` output. Pure, tested with captured output.
pub fn parse_ps(_text: &str) -> Vec<ProcInfo> {
    Vec::new()
}

/// Parses one process's `/proc/<pid>/stat` and `cmdline`. Pure.
pub fn parse_proc_stat(
    _pid: u32,
    _stat: &str,
    _cmdline: &[u8],
    _boot_id: &str,
) -> Option<ProcInfo> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_times_serialize_for_the_registry() {
        let linux = StartTime::LinuxTicks {
            ticks: 123,
            boot_id: "b".into(),
        };
        assert_eq!(
            serde_json::to_value(&linux).expect("serialize"),
            serde_json::json!({"linux_ticks": {"ticks": 123, "boot_id": "b"}})
        );
        for start in [
            linux,
            StartTime::MacLstart("Sat Oct 24 09:03:00 2026".into()),
            StartTime::Unknown,
        ] {
            let text = serde_json::to_string(&start).expect("serialize");
            assert_eq!(
                serde_json::from_str::<StartTime>(&text).expect("deserialize"),
                start
            );
        }
    }
}
