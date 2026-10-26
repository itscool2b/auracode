//! Explicit deletion recovery. A page cannot select the source or a destination path.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::paths::DataRoot;
use aura_protocol::{
    account::AccountAccess,
    account_preservation::{KeepLocalPreview, KeepLocalResult},
};
use tauri::{Manager, State, Webview};

fn unavailable(message: &str) -> AppError {
    AppError::new(AppErrorCode::SessionNotReady, message)
}
async fn current(view: &Webview, state: &AppState) -> Result<(), AppError> {
    if state.quit.is_quitting() || !state.pages.for_view(view.label()).is_current() {
        return Err(unavailable("This page is no longer active."));
    }
    let status = state
        .accounts
        .get()
        .await
        .map_err(|e| unavailable(&e.message))?
        .status()
        .await
        .map_err(|e| unavailable(&e.message))?;
    if status.access != AccountAccess::Deleted
        || !status.local_key_available
        || status.profile_id.as_deref()
            != state
                .app_info()
                .profile
                .as_ref()
                .map(|profile| profile.id.as_str())
    {
        return Err(unavailable(
            "Open the retained, unlocked workspace for the deleted account first.",
        ));
    }
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn account_keep_local_preview(
    view: Webview,
    state: State<'_, AppState>,
) -> Result<KeepLocalPreview, AppError> {
    let sessions = state.sessions()?;
    current(&view, &state).await?;
    Ok(sessions.keep_local_preview().await?)
}
#[tauri::command]
#[specta::specta]
pub async fn account_keep_local_apply(
    view: Webview,
    token: String,
) -> Result<KeepLocalResult, AppError> {
    let app = view.app_handle().clone();
    tokio::spawn(async move {
        let state = app.state::<AppState>();
        let _transition = state
            .transition
            .clone()
            .try_lock_owned()
            .map_err(|_| unavailable("Another profile transition is in progress."))?;
        let sessions = state.sessions()?;
        current(&view, &state).await?;
        let _terminals = state
            .terminals
            .try_quiesce_when_idle()
            .ok_or_else(|| unavailable("Close terminals before keeping the workspace as Local."))?;
        let root = DataRoot::at(
            state
                .data_dir()
                .ok_or_else(|| unavailable("The data folder is unavailable."))?,
        );
        Ok(sessions.keep_local_apply(root, token).await?)
    })
    .await
    .map_err(|_| unavailable("The Local copy task could not finish."))?
}
