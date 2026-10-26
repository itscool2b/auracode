//! Setup commands touch only auracode's profile preferences. Discovery and explicit vendor
//! maintenance keep their existing, separately reviewed command paths.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use aura_core::onboarding::{OnboardingStore, SetupAction, SetupError, SetupSnapshot};
use tauri::State;

use crate::error::{AppError, AppErrorCode};
use crate::state::AppState;

pub struct SetupService {
    profile_dir: PathBuf,
    store: Mutex<Option<OnboardingStore>>,
}

impl SetupService {
    pub fn new(profile_dir: PathBuf) -> Self {
        Self {
            profile_dir,
            store: Mutex::new(None),
        }
    }

    fn run(&self, change: Option<(u32, SetupAction)>) -> Result<SetupSnapshot, AppError> {
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
        match change {
            Some((revision, action)) => store.apply(revision, action),
            None => store.snapshot(),
        }
        .map_err(map_error)
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
    let service = state.onboarding.as_ref().map(Arc::clone).ok_or_else(|| {
        AppError::new(
            AppErrorCode::StorageUnavailable,
            "The profile is unavailable. Setup has not been changed.",
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || service.run(change))
        .await
        .map_err(|_| AppError::new(AppErrorCode::Internal, "Setup could not be loaded."))?
}

#[tauri::command]
#[specta::specta]
pub async fn setup_snapshot(state: State<'_, AppState>) -> Result<SetupSnapshot, AppError> {
    run(&state, None).await
}

#[tauri::command]
#[specta::specta]
pub async fn setup_apply(
    state: State<'_, AppState>,
    revision: u32,
    action: SetupAction,
) -> Result<SetupSnapshot, AppError> {
    run(&state, Some((revision, action))).await
}
