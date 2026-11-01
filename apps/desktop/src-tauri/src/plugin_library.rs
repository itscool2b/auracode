//! Thin Plugin library commands. Rust owns which CLI commands run, the cache, the harness status
//! and the per-device sync switch; the renderer only asks for a snapshot or a refresh.
use aura_protocol::plugins::PluginLibrary;
use tauri::{State, ipc::Channel};

use crate::{error::AppError, state::AppState};
#[tauri::command]
#[specta::specta]
pub async fn plugin_management_capabilities(
    state: State<'_, AppState>,
) -> Result<Vec<aura_protocol::plugins::PluginManagement>, AppError> {
    let sessions = state.sessions()?;
    Ok(sessions
        .agents(false)
        .await
        .into_iter()
        .filter_map(|agent| {
            aura_agents::plugins::management(
                &agent.id,
                agent.installation.as_ref().map(|i| i.version.as_str()),
            )
        })
        .collect())
}

/// Agents whose configuration sync is off on this device, from the profile's preferences.
pub(crate) fn paused_agents(state: &AppState) -> Vec<String> {
    state
        .onboarding()
        .ok()
        .and_then(|service| service.preferences().ok())
        .map(|preferences| preferences.general.config_sync_paused)
        .unwrap_or_default()
}

/// One section per agent. `refresh` is the explicit Refresh: agents are probed again and every
/// listing reruns. Otherwise a listing is reused until its agent's installed version changes.
#[tauri::command]
#[specta::specta]
pub async fn plugin_library_snapshot(
    state: State<'_, AppState>,
    refresh: bool,
    channel: Channel<PluginLibrary>,
) -> Result<PluginLibrary, AppError> {
    let sessions = state.sessions()?;
    let generation = sessions.generation();
    let sync_available = state.account_config().is_ok();
    let paused = paused_agents(&state);
    Ok(sessions
        .plugin_library_progressive(refresh, sync_available, paused, |library| {
            generation.is_current() && channel.send(library).is_ok()
        })
        .await?)
}

/// Turns configuration sync on or off for one agent on this device. Paused agents' items wait
/// unchanged: nothing of theirs is published or applied until sync is on again.
#[tauri::command]
#[specta::specta]
pub async fn plugin_sync_set(
    state: State<'_, AppState>,
    agent_id: String,
    enabled: bool,
) -> Result<Vec<String>, AppError> {
    let service = state.onboarding()?;
    tauri::async_runtime::spawn_blocking(move || {
        let revision = service.preferences()?.revision;
        let snapshot = service.apply_action(
            revision,
            aura_core::onboarding::SetupAction::ConfigSyncAgent { agent_id, enabled },
        )?;
        Ok(snapshot.preferences.general.config_sync_paused)
    })
    .await
    .map_err(|_| {
        AppError::new(
            crate::error::AppErrorCode::Internal,
            "The sync switch could not be saved.",
        )
    })?
}
