//! Clone IPC carries the person's form and reviewed identifiers, never an executable or command.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::cloning::Clones;
use aura_protocol::setup_actions::{CloneCheck, CloneInput, CloneRecord};
use std::sync::Arc;
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
/// Reads the clone form. A complete form comes back with the exact command Start will run.
#[tauri::command]
#[specta::specta]
pub async fn clone_check(
    webview: Webview,
    state: State<'_, AppState>,
    service: State<'_, Arc<Clones>>,
    input: CloneInput,
) -> Result<CloneCheck, AppError> {
    current(&webview, &state)?;
    let page = state.pages.for_view(webview.label());
    let check = state
        .sessions()?
        .clone_check(&service, webview.label(), input)
        .await?;
    if !page.is_current() || state.quit.is_quitting() {
        if let Some(review) = &check.review {
            service.cancel_review(webview.label(), &review.id);
        }
        return Err(AppError::new(
            AppErrorCode::SessionNotReady,
            "This clone form was closed.",
        ));
    }
    Ok(check)
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
    let admission = state.sessions()?;
    let manager = (*admission).clone();
    let chats = state.chats().ok_or_else(|| {
        AppError::new(
            AppErrorCode::SessionNotReady,
            "The local workspace is unavailable.",
        )
    })?;
    Ok(manager.clone_start(
        &service,
        webview.label(),
        &id,
        Arc::clone(&chats.registry),
        Box::new(admission),
    )?)
}
#[tauri::command]
#[specta::specta]
pub fn clone_cancel(webview: Webview, service: State<'_, Arc<Clones>>, id: String) {
    service.cancel(webview.label(), &id);
}
/// The clone's record; with `after`, the next revision once Git reports progress (or within ten
/// seconds), so the window follows the clone without polling.
#[tauri::command]
#[specta::specta]
pub async fn clone_status(
    webview: Webview,
    service: State<'_, Arc<Clones>>,
    id: String,
    after: Option<u32>,
) -> Result<CloneRecord, AppError> {
    service
        .status(webview.label(), &id, after)
        .await
        .map_err(error)
}
