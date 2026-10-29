//! Explicit review and execution of device-local worktree setup.
use crate::{error::AppError, state::AppState};
use aura_protocol::worktree_setup::{
    WorktreeSetup, WorktreeSetupInput, WorktreeSetupPreview, WorktreeSetupResult,
};
use tauri::{State, Webview};

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<WorktreeSetup, AppError> {
    Ok(state.sessions()?.worktree_setup(&chat_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup_save(
    state: State<'_, AppState>,
    chat_id: String,
    input: WorktreeSetupInput,
) -> Result<WorktreeSetup, AppError> {
    Ok(state
        .sessions()?
        .worktree_setup_save(&chat_id, input)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
) -> Result<WorktreeSetupPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_setup_preview(&chat_id, &worktree_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup_command_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
) -> Result<WorktreeSetupPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_setup_command_preview(&chat_id, &worktree_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup_apply(
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<WorktreeSetupResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_setup_apply(&chat_id, &token)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_setup_start(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    use aura_core::terminal::TerminalError;
    if state.quit.is_quitting() || !state.pages.for_view(webview.label()).is_current() {
        return Err(TerminalError::Closed.into());
    }
    let size = aura_process::pty::PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    let ticket = state.terminals.claim(webview.label(), &terminal_id)?;
    let admission = state.sessions()?;
    let plan = admission
        .prepare_worktree_setup_terminal(&chat_id, &token)
        .await?;
    if !state.pages.for_view(webview.label()).is_current() {
        return Err(TerminalError::Closed.into());
    }
    let chats = state.chats().ok_or(TerminalError::Closed)?;
    let spawner = aura_process::Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    Ok(ticket
        .start_setup(spawner, plan.spec, size, plan.guard, plan.completion)
        .await?)
}
