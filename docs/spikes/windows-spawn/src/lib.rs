//! Hidden, tree-killable child processes: the M0 Windows spawning spike.
//!
//! auracode runs coding agents as children of a GUI app. On Windows that raises two problems a
//! terminal never shows. A console program started by a process without a console gets a brand
//! new console window, so every `git` an agent's shell runs would flash a black box on screen. And
//! Windows has no process groups, so killing the agent would leave its shell and tools running.
//!
//! - **Windows:** the agent starts with `CREATE_NO_WINDOW`, which gives it a console that has no
//!   window. Console grandchildren (bash, git, node) inherit that hidden console instead of
//!   allocating their own. The agent is also placed in a Job Object with
//!   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before it runs a single instruction, so
//!   [`HiddenChild::kill_tree`] terminates every descendant, and the kernel kills the whole tree
//!   when auracode exits for any reason, crashes included, because the job handle closes with it.
//! - **Unix:** the agent leads a new process group, and killing the tree signals the group.
//!
//! stdout and stderr are always drained by background tasks, so a chatty child can never block on
//! a full pipe while the caller is busy elsewhere.
//!
//! The platform mechanics come from `process-wrap`; `docs/spikes/windows-spawn.md` records why.

pub mod inspect;

use std::{
    borrow::Cow,
    ffi::{OsStr, OsString},
    io,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};

#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
#[cfg(windows)]
use process_wrap::tokio::{CreationFlags, JobObject};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{ChildStdin, Command},
    runtime::Handle,
    sync::watch,
    task::JoinHandle,
};

#[cfg(not(any(unix, windows)))]
compile_error!("windows-spawn only knows how to hide and kill process trees on Unix and Windows");

/// How much of each stream a [`HiddenChild`] keeps in memory: the newest bytes win, because the
/// end of stderr is what explains a crash. Everything is still read, so the child never blocks.
pub const CAPTURE_LIMIT: usize = 4 * 1024 * 1024;

/// How long [`HiddenChild::wait_with_output`] waits for a pipe to reach end-of-file after the tree
/// is gone. A process that left the tree (a Unix daemon that called `setsid`) can keep a pipe open
/// forever; past this we stop reading and report the capture as incomplete instead of hanging.
pub const PIPE_EOF_GRACE: Duration = Duration::from_secs(2);

const READ_CHUNK: usize = 64 * 1024;

/// One change to the environment a child inherits from auracode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvOverride {
    /// Set or replace a variable.
    Set(OsString, OsString),
    /// Remove an inherited variable, for the env scrub (`CLAUDECODE`, `CODEX_*`, `NODE_OPTIONS`).
    Remove(OsString),
}

impl EnvOverride {
    pub fn set(name: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        Self::Set(name.into(), value.into())
    }

    pub fn remove(name: impl Into<OsString>) -> Self {
        Self::Remove(name.into())
    }
}

/// Why [`spawn_hidden`] could not start a process.
#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    /// The program is not installed or not on `PATH`: the "agent not installed" state, not a bug.
    #[error("`{program}` was not found")]
    ProgramNotFound {
        program: String,
        #[source]
        source: io::Error,
    },
    /// Checked before spawning because the OS reports a missing working directory as "not found"
    /// on Unix, which would otherwise be indistinguishable from a missing program.
    #[error("working directory `{}` does not exist or is not a directory", path.display())]
    InvalidCwd { path: PathBuf },
    /// The drain tasks and process reaping live on Tokio; this is returned instead of panicking.
    #[error("spawn_hidden needs a Tokio runtime; call it from async code")]
    NoRuntime,
    /// Anything else: permissions, a Job Object that refused the process, resource limits.
    #[error("could not start `{program}`")]
    Spawn {
        program: String,
        #[source]
        source: io::Error,
    },
}

/// Which output stream of a child.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pipe {
    Stdout,
    Stderr,
}

/// What a child wrote to one stream, capped at [`CAPTURE_LIMIT`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Captured {
    /// The newest bytes, at most [`CAPTURE_LIMIT`] of them. Raw bytes because agents can print
    /// invalid UTF-8; decode lossily with [`Captured::text`].
    pub bytes: Vec<u8>,
    /// Every byte the stream produced, including any dropped from the front of `bytes`.
    pub total_len: u64,
    /// The stream reached end-of-file. False when reading was abandoned after [`PIPE_EOF_GRACE`]
    /// because something outside the tree still held the pipe open.
    pub complete: bool,
}

impl Captured {
    /// Whether older output was dropped to stay within [`CAPTURE_LIMIT`].
    pub fn is_truncated(&self) -> bool {
        self.total_len > self.bytes.len() as u64
    }

    pub fn text(&self) -> Cow<'_, str> {
        String::from_utf8_lossy(&self.bytes)
    }
}

/// Everything a finished child produced.
#[derive(Debug, Clone)]
pub struct Output {
    pub status: ExitStatus,
    pub stdout: Captured,
    pub stderr: Captured,
}

/// A running child whose output is drained in the background and whose whole process tree can be
/// killed. Dropping it kills the tree too, so a forgotten handle never leaks processes.
#[derive(Debug)]
pub struct HiddenChild {
    child: Box<dyn ChildWrapper>,
    pid: u32,
    stdin: Option<ChildStdin>,
    stdout: Drain,
    stderr: Drain,
    status: Option<ExitStatus>,
    tree_killed: bool,
}

/// Starts `program` with a hidden console (Windows), in its own killable process tree, with all
/// three stdio streams piped.
///
/// `cwd` of `None` inherits auracode's working directory. `env_overrides` apply in order on top of
/// the inherited environment, so a later entry for the same name wins.
///
/// Must be called inside a Tokio runtime with IO and timers enabled (`enable_all`), which is what
/// `#[tokio::main]` and Tauri's async runtime provide.
pub fn spawn_hidden<I, S>(
    program: impl AsRef<OsStr>,
    args: I,
    cwd: Option<&Path>,
    env_overrides: &[EnvOverride],
) -> Result<HiddenChild, SpawnError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let runtime = Handle::try_current().map_err(|_| SpawnError::NoRuntime)?;
    let program = program.as_ref();
    let program_name = program.to_string_lossy().into_owned();

    if let Some(dir) = cwd
        && !dir.is_dir()
    {
        return Err(SpawnError::InvalidCwd {
            path: dir.to_path_buf(),
        });
    }

    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    for change in env_overrides {
        match change {
            EnvOverride::Set(name, value) => command.env(name, value),
            EnvOverride::Remove(name) => command.env_remove(name),
        };
    }

    let mut command = CommandWrap::from(command);
    // KillOnDrop also tells JobObject to set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
    command.wrap(KillOnDrop);
    #[cfg(windows)]
    {
        // JobObject adds CREATE_SUSPENDED on top of these flags, assigns the process to the job,
        // and only then resumes it, so not even a fast child can start a grandchild outside it.
        command
            .wrap(CreationFlags(
                windows::Win32::System::Threading::CREATE_NO_WINDOW,
            ))
            .wrap(JobObject);
    }
    #[cfg(unix)]
    {
        command.wrap(ProcessGroup::leader());
    }

    let mut child = command.spawn().map_err(|source| {
        if source.kind() == io::ErrorKind::NotFound {
            SpawnError::ProgramNotFound {
                program: program_name.clone(),
                source,
            }
        } else {
            SpawnError::Spawn {
                program: program_name.clone(),
                source,
            }
        }
    })?;

    let Some(pid) = child.id() else {
        // Unreachable in practice (nothing has waited on the child yet), but not worth a panic.
        let _ = child.start_kill();
        return Err(SpawnError::Spawn {
            program: program_name,
            source: io::Error::other("the child exited before its pid could be read"),
        });
    };

    let stdin = child.stdin().take();
    let stdout = Drain::start(&runtime, child.stdout().take());
    let stderr = Drain::start(&runtime, child.stderr().take());

    Ok(HiddenChild {
        child,
        pid,
        stdin,
        stdout,
        stderr,
        status: None,
        tree_killed: false,
    })
}

/// Kills every process in the child's tree and waits for the child itself to exit.
///
/// Free-function form of [`HiddenChild::kill_tree`].
pub async fn kill_tree(child: &mut HiddenChild) -> io::Result<ExitStatus> {
    child.kill_tree().await
}

impl HiddenChild {
    /// The pid of the direct child (the agent), not of its descendants.
    pub fn id(&self) -> u32 {
        self.pid
    }

    /// The write end of the child's stdin, for protocols like ACP. Dropping it sends end-of-file.
    pub fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.stdin.take()
    }

    /// A copy of what has been captured from `pipe` so far.
    pub fn captured(&self, pipe: Pipe) -> Captured {
        self.drain(pipe).snapshot()
    }

    /// Re-runs `parse` over the captured bytes of `pipe` (the newest [`CAPTURE_LIMIT`] of them)
    /// each time more arrive, until it returns `Some`. Returns `None` if the stream ends first.
    ///
    /// This is how a caller reads output while the child keeps running, such as a pid the child
    /// prints before it starts its real work. Wrap it in a timeout when the child may never print.
    pub async fn wait_for_output<T>(
        &mut self,
        pipe: Pipe,
        mut parse: impl FnMut(&[u8]) -> Option<T>,
    ) -> Option<T> {
        let state = &mut self.drain_mut(pipe).state;
        loop {
            {
                let current = state.borrow_and_update();
                if let Some(found) = parse(current.window()) {
                    return Some(found);
                }
                if current.complete {
                    return None;
                }
            }
            if state.changed().await.is_err() {
                // The drain task is gone (finished or aborted), so its last state is final.
                return parse(state.borrow().window());
            }
        }
    }

    /// Waits for the direct child to exit. Descendants may still be running afterwards; they are
    /// killed by [`HiddenChild::kill_tree`] or when the handle drops.
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        if let Some(status) = self.status {
            return Ok(status);
        }
        let status = self.child.wait().await?;
        self.status = Some(status);
        Ok(status)
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if let Some(status) = self.status {
            return Ok(Some(status));
        }
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.status = status;
        }
        Ok(status)
    }

    /// Kills every process in the tree, then waits for the direct child to exit.
    ///
    /// Windows terminates the Job Object, which reaches every descendant, including ones that
    /// outlived the shell that started them. Unix sends `SIGKILL` to the process group, which
    /// reaches every descendant that did not move itself to another group or session and still
    /// runs as the same user. Calling this after the child exited is fine: it still sweeps up
    /// leftovers and returns the original status.
    pub async fn kill_tree(&mut self) -> io::Result<ExitStatus> {
        self.signal_tree()?;
        self.tree_killed = true;
        self.wait().await
    }

    /// Closes stdin, waits for the direct child to exit, kills whatever it left running in its
    /// tree, and returns the captured output once both pipes reach end-of-file (or after
    /// [`PIPE_EOF_GRACE`] if something outside the tree still holds one open).
    ///
    /// Leftovers are killed here rather than waited for because a background grandchild holds the
    /// pipes open, and it would be killed when the handle drops anyway.
    pub async fn wait_with_output(mut self) -> io::Result<Output> {
        drop(self.stdin.take());
        let status = self.wait().await?;
        // Best effort: whatever cannot be signalled now gets another attempt when the handle drops.
        if self.signal_tree().is_ok() {
            self.tree_killed = true;
        }
        let stdout = self.stdout.finish(PIPE_EOF_GRACE).await;
        let stderr = self.stderr.finish(PIPE_EOF_GRACE).await;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    }

    fn signal_tree(&mut self) -> io::Result<()> {
        match self.child.start_kill() {
            Ok(()) => Ok(()),
            Err(err) if self.tree_already_gone(&err) => Ok(()),
            Err(err) => Err(err),
        }
    }

    /// Unix reports an empty process group as `ESRCH`. macOS also answers `EPERM` when the only
    /// members left are zombies, which happens when the direct child exited and has not been
    /// reaped yet; that is only "gone" once we know the direct child has exited. (`EPERM` also
    /// means every member left runs as another user, such as under `sudo`; nothing can be done
    /// about those either way.)
    #[cfg(unix)]
    fn tree_already_gone(&mut self, err: &io::Error) -> bool {
        use nix::errno::Errno;
        match err.raw_os_error().map(Errno::from_raw) {
            Some(Errno::ESRCH) => true,
            Some(Errno::EPERM) => matches!(self.try_wait(), Ok(Some(_))),
            _ => false,
        }
    }

    /// Terminating a Job Object with no processes left succeeds, so there is nothing to excuse.
    #[cfg(windows)]
    fn tree_already_gone(&mut self, _err: &io::Error) -> bool {
        false
    }

    fn drain(&self, pipe: Pipe) -> &Drain {
        match pipe {
            Pipe::Stdout => &self.stdout,
            Pipe::Stderr => &self.stderr,
        }
    }

    fn drain_mut(&mut self, pipe: Pipe) -> &mut Drain {
        match pipe {
            Pipe::Stdout => &mut self.stdout,
            Pipe::Stderr => &mut self.stderr,
        }
    }
}

impl Drop for HiddenChild {
    fn drop(&mut self) {
        if !self.tree_killed {
            // On Windows the job handle closing just after this kills the tree anyway
            // (KILL_ON_JOB_CLOSE); Unix has no such kernel hook, so signal the group explicitly
            // to give both platforms the same guarantee.
            let _ = self.child.start_kill();
        }
    }
}

/// The capture state one drain task publishes. Lives inside a `watch` channel so readers can both
/// inspect it and await the next change.
#[derive(Debug, Default)]
struct CaptureState {
    buf: Vec<u8>,
    total: u64,
    complete: bool,
}

impl CaptureState {
    fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
        self.total += chunk.len() as u64;
        // Compact lazily, so the front is shifted out once per CAPTURE_LIMIT bytes rather than on
        // every read; a child printing gigabytes stays linear.
        if self.buf.len() > 2 * CAPTURE_LIMIT {
            let excess = self.buf.len() - CAPTURE_LIMIT;
            self.buf.drain(..excess);
        }
    }

    fn window(&self) -> &[u8] {
        &self.buf[self.buf.len().saturating_sub(CAPTURE_LIMIT)..]
    }
}

/// One background task reading a pipe to end-of-file.
#[derive(Debug)]
struct Drain {
    state: watch::Receiver<CaptureState>,
    task: Option<JoinHandle<()>>,
}

impl Drain {
    fn start(runtime: &Handle, pipe: Option<impl AsyncRead + Unpin + Send + 'static>) -> Self {
        let (sender, state) = watch::channel(CaptureState::default());
        let task = match pipe {
            Some(pipe) => Some(runtime.spawn(drain(pipe, sender))),
            None => {
                sender.send_modify(|state| state.complete = true);
                None
            }
        };
        Self { state, task }
    }

    fn snapshot(&self) -> Captured {
        let state = self.state.borrow();
        Captured {
            bytes: state.window().to_vec(),
            total_len: state.total,
            complete: state.complete,
        }
    }

    async fn finish(&mut self, grace: Duration) -> Captured {
        if let Some(mut task) = self.task.take()
            && tokio::time::timeout(grace, &mut task).await.is_err()
        {
            task.abort();
        }
        self.snapshot()
    }
}

impl Drop for Drain {
    fn drop(&mut self) {
        // A process outside the tree may hold the pipe open indefinitely; don't leave the reader
        // running for the rest of the app's life.
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

async fn drain(mut pipe: impl AsyncRead + Unpin, sender: watch::Sender<CaptureState>) {
    let mut chunk = vec![0u8; READ_CHUNK];
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => sender.send_modify(|state| state.push(&chunk[..read])),
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            // A read error ends the stream like end-of-file does: the writer is gone or the pipe
            // is broken, and what was captured so far is still worth keeping.
            Err(_) => break,
        }
    }
    sender.send_modify(|state| state.complete = true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_keeps_the_newest_bytes_and_counts_everything() {
        let mut state = CaptureState::default();
        let chunk = vec![b'a'; CAPTURE_LIMIT];
        state.push(&chunk);
        state.push(&chunk);
        state.push(b"tail");
        assert_eq!(state.total, 2 * CAPTURE_LIMIT as u64 + 4);
        assert_eq!(state.window().len(), CAPTURE_LIMIT);
        assert!(state.window().ends_with(b"tail"));
        // Compaction kept memory bounded at twice the limit.
        assert!(state.buf.len() <= 2 * CAPTURE_LIMIT);
    }

    #[test]
    fn captured_reports_truncation_and_decodes_lossily() {
        let captured = Captured {
            bytes: vec![b'o', b'k', 0xff],
            total_len: 10,
            complete: true,
        };
        assert!(captured.is_truncated());
        assert_eq!(captured.text(), "ok\u{fffd}");
    }
}
