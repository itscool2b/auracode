//! Thin Git workspace IPC. The core owns review tokens, folder admission and mutation journals.

use aura_protocol::git::{
    GitWorkspace, IsolationInput, IsolationPreview, IsolationResult, ManagedWorktree,
    WorktreeAction, WorktreeActionPreview, WorktreeActionResult, WorktreeDestination,
    WorktreeRecoveryAction, WorktreeRecoveryPreview, WorktreeRelocationPreview,
};
use tauri::State;

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn git_workspace(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<GitWorkspace, AppError> {
    Ok(state.sessions()?.git_workspace(&chat_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn managed_worktrees(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Vec<ManagedWorktree>, AppError> {
    Ok(state.sessions()?.managed_worktrees(&chat_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn isolation_preview(
    state: State<'_, AppState>,
    chat_id: String,
    input: IsolationInput,
) -> Result<IsolationPreview, AppError> {
    Ok(state.sessions()?.isolation_preview(&chat_id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn isolation_apply(
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<IsolationResult, AppError> {
    Ok(state.sessions()?.isolation_apply(&chat_id, &token).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_action_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    action: WorktreeAction,
) -> Result<WorktreeActionPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_action_preview(&chat_id, &worktree_id, action)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_action_apply(
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<WorktreeActionResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_action_apply(&chat_id, &token)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_recovery_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    action: WorktreeRecoveryAction,
) -> Result<WorktreeRecoveryPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_recovery_preview(&chat_id, &worktree_id, action)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_recovery_apply(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    token: String,
) -> Result<WorktreeActionResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_recovery_apply(&chat_id, &worktree_id, &token)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_relocation_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    destination: WorktreeDestination,
) -> Result<WorktreeRelocationPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_relocation_preview(&chat_id, &worktree_id, destination)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_relocation_apply(
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<aura_protocol::conversation::ContinuationResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_relocation_apply(&chat_id, &token)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_pr_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    input: aura_protocol::git::PullRequestInput,
) -> Result<aura_protocol::git::PullRequestPreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_pr_preview(&chat_id, &worktree_id, input)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_pr_apply(
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<aura_protocol::git::PullRequestResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_pr_apply(&chat_id, &token)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_chat_preview(
    state: State<'_, AppState>,
    input: aura_protocol::git::WorktreeChatInput,
) -> Result<aura_protocol::git::WorktreeChatPreview, AppError> {
    Ok(state.sessions()?.worktree_chat_preview(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_chat_apply(
    state: State<'_, AppState>,
    token: String,
) -> Result<aura_protocol::git::WorktreeChatResult, AppError> {
    Ok(state.sessions()?.worktree_chat_apply(&token).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_recreate_preview(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
) -> Result<aura_protocol::git::WorktreeRecreatePreview, AppError> {
    Ok(state
        .sessions()?
        .worktree_recreate_preview(&chat_id, &worktree_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn worktree_recreate_apply(
    state: State<'_, AppState>,
    chat_id: String,
    worktree_id: String,
    token: String,
) -> Result<WorktreeActionResult, AppError> {
    Ok(state
        .sessions()?
        .worktree_recreate_apply(&chat_id, &worktree_id, &token)
        .await?)
}
