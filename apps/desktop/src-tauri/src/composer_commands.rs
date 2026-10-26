//! Composer IPC is a thin binding over the Rust context service.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_protocol::{
    composer::{ComposerAttachment, ComposerInput, FileMention},
    session::PromptAck,
};
use tauri::{AppHandle, Manager as _, State};

#[tauri::command]
#[specta::specta]
pub async fn composer_pick(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Option<ComposerAttachment>, AppError> {
    use tauri_plugin_dialog::DialogExt as _;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Attach an image or text file");
    if let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|_| {
        AppError::new(
            AppErrorCode::DialogFailed,
            "The file picker could not be shown.",
        )
    })?
    else {
        return Ok(None);
    };
    let path = picked
        .simplified()
        .into_path()
        .map_err(|_| AppError::new(AppErrorCode::DialogFailed, "Select a local file."))?;
    Ok(Some(
        state.sessions()?.composer_import(&chat_id, path).await?,
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn composer_import(
    state: State<'_, AppState>,
    chat_id: String,
    path: String,
) -> Result<ComposerAttachment, AppError> {
    Ok(state
        .sessions()?
        .composer_import(&chat_id, path.into())
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn composer_paste(
    state: State<'_, AppState>,
    chat_id: String,
    bytes: Vec<u8>,
) -> Result<ComposerAttachment, AppError> {
    Ok(state.sessions()?.composer_paste(&chat_id, bytes).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn composer_mentions(
    state: State<'_, AppState>,
    chat_id: String,
    query: String,
) -> Result<Vec<FileMention>, AppError> {
    Ok(state.sessions()?.composer_mentions(&chat_id, query).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn composer_send(
    state: State<'_, AppState>,
    chat_id: String,
    input: ComposerInput,
) -> Result<PromptAck, AppError> {
    Ok(state.sessions()?.composer_send(&chat_id, input).await?)
}
