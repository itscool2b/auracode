//! The chat actor: one per chat, owning its state, batcher, normalizer, subscribers, queue, open
//! turn and live driver; it never awaits inline, so IPC commands, driver events, store permits,
//! flushes and timers are all handled in one loop.
//!
//! Every wait is a future in `in_flight`, tagged with what it completes: a start's preparation
//! (folder check, detection, adapter install, launch spec, env; one task, dropped as a whole), page
//! reads for attaches and history, option and autonomy replies, the driver's join handle once its
//! event channel closed (so every event is applied before its exit is handled), the force-stop
//! chains, and the abort of a driver that has not returned 5 s after a kill.
//!
//! Drivers are generations: a force stop retires the current one at once (its event receiver is
//! dropped, so no late event is ever applied, and its processes get the FORCE chain), and the chat
//! reads `Stopped` at once. A retired generation, like one that crashed, keeps the chat's live slot
//! and native sessions until its processes are gone and its task ended; a new start waits for that
//! before it spawns anything, so one native session never has two processes.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
mod steering;

use aura_agents::{AgentSpec, LaunchError, Recipe};
use aura_drivers::batch::{FrameBatcher, TurnTag};
use aura_drivers::driver::{
    DriverCommand, DriverContext, DriverError, DriverEvent, DriverExit, DriverStatus,
    DriverTimings, EventReceiver, PermissionOutcome, ReadyInfo, ResumeOutcome, SessionSetup,
    StopPlan, TurnRef, event_channel,
};
use aura_process::{
    ExitInfo, LaunchSpec, ProcessControl, ResolvedEnv, STDERR_TAIL_SHOWN_BYTES, ShutdownPlan,
};
use aura_protocol::session::{
    AuthPrompt, Availability, ChatAttach, ChatSnapshot, ChatSummary, ConfigCategory, ConfigKind,
    ConfigOption, ConfigValue, ErrorInfo, FolderState, HistoryPage, PromptAck, QueuedPrompt,
    SessionLists,
};
use aura_protocol::{
    AuraEvent, AutoAnswer, Autonomy, AutonomyState, Capabilities, ErrorKind, LimitWindow, Millis,
    NoticeLevel, PermissionDecision, PermissionRequest, PromptPart, PromptState, ResolvedBy,
    SessionInfo, SessionStatus, SlashCommand, StopReason, UiAnswer, UiPrompt, UiRequest, UsageInfo,
};
use futures::FutureExt;
use futures::future::BoxFuture;
use futures::stream::{FuturesUnordered, StreamExt};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::{AbortHandle, JoinError, JoinHandle};
use tokio::time::Instant;

use super::live::NativeSessionScope;
use super::normalize::{
    MESSAGE_BYTES, Normalizer, OpenCard, cap_chars, cap_escaped, suffix_escaped,
};
use super::policy::{Decision, decide};
use super::spawner::{ProcessBook, SessionSpawner};
use super::{ChatState, FrameSink, SessionError, Shared, SinkGone};
use crate::chatstore::blobs::BLOB_UNSAVED;
use crate::chatstore::rows::{ReplyHasher, turn_status};
use crate::chatstore::{
    AgentSessionPatch, AgentSessionRow, ChatLoad, ChatRecord, ChatStore, EventRow, Op, QueuedRow,
    ReplayCheck, StoreError, TitleSource, TurnEnd, TurnRow, WaitError, await_reply, op_bytes,
};
use crate::ids::new_id;
use crate::time::now_millis;

/// New turns are refused this close to the end of the seq space (a turn can produce many events).
const SEQ_LIMIT: u32 = u32::MAX - (1 << 24);

/// A queued prompt's preview.
const PREVIEW_CHARS: usize = 256;

/// A first-line title.
const TITLE_CHARS: usize = 80;

/// A force-stopped driver that has not returned this long after the kill is aborted.
const ABORT_AFTER_KILL: Duration = Duration::from_secs(5);

/// `set_option` and `set_autonomy` wait this long for the driver (its 30 s plus margin).
const OPTION_REPLY_TIMEOUT: Duration = Duration::from_secs(35);

/// The withdrawals of answered requests are remembered for this many requests.
const ANSWERED_REMEMBERED: usize = 64;

/// A message for a chat's actor. Every reply is a oneshot.
pub(crate) enum ChatMsg {
    ReserveGit {
        id: String,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    ReleaseGit {
        id: String,
    },
    Conversation {
        command: crate::chatstore::conversation::ConversationCommand,
        reply: oneshot::Sender<
            Result<crate::chatstore::conversation::ConversationReply, SessionError>,
        >,
    },
    Continue {
        apply: Box<crate::chatstore::conversation::ApplyContinuation>,
        prompt: Option<(String, Vec<PromptPart>)>,
        reply:
            oneshot::Sender<Result<aura_protocol::conversation::ContinuationResult, SessionError>>,
    },
    CheckpointContext {
        turn_id: Option<String>,
        reply: oneshot::Sender<Result<(ChatRecord, Option<String>), SessionError>>,
    },
    Revert {
        token: String,
        guard: Arc<super::changes::FolderMutation>,
        reply: oneshot::Sender<Result<aura_protocol::changes::RevertResult, SessionError>>,
    },
    Organize {
        command: crate::chatstore::organization::OrganizationCommand,
        reply: oneshot::Sender<Result<crate::chatstore::organization::Organization, SessionError>>,
    },
    Attach {
        sink: Arc<dyn FrameSink>,
        subscription_id: String,
        reply: oneshot::Sender<Result<ChatAttach, SessionError>>,
    },
    Detach {
        subscription_id: String,
    },
    DropOwner {
        owner: String,
    },
    History {
        before_seq: u32,
        max_bytes: usize,
        reply: oneshot::Sender<Result<HistoryPage, SessionError>>,
    },
    Lists {
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    },
    Send {
        text: String,
        parts: Vec<PromptPart>,
        reply: oneshot::Sender<Result<PromptAck, SessionError>>,
    },
    Steer {
        expected_turn_id: String,
        text: String,
        parts: Vec<PromptPart>,
        reply: oneshot::Sender<Result<aura_protocol::composer::SteeringAck, SessionError>>,
    },
    CancelQueued {
        prompt_id: String,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    ResumeQueue {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Interrupt {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    ForceStop {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    /// `explicit`: `chat_start` (a full slot is an error); otherwise a start a chat's creation or a
    /// prompt triggered (a full slot is an error card).
    Start {
        fresh: bool,
        explicit: bool,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Stop {
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    RespondPermission {
        request_id: String,
        option_id: Option<String>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    RespondUi {
        request_id: String,
        answer: Option<UiAnswer>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    SetOption {
        option_id: String,
        value: ConfigValue,
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    },
    SetAutonomy {
        autonomy: Autonomy,
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    },
    /// Before a blob read: a barrier to wait for when this chat's own `PutBlob` for the blob has not
    /// reached the store yet, `BlobMissing` when it waits on a paused store, `ChatNotFound` for a
    /// chat that does not exist.
    Blob {
        sha256: String,
        reply: oneshot::Sender<Result<Option<oneshot::Receiver<()>>, SessionError>>,
    },
    Shutdown {
        plan: StopPlan,
        reply: oneshot::Sender<()>,
    },
    /// Tests: the actor task panics.
    #[cfg(test)]
    Panic,
}

impl ChatMsg {
    /// Answers the message with `error` (a chat that does not exist, a store that is gone).
    fn refuse(self, error: SessionError) {
        match self {
            ChatMsg::ReserveGit { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::ReleaseGit { .. } => {}
            ChatMsg::Conversation { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Continue { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::CheckpointContext { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Revert { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Organize { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Attach { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::History { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Lists { reply } => drop(reply.send(Err(error))),
            ChatMsg::Send { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Steer { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::SetOption { reply, .. } | ChatMsg::SetAutonomy { reply, .. } => {
                drop(reply.send(Err(error)));
            }
            ChatMsg::Blob { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::CancelQueued { reply, .. }
            | ChatMsg::ResumeQueue { reply }
            | ChatMsg::Interrupt { reply }
            | ChatMsg::ForceStop { reply }
            | ChatMsg::Start { reply, .. }
            | ChatMsg::Stop { reply }
            | ChatMsg::RespondPermission { reply, .. }
            | ChatMsg::RespondUi { reply, .. } => drop(reply.send(Err(error))),
            ChatMsg::Shutdown { reply, .. } => {
                let _ = reply.send(());
            }
            ChatMsg::Detach { .. } | ChatMsg::DropOwner { .. } => {}
            #[cfg(test)]
            ChatMsg::Panic => {}
        }
    }
}

/// Loads the chat, then runs its actor until the manager is gone.
pub(crate) async fn run(
    chat_id: String,
    shared: Arc<Shared>,
    book: Arc<ProcessBook>,
    mut mailbox: mpsc::UnboundedReceiver<ChatMsg>,
) {
    let refusal = match shared.deps.store.load_chat_inner(&chat_id).await {
        Ok(Some(load)) => {
            ChatActor::new(chat_id, shared, book, load)
                .run(mailbox)
                .await;
            return;
        }
        Ok(None) => SessionError::ChatNotFound(chat_id),
        Err(error) => storage_error(&error),
    };
    // Nothing more arrives: the manager starts a new actor for the next call.
    mailbox.close();
    while let Ok(msg) = mailbox.try_recv() {
        msg.refuse(clone_error(&refusal));
    }
}

/// What a store error reads as for a caller.
pub(crate) fn storage_error(error: &StoreError) -> SessionError {
    match error {
        StoreError::BlobMissing(message) => SessionError::BlobMissing(message.clone()),
        other => SessionError::StorageUnavailable(other.to_string()),
    }
}

/// `SessionError` is not `Clone` (it is a public frozen type); the variants a refusal uses are.
fn clone_error(error: &SessionError) -> SessionError {
    match error {
        SessionError::ChatNotFound(id) => SessionError::ChatNotFound(id.clone()),
        SessionError::StorageUnavailable(message) => {
            SessionError::StorageUnavailable(message.clone())
        }
        SessionError::ShuttingDown => SessionError::ShuttingDown,
        other => SessionError::Internal(other.to_string()),
    }
}

/// One open view of the chat.
struct Subscriber {
    id: String,
    owner: String,
    sink: Arc<dyn FrameSink>,
}

/// The turn in flight.
struct OpenTurn {
    parts: Vec<PromptPart>,
    id: String,
    tag: Arc<str>,
    prompt_id: String,
    /// The prompt as sent, so a sign-in error can queue it again.
    text: String,
    prompt_created_at: Millis,
    started: Instant,
    interrupt_requested: bool,
    reply: ReplyHasher,
}

/// How a driver is being stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    None,
    /// A `Shutdown` was sent; `auth`: the stop after a prompt met a sign-in error.
    Graceful {
        auth: bool,
    },
}

/// The current driver.
struct LiveDriver {
    generation: u64,
    commands: mpsc::UnboundedSender<DriverCommand>,
    /// `None` once the driver dropped its sender.
    events: Option<EventReceiver>,
    /// Joins `in_flight` once the event channel closed.
    join: Option<JoinHandle<DriverExit>>,
    /// Aborts the driver's task, wherever its join handle went.
    abort: AbortHandle,
    ready: bool,
    /// `None` keeps the original turn-based contract. Otherwise only an idle report permits
    /// another prompt, even after the current prompt's result has arrived.
    run_idle: Option<bool>,
    native_scope: NativeSessionScope,
    stop: Stop,
    spawn_id: Option<String>,
}

/// A start's preparation in flight.
struct Preparing {
    generation: u64,
    abort: AbortHandle,
    fresh: bool,
}

/// What a preparation produces.
struct Prepared {
    folder_key: PathBuf,
    launch: LaunchSpec,
    env: Arc<ResolvedEnv>,
}

/// Why a start failed before its driver ran.
struct StartFailure {
    kind: ErrorKind,
    message: String,
    folder: Option<FolderState>,
}

/// Who asked for a page.
enum PageFor {
    Attach {
        reply: oneshot::Sender<Result<ChatAttach, SessionError>>,
        subscription_id: String,
        next_seq: u32,
        snapshot: Box<ChatSnapshot>,
    },
    History {
        reply: oneshot::Sender<Result<HistoryPage, SessionError>>,
    },
}

struct NativeIdentitySave {
    generation: u64,
    native_id: String,
    row_id: String,
    previous_id: Option<String>,
}

/// What an `in_flight` future completes.
enum Done {
    Steering(Box<steering::Completion>),
    Conversation {
        result: Result<crate::chatstore::conversation::ConversationReply, SessionError>,
        reply: oneshot::Sender<
            Result<crate::chatstore::conversation::ConversationReply, SessionError>,
        >,
    },
    Continued {
        result: Result<Box<ChatLoad>, SessionError>,
        prompt: Option<(String, Vec<PromptPart>)>,
        reply:
            oneshot::Sender<Result<aura_protocol::conversation::ContinuationResult, SessionError>>,
    },
    CheckpointContext {
        result: Result<(ChatRecord, Option<String>), SessionError>,
        reply: oneshot::Sender<Result<(ChatRecord, Option<String>), SessionError>>,
    },
    Reverted {
        result: Result<aura_protocol::changes::RevertResult, SessionError>,
        reply: oneshot::Sender<Result<aura_protocol::changes::RevertResult, SessionError>>,
    },
    Checkpointed {
        generation: u64,
        prompt: Prompt,
        turn_id: String,
        result: Result<
            crate::checkpoints::Result<aura_protocol::changes::CheckpointSummary>,
            JoinError,
        >,
    },
    Organized {
        result: Result<crate::chatstore::organization::Organization, SessionError>,
        reply: oneshot::Sender<Result<crate::chatstore::organization::Organization, SessionError>>,
    },
    NativeIdentitySaved {
        generation: u64,
        native_id: String,
        result: Result<Result<(), StoreError>, WaitError>,
    },
    Prepared {
        generation: u64,
        result: Result<Result<Prepared, StartFailure>, JoinError>,
    },
    Page {
        purpose: PageFor,
        result: Result<HistoryPage, SessionError>,
    },
    OptionReply {
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
        option_id: String,
        value: ConfigValue,
        result: Result<
            Result<Result<(), DriverError>, oneshot::error::RecvError>,
            tokio::time::error::Elapsed,
        >,
    },
    AutonomyReply {
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
        autonomy: Autonomy,
        result: Result<
            Result<Result<AutonomyState, DriverError>, oneshot::error::RecvError>,
            tokio::time::error::Elapsed,
        >,
    },
    DriverJoined {
        generation: u64,
        result: Result<DriverExit, JoinError>,
    },
    /// A FORCE chain on a process of a retired generation ended.
    Retired(u64),
    Abort(AbortHandle),
    Nothing,
}

/// A prompt about to be sent.
struct Prompt {
    parts: Vec<PromptPart>,
    id: String,
    text: String,
    created_at: Millis,
}

/// One chat's actor.
pub(crate) struct ChatActor {
    chat_id: String,
    shared: Arc<Shared>,
    store: Arc<ChatStore>,
    book: Arc<ProcessBook>,
    spec: Option<AgentSpec>,
    chat: ChatRecord,
    status: SessionStatus,
    detail: Option<String>,
    info_dirty: bool,
    revision: u32,
    batcher: FrameBatcher,
    /// About how many bytes the batcher holds; past a quarter of the outbox bound it flushes at
    /// once, so the outbox bound (and with it the backpressure) engages during a flood.
    batched_bytes: usize,
    normalizer: Normalizer,
    subscribers: Vec<Subscriber>,
    queue: Vec<QueuedRow>,
    turn: Option<OpenTurn>,
    /// The turn row of the turn whose `TurnStarted` is not flushed yet.
    begun: Option<TurnRow>,
    ordinal: u32,
    outbox: VecDeque<Op>,
    outbox_bytes: usize,
    driver: Option<LiveDriver>,
    preparing: Option<Preparing>,
    progress: Option<mpsc::UnboundedReceiver<String>>,
    in_flight: FuturesUnordered<BoxFuture<'static, Done>>,
    organizing: bool,
    steering_pending: bool,
    git_reservation: Option<String>,
    checkpointing: Option<(String, AbortHandle)>,
    generation: u64,
    /// Generations force-stopped or crashed whose processes or task still wind down, with how many
    /// FORCE chains and joins each still waits for. They keep the chat's live slot and native
    /// sessions, and a new start waits for them.
    retiring: Vec<(u64, usize)>,
    /// How many generations retire, for the preparation of a start to wait on.
    winding_down: watch::Sender<usize>,
    agent_session: Option<AgentSessionRow>,
    continuation: Option<crate::chatstore::conversation::PendingContinuation>,
    autonomy: Autonomy,
    autonomy_state: AutonomyState,
    desired: BTreeMap<String, ConfigValue>,
    options: Vec<ConfigOption>,
    commands: Vec<SlashCommand>,
    capabilities: Option<Capabilities>,
    agent_name: Option<String>,
    agent_version: Option<String>,
    native_session_id: Option<String>,
    /// The row save outlives a driver generation, so stop/restart cannot bypass persistence.
    native_identity_pending: Option<NativeIdentitySave>,
    usage: Option<UsageInfo>,
    limits: Option<Vec<LimitWindow>>,
    last_error: Option<ErrorInfo>,
    auth: Option<AuthPrompt>,
    folder_state: FolderState,
    replay_check: Option<ReplayCheck>,
    needs_attention: bool,
    /// Requests the user answered lately, for a withdrawal that crossed the answer.
    answered: VecDeque<(String, String, Option<Arc<str>>)>,
    next_flush: Option<Instant>,
    force_wait: Option<(Instant, u64)>,
    stop_deadline: Option<(Instant, u64)>,
    idle_deadline: Option<Instant>,
    last_activity: Instant,
    quitting: bool,
    shutdown_reply: Option<oneshot::Sender<()>>,
    /// A start (fresh or not) to begin once the live driver stopped.
    pending_start: Option<bool>,
    /// The current start is a Start fresh.
    starting_fresh: bool,
    /// The native session the agent returned at `Ready` is open in another chat: the start fails
    /// once the driver stopped.
    conflict: bool,
}

impl ChatActor {
    fn new(
        chat_id: String,
        shared: Arc<Shared>,
        book: Arc<ProcessBook>,
        load: ChatLoad,
    ) -> ChatActor {
        let ChatLoad {
            continuation,
            chat,
            next_seq,
            next_turn_ordinal,
            agent_session,
            queue,
            recovered_turns,
            replay_check,
        } = load;
        if recovered_turns > 0 {
            tracing::info!(
                chat_id,
                recovered_turns,
                "recovered turns a stopped actor left running"
            );
        }
        let spec = shared.deps.detector.spec(&chat.agent_id);
        let autonomy = agent_session
            .as_ref()
            .map_or_else(Autonomy::default, |session| session.autonomy);
        let desired = agent_session
            .as_ref()
            .and_then(|session| session.config_json.as_deref())
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_default();
        let store = Arc::clone(&shared.deps.store);
        let replay_check = replay_check.filter(|_| {
            !continuation
                .as_ref()
                .is_some_and(|value| value.force_fresh || value.native_start.fork)
        });
        ChatActor {
            continuation,
            batcher: FrameBatcher::new(chat_id.clone()).starting_at(next_seq),
            batched_bytes: 0,
            chat_id,
            store,
            book,
            spec,
            status: SessionStatus::Stopped,
            detail: None,
            info_dirty: false,
            revision: 0,
            normalizer: Normalizer::default(),
            subscribers: Vec::new(),
            queue,
            turn: None,
            begun: None,
            ordinal: next_turn_ordinal.saturating_sub(1),
            outbox: VecDeque::new(),
            outbox_bytes: 0,
            driver: None,
            preparing: None,
            progress: None,
            in_flight: FuturesUnordered::new(),
            organizing: false,
            steering_pending: false,
            git_reservation: None,
            checkpointing: None,
            generation: 0,
            retiring: Vec::new(),
            winding_down: watch::Sender::new(0),
            agent_session,
            autonomy,
            autonomy_state: stopped_autonomy(autonomy, None),
            desired,
            options: Vec::new(),
            commands: Vec::new(),
            capabilities: None,
            agent_name: None,
            agent_version: None,
            native_session_id: None,
            native_identity_pending: None,
            usage: None,
            limits: None,
            last_error: None,
            auth: None,
            folder_state: FolderState::Ok,
            replay_check,
            needs_attention: false,
            answered: VecDeque::new(),
            next_flush: None,
            force_wait: None,
            stop_deadline: None,
            idle_deadline: None,
            last_activity: Instant::now(),
            quitting: false,
            shutdown_reply: None,
            pending_start: None,
            starting_fresh: false,
            conflict: false,
            shared,
            chat,
        }
    }

    async fn run(mut self, mut mailbox: mpsc::UnboundedReceiver<ChatMsg>) {
        self.publish();
        loop {
            // A flush that is due runs before anything else is read: a timer set for "now" only
            // fires on a later tick of a busy runtime, and the outbox bound must see the flush.
            if self.next_flush.is_some_and(|at| at <= Instant::now()) {
                self.flush();
            }
            let flush_at = self.next_flush;
            let timer_at = self.next_timer();
            let reading = self.reading_events();
            let head = self.outbox.front().map(op_bytes);
            tokio::select! {
                biased;
                msg = mailbox.recv() => match msg {
                    Some(msg) => self.on_msg(msg),
                    None => break,
                },
                Some(done) = self.in_flight.next(), if !self.in_flight.is_empty() => self.on_done(done),
                () = sleep_until(flush_at), if flush_at.is_some() => self.flush(),
                () = sleep_until(timer_at), if timer_at.is_some() => self.on_timer(),
                permit = self.store.reserve(head.unwrap_or(1)), if head.is_some() => match permit {
                    Ok(permit) => {
                        if let Some(op) = self.outbox.pop_front() {
                            self.outbox_bytes = self.outbox_bytes.saturating_sub(op_bytes(&op));
                            permit.send(op);
                        }
                    }
                    Err(_) => self.store_closed(),
                },
                event = next_event(&mut self.driver), if reading => match event {
                    Some(event) => self.on_driver_event(event),
                    None => self.on_events_closed(),
                },
                detail = next_progress(&mut self.progress), if self.progress.is_some() => match detail {
                    Some(detail) => self.set_detail(Some(detail)),
                    None => self.progress = None,
                },
            }
            self.update_idle();
            self.finish_shutdown();
        }
        // The manager is gone: dropping the driver's command sender closes it (a shutdown with no
        // grace), and the recorded processes die with their last handles.
        self.book.kill_all();
    }

    fn reading_events(&self) -> bool {
        self.driver
            .as_ref()
            .is_some_and(|driver| driver.events.is_some())
            && self.outbox_bytes < self.shared.knobs.outbox_bytes
    }

    fn next_timer(&self) -> Option<Instant> {
        [
            self.force_wait.map(|(at, _)| at),
            self.stop_deadline.map(|(at, _)| at),
            self.idle_deadline,
        ]
        .into_iter()
        .flatten()
        .min()
    }

    // ---- IPC messages -------------------------------------------------------------------------

    fn on_msg(&mut self, msg: ChatMsg) {
        match msg {
            ChatMsg::ReserveGit { id, reply } => {
                let result = if self.organizing
                    || self.steering_pending
                    || self.driver.is_some()
                    || self.preparing.is_some()
                    || !self.retiring.is_empty()
                    || self.checkpointing.is_some()
                    || self.turn.is_some()
                    || !self.queue.is_empty()
                    || self.pending_start.is_some()
                    || self.native_identity_pending.is_some()
                    || self.quitting
                    || self.shared.is_shutting_down()
                {
                    Err(SessionError::Organization("Stop affected chats and clear their queued prompts before changing Git worktrees.".into()))
                } else if self.store.is_paused() {
                    Err(SessionError::StorageUnavailable(
                        "Wait for saving to resume before changing Git worktrees.".into(),
                    ))
                } else {
                    self.organizing = true;
                    self.git_reservation = Some(id.clone());
                    Ok(())
                };
                if reply.send(result).is_err() && self.git_reservation.as_deref() == Some(&id) {
                    self.git_reservation = None;
                    self.organizing = false;
                }
            }
            ChatMsg::ReleaseGit { id } => {
                if self.git_reservation.as_deref() == Some(&id) {
                    self.git_reservation = None;
                    self.organizing = false;
                }
            }
            ChatMsg::Conversation { command, reply } => self.conversation_read(command, reply),
            ChatMsg::Continue {
                apply,
                prompt,
                reply,
            } => self.continue_chat(apply, prompt, reply),
            ChatMsg::CheckpointContext { turn_id, reply } => {
                self.flush();
                let barrier = if self.store.is_paused() {
                    None
                } else {
                    let (saved, barrier) = oneshot::channel();
                    self.queue_op(Op::Barrier(saved));
                    Some(barrier)
                };
                let store = Arc::clone(&self.store);
                let rt = self.shared.deps.rt.clone();
                let chat_id = self.chat_id.clone();
                self.in_flight.push(
                    async move {
                        let result = async {
                            if let Some(barrier) = barrier {
                                await_reply(&rt, barrier, Duration::from_secs(5))
                                    .await
                                    .map_err(|_| {
                                        SessionError::StorageUnavailable(
                                            "Checkpoint history is still saving. Try again.".into(),
                                        )
                                    })?;
                            }
                            store
                                .checkpoint_context(&chat_id, turn_id)
                                .await
                                .map_err(|error| storage_error(&error))
                        }
                        .await;
                        Done::CheckpointContext { result, reply }
                    }
                    .boxed(),
                );
            }
            ChatMsg::Revert {
                token,
                guard,
                reply,
            } => self.revert(token, guard, reply),
            ChatMsg::Organize { command, reply } => self.organize(command, reply),
            ChatMsg::Attach {
                sink,
                subscription_id,
                reply,
            } => self.attach(sink, subscription_id, reply),
            ChatMsg::Detach { subscription_id } => {
                self.subscribers
                    .retain(|subscriber| subscriber.id != subscription_id);
                self.shared.forget_subscription(&subscription_id);
            }
            ChatMsg::DropOwner { owner } => {
                let dropped: Vec<String> = self
                    .subscribers
                    .iter()
                    .filter(|subscriber| subscriber.owner == owner)
                    .map(|subscriber| subscriber.id.clone())
                    .collect();
                self.subscribers
                    .retain(|subscriber| subscriber.owner != owner);
                for id in dropped {
                    self.shared.forget_subscription(&id);
                }
            }
            ChatMsg::History {
                before_seq,
                max_bytes,
                reply,
            } => {
                self.flush();
                self.read_page(before_seq, max_bytes, PageFor::History { reply });
            }
            ChatMsg::Lists { reply } => drop(reply.send(Ok(self.lists()))),
            ChatMsg::Send { text, parts, reply } => {
                let ack = self.send(text, parts);
                drop(reply.send(ack));
            }
            ChatMsg::Steer {
                expected_turn_id,
                text,
                parts,
                reply,
            } => self.steer(expected_turn_id, text, parts, reply),
            ChatMsg::CancelQueued { prompt_id, reply } => {
                let result = self.cancel_queued(&prompt_id);
                drop(reply.send(result));
            }
            ChatMsg::ResumeQueue { reply } => {
                self.resume_queue();
                drop(reply.send(Ok(())));
            }
            ChatMsg::Interrupt { reply } => {
                self.interrupt();
                drop(reply.send(Ok(())));
            }
            ChatMsg::ForceStop { reply } => {
                self.force_stop();
                drop(reply.send(Ok(())));
            }
            ChatMsg::Start {
                fresh,
                explicit,
                reply,
            } => {
                let result = self.start(fresh, explicit);
                drop(reply.send(result));
            }
            ChatMsg::Stop { reply } => {
                // A start asked for while the agent stops (Start fresh, say) gives way to the Stop.
                self.pending_start = None;
                self.stop();
                drop(reply.send(Ok(())));
            }
            ChatMsg::RespondPermission {
                request_id,
                option_id,
                reply,
            } => {
                let result = self.respond_permission(&request_id, option_id);
                drop(reply.send(result));
            }
            ChatMsg::RespondUi {
                request_id,
                answer,
                reply,
            } => {
                let result = self.respond_ui(&request_id, answer);
                drop(reply.send(result));
            }
            ChatMsg::SetOption {
                option_id,
                value,
                reply,
            } => self.set_option(option_id, value, reply),
            ChatMsg::SetAutonomy { autonomy, reply } => self.set_autonomy(autonomy, reply),
            ChatMsg::Blob { sha256, reply } => {
                let barrier = self.blob_barrier(&sha256);
                drop(reply.send(barrier));
            }
            ChatMsg::Shutdown { plan, reply } => self.shutdown(plan, reply),
            #[cfg(test)]
            ChatMsg::Panic => panic!("a test asked the chat actor to panic"),
        }
    }

    fn attach(
        &mut self,
        sink: Arc<dyn FrameSink>,
        subscription_id: String,
        reply: oneshot::Sender<Result<ChatAttach, SessionError>>,
    ) {
        let owner = sink.owner().to_owned();
        // One view per chat per webview: a new attach replaces the webview's older subscription.
        let replaced: Vec<String> = self
            .subscribers
            .iter()
            .filter(|subscriber| subscriber.owner == owner)
            .map(|subscriber| subscriber.id.clone())
            .collect();
        self.subscribers
            .retain(|subscriber| subscriber.owner != owner);
        for id in replaced {
            self.shared.forget_subscription(&id);
        }
        if self.subscribers.len() >= self.shared.deps.limits.subscribers_per_chat {
            self.shared.forget_subscription(&subscription_id);
            drop(reply.send(Err(SessionError::TooManySubscriptions)));
            return;
        }
        self.flush();
        let next_seq = self.batcher.next_seq();
        let snapshot = Box::new(self.snapshot());
        // Every frame this sink carries from now on starts at or after `next_seq`.
        self.subscribers.push(Subscriber {
            id: subscription_id.clone(),
            owner,
            sink,
        });
        self.read_page(
            next_seq,
            crate::chatstore::history::clamp_page_bytes(None),
            PageFor::Attach {
                reply,
                subscription_id,
                next_seq,
                snapshot,
            },
        );
    }

    /// Starts a page read behind every write queued so far, or from saved rows while paused.
    fn read_page(&mut self, before_seq: u32, max_bytes: usize, purpose: PageFor) {
        let limit = self.shared.deps.timings.attach_timeout;
        let read: BoxFuture<'static, Result<HistoryPage, SessionError>> = if self.store.is_paused()
        {
            let unsaved = self.outbox_first_seq(before_seq);
            let store = Arc::clone(&self.store);
            let chat_id = self.chat_id.clone();
            async move {
                let mut page = store
                    .read_saved_page(&chat_id, before_seq, max_bytes)
                    .await
                    .map_err(|error| storage_error(&error))?;
                page.unsaved_from = match (page.unsaved_from, unsaved) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    (a, b) => a.or(b),
                };
                Ok(page)
            }
            .boxed()
        } else {
            let (reply, answer) = oneshot::channel();
            self.queue_op(Op::ReadPage {
                chat_id: self.chat_id.clone(),
                before_seq,
                max_bytes,
                reply,
            });
            let rt = self.shared.deps.rt.clone();
            async move {
                match await_reply(&rt, answer, limit).await {
                    Ok(Ok(page)) => Ok(page),
                    Ok(Err(error)) => Err(storage_error(&error)),
                    Err(WaitError::TimedOut) => Err(SessionError::StorageUnavailable(
                        "it did not answer in time".into(),
                    )),
                    Err(WaitError::Gone) => Err(SessionError::StorageUnavailable(
                        StoreError::Closed.to_string(),
                    )),
                }
            }
            .boxed()
        };
        self.in_flight.push(
            async move {
                Done::Page {
                    purpose,
                    result: read.await,
                }
            }
            .boxed(),
        );
    }

    /// A blob a frame named may still wait in the outbox, its `PutBlob` behind other ops: then the
    /// store knows nothing of it yet. While saving is paused that reads as not saved yet; otherwise
    /// the read waits for a barrier queued behind it. `None`: the read can go ahead.
    fn blob_barrier(
        &mut self,
        sha256: &str,
    ) -> Result<Option<oneshot::Receiver<()>>, SessionError> {
        let unsent = self
            .outbox
            .iter()
            .any(|op| matches!(op, Op::PutBlob { sha256: queued, .. } if queued == sha256));
        if !unsent {
            return Ok(None);
        }
        if self.store.is_paused() {
            return Err(SessionError::BlobMissing(BLOB_UNSAVED.to_owned()));
        }
        let (saved, barrier) = oneshot::channel();
        self.queue_op(Op::Barrier(saved));
        Ok(Some(barrier))
    }

    /// The lowest seq below `cursor` of a row still in the outbox.
    fn outbox_first_seq(&self, cursor: u32) -> Option<u32> {
        self.outbox
            .iter()
            .filter_map(|op| match op {
                Op::AppendEvents { rows, .. } | Op::BeginTurn { rows, .. } => {
                    rows.iter().map(|row| row.seq).min()
                }
                _ => None,
            })
            .filter(|seq| *seq < cursor)
            .min()
    }

    fn conversation_read(
        &mut self,
        command: crate::chatstore::conversation::ConversationCommand,
        reply: oneshot::Sender<
            Result<crate::chatstore::conversation::ConversationReply, SessionError>,
        >,
    ) {
        if command.writes() || self.store.is_paused() {
            let _ = reply.send(Err(SessionError::StorageUnavailable(
                "Wait for saving to resume before reviewing a continuation.".into(),
            )));
            return;
        }
        self.flush();
        let (saved, barrier) = oneshot::channel();
        self.queue_op(Op::Barrier(saved));
        let store = Arc::clone(&self.store);
        let rt = self.shared.deps.rt.clone();
        self.in_flight.push(
            async move {
                let result = match await_reply(&rt, barrier, Duration::from_secs(5)).await {
                    Ok(()) => store
                        .conversation(command)
                        .await
                        .map_err(|error| storage_error(&error)),
                    Err(_) => Err(SessionError::StorageUnavailable(
                        "The conversation is still saving. Try again.".into(),
                    )),
                };
                Done::Conversation { result, reply }
            }
            .boxed(),
        );
    }

    fn continue_chat(
        &mut self,
        apply: Box<crate::chatstore::conversation::ApplyContinuation>,
        prompt: Option<(String, Vec<PromptPart>)>,
        reply: oneshot::Sender<
            Result<aura_protocol::conversation::ContinuationResult, SessionError>,
        >,
    ) {
        if self.organizing
            || self.steering_pending
            || self.driver.is_some()
            || self.preparing.is_some()
            || !self.retiring.is_empty()
            || self.checkpointing.is_some()
            || self.turn.is_some()
            || !self.queue.is_empty()
            || self.pending_start.is_some()
            || self.native_identity_pending.is_some()
            || self.quitting
            || self.shared.is_shutting_down()
        {
            let _ = reply.send(Err(SessionError::Organization(
                "Stop the chat and clear queued prompts before continuing from history.".into(),
            )));
            return;
        }
        if self.store.is_paused() {
            let _ = reply.send(Err(SessionError::StorageUnavailable(
                "Wait for saving to resume before changing the conversation.".into(),
            )));
            return;
        }
        self.organizing = true;
        self.flush();
        let (saved, barrier) = oneshot::channel();
        self.queue_op(Op::Barrier(saved));
        let store = Arc::clone(&self.store);
        let rt = self.shared.deps.rt.clone();
        self.in_flight.push(
            async move {
                let result = async {
                    await_reply(&rt, barrier, Duration::from_secs(5))
                        .await
                        .map_err(|_| {
                            SessionError::StorageUnavailable(
                                "The conversation is still saving. Try again.".into(),
                            )
                        })?;
                    let result = store
                        .conversation(crate::chatstore::conversation::ConversationCommand::Apply(
                            apply,
                        ))
                        .await
                        .map_err(|error| storage_error(&error))?;
                    let crate::chatstore::conversation::ConversationReply::Applied(load) = result
                    else {
                        return Err(SessionError::Internal(
                            "The continuation result was invalid.".into(),
                        ));
                    };
                    Ok(load)
                }
                .await;
                Done::Continued {
                    result,
                    prompt,
                    reply,
                }
            }
            .boxed(),
        );
    }

    fn continued(
        &mut self,
        result: Result<Box<ChatLoad>, SessionError>,
        prompt: Option<(String, Vec<PromptPart>)>,
        reply: oneshot::Sender<
            Result<aura_protocol::conversation::ContinuationResult, SessionError>,
        >,
    ) {
        self.organizing = false;
        let result = result.and_then(|load| {
            let id = load.chat.id.clone();
            if id != self.chat_id {
                self.push(AuraEvent::Notice { level: NoticeLevel::Info, message: format!("Created a fork linked to this conversation: {id}. This source conversation is unchanged.") }, None);
                self.flush();
                return Ok(aura_protocol::conversation::ContinuationResult { chat_id: id, prompt: None });
            }
            self.chat = load.chat;
            self.agent_session = load.agent_session;
            self.continuation = load.continuation;
            self.replay_check = load.replay_check.filter(|_| !self.continuation.as_ref().is_some_and(|value| value.force_fresh || value.native_start.fork));
            self.spec = self.shared.deps.detector.spec(&self.chat.agent_id);
            self.autonomy = self.agent_session.as_ref().map_or_else(Autonomy::default, |session| session.autonomy);
            self.desired = self.agent_session.as_ref().and_then(|session| session.config_json.as_deref()).and_then(|json| serde_json::from_str(json).ok()).unwrap_or_default();
            self.autonomy_state = stopped_autonomy(self.autonomy, None);
            self.options.clear();
            self.commands.clear();
            self.capabilities = None;
            self.native_session_id = None;
            self.agent_name = None;
            self.agent_version = None;
            self.usage = None;
            self.limits = None;
            self.last_error = None;
            self.auth = None;
            self.conflict = false;
            self.set_status(SessionStatus::Stopped, Some("Continuation saved. The next prompt includes its visible handoff.".into()));
            self.push(AuraEvent::Notice { level: NoticeLevel::Info, message: format!("Continuing with {}. Earlier messages remain intact; the reviewed context will appear in the next user prompt.",self.chat.agent_id) }, None);
            self.flush();
            let ack = prompt.map(|(text,parts)| self.send(text,parts)).transpose()?;
            Ok(aura_protocol::conversation::ContinuationResult { chat_id: id, prompt: ack })
        });
        let _ = reply.send(result);
    }

    fn revert(
        &mut self,
        token: String,
        guard: Arc<super::changes::FolderMutation>,
        reply: oneshot::Sender<Result<aura_protocol::changes::RevertResult, SessionError>>,
    ) {
        if self.organizing
            || self.steering_pending
            || self.driver.is_some()
            || self.preparing.is_some()
            || !self.retiring.is_empty()
            || self.checkpointing.is_some()
            || self.turn.is_some()
            || !self.queue.is_empty()
            || self.quitting
            || self.shared.is_shutting_down()
        {
            let _ = reply.send(Err(SessionError::Organization(
                "Stop the chat and clear queued prompts before reverting files.".into(),
            )));
            return;
        }
        let Some(service) = self.shared.deps.checkpoints.clone() else {
            let _ = reply.send(Err(SessionError::Organization(
                "Checkpoints are unavailable in this runtime.".into(),
            )));
            return;
        };
        let Some(folder_id) = self.chat.folder_id.clone() else {
            let _ = reply.send(Err(SessionError::Organization(
                "Locate this chat's folder before reverting files.".into(),
            )));
            return;
        };
        self.organizing = true;
        let chat_id = self.chat_id.clone();
        let folder = self.chat.folder.clone();
        self.in_flight.push(
            async move {
                let result = service
                    .revert_guarded(&chat_id, &folder_id, &folder, &token, guard)
                    .await
                    .map_err(super::changes::checkpoint_error);
                Done::Reverted { result, reply }
            }
            .boxed(),
        );
    }

    fn organize(
        &mut self,
        command: crate::chatstore::organization::OrganizationCommand,
        reply: oneshot::Sender<Result<crate::chatstore::organization::Organization, SessionError>>,
    ) {
        use crate::chatstore::organization::OrganizationCommand;
        let moving = matches!(command, OrganizationCommand::MoveChat { .. });
        if self.organizing || self.quitting || self.shared.is_shutting_down() {
            let _ = reply.send(Err(SessionError::Organization(
                "Wait for the current chat change to finish.".into(),
            )));
            return;
        }
        if moving
            && (self.steering_pending
                || self.driver.is_some()
                || self.preparing.is_some()
                || !self.retiring.is_empty()
                || self.turn.is_some()
                || !self.queue.is_empty()
                || self.native_identity_pending.is_some()
                || self.pending_start.is_some())
        {
            let _ = reply.send(Err(SessionError::Organization(
                "Stop the chat and clear queued prompts before moving it.".into(),
            )));
            return;
        }
        if self.store.is_paused() {
            let _ = reply.send(Err(SessionError::StorageUnavailable(
                "Wait for chat saving to resume before changing this chat.".into(),
            )));
            return;
        }
        self.organizing = true;
        self.flush();
        let (saved, barrier) = oneshot::channel();
        self.queue_op(Op::Barrier(saved));
        let store = Arc::clone(&self.store);
        let rt = self.shared.deps.rt.clone();
        self.in_flight.push(
            async move {
                // A timeout before enqueueing the mutation is safe. Once queued, only the actual
                // transaction result unlocks the actor, so a delayed folder move cannot race start.
                let result = match await_reply(&rt, barrier, Duration::from_secs(5)).await {
                    Ok(()) => store
                        .organize(command)
                        .await
                        .map_err(|error| storage_error(&error)),
                    Err(_) => Err(SessionError::StorageUnavailable(
                        "Earlier chat changes have not finished saving.".into(),
                    )),
                };
                Done::Organized { result, reply }
            }
            .boxed(),
        );
    }

    fn lists(&self) -> SessionLists {
        SessionLists {
            revision: self.revision,
            capabilities: self.capabilities.clone(),
            options: self.options.clone(),
            commands: self.commands.clone(),
            autonomy: self.autonomy_state.clone(),
        }
    }

    fn send(&mut self, text: String, parts: Vec<PromptPart>) -> Result<PromptAck, SessionError> {
        if self.organizing {
            return Err(SessionError::Organization(
                "Wait for the chat change to finish.".into(),
            ));
        }
        if self.quitting || self.shared.is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        if text.trim().is_empty() {
            return Err(SessionError::PromptEmpty);
        }
        if parts
            .iter()
            .any(|part| matches!(part, PromptPart::Image { .. }))
            && self
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| !capabilities.images)
        {
            return Err(SessionError::OptionInvalid(
                "This agent does not support images. Remove the image or choose another agent."
                    .into(),
            ));
        }
        let limit = self.shared.deps.limits.max_prompt_bytes;
        let bytes = text.len()
            + self.continuation.as_ref().map_or(0, |value| {
                if value.handoff.is_empty() {
                    0
                } else {
                    value.handoff.len() + 32
                }
            });
        if bytes > limit {
            return Err(SessionError::PromptTooLarge { bytes, limit });
        }
        if self.batcher.next_seq() > SEQ_LIMIT {
            return Err(SessionError::Internal(
                "This chat is too long to continue; start a new chat.".into(),
            ));
        }
        let prompt_id = new_id();
        let now = now_millis();
        if self.can_dispatch() {
            self.dispatch(Prompt {
                id: prompt_id.clone(),
                parts,
                text,
                created_at: now,
            });
            return Ok(PromptAck {
                prompt_id,
                queued: self.shared.deps.checkpoints.is_some(),
            });
        }
        let max_queue = self.shared.deps.limits.max_queue;
        if self.queue.len() >= max_queue {
            return Err(SessionError::QueueFull(max_queue));
        }
        let row = QueuedRow {
            id: prompt_id.clone(),
            parts,
            chat_id: self.chat_id.clone(),
            text,
            held: false,
            created_at: now,
        };
        let preview = cap_chars(row.text.clone(), PREVIEW_CHARS);
        self.queue.push(row.clone());
        self.queue_op(Op::QueuePut(row));
        self.push(
            AuraEvent::PromptLifecycle {
                prompt_id: prompt_id.clone(),
                state: PromptState::Queued,
                preview: Some(preview),
            },
            None,
        );
        self.info_dirty = true;
        if matches!(
            self.status,
            SessionStatus::Stopped | SessionStatus::Failed | SessionStatus::AuthRequired
        ) {
            // A full slot shows as a card; the prompt stays queued.
            let _ = self.start(false, false);
        }
        Ok(PromptAck {
            prompt_id,
            queued: true,
        })
    }

    /// `Ready` with no turn: a prompt goes out now.
    fn can_dispatch(&self) -> bool {
        !self.organizing
            && !self.steering_pending
            && self.checkpointing.is_none()
            && self.status == SessionStatus::Ready
            && self.turn.is_none()
            && self.native_identity_pending.is_none()
            && self.driver.as_ref().is_some_and(|driver| {
                driver.ready
                    && driver.stop == Stop::None
                    && driver.events.is_some()
                    && driver
                        .run_idle
                        .is_none_or(|idle| idle && !self.normalizer.has_open_requests())
            })
    }

    fn cancel_queued(&mut self, prompt_id: &str) -> Result<(), SessionError> {
        let Some(index) = self.queue.iter().position(|row| row.id == prompt_id) else {
            return Err(SessionError::RequestNotPending);
        };
        self.queue.remove(index);
        self.queue_op(Op::QueueRemove {
            id: prompt_id.to_owned(),
        });
        self.push(
            AuraEvent::PromptLifecycle {
                prompt_id: prompt_id.to_owned(),
                state: PromptState::Cancelled,
                preview: None,
            },
            None,
        );
        self.info_dirty = true;
        self.schedule_flush();
        Ok(())
    }

    fn resume_queue(&mut self) {
        for row in &mut self.queue {
            row.held = false;
        }
        self.queue_op(Op::QueueReleaseAll {
            chat_id: self.chat_id.clone(),
        });
        self.info_dirty = true;
        self.schedule_flush();
        match self.status {
            SessionStatus::Ready => self.dispatch_next(),
            SessionStatus::Stopped | SessionStatus::Failed | SessionStatus::AuthRequired => {
                let _ = self.start(false, false);
            }
            _ => {}
        }
    }

    /// Holds every queued row: rows typed afterwards are not held, and go first at the next `Ready`.
    fn hold_queue(&mut self) {
        if self.queue.iter().all(|row| row.held) {
            return;
        }
        for row in &mut self.queue {
            row.held = true;
        }
        self.queue_op(Op::QueueHoldAll {
            chat_id: self.chat_id.clone(),
        });
        self.info_dirty = true;
        self.schedule_flush();
    }

    fn dispatch_next(&mut self) {
        if !self.can_dispatch() {
            return;
        }
        let Some(index) = self.queue.iter().position(|row| !row.held) else {
            return;
        };
        let row = self.queue.remove(index);
        self.dispatch(Prompt {
            id: row.id,
            parts: if row.parts.is_empty() {
                vec![PromptPart::Text {
                    text: row.text.clone(),
                }]
            } else {
                row.parts
            },
            text: row.text,
            created_at: row.created_at,
        });
    }

    /// Starts a turn for `prompt`: the turn's first rows go out in one `BeginTurn` (which removes
    /// the queued row), then the prompt goes to the driver.
    fn dispatch(&mut self, prompt: Prompt) {
        let turn_id = new_id();
        let Some(checkpoints) = self.shared.deps.checkpoints.clone() else {
            self.dispatch_prepared(prompt, turn_id, None);
            return;
        };
        let row = QueuedRow {
            id: prompt.id.clone(),
            chat_id: self.chat_id.clone(),
            text: prompt.text.clone(),
            parts: prompt.parts.clone(),
            held: false,
            created_at: prompt.created_at,
        };
        self.queue.push(row.clone());
        self.queue_op(Op::QueuePut(row));
        self.push(
            AuraEvent::PromptLifecycle {
                prompt_id: prompt.id.clone(),
                state: PromptState::Queued,
                preview: Some(cap_chars(prompt.text.clone(), PREVIEW_CHARS)),
            },
            None,
        );
        let chat_id = self.chat_id.clone();
        let folder = self.chat.folder.clone();
        let folder_id = self.chat.folder_id.clone();
        let captured_turn = turn_id.clone();
        let task = self.shared.deps.rt.spawn(async move {
            let folder_id = folder_id.ok_or_else(|| {
                crate::checkpoints::CheckpointError::Message(
                    "Locate this chat's folder before saving a checkpoint.".into(),
                )
            })?;
            checkpoints
                .capture(&chat_id, &folder_id, &folder, &captured_turn)
                .await
        });
        self.checkpointing = Some((prompt.id.clone(), task.abort_handle()));
        let generation = self.generation;
        self.in_flight.push(
            async move {
                Done::Checkpointed {
                    generation,
                    prompt,
                    turn_id,
                    result: task.await,
                }
            }
            .boxed(),
        );
        self.set_status(
            SessionStatus::Running,
            Some("Saving checkpoint before sending the prompt".into()),
        );
        self.flush();
    }

    fn dispatch_prepared(
        &mut self,
        mut prompt: Prompt,
        turn_id: String,
        checkpoint_ref: Option<String>,
    ) {
        if self.driver.is_none() {
            return;
        }
        let continuation_prefix = if let Some(continuation) = &mut self.continuation
            && !continuation.handoff.is_empty()
        {
            let handoff = std::mem::take(&mut continuation.handoff);
            let prefix = format!("{handoff}\n\nCurrent user prompt\n");
            prompt.text = format!("{prefix}{}", prompt.text);
            prompt.parts.insert(
                0,
                PromptPart::Text {
                    text: prefix.clone(),
                },
            );
            Some(prefix)
        } else {
            None
        };
        let Some(driver) = &mut self.driver else {
            return;
        };
        let commands = driver.commands.clone();
        if driver.run_idle.is_some() {
            driver.run_idle = Some(false);
        }
        self.queue.retain(|row| row.id != prompt.id);
        self.ordinal = self.ordinal.saturating_add(1);
        let tag: Arc<str> = Arc::from(turn_id.as_str());
        let started_at = now_millis();
        self.begun = Some(TurnRow {
            continuation_prefix,
            checkpoint_ref,
            parts: prompt.parts.clone(),
            id: turn_id.clone(),
            chat_id: self.chat_id.clone(),
            agent_session_id: self
                .agent_session
                .as_ref()
                .map(|session| session.id.clone()),
            ordinal: self.ordinal,
            prompt_id: prompt.id.clone(),
            first_event_seq: 0,
            started_at,
        });
        self.turn = Some(OpenTurn {
            parts: prompt.parts.clone(),
            id: turn_id.clone(),
            tag: Arc::clone(&tag),
            prompt_id: prompt.id.clone(),
            text: prompt.text.clone(),
            prompt_created_at: prompt.created_at,
            started: Instant::now(),
            interrupt_requested: false,
            reply: ReplyHasher::default(),
        });
        let tagged = Some(tag);
        self.push_normalized(
            AuraEvent::TurnStarted {
                turn_id: turn_id.clone(),
                prompt_id: Some(prompt.id.clone()),
            },
            tagged.clone(),
        );
        self.push_normalized(
            AuraEvent::UserMessageDelta {
                message_id: format!("{turn_id}.u"),
                text: prompt.text.clone(),
            },
            tagged.clone(),
        );
        self.push_normalized(
            AuraEvent::PromptLifecycle {
                prompt_id: prompt.id,
                state: PromptState::Started,
                preview: None,
            },
            tagged,
        );
        if self.chat.title.is_none() {
            let title = first_line(&prompt.text);
            if !title.is_empty() {
                self.set_title(title, TitleSource::FirstLine);
            }
        }
        self.queue_op(Op::TouchChat {
            chat_id: self.chat_id.clone(),
            at: started_at,
        });
        self.chat.updated_at = self.chat.updated_at.max(started_at);
        self.status = SessionStatus::Running;
        self.detail = None;
        self.info_dirty = true;
        self.flush();
        self.publish();
        self.last_activity = Instant::now();
        let _ = commands.send(DriverCommand::Prompt {
            turn: TurnRef { turn_id },
            parts: prompt.parts,
        });
    }

    fn set_title(&mut self, title: String, source: TitleSource) {
        if self.chat.title_source == Some(TitleSource::Manual) && source != TitleSource::Manual {
            return;
        }
        if self.chat.title.as_deref() == Some(title.as_str()) {
            return;
        }
        self.chat.title = Some(title.clone());
        self.chat.title_source = Some(source);
        self.queue_op(Op::SetTitle {
            chat_id: self.chat_id.clone(),
            title,
            source,
        });
        self.info_dirty = true;
        self.schedule_flush();
        self.publish();
    }

    fn cancel_checkpoint(&mut self) {
        if let Some((_, abort)) = &self.checkpointing {
            abort.abort();
        }
    }

    fn interrupt(&mut self) {
        if self.checkpointing.is_some() {
            self.cancel_checkpoint();
            self.hold_queue();
            if self
                .driver
                .as_ref()
                .is_none_or(|driver| driver.run_idle != Some(false))
                && !self.normalizer.has_open_requests()
            {
                self.set_status(
                    SessionStatus::Ready,
                    Some("Prompt held before it reached the agent".into()),
                );
                return;
            }
        }
        match self.status {
            SessionStatus::Running => {
                let turn = self.turn.as_mut().map(|turn| {
                    turn.interrupt_requested = true;
                    (turn.id.clone(), Arc::clone(&turn.tag))
                });
                self.hold_queue();
                self.send_command(DriverCommand::Interrupt);
                if let Some((turn_id, tag)) = &turn {
                    for event in self
                        .normalizer
                        .resolve_turn_requests(turn_id, ResolvedBy::Turn)
                    {
                        self.push_normalized(event, Some(Arc::clone(tag)));
                    }
                }
                self.set_status(
                    SessionStatus::Cancelling,
                    Some(if turn.is_some() {
                        "Stopping the turn; press Esc again to force stop".into()
                    } else {
                        "Stopping background work; press Esc again to force stop".into()
                    }),
                );
                self.refresh_attention();
            }
            SessionStatus::Cancelling | SessionStatus::Starting => self.force_stop(),
            _ => {}
        }
    }

    fn force_stop(&mut self) {
        self.cancel_checkpoint();
        if !matches!(
            self.status,
            SessionStatus::Running
                | SessionStatus::Cancelling
                | SessionStatus::Ready
                | SessionStatus::Starting
                | SessionStatus::Stopping
        ) {
            return;
        }
        self.hold_queue();
        self.pending_start = None;
        if let Some(preparing) = self.preparing.take() {
            // Dropping the preparation kills a running install or probe.
            preparing.abort.abort();
            self.progress = None;
        }
        let driver_live = self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.events.is_some());
        if driver_live && self.force_wait.is_none() && self.turn.is_some() {
            let generation = self.driver.as_ref().map_or(0, |driver| driver.generation);
            if let Some(turn) = &mut self.turn {
                turn.interrupt_requested = true;
            }
            self.send_command(DriverCommand::Interrupt);
            let wait = if self.turns_survive() {
                self.shared.deps.timings.daemon_cancel_wait
            } else {
                self.shared.deps.timings.force_cancel_wait
            };
            self.force_wait = Some((Instant::now() + wait, generation));
            let detail = if self.turns_survive() {
                format!(
                    "Stopping {} turn in its gateway",
                    possessive(&self.agent_label())
                )
            } else {
                "Stopping".to_owned()
            };
            self.set_detail(Some(detail));
            return;
        }
        if self.force_wait.is_none() {
            self.force_kill();
        }
    }

    /// Force stop, step 3 on: drop the event receiver, run the FORCE chain on every recorded
    /// process, end what is still open, and reach `Stopped`.
    fn force_kill(&mut self) {
        self.force_wait = None;
        self.stop_deadline = None;
        if let Some(mut driver) = self.driver.take() {
            // No late event of this driver is ever applied.
            driver.events = None;
            let generation = driver.generation;
            let controls = self.book.close(generation);
            // Each FORCE chain and the driver's join: the generation keeps the chat's live slot and
            // native sessions until its processes are gone and its task ended.
            self.retire(generation, controls.len() + 1);
            for control in controls {
                self.in_flight.push(force_chain(generation, control));
            }
            // The join is still here, or already in `in_flight` when the event channel closed first;
            // either way its `DriverJoined` comes, at the latest once the abort below lands.
            if let Some(join) = driver.join.take() {
                self.in_flight.push(join_driver(generation, join));
            }
            let abort = driver.abort.clone();
            self.in_flight.push(
                async move {
                    tokio::time::sleep(ABORT_AFTER_KILL).await;
                    Done::Abort(abort)
                }
                .boxed(),
            );
            // Retired: its commands channel closes with it, and its exit counts as this stop.
            drop(driver.commands);
        }
        let now = now_millis();
        if let Some(turn) = self.turn.take() {
            let tag = Some(Arc::clone(&turn.tag));
            for event in self.normalizer.close_turn(&turn.id, ResolvedBy::Turn, now) {
                self.push_normalized(event, tag.clone());
            }
            self.push_normalized(
                AuraEvent::TurnEnded {
                    turn_id: turn.id.clone(),
                    stop_reason: StopReason::Interrupted,
                    usage: None,
                    duration_ms: Some(elapsed_ms(turn.started)),
                    recovered: false,
                },
                tag.clone(),
            );
            self.push_normalized(
                AuraEvent::PromptLifecycle {
                    prompt_id: turn.prompt_id.clone(),
                    state: PromptState::Cancelled,
                    preview: None,
                },
                tag.clone(),
            );
            self.push(
                AuraEvent::Notice {
                    level: NoticeLevel::Warning,
                    message: "Force stopped: auracode ended the agent's processes.".into(),
                },
                tag.as_deref(),
            );
            if self.turns_survive() {
                let message = format!(
                    "{} may still finish this turn in its gateway; auracode asked it to cancel. Whatever it finishes shows when this chat resumes.",
                    self.agent_label()
                );
                self.push(
                    AuraEvent::Notice {
                        level: NoticeLevel::Warning,
                        message,
                    },
                    tag.as_deref(),
                );
            }
        }
        for event in self.normalizer.close_untagged(ResolvedBy::System, now) {
            self.push_normalized(event, None);
        }
        self.release_if_idle();
        self.set_status(SessionStatus::Stopped, None);
        self.refresh_attention();
        self.flush();
    }

    fn stop(&mut self) {
        self.cancel_checkpoint();
        // Every Stop holds what is queued until now, one that repeats a stop in progress included: a
        // prompt typed while the agent stops is not held, and would start it again once it stopped.
        self.hold_queue();
        match self.status {
            SessionStatus::Stopped
            | SessionStatus::Failed
            | SessionStatus::AuthRequired
            | SessionStatus::Stopping => {
                return;
            }
            _ => {}
        }
        if self.driver.is_none() {
            if let Some(preparing) = self.preparing.take() {
                preparing.abort.abort();
                self.progress = None;
            }
            self.release_if_idle();
            self.set_status(SessionStatus::Stopped, None);
            return;
        }
        if let Some(turn) = &mut self.turn {
            turn.interrupt_requested = true;
        }
        let grace = if self.turns_survive() {
            self.shared.deps.timings.daemon_cancel_wait
        } else {
            self.shared.deps.timings.stop_cancel_grace
        };
        self.graceful_stop(
            StopPlan {
                cancel_grace: grace,
                process: ShutdownPlan::STANDARD,
            },
            false,
        );
    }

    /// Sends `Shutdown`; a stop not done in time is forced.
    fn graceful_stop(&mut self, plan: StopPlan, auth: bool) {
        let Some(driver) = &mut self.driver else {
            return;
        };
        if driver.stop != Stop::None {
            return;
        }
        driver.stop = Stop::Graceful { auth };
        let generation = driver.generation;
        let _ = driver.commands.send(DriverCommand::Shutdown { plan });
        self.stop_deadline = Some((
            Instant::now() + self.shared.deps.timings.stop_kill_after,
            generation,
        ));
        self.set_status(SessionStatus::Stopping, Some("Stopping".into()));
    }

    fn turns_survive(&self) -> bool {
        self.spec
            .as_ref()
            .is_some_and(|spec| spec.turns_survive_process)
    }

    fn agent_label(&self) -> String {
        let name = self
            .spec
            .as_ref()
            .map_or_else(|| self.chat.agent_id.clone(), |spec| spec.name.to_owned());
        aura_agents::hosts::display_name(&name, &self.chat.agent_host)
    }

    /// Starts the agent. `explicit` (`chat_start`): a full slot is an error; otherwise a card.
    fn start(&mut self, fresh: bool, explicit: bool) -> Result<(), SessionError> {
        if self.steering_pending {
            return Err(SessionError::OptionInvalid(
                "Wait for steering delivery to finish before restarting.".into(),
            ));
        }
        let fresh = fresh
            || self
                .continuation
                .as_ref()
                .is_some_and(|value| value.force_fresh);
        if self.organizing {
            return Err(SessionError::Organization(
                "Wait for the chat change to finish.".into(),
            ));
        }
        if self.quitting || self.shared.is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        match self.status {
            SessionStatus::Starting => {
                if fresh && !self.starting_fresh {
                    // Start fresh instead: drop this start and begin again.
                    if let Some(preparing) = self.preparing.take() {
                        preparing.abort.abort();
                        self.progress = None;
                        self.release_if_idle();
                        self.status = SessionStatus::Stopped;
                    } else {
                        self.pending_start = Some(true);
                        self.stop();
                        return Ok(());
                    }
                } else {
                    return Ok(());
                }
            }
            SessionStatus::Ready | SessionStatus::Running | SessionStatus::Cancelling => {
                // A live agent is stopped first.
                self.pending_start = Some(fresh);
                self.stop();
                return Ok(());
            }
            SessionStatus::Stopping => {
                self.pending_start = Some(fresh);
                return Ok(());
            }
            SessionStatus::Stopped | SessionStatus::Failed | SessionStatus::AuthRequired => {}
        }
        let Some(spec) = self.spec.clone() else {
            let reason = SessionError::UnknownAgent(self.chat.agent_id.clone()).to_string();
            self.start_failed(ErrorKind::AgentUnavailable, reason, None, false);
            return Ok(());
        };
        if !fresh
            && self
                .agent_session
                .as_ref()
                .is_some_and(|session| session.host != self.chat.agent_host)
        {
            self.start_failed(ErrorKind::AgentUnavailable, "The saved session belongs to a different execution host. Start a fresh session to use this host.".into(), None, false);
            return Ok(());
        }
        if !self.shared.live.acquire(&self.chat_id) {
            if self.shared.live.quiescing() {
                return Err(SessionError::ShuttingDown);
            }
            let error = SessionError::TooManyAgents(self.shared.live.max());
            if explicit {
                return Err(error);
            }
            self.start_failed(ErrorKind::SpawnFailed, error.to_string(), None, false);
            return Ok(());
        }
        self.generation += 1;
        let generation = self.generation;
        self.starting_fresh = fresh;
        self.last_error = None;
        self.auth = None;
        let (progress, details) = mpsc::unbounded_channel();
        self.progress = Some(details);
        let folder = self.chat.folder.clone();
        let winding_down = self.winding_down.subscribe();
        let deps = &self.shared.deps;
        let task = deps.rt.spawn(prepare(
            folder,
            self.chat.agent_host.clone(),
            spec.clone(),
            Arc::clone(&deps.detector),
            Arc::clone(&deps.env),
            progress,
            winding_down,
        ));
        let abort = task.abort_handle();
        self.in_flight.push(
            async move {
                Done::Prepared {
                    generation,
                    result: task.await,
                }
            }
            .boxed(),
        );
        self.preparing = Some(Preparing {
            generation,
            abort,
            fresh,
        });
        self.set_status(
            SessionStatus::Starting,
            Some(format!("Checking {}", spec.name)),
        );
        Ok(())
    }

    fn on_prepared(
        &mut self,
        generation: u64,
        result: Result<Result<Prepared, StartFailure>, JoinError>,
    ) {
        if self
            .preparing
            .as_ref()
            .map(|preparing| preparing.generation)
            != Some(generation)
        {
            return;
        }
        let Some(preparing) = self.preparing.take() else {
            return;
        };
        self.progress = None;
        match result {
            Err(error) if error.is_cancelled() => {}
            Err(_) => self.start_failed(
                ErrorKind::Internal,
                "Preparing the agent failed inside auracode.".into(),
                None,
                false,
            ),
            Ok(Err(failure)) => {
                if let Some(state) = failure.folder {
                    self.folder_state = state;
                }
                self.start_failed(failure.kind, failure.message, None, false);
            }
            Ok(Ok(prepared)) => {
                if !self
                    .shared
                    .live
                    .set_folder(&self.chat_id, prepared.folder_key.clone())
                {
                    self.start_failed(ErrorKind::AgentUnavailable, "This folder is being reverted. Wait for the file operation to finish before starting the agent.".into(), None, false);
                    return;
                }
                self.folder_state = FolderState::Ok;
                self.spawn_driver(prepared, preparing.fresh);
            }
        }
    }

    fn spawn_driver(&mut self, prepared: Prepared, fresh: bool) {
        let Some(spec) = self.spec.clone() else {
            return;
        };
        let native_start = self
            .continuation
            .as_ref()
            .map(|value| value.native_start.clone())
            .unwrap_or_default();
        let resume = if let Some(source) = self
            .continuation
            .as_ref()
            .and_then(|value| value.resume_source.clone())
        {
            Some(source)
        } else if fresh {
            None
        } else {
            self.agent_session
                .as_ref()
                .and_then(|session| session.native_session_id.clone())
        };
        let native_scope = NativeSessionScope::local(
            spec.id,
            &self.shared.deps.device_id,
            &prepared.env,
            &prepared.launch,
            &self.chat.folder,
        );
        let claim_id = if native_start.fork {
            native_start.new_session_id.as_ref()
        } else {
            resume.as_ref()
        };
        if let Some(id) = claim_id
            && !self.shared.live.claim(&native_scope, id, &self.chat_id)
        {
            let message =
                SessionError::Internal("this session is already open in another chat".into())
                    .to_string();
            self.start_failed(ErrorKind::Internal, message, None, false);
            return;
        }
        let generation = self.generation;
        let deps = &self.shared.deps;
        let (commands, command_rx) = mpsc::unbounded_channel();
        let (events, event_rx) = event_channel();
        let spawner = Arc::new(
            SessionSpawner::new(
                aura_process::HostSpawner::new(
                    Arc::clone(&deps.spawner),
                    aura_agents::hosts::execution(&self.chat.agent_host),
                ),
                deps.logs.clone(),
                self.chat_id.clone(),
                Arc::clone(&self.book),
                generation,
            )
            .with_protocol_logging(!deps.store.encrypted()),
        );
        let setup = SessionSetup {
            attachment_dir: Some(deps.store.attachment_dir().to_path_buf()),
            attachment_reader: deps.store.attachment_reader(),
            chat_id: self.chat_id.clone(),
            agent_id: spec.id.to_owned(),
            dialect: spec.dialect.to_owned(),
            folder: self.chat.folder.clone(),
            agent_folder: self.chat.folder.to_string_lossy().into_owned(),
            add_dirs: Vec::new(),
            launch: prepared.launch,
            env: prepared.env,
            resume: resume.clone(),
            native_start,
            autonomy: self.autonomy,
            desired: self.desired.clone(),
            timings: DriverTimings::STANDARD,
            client_version: deps.app_version.clone(),
        };
        let driver = deps.drivers.create(spec.kind);
        let join = deps.rt.spawn(driver.run(DriverContext {
            commands: command_rx,
            events,
            spawner,
            setup,
        }));
        self.driver = Some(LiveDriver {
            generation,
            commands,
            events: Some(event_rx),
            abort: join.abort_handle(),
            join: Some(join),
            ready: false,
            run_idle: None,
            native_scope,
            stop: Stop::None,
            spawn_id: None,
        });
        let detail = if resume.is_some() {
            "Resuming the earlier session".to_owned()
        } else {
            format!("Starting {}", spec.name)
        };
        self.set_detail(Some(detail));
    }

    fn respond_permission(
        &mut self,
        request_id: &str,
        option_id: Option<String>,
    ) -> Result<(), SessionError> {
        let Some(card) = self.normalizer.card(request_id) else {
            return Err(SessionError::RequestNotPending);
        };
        let tag = card.tag.clone();
        let title = card.request.title.clone();
        let decision = match option_id {
            Some(option_id) => {
                if !card
                    .request
                    .options
                    .iter()
                    .any(|option| option.option_id == option_id)
                {
                    return Err(SessionError::OptionInvalid(format!(
                        "\"{option_id}\" isn't one of this request's options."
                    )));
                }
                PermissionDecision::Selected { option_id }
            }
            None => PermissionDecision::Cancelled,
        };
        let outcome = match &decision {
            PermissionDecision::Selected { option_id } => {
                PermissionOutcome::Selected(option_id.clone())
            }
            PermissionDecision::Cancelled => PermissionOutcome::Cancelled,
        };
        self.send_command(DriverCommand::RespondPermission {
            request_id: request_id.to_owned(),
            outcome,
        });
        let tag = self.open_tag(tag.as_deref());
        self.remember_answer(request_id, title, tag.clone());
        self.push(
            AuraEvent::PermissionResolved {
                request_id: request_id.to_owned(),
                decision,
                by: ResolvedBy::User,
            },
            tag.as_deref(),
        );
        self.refresh_attention();
        self.refresh_run_status();
        Ok(())
    }

    fn respond_ui(
        &mut self,
        request_id: &str,
        answer: Option<UiAnswer>,
    ) -> Result<(), SessionError> {
        let Some(question) = self.normalizer.question(request_id) else {
            return Err(SessionError::RequestNotPending);
        };
        if let Some(answer) = &answer
            && !fits(&question.request.prompt, answer)
        {
            return Err(SessionError::OptionInvalid(
                "This answer doesn't fit the question.".into(),
            ));
        }
        let tag = question.tag.clone();
        let title = prompt_message(&question.request.prompt).to_owned();
        self.send_command(DriverCommand::RespondUi {
            request_id: request_id.to_owned(),
            answer: answer.clone(),
        });
        let tag = self.open_tag(tag.as_deref());
        self.remember_answer(request_id, title, tag.clone());
        self.push(
            AuraEvent::UiResolved {
                request_id: request_id.to_owned(),
                answer,
                by: ResolvedBy::User,
            },
            tag.as_deref(),
        );
        self.refresh_attention();
        self.refresh_run_status();
        Ok(())
    }

    fn remember_answer(&mut self, request_id: &str, title: String, tag: Option<Arc<str>>) {
        self.answered.push_back((request_id.to_owned(), title, tag));
        while self.answered.len() > ANSWERED_REMEMBERED {
            self.answered.pop_front();
        }
    }

    fn set_option(
        &mut self,
        option_id: String,
        value: ConfigValue,
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    ) {
        let live = matches!(
            self.status,
            SessionStatus::Ready | SessionStatus::Running | SessionStatus::Cancelling
        ) && self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.events.is_some());
        if !live {
            drop(reply.send(Err(SessionError::SessionNotReady)));
            return;
        }
        if let Err(error) = check_option(&self.options, &option_id, &value) {
            drop(reply.send(Err(error)));
            return;
        }
        let (answer, receiver) = oneshot::channel();
        self.send_command(DriverCommand::SetOption {
            option_id: option_id.clone(),
            value: value.clone(),
            reply: answer,
        });
        self.in_flight.push(
            async move {
                Done::OptionReply {
                    reply,
                    option_id,
                    value,
                    result: tokio::time::timeout(OPTION_REPLY_TIMEOUT, receiver).await,
                }
            }
            .boxed(),
        );
    }

    fn set_autonomy(
        &mut self,
        autonomy: Autonomy,
        reply: oneshot::Sender<Result<SessionLists, SessionError>>,
    ) {
        let live = self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.events.is_some() && driver.stop == Stop::None);
        if !live {
            self.store_autonomy(
                autonomy,
                stopped_autonomy(autonomy, Some("Applies when the agent starts.")),
            );
            drop(reply.send(Ok(self.lists())));
            return;
        }
        let (answer, receiver) = oneshot::channel();
        self.send_command(DriverCommand::SetAutonomy {
            autonomy,
            reply: answer,
        });
        self.in_flight.push(
            async move {
                Done::AutonomyReply {
                    reply,
                    autonomy,
                    result: tokio::time::timeout(OPTION_REPLY_TIMEOUT, receiver).await,
                }
            }
            .boxed(),
        );
    }

    /// Records the requested level and its state, persists it, and answers what the new state
    /// would auto-answer.
    fn store_autonomy(&mut self, autonomy: Autonomy, state: AutonomyState) {
        self.autonomy = autonomy;
        if let Some(session) = &mut self.agent_session {
            session.autonomy = autonomy;
            let id = session.id.clone();
            self.queue_op(Op::UpdateAgentSession {
                id,
                patch: AgentSessionPatch {
                    capabilities: None,
                    native_session_id: None,
                    model: None,
                    effort: None,
                    autonomy: Some(autonomy),
                    config_json: None,
                    updated_at: now_millis(),
                },
            });
        }
        self.apply_autonomy_state(state);
    }

    fn apply_autonomy_state(&mut self, state: AutonomyState) {
        self.autonomy = state.requested;
        self.autonomy_state = state;
        self.revision = self.revision.wrapping_add(1);
        self.info_dirty = true;
        self.schedule_flush();
        self.answer_open_cards();
    }

    /// Every open card the current autonomy state would auto-answer is answered now.
    fn answer_open_cards(&mut self) {
        let cards: Vec<OpenCard> = self.normalizer.cards().to_vec();
        for card in cards {
            if let Decision::AutoAllow { option_id } = decide(&self.autonomy_state, &card.request) {
                self.auto_answer(&card.request, option_id, card.tag.as_deref());
            }
        }
        self.refresh_attention();
    }

    fn auto_answer(&mut self, request: &PermissionRequest, option_id: String, tag: Option<&str>) {
        self.send_command(DriverCommand::RespondPermission {
            request_id: request.request_id.clone(),
            outcome: PermissionOutcome::Selected(option_id.clone()),
        });
        let tag = self.open_tag(tag);
        self.push(
            AuraEvent::PermissionResolved {
                request_id: request.request_id.clone(),
                decision: PermissionDecision::Selected { option_id },
                by: ResolvedBy::Auto,
            },
            tag.as_deref(),
        );
    }

    fn shutdown(&mut self, plan: StopPlan, reply: oneshot::Sender<()>) {
        self.cancel_checkpoint();
        self.quitting = true;
        self.pending_start = None;
        if let Some(preparing) = self.preparing.take() {
            preparing.abort.abort();
            self.progress = None;
            self.release_if_idle();
            self.set_status(SessionStatus::Stopped, None);
        }
        let stoppable = self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.stop == Stop::None);
        if stoppable {
            self.hold_queue();
            if let Some(turn) = &mut self.turn {
                turn.interrupt_requested = true;
            }
            let grace = if self.turns_survive() {
                plan.cancel_grace
                    .max(self.shared.deps.timings.daemon_cancel_wait)
            } else {
                plan.cancel_grace
            };
            self.graceful_stop(
                StopPlan {
                    cancel_grace: grace,
                    process: plan.process,
                },
                false,
            );
        }
        self.shutdown_reply = Some(reply);
        self.flush();
    }

    /// Replies to a quit once the driver ended and everything was handed to the store.
    fn finish_shutdown(&mut self) {
        if self.shutdown_reply.is_none()
            || self.steering_pending
            || self.organizing
            || self.checkpointing.is_some()
            || self.driver.is_some()
            || self.preparing.is_some()
            || !self.outbox.is_empty()
        {
            return;
        }
        if !self.batcher.is_empty() || self.info_dirty {
            self.flush();
            if !self.outbox.is_empty() {
                return;
            }
        }
        if let Some(reply) = self.shutdown_reply.take() {
            let _ = reply.send(());
        }
    }

    // ---- In-flight completions ----------------------------------------------------------------

    fn on_done(&mut self, done: Done) {
        match done {
            Done::Steering(completion) => self.steering_done(*completion),
            Done::Conversation { result, reply } => {
                drop(reply.send(result));
            }
            Done::Continued {
                result,
                prompt,
                reply,
            } => self.continued(result, prompt, reply),
            Done::CheckpointContext { result, reply } => {
                drop(reply.send(result));
            }
            Done::Reverted { result, reply } => {
                self.organizing = false;
                if let Ok(report) = &result {
                    self.push(
                        AuraEvent::Notice {
                            level: if report.error.is_some() {
                                NoticeLevel::Warning
                            } else {
                                NoticeLevel::Info
                            },
                            message: format!(
                                "Reverted {} file(s). {}",
                                report.applied.len(),
                                report
                                    .error
                                    .as_deref()
                                    .unwrap_or("Original files were retained for recovery.")
                            ),
                        },
                        None,
                    );
                    self.flush();
                }
                let _ = reply.send(result);
            }
            Done::Checkpointed {
                generation,
                prompt,
                turn_id,
                result,
            } => {
                if !self
                    .checkpointing
                    .as_ref()
                    .is_some_and(|(id, _)| *id == prompt.id)
                {
                    return;
                }
                self.checkpointing = None;
                if generation != self.generation {
                    return;
                }
                if self
                    .driver
                    .as_ref()
                    .is_some_and(|driver| driver.ready && driver.stop == Stop::None)
                    && self.turn.is_none()
                {
                    let idle = self
                        .driver
                        .as_ref()
                        .and_then(|driver| driver.run_idle)
                        .is_none_or(|idle| idle && !self.normalizer.has_open_requests());
                    self.set_status(
                        if idle {
                            SessionStatus::Ready
                        } else {
                            SessionStatus::Running
                        },
                        None,
                    );
                }
                match result {
                    Ok(Ok(checkpoint)) => {
                        if self.can_dispatch()
                            && self
                                .queue
                                .iter()
                                .any(|row| row.id == prompt.id && !row.held)
                        {
                            if !checkpoint.warnings.is_empty() {
                                self.push(
                                    AuraEvent::Notice {
                                        level: NoticeLevel::Warning,
                                        message: format!(
                                            "Checkpoint saved with exclusions: {}",
                                            checkpoint.warnings.join("; ")
                                        ),
                                    },
                                    None,
                                );
                            }
                            self.dispatch_prepared(prompt, turn_id, Some(checkpoint.id));
                        }
                    }
                    Err(error) if error.is_cancelled() => {}
                    failed => {
                        self.hold_queue();
                        let message = match failed {
                            Ok(Err(error)) => error.to_string(),
                            _ => "Saving the checkpoint stopped unexpectedly.".into(),
                        };
                        self.push(
                            AuraEvent::Notice {
                                level: NoticeLevel::Error,
                                message: format!(
                                    "The prompt was held before reaching the agent: {message}"
                                ),
                            },
                            None,
                        );
                        self.set_detail(Some(
                            "Checkpoint failed; resolve the problem and resume queued prompts"
                                .into(),
                        ));
                    }
                }
                self.dispatch_next();
            }
            Done::Organized { result, reply } => {
                self.organizing = false;
                if let Ok(organization) = &result
                    && let Some(record) = organization
                        .chats
                        .iter()
                        .find(|record| record.chat.id == self.chat_id)
                {
                    self.chat.folder = record.chat.folder.clone();
                    self.chat.folder_id = record.chat.folder_id.clone();
                    // A live automatic title can arrive while the transaction is in flight.
                    // Only the manual title is authoritative over that newer live state.
                    if record.chat.title_source == Some(TitleSource::Manual) {
                        self.chat.title = record.chat.title.clone();
                        self.chat.title_source = record.chat.title_source;
                    }
                    self.chat.updated_at = self.chat.updated_at.max(record.chat.updated_at);
                    self.info_dirty = true;
                    self.schedule_flush();
                    self.publish();
                }
                let _ = reply.send(result);
                self.dispatch_next();
            }
            Done::NativeIdentitySaved {
                generation,
                native_id,
                result,
            } => {
                let current = self
                    .native_identity_pending
                    .as_ref()
                    .is_some_and(|pending| {
                        pending.generation == generation && pending.native_id == native_id
                    });
                if current && let Some(pending) = self.native_identity_pending.take() {
                    if matches!(result, Ok(Ok(()))) {
                        self.refresh_run_status();
                        self.dispatch_next();
                    } else {
                        if let Some(session) = &mut self.agent_session
                            && session.id == pending.row_id
                        {
                            session.native_session_id = pending.previous_id.clone();
                        }
                        if self.native_session_id.as_ref() == Some(&native_id) {
                            self.native_session_id = pending.previous_id.clone();
                        }
                        if let Some(check) = &mut self.replay_check
                            && check.native_session_id == native_id
                        {
                            if let Some(previous) = pending.previous_id {
                                check.native_session_id = previous;
                            } else {
                                self.replay_check = None;
                            }
                        }
                        self.reject_native_identity(ErrorKind::Storage, "The native session id could not be saved. Restart the session after saving is available.".into());
                    }
                }
            }
            Done::Prepared { generation, result } => self.on_prepared(generation, result),
            Done::Page { purpose, result } => self.on_page(purpose, result),
            Done::OptionReply {
                reply,
                option_id,
                value,
                result,
            } => {
                let answer = match result {
                    Ok(Ok(Ok(()))) => {
                        self.desired.insert(option_id, value);
                        self.persist_desired();
                        Ok(self.lists())
                    }
                    Ok(Ok(Err(error))) => {
                        Err(SessionError::OptionInvalid(self.redact(&error.message)))
                    }
                    Ok(Err(_)) => Err(SessionError::SessionNotReady),
                    Err(_) => Err(SessionError::OptionInvalid(
                        "The agent didn't answer in time; the option is unchanged.".into(),
                    )),
                };
                drop(reply.send(answer));
            }
            Done::AutonomyReply {
                reply,
                autonomy,
                result,
            } => {
                let state = match result {
                    Ok(Ok(Ok(state))) => state,
                    Ok(Err(_)) => {
                        stopped_autonomy(autonomy, Some("Applies when the agent starts."))
                    }
                    Ok(Ok(Err(error))) => refused_autonomy(
                        autonomy,
                        &self.agent_label(),
                        &self.redact(&error.message),
                    ),
                    Err(_) => {
                        refused_autonomy(autonomy, &self.agent_label(), "it didn't answer in time")
                    }
                };
                self.store_autonomy(autonomy, state);
                drop(reply.send(Ok(self.lists())));
            }
            Done::DriverJoined { generation, result } => self.on_driver_joined(generation, result),
            Done::Retired(generation) => self.retired_one(generation),
            Done::Abort(abort) => abort.abort(),
            Done::Nothing => {}
        }
    }

    fn on_page(&mut self, purpose: PageFor, result: Result<HistoryPage, SessionError>) {
        match purpose {
            PageFor::History { reply } => drop(reply.send(result)),
            PageFor::Attach {
                reply,
                subscription_id,
                next_seq,
                snapshot,
            } => match result {
                Ok(history) => {
                    let attach = ChatAttach {
                        subscription_id: subscription_id.clone(),
                        next_seq,
                        snapshot: *snapshot,
                        history,
                    };
                    if reply.send(Ok(attach)).is_err() {
                        // The caller gave up (its bound passed): nobody reads this subscription.
                        self.subscribers
                            .retain(|subscriber| subscriber.id != subscription_id);
                        self.shared.forget_subscription(&subscription_id);
                    }
                }
                Err(error) => {
                    self.subscribers
                        .retain(|subscriber| subscriber.id != subscription_id);
                    self.shared.forget_subscription(&subscription_id);
                    drop(reply.send(Err(error)));
                }
            },
        }
    }

    fn persist_desired(&mut self) {
        let Some(session) = &mut self.agent_session else {
            return;
        };
        let json = serde_json::to_string(&self.desired).unwrap_or_else(|_| "{}".into());
        session.config_json = Some(json.clone());
        let id = session.id.clone();
        self.queue_op(Op::UpdateAgentSession {
            id,
            patch: AgentSessionPatch {
                capabilities: None,
                native_session_id: None,
                model: None,
                effort: None,
                autonomy: None,
                config_json: Some(json),
                updated_at: now_millis(),
            },
        });
    }

    // ---- Driver events ------------------------------------------------------------------------

    fn on_driver_event(&mut self, event: DriverEvent) {
        self.last_activity = Instant::now();
        match event {
            DriverEvent::Status(status) => self.on_driver_status(status),
            DriverEvent::RunState { idle } => {
                if let Some(driver) = &mut self.driver {
                    driver.run_idle = Some(idle);
                }
            }
            DriverEvent::Ready(info) => self.on_ready(info),
            DriverEvent::NativeSessionId(native_id) => self.on_native_session_id(native_id),
            DriverEvent::Event { turn, event } => {
                if matches!(event, AuraEvent::SteeringStatus { .. }) {
                    return;
                }
                let tag = self.open_tag(turn.as_deref());
                match &event {
                    AuraEvent::MessageDelta { text, .. } => {
                        if let (Some(open), Some(_)) = (&mut self.turn, &tag) {
                            open.reply.update(text);
                        }
                    }
                    AuraEvent::UsageUpdated(usage) => self.usage = Some(usage.clone()),
                    AuraEvent::LimitsUpdated { windows } => self.limits = Some(windows.clone()),
                    _ => {}
                }
                self.push(event, tag.as_deref());
            }
            DriverEvent::TurnEnded {
                turn_id,
                stop_reason,
                usage,
                error,
            } => self.on_turn_ended(&turn_id, stop_reason, usage, error),
            DriverEvent::Permission { turn, request } => {
                self.on_permission(turn.as_deref(), request)
            }
            DriverEvent::PermissionWithdrawn { request_id } => {
                self.on_withdrawn(&request_id, false)
            }
            DriverEvent::UiRequest { turn, request } => self.on_question(turn.as_deref(), request),
            DriverEvent::UiWithdrawn { request_id } => self.on_withdrawn(&request_id, true),
            DriverEvent::Commands(commands) => {
                self.commands = commands;
                self.revision = self.revision.wrapping_add(1);
                self.info_dirty = true;
                self.schedule_flush();
            }
            DriverEvent::Options(options) => {
                self.options = options;
                self.revision = self.revision.wrapping_add(1);
                self.info_dirty = true;
                self.schedule_flush();
            }
            DriverEvent::Autonomy(state) => self.apply_autonomy_state(state),
            DriverEvent::Title(title) => {
                if let Some(title) = title
                    .map(|title| first_line(&title))
                    .filter(|title| !title.is_empty())
                {
                    self.set_title(title, TitleSource::Agent);
                }
            }
            DriverEvent::AuthRequired(prompt) => self.auth = Some(prompt),
        }
        self.refresh_run_status();
    }

    fn on_native_session_id(&mut self, native_id: String) {
        let Some(driver) = &mut self.driver else {
            return;
        };
        if !driver.ready
            || driver.stop != Stop::None
            || self.native_session_id.as_ref() == Some(&native_id)
        {
            return;
        }
        if native_id.is_empty() || native_id.chars().count() > 96 {
            self.reject_native_identity(
                ErrorKind::ProtocolError,
                "The agent reported an invalid native session id.".into(),
            );
            return;
        }
        if !self
            .shared
            .live
            .claim(&driver.native_scope, &native_id, &self.chat_id)
        {
            self.reject_native_identity(
                ErrorKind::Internal,
                SessionError::Internal("this session is already open in another chat".into())
                    .to_string(),
            );
            return;
        }
        let generation = driver.generation;
        let Some(session) = &mut self.agent_session else {
            self.reject_native_identity(
                ErrorKind::Internal,
                "The native session has no saved session row.".into(),
            );
            return;
        };
        let now = now_millis();
        self.native_identity_pending = Some(NativeIdentitySave {
            generation,
            native_id: native_id.clone(),
            row_id: session.id.clone(),
            previous_id: session.native_session_id.clone(),
        });
        session.native_session_id = Some(native_id.clone());
        session.updated_at = now;
        let row_id = session.id.clone();
        self.native_session_id = Some(native_id.clone());
        self.replay_check
            .get_or_insert_with(|| ReplayCheck {
                native_session_id: native_id.clone(),
                turns: 0,
                last_reply_sha256: None,
            })
            .native_session_id = native_id.clone();
        let (saved, acknowledgement) = oneshot::channel();
        self.queue_op(Op::SaveNativeIdentity {
            id: row_id,
            native_id: native_id.clone(),
            updated_at: now,
            reply: saved,
        });
        self.in_flight.push(
            async move {
                Done::NativeIdentitySaved {
                    generation,
                    native_id,
                    // A timed-out write may still commit later. Keep the gate until the
                    // writer acknowledges its result, even across driver stop/restart.
                    result: acknowledgement.await.map_err(|_| WaitError::Gone),
                }
            }
            .boxed(),
        );
        self.revision = self.revision.wrapping_add(1);
        self.info_dirty = true;
        self.schedule_flush();
    }

    fn reject_native_identity(&mut self, kind: ErrorKind, message: String) {
        self.hold_queue();
        self.graceful_stop(
            StopPlan {
                cancel_grace: Duration::ZERO,
                process: ShutdownPlan::STANDARD,
            },
            false,
        );
        self.conflict = true;
        if let Some(turn_id) = self.turn.as_ref().map(|turn| turn.id.clone()) {
            self.on_turn_ended(
                &turn_id,
                StopReason::Error,
                None,
                Some(DriverError {
                    kind,
                    message,
                    detail: None,
                }),
            );
        } else {
            self.last_error = Some(ErrorInfo {
                kind,
                message: message.clone(),
                detail: None,
            });
            self.push(
                AuraEvent::Error {
                    kind,
                    message,
                    detail: None,
                    recoverable: true,
                },
                None,
            );
        }
    }

    /// The open turn's tag when `turn` names it; anything else is stored outside turns.
    fn open_tag(&self, turn: Option<&str>) -> Option<Arc<str>> {
        let turn = turn?;
        match &self.turn {
            Some(open) if open.id == turn => Some(Arc::clone(&open.tag)),
            _ => {
                tracing::debug!(chat_id = %self.chat_id, turn, "an event names a turn that is not open; it is stored outside turns");
                None
            }
        }
    }

    fn on_driver_status(&mut self, status: DriverStatus) {
        if self.status != SessionStatus::Starting {
            return;
        }
        let name = self.agent_label();
        let detail = match status {
            DriverStatus::Spawning | DriverStatus::Initializing => format!("Starting {name}"),
            DriverStatus::Opening => {
                if self
                    .agent_session
                    .as_ref()
                    .is_some_and(|session| session.native_session_id.is_some())
                    && !self.starting_fresh
                {
                    "Resuming the earlier session".to_owned()
                } else {
                    format!("Starting {name}")
                }
            }
            DriverStatus::Configuring => "Applying your settings".to_owned(),
            DriverStatus::Closing => "Stopping".to_owned(),
            DriverStatus::Ready | DriverStatus::Prompting | DriverStatus::Cancelling => return,
        };
        self.set_detail(Some(detail));
    }

    fn on_ready(&mut self, info: ReadyInfo) {
        let Some(spec) = self.spec.clone() else {
            return;
        };
        let Some(driver) = &mut self.driver else {
            return;
        };
        if driver.ready || driver.stop != Stop::None {
            return;
        }
        if info.native_session_id.as_ref().is_some_and(|native_id| {
            !self
                .shared
                .live
                .claim(&driver.native_scope, native_id, &self.chat_id)
        }) {
            // Two processes on one native session would interleave one transcript.
            let message =
                SessionError::Internal("this session is already open in another chat".into())
                    .to_string();
            self.last_error = Some(ErrorInfo {
                kind: ErrorKind::Internal,
                message: message.clone(),
                detail: None,
            });
            self.push(
                AuraEvent::Error {
                    kind: ErrorKind::Internal,
                    message,
                    detail: None,
                    recoverable: true,
                },
                None,
            );
            self.graceful_stop(
                StopPlan {
                    cancel_grace: Duration::ZERO,
                    process: ShutdownPlan::STANDARD,
                },
                false,
            );
            self.conflict = true;
            return;
        }
        driver.ready = true;
        if let Some(continuation) = &mut self.continuation {
            continuation.force_fresh = false;
            continuation.resume_source = None;
            continuation.native_start = Default::default();
        }
        driver.spawn_id = Some(info.spawn_id.clone());
        let now = now_millis();
        let same_session = self
            .agent_session
            .as_ref()
            .is_some_and(|session| session.native_session_id == info.native_session_id);
        let config_json = serde_json::to_string(&self.desired).ok();
        let (model, effort) = (
            self.option_value(ConfigCategory::Model),
            self.option_value(ConfigCategory::Effort),
        );
        match (&info.resumed, &mut self.agent_session) {
            (ResumeOutcome::Resumed | ResumeOutcome::Loaded, Some(session)) if same_session => {
                session.updated_at = now;
                session.autonomy = self.autonomy;
                session.config_json = config_json.clone();
                session.capabilities = Some(info.capabilities.clone());
                let id = session.id.clone();
                self.queue_op(Op::UpdateAgentSession {
                    id,
                    patch: AgentSessionPatch {
                        capabilities: Some(info.capabilities.clone()),
                        native_session_id: None,
                        model,
                        effort,
                        autonomy: Some(self.autonomy),
                        config_json,
                        updated_at: now,
                    },
                });
            }
            _ => {
                let row = AgentSessionRow {
                    capabilities: Some(info.capabilities.clone()),
                    host: self.chat.agent_host.clone(),
                    id: new_id(),
                    chat_id: self.chat_id.clone(),
                    agent_id: spec.id.to_owned(),
                    native_session_id: info.native_session_id.clone(),
                    model,
                    effort,
                    autonomy: self.autonomy,
                    config_json,
                    cwd: self.chat.folder.clone(),
                    created_at: now,
                    updated_at: now,
                };
                self.agent_session = Some(row.clone());
                self.queue_op(Op::InsertAgentSession(row));
            }
        }
        if self.starting_fresh && info.resumed == ResumeOutcome::New {
            self.push(
                AuraEvent::Notice {
                    level: NoticeLevel::Info,
                    message:
                        "Started a new session. The agent doesn't remember the conversation above."
                            .into(),
                },
                None,
            );
        }
        self.compare_replay(&info);
        match info.native_session_id.as_ref() {
            Some(native_id)
                if self
                    .replay_check
                    .as_ref()
                    .is_none_or(|check| &check.native_session_id != native_id) =>
            {
                self.replay_check = Some(ReplayCheck {
                    native_session_id: native_id.clone(),
                    turns: 0,
                    last_reply_sha256: None,
                });
            }
            None => self.replay_check = None,
            _ => {}
        }
        self.native_session_id = info.native_session_id;
        self.agent_name = info.agent_name;
        self.agent_version = info.agent_version;
        self.capabilities = Some(info.capabilities);
        self.revision = self.revision.wrapping_add(1);
        if self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.run_idle.is_none())
        {
            self.set_status(SessionStatus::Ready, None);
        }
        self.refresh_run_status();
        self.dispatch_next();
    }

    /// Hermes' gateway can finish work while auracode is away: when the replay's newest reply
    /// differs from what was stored, or it counts more turns, the reply is shown outside any turn.
    fn compare_replay(&mut self, info: &ReadyInfo) {
        let Some(summary) = &info.replay else {
            return;
        };
        let Some(check) = &self.replay_check else {
            return;
        };
        if Some(check.native_session_id.as_str()) != info.native_session_id.as_deref() {
            return;
        }
        let Some(reply) = &summary.last_reply else {
            return;
        };
        let differs = summary.last_reply_sha256 != check.last_reply_sha256
            || summary.user_turns > check.turns;
        if !differs {
            return;
        }
        let id = format!("{}.r1", info.spawn_id);
        self.push(
            AuraEvent::Notice {
                level: NoticeLevel::Info,
                message: format!(
                    "{} continued this session while auracode was away (in its gateway or another {} app). Its latest reply is below; earlier steps aren't shown here.",
                    self.agent_label(),
                    self.agent_label()
                ),
            },
            None,
        );
        self.push(
            AuraEvent::MessageDelta {
                message_id: id.clone(),
                text: reply.clone(),
            },
            None,
        );
        self.push(AuraEvent::MessageCompleted { message_id: id }, None);
        if let Some(check) = &mut self.replay_check {
            check.last_reply_sha256 = summary.last_reply_sha256.clone();
            check.turns = check.turns.max(summary.user_turns);
        }
    }

    /// The current value of the option of `category`, if there is one.
    fn option_value(&self, category: ConfigCategory) -> Option<String> {
        self.options
            .iter()
            .find(|option| option.category == category)
            .and_then(|option| match &option.kind {
                ConfigKind::Select { current, .. } => Some(current.clone()),
                ConfigKind::Toggle { .. } => None,
            })
    }

    fn on_turn_ended(
        &mut self,
        turn_id: &str,
        stop_reason: StopReason,
        usage: Option<aura_protocol::TokenUsage>,
        error: Option<DriverError>,
    ) {
        let Some(turn) = self.turn.take_if(|turn| turn.id == turn_id) else {
            tracing::debug!(chat_id = %self.chat_id, turn_id, "a TurnEnded for a turn that is not open was ignored");
            return;
        };
        let tag = Some(Arc::clone(&turn.tag));
        let now = now_millis();
        for event in self.normalizer.close_turn(&turn.id, ResolvedBy::Turn, now) {
            self.push_normalized(event, tag.clone());
        }
        let auth = error
            .as_ref()
            .is_some_and(|error| error.kind == ErrorKind::AuthRequired);
        if let Some(error) = &error {
            let message = self.error_text(&error.message, false);
            let detail = error
                .detail
                .as_deref()
                .map(|detail| self.error_text(detail, false));
            self.last_error = Some(ErrorInfo {
                kind: error.kind,
                message: message.clone(),
                detail: detail.clone(),
            });
            self.push(
                AuraEvent::Error {
                    kind: error.kind,
                    message,
                    detail,
                    recoverable: true,
                },
                tag.as_deref(),
            );
        }
        self.push_normalized(
            AuraEvent::TurnEnded {
                turn_id: turn.id.clone(),
                stop_reason,
                usage,
                duration_ms: Some(elapsed_ms(turn.started)),
                recovered: false,
            },
            tag.clone(),
        );
        let state = match stop_reason {
            StopReason::Cancelled | StopReason::Interrupted => PromptState::Cancelled,
            StopReason::Error => PromptState::Failed,
            StopReason::EndTurn
            | StopReason::MaxTokens
            | StopReason::MaxTurnRequests
            | StopReason::Refusal
            | StopReason::Other => PromptState::Completed,
        };
        self.push_normalized(
            AuraEvent::PromptLifecycle {
                prompt_id: turn.prompt_id.clone(),
                state,
                preview: None,
            },
            tag,
        );
        self.flush();
        if let Some(check) = &mut self.replay_check
            && self.native_session_id.as_deref() == Some(check.native_session_id.as_str())
        {
            check.turns = check.turns.saturating_add(1);
            if let Some(hash) = turn.reply.clone().finish() {
                check.last_reply_sha256 = Some(hash);
            }
        }
        for control in self.book.all() {
            self.in_flight.push(
                async move {
                    control.record_escaped().await;
                    Done::Nothing
                }
                .boxed(),
            );
        }
        self.refresh_attention();
        if auth {
            // The prompt goes back into the queue, held, keeping its place; the process stops.
            let row = QueuedRow {
                id: turn.prompt_id.clone(),
                parts: turn.parts.clone(),
                chat_id: self.chat_id.clone(),
                text: turn.text.clone(),
                held: true,
                created_at: turn.prompt_created_at,
            };
            let at = self
                .queue
                .iter()
                .position(|queued| (queued.created_at, &queued.id) > (row.created_at, &row.id))
                .unwrap_or(self.queue.len());
            self.queue.insert(at, row.clone());
            self.queue_op(Op::QueuePut(row));
            self.hold_queue();
            self.graceful_stop(
                StopPlan {
                    cancel_grace: Duration::ZERO,
                    process: ShutdownPlan::STANDARD,
                },
                true,
            );
            return;
        }
        if self.force_wait.is_some() {
            self.force_kill();
            return;
        }
        if self.status == SessionStatus::Stopping {
            return;
        }
        if stop_reason == StopReason::Error && !turn.interrupt_requested {
            self.hold_queue();
        }
        if !self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.run_idle.is_some())
        {
            self.set_status(SessionStatus::Ready, None);
        }
        self.refresh_run_status();
        self.dispatch_next();
    }

    fn on_permission(&mut self, turn: Option<&str>, request: PermissionRequest) {
        let tag = self.open_tag(turn);
        let (events, blobs) = self.normalizer.apply(
            AuraEvent::PermissionRequested(request),
            tag.as_deref(),
            now_millis(),
        );
        for op in blobs {
            self.queue_op(op);
        }
        for event in events {
            let decision = match &event {
                AuraEvent::PermissionRequested(request) => {
                    Some((request.clone(), decide(&self.autonomy_state, request)))
                }
                _ => None,
            };
            self.push_normalized(event, tag.clone());
            match decision {
                Some((request, Decision::AutoAllow { option_id })) => {
                    self.auto_answer(&request, option_id, tag.as_deref());
                }
                Some((_, Decision::Ask)) => self.flush(),
                None => {}
            }
        }
        self.refresh_attention();
    }

    fn on_question(&mut self, turn: Option<&str>, request: UiRequest) {
        let tag = self.open_tag(turn);
        self.push(AuraEvent::UiRequest(request), tag.as_deref());
        self.flush();
        self.refresh_attention();
    }

    fn on_withdrawn(&mut self, request_id: &str, question: bool) {
        let open_tag = if question {
            self.normalizer
                .question(request_id)
                .map(|question| question.tag.clone())
        } else {
            self.normalizer
                .card(request_id)
                .map(|card| card.tag.clone())
        };
        match open_tag {
            Some(tag) => {
                let tag = self.open_tag(tag.as_deref());
                let event = if question {
                    AuraEvent::UiResolved {
                        request_id: request_id.to_owned(),
                        answer: None,
                        by: ResolvedBy::Agent,
                    }
                } else {
                    AuraEvent::PermissionResolved {
                        request_id: request_id.to_owned(),
                        decision: PermissionDecision::Cancelled,
                        by: ResolvedBy::Agent,
                    }
                };
                self.push(event, tag.as_deref());
                self.refresh_attention();
            }
            None => {
                // Both crossed in flight: the user's answer stands, and the withdrawal is noted.
                if let Some((_, title, tag)) = self
                    .answered
                    .iter()
                    .find(|(id, _, _)| id == request_id)
                    .cloned()
                {
                    let tag =
                        tag.filter(|tag| self.turn.as_ref().is_some_and(|turn| *turn.tag == **tag));
                    self.push(
                        AuraEvent::Notice {
                            level: NoticeLevel::Info,
                            message: format!(
                                "The agent withdrew \"{title}\" before your answer reached it."
                            ),
                        },
                        tag.as_deref(),
                    );
                }
            }
        }
    }

    fn on_events_closed(&mut self) {
        let Some(driver) = &mut self.driver else {
            return;
        };
        driver.events = None;
        let generation = driver.generation;
        if let Some(join) = driver.join.take() {
            self.in_flight.push(join_driver(generation, join));
        }
    }

    fn on_driver_joined(&mut self, generation: u64, result: Result<DriverExit, JoinError>) {
        let current = self
            .driver
            .as_ref()
            .is_some_and(|driver| driver.generation == generation);
        if !current {
            // A retired (force-stopped) driver ended: its exit counts as that stop.
            self.book.clear(generation);
            self.retired_one(generation);
            return;
        }
        let Some(driver) = self.driver.take() else {
            return;
        };
        self.stop_deadline = None;
        self.force_wait = None;
        let exit = match result {
            Ok(exit) => exit,
            Err(_) => DriverExit::Panicked,
        };
        let stopping = matches!(driver.stop, Stop::Graceful { .. });
        let auth = driver.stop == Stop::Graceful { auth: true };
        if self.conflict {
            self.conflict = false;
            self.kill_generation(generation);
            self.release_if_idle();
            self.set_status(SessionStatus::Failed, None);
            self.after_stop();
            return;
        }
        match exit {
            DriverExit::Closed if stopping => self.closed(generation, auth),
            DriverExit::Crashed { .. } | DriverExit::Panicked if stopping => {
                // It ended while being stopped: no crash card, but nothing may stay running.
                self.kill_generation(generation);
                self.closed(generation, auth);
            }
            DriverExit::Closed => {
                // `Closed` means asked to stop and did. A driver that ends on its own broke that:
                // whatever ended it may still run, and nothing queued may start the agent again.
                tracing::warn!(chat_id = %self.chat_id, "a driver closed without being asked to stop; it counts as a crash");
                self.crashed(generation, crash_message(None), None);
            }
            DriverExit::Crashed { exit, stderr_tail } => {
                let message = crash_message(exit.as_ref());
                self.crashed(generation, message, Some(stderr_tail));
            }
            DriverExit::Panicked => self.crashed(
                generation,
                "The agent stopped unexpectedly: auracode's driver for it failed.".into(),
                None,
            ),
            DriverExit::StartFailed(error) if stopping && error.kind != ErrorKind::AuthRequired => {
                self.kill_generation(generation);
                self.closed(generation, auth);
            }
            DriverExit::StartFailed(error) => self.start_failed_exit(generation, error),
        }
    }

    /// The FORCE chain on every process of `generation` (whose driver ended), then the record is
    /// cleared; the generation retires until the chains end.
    fn kill_generation(&mut self, generation: u64) {
        let controls = self.book.close(generation);
        self.retire(generation, controls.len());
        for control in controls {
            self.in_flight.push(force_chain(generation, control));
        }
        self.book.clear(generation);
    }

    /// `generation` was force-stopped or crashed: it keeps the chat's live slot and native sessions
    /// until `outstanding` more FORCE chains and joins of it have ended.
    fn retire(&mut self, generation: u64, outstanding: usize) {
        if outstanding == 0 {
            return;
        }
        match self
            .retiring
            .iter_mut()
            .find(|(retired, _)| *retired == generation)
        {
            Some((_, left)) => *left = left.saturating_add(outstanding),
            None => self.retiring.push((generation, outstanding)),
        }
        self.winding_down.send_replace(self.retiring.len());
    }

    /// A FORCE chain or the join of a retired generation ended; the last one frees what it held.
    fn retired_one(&mut self, generation: u64) {
        let Some(at) = self
            .retiring
            .iter()
            .position(|(retired, _)| *retired == generation)
        else {
            return;
        };
        let left = &mut self.retiring[at].1;
        *left = left.saturating_sub(1);
        if *left == 0 {
            self.retiring.remove(at);
            self.winding_down.send_replace(self.retiring.len());
            self.release_if_idle();
        }
    }

    /// Gives the chat's live slot and native sessions back once nothing of it runs: no driver, no
    /// start preparation, and no retired generation whose processes or task still wind down.
    fn release_if_idle(&self) {
        if !self.steering_pending
            && self.driver.is_none()
            && self.preparing.is_none()
            && self.retiring.is_empty()
        {
            self.shared.live.release(&self.chat_id);
        }
    }

    /// The driver closed as asked.
    fn closed(&mut self, generation: u64, auth: bool) {
        self.book.clear(generation);
        self.release_if_idle();
        let now = now_millis();
        if let Some(turn) = self.turn.take() {
            // The cancel grace ran out before the turn's own end.
            let tag = Some(Arc::clone(&turn.tag));
            for event in self.normalizer.close_turn(&turn.id, ResolvedBy::Turn, now) {
                self.push_normalized(event, tag.clone());
            }
            self.push_normalized(
                AuraEvent::TurnEnded {
                    turn_id: turn.id.clone(),
                    stop_reason: StopReason::Interrupted,
                    usage: None,
                    duration_ms: Some(elapsed_ms(turn.started)),
                    recovered: false,
                },
                tag.clone(),
            );
            self.push_normalized(
                AuraEvent::PromptLifecycle {
                    prompt_id: turn.prompt_id,
                    state: PromptState::Cancelled,
                    preview: None,
                },
                tag,
            );
        }
        for event in self.normalizer.close_untagged(ResolvedBy::System, now) {
            self.push_normalized(event, None);
        }
        self.refresh_attention();
        self.set_status(
            if auth {
                SessionStatus::AuthRequired
            } else {
                SessionStatus::Stopped
            },
            None,
        );
        self.flush();
        self.after_stop();
    }

    /// What follows a stop: a requested restart, or prompts typed while it stopped.
    fn after_stop(&mut self) {
        if self.quitting {
            return;
        }
        if let Some(fresh) = self.pending_start.take() {
            let _ = self.start(fresh, false);
        } else if self.status == SessionStatus::Stopped && self.queue.iter().any(|row| !row.held) {
            let _ = self.start(false, false);
        }
    }

    /// The driver ended without being asked (or panicked, or was aborted).
    fn crashed(&mut self, generation: u64, message: String, stderr_tail: Option<String>) {
        self.kill_generation(generation);
        self.release_if_idle();
        let detail = stderr_tail
            .map(|tail| self.error_text(&tail, true))
            .filter(|tail| !tail.trim().is_empty());
        let now = now_millis();
        let error = AuraEvent::Error {
            kind: ErrorKind::AgentExited,
            message: message.clone(),
            detail: detail.clone(),
            recoverable: true,
        };
        if let Some(turn) = self.turn.take() {
            let tag = Some(Arc::clone(&turn.tag));
            for event in self
                .normalizer
                .close_turn(&turn.id, ResolvedBy::System, now)
            {
                self.push_normalized(event, tag.clone());
            }
            self.push(error, tag.as_deref());
            self.push_normalized(
                AuraEvent::TurnEnded {
                    turn_id: turn.id.clone(),
                    stop_reason: StopReason::Error,
                    usage: None,
                    duration_ms: Some(elapsed_ms(turn.started)),
                    recovered: false,
                },
                tag.clone(),
            );
            self.push_normalized(
                AuraEvent::PromptLifecycle {
                    prompt_id: turn.prompt_id,
                    state: PromptState::Failed,
                    preview: None,
                },
                tag,
            );
        } else {
            self.push(error, None);
        }
        for event in self.normalizer.close_untagged(ResolvedBy::System, now) {
            self.push_normalized(event, None);
        }
        self.hold_queue();
        self.last_error = Some(ErrorInfo {
            kind: ErrorKind::AgentExited,
            message,
            detail,
        });
        self.refresh_attention();
        self.set_status(SessionStatus::Stopped, None);
        self.flush();
        self.pending_start = None;
    }

    fn start_failed_exit(&mut self, generation: u64, error: DriverError) {
        self.kill_generation(generation);
        if let Some(turn) = self.turn.take() {
            // A driver that reports a failed start mid-turn broke its contract; end the turn anyway.
            let tag = Some(Arc::clone(&turn.tag));
            for event in self
                .normalizer
                .close_turn(&turn.id, ResolvedBy::System, now_millis())
            {
                self.push_normalized(event, tag.clone());
            }
            self.push_normalized(
                AuraEvent::TurnEnded {
                    turn_id: turn.id.clone(),
                    stop_reason: StopReason::Error,
                    usage: None,
                    duration_ms: Some(elapsed_ms(turn.started)),
                    recovered: false,
                },
                tag.clone(),
            );
            self.push_normalized(
                AuraEvent::PromptLifecycle {
                    prompt_id: turn.prompt_id,
                    state: PromptState::Failed,
                    preview: None,
                },
                tag,
            );
            self.hold_queue();
        }
        let mut message = self.redact(&error.message);
        // A failed start's detail is usually the agent's stderr tail (5.3.2).
        let detail = error
            .detail
            .as_deref()
            .map(|detail| self.error_text(detail, true));
        let adapter = self
            .spec
            .as_ref()
            .is_some_and(|spec| matches!(spec.recipe, Recipe::NpmAdapter { .. }));
        let text = format!(
            "{}\n{}",
            error.message,
            error.detail.as_deref().unwrap_or_default()
        );
        if adapter
            && [
                "ERR_MODULE_NOT_FOUND",
                "MODULE_NOT_FOUND",
                "Cannot find module",
            ]
            .iter()
            .any(|marker| text.contains(marker))
            && let Some(spec) = &self.spec
        {
            self.shared.deps.detector.forget_install(spec);
            message = format!(
                "The {} adapter's files are damaged. Press Retry to download it again.",
                self.agent_label()
            );
        }
        self.start_failed(
            error.kind,
            message,
            detail,
            error.kind == ErrorKind::AuthRequired,
        );
        if let Some(fresh) = self.pending_start.take() {
            let _ = self.start(fresh, false);
        }
    }

    /// A start that failed: `Failed` (or `AuthRequired`), the card stored outside any turn. `detail`
    /// comes redacted and fitted ([`error_text`](Self::error_text)).
    fn start_failed(
        &mut self,
        kind: ErrorKind,
        message: String,
        detail: Option<String>,
        auth: bool,
    ) {
        self.release_if_idle();
        let message = self.error_text(&message, false);
        self.last_error = Some(ErrorInfo {
            kind,
            message: message.clone(),
            detail: detail.clone(),
        });
        self.push(
            AuraEvent::Error {
                kind,
                message,
                detail,
                recoverable: true,
            },
            None,
        );
        let now = now_millis();
        for event in self.normalizer.close_untagged(ResolvedBy::System, now) {
            self.push_normalized(event, None);
        }
        self.refresh_attention();
        self.set_status(
            if auth {
                SessionStatus::AuthRequired
            } else {
                SessionStatus::Failed
            },
            None,
        );
        self.flush();
    }

    fn store_closed(&mut self) {
        let dropped = self.outbox.len();
        self.outbox.clear();
        self.outbox_bytes = 0;
        if dropped > 0 {
            tracing::error!(chat_id = %self.chat_id, dropped, "auracode's database closed with ops still waiting; they are lost");
        }
    }

    // ---- Timers -------------------------------------------------------------------------------

    fn on_timer(&mut self) {
        let now = Instant::now();
        if let Some((at, generation)) = self.force_wait
            && at <= now
        {
            self.force_wait = None;
            if self
                .driver
                .as_ref()
                .is_some_and(|driver| driver.generation == generation)
            {
                self.force_kill();
            }
        }
        if let Some((at, generation)) = self.stop_deadline
            && at <= now
        {
            self.stop_deadline = None;
            if self
                .driver
                .as_ref()
                .is_some_and(|driver| driver.generation == generation)
            {
                self.force_stop();
            }
        }
        if let Some(at) = self.idle_deadline
            && at <= now
        {
            self.idle_deadline = None;
            tracing::info!(chat_id = %self.chat_id, "stopping an idle agent nobody views");
            self.stop();
        }
    }

    /// Idle eviction: `Ready`, nobody viewing, nothing open or waiting, idle long enough.
    fn update_idle(&mut self) {
        let idle = self.status == SessionStatus::Ready
            && self.turn.is_none()
            && self.subscribers.is_empty()
            && !self.normalizer.has_open_requests()
            && !self.queue.iter().any(|row| !row.held)
            && !self.quitting;
        self.idle_deadline =
            idle.then(|| self.last_activity + self.shared.deps.limits.idle_eviction);
    }

    // ---- Frames, flushing and persistence -----------------------------------------------------

    /// Normalizes `event` and queues it for the next flush, tagged `turn`.
    fn push(&mut self, event: AuraEvent, turn: Option<&str>) {
        let (events, blobs) = self.normalizer.apply(event, turn, now_millis());
        // A blob goes out before the row that names it.
        for op in blobs {
            self.queue_op(op);
        }
        let tag: TurnTag = turn.map(Arc::from);
        for event in events {
            self.push_normalized(event, tag.clone());
        }
    }

    fn push_normalized(&mut self, event: AuraEvent, tag: TurnTag) {
        let flush_now = matches!(
            event,
            AuraEvent::TurnStarted { .. }
                | AuraEvent::TurnEnded { .. }
                | AuraEvent::PermissionRequested(_)
                | AuraEvent::UiRequest(_)
                | AuraEvent::Error { .. }
        );
        self.batched_bytes = self.batched_bytes.saturating_add(approx_bytes(&event));
        self.batcher.push_tagged(event, tag);
        if flush_now || self.batched_bytes >= self.shared.knobs.outbox_bytes / 4 {
            self.next_flush = Some(Instant::now());
        } else {
            self.schedule_flush();
        }
    }

    fn schedule_flush(&mut self) {
        if self.next_flush.is_none() {
            let timings = &self.shared.deps.timings;
            let every = if self.subscribers.is_empty() {
                timings.flush_idle
            } else {
                timings.flush_live
            };
            self.next_flush = Some(Instant::now() + every);
        }
    }

    /// Sends what is queued to every subscriber and queues its rows for the store.
    fn flush(&mut self) {
        self.next_flush = None;
        self.batched_bytes = 0;
        if self.info_dirty {
            self.info_dirty = false;
            let info = self.session_info();
            let (events, _) =
                self.normalizer
                    .apply(AuraEvent::SessionUpdated(info), None, now_millis());
            for event in events {
                self.batcher.push_tagged(event, None);
            }
        }
        let frames = self.batcher.flush_tagged();
        if frames.is_empty() {
            return;
        }
        for (frame, _) in &frames {
            let mut gone = Vec::new();
            self.subscribers
                .retain(|subscriber| match subscriber.sink.send(frame) {
                    Ok(()) => true,
                    Err(SinkGone) => {
                        gone.push(subscriber.id.clone());
                        false
                    }
                });
            for id in gone {
                self.shared.forget_subscription(&id);
            }
        }
        let now = now_millis();
        let mut rows: Vec<EventRow> = Vec::new();
        let mut begin: Option<(TurnRow, Vec<EventRow>)> = None;
        for (frame, tags) in frames {
            for (offset, (event, tag)) in frame.events.into_iter().zip(tags).enumerate() {
                let seq = frame
                    .seq_start
                    .wrapping_add(u32::try_from(offset).unwrap_or(u32::MAX));
                if !event.is_stored(tag.is_some()) {
                    continue;
                }
                let row = EventRow {
                    seq,
                    turn_id: tag.as_deref().map(str::to_owned),
                    kind: event.kind(),
                    payload: serde_json::to_string(&event).unwrap_or_else(|_| "{}".into()),
                    created_at: now,
                };
                match &event {
                    AuraEvent::TurnStarted { turn_id, .. } => {
                        if let Some((turn, turn_rows)) = begin.take() {
                            self.queue_op(Op::BeginTurn {
                                turn,
                                rows: turn_rows,
                            });
                        } else if !rows.is_empty() {
                            self.queue_op(Op::AppendEvents {
                                chat_id: self.chat_id.clone(),
                                rows: std::mem::take(&mut rows),
                            });
                        }
                        match self.begun.take_if(|turn| turn.id == *turn_id) {
                            Some(mut turn) => {
                                turn.first_event_seq = seq;
                                begin = Some((turn, vec![row]));
                            }
                            None => rows.push(row),
                        }
                    }
                    AuraEvent::TurnEnded {
                        turn_id,
                        stop_reason,
                        ..
                    } => {
                        let (turn_id, stop_reason) = (turn_id.clone(), *stop_reason);
                        match &mut begin {
                            Some((_, turn_rows)) => turn_rows.push(row),
                            None => rows.push(row),
                        }
                        if let Some((turn, turn_rows)) = begin.take() {
                            self.queue_op(Op::BeginTurn {
                                turn,
                                rows: turn_rows,
                            });
                        } else if !rows.is_empty() {
                            self.queue_op(Op::AppendEvents {
                                chat_id: self.chat_id.clone(),
                                rows: std::mem::take(&mut rows),
                            });
                        }
                        self.queue_op(Op::EndTurn(TurnEnd {
                            turn_id: turn_id.clone(),
                            status: turn_status(stop_reason),
                            stop_reason,
                            ended_at: now,
                            last_event_seq: seq,
                        }));
                        self.queue_op(Op::TouchChat {
                            chat_id: self.chat_id.clone(),
                            at: now,
                        });
                        self.queue_op(Op::CompactTurn {
                            chat_id: self.chat_id.clone(),
                            turn_id,
                        });
                    }
                    _ => match &mut begin {
                        Some((_, turn_rows)) => turn_rows.push(row),
                        None => rows.push(row),
                    },
                }
            }
        }
        if let Some((turn, turn_rows)) = begin {
            self.queue_op(Op::BeginTurn {
                turn,
                rows: turn_rows,
            });
        } else if !rows.is_empty() {
            self.queue_op(Op::AppendEvents {
                chat_id: self.chat_id.clone(),
                rows,
            });
        }
    }

    fn queue_op(&mut self, op: Op) {
        self.outbox_bytes = self.outbox_bytes.saturating_add(op_bytes(&op));
        self.outbox.push_back(op);
    }

    fn send_command(&mut self, command: DriverCommand) {
        if let Some(driver) = &self.driver {
            let _ = driver.commands.send(command);
            self.last_activity = Instant::now();
        }
    }

    // ---- State ----------------------------------------------------------------------------------

    fn set_status(&mut self, status: SessionStatus, detail: Option<String>) {
        let changed = self.status != status;
        self.status = status;
        self.detail = detail;
        self.info_dirty = true;
        if changed {
            self.next_flush = Some(Instant::now());
            self.publish();
        } else {
            self.schedule_flush();
        }
    }

    fn set_detail(&mut self, detail: Option<String>) {
        if self.detail != detail {
            self.detail = detail;
            self.info_dirty = true;
            self.schedule_flush();
        }
    }

    /// Publishes `needs_attention` when it changed.
    fn refresh_attention(&mut self) {
        let needs = self.normalizer.has_open_requests();
        if needs != self.needs_attention {
            self.needs_attention = needs;
            self.publish();
        }
    }

    /// An opted-in driver's prompt can finish while its background work is still running.
    fn refresh_run_status(&mut self) {
        if self.checkpointing.is_some() {
            return;
        }
        let Some(driver) = &self.driver else {
            return;
        };
        let Some(idle) = driver.run_idle else {
            return;
        };
        if !driver.ready || driver.stop != Stop::None || self.turn.is_some() {
            return;
        }
        if idle && !self.normalizer.has_open_requests() {
            if self.status != SessionStatus::Ready {
                self.set_status(SessionStatus::Ready, None);
            }
            self.dispatch_next();
        } else if !matches!(
            self.status,
            SessionStatus::Cancelling | SessionStatus::Running
        ) {
            self.set_status(
                SessionStatus::Running,
                Some("Agent work is still running".into()),
            );
        }
    }

    fn publish(&self) {
        self.shared.publish(
            &self.chat_id,
            ChatState {
                status: self.status,
                needs_attention: self.needs_attention,
                title: self.chat.title.clone(),
                updated_at: self.chat.updated_at,
                folder_state: self.folder_state,
            },
        );
    }

    fn redact(&self, text: &str) -> String {
        self.shared.deps.redactor.redact_text(text).into_owned()
    }

    /// A driver's error text as its card shows it and `last_error` keeps it: redacted (5.1), then
    /// cut to the card's 2 KiB of JSON. A stderr tail keeps its end, which explains the failure;
    /// any other text keeps its start, as the normalizer would.
    fn error_text(&self, text: &str, stderr: bool) -> String {
        let redacted = self.redact(text);
        if stderr {
            suffix_escaped(&redacted, STDERR_TAIL_SHOWN_BYTES).to_owned()
        } else {
            cap_escaped(redacted, MESSAGE_BYTES)
        }
    }

    fn summary(&self) -> ChatSummary {
        ChatSummary {
            id: self.chat_id.clone(),
            title: self.chat.title.clone(),
            agent_id: self.chat.agent_id.clone(),
            agent_host: self.chat.agent_host.clone(),
            agent_name: self.agent_label(),
            folder: self.chat.folder.to_string_lossy().into_owned(),
            folder_state: self.folder_state,
            status: self.status,
            needs_attention: self.needs_attention,
            created_at: self.chat.created_at,
            updated_at: self.chat.updated_at,
        }
    }

    fn session_info(&self) -> SessionInfo {
        SessionInfo {
            status: self.status,
            detail: self.detail.clone(),
            native_session_id: self.native_session_id.clone(),
            agent_name: self.agent_name.clone(),
            agent_version: self.agent_version.clone(),
            title: self.chat.title.clone(),
            model: self.option_label(ConfigCategory::Model),
            effort: self.option_label(ConfigCategory::Effort),
            mode: self.option_label(ConfigCategory::Mode),
            autonomy: self.autonomy,
            queue_held: self.queue.iter().any(|row| row.held),
            revision: self.revision,
        }
    }

    /// The display name of the current choice of the option of `category`.
    fn option_label(&self, category: ConfigCategory) -> Option<String> {
        let option = self
            .options
            .iter()
            .find(|option| option.category == category)?;
        match &option.kind {
            ConfigKind::Select { current, choices } => Some(
                choices
                    .iter()
                    .find(|choice| choice.value == *current)
                    .map_or_else(|| current.clone(), |choice| choice.name.clone()),
            ),
            ConfigKind::Toggle { .. } => None,
        }
    }

    fn snapshot(&self) -> ChatSnapshot {
        ChatSnapshot {
            chat: self.summary(),
            session: self.session_info(),
            queue: self
                .queue
                .iter()
                .map(|row| QueuedPrompt {
                    prompt_id: row.id.clone(),
                    preview: cap_chars(row.text.clone(), PREVIEW_CHARS),
                    held: row.held,
                    created_at: row.created_at,
                })
                .collect(),
            open_turn_id: self.turn.as_ref().map(|turn| turn.id.clone()),
            usage: self.usage.clone(),
            limits: self.limits.clone(),
            last_error: self.last_error.clone(),
            auth: self.auth.clone(),
            storage: self.store.status().borrow().clone(),
        }
    }
}

impl Drop for ChatActor {
    fn drop(&mut self) {
        self.cancel_checkpoint();
    }
}

/// The autonomy state while no agent runs (nothing is auto-answered).
fn stopped_autonomy(autonomy: Autonomy, note: Option<&str>) -> AutonomyState {
    AutonomyState {
        requested: autonomy,
        native_mode: None,
        auto_answer: AutoAnswer::Never,
        note: note.map(str::to_owned),
    }
}

/// The agent refused the level: auracode asks before every action.
fn refused_autonomy(autonomy: Autonomy, agent: &str, reason: &str) -> AutonomyState {
    AutonomyState {
        requested: autonomy,
        native_mode: None,
        auto_answer: AutoAnswer::Never,
        note: Some(format!(
            "auracode could not switch {agent} to a matching mode ({reason}), so it asks before every action."
        )),
    }
}

/// Whether `value` is valid for the option `option_id`.
fn check_option(
    options: &[ConfigOption],
    option_id: &str,
    value: &ConfigValue,
) -> Result<(), SessionError> {
    let Some(option) = options.iter().find(|option| option.id == option_id) else {
        return Err(SessionError::OptionInvalid(format!(
            "This agent has no option \"{option_id}\"."
        )));
    };
    match (&option.kind, value) {
        (ConfigKind::Select { choices, .. }, ConfigValue::Choice { value }) => {
            if choices.iter().any(|choice| choice.value == *value) {
                Ok(())
            } else {
                Err(SessionError::OptionInvalid(format!(
                    "\"{value}\" isn't one of the choices for {}.",
                    option.name
                )))
            }
        }
        (ConfigKind::Toggle { .. }, ConfigValue::Toggle { .. }) => Ok(()),
        _ => Err(SessionError::OptionInvalid(format!(
            "That kind of value doesn't fit {}.",
            option.name
        ))),
    }
}

/// Whether `answer` fits `prompt` (`Notify` takes none).
fn fits(prompt: &UiPrompt, answer: &UiAnswer) -> bool {
    match (prompt, answer) {
        (UiPrompt::Confirm { .. }, UiAnswer::Confirm { .. })
        | (UiPrompt::Input { .. }, UiAnswer::Input { .. }) => true,
        (UiPrompt::Select { options, .. }, UiAnswer::Select { index }) => {
            (*index as usize) < options.len()
        }
        (UiPrompt::Questions { questions, .. }, UiAnswer::Questions { answers }) => {
            !questions.is_empty()
                && questions.len() == answers.len()
                && questions.iter().enumerate().all(|(index, question)| {
                    !question.id.is_empty()
                        && !questions[..index]
                            .iter()
                            .any(|other| other.id == question.id)
                        && answers
                            .iter()
                            .filter(|answer| answer.question_id == question.id)
                            .count()
                            == 1
                        && answers
                            .iter()
                            .find(|answer| answer.question_id == question.id)
                            .is_some_and(|answer| {
                                let text = answer.text.as_ref();
                                let choices = answer.selected.len() + usize::from(text.is_some());
                                choices > 0
                                    && (question.multi_select || choices == 1)
                                    && text.is_none_or(|text| {
                                        question.allow_free_text && !text.trim().is_empty()
                                    })
                                    && answer.selected.iter().enumerate().all(
                                        |(index, selected)| {
                                            (*selected as usize) < question.options.len()
                                                && !answer.selected[..index].contains(selected)
                                        },
                                    )
                            })
                })
        }
        _ => false,
    }
}

fn prompt_message(prompt: &UiPrompt) -> &str {
    match prompt {
        UiPrompt::Confirm { message }
        | UiPrompt::Select { message, .. }
        | UiPrompt::Input { message, .. }
        | UiPrompt::Questions { message, .. }
        | UiPrompt::Notify { message } => message,
    }
}

/// The first non-empty line, trimmed, at most 80 characters.
fn first_line(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    cap_chars(line.to_owned(), TITLE_CHARS)
}

fn crash_message(exit: Option<&ExitInfo>) -> String {
    match exit {
        Some(ExitInfo {
            code: Some(code), ..
        }) => format!("The agent stopped unexpectedly (exit code {code})."),
        Some(ExitInfo {
            signal: Some(signal),
            ..
        }) => format!("The agent stopped unexpectedly (signal {signal})."),
        _ => "The agent stopped unexpectedly.".into(),
    }
}

/// "Hermes'", "Codex's".
fn possessive(name: &str) -> String {
    if name.ends_with('s') {
        format!("{name}'")
    } else {
        format!("{name}'s")
    }
}

/// About how much of the outbox an event will take: a delta's text, or a small fixed size for
/// the rest (they are within the event budget).
fn approx_bytes(event: &AuraEvent) -> usize {
    match event {
        AuraEvent::MessageDelta { text, .. }
        | AuraEvent::ThoughtDelta { text, .. }
        | AuraEvent::UserMessageDelta { text, .. } => text.len().saturating_add(64),
        _ => 1024,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// The FORCE chain on one process of a retired `generation`.
fn force_chain(generation: u64, control: ProcessControl) -> BoxFuture<'static, Done> {
    async move {
        let _report = control.shutdown(ShutdownPlan::FORCE).await;
        drop(control);
        Done::Retired(generation)
    }
    .boxed()
}

/// A driver's task, once it returns (or is aborted).
fn join_driver(generation: u64, join: JoinHandle<DriverExit>) -> BoxFuture<'static, Done> {
    async move {
        Done::DriverJoined {
            generation,
            result: join.await,
        }
    }
    .boxed()
}

async fn sleep_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

async fn next_event(driver: &mut Option<LiveDriver>) -> Option<DriverEvent> {
    match driver.as_mut().and_then(|driver| driver.events.as_mut()) {
        Some(events) => events.recv().await,
        None => std::future::pending().await,
    }
}

async fn next_progress(progress: &mut Option<mpsc::UnboundedReceiver<String>>) -> Option<String> {
    match progress {
        Some(progress) => progress.recv().await,
        None => std::future::pending().await,
    }
}

/// A start's preparation: the folder, detection, the adapter install and launch spec, the env. One
/// task, so dropping it (Esc, force stop, Stop, quit) kills a running install or probe. It begins
/// once no earlier generation of the chat winds down: a process still being killed holds its native
/// session, which this start may resume.
async fn prepare(
    folder: PathBuf,
    agent_host: aura_protocol::agents::AgentHost,
    spec: AgentSpec,
    detector: Arc<aura_agents::Detector>,
    env: Arc<aura_process::EnvResolver>,
    progress: mpsc::UnboundedSender<String>,
    mut winding_down: watch::Receiver<usize>,
) -> Result<Prepared, StartFailure> {
    // The actor holds the sender for as long as this task can matter.
    let _ = winding_down.wait_for(|retiring| *retiring == 0).await;
    if let aura_process::HostAvailability::Unavailable { reason } =
        aura_agents::hosts::execution(&agent_host).availability()
    {
        return Err(StartFailure {
            kind: ErrorKind::AgentUnavailable,
            message: reason,
            folder: None,
        });
    }
    check_folder(folder.clone()).await?;
    let folder_key = tokio::task::spawn_blocking(move || super::live::normalize_path(folder))
        .await
        .map_err(|_| StartFailure {
            kind: ErrorKind::Internal,
            message: "Resolving the folder failed.".into(),
            folder: None,
        })?;
    match detector.detect(&spec).await {
        Availability::Missing { reason } | Availability::Broken { reason } => {
            return Err(StartFailure {
                kind: ErrorKind::AgentUnavailable,
                message: reason,
                folder: None,
            });
        }
        Availability::Ready { .. } | Availability::Checking => {}
    }
    let launch = detector
        .prepare_launch(&spec, progress.clone())
        .await
        .map_err(|error| match error {
            LaunchError::InstallFailed { reason } => StartFailure {
                kind: ErrorKind::SpawnFailed,
                message: reason,
                folder: None,
            },
            LaunchError::Missing { reason } | LaunchError::Broken { reason } => StartFailure {
                kind: ErrorKind::AgentUnavailable,
                message: reason,
                folder: None,
            },
        })?;
    let _ = progress.send("Reading your shell environment".into());
    let env = env.get().await;
    Ok(Prepared {
        launch,
        env,
        folder_key,
    })
}

/// Missing or not a folder: `FolderMissing`; refused by the OS (macOS privacy, no read
/// permission): `FolderNotAllowed`, never reported as missing.
async fn check_folder(folder: PathBuf) -> Result<(), StartFailure> {
    let shown = folder.display().to_string();
    let checked = tokio::task::spawn_blocking(move || super::folder_state(&folder, true)).await;
    match checked.unwrap_or(FolderState::Ok) {
        FolderState::Ok => Ok(()),
        FolderState::Missing => Err(StartFailure {
            kind: ErrorKind::FolderMissing,
            message: format!(
                "The chat's folder {shown} can't be found. Restore it (or reconnect its drive), then press Retry."
            ),
            folder: Some(FolderState::Missing),
        }),
        FolderState::NotAllowed => Err(StartFailure {
            kind: ErrorKind::FolderNotAllowed,
            message: format!(
                "auracode isn't allowed to open {shown}. Allow it in System Settings > Privacy & Security > Files and Folders, then press Retry."
            ),
            folder: Some(FolderState::NotAllowed),
        }),
    }
}

#[cfg(test)]
mod question_validation_tests {
    use super::fits;
    use aura_protocol::{UiAnswer, UiPrompt, UiQuestion, UiQuestionAnswer};

    #[test]
    fn empty_or_ambiguous_question_ids_never_accept_an_answer() {
        let question = UiQuestion {
            id: "q1".into(),
            header: "Header".into(),
            question: "What next?".into(),
            options: Vec::new(),
            multi_select: false,
            allow_free_text: true,
        };
        let answer = UiQuestionAnswer {
            question_id: "q1".into(),
            selected: Vec::new(),
            text: Some("Continue".into()),
        };
        assert!(fits(
            &UiPrompt::Questions {
                message: String::new(),
                questions: vec![question.clone()]
            },
            &UiAnswer::Questions {
                answers: vec![answer.clone()]
            }
        ));
        assert!(!fits(
            &UiPrompt::Questions {
                message: String::new(),
                questions: Vec::new()
            },
            &UiAnswer::Questions {
                answers: Vec::new()
            }
        ));
        assert!(!fits(
            &UiPrompt::Questions {
                message: String::new(),
                questions: vec![question.clone(), question.clone()]
            },
            &UiAnswer::Questions {
                answers: vec![answer.clone(), answer]
            }
        ));
        assert!(!fits(
            &UiPrompt::Questions {
                message: String::new(),
                questions: vec![UiQuestion {
                    id: String::new(),
                    ..question
                }]
            },
            &UiAnswer::Questions {
                answers: vec![UiQuestionAnswer {
                    question_id: String::new(),
                    selected: Vec::new(),
                    text: Some("Continue".into())
                }]
            }
        ));
    }
}
