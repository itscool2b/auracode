//! Process inspection for the spike's tests and the manual Windows demo: is a pid still running,
//! which process did a shell start, and what console did a process get.
//!
//! None of this is on the spawn path. It exists so the claims in `docs/spikes/windows-spawn.md`
//! are checked against the real OS instead of asserted.

use std::{fmt, io, str::FromStr, time::Duration};

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

#[cfg(windows)]
use windows::Win32::{
    Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
        TerminateProcess, WaitForSingleObject,
    },
};

const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// A process watched by pid, typically a grandchild that a test expects to die.
#[derive(Debug)]
pub struct WatchedProcess {
    pid: u32,
    /// Holding a handle pins the process object, so a recycled pid can never be mistaken for the
    /// original. Unix has no equivalent; pid reuse within a test's few seconds is not a concern.
    #[cfg(windows)]
    handle: OwnedHandle,
}

impl WatchedProcess {
    /// Starts watching `pid`; fails if no such process exists right now.
    #[cfg(unix)]
    pub fn open(pid: u32) -> io::Result<Self> {
        let watched = Self { pid };
        if watched.is_running()? {
            Ok(watched)
        } else {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("no running process {pid}"),
            ))
        }
    }

    /// Starts watching `pid`; fails if no such process exists right now.
    #[cfg(windows)]
    #[allow(unsafe_code)]
    pub fn open(pid: u32) -> io::Result<Self> {
        // SAFETY: OpenProcess has no memory-safety preconditions. It returns a fresh handle that
        // nothing else owns, so handing it to OwnedHandle (which closes it once) is sound.
        let handle = unsafe {
            let raw = OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                false,
                pid,
            )?;
            OwnedHandle::from_raw_handle(raw.0)
        };
        Ok(Self { pid, handle })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether the process is still alive. A Unix zombie counts as gone: it has already exited
    /// and only waits for its new parent to reap it.
    #[cfg(unix)]
    pub fn is_running(&self) -> io::Result<bool> {
        use nix::{errno::Errno, sys::signal::kill};

        match kill(unix_pid(self.pid)?, None) {
            // EPERM means the pid exists but belongs to someone else.
            Ok(()) | Err(Errno::EPERM) => {}
            Err(Errno::ESRCH) => return Ok(false),
            Err(err) => return Err(err.into()),
        }
        // kill(pid, 0) also succeeds for zombies, so ask ps for the state; it prints nothing for a
        // pid that is already gone.
        let ps = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &self.pid.to_string()])
            .output()?;
        let state = String::from_utf8_lossy(&ps.stdout);
        let state = state.trim();
        Ok(!state.is_empty() && !state.starts_with('Z'))
    }

    /// Whether the process is still alive.
    #[cfg(windows)]
    #[allow(unsafe_code)]
    pub fn is_running(&self) -> io::Result<bool> {
        // SAFETY: the handle is owned by self and stays open for the duration of the call.
        let wait = unsafe { WaitForSingleObject(HANDLE(self.handle.as_raw_handle()), 0) };
        match wait {
            WAIT_TIMEOUT => Ok(true),
            WAIT_OBJECT_0 => Ok(false),
            _ => Err(io::Error::last_os_error()),
        }
    }

    /// Polls until the process is gone; returns whether that happened within `timeout`.
    pub async fn wait_gone(&self, timeout: Duration) -> io::Result<bool> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if !self.is_running()? {
                return Ok(true);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(false);
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Kills the process, for cleanup after a failed assertion. A process that is already gone is
    /// not an error.
    #[cfg(unix)]
    pub fn kill(&self) -> io::Result<()> {
        use nix::{errno::Errno, sys::signal::Signal};

        match nix::sys::signal::kill(unix_pid(self.pid)?, Signal::SIGKILL) {
            Ok(()) | Err(Errno::ESRCH) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    /// Kills the process, for cleanup after a failed assertion. A process that is already gone is
    /// not an error.
    #[cfg(windows)]
    #[allow(unsafe_code)]
    pub fn kill(&self) -> io::Result<()> {
        if !self.is_running()? {
            return Ok(());
        }
        // SAFETY: the handle is owned by self, open, and was opened with PROCESS_TERMINATE.
        unsafe { TerminateProcess(HANDLE(self.handle.as_raw_handle()), 1) }?;
        Ok(())
    }
}

#[cfg(unix)]
fn unix_pid(pid: u32) -> io::Result<nix::unistd::Pid> {
    let raw = i32::try_from(pid).map_err(io::Error::other)?;
    Ok(nix::unistd::Pid::from_raw(raw))
}

/// Finds a process that `parent_pid` started, by executable name (case-insensitive, such as
/// `"ping.exe"`). This is how a test learns the pid of a grandchild started by `cmd`, which,
/// unlike `sh`, has no `$!` to print it.
///
/// Windows keeps a process's parent pid even after the parent exits, so this also finds
/// grandchildren that outlived their shell.
#[cfg(windows)]
#[allow(unsafe_code)]
pub fn find_child(parent_pid: u32, exe_name: &str) -> io::Result<Option<u32>> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    // SAFETY: CreateToolhelp32Snapshot has no memory-safety preconditions and returns a fresh
    // handle that nothing else owns, so OwnedHandle may close it.
    let snapshot = unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        OwnedHandle::from_raw_handle(raw.0)
    };
    let snapshot_handle = HANDLE(snapshot.as_raw_handle());

    let mut entry = PROCESSENTRY32W {
        dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).map_err(io::Error::other)?,
        ..Default::default()
    };
    // SAFETY: `entry` is a writable PROCESSENTRY32W whose dwSize is set, as the API requires, and
    // the snapshot handle stays open for the whole walk.
    let mut more = unsafe { Process32FirstW(snapshot_handle, &mut entry) }.is_ok();
    while more {
        if entry.th32ParentProcessID == parent_pid && exe_name_matches(&entry.szExeFile, exe_name) {
            return Ok(Some(entry.th32ProcessID));
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot_handle, &mut entry) }.is_ok();
    }
    Ok(None)
}

/// Polls [`find_child`] until the shell has started `exe_name` or `timeout` passes.
#[cfg(windows)]
pub async fn wait_for_child(
    parent_pid: u32,
    exe_name: &str,
    timeout: Duration,
) -> io::Result<Option<u32>> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Some(pid) = find_child(parent_pid, exe_name)? {
            return Ok(Some(pid));
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(None);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(windows)]
fn exe_name_matches(wide_name: &[u16], expected: &str) -> bool {
    let len = wide_name
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(wide_name.len());
    String::from_utf16_lossy(&wide_name[..len]).eq_ignore_ascii_case(expected)
}

/// What console a process got. On Windows this is the whole question of the spike: a process
/// that is attached to a console with no window cannot flash one, and neither can the console
/// programs it starts, because they attach to the same console.
///
/// Printed by `spawn-probe console` as one line, parsed back by the tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsoleReport {
    pub pid: u32,
    /// Processes attached to this process's console, itself included; 0 when it has no console.
    /// Two or more means it shares a console it inherited from its parent.
    pub console_processes: u32,
    /// `GetConsoleWindow` returned a window: a real console window, or the stand-in a pseudo
    /// console hands out when Windows Terminal hosts the console.
    pub has_window: bool,
    /// That window is visible.
    pub window_visible: bool,
}

impl ConsoleReport {
    /// The console state of the calling process.
    #[cfg(windows)]
    #[allow(unsafe_code)]
    pub fn current() -> Self {
        use windows::Win32::{
            System::Console::{GetConsoleProcessList, GetConsoleWindow},
            UI::WindowsAndMessaging::IsWindowVisible,
        };

        let mut processes = [0u32; 64];
        // SAFETY: the API writes at most `processes.len()` pids into the buffer and returns the
        // total count, which may be larger; only the count is used. It returns 0 without a console.
        let console_processes = unsafe { GetConsoleProcessList(&mut processes) };
        // SAFETY: no preconditions; returns a null HWND when the console has no window.
        let window = unsafe { GetConsoleWindow() };
        let has_window = !window.is_invalid();
        // SAFETY: IsWindowVisible accepts any HWND and only reads window state.
        let window_visible = has_window && unsafe { IsWindowVisible(window) }.as_bool();
        Self {
            pid: std::process::id(),
            console_processes,
            has_window,
            window_visible,
        }
    }

    pub fn attached(&self) -> bool {
        self.console_processes > 0
    }

    /// No console window anyone could see: none at all, or one that is hidden.
    pub fn shows_no_window(&self) -> bool {
        !self.has_window || !self.window_visible
    }
}

impl fmt::Display for ConsoleReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "console pid={} processes={} window={} visible={}",
            self.pid,
            self.console_processes,
            u8::from(self.has_window),
            u8::from(self.window_visible)
        )
    }
}

impl FromStr for ConsoleReport {
    type Err = String;

    fn from_str(line: &str) -> Result<Self, Self::Err> {
        let mut words = line.split_whitespace();
        if words.next() != Some("console") {
            return Err(format!("not a console report: {line:?}"));
        }
        let mut report = Self {
            pid: 0,
            console_processes: 0,
            has_window: false,
            window_visible: false,
        };
        let mut seen = 0;
        for word in words {
            let (key, value) = word
                .split_once('=')
                .ok_or_else(|| format!("bad field {word:?} in {line:?}"))?;
            let number: u32 = value
                .parse()
                .map_err(|_| format!("bad number {value:?} in {line:?}"))?;
            match key {
                "pid" => report.pid = number,
                "processes" => report.console_processes = number,
                "window" => report.has_window = number != 0,
                "visible" => report.window_visible = number != 0,
                _ => return Err(format!("unknown field {key:?} in {line:?}")),
            }
            seen += 1;
        }
        if seen == 4 {
            Ok(report)
        } else {
            Err(format!("incomplete console report: {line:?}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_report_round_trips_through_its_line_format() -> Result<(), String> {
        let report = ConsoleReport {
            pid: 42,
            console_processes: 2,
            has_window: false,
            window_visible: false,
        };
        let parsed: ConsoleReport = report.to_string().parse()?;
        assert_eq!(parsed, report);
        assert!(parsed.attached() && parsed.shows_no_window());
        Ok(())
    }

    #[test]
    fn console_report_rejects_malformed_lines() {
        assert!("console pid=1".parse::<ConsoleReport>().is_err());
        assert!(
            "hello pid=1 processes=1 window=0 visible=0"
                .parse::<ConsoleReport>()
                .is_err()
        );
        assert!(
            "console pid=x processes=1 window=0 visible=0"
                .parse::<ConsoleReport>()
                .is_err()
        );
    }

    #[tokio::test]
    async fn watching_this_process_sees_it_running() -> io::Result<()> {
        let me = WatchedProcess::open(std::process::id())?;
        assert!(me.is_running()?);
        assert!(!me.wait_gone(Duration::from_millis(60)).await?);
        Ok(())
    }
}
