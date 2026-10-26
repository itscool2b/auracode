use crate::{error::AppError, state::AppState};
use aura_protocol::search::SearchResults;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn workspace_search(
    state: State<'_, AppState>,
    query: String,
    include_archived: bool,
) -> Result<SearchResults, AppError> {
    Ok(state.sessions()?.search(query, include_archived).await?)
}
