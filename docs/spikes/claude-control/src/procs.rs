//! Process-table snapshots, to see what a `claude` child starts and what outlives it.
//!
//! The plan's shutdown rules (walk descendants by parent pid, record pid plus start time, never
//! kill vendor daemons) depend on knowing which helpers Claude Code spawns and whether any of
//! them detach. `ps` is the common source on macOS and Linux; Windows needs another one.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use crate::Res;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcRow {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub command: String,
}

pub fn snapshot() -> Res<Vec<ProcRow>> {
    let out = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,pgid=,command="]).output()?;
    if !out.status.success() {
        return Err(format!("ps exited with {}", out.status).into());
    }
    Ok(parse_ps(&String::from_utf8_lossy(&out.stdout)))
}

pub fn parse_ps(text: &str) -> Vec<ProcRow> {
    text.lines().filter_map(parse_row).collect()
}

fn parse_row(line: &str) -> Option<ProcRow> {
    let mut rest = line.trim_start();
    let mut numbers = [0u32; 3];
    for slot in &mut numbers {
        let end = rest.find(char::is_whitespace)?;
        *slot = rest[..end].parse().ok()?;
        rest = rest[end..].trim_start();
    }
    let [pid, ppid, pgid] = numbers;
    Some(ProcRow { pid, ppid, pgid, command: rest.to_owned() })
}

/// Every process below `root` by parent pid, which is how the plan's shutdown walks a tree.
pub fn descendants(rows: &[ProcRow], root: u32) -> Vec<ProcRow> {
    let mut found: Vec<ProcRow> = Vec::new();
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for row in rows.iter().filter(|row| row.ppid == parent && row.pid != parent) {
            if !found.iter().any(|seen| seen.pid == row.pid) {
                found.push(row.clone());
                frontier.push(row.pid);
            }
        }
    }
    found
}

fn describe(rows: &[ProcRow]) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let command: String = row.command.chars().take(160).collect();
            json!({"pid": row.pid, "ppid": row.ppid, "pgid": row.pgid, "command": command})
        })
        .collect()
}

/// What the child started while alive and what was still around after it exited.
///
/// `alive` holds snapshots taken while the child ran; `after` is one taken after it exited.
/// A survivor is a descendant seen while alive whose pid still runs the same command; a group
/// leftover is anything still in the child's process group; a new orphan is a `claude` process
/// reparented to init that the `before` snapshot didn't have.
pub fn report(before: &[ProcRow], alive: &[&[ProcRow]], after: &[ProcRow], child: u32) -> Value {
    let mut seen: Vec<ProcRow> = Vec::new();
    for snapshot in alive {
        for row in descendants(snapshot, child) {
            if !seen.iter().any(|known| known.pid == row.pid && known.command == row.command) {
                seen.push(row);
            }
        }
    }
    let survivors: Vec<ProcRow> = seen
        .iter()
        .filter(|row| after.iter().any(|now| now.pid == row.pid && now.command == row.command))
        .cloned()
        .collect();
    let group_leftovers: Vec<ProcRow> = after.iter().filter(|row| row.pgid == child).cloned().collect();
    let existing: BTreeSet<u32> = before.iter().map(|row| row.pid).collect();
    let new_orphans: Vec<ProcRow> = after
        .iter()
        .filter(|row| row.ppid == 1 && !existing.contains(&row.pid) && row.command.contains("claude"))
        .cloned()
        .collect();
    let detached: Vec<ProcRow> = seen.iter().filter(|row| row.pgid != child).cloned().collect();
    json!({
        "child_pid": child,
        "descendants_while_alive": describe(&seen),
        "descendants_outside_child_group": describe(&detached),
        "survivors_after_exit": describe(&survivors),
        "process_group_leftovers": describe(&group_leftovers),
        "new_orphaned_claude_processes": describe(&new_orphans),
    })
}

/// Unix-domain sockets a process holds, by `lsof` name column.
pub fn unix_sockets(pid: u32) -> Vec<String> {
    let Ok(out) = std::process::Command::new("lsof").args(["-nP", "-a", "-p", &pid.to_string(), "-U"]).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().last().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "    1     0     1 /sbin/launchd\n  100     1   100 /bin/zsh -l\n  200   100   200 claude -p --verbose\n  201   200   200 /bin/sh -c hook   with  spaces\n  202   201   200 node mcp.js\n  300   200   300 claude daemon\n garbage line\n";

    #[test]
    fn ps_rows_keep_the_command_verbatim() {
        let rows = parse_ps(PS);
        assert_eq!(rows.len(), 6);
        assert_eq!(
            rows[3],
            ProcRow { pid: 201, ppid: 200, pgid: 200, command: "/bin/sh -c hook   with  spaces".into() }
        );
    }

    #[test]
    fn descendants_follow_parent_links_through_generations() {
        let rows = parse_ps(PS);
        let mut pids: Vec<u32> = descendants(&rows, 200).iter().map(|row| row.pid).collect();
        pids.sort_unstable();
        assert_eq!(pids, vec![201, 202, 300]);
        assert!(descendants(&rows, 202).is_empty());
    }

    #[test]
    fn report_separates_survivors_leftovers_and_detached_helpers() {
        let before = parse_ps("    1     0     1 /sbin/launchd\n");
        let alive = parse_ps(PS);
        let after = parse_ps(
            "    1     0     1 /sbin/launchd\n  202     1   200 node mcp.js\n  300     1   300 claude daemon\n",
        );
        let report = report(&before, &[&alive], &after, 200);
        let pids = |key: &str| -> Vec<u64> {
            let mut pids: Vec<u64> =
                report[key].as_array().into_iter().flatten().filter_map(|row| row["pid"].as_u64()).collect();
            pids.sort_unstable();
            pids
        };
        assert_eq!(pids("survivors_after_exit"), vec![202, 300]);
        assert_eq!(pids("process_group_leftovers"), vec![202]);
        assert_eq!(pids("descendants_outside_child_group"), vec![300]);
        assert_eq!(pids("new_orphaned_claude_processes"), vec![300]);
    }
}
