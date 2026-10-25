//! The chat store: one writer thread owns the profile's [`Store`], and every write and read goes
//! through its FIFO, so a read sees every write queued before it.
//!
//! - **FIFO, group commit.** Typed [`Op`]s queue in one FIFO bounded at 1,024 ops and 32 MiB (one
//!   larger op passes alone). The writer drains up to 256 ops or 4 MiB into one `BEGIN IMMEDIATE`
//!   transaction; an op never spans transactions, and a read ends the batch so it sees everything
//!   before it. Session actors reserve room first ([`ChatStore::reserve`]): that is the backpressure
//!   that reaches the agents when saving stalls.
//! - **Disk full.** The failed batch is kept and retried every 5 s while the writer stops taking ops;
//!   reads are served from saved data through a second channel meanwhile, with what is unsaved
//!   marked. Nothing is lost unless auracode quits while paused.
//! - **Busy, poison, damage.** Busy past the timeout retries with backoff, then pauses; any other
//!   error re-runs the batch one op at a time and sends an op that fails again to the dead-letter file;
//!   damage is recorded for the next open's repair and later ops go to the dead-letter file.
//! - **Blobs** are files under `<profile>/attachments/<sha256>`, written before the op whose row
//!   names them.
//! - **Shutdown** commits what is queued within the deadline and closes the connection, which folds
//!   the WAL back so the next launch sees a clean shutdown.
//!
//! The body is package C's; this build keeps the store and the owner lock alive and answers every
//! data call with "not implemented in this build".

mod blobs;
mod compact;
mod history;
mod recover;
mod rows;
mod writer;

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use aura_protocol::session::{BlobText, HistoryPage, StorageStatus};
use aura_protocol::{Autonomy, Millis, StopReason};
use serde::Serialize;
use tokio::runtime::Handle;
use tokio::sync::{oneshot, watch};

use crate::error::CoreError;
use crate::owner::ProfileOwner;
use crate::profile::Profile;
use crate::store::Store;

/// What every data call answers until package C builds the writer.
const NOT_BUILT: &str = "the chat store is not implemented in this build";

/// The profile's chats, owned by one writer thread.
#[derive(Debug)]
pub struct ChatStore {
    db_path: PathBuf,
    held: Mutex<Option<Held>>,
    status: watch::Sender<StorageStatus>,
}

/// What the writer thread owns.
#[derive(Debug)]
struct Held {
    store: Store,
    _owner: ProfileOwner,
}

impl ChatStore {
    /// Moves the opened `Store` and the owner lock into the writer thread; global recovery is its
    /// first op.
    pub fn start(
        store: Store,
        owner: ProfileOwner,
        profile: &Profile,
        _device_id: String,
        _rt: Handle,
    ) -> Result<Arc<ChatStore>, CoreError> {
        Ok(Arc::new(ChatStore {
            db_path: profile.db_path(),
            held: Mutex::new(Some(Held {
                store,
                _owner: owner,
            })),
            status: watch::Sender::new(StorageStatus::default()),
        }))
    }

    /// Whether saving runs, is paused (with how much is unsaved), or failed.
    pub fn status(&self) -> watch::Receiver<StorageStatus> {
        self.status.subscribe()
    }

    pub fn is_paused(&self) -> bool {
        false
    }

    /// What startup recovery did, once it finished.
    pub async fn recovered(&self) -> RecoveryReport {
        RecoveryReport::default()
    }

    /// The backpressure point for actors: room for one op of about `bytes` in the FIFO.
    pub async fn reserve(&self, _bytes: usize) -> Result<OpPermit, StoreClosed> {
        Err(StoreClosed)
    }

    pub async fn create_chat(&self, _new: NewChat) -> Result<ChatRecord, StoreError> {
        Err(not_built())
    }

    pub async fn chats(&self) -> Result<Vec<ChatRecord>, StoreError> {
        Err(not_built())
    }

    /// Per-chat recovery of turns left `running` (an actor that died), then everything an actor
    /// needs.
    pub async fn load_chat(&self, _chat_id: &str) -> Result<ChatLoad, StoreError> {
        Err(not_built())
    }

    /// One page of a blob's text, ending on a character boundary.
    pub async fn read_blob(
        &self,
        _sha256: &str,
        _offset: u64,
        _len: u32,
    ) -> Result<BlobText, StoreError> {
        Err(not_built())
    }

    /// While paused: the page from saved rows only, with `unsaved_from` set.
    pub async fn read_saved_page(
        &self,
        _chat_id: &str,
        _before_seq: u32,
        _max_bytes: usize,
    ) -> Result<HistoryPage, StoreError> {
        Err(not_built())
    }

    /// Dismisses the database repair notice (see [`Store::acknowledge_recovery`]).
    pub async fn acknowledge_recovery(&self, quarantined: String) -> Result<bool, CoreError> {
        match lock(&self.held).as_ref() {
            Some(held) => held.store.acknowledge_recovery(&quarantined),
            None => Err(CoreError::Io {
                path: self.db_path.clone(),
                source: io::Error::other("auracode's database is closed"),
            }),
        }
    }

    /// Commits what is queued, then closes the connection. Returns whether everything was saved
    /// within `deadline`.
    pub async fn shutdown(&self, deadline: Duration) -> bool {
        self.shutdown_blocking(deadline)
    }

    /// The same from any thread, with or without a runtime (`RunEvent::Exit`); never panics.
    pub fn shutdown_blocking(&self, _deadline: Duration) -> bool {
        drop(lock(&self.held).take());
        true
    }
}

fn not_built() -> StoreError {
    StoreError::Other(NOT_BUILT.into())
}

/// Room for one op in the FIFO.
#[derive(Debug)]
pub struct OpPermit {
    _private: (),
}

impl OpPermit {
    pub fn send(self, op: Op) {
        drop(op);
    }
}

/// One unit of work for the writer thread. An op is atomic: it never spans transactions.
#[derive(Debug)]
pub enum Op {
    InsertAgentSession(AgentSessionRow),
    UpdateAgentSession {
        id: String,
        patch: AgentSessionPatch,
    },
    /// Inserts the turn, appends `rows` (TurnStarted, the user's text, ...) and deletes the queued
    /// prompt `turn.prompt_id`, in one transaction: a crash keeps either the queued prompt or the
    /// started turn.
    BeginTurn {
        turn: TurnRow,
        rows: Vec<EventRow>,
    },
    AppendEvents {
        chat_id: String,
        rows: Vec<EventRow>,
    },
    EndTurn(TurnEnd),
    CompactTurn {
        chat_id: String,
        turn_id: String,
    },
    PutBlob {
        sha256: String,
        mime: String,
        bytes: Arc<[u8]>,
    },
    SetTitle {
        chat_id: String,
        title: String,
        source: TitleSource,
    },
    TouchChat {
        chat_id: String,
        at: Millis,
    },
    QueuePut(QueuedRow),
    QueueRemove {
        id: String,
    },
    QueueHoldAll {
        chat_id: String,
    },
    QueueReleaseAll {
        chat_id: String,
    },
    /// History read through the actor's outbox, so a page follows every write the actor queued
    /// before it. The latest page is `before_seq = next_seq`.
    ReadPage {
        chat_id: String,
        before_seq: u32,
        max_bytes: usize,
        reply: oneshot::Sender<Result<HistoryPage, StoreError>>,
    },
    Barrier(oneshot::Sender<()>),
}

/// A chat to create in a folder on this device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewChat {
    pub agent_id: String,
    pub folder: PathBuf,
    pub device_id: String,
    pub now: Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatRecord {
    pub id: String,
    pub title: Option<String>,
    pub title_source: Option<TitleSource>,
    pub agent_id: String,
    pub folder: PathBuf,
    pub created_at: Millis,
    pub updated_at: Millis,
}

/// Everything a chat actor starts from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatLoad {
    pub chat: ChatRecord,
    pub next_seq: u32,
    pub next_turn_ordinal: u32,
    pub agent_session: Option<AgentSessionRow>,
    pub queue: Vec<QueuedRow>,
    pub recovered_turns: u32,
    pub replay_check: Option<ReplayCheck>,
}

/// For the Hermes replay comparison: the latest agent session's turn count and its newest reply's
/// hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReplayCheck {
    pub native_session_id: String,
    pub turns: u32,
    pub last_reply_sha256: Option<String>,
}

/// An `agent_sessions` row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentSessionRow {
    pub id: String,
    pub chat_id: String,
    pub agent_id: String,
    pub native_session_id: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub autonomy: Autonomy,
    /// The user's explicit option choices, JSON `{option_id: ConfigValue}`.
    pub config_json: Option<String>,
    pub cwd: PathBuf,
    pub created_at: Millis,
    pub updated_at: Millis,
}

/// The fields of an [`AgentSessionRow`] to change; `None` keeps a field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentSessionPatch {
    pub native_session_id: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub autonomy: Option<Autonomy>,
    pub config_json: Option<String>,
    pub updated_at: Millis,
}

/// A `turns` row as it starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TurnRow {
    pub id: String,
    pub chat_id: String,
    pub agent_session_id: Option<String>,
    /// v1's `turns.seq`: 1-based per chat, unique.
    pub ordinal: u32,
    pub prompt_id: String,
    pub first_event_seq: u32,
    pub started_at: Millis,
}

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TurnEnd {
    pub turn_id: String,
    pub status: TurnStatus,
    pub stop_reason: StopReason,
    pub ended_at: Millis,
    pub last_event_seq: u32,
}

/// `turns.status`, v1's CHECK: `EndTurn`, `MaxTokens`, `MaxTurnRequests`, `Refusal`, `Cancelled`
/// and `Other` complete a turn; `Interrupted` interrupts it; `Error` fails it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Running,
    Completed,
    Interrupted,
    Failed,
}

/// One stored event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EventRow {
    pub seq: u32,
    pub turn_id: Option<String>,
    /// [`aura_protocol::AuraEvent::kind`].
    pub kind: &'static str,
    /// The event's JSON.
    pub payload: String,
    pub created_at: Millis,
}

/// A `queued_prompts` row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueuedRow {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    /// Queued before a stop, error, crash or restart: sent only after the user says so.
    pub held: bool,
    pub created_at: Millis,
}

/// `chats.title_source`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleSource {
    FirstLine,
    Agent,
}

/// What recovery did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct RecoveryReport {
    pub interrupted_turns: u32,
    pub resolved_requests: u32,
    pub compacted_turns: u32,
}

/// Why a chat store call failed. Every message is a sentence the UI can show.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    #[error("The disk is full, so auracode paused saving. Free some space, then try again.")]
    DiskFull,
    #[error("The database is busy.")]
    Busy,
    #[error("auracode's database is closed.")]
    Closed,
    #[error("auracode's database is damaged: {0}")]
    Damaged(String),
    /// A blob that is not available, and the sentence that says why: "The full output is no longer
    /// available." for a file that is gone, "The full output isn't saved yet because the disk is
    /// full." for one still waiting in the failed batch or the FIFO. The session manager passes the
    /// sentence on as `SessionError::BlobMissing`.
    #[error("{0}")]
    BlobMissing(String),
    #[error("{0}")]
    Other(String),
}

/// The writer thread is gone: nothing more will be saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("auracode's database is closed.")]
pub struct StoreClosed;

/// Locks `mutex`, recovering the data of a thread that panicked while holding it.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::DataRoot;
    use crate::profile::Profiles;

    #[tokio::test]
    async fn the_skeleton_keeps_the_store_and_the_owner_until_shutdown() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = Profiles::new(DataRoot::at(dir.path().join("data")))
            .open_active()
            .expect("profile");
        let owner = ProfileOwner::acquire(&profile).expect("owner");
        let (store, _) = Store::open(&profile).expect("store");
        let chats = ChatStore::start(store, owner, &profile, "device".into(), Handle::current())
            .expect("start");
        assert_eq!(*chats.status().borrow(), StorageStatus::default());
        assert!(!chats.is_paused());
        assert!(matches!(
            ProfileOwner::acquire(&profile),
            Err(CoreError::ProfileInUse { .. })
        ));
        assert!(matches!(chats.chats().await, Err(StoreError::Other(_))));
        assert!(matches!(chats.reserve(10).await, Err(StoreClosed)));
        assert_eq!(
            chats.acknowledge_recovery("/nothing".into()).await.ok(),
            Some(false)
        );
        assert!(chats.shutdown(Duration::from_secs(5)).await);
        assert!(chats.acknowledge_recovery("/nothing".into()).await.is_err());
        ProfileOwner::acquire(&profile).expect("the owner lock went with the store");
    }

    #[test]
    fn store_errors_read_as_sentences() {
        assert_eq!(
            StoreError::DiskFull.to_string(),
            "The disk is full, so auracode paused saving. Free some space, then try again."
        );
        assert_eq!(
            StoreError::BlobMissing(
                "The full output isn't saved yet because the disk is full.".into()
            )
            .to_string(),
            "The full output isn't saved yet because the disk is full."
        );
        assert_eq!(
            serde_json::to_value(TurnStatus::Interrupted).expect("serialize"),
            serde_json::json!("interrupted")
        );
        assert_eq!(
            serde_json::to_value(TitleSource::FirstLine).expect("serialize"),
            serde_json::json!("first_line")
        );
    }
}
