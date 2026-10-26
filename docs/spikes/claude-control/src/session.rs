//! One spawned `claude` process and its three pipes.
//!
//! stdout and stderr are drained by their own tasks from the moment the process starts, so a
//! chatty child can never stall on a full pipe while the experiment is writing or waiting.
//! Everything that crosses a pipe is kept, in order and timestamped, for fixtures and debugging.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::Res;
use crate::framing::{Frame, LineFramer};
use crate::protocol::{self, Parsed};

/// Largest stdout or stderr line kept. Image tool results are base64 inside one JSON line.
const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;
const READ_CHUNK: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Stdin,
    Stdout,
    Stderr,
    /// Something the spike did that isn't a pipe write (closing stdin, a dropped line).
    Note,
}

impl Stream {
    pub fn label(self) -> &'static str {
        match self {
            Self::Stdin => "stdin",
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Note => "note",
        }
    }
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub t_ms: u64,
    pub stream: Stream,
    pub text: String,
}

/// A message written to stdin, positioned against stdout so a replay knows when it was sent.
#[derive(Debug, Clone)]
pub struct SentEntry {
    pub after_stdout_line: usize,
    pub t_ms: u64,
    pub message: Value,
}

pub struct SpawnSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// The child's complete environment; nothing is inherited implicitly.
    pub env: Vec<(OsString, OsString)>,
}

pub enum Recv {
    Message(Value),
    Timeout,
    /// stdout reached end of file: no further message can arrive.
    Closed,
}

pub struct ExitInfo {
    pub status: Option<ExitStatus>,
    /// A pipe still open after the deadline means some other process inherited it.
    pub pipes_open: bool,
}

enum PipeEvent {
    Frame(Frame),
    Eof,
    Failed(String),
}

enum Step {
    Exited(std::io::Result<ExitStatus>),
    Event(Option<(Instant, Stream, PipeEvent)>),
    Deadline,
}

pub struct Session {
    child: Child,
    pid: u32,
    stdin: Option<ChildStdin>,
    events: mpsc::UnboundedReceiver<(Instant, Stream, PipeEvent)>,
    started: Instant,
    stdout_open: bool,
    stderr_open: bool,
    exit: Option<ExitStatus>,
    next_request: u32,
    /// Where the unredacted log goes when the session is dropped, whatever happened before.
    raw_log: Option<PathBuf>,
    pub log: Vec<LogEntry>,
    pub sent: Vec<SentEntry>,
    pub stdout_lines: Vec<String>,
    pub stderr_lines: Vec<String>,
    pub corrupt_lines: usize,
}

impl Session {
    pub fn spawn(spec: &SpawnSpec, raw_log: Option<PathBuf>) -> Res<Self> {
        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args)
            .current_dir(&spec.cwd)
            .env_clear()
            .envs(spec.env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // A process group of its own, so every helper that doesn't detach can be found, and
        // signalled, as one unit.
        #[cfg(unix)]
        cmd.process_group(0);
        let mut child = cmd.spawn().map_err(|e| format!("spawning {}: {e}", spec.program.display()))?;
        let started = Instant::now();
        let pid = child.id().ok_or("the child exited before reporting a pid")?;
        let stdout = child.stdout.take().ok_or("stdout was not piped")?;
        let stderr = child.stderr.take().ok_or("stderr was not piped")?;
        let stdin = child.stdin.take();
        let (tx, events) = mpsc::unbounded_channel();
        tokio::spawn(pump(stdout, Stream::Stdout, tx.clone()));
        tokio::spawn(pump(stderr, Stream::Stderr, tx));
        Ok(Self {
            child,
            pid,
            stdin,
            events,
            started,
            stdout_open: true,
            stderr_open: true,
            exit: None,
            next_request: 0,
            raw_log,
            log: Vec::new(),
            sent: Vec::new(),
            stdout_lines: Vec::new(),
            stderr_lines: Vec::new(),
            corrupt_lines: 0,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.ms_at(Instant::now())
    }

    fn ms_at(&self, at: Instant) -> u64 {
        u64::try_from(at.saturating_duration_since(self.started).as_millis()).unwrap_or(u64::MAX)
    }

    fn note(&mut self, text: String) {
        let t_ms = self.elapsed_ms();
        self.log.push(LogEntry { t_ms, stream: Stream::Note, text });
    }

    /// Writes one JSON message as one line.
    pub async fn send(&mut self, message: &Value) -> Res<()> {
        let stdin = self.stdin.as_mut().ok_or("stdin is already closed")?;
        let mut line = serde_json::to_string(message)?;
        line.push('\n');
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        let t_ms = self.elapsed_ms();
        line.pop();
        self.log.push(LogEntry { t_ms, stream: Stream::Stdin, text: line });
        self.sent.push(SentEntry { after_stdout_line: self.stdout_lines.len(), t_ms, message: message.clone() });
        Ok(())
    }

    /// Sends a control request with a fresh id and returns that id.
    pub async fn control(&mut self, request: Value) -> Res<String> {
        self.next_request += 1;
        let request_id = format!("req_{}_spike", self.next_request);
        self.send(&protocol::control_request(&request_id, request)).await?;
        Ok(request_id)
    }

    /// The next JSON message on stdout. stderr lines and non-JSON stdout lines are logged on the
    /// way and skipped.
    pub async fn recv(&mut self, timeout: Duration) -> Recv {
        let deadline = Instant::now() + timeout;
        loop {
            if !self.stdout_open {
                return Recv::Closed;
            }
            match tokio::time::timeout_at(deadline, self.events.recv()).await {
                Err(_) => return Recv::Timeout,
                Ok(None) => {
                    self.stdout_open = false;
                    self.stderr_open = false;
                    return Recv::Closed;
                }
                Ok(Some((at, stream, event))) => {
                    if let Some(message) = self.absorb(at, stream, event) {
                        return Recv::Message(message);
                    }
                }
            }
        }
    }

    /// Every message that arrives within `window`.
    pub async fn drain(&mut self, window: Duration) -> Vec<Value> {
        let deadline = Instant::now() + window;
        let mut got = Vec::new();
        loop {
            match self.recv(deadline.saturating_duration_since(Instant::now())).await {
                Recv::Message(message) => got.push(message),
                Recv::Timeout | Recv::Closed => return got,
            }
        }
    }

    /// Records one pipe event and returns the parsed message when it was a JSON stdout line.
    fn absorb(&mut self, at: Instant, stream: Stream, event: PipeEvent) -> Option<Value> {
        let t_ms = self.ms_at(at);
        match event {
            PipeEvent::Eof => {
                match stream {
                    Stream::Stdout => self.stdout_open = false,
                    Stream::Stderr => self.stderr_open = false,
                    Stream::Stdin | Stream::Note => {}
                }
                None
            }
            PipeEvent::Failed(error) => {
                self.note(format!("{} read failed: {error}", stream.label()));
                None
            }
            PipeEvent::Frame(Frame::Oversized { bytes }) => {
                self.note(format!("{} line of {bytes} bytes dropped as oversized", stream.label()));
                None
            }
            PipeEvent::Frame(Frame::Line(text)) => {
                self.log.push(LogEntry { t_ms, stream, text: text.clone() });
                match stream {
                    Stream::Stdout => {
                        self.stdout_lines.push(text.clone());
                        match protocol::parse_line(&text) {
                            Parsed::Json(message) => return Some(message),
                            Parsed::Corrupt => self.corrupt_lines += 1,
                            Parsed::NotJson => {}
                        }
                    }
                    Stream::Stderr => self.stderr_lines.push(text),
                    Stream::Stdin | Stream::Note => {}
                }
                None
            }
        }
    }

    /// Closing stdin is the protocol's "no more input": the CLI finishes and exits on its own.
    pub fn close_stdin(&mut self) {
        if self.stdin.take().is_some() {
            self.note("stdin closed".to_owned());
        }
    }

    /// Waits for exit and for both pipes to reach end of file, draining output the whole time;
    /// a child blocked on a full pipe would otherwise never exit.
    pub async fn wait_exit(&mut self, timeout: Duration) -> Res<ExitInfo> {
        let deadline = Instant::now() + timeout;
        loop {
            let pipes_open = self.stdout_open || self.stderr_open;
            if self.exit.is_some() && !pipes_open {
                return Ok(ExitInfo { status: self.exit, pipes_open });
            }
            let step = tokio::select! {
                status = self.child.wait(), if self.exit.is_none() => Step::Exited(status),
                event = self.events.recv(), if pipes_open => Step::Event(event),
                () = tokio::time::sleep_until(deadline) => Step::Deadline,
            };
            match step {
                Step::Exited(status) => self.exit = Some(status?),
                Step::Event(Some((at, stream, event))) => {
                    // Messages after stdin closed are still logged; nothing waits on them here.
                    let _late = self.absorb(at, stream, event);
                }
                Step::Event(None) => {
                    self.stdout_open = false;
                    self.stderr_open = false;
                }
                Step::Deadline => return Ok(ExitInfo { status: self.exit, pipes_open }),
            }
        }
    }

    /// SIGTERM, then SIGKILL: the plan's escalation once a protocol shutdown has failed.
    pub async fn terminate(&mut self) -> Res<ExitInfo> {
        if self.exit.is_none() {
            self.note("sending SIGTERM".to_owned());
            let _signalled = Command::new("kill").args(["-TERM", &self.pid.to_string()]).status().await;
            let info = self.wait_exit(Duration::from_secs(5)).await?;
            if info.status.is_some() {
                return Ok(info);
            }
            self.note("sending SIGKILL".to_owned());
            self.child.start_kill()?;
        }
        self.wait_exit(Duration::from_secs(5)).await
    }

    pub fn stderr_tail(&self, lines: usize) -> Vec<String> {
        let skip = self.stderr_lines.len().saturating_sub(lines);
        self.stderr_lines[skip..].to_vec()
    }
}

impl Drop for Session {
    /// Saves the full log even when an experiment bails out half way, since the prompts it spent
    /// can't be spent again. The child itself is killed by `kill_on_drop` if still running.
    fn drop(&mut self) {
        let Some(path) = self.raw_log.take() else { return };
        let mut out = String::new();
        for entry in &self.log {
            let line = serde_json::json!({"t_ms": entry.t_ms, "stream": entry.stream.label(), "text": entry.text});
            out.push_str(&line.to_string());
            out.push('\n');
        }
        let _ignored = std::fs::write(path, out);
    }
}

/// Reads one pipe to end of file, forwarding complete lines as they form.
async fn pump<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: Stream,
    tx: mpsc::UnboundedSender<(Instant, Stream, PipeEvent)>,
) {
    let mut framer = LineFramer::new(MAX_LINE_BYTES);
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        let read = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(e) => {
                let _closed = tx.send((Instant::now(), stream, PipeEvent::Failed(e.to_string())));
                break;
            }
        };
        for frame in framer.push(&buf[..read]) {
            if tx.send((Instant::now(), stream, PipeEvent::Frame(frame))).is_err() {
                return;
            }
        }
    }
    if let Some(frame) = framer.finish() {
        let _closed = tx.send((Instant::now(), stream, PipeEvent::Frame(frame)));
    }
    let _closed = tx.send((Instant::now(), stream, PipeEvent::Eof));
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// A shell stands in for `claude`: these tests are about the pipes, not the protocol.
    fn shell(script: &str) -> SpawnSpec {
        SpawnSpec {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".to_owned(), script.to_owned()],
            cwd: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            env: std::env::vars_os().collect(),
        }
    }

    #[tokio::test]
    async fn a_flooded_stderr_never_blocks_stdout() {
        // 2 MB on stderr is far past a pipe buffer: if stderr weren't drained, the child would block
        // before ever printing its stdout line.
        let mut s =
            Session::spawn(&shell("head -c 2000000 /dev/zero | tr '\\0' e >&2; echo '{\"type\":\"done\"}'"), None)
                .expect("spawn");
        match s.recv(Duration::from_secs(20)).await {
            Recv::Message(message) => assert_eq!(message["type"], "done"),
            Recv::Timeout | Recv::Closed => panic!("stdout never arrived"),
        }
        let info = s.wait_exit(Duration::from_secs(20)).await.expect("wait");
        assert_eq!(info.status.and_then(|status| status.code()), Some(0));
        assert_eq!(s.stderr_lines.iter().map(String::len).sum::<usize>(), 2_000_000);
    }

    #[tokio::test]
    async fn sends_are_logged_against_the_stdout_position() {
        let mut s =
            Session::spawn(&shell("echo '{\"type\":\"first\"}'; read line; echo \"$line\""), None).expect("spawn");
        assert!(matches!(s.recv(Duration::from_secs(10)).await, Recv::Message(_)));
        s.send(&serde_json::json!({"type": "echo"})).await.expect("send");
        match s.recv(Duration::from_secs(10)).await {
            Recv::Message(message) => assert_eq!(message["type"], "echo"),
            Recv::Timeout | Recv::Closed => panic!("no echo"),
        }
        assert_eq!(s.sent.len(), 1);
        assert_eq!(s.sent[0].after_stdout_line, 1);
        assert_eq!(s.stdout_lines.len(), 2);
    }

    #[tokio::test]
    async fn terminate_stops_a_child_that_ignores_stdin_closing() {
        let mut s = Session::spawn(&shell("exec sleep 30"), None).expect("spawn");
        s.close_stdin();
        let info = s.wait_exit(Duration::from_millis(300)).await.expect("wait");
        assert!(info.status.is_none(), "sleep should outlive stdin closing");
        let info = s.terminate().await.expect("terminate");
        let signal = info.status.and_then(|status| std::os::unix::process::ExitStatusExt::signal(&status));
        assert_eq!(signal, Some(15), "SIGTERM should have been enough");
    }
}
