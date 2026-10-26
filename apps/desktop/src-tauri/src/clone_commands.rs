//! Clone IPC carries reviewed identifiers, never an arbitrary executable or command string.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::cloning::Clones;
use aura_protocol::setup_actions::{CloneInput, CloneRecord, CloneReview};
use std::{path::PathBuf, sync::Arc};
use tauri::{State, Webview};

fn error(value: aura_core::cloning::CloneError) -> AppError {
    AppError::new(AppErrorCode::InvalidArgument, value.to_string())
}
fn current(webview: &Webview, state: &AppState) -> Result<(), AppError> {
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is quitting.",
        ));
    }
    if !state.pages.for_view(webview.label()).is_current() {
        return Err(AppError::new(
            AppErrorCode::SessionNotReady,
            "This page is no longer active.",
        ));
    }
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn clone_review(
    webview: Webview,
    state: State<'_, AppState>,
    service: State<'_, Arc<Clones>>,
    input: CloneInput,
) -> Result<CloneReview, AppError> {
    current(&webview, &state)?;
    let page = state.pages.for_view(webview.label());
    let review = state
        .sessions()?
        .clone_review(&service, webview.label(), input)
        .await?;
    if !page.is_current() || state.quit.is_quitting() {
        service.cancel_review(webview.label(), &review.id);
        return Err(AppError::new(
            AppErrorCode::SessionNotReady,
            "This clone review was canceled.",
        ));
    }
    Ok(review)
}
#[tauri::command]
#[specta::specta]
pub fn clone_cancel_review(webview: Webview, service: State<'_, Arc<Clones>>, id: String) {
    service.cancel_review(webview.label(), &id);
}
#[tauri::command]
#[specta::specta]
pub fn clone_start(
    webview: Webview,
    state: State<'_, AppState>,
    service: State<'_, Arc<Clones>>,
    id: String,
) -> Result<CloneRecord, AppError> {
    current(&webview, &state)?;
    let chats = state.chats().ok_or_else(|| {
        AppError::new(
            AppErrorCode::SessionNotReady,
            "The local workspace is unavailable.",
        )
    })?;
    Ok(state.sessions()?.clone_start(
        &service,
        webview.label(),
        &id,
        Arc::clone(&chats.registry),
    )?)
}
#[tauri::command]
#[specta::specta]
pub fn clone_cancel(webview: Webview, service: State<'_, Arc<Clones>>, id: String) {
    service.cancel(webview.label(), &id);
}
#[tauri::command]
#[specta::specta]
pub fn clone_status(
    webview: Webview,
    service: State<'_, Arc<Clones>>,
    id: String,
) -> Result<CloneRecord, AppError> {
    service.status(webview.label(), &id).map_err(error)
}
#[tauri::command]
#[specta::specta]
pub async fn clone_history(
    state: State<'_, AppState>,
    service: State<'_, Arc<Clones>>,
    parent: String,
) -> Result<Vec<CloneRecord>, AppError> {
    state.sessions()?;
    service.history(PathBuf::from(parent)).await.map_err(error)
}
