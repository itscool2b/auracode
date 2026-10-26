//! Reviewed parent tombstones. The owned task retains the active profile lease until commit.
use crate::{error::AppError, state::AppState};
use aura_protocol::workspace_removal::{
    RemovedWorkspace, WorkspaceRemovalAction, WorkspaceRemovalPreview, WorkspaceRemovalTarget,
};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn workspace_removed(
    state: State<'_, AppState>,
) -> Result<Vec<RemovedWorkspace>, AppError> {
    Ok(state.sessions()?.workspace_removed().await?)
}
#[tauri::command]
#[specta::specta]
pub async fn workspace_removal_preview(
    state: State<'_, AppState>,
    target: WorkspaceRemovalTarget,
    action: WorkspaceRemovalAction,
) -> Result<WorkspaceRemovalPreview, AppError> {
    Ok(state
        .sessions()?
        .workspace_removal_preview(target, action)
        .await?)
}
#[tauri::command]
#[specta::specta]
pub async fn workspace_removal_apply(
    state: State<'_, AppState>,
    token: String,
) -> Result<(), AppError> {
    let lease = state.sessions()?;
    let manager = (*lease).clone();
    Ok(manager
        .workspace_removal_apply(&token, Box::new(lease))
        .await?)
}
