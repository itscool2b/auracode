//! The typed commands the UI calls. Each is a thin wrapper: the logic lives in the modules it calls,
//! where it is tested without a running app.
//!
//! The TypeScript side (`apps/desktop/src/bindings.ts`) is generated from these signatures; see
//! [`crate::bindings`].

use std::path::Path;
use std::sync::atomic::Ordering;

use aura_protocol::EventBatch;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::demo::DemoKind;
use crate::error::{AppError, AppErrorCode};
use crate::reveal;
use crate::smoke::{self, SmokeReport};
use crate::state::{AppInfo, AppState};
use crate::window;

/// Everything about this launch: versions, OS, device, profile, database, window glass, launch
/// mode, notices, and the fatal startup error if there was one. Never fails.
#[tauri::command]
#[specta::specta]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    state.app_info()
}

/// Starts a scripted mock-agent turn and streams its frames over `channel` (one `EventBatch` at
/// most every 16 ms, each under 8 KiB). Returns the session id the frames carry, for
/// `cancel_demo_stream`. The stream stops by itself when the channel's page goes away.
#[tauri::command]
#[specta::specta]
pub fn start_demo_stream(
    state: State<'_, AppState>,
    kind: DemoKind,
    tokens_per_sec: u32,
    channel: Channel<EventBatch>,
) -> Result<String, AppError> {
    let (session_id, run) = state.demos.start(kind, tokens_per_sec, move |batch| {
        channel.send(batch).is_ok()
    })?;
    tauri::async_runtime::spawn(run);
    Ok(session_id)
}

/// Stops a demo stream; its channel then receives a final `turn_ended` with `stop_reason:
/// "cancelled"`. Unknown or already finished ids are ignored, so calling this twice is harmless.
#[tauri::command]
#[specta::specta]
pub fn cancel_demo_stream(state: State<'_, AppState>, session_id: String) {
    state.demos.cancel(&session_id);
}

/// The page has painted: show and focus the main window. Only the first call does anything, so a
/// reloaded page does not steal focus again.
#[tauri::command]
#[specta::specta]
pub fn window_ready(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    window::show_main_once(&app, &state.window_shown).map(|_shown| ())
}

/// Shows the data folder in the system file manager (Finder, Explorer, ...), or its nearest
/// existing parent when the folder is missing. Takes no path: the page can reveal only the folder
/// this launch uses, never one it names.
#[tauri::command]
#[specta::specta]
pub async fn reveal_data_dir(state: State<'_, AppState>) -> Result<(), AppError> {
    let data_dir = state.data_dir().map(Path::to_path_buf);
    // The file manager calls block (D-Bus on Linux, the shell on Windows), so they run on a
    // blocking thread, as in the opener plugin's own command.
    tauri::async_runtime::spawn_blocking(move || {
        reveal::reveal_data_dir(data_dir.as_deref(), |path| {
            tauri_plugin_opener::reveal_item_in_dir(path)
        })
    })
    .await
    .map_err(|error| {
        AppError::new(
            AppErrorCode::RevealFailed,
            format!("Could not show the data folder: {error}"),
        )
    })??;
    Ok(())
}

/// Dismisses the database repair notice (`recovery_notice` in `app_info`) for good: later launches
/// no longer show it. Takes no path: the shell acknowledges exactly the repair startup reported,
/// never one the page names. Calling it again, or with no notice, does nothing; when it fails the
/// notice stays.
#[tauri::command]
#[specta::specta]
pub fn acknowledge_recovery(state: State<'_, AppState>) -> Result<(), AppError> {
    state.acknowledge_recovery()
}

/// Smoke mode only: prints `AURACODE_SMOKE_RESULT <json>` on stdout and, with
/// `AURACODE_SMOKE_EXIT=1`, exits with 0 when the run passed and 1 otherwise. Only the first report
/// counts.
#[tauri::command]
#[specta::specta]
pub fn smoke_report(
    app: AppHandle,
    state: State<'_, AppState>,
    report: SmokeReport,
) -> Result<(), AppError> {
    if !state.launch.smoke {
        return Err(AppError::new(
            AppErrorCode::NotInSmokeMode,
            "Smoke reports are only accepted when AURACODE_SMOKE=1.",
        ));
    }
    if state.smoke_reported.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let report = smoke::finalize(report);
    smoke::print(&report);
    if state.launch.smoke_exit {
        app.exit(smoke::exit_code(&report));
    }
    Ok(())
}
