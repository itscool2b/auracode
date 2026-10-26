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
    _serial: Option<tokio::sync::OwnedMutexGuard<()>>,
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

#[tauri::command]
#[specta::specta]
pub async fn config_profile_recover(app: tauri::AppHandle) -> Result<AppInfo, AppError> {
    tokio::spawn(async move {
        let state = app.state::<AppState>();
        let serial = state
            .transition
            .clone()
            .try_lock_owned()
            .map_err(|_| unavailable("Another profile transition is in progress."))?;
        if state.quit.is_quitting() {
            return Err(unavailable("auracode is closing."));
        }
        let data_root = root(&state)?;
        let locator = aura_core::config_transition::pending(data_root.root())
            .map_err(|_| crate::profile_config::error())?
            .ok_or_else(crate::profile_config::error)?;
        let current = aura_core::config_transition::active_profile(data_root.root())
            .map_err(|_| crate::profile_config::error())?;
        if state
            .app_info()
            .profile
            .as_ref()
            .map(|profile| profile.id.as_str())
            != Some(current.as_str())
        {
            return Err(crate::profile_config::error());
        }
        let chats = state.chats().ok_or_else(|| {
            unavailable("Unlock the selected Account profile before recovering its configuration.")
        })?;
        lock(&state.runtime).info.profile_switching = true;
        let _switching = Switching {
            state: &state,
            _serial: Some(serial),
        };
        tokio::time::timeout(Duration::from_secs(5), state.wait_profile_commands())
            .await
            .map_err(|_| {
                unavailable("Wait for current profile commands to finish before recovery.")
            })?;
        let _sessions = chats.manager.try_quiesce_when_idle().ok_or_else(|| {
            unavailable("Stop agents and wait for folder operations before configuration recovery.")
        })?;
        let _terminals = state
            .terminals
            .try_quiesce_when_idle()
            .ok_or_else(|| unavailable("Close terminals before configuration recovery."))?;
        let library = app.state::<Arc<crate::config_library::LibraryService>>();
        let _mutation = library.mutation.clone().lock_owned().await;
        let engine = chats.sync_engine.get().cloned();
        if let Some(engine) = &engine
            && !engine.suspend(Duration::from_secs(5)).await
        {
            return Err(unavailable(
                "Account sync could not pause for configuration recovery.",
            ));
        }
        let selected = resolve(&state, Target::Id(locator.owner_profile.clone())).await?;
        let context = selected.key.ok_or_else(crate::profile_config::error)?;
        let key = Arc::new(
            context
                .key
                .profile_file_key(&context.identity.account, &selected.profile.meta.id)
                .map_err(|_| crate::profile_config::error())?,
        );
        let (scanner, _) = chats.manager.config_sync_scanner().await?;
        let current_owner = if current == locator.owner_profile {
            chats
                .account_config
                .as_ref()
                .map(|service| service.transitions.clone())
        } else {
            None
        };
        let result = tokio::task::spawn_blocking(move || {
            let _owner = if current != locator.owner_profile {
                Some(
                    aura_core::owner::ProfileOwner::acquire(&selected.profile)
                        .map_err(|_| crate::profile_config::error())?,
                )
            } else {
                None
            };
            let newly_opened = current_owner.is_none();
            let transitions = match current_owner {
                Some(service) => service,
                None => Arc::new(
                    aura_core::sync::config_transition::AccountConfigTransitions::open(
                        &selected.profile.dir,
                        key,
                    )
                    .map_err(|_| crate::profile_config::error())?,
                ),
            };
            let result =
                crate::profile_config::recover(data_root.root(), &current, scanner, &transitions);
            if newly_opened {
                transitions.close();
            }
            result
        })
        .await
        .map_err(|_| crate::profile_config::error())?;
        if result.is_ok()
            && let Some(engine) = engine
        {
            engine.resume();
        }
        let mut info = state.app_info();
        info.profile_switching = false;
        if result.is_ok() {
            let _ = app.emit(PROFILE_CHANGED, &info);
        }
        result?;
        Ok(info)
    })
    .await
    .map_err(|_| crate::profile_config::error())?
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
        let serial = state
            .transition
            .clone()
            .try_lock_owned()
            .map_err(|_| unavailable("Another account or profile operation is in progress."))?;
        let before = state.app_info();
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
            let mutation = app
                .state::<Arc<crate::config_library::LibraryService>>()
                .mutation
                .clone();
            activate_serial(&state, resolved, Outside::real, mutation, Some(&serial)).await
        }
        .await;
        let result = match result {
            Ok(info) => info,
            Err(error) => {
                let current = state.app_info();
                if let Some(engine) = previous_engine
                    && current.config_profile_recovery.is_none()
                    && current.profile == before.profile
                {
                    engine.resume();
                }
                if current.profile != before.profile
                    || current.config_profile_recovery != before.config_profile_recovery
                {
                    let _ = app.emit(PROFILE_CHANGED, current);
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

type OutsideFactory = fn(
    &Arc<aura_process::LeftoverRegistry>,
    &Arc<aura_process::Redactor>,
    &std::path::Path,
    &tokio::runtime::Handle,
) -> Outside;

#[cfg(test)]
async fn activate(
    state: &AppState,
    selected: Resolved,
    outside: OutsideFactory,
) -> Result<AppInfo, AppError> {
    activate_serial(state, selected, outside, Arc::default(), None).await
}

async fn activate_serial(
    state: &AppState,
    selected: Resolved,
    outside: OutsideFactory,
    mutation: Arc<tokio::sync::Mutex<()>>,
    serial: Option<&tokio::sync::OwnedMutexGuard<()>>,
) -> Result<AppInfo, AppError> {
    let serial = match serial {
        Some(_) => None,
        None => Some(
            state
                .transition
                .clone()
                .try_lock_owned()
                .map_err(|_| unavailable("Another profile transition is in progress."))?,
        ),
    };
    if state.quit.is_quitting() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "auracode is closing.",
        ));
    }
    let before = state.app_info();
    let from_profile = before
        .profile
        .as_ref()
        .map(|profile| profile.id.clone())
        .ok_or_else(|| unavailable("The current profile is unavailable."))?;
    if before.config_profile_recovery.is_some()
        && !(before.profile_locked && from_profile == selected.profile.meta.id)
    {
        return Err(crate::profile_config::error());
    }
    {
        let mut runtime = lock(&state.runtime);
        if runtime.info.profile.as_ref().map(|profile| &profile.id)
            == Some(&selected.profile.meta.id)
            && runtime.chats.is_some()
        {
            return Ok(runtime.info.clone());
        }
        runtime.info.profile_switching = true;
    }
    let _switching = Switching {
        state,
        _serial: serial,
    };
    tokio::time::timeout(Duration::from_secs(5), state.wait_profile_commands())
        .await
        .map_err(|_| {
            unavailable("Wait for current profile commands to finish, then retry switching.")
        })?;
    let _mutation = mutation.lock_owned().await;
    let _terminals = state
        .terminals
        .try_quiesce_when_idle()
        .ok_or_else(|| unavailable("Close all terminals before switching profiles."))?;
    let split = before
        .profile
        .as_ref()
        .is_some_and(|profile| profile.kind == ProfileKind::Account)
        && selected.profile.meta.kind == ProfileKind::Account
        && from_profile != selected.profile.meta.id;
    if split {
        // Each Account encrypts only its own settings. Local stays behind the same command,
        // terminal, Library and transition gates through both phases.
        let local = Profiles::new(root(state)?)
            .get("local")
            .map_err(|_| unavailable("The Local profile is unavailable. Nothing was switched."))?;
        let info = activate_one(
            state,
            Resolved {
                profile: local,
                key: None,
            },
            outside,
        )
        .await?;
        if info.config_profile_recovery.is_some() {
            return Err(crate::profile_config::error());
        }
    }
    let result = activate_one(state, selected, outside).await;
    if split && result.is_err() {
        lock(&state.runtime).info.notices.push("The previous Account's managed settings were preserved. Local is now selected because the destination Account could not finish opening. Resolve any configuration recovery, then retry the destination Account.".into());
    }
    result
}

async fn activate_one(
    state: &AppState,
    selected: Resolved,
    outside: OutsideFactory,
) -> Result<AppInfo, AppError> {
    let before = state.app_info();
    let from_profile = before
        .profile
        .as_ref()
        .map(|profile| profile.id.clone())
        .ok_or_else(crate::profile_config::error)?;
    let old = state.chats();
    let _sessions = match &old {
        Some(old) => Some(old.manager.try_quiesce_when_idle().ok_or_else(|| unavailable("Stop all agents and wait for folder operations to finish before switching profiles."))?),
        None => None,
    };
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
        let journal = file_key.as_ref().map(|key| {
            Ok::<_,aura_config::sync::ConfigPortError>((AccountConfigJournal::open(selected.profile.dir.join("config-apply"), key.clone())?, aura_core::sync::managed_config::AccountManagedConfig::open(&selected.profile.dir.join("config-managed"), key.clone())?, aura_core::sync::config_transition::AccountConfigTransitions::open(&selected.profile.dir, key.clone())?))
        })
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
        next.account_config = journal.map(|(journal, managed, transitions)| Arc::new(crate::account_config::AccountConfigServices::new(&next.store, journal, managed, transitions)));
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
    let staged = match crate::profile_config::prepare(
        root(state)?.root(),
        &from_profile,
        &profile_id,
        old.as_ref(),
        &next,
    )
    .await
    {
        Ok(staged) => staged,
        Err(error) => {
            discard(&next).await;
            return Err(error);
        }
    };
    if state.quit.is_quitting() {
        if let Some(staged) = staged {
            let _ = tokio::task::spawn_blocking(move || staged.rollback()).await;
        }
        discard(&next).await;
        return Err(unavailable(
            "auracode is closing. Configuration recovery was retained if rollback could not finish.",
        ));
    }
    let data_root = root(state)?;
    let profiles = Profiles::new(data_root.clone());
    let target = profile_id.clone();
    let published = tokio::task::spawn_blocking(move || profiles.set_active(&target)).await;
    let actual = aura_core::config_transition::active_profile(data_root.root());
    if !matches!(published, Ok(Ok(_))) && !actual.as_ref().is_ok_and(|id| id == &profile_id) {
        if actual.as_ref().is_ok_and(|id| id == &from_profile)
            && let Some(staged) = staged
        {
            let _ = tokio::task::spawn_blocking(move || staged.rollback()).await;
        }
        discard(&next).await;
        return Err(unavailable(
            "The active profile could not be confirmed. Existing data and any pending configuration recovery were preserved.",
        ));
    }
    if let Some(staged) = staged
        && !matches!(
            tokio::task::spawn_blocking(move || staged.finish()).await,
            Ok(Ok(()))
        )
    {
        prepared.notices.push("The profile pointer was saved, but configuration verification remains pending. Use configuration recovery before continuing.".into());
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
        }
    });
}
