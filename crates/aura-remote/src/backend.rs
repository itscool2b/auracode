//! What a remote session can do on this desktop. The desktop app implements it over the profile
//! that is open; nothing here reaches further than these calls.

use std::sync::Arc;

use aura_protocol::{
    EventBatch, UiAnswer,
    session::{ChatAttach, ChatStatusUpdate, HistoryPage, PromptAck},
    workspace::WorkspaceChat,
};
pub use futures::future::BoxFuture;

use crate::wire::Overview;

/// Why a call failed, in words the person at the other end can act on.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct BackendError {
    pub code: &'static str,
    pub message: String,
}

impl BackendError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// The request was already answered, withdrawn or never existed.
    pub fn not_pending(&self) -> bool {
        self.code == "request_not_pending"
    }
}

/// Receives a followed chat's live events. `false` means the receiver is gone or fell behind:
/// send it nothing more.
pub type Frames = Arc<dyn Fn(&EventBatch) -> bool + Send + Sync>;
/// Receives every chat's status changes, with the same meaning of `false`.
pub type Statuses = Arc<dyn Fn(&ChatStatusUpdate) -> bool + Send + Sync>;

pub trait Backend: Send + Sync + 'static {
    /// Projects, their chats and the agents installed here.
    fn overview(&self) -> BoxFuture<'_, Result<Overview, BackendError>>;
    /// Sends every chat's status changes to `statuses` until `owner` is released. A second call
    /// for the same owner replaces the first.
    fn watch(&self, owner: &str, statuses: Statuses) -> Result<(), BackendError>;
    /// Follows a chat: its newest history now, then its live events to `frames`. One chat per
    /// owner; following another replaces it.
    fn attach<'a>(
        &'a self,
        chat_id: &'a str,
        owner: &'a str,
        frames: Frames,
    ) -> BoxFuture<'a, Result<ChatAttach, BackendError>>;
    /// Stops everything `owner` follows and watches.
    fn release(&self, owner: &str);
    /// The page of history before `before_seq` (`u32::MAX`: the newest).
    fn history<'a>(
        &'a self,
        chat_id: &'a str,
        before_seq: u32,
    ) -> BoxFuture<'a, Result<HistoryPage, BackendError>>;
    fn send<'a>(
        &'a self,
        chat_id: &'a str,
        text: String,
    ) -> BoxFuture<'a, Result<PromptAck, BackendError>>;
    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), BackendError>>;
    /// Answers a permission request; no option declines it.
    fn permission<'a>(
        &'a self,
        chat_id: &'a str,
        request_id: &'a str,
        option_id: Option<String>,
    ) -> BoxFuture<'a, Result<(), BackendError>>;
    /// Answers a question; no answer dismisses it.
    fn answer<'a>(
        &'a self,
        chat_id: &'a str,
        request_id: &'a str,
        answer: Option<UiAnswer>,
    ) -> BoxFuture<'a, Result<(), BackendError>>;
    /// A new chat in a project's folder. No agent named: the project's, then the default.
    fn create<'a>(
        &'a self,
        folder_id: &'a str,
        agent_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<WorkspaceChat, BackendError>>;
}
