//! Memory writes retain the active-profile lease until the writer acknowledges the exact revision.
use crate::{error::AppError, state::AppState};
use o7_protocol::memory::*;
use tauri::{Emitter, Manager, State};

/// Sent with a [`ProjectMemoryChanged`] after every committed change to a project's memory,
/// history or proposals, whether the editor or an agent made it. An agent's direct edit is named,
/// so the window can say so and offer to undo it.
pub const MEMORY_CHANGED: &str = "auracode-project-memory-changed";

/// Forwards the active profile's memory changes to the window, so an open Project memory page
/// reflects an agent's edit. Call once a runtime is published; the task ends with its store.
pub(crate) fn forward_changes(app: &tauri::AppHandle) {
    let Some(chats) = app.try_state::<AppState>().and_then(|state| state.chats()) else {
        return;
    };
    let changes = chats.store.memory_changes();
    let app = app.clone();
    tauri::async_runtime::spawn(forward(changes, move |changed| {
        let _ = app.emit(MEMORY_CHANGED, changed);
    }));
}

/// Sends every change on, until the store closes. A receiver that fell behind sends one change
/// without a project, so every open editor reads again.
async fn forward(
    mut changes: tokio::sync::broadcast::Receiver<ProjectMemoryChanged>,
    send: impl Fn(ProjectMemoryChanged),
) {
    use tokio::sync::broadcast::error::RecvError;
    loop {
        match changes.recv().await {
            Ok(changed) => send(changed),
            Err(RecvError::Lagged(_)) => send(ProjectMemoryChanged {
                project_id: None,
                agent_edit: None,
            }),
            Err(RecvError::Closed) => break,
        }
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forwarding_names_agent_edits_rereads_after_a_lag_and_ends_with_the_store() {
        let (sender, changes) = tokio::sync::broadcast::channel(2);
        let edit = |revision: &str| ProjectMemoryChanged {
            project_id: Some("project".into()),
            agent_edit: Some(AgentMemoryEdit {
                revision: revision.into(),
                parent_revision: None,
                chat_id: "chat".into(),
            }),
        };
        for revision in ["one", "two", "three"] {
            sender.send(edit(revision)).unwrap();
        }
        drop(sender);
        let sent = std::sync::Mutex::new(Vec::new());
        forward(changes, |changed| sent.lock().unwrap().push(changed)).await;
        assert_eq!(
            sent.into_inner().unwrap(),
            [
                ProjectMemoryChanged {
                    project_id: None,
                    agent_edit: None
                },
                edit("two"),
                edit("three"),
            ]
        );
    }
}
