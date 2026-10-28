//! Setup commands touch only auracode's profile preferences. Discovery and explicit vendor
//! maintenance keep their existing, separately reviewed command paths.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use aura_core::onboarding::{
    OnboardingStore, SetupAction, SetupError, SetupPreferences, SetupSnapshot,
};
use tauri::{AppHandle, State};

use crate::error::{AppError, AppErrorCode};
use crate::state::AppState;

pub struct SetupService {
    profile_dir: PathBuf,
    store: Mutex<Option<OnboardingStore>>,
}

impl SetupService {
    pub(crate) fn account(
        profile: &aura_core::profile::Profile,
        key: Arc<aura_sync::crypto::files::ProfileFileKey>,
    ) -> Result<Self, AppError> {
        Ok(Self {
            profile_dir: profile.dir.clone(),
            store: Mutex::new(Some(
                OnboardingStore::open_account(profile, key).map_err(map_error)?,
            )),
        })
    }
    pub fn new(profile_dir: PathBuf) -> Self {
        Self {
            profile_dir,
            store: Mutex::new(None),
        }
    }

    fn run(&self, change: Option<(u32, SetupAction)>) -> Result<SetupSnapshot, AppError> {
        self.with_store(|store| {
            match change {
                Some((revision, action)) => store.apply(revision, action),
                None => store.snapshot(),
            }
            .map_err(map_error)
        })
    }

    /// The saved preferences, without marking the boot seen (that is the interface's to do).
    pub fn preferences(&self) -> Result<SetupPreferences, AppError> {
        self.with_store(|store| Ok(store.preferences()))
    }

    fn with_store<T>(
        &self,
        run: impl FnOnce(&OnboardingStore) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut store = self
            .store
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if store.is_none() {
            *store = Some(OnboardingStore::open(&self.profile_dir).map_err(map_error)?);
        }
        let store = store
            .as_ref()
            .ok_or_else(|| AppError::new(AppErrorCode::Internal, "Setup is unavailable."))?;
        run(store)
    }
}

fn map_error(error: SetupError) -> AppError {
    let code = match error {
        SetupError::Invalid(_) | SetupError::Stale => AppErrorCode::InvalidArgument,
        SetupError::NewerVersion | SetupError::Storage(_) => AppErrorCode::StorageUnavailable,
    };
    AppError::new(code, error.to_string())
}

async fn run(
    state: &AppState,
    change: Option<(u32, SetupAction)>,
) -> Result<SetupSnapshot, AppError> {
    let service = state.onboarding()?;
    tauri::async_runtime::spawn_blocking(move || service.run(change))
        .await
        .map_err(|_| AppError::new(AppErrorCode::Internal, "Setup could not be loaded."))?
}

#[tauri::command]
#[specta::specta]
pub async fn setup_snapshot(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetupSnapshot, AppError> {
    let snapshot = run(&state, None).await?;
    crate::general_preferences::apply(&app, &snapshot.preferences.general);
    Ok(snapshot)
}

#[tauri::command]
#[specta::specta]
pub async fn setup_apply(
    app: AppHandle,
    state: State<'_, AppState>,
    revision: u32,
    action: SetupAction,
) -> Result<SetupSnapshot, AppError> {
    let snapshot = run(&state, Some((revision, action))).await?;
    // Settings' switches take effect at once: new chats, notifications, keep-awake, closing.
    crate::general_preferences::apply(&app, &snapshot.preferences.general);
    Ok(snapshot)
}
