//! Protocol logs: one JSON Lines file per agent process, for diagnostics and replay fixtures.
//!
//! `<profile>/logs/protocol/<chat_id>/<spawn_id>.jsonl` (`spawn_id` is a UUIDv7, so names sort by
//! time), rotated to `.1.jsonl` and `.2.jsonl`. Records, in the order they happened:
//!
//! ```text
//! {"t":1792840001230,"d":"note","note":{"spawn":{"label":"hermes acp","program":"<abs path>","args":["acp"],"cwd":"...","removed":["CLAUDECODE"],"set":[],"pid":5001}}}
//! {"t":1792840001240,"d":"out","msg":{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}}
//! {"t":1792840001900,"d":"in","msg":{"jsonrpc":"2.0","id":1,"result":{...}}}
//! {"t":1792840002001,"d":"err","line":"INFO gateway ready"}
//! {"t":1792840003000,"d":"cmd","cmd":{"type":"prompt","turn_id":"019a...","parts":[...]}}
//! {"t":1792840003500,"d":"in","raw":"Debugger listening on ..."}
//! {"t":1792840010000,"d":"note","note":{"exit":{"code":0,"signal":null}}}
//! ```
//!
//! `d` is `out` (to the agent), `in` (from it; `msg` for JSON, `raw` for other text), `err`, `cmd`
//! (a driver command, in processing order), or `note`; `t` is for humans, replay uses line order.
//! Writing never blocks the protocol path: records queue to a writer task, which redacts them
//! ([`Redactor`]) before any byte reaches disk; a full queue drops and counts, and an I/O error
//! stops logging for that spawn with one warning. The env is never logged.

mod redact;
mod retention;
mod writer;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;

pub use redact::Redactor;

/// Size limits of one spawn's log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogLimits {
    /// A longer record keeps its first half and says how much was cut.
    pub max_record_bytes: usize,
    /// A file this large is rotated.
    pub max_file_bytes: u64,
    /// Files kept per spawn, the current one included.
    pub max_files: u32,
    /// Records waiting for the writer; more are dropped and counted.
    pub queue: usize,
}

impl LogLimits {
    /// 256 KiB records, 8 MiB files, 3 files, 4,096 queued records.
    pub const STANDARD: LogLimits = LogLimits {
        max_record_bytes: 256 * 1024,
        max_file_bytes: 8 * 1024 * 1024,
        max_files: 3,
        queue: 4096,
    };
}

/// What retention keeps across a profile's protocol logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub max_total_bytes: u64,
    pub max_age: Duration,
}

impl RetentionPolicy {
    /// 256 MiB in all, 14 days.
    pub const STANDARD: RetentionPolicy = RetentionPolicy {
        max_total_bytes: 256 * 1024 * 1024,
        max_age: Duration::from_secs(14 * 24 * 60 * 60),
    };
}

/// What [`LogFactory::prune`] removed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RetentionReport {
    pub files_removed: u32,
    pub bytes_removed: u64,
    pub errors: Vec<String>,
}

/// Opens protocol logs under one root (`<profile>/logs/protocol`).
#[derive(Debug, Clone)]
pub struct LogFactory {
    root: PathBuf,
    #[expect(dead_code, reason = "the writer task (package A) redacts with it")]
    redactor: Arc<Redactor>,
    #[expect(dead_code, reason = "the writer task (package A) enforces them")]
    limits: LogLimits,
    #[expect(dead_code, reason = "the writer task (package A) runs here")]
    rt: Handle,
}

impl LogFactory {
    /// `root` is `<profile>/logs/protocol`; writer tasks run on `rt`.
    pub fn new(root: PathBuf, redactor: Arc<Redactor>, rt: Handle) -> LogFactory {
        LogFactory {
            root,
            redactor,
            limits: LogLimits::STANDARD,
            rt,
        }
    }

    /// The log of one spawn. Never fails: on an I/O error the log is disabled (with one warning)
    /// and the spawn goes ahead.
    pub fn open(&self, _chat_id: &str, spawn_id: &str) -> ProtocolLog {
        ProtocolLog::disabled_with_id(spawn_id.to_owned())
    }

    /// `<root>/<chat_id>`, the folder "Show log" reveals.
    pub fn chat_dir(&self, chat_id: &str) -> PathBuf {
        self.root.join(chat_id)
    }

    /// Deletes logs older than the policy's age, then the oldest files until the total fits.
    pub async fn prune(&self, _policy: RetentionPolicy) -> RetentionReport {
        RetentionReport::default()
    }
}

/// One spawn's log. Cloning shares it; every method is non-blocking.
#[derive(Clone)]
pub struct ProtocolLog {
    inner: Arc<LogInner>,
}

struct LogInner {
    spawn_id: String,
}

impl ProtocolLog {
    /// A log that writes nothing, carrying a fresh UUIDv7 spawn id.
    pub fn disabled() -> ProtocolLog {
        ProtocolLog::disabled_with_id(uuid::Uuid::now_v7().hyphenated().to_string())
    }

    /// A log that writes nothing, carrying `spawn_id`: a replay spawns with the recorded id, so the
    /// ids a driver mints outside a turn match the golden events.
    pub fn disabled_with_id(spawn_id: impl Into<String>) -> ProtocolLog {
        ProtocolLog {
            inner: Arc::new(LogInner {
                spawn_id: spawn_id.into(),
            }),
        }
    }

    /// Copied into [`SpawnedProcess::spawn_id`](crate::spawn::SpawnedProcess::spawn_id).
    pub fn spawn_id(&self) -> &str {
        &self.inner.spawn_id
    }

    /// One line through a pipe. Non-blocking: drops and counts when the queue is full.
    pub fn line(&self, _direction: Direction, _line: &str) {}

    /// A driver command, as a `cmd` record (see `LoggedCommand` in aura-drivers).
    pub fn command(&self, _command: serde_json::Value) {}

    pub fn note(&self, _note: LogNote) {}

    /// The current file, when logging is on.
    pub fn path(&self) -> Option<PathBuf> {
        None
    }
}

impl std::fmt::Debug for ProtocolLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProtocolLog")
            .field("spawn_id", &self.inner.spawn_id)
            .field("path", &self.path())
            .finish()
    }
}

/// Which way a line went: the `d` of its record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// To the agent's stdin.
    Out,
    /// From its stdout.
    In,
    /// From its stderr.
    Err,
}

/// A `note` record: `{"note":{"<kind>":...}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogNote {
    /// Names only: `removed` are the scrubbed variables, `set` the spawn's own.
    Spawn {
        label: String,
        program: String,
        args: Vec<String>,
        cwd: String,
        removed: Vec<String>,
        set: Vec<String>,
        pid: u32,
    },
    /// The driver's session setup, secrets excluded (no env), written right after the spawn note.
    Start(serde_json::Value),
    Exit {
        code: Option<i32>,
        signal: Option<i32>,
    },
    Oversized {
        bytes: u64,
        method: Option<String>,
    },
    /// A stdout line that was not JSON, dropped.
    Noise {
        bytes: usize,
    },
    Shutdown {
        steps: Vec<String>,
        took_ms: u64,
    },
    Text(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_serialize_as_the_record_format_says() {
        let spawn = LogNote::Spawn {
            label: "hermes acp".into(),
            program: "/usr/local/bin/hermes".into(),
            args: vec!["acp".into()],
            cwd: "/work".into(),
            removed: vec!["CLAUDECODE".into()],
            set: Vec::new(),
            pid: 5001,
        };
        assert_eq!(
            serde_json::to_value(&spawn).expect("serialize"),
            serde_json::json!({"spawn": {"label": "hermes acp", "program": "/usr/local/bin/hermes",
                "args": ["acp"], "cwd": "/work", "removed": ["CLAUDECODE"], "set": [], "pid": 5001}})
        );
        assert_eq!(
            serde_json::to_value(LogNote::Exit {
                code: Some(0),
                signal: None
            })
            .expect("serialize"),
            serde_json::json!({"exit": {"code": 0, "signal": null}})
        );
        assert_eq!(
            serde_json::to_value(LogNote::Oversized {
                bytes: 71_303_168,
                method: Some("session/update".into())
            })
            .expect("serialize"),
            serde_json::json!({"oversized": {"bytes": 71303168, "method": "session/update"}})
        );
        assert_eq!(
            serde_json::to_value(Direction::Err).expect("serialize"),
            serde_json::json!("err")
        );
    }

    #[test]
    fn a_disabled_log_has_a_v7_spawn_id_and_no_file() {
        let log = ProtocolLog::disabled();
        let id = uuid::Uuid::parse_str(log.spawn_id()).expect("uuid");
        assert_eq!(id.get_version_num(), 7);
        assert_ne!(log.spawn_id(), ProtocolLog::disabled().spawn_id());
        log.line(Direction::In, "{}");
        log.note(LogNote::Text("x".into()));
        log.command(serde_json::json!({"type": "interrupt"}));
        assert_eq!(log.path(), None);
    }

    #[test]
    fn a_disabled_log_can_carry_a_given_spawn_id() {
        let log = ProtocolLog::disabled_with_id("019a0000-0000-7000-8000-00000000abcd");
        assert_eq!(log.spawn_id(), "019a0000-0000-7000-8000-00000000abcd");
        assert_eq!(log.clone().spawn_id(), log.spawn_id());
        assert_eq!(log.path(), None);
    }

    #[tokio::test]
    async fn the_factory_keeps_the_spawn_id_it_is_given() {
        let factory = LogFactory::new(
            PathBuf::from("/profile/logs/protocol"),
            Arc::new(Redactor::standard()),
            Handle::current(),
        );
        let log = factory.open("chat-1", "019a0000-0000-7000-8000-000000000001");
        assert_eq!(log.spawn_id(), "019a0000-0000-7000-8000-000000000001");
        assert_eq!(
            factory.chat_dir("chat-1"),
            PathBuf::from("/profile/logs/protocol/chat-1")
        );
        assert_eq!(
            factory.prune(RetentionPolicy::STANDARD).await,
            RetentionReport::default()
        );
    }
}
