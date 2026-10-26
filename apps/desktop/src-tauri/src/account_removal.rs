//! Local erasure stays owned after a renderer reload. It never selects a vendor path or calls the
//! account API. Config restoration must finish through the normal profile switch first.
use crate::state::AppState;
use aura_core::{accounts::Accounts, profile::ProfileKind};
use aura_protocol::account::*;
use std::{future::Future, sync::Arc};
use tauri::{Manager, State};
fn unavailable(message: &str) -> AccountFailure {
    AccountFailure {
        code: AccountFailureCode::InvalidState,
        message: message.into(),
        retry_after_seconds: None,
    }
}

async fn run<T, F, Fut>(app: tauri::AppHandle, action: F) -> Result<T, AccountFailure>
where
    T: Send + 'static,
    F: FnOnce(Arc<Accounts>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, AccountFailure>> + Send + 'static,
{
    tokio::spawn(async move {
        let state=app.state::<AppState>();
        let _transition=state.transition.clone().try_lock_owned().map_err(|_|unavailable("Another account or profile operation is in progress."))?;
        let info=state.app_info();
        if state.quit.is_quitting()||info.profile_switching||info.profile_locked||info.config_profile_recovery.is_some()||info.profile.as_ref().is_none_or(|profile|profile.kind!=ProfileKind::Local){
            return Err(unavailable("Switch to Local and finish configuration recovery before removing an Account from this device."));
        }
        let sessions=state.sessions().map_err(|error|unavailable(&error.message))?;
        let _idle=sessions.try_quiesce_when_idle().ok_or_else(||unavailable("Stop agents and wait for folder operations before removing an Account."))?;
        let _terminals=state.terminals.try_quiesce_when_idle().ok_or_else(||unavailable("Close terminals before removing an Account."))?;
        action(state.accounts.get().await?).await
    }).await.map_err(|_|unavailable("Account removal did not finish. Reopen its pending review before retrying."))?
}

#[tauri::command]
#[specta::specta]
pub async fn account_remove_candidates(
    state: State<'_, AppState>,
) -> Result<Vec<AccountRemovalCandidate>, AccountFailure> {
    state.accounts.get().await?.removal_candidates().await
}
#[tauri::command]
#[specta::specta]
pub async fn account_remove_preview(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<AccountRemovalReview, AccountFailure> {
    run(app, move |accounts| async move {
        accounts
            .prepare_removal(&profile_id, aura_core::time::now_millis() / 1000)
            .await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_remove_apply(
    app: tauri::AppHandle,
    token: String,
    confirmation: String,
) -> Result<AccountStatus, AccountFailure> {
    run(app, move |accounts| async move {
        accounts.remove_from_device(&token, &confirmation).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_remove_cancel(
    app: tauri::AppHandle,
    token: String,
) -> Result<AccountStatus, AccountFailure> {
    run(app, move |accounts| async move {
        accounts.cancel_removal(&token).await
    })
    .await
}
