use crate::{error::AppError, state::AppState};
use o7_protocol::activity::LineEdits;
use o7_protocol::search::SearchResults;
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

/// The Dashboard's line edits since `since` (Unix milliseconds), by agent and quarter hour.
#[tauri::command]
#[specta::specta]
pub async fn dashboard_line_edits(
    state: State<'_, AppState>,
    since: o7_protocol::Millis,
) -> Result<LineEdits, AppError> {
    Ok(state.sessions()?.line_edits(since).await?)
}
