//! Typed UI bindings for Rust-owned project organization and folder preflight.

use aura_protocol::workspace::{
    ChatCreatePreview, ChatMove, ProjectChatCreate, ProjectCreate, ProjectFolder, ProjectInput,
    ProjectSummary, WorkspaceChat, WorkspaceFilter, WorkspaceSnapshot,
};
use tauri::State;

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn workspace_snapshot(
    state: State<'_, AppState>,
    filter: WorkspaceFilter,
) -> Result<WorkspaceSnapshot, AppError> {
    Ok(state.sessions()?.workspace_snapshot(filter).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn project_create(
    state: State<'_, AppState>,
    request: ProjectCreate,
) -> Result<ProjectSummary, AppError> {
    Ok(state.sessions()?.project_create(request).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn project_update(
    state: State<'_, AppState>,
    project_id: String,
    input: ProjectInput,
) -> Result<ProjectSummary, AppError> {
    Ok(state.sessions()?.project_update(&project_id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn project_add_folder(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
) -> Result<ProjectFolder, AppError> {
    Ok(state
        .sessions()?
        .project_add_folder(&project_id, &path)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_rename(
    state: State<'_, AppState>,
    chat_id: String,
    title: String,
) -> Result<WorkspaceChat, AppError> {
    Ok(state.sessions()?.chat_rename(&chat_id, &title).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_pin(
    state: State<'_, AppState>,
    chat_id: String,
    pinned: bool,
) -> Result<WorkspaceChat, AppError> {
    Ok(state.sessions()?.chat_pin(&chat_id, pinned).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_archive(
    state: State<'_, AppState>,
    chat_id: String,
    archived: bool,
) -> Result<WorkspaceChat, AppError> {
    Ok(state.sessions()?.chat_archive(&chat_id, archived).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_move(
    state: State<'_, AppState>,
    chat_id: String,
    request: ChatMove,
) -> Result<WorkspaceChat, AppError> {
    Ok(state.sessions()?.chat_move(&chat_id, request).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_create_preview(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<ChatCreatePreview, AppError> {
    Ok(state.sessions()?.chat_create_preview(&folder_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_project_create(
    state: State<'_, AppState>,
    request: ProjectChatCreate,
) -> Result<WorkspaceChat, AppError> {
    Ok(state.sessions()?.chat_project_create(request).await?)
}
