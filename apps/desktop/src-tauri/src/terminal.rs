//! Thin, page-scoped IPC for explicit vendor sign-in terminals. No arbitrary program input.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::terminal::{TerminalChunk, TerminalError};
use aura_process::{Spawner, pty::PtySize};
use aura_protocol::setup_actions::AgentInstallReview;
use tauri::{State, Webview};

impl From<TerminalError> for AppError {
    fn from(error: TerminalError) -> Self {
        let code = match error {
            TerminalError::Closed => AppErrorCode::SessionNotReady,
            TerminalError::AlreadyOpen | TerminalError::Full | TerminalError::ProjectFull => {
                AppErrorCode::TooManyStreams
            }
            TerminalError::Start(_) | TerminalError::TimedOut => AppErrorCode::AgentUnavailable,
            _ => AppErrorCode::InvalidArgument,
        };
        Self::new(code, error.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn agent_install_review(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<AgentInstallReview, AppError> {
    Ok(state.sessions()?.review_agent_install(&agent_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn agent_install_start(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    agent_id: String,
    revision: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    let owner = webview.label();
    let page = state.pages.for_view(owner);
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let size = PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    let ticket = state.terminals.claim(owner, &terminal_id)?;
    let spec = state
        .sessions()?
        .prepare_agent_install(&agent_id, &revision)
        .await?;
    if !page.is_current() || state.quit.is_quitting() {
        return Err(TerminalError::Closed.into());
    }
    let chats = state.chats().ok_or(TerminalError::Closed)?;
    let spawner = Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    Ok(ticket.start_install(&spawner, spec, size).await?)
}

#[tauri::command]
#[specta::specta]
pub fn terminal_reserve(webview: Webview, state: State<'_, AppState>) -> Result<String, AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    if !state.pages.for_view(webview.label()).is_current() {
        return Err(TerminalError::Closed.into());
    }
    Ok(state.terminals.reserve(webview.label())?.pending())
}

#[tauri::command]
#[specta::specta]
pub async fn agent_login_start(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    agent_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    let owner = webview.label();
    let page = state.pages.for_view(owner);
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let size = PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    // Reserve before asynchronous preparation, so a reload can cancel this pending launch.
    let ticket = state.terminals.claim(owner, &terminal_id)?;
    let spec = state.sessions()?.prepare_login(&agent_id).await?;
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let chats = state.chats().ok_or(TerminalError::Closed)?;
    let spawner = Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    Ok(ticket.start(&spawner, spec, size).await?)
}

/// `claude setup-token` in the terminal sheet, for Add account: the vendor's browser sign-in that
/// prints the token the person pastes. Like the sign-in, only the sheet's Start runs it.
#[tauri::command]
#[specta::specta]
pub async fn agent_token_start(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    agent_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    let owner = webview.label();
    let page = state.pages.for_view(owner);
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let size = PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    let ticket = state.terminals.claim(owner, &terminal_id)?;
    let spec = state.sessions()?.prepare_account_token(&agent_id).await?;
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let chats = state.chats().ok_or(TerminalError::Closed)?;
    let spawner = Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    Ok(ticket.start(&spawner, spec, size).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_read(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalChunk, AppError> {
    Ok(state.terminals.read(webview.label(), &terminal_id).await?)
}

#[tauri::command]
#[specta::specta]
pub fn terminal_write(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    Ok(state
        .terminals
        .write(webview.label(), &terminal_id, bytes)?)
}

#[tauri::command]
#[specta::specta]
pub fn terminal_resize(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    Ok(state
        .terminals
        .resize(webview.label(), &terminal_id, PtySize { rows, cols })?)
}

#[tauri::command]
#[specta::specta]
pub fn terminal_close(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<(), AppError> {
    Ok(state.terminals.close(webview.label(), &terminal_id)?)
}

/// The terminal chats open now, by terminal: whose page holds each, and the chat and generation
/// it hands back when it ends. A page that reloads or closes ends its terminal chats, so no chat
/// stays held by a terminal nobody sees.
#[derive(Default)]
pub struct TerminalChats(
    std::sync::Mutex<std::collections::HashMap<String, (String, String, u64)>>,
);

impl TerminalChats {
    fn insert(&self, terminal_id: &str, owner: &str, chat_id: &str, generation: u64) {
        lock(&self.0).insert(
            terminal_id.to_owned(),
            (owner.to_owned(), chat_id.to_owned(), generation),
        );
    }

    /// The chat a terminal of this page opened, once: a second ending changes nothing.
    fn take(&self, owner: &str, terminal_id: &str) -> Option<(String, u64)> {
        let mut map = lock(&self.0);
        match map.get(terminal_id) {
            Some((holder, _, _)) if holder == owner => map
                .remove(terminal_id)
                .map(|(_, chat, generation)| (chat, generation)),
            _ => None,
        }
    }

    /// Every terminal chat of a page that went away.
    pub fn drain_owner(&self, owner: &str) -> Vec<(String, u64)> {
        let mut map = lock(&self.0);
        let ids: Vec<String> = map
            .iter()
            .filter(|(_, (holder, _, _))| holder == owner)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| {
                map.remove(&id)
                    .map(|(_, chat, generation)| (chat, generation))
            })
            .collect()
    }
}

fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A terminal chat that started: its terminal, and the shared servers its agent's terminal left
/// out, with why, for the chat to say.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChatTerminalStarted {
    pub terminal_id: String,
    pub omitted: Vec<String>,
}

/// Opens a chat in its agent's own interface in a reserved terminal (`terminal_reserve`): the
/// chat is prepared as a start would be (folder, account, shared MCP, project memory, its
/// session), then its agent's interactive interface starts there. While it runs, the chat's
/// session is the terminal's; `chat_terminal_ended` hands it back.
#[tauri::command]
#[specta::specta]
pub async fn chat_terminal_start(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
    chat_id: String,
    rows: u16,
    cols: u16,
) -> Result<ChatTerminalStarted, AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    let owner = webview.label().to_owned();
    let page = state.pages.for_view(&owner);
    if !page.is_current() {
        return Err(TerminalError::Closed.into());
    }
    let size = PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    // Reserve before the preparation, so a reload can cancel this pending launch.
    let ticket = state.terminals.claim(&owner, &terminal_id)?;
    let sessions = state.sessions()?;
    let opened = sessions.open_terminal(&chat_id).await?;
    let generation = opened.generation;
    let give_back = |error: AppError| {
        sessions.terminal_ended(&chat_id, generation);
        error
    };
    if !page.is_current() || state.quit.is_quitting() {
        return Err(give_back(TerminalError::Closed.into()));
    }
    let chats = state
        .chats()
        .ok_or_else(|| give_back(TerminalError::Closed.into()))?;
    let spawner = Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    let id = ticket
        .start(&spawner, opened.spec, size)
        .await
        .map_err(|error| give_back(error.into()))?;
    state
        .terminal_chats
        .insert(&id, &owner, &chat_id, generation);
    Ok(ChatTerminalStarted {
        terminal_id: id,
        omitted: opened.omitted,
    })
}

/// A terminal chat's terminal ended (its agent exited, or the page closed it): the chat gets its
/// session back. Only the page that opened it can end it, once.
#[tauri::command]
#[specta::specta]
pub fn chat_terminal_ended(
    webview: Webview,
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<(), AppError> {
    if let Some((chat_id, generation)) = state.terminal_chats.take(webview.label(), &terminal_id)
        && let Ok(sessions) = state.sessions()
    {
        sessions.terminal_ended(&chat_id, generation);
    }
    Ok(())
}
