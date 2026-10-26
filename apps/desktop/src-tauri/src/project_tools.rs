//! Project utilities accept saved chat identities and reviewed choices, never arbitrary commands.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_protocol::git::{GitInitializePreview, GitWorkspace};
use tauri::{State, Webview};

fn current(webview: &Webview, state: &AppState) -> Result<(), AppError> {
    if state.quit.is_quitting() || !state.pages.for_view(webview.label()).is_current() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "This page is closing.",
        ));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_initialize_preview(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    initial_branch: String,
) -> Result<GitInitializePreview, AppError> {
    current(&webview, &state)?;
    Ok(state
        .sessions()?
        .git_initialize_preview(&chat_id, &initial_branch)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn git_initialize_apply(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<GitWorkspace, AppError> {
    current(&webview, &state)?;
    let admission = state.sessions()?;
    let manager = (*admission).clone();
    Ok(manager
        .git_initialize_apply(&chat_id, &token, Box::new(admission))
        .await?)
}
