//! Thin account IPC. Invoked actions finish even if their page reloads during a vault write.
//! No action runs on mount except explicitly requested local status/config reads.
use crate::state::AppState;
use aura_core::{accounts::Accounts, paths::DataRoot, profile::Profiles};
use aura_protocol::account::*;
use aura_sync::{api::ApiClient, vault::NativeStore, wire::Platform};
use std::{
    future::Future,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::State;
use tokio::sync::OnceCell;

#[derive(Clone)]
pub struct AccountService {
    root: Option<PathBuf>,
    accounts: Arc<OnceCell<Arc<Accounts>>>,
    passphrase: Arc<AtomicBool>,
}
impl AccountService {
    pub fn new(root: Option<PathBuf>) -> Self {
        Self {
            root,
            accounts: Arc::new(OnceCell::new()),
            passphrase: Arc::new(AtomicBool::new(false)),
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
                let inspect_root=root.clone();
                let present=tokio::task::spawn_blocking(move||aura_core::accounts::passphrase::inspect(&inspect_root))
                    .await.map_err(|_|failure(AccountFailureCode::LocalStorage,"Secure storage could not be inspected."))??;
                if present!=aura_core::accounts::passphrase::Presence::Missing {
                    return Err(failure(AccountFailureCode::SecureStorage,"Unlock your passphrase store to use account services. OS credentials were not read."));
                }
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
    async fn vault_status(&self) -> Result<AccountVaultStatus, AccountFailure> {
        use aura_core::accounts::passphrase::{self, Presence};
        let root = self.root.clone().ok_or_else(|| {
            failure(
                AccountFailureCode::LocalStorage,
                "The local data folder is unavailable.",
            )
        })?;
        let presence = tokio::task::spawn_blocking(move || passphrase::inspect(&root))
            .await
            .map_err(|_| {
                failure(
                    AccountFailureCode::LocalStorage,
                    "Secure storage could not be inspected.",
                )
            })??;
        let mode = if self.passphrase.load(Ordering::Acquire) {
            AccountVaultMode::PassphraseUnlocked
        } else if presence == Presence::Missing {
            AccountVaultMode::Native
        } else if self.accounts.get().is_some() {
            AccountVaultMode::RestartRequired
        } else {
            AccountVaultMode::PassphraseLocked
        };
        Ok(AccountVaultStatus {
            mode,
            can_create: presence != Presence::Existing,
        })
    }
    async fn unlock_vault(
        &self,
        passphrase: zeroize::Zeroizing<String>,
        create: bool,
    ) -> Result<AccountVaultStatus, AccountFailure> {
        if !(12..=1024).contains(&passphrase.len()) {
            return Err(failure(
                AccountFailureCode::InvalidInput,
                "Use a passphrase between 12 and 1024 bytes.",
            ));
        }
        if let Some(accounts) = self.accounts.get() {
            if !create || self.passphrase.load(Ordering::Acquire) {
                return self.vault_status().await;
            }
            let accounts = accounts.clone();
            tokio::task::spawn_blocking(move || accounts.prepare_passphrase_store(passphrase))
                .await
                .map_err(|_| {
                    failure(
                        AccountFailureCode::SecureStorage,
                        "The passphrase store could not be created.",
                    )
                })??;
            return self.vault_status().await;
        }
        let root = self.root.clone().ok_or_else(|| {
            failure(
                AccountFailureCode::LocalStorage,
                "The local data folder is unavailable.",
            )
        })?;
        let origin = configuration(option_env!("AURACODE_API_ORIGIN"))?.service_origin;
        self.accounts
            .get_or_try_init(|| async {
                let selected_root = root.clone();
                let selected_origin = origin.clone();
                let vault = tokio::task::spawn_blocking(move || {
                    aura_core::accounts::passphrase::open(
                        &selected_root,
                        &selected_origin,
                        passphrase,
                        create,
                    )
                })
                .await
                .map_err(|_| {
                    failure(
                        AccountFailureCode::SecureStorage,
                        "The passphrase store could not be unlocked.",
                    )
                })??;
                let api = ApiClient::new(&origin).map_err(|_| {
                    failure(
                        AccountFailureCode::Unavailable,
                        "The account service configuration is invalid.",
                    )
                })?;
                let accounts =
                    Arc::new(Accounts::open(api, vault, Profiles::new(DataRoot::at(root))).await?);
                self.passphrase.store(true, Ordering::Release);
                Ok::<_, AccountFailure>(accounts)
            })
            .await?;
        self.vault_status().await
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
#[derive(Clone, Copy)]
enum AccountAction {
    /// Explicit sign-in/device proof may be required to unlock the Account owning recovery.
    RecoverAccess,
    Manage,
}
fn admit(
    quitting: bool,
    switching: bool,
    recovery: Option<&crate::profile_config::ConfigProfileRecovery>,
    action: AccountAction,
) -> Result<(), AccountFailure> {
    if quitting || switching {
        return Err(failure(
            AccountFailureCode::Unavailable,
            "Wait for the current profile transition to finish.",
        ));
    }
    if recovery.is_some_and(|recovery| {
        !matches!(action, AccountAction::RecoverAccess) || recovery.owner_profile.is_none()
    }) {
        return Err(failure(
            AccountFailureCode::Unavailable,
            "Recover the interrupted configuration switch before changing account or device settings. Sign-in and account-key recovery remain available.",
        ));
    }
    Ok(())
}
async fn owned<T: Send + 'static>(
    permit: tokio::sync::OwnedMutexGuard<()>,
    operation: impl Future<Output = Result<T, AccountFailure>> + Send + 'static,
) -> Result<T, AccountFailure> {
    tokio::spawn(async move {
        let _permit = permit;
        operation.await
    })
    .await
    .map_err(|_| {
        failure(
            AccountFailureCode::Unavailable,
            "The account action could not finish.",
        )
    })?
}
fn can_resume(status: &AccountStatus, profile: Option<&str>, recovery_pending: bool) -> bool {
    !recovery_pending
        && profile.is_some()
        && status.access == AccountAccess::Ready
        && status.profile_id.as_deref() == profile
}
async fn run<T, F, Fut>(
    state: &AppState,
    kind: AccountAction,
    action: F,
) -> Result<T, AccountFailure>
where
    T: Send + 'static,
    F: FnOnce(Arc<Accounts>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, AccountFailure>> + Send + 'static,
{
    let permit = state.transition.clone().try_lock_owned().map_err(|_| {
        failure(
            AccountFailureCode::Unavailable,
            "Another account or profile operation is in progress.",
        )
    })?;
    let info = state.app_info();
    admit(
        state.quit.is_quitting(),
        info.profile_switching,
        info.config_profile_recovery.as_ref(),
        kind,
    )?;
    let service = state.accounts.clone();
    let root = state.data_dir().map(std::path::Path::to_path_buf);
    let profile = info.profile.map(|profile| profile.id);
    let engine = state
        .chats()
        .and_then(|chats| chats.sync_engine.get().cloned());
    // Dropping a JoinHandle detaches it. A webview reload cannot cancel a half-completed local
    // credential/index publication or leave the service's in-memory state behind its saved state.
    owned(permit, async move {
        let accounts = service.get().await?;
        if let Some(engine) = &engine
            && !engine.suspend(std::time::Duration::from_secs(5)).await
        {
            return Err(failure(
                AccountFailureCode::Unavailable,
                "Account sync could not pause. Try again after the current request finishes.",
            ));
        }
        let result = action(accounts.clone()).await;
        let recovery_pending = root
            .as_ref()
            .is_none_or(|root| !matches!(aura_core::config_transition::pending(root), Ok(None)));
        if let Some(engine) = engine
            && accounts
                .status()
                .await
                .is_ok_and(|status| can_resume(&status, profile.as_deref(), recovery_pending))
        {
            engine.resume();
        }
        result
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn account_config() -> Result<AccountConfiguration, AccountFailure> {
    configuration(option_env!("AURACODE_API_ORIGIN"))
}

#[tauri::command]
#[specta::specta]
pub async fn account_vault_status(
    state: State<'_, AppState>,
) -> Result<AccountVaultStatus, AccountFailure> {
    state.accounts.vault_status().await
}
#[tauri::command]
#[specta::specta]
pub async fn account_vault_unlock(
    state: State<'_, AppState>,
    passphrase: String,
    create: bool,
) -> Result<AccountVaultStatus, AccountFailure> {
    let passphrase = zeroize::Zeroizing::new(passphrase);
    let permit = state.transition.clone().try_lock_owned().map_err(|_| {
        failure(
            AccountFailureCode::Unavailable,
            "Another account or profile operation is in progress.",
        )
    })?;
    let info = state.app_info();
    admit(
        state.quit.is_quitting(),
        info.profile_switching,
        info.config_profile_recovery.as_ref(),
        AccountAction::RecoverAccess,
    )?;
    let service = state.accounts.clone();
    owned(permit, async move {
        service.unlock_vault(passphrase, create).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn account_status(state: State<'_, AppState>) -> Result<AccountStatus, AccountFailure> {
    let status = state.accounts.get().await?.status().await?;
    Ok(crate::account_sync::with_status(&state, status))
}
#[tauri::command]
#[specta::specta]
pub async fn account_reset_status(
    state: State<'_, AppState>,
) -> Result<AccountResetStatus, AccountFailure> {
    state.accounts.get().await?.reset_status().await
}
#[tauri::command]
#[specta::specta]
pub async fn account_reset_review(
    state: State<'_, AppState>,
) -> Result<AccountResetReview, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.prepare_sync_reset(now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_reset_confirm(
    state: State<'_, AppState>,
    review_id: String,
    confirmation: String,
    retained: bool,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts
            .confirm_sync_reset(&review_id, &confirmation, retained, now())
            .await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_reset_retry(
    state: State<'_, AppState>,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.retry_sync_reset(now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_reset_cancel(
    state: State<'_, AppState>,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.cancel_sync_reset(now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_request_code(
    state: State<'_, AppState>,
    email: String,
    turnstile_token: String,
) -> Result<SignInChallenge, AccountFailure> {
    run(
        &state,
        AccountAction::RecoverAccess,
        |accounts| async move { accounts.request_code(&email, &turnstile_token).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_verify_code(
    state: State<'_, AppState>,
    challenge_id: String,
    code: String,
) -> Result<AccountStatus, AccountFailure> {
    run(
        &state,
        AccountAction::RecoverAccess,
        |accounts| async move { accounts.verify_code(&challenge_id, &code).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_refresh(state: State<'_, AppState>) -> Result<AccountStatus, AccountFailure> {
    run(
        &state,
        AccountAction::RecoverAccess,
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
    run(
        &state,
        AccountAction::RecoverAccess,
        move |accounts| async move { accounts.register_device(&name, platform, now()).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_prepare_recovery(
    state: State<'_, AppState>,
) -> Result<RecoverySetup, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.prepare_recovery().await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_cancel_setup(
    state: State<'_, AppState>,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.cancel_setup().await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_confirm_recovery(
    state: State<'_, AppState>,
    setup_id: String,
    retained: bool,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, move |accounts| async move {
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
    run(
        &state,
        AccountAction::RecoverAccess,
        |accounts| async move { accounts.recover(recovery_key, now()).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_confirm_fingerprint(
    state: State<'_, AppState>,
    fingerprint: String,
) -> Result<AccountStatus, AccountFailure> {
    run(
        &state,
        AccountAction::RecoverAccess,
        |accounts| async move { accounts.confirm_fingerprint(&fingerprint, now()).await },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_devices(
    state: State<'_, AppState>,
) -> Result<Vec<AccountDevice>, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.devices(now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_approve_device(
    state: State<'_, AppState>,
    device_id: String,
    verification_code: String,
) -> Result<AccountStatus, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
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
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.revoke_device(&device_id, now()).await
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn account_sign_out(
    state: State<'_, AppState>,
) -> Result<AccountSignOut, AccountFailure> {
    run(&state, AccountAction::Manage, |accounts| async move {
        accounts.sign_out().await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn explicit_passphrase_selection_reopens_locked_without_native_access() {
        let root = tempfile::tempdir().unwrap();
        let service = AccountService::new(Some(root.path().to_owned()));
        assert_eq!(
            service.vault_status().await.unwrap().mode,
            AccountVaultMode::Native
        );
        let pass = || zeroize::Zeroizing::new("synthetic account unlock phrase".into());
        assert_eq!(
            service.unlock_vault(pass(), true).await.unwrap().mode,
            AccountVaultMode::PassphraseUnlocked
        );
        assert_eq!(
            service.get().await.unwrap().status().await.unwrap().access,
            AccountAccess::SignedOut
        );
        drop(service);
        let service = AccountService::new(Some(root.path().to_owned()));
        assert_eq!(
            service.vault_status().await.unwrap().mode,
            AccountVaultMode::PassphraseLocked
        );
        assert!(matches!(
            service.get().await,
            Err(AccountFailure {
                code: AccountFailureCode::SecureStorage,
                ..
            })
        ));
        assert!(
            service
                .unlock_vault(
                    zeroize::Zeroizing::new("incorrect synthetic phrase".into()),
                    false
                )
                .await
                .is_err()
        );
        assert_eq!(
            service.unlock_vault(pass(), false).await.unwrap().mode,
            AccountVaultMode::PassphraseUnlocked
        );
    }
    #[tokio::test]
    async fn incomplete_passphrase_choice_never_falls_back_to_native_storage() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("account-passphrase-vault")).unwrap();
        let service = AccountService::new(Some(root.path().to_owned()));
        let status = service.vault_status().await.unwrap();
        assert!(status.can_create);
        assert_eq!(status.mode, AccountVaultMode::PassphraseLocked);
        assert!(service.get().await.is_err());
    }
    #[test]
    fn recovery_allows_only_explicit_access_restoration_and_never_resumes_sync() {
        let pending = crate::profile_config::ConfigProfileRecovery {
            transaction: Some("transaction".into()),
            owner_profile: Some("owner".into()),
            from_profile: Some("local".into()),
            to_profile: Some("owner".into()),
            phase: crate::profile_config::ConfigProfileRecoveryPhase::RestorePrevious,
            detail: "fixture".into(),
        };
        assert!(admit(false, false, Some(&pending), AccountAction::Manage).is_err());
        assert!(admit(false, false, Some(&pending), AccountAction::RecoverAccess).is_ok());
        assert!(admit(false, true, Some(&pending), AccountAction::RecoverAccess).is_err());
        let unknown = crate::profile_config::ConfigProfileRecovery {
            owner_profile: None,
            ..pending
        };
        assert!(admit(false, false, Some(&unknown), AccountAction::RecoverAccess).is_err());
        let status = AccountStatus {
            access: AccountAccess::Ready,
            account_id: Some("account".into()),
            device_id: Some("device".into()),
            profile_id: Some("owner".into()),
            local_key_available: true,
            approval_code: None,
            fingerprint: None,
            sync: AccountSyncStatus {
                state: AccountSyncState::Inactive,
                pending_changes: None,
                last_sync_at: None,
                message: None,
            },
        };
        assert!(!can_resume(&status, Some("owner"), true));
        assert!(!can_resume(&status, Some("other"), false));
        assert!(can_resume(&status, Some("owner"), false));
    }
    #[tokio::test]
    async fn cancelled_renderer_keeps_account_action_exclusive_until_owned_completion() {
        let serial = Arc::new(tokio::sync::Mutex::new(()));
        let permit = serial.clone().try_lock_owned().unwrap();
        let (started, began) = tokio::sync::oneshot::channel();
        let (finish, done) = tokio::sync::oneshot::channel();
        let (completed, finished) = tokio::sync::oneshot::channel();
        let caller = tokio::spawn(owned(permit, async move {
            let _ = started.send(());
            let _ = done.await;
            let _ = completed.send(());
            Ok(())
        }));
        began.await.unwrap();
        caller.abort();
        assert!(serial.clone().try_lock_owned().is_err());
        finish.send(()).unwrap();
        finished.await.unwrap();
        let _guard = tokio::time::timeout(std::time::Duration::from_secs(1), serial.lock_owned())
            .await
            .unwrap();
    }
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
