//! Memory writes retain the active-profile lease until the writer acknowledges the exact revision.
use crate::{error::AppError, state::AppState};
use aura_protocol::memory::*;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn read_project_memory(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectMemory, AppError> {
    Ok(state.sessions()?.read_project_memory(&project_id).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn save_project_memory(
    state: State<'_, AppState>,
    input: SaveProjectMemory,
) -> Result<ProjectMemory, AppError> {
    Ok(state.sessions()?.save_project_memory(input).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn propose_project_memory(
    state: State<'_, AppState>,
    input: ProposeProjectMemory,
) -> Result<MemoryProposal, AppError> {
    Ok(state.sessions()?.propose_project_memory(input).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn accept_memory_proposal(
    state: State<'_, AppState>,
    input: AcceptMemoryProposal,
) -> Result<ProjectMemory, AppError> {
    Ok(state.sessions()?.accept_memory_proposal(input).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn reject_memory_proposal(
    state: State<'_, AppState>,
    project_id: String,
    proposal_id: String,
) -> Result<Vec<MemoryProposal>, AppError> {
    Ok(state
        .sessions()?
        .reject_memory_proposal(&project_id, &proposal_id)
        .await?)
}
#[tauri::command]
#[specta::specta]
pub async fn project_memory_history(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<MemoryRevision>, AppError> {
    Ok(state
        .sessions()?
        .project_memory_history(&project_id)
        .await?)
}
#[tauri::command]
#[specta::specta]
pub async fn project_memory_proposals(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<MemoryProposal>, AppError> {
    Ok(state
        .sessions()?
        .project_memory_proposals(&project_id)
        .await?)
}
#[tauri::command]
#[specta::specta]
pub async fn export_project_memory(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectMemoryBundle, AppError> {
    Ok(state.sessions()?.export_project_memory(&project_id).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn import_project_memory(
    state: State<'_, AppState>,
    input: ImportProjectMemory,
) -> Result<ProjectMemory, AppError> {
    Ok(state.sessions()?.import_project_memory(input).await?)
}
