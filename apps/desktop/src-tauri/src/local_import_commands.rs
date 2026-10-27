//! Explicit Local import. Source identity is fixed by the app; IPC never supplies a filesystem path.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::{
    paths::DataRoot,
    profile::{LOCAL_PROFILE_ID, Profile, Profiles},
};
use aura_protocol::local_import::{LocalImportPreview, LocalImportResult, LocalImportSelection};
use tauri::{Manager, State, Webview};

fn source(state: &AppState) -> Result<Profile, AppError> {
    let root = state.data_dir().ok_or_else(|| {
        AppError::new(
            AppErrorCode::StorageUnavailable,
            "The data folder is unavailable.",
        )
    })?;
    Profiles::new(DataRoot::at(root))
        .get(LOCAL_PROFILE_ID)
        .map_err(|_| {
            AppError::new(
                AppErrorCode::StorageUnavailable,
                "The Local profile is unavailable.",
            )
        })
}
fn current(webview: &Webview, state: &AppState) -> Result<(), AppError> {
    if state.quit.is_quitting() || !state.pages.for_view(webview.label()).is_current() {
        return Err(AppError::new(
            AppErrorCode::SessionNotReady,
            "This page is no longer active.",
        ));
    }
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub async fn local_import_preview(
    webview: Webview,
    state: State<'_, AppState>,
) -> Result<LocalImportPreview, AppError> {
    current(&webview, &state)?;
    let _account = state.account_config()?;
    let source = source(&state)?;
    Ok(state.sessions()?.local_import_preview(source).await?)
}
#[tauri::command]
#[specta::specta]
pub async fn local_import_apply(
    webview: Webview,
    state: State<'_, AppState>,
    selected: Vec<LocalImportSelection>,
) -> Result<LocalImportResult, AppError> {
    current(&webview, &state)?;
    let account = state.account_config()?;
    let sessions = state.sessions()?;
    let source = source(&state)?;
    let app = webview.app_handle().clone();
    tokio::spawn(async move {
        let _account = account;
        let result = sessions.local_import_apply(source, selected).await?;
        crate::account_sync::trigger(&app);
        Ok(result)
    })
    .await
    .map_err(|_| {
        AppError::new(
            AppErrorCode::Internal,
            "The Local import task could not finish.",
        )
    })?
}
