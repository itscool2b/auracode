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
//! In normal operation every call goes through the FIFO; one that gets no answer within 5 s fails
//! with [`StoreError::Busy`] ([`StoreError::DiskFull`] while a full disk pauses saving). While
//! saving is paused, `chats`, `read_blob`, `read_saved_page` and `load_chat` (for a chat with nothing
//! unsaved and no running turn) are served from saved data at once.

pub(crate) mod blobs;
pub(crate) mod compact;
pub(crate) mod history;
mod recover;
pub(crate) mod rows;
#[cfg(test)]
pub(crate) mod test_support;
mod writer;

use std::fmt;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aura_protocol::session::{BlobText, HistoryPage, PauseReason, StorageStatus};
use aura_protocol::{Autonomy, Millis, StopReason};
use serde::Serialize;
use tokio::runtime::Handle;
use tokio::sync::{oneshot, watch};

use crate::error::CoreError;
use crate::owner::ProfileOwner;
use crate::profile::Profile;
use crate::store::Store;

use writer::{Permits, Request, Shared, Work, Writer};
#[cfg(test)]
pub(crate) use writer::{SavedRead, TestWork};
pub(crate) use writer::{WaitError, WriterConfig, await_reply, op_bytes};

/// A call that gets no answer within this fails.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// A shutdown reports success only if the writer also closed the connection within this much more.
const CLOSE_MARGIN: Duration = Duration::from_secs(2);

/// Dropping the store without a shutdown still commits what is queued, within this.
const DROP_DEADLINE: Duration = Duration::from_secs(5);

/// The profile's chats, owned by one writer thread.
pub struct ChatStore {
    shared: Arc<Shared>,
    rt: Handle,
    db_path: PathBuf,
    recovered: watch::Receiver<Option<RecoveryReport>>,
}

impl fmt::Debug for ChatStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChatStore")
            .field("db_path", &self.db_path)
            .field("status", &*self.shared.status.borrow())
            .finish_non_exhaustive()
    }
}

impl ChatStore {
    /// Moves the opened `Store` and the owner lock into the writer thread; global recovery is its
    /// first op.
    pub fn start(
        store: Store,
        owner: ProfileOwner,
        profile: &Profile,
        device_id: String,
        rt: Handle,
    ) -> Result<Arc<ChatStore>, CoreError> {
        ChatStore::start_with(store, owner, profile, device_id, rt, WriterConfig::STANDARD)
    }

    /// [`start`](Self::start) with other limits and timers (tests).
    pub(crate) fn start_with(
        store: Store,
        owner: ProfileOwner,
        profile: &Profile,
        device_id: String,
        rt: Handle,
        config: WriterConfig,
    ) -> Result<Arc<ChatStore>, CoreError> {
        let shared = Arc::new(Shared::new(config));
        let (recovered, recovered_rx) = watch::channel(None);
        let writer = Writer::new(
            Arc::clone(&shared),
            store,
            owner,
            device_id,
            profile.attachments_dir(),
            profile.backups_dir(),
            recovered,
        );
        let finished = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("aura-chat-writer".into())
            .spawn(move || {
                // Every op runs under its own unwind guard; this one only keeps a panic elsewhere in
                // the writer from leaving callers waiting on a thread that is gone.
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| writer.run())).is_err()
                {
                    tracing::error!("the chat store's writer thread panicked; saving stopped");
                    finished.abandon();
                }
            })
            .map_err(CoreError::io(profile.db_path()))?;
        Ok(Arc::new(ChatStore {
            shared,
            rt,
            db_path: profile.db_path(),
            recovered: recovered_rx,
        }))
    }

    /// Whether saving runs, is paused (with how much is unsaved), or failed.
    pub fn status(&self) -> watch::Receiver<StorageStatus> {
        self.shared.status.subscribe()
    }

    pub fn is_paused(&self) -> bool {
        self.shared.is_paused()
    }

    /// What startup recovery did, once it finished.
    pub async fn recovered(&self) -> RecoveryReport {
        let mut recovered = self.recovered.clone();
        match recovered.wait_for(Option::is_some).await {
            Ok(report) => report.clone().unwrap_or_default(),
            Err(_) => RecoveryReport::default(),
        }
    }

    /// The backpressure point for actors: room for one op of about `bytes` in the FIFO.
    pub async fn reserve(&self, bytes: usize) -> Result<OpPermit, StoreClosed> {
        let permits = self.permits(bytes).await.ok_or(StoreClosed)?;
        Ok(OpPermit {
            shared: Arc::clone(&self.shared),
            permits,
        })
    }

    async fn permits(&self, bytes: usize) -> Option<Permits> {
        let count = Arc::clone(&self.shared.count).acquire_owned().await.ok()?;
        let wanted = bytes.clamp(1, self.shared.config.fifo_bytes);
        let bytes = Arc::clone(&self.shared.bytes)
            .acquire_many_owned(u32::try_from(wanted).unwrap_or(u32::MAX))
            .await
            .ok()?;
        Some(Permits::new(count, bytes))
    }

    pub async fn create_chat(&self, new: NewChat) -> Result<ChatRecord, StoreError> {
        let (reply, answer) = oneshot::channel();
        self.request(Request::CreateChat { new, reply }, answer)
            .await?
    }

    pub async fn chats(&self) -> Result<Vec<ChatRecord>, StoreError> {
        let (reply, answer) = oneshot::channel();
        if self.is_paused() {
            return self
                .saved(writer::SavedRead::Chats { reply }, answer)
                .await?;
        }
        self.request(Request::Chats { reply }, answer).await?
    }

    /// Per-chat recovery of turns left `running` (an actor that died), then everything an actor
    /// needs.
    pub async fn load_chat(&self, chat_id: &str) -> Result<ChatLoad, StoreError> {
        self.load_chat_inner(chat_id)
            .await?
            .ok_or_else(|| StoreError::Other(format!("There is no chat with id {chat_id}.")))
    }

    /// [`load_chat`](Self::load_chat), with `None` for a chat that does not exist.
    pub(crate) async fn load_chat_inner(
        &self,
        chat_id: &str,
    ) -> Result<Option<ChatLoad>, StoreError> {
        let (reply, answer) = oneshot::channel();
        let chat_id = chat_id.to_owned();
        if self.is_paused() {
            return self
                .saved(writer::SavedRead::LoadChat { chat_id, reply }, answer)
                .await?;
        }
        self.request(Request::LoadChat { chat_id, reply }, answer)
            .await?
    }

    /// One page of a blob's text, ending on a character boundary.
    pub async fn read_blob(
        &self,
        sha256: &str,
        offset: u64,
        len: u32,
    ) -> Result<BlobText, StoreError> {
        if !blobs::is_sha256(sha256) {
            return Err(StoreError::BlobMissing(blobs::BLOB_GONE.to_owned()));
        }
        let (reply, answer) = oneshot::channel();
        let sha256 = sha256.to_owned();
        if self.is_paused() {
            return self
                .saved(
                    writer::SavedRead::ReadBlob {
                        sha256,
                        offset,
                        len,
                        reply,
                    },
                    answer,
                )
                .await?;
        }
        self.request(
            Request::ReadBlob {
                sha256,
                offset,
                len,
                reply,
            },
            answer,
        )
        .await?
    }

    /// While paused: the page from saved rows only, with `unsaved_from` set.
    pub async fn read_saved_page(
        &self,
        chat_id: &str,
        before_seq: u32,
        max_bytes: usize,
    ) -> Result<HistoryPage, StoreError> {
        let (reply, answer) = oneshot::channel();
        self.saved(
            writer::SavedRead::Page {
                chat_id: chat_id.to_owned(),
                before_seq,
                max_bytes,
                reply,
            },
            answer,
        )
        .await?
    }

    /// Dismisses the database repair notice (see [`Store::acknowledge_recovery`]).
    pub async fn acknowledge_recovery(&self, quarantined: String) -> Result<bool, CoreError> {
        let (reply, answer) = oneshot::channel();
        self.request(Request::Acknowledge { quarantined, reply }, answer)
            .await
            .map_err(|error| CoreError::Io {
                path: self.db_path.clone(),
                source: io::Error::other(error.to_string()),
            })?
    }

    /// Commits what is queued, then closes the connection. Returns whether everything was saved
    /// within `deadline`.
    pub async fn shutdown(&self, deadline: Duration) -> bool {
        let (done, finished) = std::sync::mpsc::channel();
        self.shared
            .request_shutdown(Instant::now() + deadline, done);
        let limit = deadline + CLOSE_MARGIN;
        self.rt
            .spawn_blocking(move || writer::wait_finished(&finished, limit))
            .await
            .unwrap_or(false)
    }

    /// The same from any thread, with or without a runtime (`RunEvent::Exit`); never panics.
    pub fn shutdown_blocking(&self, deadline: Duration) -> bool {
        let (done, finished) = std::sync::mpsc::channel();
        self.shared
            .request_shutdown(Instant::now() + deadline, done);
        writer::wait_finished(&finished, deadline + CLOSE_MARGIN)
    }

    /// Sends work through the FIFO and waits for its answer, both within [`REQUEST_TIMEOUT`].
    async fn request<T: Send + 'static>(
        &self,
        request: Request,
        answer: oneshot::Receiver<T>,
    ) -> Result<T, StoreError> {
        let started = tokio::time::Instant::now();
        let permits = match tokio::time::timeout(REQUEST_TIMEOUT, self.permits(256)).await {
            Ok(Some(permits)) => permits,
            Ok(None) => return Err(StoreError::Closed),
            Err(_) => return Err(self.timed_out()),
        };
        self.shared.push(Work::Request(request), Some(permits));
        let left = REQUEST_TIMEOUT.saturating_sub(started.elapsed());
        self.wait(answer, left).await
    }

    /// Sends a read to the second channel and waits for its answer.
    async fn saved<T: Send + 'static>(
        &self,
        read: writer::SavedRead,
        answer: oneshot::Receiver<T>,
    ) -> Result<T, StoreError> {
        self.shared.push_saved(read);
        self.wait(answer, REQUEST_TIMEOUT).await
    }

    async fn wait<T: Send + 'static>(
        &self,
        answer: oneshot::Receiver<T>,
        limit: Duration,
    ) -> Result<T, StoreError> {
        match await_reply(&self.rt, answer, limit).await {
            Ok(value) => Ok(value),
            Err(WaitError::Gone) => Err(StoreError::Closed),
            Err(WaitError::TimedOut) => Err(self.timed_out()),
        }
    }

    /// What a call that got no answer in time fails with.
    fn timed_out(&self) -> StoreError {
        match self.shared.pause_reason() {
            Some(PauseReason::DiskFull) => StoreError::DiskFull,
            Some(PauseReason::Busy) | None => StoreError::Busy,
        }
    }

    /// Tests: queues test work without room in the FIFO.
    #[cfg(test)]
    pub(crate) fn test_work(&self, work: TestWork) {
        self.shared.push(Work::Test(work), None);
    }

    /// Tests: runs `run` on the writer's store through the second channel (even while paused).
    #[cfg(test)]
    pub(crate) fn with_store(&self, run: impl FnOnce(&mut Store) + Send + 'static) {
        self.shared.push_saved(SavedRead::WithStore(Box::new(run)));
    }

    /// Waits until every op queued before it is committed (or its batch failed).
    #[cfg(test)]
    pub(crate) async fn barrier(&self) -> bool {
        let (reply, answer) = oneshot::channel();
        let Ok(permit) = self.reserve(1).await else {
            return false;
        };
        permit.send(Op::Barrier(reply));
        self.wait(answer, Duration::from_secs(60)).await.is_ok()
    }
}

impl Drop for ChatStore {
    fn drop(&mut self) {
        // Commits what is queued and closes, without waiting here.
        let (done, _finished) = std::sync::mpsc::channel();
        self.shared
            .request_shutdown(Instant::now() + DROP_DEADLINE, done);
    }
}

/// Room for one op in the FIFO.
pub struct OpPermit {
    shared: Arc<Shared>,
    permits: Permits,
}

impl OpPermit {
    pub fn send(self, op: Op) {
        self.shared.push(Work::Op(op), Some(self.permits));
    }
}

impl fmt::Debug for OpPermit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OpPermit").finish_non_exhaustive()
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

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use aura_protocol::session::{PauseReason, StorageState};
    use aura_protocol::{AuraEvent, NoticeLevel};
    use rusqlite::{Connection, params};
    use sha2::{Digest, Sha256};

    use super::test_support::event_row;
    use super::*;
    use crate::paths::DataRoot;
    use crate::profile::Profiles;

    /// A started chat store in a temporary profile.
    struct Fixture {
        _dir: tempfile::TempDir,
        profile: Profile,
        store: Arc<ChatStore>,
    }

    fn profile(dir: &Path) -> Profile {
        Profiles::new(DataRoot::at(dir.join("data")))
            .open_active()
            .expect("profile")
    }

    fn start_in(
        dir: tempfile::TempDir,
        config: WriterConfig,
        prepare: impl FnOnce(&Store),
    ) -> Fixture {
        let profile = profile(dir.path());
        let owner = ProfileOwner::acquire(&profile).expect("owner");
        let (store, _) = Store::open(&profile).expect("store");
        prepare(&store);
        let chats = ChatStore::start_with(
            store,
            owner,
            &profile,
            "dev".into(),
            Handle::current(),
            config,
        )
        .expect("start");
        Fixture {
            _dir: dir,
            profile,
            store: chats,
        }
    }

    fn start(config: WriterConfig) -> Fixture {
        start_in(tempfile::tempdir().expect("tempdir"), config, |_| {})
    }

    fn notice(seq: u32, text: &str) -> EventRow {
        event_row(
            seq,
            None,
            &AuraEvent::Notice {
                level: NoticeLevel::Info,
                message: text.into(),
            },
        )
    }

    async fn send(store: &ChatStore, op: Op) {
        store
            .reserve(op_bytes(&op))
            .await
            .expect("room in the FIFO")
            .send(op);
    }

    async fn new_chat(store: &ChatStore) -> ChatRecord {
        store
            .create_chat(NewChat {
                agent_id: "mock".into(),
                folder: PathBuf::from("/work/repo"),
                device_id: "dev".into(),
                now: 5,
            })
            .await
            .expect("create")
    }

    fn page_seqs(page: &HistoryPage) -> Vec<u32> {
        page.items.iter().map(|item| item.seq).collect()
    }

    /// The newest page below `before`, up to 4 MiB.
    async fn page(store: &ChatStore, chat: &str, before: u32) -> HistoryPage {
        let (reply, answer) = oneshot::channel();
        send(
            store,
            Op::ReadPage {
                chat_id: chat.into(),
                before_seq: before,
                max_bytes: 4 * 1024 * 1024,
                reply,
            },
        )
        .await;
        await_reply(&Handle::current(), answer, Duration::from_secs(10))
            .await
            .expect("answer")
            .expect("page")
    }

    async fn status_until(
        store: &ChatStore,
        matches: impl Fn(&StorageStatus) -> bool,
    ) -> StorageStatus {
        let mut status = store.status();
        tokio::time::timeout(
            Duration::from_secs(20),
            status.wait_for(|status| matches(status)),
        )
        .await
        .expect("the status changes in time")
        .expect("status")
        .clone()
    }

    fn dead_letters(profile: &Profile) -> Vec<serde_json::Value> {
        let mut lines = Vec::new();
        for entry in std::fs::read_dir(profile.backups_dir())
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("deadletter-") {
                let text = std::fs::read_to_string(entry.path()).expect("read");
                lines.extend(
                    text.lines()
                        .map(|line| serde_json::from_str(line).expect("json line")),
                );
            }
        }
        lines
    }

    #[tokio::test]
    async fn create_list_and_load_chats_through_the_fifo() {
        let fixture = start(WriterConfig::STANDARD);
        let store = &fixture.store;
        assert_eq!(store.recovered().await, RecoveryReport::default());
        let chat = new_chat(store).await;
        assert_eq!(
            store.chats().await.expect("chats"),
            std::slice::from_ref(&chat)
        );
        let load = store.load_chat(&chat.id).await.expect("load");
        assert_eq!(
            (load.chat, load.next_seq, load.next_turn_ordinal),
            (chat, 0, 1)
        );
        assert!(matches!(
            store.load_chat("nope").await,
            Err(StoreError::Other(_))
        ));
        assert_eq!(store.load_chat_inner("nope").await.expect("load"), None);
        assert!(!store.is_paused());
        assert_eq!(*store.status().borrow(), StorageStatus::default());
    }

    /// Ordering: a read queued behind writes sees all of them.
    #[tokio::test]
    async fn reads_see_every_earlier_write() {
        let fixture = start(WriterConfig::STANDARD);
        let store = &fixture.store;
        let chat = new_chat(store).await;
        for seq in 0..50 {
            send(
                store,
                Op::AppendEvents {
                    chat_id: chat.id.clone(),
                    rows: vec![notice(seq, "x")],
                },
            )
            .await;
        }
        let page = page(store, &chat.id, 50).await;
        assert_eq!(page_seqs(&page), (0..50).collect::<Vec<_>>());
    }

    /// Group commit: a burst queued while the writer is busy commits in a few transactions.
    #[tokio::test]
    async fn writer_group_commits_a_burst() {
        let fixture = start(WriterConfig::STANDARD);
        let store = &fixture.store;
        let chat = new_chat(store).await;
        assert!(store.barrier().await);
        let before = store
            .shared
            .commits
            .load(std::sync::atomic::Ordering::Relaxed);
        store.with_store(|_| std::thread::sleep(Duration::from_millis(300)));
        for seq in 0..600 {
            send(
                store,
                Op::AppendEvents {
                    chat_id: chat.id.clone(),
                    rows: vec![notice(seq, "burst")],
                },
            )
            .await;
        }
        assert!(store.barrier().await);
        let commits = store
            .shared
            .commits
            .load(std::sync::atomic::Ordering::Relaxed)
            - before;
        assert!(commits <= 4, "{commits} transactions for 600 ops");
        assert_eq!(page(store, &chat.id, 600).await.items.len(), 600);
    }

    /// The FIFO is bounded: with a stalled writer, the 1,025th reservation waits.
    #[tokio::test]
    async fn the_fifo_is_bounded_by_ops_and_bytes() {
        let config = WriterConfig {
            fifo_ops: 4,
            fifo_bytes: 4096,
            ..WriterConfig::STANDARD
        };
        let fixture = start(config);
        let store = &fixture.store;
        let (release, wait) = std::sync::mpsc::channel::<()>();
        store.with_store(move |_| {
            let _ = wait.recv_timeout(Duration::from_secs(10));
        });
        let mut held = Vec::new();
        for _ in 0..4 {
            held.push(store.reserve(10).await.expect("room"));
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(100), store.reserve(10))
                .await
                .is_err(),
            "the fifth op waits for room"
        );
        drop(held);
        let big = store
            .reserve(10_000)
            .await
            .expect("one op larger than the byte bound passes alone");
        assert!(
            tokio::time::timeout(Duration::from_millis(100), store.reserve(10))
                .await
                .is_err()
        );
        drop(big);
        let _ = release.send(());
    }

    /// An op is atomic: a `BeginTurn` that fails leaves neither its turn nor its rows, and keeps the
    /// queued prompt; the other ops of its batch commit.
    #[tokio::test]
    async fn ops_are_atomic_and_a_poison_op_is_isolated() {
        let fixture = start(WriterConfig::STANDARD);
        let store = &fixture.store;
        let chat = new_chat(store).await;
        send(
            store,
            Op::QueuePut(QueuedRow {
                id: "p1".into(),
                chat_id: chat.id.clone(),
                text: "hello".into(),
                held: false,
                created_at: 1,
            }),
        )
        .await;
        store.with_store(|_| std::thread::sleep(Duration::from_millis(100)));
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "first")],
            },
        )
        .await;
        // Its second row reuses seq 0: UNIQUE (chat_id, seq) fails inside the op.
        send(
            store,
            Op::BeginTurn {
                turn: TurnRow {
                    id: "t1".into(),
                    chat_id: chat.id.clone(),
                    agent_session_id: None,
                    ordinal: 1,
                    prompt_id: "p1".into(),
                    first_event_seq: 1,
                    started_at: 2,
                },
                rows: vec![
                    event_row(
                        1,
                        Some("t1"),
                        &AuraEvent::TurnStarted {
                            turn_id: "t1".into(),
                            prompt_id: Some("p1".into()),
                        },
                    ),
                    event_row(
                        0,
                        Some("t1"),
                        &AuraEvent::TurnStarted {
                            turn_id: "t1".into(),
                            prompt_id: Some("p1".into()),
                        },
                    ),
                ],
            },
        )
        .await;
        send(
            store,
            Op::AppendEvents {
                chat_id: "missing".into(),
                rows: vec![notice(0, "poison")],
            },
        )
        .await;
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(2, "last")],
            },
        )
        .await;
        assert!(store.barrier().await);
        assert_eq!(page_seqs(&page(store, &chat.id, 10).await), [0, 2]);
        let load = store.load_chat(&chat.id).await.expect("load");
        assert_eq!(load.next_turn_ordinal, 1, "no turn row");
        assert_eq!(load.queue.len(), 1, "the prompt is still queued");
        let dead = dead_letters(&fixture.profile);
        let ops: Vec<&str> = dead
            .iter()
            .filter_map(|line| line["op"]["op"].as_str())
            .collect();
        assert_eq!(ops, ["begin_turn", "append_events"]);
        assert_eq!(dead[1]["op"]["chat_id"], "missing");
        assert!(
            dead[0]["error"]
                .as_str()
                .is_some_and(|error| error.contains("UNIQUE")),
            "{dead:?}"
        );
    }

    /// S5: a panic inside a batch is rolled back and isolated, and the thread continues.
    #[tokio::test]
    async fn writer_survives_panicking_batch() {
        let fixture = start(WriterConfig::STANDARD);
        let store = &fixture.store;
        let chat = new_chat(store).await;
        store.with_store(|_| std::thread::sleep(Duration::from_millis(100)));
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "a")],
            },
        )
        .await;
        store.test_work(TestWork::Panic);
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(1, "b")],
            },
        )
        .await;
        assert!(store.barrier().await);
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(2, "after")],
            },
        )
        .await;
        assert_eq!(page_seqs(&page(store, &chat.id, 10).await), [0, 1, 2]);
        let dead = dead_letters(&fixture.profile);
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0]["op"]["op"], "test_panic");
        assert_eq!(*store.status().borrow(), StorageStatus::default());
    }

    fn sha(bytes: &[u8]) -> String {
        rows::hex(&Sha256::digest(bytes))
    }

    /// S3 (store part) and S8: a full disk pauses saving; the writer keeps the failed batch and takes
    /// no ops; reads are served from saved data with what is unsaved marked; freeing space resumes
    /// and nothing is lost.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn disk_full_pauses_without_loss() {
        let config = WriterConfig {
            disk_full_retry: Duration::from_millis(50),
            ..WriterConfig::STANDARD
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture = start_in(dir, config, |_| {});
        let store = &fixture.store;
        let chat = new_chat(store).await;
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "saved")],
            },
        )
        .await;
        assert!(store.barrier().await);
        // Leave room for almost nothing more.
        store.with_store(|store| {
            let pages: i64 = store
                .conn()
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .expect("pages");
            let _: i64 = store
                .conn()
                .query_row(
                    &format!("PRAGMA max_page_count = {}", pages + 1),
                    [],
                    |row| row.get(0),
                )
                .expect("cap");
        });
        let big = "y".repeat(40_000);
        let blob = Arc::<[u8]>::from(big.as_bytes());
        let blob_id = sha(&blob);
        // Everything below lands in one batch, which fails as a whole.
        store.with_store(|_| std::thread::sleep(Duration::from_millis(200)));
        send(
            store,
            Op::PutBlob {
                sha256: blob_id.clone(),
                mime: "text/plain".into(),
                bytes: blob,
            },
        )
        .await;
        for seq in 1..=20 {
            send(
                store,
                Op::AppendEvents {
                    chat_id: chat.id.clone(),
                    rows: vec![notice(seq, &big)],
                },
            )
            .await;
        }
        let paused = status_until(store, |status| {
            matches!(status.state, StorageState::Paused { .. })
        })
        .await;
        assert!(matches!(
            paused.state,
            StorageState::Paused {
                reason: PauseReason::DiskFull,
                ..
            }
        ));
        assert!(store.is_paused());
        assert!(paused.unsaved_bytes > 0);

        // Reads never wait behind the paused writer.
        let started = std::time::Instant::now();
        assert_eq!(store.chats().await.expect("chats").len(), 1);
        let saved = store
            .read_saved_page(&chat.id, 21, history::DEFAULT_PAGE_BYTES)
            .await
            .expect("page");
        assert_eq!(page_seqs(&saved), [0]);
        assert_eq!(saved.unsaved_from, Some(1));
        assert_eq!(
            store.read_blob(&blob_id, 0, 100).await,
            Err(StoreError::BlobMissing(blobs::BLOB_UNSAVED.into()))
        );
        assert!(
            matches!(store.load_chat(&chat.id).await, Err(StoreError::DiskFull)),
            "it has unsaved ops"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );

        // Free space: the failed batch and everything behind it commit.
        store.with_store(|store| {
            let _: i64 = store
                .conn()
                .query_row("PRAGMA max_page_count = 1073741823", [], |row| row.get(0))
                .expect("uncap");
        });
        status_until(store, |status| status.state == StorageState::Ok).await;
        assert!(!store.is_paused());
        assert_eq!(
            page_seqs(&page(store, &chat.id, 21).await),
            (0..=20).collect::<Vec<_>>()
        );
        let text = store.read_blob(&blob_id, 0, 100).await.expect("blob saved");
        assert_eq!(text.total, 40_000);
    }

    /// S8: while paused, a chat with nothing unsaved loads from saved data, its queue held.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn attach_while_paused_reads_saved_rows() {
        let config = WriterConfig {
            disk_full_retry: Duration::from_millis(50),
            ..WriterConfig::STANDARD
        };
        let fixture = start(config);
        let store = &fixture.store;
        let quiet = new_chat(store).await;
        let busy = new_chat(store).await;
        send(
            store,
            Op::QueuePut(QueuedRow {
                id: "q".into(),
                chat_id: quiet.id.clone(),
                text: "next".into(),
                held: false,
                created_at: 1,
            }),
        )
        .await;
        send(
            store,
            Op::AppendEvents {
                chat_id: quiet.id.clone(),
                rows: vec![notice(0, "old")],
            },
        )
        .await;
        assert!(store.barrier().await);
        store.with_store(|store| {
            let pages: i64 = store
                .conn()
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .expect("pages");
            let _: i64 = store
                .conn()
                .query_row(
                    &format!("PRAGMA max_page_count = {}", pages + 1),
                    [],
                    |row| row.get(0),
                )
                .expect("cap");
        });
        let big = "z".repeat(60_000);
        for seq in 0..10 {
            send(
                store,
                Op::AppendEvents {
                    chat_id: busy.id.clone(),
                    rows: vec![notice(seq, &big)],
                },
            )
            .await;
        }
        status_until(store, |status| {
            matches!(status.state, StorageState::Paused { .. })
        })
        .await;
        let load = store
            .load_chat(&quiet.id)
            .await
            .expect("served from saved data");
        assert_eq!(load.next_seq, 1);
        assert_eq!(load.queue.len(), 1);
        assert!(load.queue[0].held, "reads as held");
        let page = store
            .read_saved_page(&quiet.id, 1, history::DEFAULT_PAGE_BYTES)
            .await
            .expect("page");
        assert_eq!((page_seqs(&page), page.unsaved_from), (vec![0], None));
        store.with_store(|store| {
            let _: i64 = store
                .conn()
                .query_row("PRAGMA max_page_count = 1073741823", [], |row| row.get(0))
                .expect("uncap");
        });
        status_until(store, |status| status.state == StorageState::Ok).await;
    }

    /// S25 (store part): quitting while paused gives up at the deadline, logs what it drops, and the
    /// next start is consistent.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn quit_while_paused_drops_only_what_was_unsaved() {
        let config = WriterConfig {
            disk_full_retry: Duration::from_millis(50),
            ..WriterConfig::STANDARD
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_path_buf();
        let fixture = start_in(dir, config, |_| {});
        let store = Arc::clone(&fixture.store);
        let chat = new_chat(&store).await;
        send(
            &store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "kept")],
            },
        )
        .await;
        assert!(store.barrier().await);
        store.with_store(|store| {
            let pages: i64 = store
                .conn()
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .expect("pages");
            let _: i64 = store
                .conn()
                .query_row(
                    &format!("PRAGMA max_page_count = {}", pages + 1),
                    [],
                    |row| row.get(0),
                )
                .expect("cap");
        });
        let big = "q".repeat(60_000);
        for seq in 1..=5 {
            send(
                &store,
                Op::AppendEvents {
                    chat_id: chat.id.clone(),
                    rows: vec![notice(seq, &big)],
                },
            )
            .await;
        }
        status_until(&store, |status| {
            matches!(status.state, StorageState::Paused { .. })
        })
        .await;
        let started = std::time::Instant::now();
        assert!(
            !store.shutdown(Duration::from_millis(300)).await,
            "something was lost"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
        drop(store);
        // The next start reads a consistent database with what was saved.
        let profile = profile(&root);
        let (reopened, info) = Store::open(&profile).expect("reopen");
        assert!(!info.unclean_shutdown);
        let count: i64 = reopened
            .conn()
            .query_row(
                "SELECT count(*) FROM events WHERE chat_id = ?1",
                params![chat.id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
    }

    /// S36 (store part): a quit with ops still queued commits them all, folds the WAL back, and the
    /// next launch reports a clean shutdown; the owner lock goes with the store.
    #[tokio::test]
    async fn quit_without_sessions_commits_and_closes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_path_buf();
        let fixture = start_in(dir, WriterConfig::STANDARD, |_| {});
        let store = Arc::clone(&fixture.store);
        let chat = new_chat(&store).await;
        for seq in 0..300 {
            send(
                &store,
                Op::AppendEvents {
                    chat_id: chat.id.clone(),
                    rows: vec![notice(seq, "queued")],
                },
            )
            .await;
        }
        assert!(store.shutdown(Duration::from_secs(5)).await);
        assert!(
            store.shutdown_blocking(Duration::from_secs(1)),
            "a second call reports the same"
        );
        assert!(store.reserve(1).await.is_err(), "closed for new ops");
        let profile = profile(&root);
        ProfileOwner::acquire(&profile).expect("the owner lock was released");
        let wal = crate::fsutil::with_suffix(&profile.db_path(), "-wal");
        assert!(
            std::fs::metadata(&wal).map_or(true, |meta| meta.len() == 0),
            "the WAL was folded back"
        );
        let (reopened, info) = Store::open(&profile).expect("reopen");
        assert!(!info.unclean_shutdown);
        let count: i64 = reopened
            .conn()
            .query_row("SELECT count(*) FROM events", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 300);
    }

    /// `shutdown_blocking` works from a plain thread with no runtime, and never panics.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shutdown_blocking_works_without_a_runtime() {
        let fixture = start(WriterConfig::STANDARD);
        let store = Arc::clone(&fixture.store);
        let chat = new_chat(&store).await;
        send(
            &store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "x")],
            },
        )
        .await;
        let saved = std::thread::spawn(move || store.shutdown_blocking(Duration::from_secs(5)))
            .join()
            .expect("no panic");
        assert!(saved);
    }

    /// Busy past the timeout retries with backoff, then pauses; once the other writer lets go,
    /// saving resumes with nothing lost.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_busy_database_retries_then_pauses_then_resumes() {
        let config = WriterConfig {
            busy_backoff_first: Duration::from_millis(10),
            busy_backoff_max: Duration::from_millis(40),
            busy_pause_after: Duration::from_millis(200),
            ..WriterConfig::STANDARD
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = profile(dir.path()).db_path();
        let fixture = start_in(dir, config, |store| {
            store
                .conn()
                .busy_timeout(Duration::from_millis(20))
                .expect("busy timeout");
        });
        let store = &fixture.store;
        let chat = new_chat(store).await;
        let other = Connection::open(&db_path).expect("another tool");
        other
            .execute_batch("BEGIN IMMEDIATE")
            .expect("hold the write lock");
        send(
            store,
            Op::AppendEvents {
                chat_id: chat.id.clone(),
                rows: vec![notice(0, "waits")],
            },
        )
        .await;
        let paused = status_until(store, |status| {
            matches!(status.state, StorageState::Paused { .. })
        })
        .await;
        assert!(matches!(
            paused.state,
            StorageState::Paused {
                reason: PauseReason::Busy,
                ..
            }
        ));
        other.execute_batch("ROLLBACK").expect("let go");
        status_until(store, |status| status.state == StorageState::Ok).await;
        assert_eq!(page_seqs(&page(store, &chat.id, 1).await), [0]);
    }

    /// S4: damage found during a run is recorded for the next open's repair, the status turns
    /// `Failed`, and later writes go to the dead-letter file.
    #[tokio::test]
    async fn corruption_switches_to_dead_letter() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = profile(dir.path());
        let chat_id = {
            let (store, _) = Store::open(&profile).expect("store");
            let chat = rows::create_chat(
                store.conn(),
                &NewChat {
                    agent_id: "mock".into(),
                    folder: PathBuf::from("/w"),
                    device_id: "dev".into(),
                    now: 1,
                },
            )
            .expect("chat");
            chat.id
        };
        // Smash the chats table's page in the closed file; the cheap probe at open does not read it.
        let root: i64 = Connection::open(profile.db_path())
            .expect("raw")
            .query_row(
                "SELECT rootpage FROM sqlite_schema WHERE name = 'chats'",
                [],
                |row| row.get(0),
            )
            .expect("root page");
        let mut bytes = std::fs::read(profile.db_path()).expect("read");
        let start = usize::try_from((root - 1) * 4096).expect("offset");
        bytes[start..start + 64].fill(0xA5);
        std::fs::write(profile.db_path(), bytes).expect("write");

        let fixture = start_in(dir, WriterConfig::STANDARD, |_| {});
        let store = &fixture.store;
        assert!(matches!(store.chats().await, Err(StoreError::Damaged(_))));
        let failed = status_until(store, |status| {
            matches!(status.state, StorageState::Failed { .. })
        })
        .await;
        assert!(
            matches!(failed.state, StorageState::Failed { message } if message.contains("Restart auracode"))
        );
        send(
            store,
            Op::AppendEvents {
                chat_id: chat_id.clone(),
                rows: vec![notice(0, "kept somewhere")],
            },
        )
        .await;
        assert!(store.barrier().await);
        let dead = dead_letters(&fixture.profile);
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0]["op"]["op"], "append_events");
        assert_eq!(dead[0]["op"]["rows"][0]["seq"], 0);
        assert!(store.shutdown(Duration::from_secs(5)).await);
        // The next open repairs what was recorded.
        let (_, info) = Store::open(&fixture.profile).expect("reopen");
        assert!(
            matches!(
                info.outcome,
                crate::store::OpenOutcome::RecoveredFromCorruption { .. }
            ),
            "{:?}",
            info.outcome
        );
    }

    /// Recovery is the writer's first op, and its report is available to callers.
    #[tokio::test]
    async fn startup_recovery_runs_first() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture = start_in(dir, WriterConfig::STANDARD, |store| {
            let chat = rows::create_chat(
                store.conn(),
                &NewChat {
                    agent_id: "mock".into(),
                    folder: PathBuf::from("/w"),
                    device_id: "dev".into(),
                    now: 1,
                },
            )
            .expect("chat");
            store
                .conn()
                .execute(
                    "INSERT INTO turns (id, chat_id, seq, status, started_at, device_id, first_event_seq) \
                     VALUES ('t', ?1, 1, 'running', 1, 'dev', 0)",
                    params![chat.id],
                )
                .expect("turn");
        });
        let report = fixture.store.recovered().await;
        assert_eq!(report.interrupted_turns, 1);
        assert_eq!(report.compacted_turns, 1);
    }

    /// Marks the child copy of the crash tests; holds the data root it works on.
    const CRASH_CHILD: &str = "AURA_CORE_TEST_CRASH_CHILD_ROOT";

    /// Runs this test binary again as a child that does `step` on the profile in `root` and then
    /// aborts mid-transaction, the way a crash or a power cut would stop it.
    fn crash_in_child(test: &str, root: &Path) {
        let status = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args(["--exact", test, "--test-threads=1", "--nocapture"])
            .env(CRASH_CHILD, root)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("run the child");
        assert!(!status.success(), "the child must die mid-transaction");
    }

    /// S40: removing the queued prompt and starting its turn are one transaction, so after a crash
    /// in the middle the prompt is still queued and no turn exists.
    #[test]
    fn begin_turn_is_atomic() {
        if let Some(root) = std::env::var_os(CRASH_CHILD) {
            let profile = profile(Path::new(&root));
            let (mut store, _) = Store::open(&profile).expect("store");
            let chat: String = store
                .conn()
                .query_row("SELECT id FROM chats", [], |row| row.get(0))
                .expect("chat");
            let tx = store.conn_mut().transaction().expect("tx");
            rows::begin_turn(
                &tx,
                "dev",
                &TurnRow {
                    id: "t1".into(),
                    chat_id: chat.clone(),
                    agent_session_id: None,
                    ordinal: 1,
                    prompt_id: "p1".into(),
                    first_event_seq: 0,
                    started_at: 1,
                },
                &[event_row(
                    0,
                    Some("t1"),
                    &AuraEvent::TurnStarted {
                        turn_id: "t1".into(),
                        prompt_id: Some("p1".into()),
                    },
                )],
            )
            .expect("begin");
            // Both statements ran; the process dies before the commit.
            std::process::abort();
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = profile(dir.path());
        {
            let (store, _) = Store::open(&profile).expect("store");
            let chat = rows::create_chat(
                store.conn(),
                &NewChat {
                    agent_id: "mock".into(),
                    folder: PathBuf::from("/w"),
                    device_id: "dev".into(),
                    now: 1,
                },
            )
            .expect("chat");
            rows::queue_put(
                store.conn(),
                "dev",
                &QueuedRow {
                    id: "p1".into(),
                    chat_id: chat.id,
                    text: "hi".into(),
                    held: false,
                    created_at: 1,
                },
            )
            .expect("queue");
        }
        crash_in_child("chatstore::tests::begin_turn_is_atomic", dir.path());
        let (store, _) = Store::open(&profile).expect("reopen");
        let queued: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM queued_prompts", [], |row| row.get(0))
            .expect("queued");
        let turns: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM turns", [], |row| row.get(0))
            .expect("turns");
        let events: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM events", [], |row| row.get(0))
            .expect("events");
        assert_eq!((queued, turns, events), (1, 0, 0));
    }

    /// S2: a crash in the middle of compaction rolls back, and the next start compacts the turn.
    #[test]
    fn compaction_is_idempotent() {
        if let Some(root) = std::env::var_os(CRASH_CHILD) {
            let profile = profile(Path::new(&root));
            let (mut store, _) = Store::open(&profile).expect("store");
            let chat: String = store
                .conn()
                .query_row("SELECT id FROM chats", [], |row| row.get(0))
                .expect("chat");
            let tx = store.conn_mut().transaction().expect("tx");
            assert!(
                compact::apply(
                    &tx,
                    &chat,
                    "t1",
                    "dev",
                    &compact::CompactLimits::STANDARD,
                    9
                )
                .expect("compact")
            );
            std::process::abort();
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = profile(dir.path());
        let chat = {
            let (store, _) = Store::open(&profile).expect("store");
            let chat = rows::create_chat(
                store.conn(),
                &NewChat {
                    agent_id: "mock".into(),
                    folder: PathBuf::from("/w"),
                    device_id: "dev".into(),
                    now: 1,
                },
            )
            .expect("chat")
            .id;
            store
                .conn()
                .execute(
                    "INSERT INTO turns (id, chat_id, seq, status, started_at, device_id, first_event_seq) \
                     VALUES ('t1', ?1, 1, 'completed', 1, 'dev', 0)",
                    params![chat],
                )
                .expect("turn");
            let delta = |text: &str| AuraEvent::MessageDelta {
                message_id: "t1.m1".into(),
                text: text.into(),
            };
            rows::append_events(
                store.conn(),
                "dev",
                &chat,
                &[
                    event_row(0, Some("t1"), &delta("one ")),
                    event_row(1, Some("t1"), &delta("two")),
                ],
            )
            .expect("events");
            chat
        };
        crash_in_child("chatstore::tests::compaction_is_idempotent", dir.path());
        let (mut store, _) = Store::open(&profile).expect("reopen");
        let rows_left: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM events", [], |row| row.get(0))
            .expect("rows");
        assert_eq!(rows_left, 2, "rolled back");
        let report = recover::recover(
            store.conn_mut(),
            recover::Scope::All,
            "dev",
            &compact::CompactLimits::STANDARD,
            10,
        )
        .expect("recover");
        assert_eq!(report.compacted_turns, 1);
        let text: String = store
            .conn()
            .query_row(
                "SELECT payload FROM events WHERE chat_id = ?1",
                params![chat],
                |row| row.get(0),
            )
            .expect("merged");
        assert!(text.contains("one two"), "{text}");
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
