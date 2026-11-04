use super::{DictationEvent, DictationModel, Failure, Operation, audio, model};
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Webview, ipc::Channel};

fn error(message: String) -> AppError {
    AppError::new(AppErrorCode::InvalidArgument, message)
}
fn root(state: &AppState) -> Result<PathBuf, AppError> {
    state
        .data_dir()
        .map(PathBuf::from)
        .ok_or_else(|| error("The local data folder is unavailable.".into()))
}
fn operation(
    view: &Webview,
    state: &AppState,
    id: String,
    channel: Channel<DictationEvent>,
) -> Result<Operation, AppError> {
    let page = state.pages.for_view(view.label());
    if state.quit.is_quitting() || !page.is_current() {
        return Err(error("This page is no longer active.".into()));
    }
    let profile = state.sessions()?.generation();
    state
        .dictation
        .begin(
            view.label(),
            id,
            Arc::new(move |event| channel.send(event).is_ok()),
            Box::new(move || page.is_current() && profile.is_current()),
        )
        .map_err(error)
}

#[tauri::command]
#[specta::specta]
pub fn dictation_model(state: State<'_, AppState>) -> Result<DictationModel, AppError> {
    Ok(model::status(&root(&state)?))
}

#[tauri::command]
#[specta::specta]
pub async fn dictation_download(
    webview: Webview,
    state: State<'_, AppState>,
    id: String,
    channel: Channel<DictationEvent>,
) -> Result<(), AppError> {
    let root = root(&state)?;
    let operation = operation(&webview, &state, id, channel)?;
    // Own the task even if an invoke future is abandoned. Page/quit cancellation is explicit.
    tauri::async_runtime::spawn(async move {
        let result = model::download(root, &operation).await;
        operation.finish(result);
    });
    Ok(())
}

/// `language`: the person's language tag (the webview's `navigator.language`). Whisper hears that
/// language, or detects one itself when it does not know the tag.
#[tauri::command]
#[specta::specta]
pub fn dictation_start(
    webview: Webview,
    state: State<'_, AppState>,
    id: String,
    language: Option<String>,
    channel: Channel<DictationEvent>,
) -> Result<(), AppError> {
    let root = root(&state)?;
    let operation = operation(&webview, &state, id, channel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            audio::run(&root, &operation, language.as_deref())
        }))
        .unwrap_or_else(|_| {
            Err(Failure::other(
                "Dictation stopped unexpectedly. Your draft is unchanged. Try again.",
            ))
        });
        operation.finish(result);
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn dictation_stop(webview: Webview, state: State<'_, AppState>, id: String) {
    state.dictation.stop(webview.label(), &id);
}

#[tauri::command]
#[specta::specta]
pub fn dictation_cancel(webview: Webview, state: State<'_, AppState>, id: String) {
    state.dictation.cancel(webview.label(), &id);
}
