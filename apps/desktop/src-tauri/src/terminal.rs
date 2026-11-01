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
