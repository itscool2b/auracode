//! Thin account IPC. Invoked actions finish even if their page reloads during a vault write.
//! No action runs on mount except explicitly requested local status/config reads.
use crate::state::AppState;
use aura_core::{accounts::Accounts, paths::DataRoot, profile::Profiles};
use aura_protocol::account::*;
use aura_sync::{api::ApiClient, vault::NativeStore, wire::Platform};
use std::{future::Future, path::PathBuf, sync::Arc};
use tauri::State;
use tokio::sync::OnceCell;

pub struct AccountService {
    root: Option<PathBuf>,
    accounts: OnceCell<Arc<Accounts>>,
}
impl AccountService {
    pub fn new(root: Option<PathBuf>) -> Self {
        Self {
            root,
            accounts: OnceCell::new(),
        }
    }
    pub async fn get(&self) -> Result<Arc<Accounts>, AccountFailure> {
        self.accounts
            .get_or_try_init(|| async {
                let root = self.root.clone().ok_or_else(|| {
                    failure(
                        AccountFailureCode::LocalStorage,
                        "The local data folder is unavailable.",
                    )
                })?;
                let config = configuration(option_env!("AURACODE_API_ORIGIN"))?;
                let api = ApiClient::new(&config.service_origin).map_err(|_| {
                    failure(
                        AccountFailureCode::Unavailable,
                        "The account service configuration is invalid.",
                    )
                })?;
                let vault = tokio::task::spawn_blocking(NativeStore::new)
                    .await
                    .map_err(|_| {
                        failure(
                            AccountFailureCode::SecureStorage,
                            "Secure storage could not be opened.",
                        )
                    })?
                    .map_err(|error| {
                        failure(AccountFailureCode::SecureStorage, &error.to_string())
                    })?;
                Ok(Arc::new(
                    Accounts::open(api, Arc::new(vault), Profiles::new(DataRoot::at(root))).await?,
                ))
            })
            .await
            .cloned()
    }
}
fn failure(code: AccountFailureCode, message: &str) -> AccountFailure {
    AccountFailure {
        code,
        message: message.into(),
        retry_after_seconds: None,
    }
}
fn configuration(origin: Option<&str>) -> Result<AccountConfiguration, AccountFailure> {
    let origin = origin.unwrap_or("https://auracode.si");
    if !matches!(
        origin,
        "https://auracode.si" | "https://preview.auracode.si"
    ) {
        return Err(failure(
            AccountFailureCode::Unavailable,
            "The account service configuration is invalid.",
        ));
    }
    Ok(AccountConfiguration {
        service_origin: origin.into(),
        verification_url: format!("{origin}/verify-device"),
    })
}
fn now() -> i64 {
    aura_core::time::now_millis() / 1000
}
async fn run<T, F, Fut>(state: &AppState, action: F) -> Result<T, AccountFailure>
where
    T: Send + 'static,
    F: FnOnce(Arc<Accounts>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, AccountFailure>> + Send + 'static,
{
    let accounts = state.accounts.get().await?;
    // Dropping a JoinHandle detaches it. A webview reload cannot cancel a half-completed local
    // credential/index publication or leave the service's in-memory state behind its saved state.
    tokio::spawn(async move { action(accounts).await })
        .await
        .map_err(|_| {
            failure(
                AccountFailureCode::Unavailable,
                "The account action could not finish.",
            )
        })?
}

#[tauri::command]
#[specta::specta]
pub fn account_config() -> Result<AccountConfiguration, AccountFailure> {
    configuration(option_env!("AURACODE_API_ORIGIN"))
}

#[tauri::command]
#[specta::specta]
pub async fn account_status(state: State<'_, AppState>) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move { accounts.status().await }).await
}
#[tauri::command]
#[specta::specta]
pub async fn account_request_code(
    state: State<'_, AppState>,
    email: String,
    turnstile_token: String,
) -> Result<SignInChallenge, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.request_code(&email, &turnstile_token).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_verify_code(
    state: State<'_, AppState>,
    challenge_id: String,
    code: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.verify_code(&challenge_id, &code).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_refresh(state: State<'_, AppState>) -> Result<AccountStatus, AccountFailure> {
    run(
        &state,
        |accounts| async move { accounts.refresh(now()).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_register_device(
    state: State<'_, AppState>,
    name: String,
) -> Result<AccountStatus, AccountFailure> {
    let platform = if cfg!(windows) {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::Macos
    } else {
        return Err(failure(
            AccountFailureCode::Unavailable,
            "Account sync supports Windows and macOS.",
        ));
    };
    run(&state, move |accounts| async move {
        accounts.register_device(&name, platform, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_prepare_recovery(
    state: State<'_, AppState>,
) -> Result<RecoverySetup, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.prepare_recovery().await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_cancel_setup(
    state: State<'_, AppState>,
) -> Result<AccountStatus, AccountFailure> {
    run(
        &state,
        |accounts| async move { accounts.cancel_setup().await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_confirm_recovery(
    state: State<'_, AppState>,
    setup_id: String,
    retained: bool,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, move |accounts| async move {
        accounts.confirm_recovery(&setup_id, retained, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_recover(
    state: State<'_, AppState>,
    recovery_key: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.recover(recovery_key, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_confirm_fingerprint(
    state: State<'_, AppState>,
    fingerprint: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.confirm_fingerprint(&fingerprint, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_devices(
    state: State<'_, AppState>,
) -> Result<Vec<AccountDevice>, AccountFailure> {
    run(
        &state,
        |accounts| async move { accounts.devices(now()).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_approve_device(
    state: State<'_, AppState>,
    device_id: String,
    verification_code: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move {
        accounts
            .approve_device(&device_id, &verification_code, now())
            .await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_revoke_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, |accounts| async move {
        accounts.revoke_device(&device_id, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_sign_out(
    state: State<'_, AppState>,
) -> Result<AccountSignOut, AccountFailure> {
    run(&state, |accounts| async move { accounts.sign_out().await }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_origin_is_fixed_to_the_same_release_environment() {
        assert_eq!(
            configuration(None).unwrap().verification_url,
            "https://auracode.si/verify-device"
        );
        assert_eq!(
            configuration(Some("https://preview.auracode.si"))
                .unwrap()
                .verification_url,
            "https://preview.auracode.si/verify-device"
        );
        for origin in [
            "http://auracode.si",
            "https://api.auracode.si",
            "https://auracode.si.evil.test",
            "https://auracode.si/path",
            "https://user@auracode.si",
            "",
        ] {
            assert!(configuration(Some(origin)).is_err());
        }
    }
}
