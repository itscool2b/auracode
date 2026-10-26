//! Explicit dataset switches. Preparation keeps the current runtime usable on failure; publication
//! closes its subscriptions and swaps the whole runtime without merging Local and Account rows.
use crate::{
    boot,
    error::{AppError, AppErrorCode},
    onboarding::SetupService,
    sessions::{self, ChatRuntime, Outside},
    state::{AppInfo, AppState},
    sync::lock,
};
use aura_core::{
    paths::DataRoot,
    profile::{Profile, ProfileKind, ProfileMeta, Profiles},
    sync::{SyncContext, SyncIdentity, journal::AccountConfigJournal},
};
use aura_sync::crypto::files::ProfileFileKey;
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager, State};

pub const PROFILE_CHANGED: &str = "profile-changed";
#[cfg(test)]
mod tests;
enum Target {
    Account,
    Id(String),
}
struct Resolved {
    profile: Profile,
    key: Option<SyncContext>,
}
impl Resolved {
    fn account(unlocked: aura_core::accounts::AccountProfile) -> Result<Self, AppError> {
        Ok(Self {
            profile: unlocked.profile,
            key: Some(SyncContext {
                identity: SyncIdentity {
                    account: unlocked.account_id,
                    device: unlocked.device_id.ok_or_else(|| unavailable("This account profile has no bound device identity. Reconnect the account before opening it."))?,
                    key_version: unlocked.key_version,
                },
                key: unlocked.key,
            }),
        })
    }
}
struct Switching<'a> {
    state: &'a AppState,
    _serial: tokio::sync::OwnedMutexGuard<()>,
}
impl Drop for Switching<'_> {
    fn drop(&mut self) {
        lock(&self.state.runtime).info.profile_switching = false;
    }
}
fn unavailable(message: &str) -> AppError {
    AppError::new(AppErrorCode::StorageUnavailable, message)
}
fn root(state: &AppState) -> Result<DataRoot, AppError> {
    state
        .data_dir()
        .map(DataRoot::at)
        .ok_or_else(|| unavailable("The local data folder is unavailable."))
}
fn account_error(error: aura_protocol::account::AccountFailure) -> AppError {
    unavailable(&error.message)
}

#[tauri::command]
#[specta::specta]
pub async fn profiles_list(state: State<'_, AppState>) -> Result<Vec<ProfileMeta>, AppError> {
    let profiles = Profiles::new(root(&state)?);
    tokio::task::spawn_blocking(move || profiles.list())
        .await
        .map_err(|_| unavailable("Profiles could not be listed."))?
        .map_err(|_| unavailable("Profiles could not be listed. Existing data was preserved."))
}
#[tauri::command]
#[specta::specta]
pub async fn account_activate(app: tauri::AppHandle) -> Result<AppInfo, AppError> {
    run(app, Target::Account).await
}
#[tauri::command]
#[specta::specta]
pub async fn profile_activate(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<AppInfo, AppError> {
    run(app, Target::Id(profile_id)).await
}

async fn resolve(state: &AppState, target: Target) -> Result<Resolved, AppError> {
    if let Target::Id(id) = target {
        let profiles = Profiles::new(root(state)?);
        let profile = tokio::task::spawn_blocking(move || profiles.get(&id))
            .await
            .map_err(|_| unavailable("The profile could not be read."))?
            .map_err(|_| {
                unavailable("The selected profile is unavailable. Existing data was preserved.")
            })?;
        if profile.meta.kind == ProfileKind::Local {
            return Ok(Resolved { profile, key: None });
        }
        let accounts = state.accounts.get().await.map_err(account_error)?;
        accounts
            .restore_profile(&profile.meta.id, aura_core::time::now_millis() / 1000)
            .await
            .map_err(account_error)?;
        let unlocked = accounts.local_profile().await.map_err(account_error)?;
        if unlocked.profile.meta.id != profile.meta.id {
            return Err(unavailable(
                "The account key does not belong to the selected profile.",
            ));
        }
        return Resolved::account(unlocked);
    }
    let accounts = state.accounts.get().await.map_err(account_error)?;
    let unlocked = accounts.local_profile().await.map_err(account_error)?;
    Resolved::account(unlocked)
}

async fn run(app: tauri::AppHandle, target: Target) -> Result<AppInfo, AppError> {
    // Completion belongs to the app, not the invoking page. A reload cannot abandon a committed
    // active pointer while leaving the old runtime in memory.
    tokio::spawn(async move {
        let state = app.state::<AppState>();
        let previous_engine = state
            .chats()
            .and_then(|chats| chats.sync_engine.get().cloned());
        if let Some(engine) = &previous_engine
            && !engine.suspend(Duration::from_secs(5)).await
        {
            return Err(unavailable(
                "Account sync could not pause before the profile switch.",
            ));
        }
        let result = async {
            let resolved = resolve(&state, target).await?;
            activate(&state, resolved, Outside::real).await
        }
        .await;
        let result = match result {
            Ok(info) => info,
            Err(error) => {
                if let Some(engine) = previous_engine {
                    engine.resume();
                }
                return Err(error);
            }
        };
        crate::account_sync::attach(&app).await;
        if let Some(library) = app.try_state::<Arc<crate::config_library::LibraryService>>() {
            library.reset_profile();
        }
        if let Some(sync) = app.try_state::<Arc<crate::config_sync::ConfigSyncService>>() {
            sync.reset_profile();
        }
        if let Some(vendor) = app.try_state::<Arc<crate::config_vendor::VendorService>>() {
            vendor.reset_profile();
        }
        if let Some(clones) = app.try_state::<Arc<aura_core::cloning::Clones>>() {
            clones.cancel_all();
        }
        crate::native_shell::profile_changed(&app);
        let _ = app.emit(PROFILE_CHANGED, &result);
        Ok(result)
    })
    .await
    .map_err(|_| {
        unavailable("The profile switch could not finish. Restart auracode before retrying.")
    })?
}

async fn activate(
    state: &AppState,
    selected: Resolved,
    outside: impl FnOnce(
        &Arc<aura_process::LeftoverRegistry>,
        &Arc<aura_process::Redactor>,
        &std::path::Path,
        &tokio::runtime::Handle,
    ) -> Outside
    + Send
    + 'static,
) -> Result<AppInfo, AppError> {
    let serial = state
        .transition
        .clone()
        .try_lock_owned()
        .map_err(|_| unavailable("Another profile transition is in progress."))?;
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is closing.",
        ));
    }
    let old = {
        let mut runtime = lock(&state.runtime);
        if runtime.info.profile.as_ref().map(|profile| &profile.id)
            == Some(&selected.profile.meta.id)
            && runtime.chats.is_some()
        {
            return Ok(runtime.info.clone());
        }
        runtime.info.profile_switching = true;
        runtime.chats.clone()
    };
    let _switching = Switching {
        state,
        _serial: serial,
    };
    tokio::time::timeout(Duration::from_secs(5), state.wait_profile_commands())
        .await
        .map_err(|_| {
            unavailable("Wait for current profile commands to finish, then retry switching.")
        })?;
    let _sessions = match &old {
        Some(old) => Some(old.manager.try_quiesce_when_idle().ok_or_else(|| unavailable("Stop all agents and wait for folder operations to finish before switching profiles."))?),
        None => None,
    };
    let _terminals = state
        .terminals
        .try_quiesce_when_idle()
        .ok_or_else(|| unavailable("Close all terminals before switching profiles."))?;
    if let Some(old) = &old {
        if !matches!(
            old.manager.storage_status().state,
            aura_protocol::session::StorageState::Ok
        ) {
            return Err(unavailable(
                "Resolve the current profile's storage error before switching.",
            ));
        }
        old.store.flush(Duration::from_secs(5)).await.map_err(|_| {
            unavailable(
                "The current profile could not confirm its pending writes. Nothing was switched.",
            )
        })?;
    }
    let data_root = root(state)?;
    let profile_id = selected.profile.meta.id.clone();
    let rt = tokio::runtime::Handle::current();
    let version = state.app_info().app_version;
    let reuse = old.as_ref().map(|old| old.services.clone());
    let (mut prepared, onboarding, next, context) = tokio::task::spawn_blocking(move || {
        if selected.key.is_some() {
            aura_core::accounts::audit_profile(&selected.profile).map_err(account_error)?;
        }
        let (database_key, file_key): (_, Option<Arc<ProfileFileKey>>) = match &selected.key {
            Some(context) => (
                Some(Arc::new(
                    context.key.database_key(&context.identity.account, &selected.profile.meta.id)
                        .map_err(|_| {
                            unavailable("The account database key could not be derived.")
                        })?,
                )),
                Some(Arc::new(
                    context.key.profile_file_key(&context.identity.account, &selected.profile.meta.id)
                        .map_err(|_| unavailable("The account file key could not be derived."))?,
                )),
            ),
            None => (None, None),
        };
        let mut prepared = boot::boot_profile(data_root, selected.profile.clone(), database_key);
        if let Some(message) = &prepared.fatal {
            return Err(unavailable(message));
        }
        let onboarding = Arc::new(match &file_key {
            Some(key) => SetupService::account(&selected.profile, key.clone())?,
            None => SetupService::new(selected.profile.dir.clone()),
        });
        let journal = file_key.as_ref().map(|key| AccountConfigJournal::open(selected.profile.dir.join("config-apply"), key.clone()))
            .transpose().map_err(|_| unavailable("The account configuration journal could not be authenticated. Existing data was preserved."))?;
        let mut next =
            sessions::start_profile_chats(&mut prepared, &version, &rt, outside, file_key, reuse)
                .ok_or_else(|| {
                unavailable(
                    prepared
                        .fatal
                        .as_deref()
                        .unwrap_or("The selected profile could not start."),
                )
            })?;
        next.account_config = journal.map(|journal| Arc::new(crate::account_config::AccountConfigServices::new(&next.store, journal)));
        next.sync_identity = selected.key.as_ref().map(|context| context.identity.clone());
        Ok::<_, AppError>((prepared, onboarding, Arc::new(next), selected.key))
    })
    .await
    .map_err(|_| {
        unavailable("The selected profile could not be prepared. Nothing was switched.")
    })??;
    let recovered = tokio::time::timeout(Duration::from_secs(5), next.store.recovered()).await;
    if recovered.is_err()
        || next.store.flush(Duration::from_secs(5)).await.is_err()
        || state.quit.is_quitting()
    {
        discard(&next).await;
        return Err(unavailable(
            "The selected profile could not confirm its storage, or auracode is closing. Nothing was switched.",
        ));
    }
    if let Some(context) = context
        && !matches!(
            tokio::time::timeout(Duration::from_secs(5), next.store.configure_sync(context)).await,
            Ok(Ok(()))
        )
    {
        discard(&next).await;
        return Err(unavailable(
            "The account sync ledger could not be authenticated. Nothing was switched.",
        ));
    }
    let profiles = Profiles::new(root(state)?);
    let published = tokio::task::spawn_blocking(move || profiles.set_active(&profile_id)).await;
    if !matches!(published, Ok(Ok(_))) {
        discard(&next).await;
        return Err(unavailable(
            "The active profile could not be saved. The current profile remains open.",
        ));
    }
    // No fallible preparation remains after publication. Old data was flushed before this point;
    // a close failure is reported honestly while retaining its WAL/recovery files.
    state.integrity.close();
    if let Some(old) = &old {
        if let Some(engine) = old.sync_engine.get() {
            engine.close(Duration::from_secs(2)).await;
        }
        if let Some(config) = &old.account_config {
            config.close();
        }
        for owner in state.pages.invalidate_all() {
            old.manager.drop_owner(&owner);
        }
        old.manager.shutdown_all(Duration::from_secs(5)).await;
        if !old.store.shutdown(Duration::from_secs(5)).await {
            prepared.notices.push("The previous profile did not confirm a clean close. Its saved data and recovery files remain available.".into());
        }
    }
    state.install_profile(prepared, next, onboarding);
    let mut info = state.app_info();
    info.profile_switching = false;
    Ok(info)
}
async fn discard(runtime: &ChatRuntime) {
    if let Some(engine) = runtime.sync_engine.get() {
        engine.close(Duration::from_secs(2)).await;
    }
    if let Some(config) = &runtime.account_config {
        config.close();
    }
    runtime.manager.shutdown_all(Duration::from_secs(2)).await;
    runtime.store.shutdown(Duration::from_secs(5)).await;
}

/// Restore the previously selected account from auracode's own vault without an API request.
/// A failed unlock leaves its data untouched and keeps explicit Local selection available.
pub(crate) fn restore_selected(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    let info = state.app_info();
    if !info.profile_locked || state.launch.is_smoke() {
        return;
    }
    let Some(profile) = info.profile else {
        return;
    };
    tokio::spawn(async move {
        if let Err(error) = run(app.clone(), Target::Id(profile.id)).await {
            let state = app.state::<AppState>();
            lock(&state.runtime).info.notices.push(error.message);
            let _ = app.emit(PROFILE_CHANGED, state.app_info());
        }
    });
}
