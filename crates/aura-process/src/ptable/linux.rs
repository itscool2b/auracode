//! Linux: the process table from `/proc`. The parser is pure and builds on every OS so its tests run
//! everywhere; only reading `/proc` is Linux-only.
//!
//! `/proc/<pid>/stat` is `pid (comm) state ppid pgrp session ... starttime ...`, where `comm` may
//! hold spaces and parentheses, so the fields are counted from the last `)`. The start time
//! (field 22) is in clock ticks since boot, so it is kept with the boot id it counts from.

#[cfg(target_os = "linux")]
use std::io;
#[cfg(target_os = "linux")]
use std::sync::OnceLock;

use super::{ProcInfo, StartTime};

/// Fields after the `)` that closes `comm`: field N of `stat` is at index N - 3.
#[cfg(any(test, target_os = "linux"))]
const STATE: usize = 0;
const PPID: usize = 1;
const PGRP: usize = 2;
const SESSION: usize = 3;
const STARTTIME: usize = 19;

pub(super) fn parse_proc_stat(
    pid: u32,
    stat: &str,
    cmdline: &[u8],
    boot_id: &str,
) -> Option<ProcInfo> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    if stat.get(..open)?.trim().parse::<u32>().ok()? != pid || close < open {
        return None;
    }
    let fields: Vec<&str> = stat.get(close + 1..)?.split_whitespace().collect();
    let number = |index: usize| fields.get(index)?.parse::<u64>().ok();
    let small = |index: usize| u32::try_from(number(index)?).ok();
    let mut argv: Vec<String> = cmdline
        .split(|&byte| byte == 0)
        .map(|arg| String::from_utf8_lossy(arg).into_owned())
        .collect();
    // The terminating NUL leaves one empty piece at the end.
    if argv.last().is_some_and(String::is_empty) {
        argv.pop();
    }
    Some(ProcInfo {
        pid,
        ppid: small(PPID)?,
        pgid: small(PGRP)?,
        sid: Some(small(SESSION)?),
        start: StartTime::LinuxTicks {
            ticks: number(STARTTIME)?,
            boot_id: boot_id.to_owned(),
        },
        argv,
    })
}

/// The one-letter state of a `stat` line (`Z` for a zombie).
#[cfg(any(test, target_os = "linux"))]
pub(super) fn stat_state(stat: &str) -> Option<char> {
    let close = stat.rfind(')')?;
    stat.get(close + 1..)?
        .split_whitespace()
        .nth(STATE)?
        .chars()
        .next()
}

/// The boot time in Unix seconds from `/proc/stat`'s `btime` line. Pure.
#[cfg(any(test, target_os = "linux"))]
fn parse_btime(text: &str) -> Option<i64> {
    text.lines()
        .find_map(|line| line.strip_prefix("btime "))
        .and_then(|value| value.trim().parse().ok())
}

/// This boot's id, read once.
#[cfg(target_os = "linux")]
pub(super) fn boot_id() -> Option<String> {
    static BOOT_ID: OnceLock<Option<String>> = OnceLock::new();
    BOOT_ID
        .get_or_init(|| {
            std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
                .ok()
                .map(|id| id.trim().to_owned())
                .filter(|id| !id.is_empty())
        })
        .clone()
}

#[cfg(target_os = "linux")]
fn read(pid: u32) -> Option<(String, Vec<u8>)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    Some((stat, cmdline))
}

#[cfg(target_os = "linux")]
pub(super) fn snapshot() -> io::Result<Vec<ProcInfo>> {
    let boot = boot_id().unwrap_or_default();
    let mut table = Vec::new();
    for entry in std::fs::read_dir("/proc")? {
        let Ok(entry) = entry else { continue };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        // A process may exit between the listing and the read.
        let Some((stat, cmdline)) = read(pid) else {
            continue;
        };
        if stat_state(&stat) == Some('Z') {
            continue;
        }
        if let Some(info) = parse_proc_stat(pid, &stat, &cmdline, &boot) {
            table.push(info);
        }
    }
    Ok(table)
}

/// Whether any process that is not a zombie has group `pgid`, from each `/proc/<pid>/stat`.
#[cfg(target_os = "linux")]
pub(super) fn group_has_live_member(pgid: u32) -> bool {
    let Ok(listing) = std::fs::read_dir("/proc") else {
        return true;
    };
    listing.flatten().any(|entry| {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            return false;
        };
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        stat_state(&stat) != Some('Z')
            && parse_proc_stat(pid, &stat, &[], "").is_some_and(|info| info.pgid == pgid)
    })
}

#[cfg(target_os = "linux")]
pub(super) fn start_time(pid: u32) -> io::Result<StartTime> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
    parse_proc_stat(pid, &stat, &[], &boot_id().unwrap_or_default())
        .map(|info| info.start)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "unreadable /proc stat"))
}

#[cfg(target_os = "linux")]
pub(super) fn running_start(pid: u32) -> Option<StartTime> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    if stat_state(&stat) == Some('Z') {
        return None;
    }
    parse_proc_stat(pid, &stat, &[], &boot_id().unwrap_or_default()).map(|info| info.start)
}

/// Unix seconds of a start time read in this boot.
#[cfg(target_os = "linux")]
pub(super) fn ticks_epoch(ticks: u64, boot: &str) -> Option<i64> {
    static BTIME: OnceLock<Option<i64>> = OnceLock::new();
    if boot_id().as_deref() != Some(boot) {
        return None;
    }
    let btime = (*BTIME.get_or_init(|| parse_btime(&std::fs::read_to_string("/proc/stat").ok()?)))?;
    let per_second = nix::unistd::sysconf(nix::unistd::SysconfVar::CLK_TCK)
        .ok()
        .flatten()
        .and_then(|ticks| u64::try_from(ticks).ok())
        .filter(|ticks| *ticks > 0)
        .unwrap_or(100);
    Some(btime + i64::try_from(ticks / per_second).ok()?)
}

/// Other Unix systems take the `ps` path; Linux start times never occur there.
#[cfg(all(unix, not(target_os = "linux")))]
pub(super) fn ticks_epoch(_ticks: u64, _boot: &str) -> Option<i64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured from Linux 6.8 (`/proc/<pid>/stat`), with a `comm` holding spaces and parentheses.
    const STAT: &str = "5121 (tmux: (server)) S 5001 5001 4242 34816 5001 4194560 1076 0 0 0 3 1 0 0 20 0 1 0 98765 9850880 1024 18446744073709551615 1 1 0 0 0 0 0 4096 65536 0 0 0 17 3 0 0 0 0 0";

    #[test]
    fn proc_stat_parses_past_a_comm_with_parentheses() {
        let info =
            parse_proc_stat(5121, STAT, b"tmux\0new-session\0\0-d\0", "boot-1").expect("parse");
        assert_eq!(
            (info.pid, info.ppid, info.pgid, info.sid),
            (5121, 5001, 5001, Some(4242))
        );
        assert_eq!(
            info.start,
            StartTime::LinuxTicks {
                ticks: 98765,
                boot_id: "boot-1".into()
            }
        );
        assert_eq!(info.argv, ["tmux", "new-session", "", "-d"]);
        assert_eq!(stat_state(STAT), Some('S'));
        let zombie = STAT.replacen(") S ", ") Z ", 1);
        assert_eq!(stat_state(&zombie), Some('Z'));
    }

    #[test]
    fn proc_stat_rejects_what_is_not_this_process() {
        assert!(parse_proc_stat(1, STAT, b"", "b").is_none(), "another pid");
        assert!(
            parse_proc_stat(5121, "5121 (x) S 1 2", b"", "b").is_none(),
            "too short"
        );
        assert!(parse_proc_stat(5121, "garbage", b"", "b").is_none());
        let kernel_thread = parse_proc_stat(5121, STAT, b"", "b").expect("parse");
        assert!(kernel_thread.argv.is_empty());
    }

    #[test]
    fn btime_parses_from_proc_stat() {
        assert_eq!(
            parse_btime("cpu  1 2 3\nintr 5\nbtime 1792727995\nprocesses 10\n"),
            Some(1_792_727_995)
        );
        assert_eq!(parse_btime("cpu 1\n"), None);
    }
}
