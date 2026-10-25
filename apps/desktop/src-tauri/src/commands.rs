//! The typed commands the UI calls. Each is a thin wrapper: the logic lives in the modules it calls,
//! where it is tested without a running app.
//!
//! The TypeScript side (`apps/desktop/src/bindings.ts`) is generated from these signatures; see
//! [`crate::bindings`].
//!
//! The chat commands are wrappers over aura-core's `SessionManager`. Their signatures are final;
//! until the shell holds a session manager, every fallible one answers `internal` and the others
//! answer empty values.

use std::path::Path;
use std::sync::atomic::Ordering;

use aura_core::session::SessionError;
use aura_protocol::session::{
    AgentEntry, BlobText, ChatAttach, ChatStatusUpdate, ChatSummary, ConfigValue, EnvStatus,
    HistoryPage, PromptAck, SessionLists, StorageStatus,
};
use aura_protocol::{Autonomy, EventBatch, UiAnswer};
use tauri::ipc::Channel;
use tauri::{AppHandle, State, Webview};

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

/// The most `chat_blob` returns per call.
pub const MAX_BLOB_PAGE: u32 = 256 * 1024;

/// What the chat commands answer until the shell holds a session manager.
fn not_built() -> AppError {
    SessionError::Internal("chat sessions are not implemented in this build".into()).into()
}

/// A blob is named by the 64 lowercase hex digits of its sha256, and read at most
/// [`MAX_BLOB_PAGE`] bytes at a time.
fn check_blob_request(sha256: &str, len: u32) -> Result<(), AppError> {
    let hex = sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !hex {
        return Err(AppError::invalid_argument(
            "A blob is named by the 64 lowercase hex digits of its sha256.",
        ));
    }
    if len == 0 || len > MAX_BLOB_PAGE {
        return Err(AppError::invalid_argument(format!(
            "A blob page is 1 to {MAX_BLOB_PAGE} bytes, not {len}."
        )));
    }
    Ok(())
}

/// Every agent auracode knows, with its cached availability. Never waits: detection runs in the
/// background, and an agent still being checked reads `checking`.
#[tauri::command]
#[specta::specta]
pub fn agents_list() -> Vec<AgentEntry> {
    Vec::new()
}

/// Resolves the environment again and probes every agent, in parallel, within 15 s.
#[tauri::command]
#[specta::specta]
pub async fn agents_refresh() -> Vec<AgentEntry> {
    Vec::new()
}

/// The environment agents start with: resolving, resolved (and how), or a fallback, with the
/// names of the variables no agent inherits. Never waits.
#[tauri::command]
#[specta::specta]
pub fn env_status() -> EnvStatus {
    EnvStatus::default()
}

/// Starts resolving the environment again and returns the status at once.
#[tauri::command]
#[specta::specta]
pub fn env_refresh() -> EnvStatus {
    EnvStatus::default()
}

/// Shows the system folder picker and returns the chosen folder, or `null` when the user cancelled.
/// Resolves when the dialog closes.
#[tauri::command]
#[specta::specta]
pub async fn pick_folder() -> Result<Option<String>, AppError> {
    Err(not_built())
}

/// Every chat, newest activity first.
#[tauri::command]
#[specta::specta]
pub async fn chats_list() -> Result<Vec<ChatSummary>, AppError> {
    Err(not_built())
}

/// Creates a chat with `agent_id` in `folder` (an absolute path) and starts its agent. Creating a
/// chat whose agent `needs_download` is the consent to download its adapter.
#[tauri::command]
#[specta::specta]
pub async fn chat_create(agent_id: String, folder: String) -> Result<ChatSummary, AppError> {
    let _ = (agent_id, folder);
    Err(not_built())
}

/// Opens a view of a chat: the snapshot and the newest history page, consistent with the frames
/// `channel` carries from `next_seq` on. Opening a chat never starts its agent. A webview has one
/// view per chat; attaching again replaces the earlier one.
#[tauri::command]
#[specta::specta]
pub async fn chat_attach(
    webview: Webview,
    chat_id: String,
    channel: Channel<EventBatch>,
) -> Result<ChatAttach, AppError> {
    let _ = (webview, chat_id, channel);
    Err(not_built())
}

/// Closes a view: its channel ends. Unknown ids are ignored.
#[tauri::command]
#[specta::specta]
pub fn chat_detach(subscription_id: String) {
    let _ = subscription_id;
}

/// The history page before `before_seq` (the page's own `before_seq` from the last call), at most
/// about `max_bytes` (default 512 KiB).
#[tauri::command]
#[specta::specta]
pub async fn chat_history(
    chat_id: String,
    before_seq: u32,
    max_bytes: Option<u32>,
) -> Result<HistoryPage, AppError> {
    let _ = (chat_id, before_seq, max_bytes);
    Err(not_built())
}

/// The chat's options, slash commands, capabilities and autonomy state. Fetch again whenever the
/// session's `revision` changes.
#[tauri::command]
#[specta::specta]
pub async fn chat_lists(chat_id: String) -> Result<SessionLists, AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Sends `text` as typed, or queues it behind the running turn (or the start). A stopped chat starts
/// its agent.
#[tauri::command]
#[specta::specta]
pub async fn chat_send(chat_id: String, text: String) -> Result<PromptAck, AppError> {
    let _ = (chat_id, text);
    Err(not_built())
}

/// Removes a queued prompt.
#[tauri::command]
#[specta::specta]
pub async fn chat_cancel_queued(chat_id: String, prompt_id: String) -> Result<(), AppError> {
    let _ = (chat_id, prompt_id);
    Err(not_built())
}

/// Releases the held prompts ("Send queued"), starting the agent when it is stopped.
#[tauri::command]
#[specta::specta]
pub async fn chat_resume_queue(chat_id: String) -> Result<(), AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Asks the agent to stop the running turn (Esc). While it is already cancelling, this force-stops.
#[tauri::command]
#[specta::specta]
pub async fn chat_interrupt(chat_id: String) -> Result<(), AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Ends the agent's processes at once (the second Esc).
#[tauri::command]
#[specta::specta]
pub async fn chat_force_stop(chat_id: String) -> Result<(), AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Starts the chat's agent, continuing its native session unless `fresh`. Failures arrive as cards.
#[tauri::command]
#[specta::specta]
pub async fn chat_start(chat_id: String, fresh: bool) -> Result<(), AppError> {
    let _ = (chat_id, fresh);
    Err(not_built())
}

/// Stops the chat's agent gracefully.
#[tauri::command]
#[specta::specta]
pub async fn chat_stop(chat_id: String) -> Result<(), AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Answers a permission card with one of its options; `null` cancels it.
#[tauri::command]
#[specta::specta]
pub async fn chat_respond_permission(
    chat_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Result<(), AppError> {
    let _ = (chat_id, request_id, option_id);
    Err(not_built())
}

/// Answers a question card; `null` dismisses it.
#[tauri::command]
#[specta::specta]
pub async fn chat_respond_ui(
    chat_id: String,
    request_id: String,
    answer: Option<UiAnswer>,
) -> Result<(), AppError> {
    let _ = (chat_id, request_id, answer);
    Err(not_built())
}

/// Changes one of the agent's options and returns the lists after the change (35 s at most).
#[tauri::command]
#[specta::specta]
pub async fn chat_set_option(
    chat_id: String,
    option_id: String,
    value: ConfigValue,
) -> Result<SessionLists, AppError> {
    let _ = (chat_id, option_id, value);
    Err(not_built())
}

/// Changes the chat's autonomy and returns the lists after the change (35 s at most). Works while
/// the agent is stopped: it applies when the agent starts.
#[tauri::command]
#[specta::specta]
pub async fn chat_set_autonomy(
    chat_id: String,
    autonomy: Autonomy,
) -> Result<SessionLists, AppError> {
    let _ = (chat_id, autonomy);
    Err(not_built())
}

/// One page of a full output: at most `len` bytes (up to 256 KiB) from `offset`, ending on a
/// character boundary; continue from `next_offset`. `sha256` is the 64 lowercase hex digits of a
/// truncation's blob.
#[tauri::command]
#[specta::specta]
pub async fn chat_blob(
    chat_id: String,
    sha256: String,
    offset: u64,
    len: u32,
) -> Result<BlobText, AppError> {
    check_blob_request(&sha256, len)?;
    let _ = (chat_id, offset);
    Err(not_built())
}

/// Shows the chat's newest protocol log in the system file manager. Takes no path: the shell
/// chooses the file.
#[tauri::command]
#[specta::specta]
pub async fn chat_reveal_log(chat_id: String) -> Result<(), AppError> {
    let _ = chat_id;
    Err(not_built())
}

/// Subscribes the calling webview to chat-list updates (status, attention, title) over `channel`,
/// replacing its earlier subscription. Returns the subscription id.
#[tauri::command]
#[specta::specta]
pub fn status_subscribe(
    webview: Webview,
    channel: Channel<ChatStatusUpdate>,
) -> Result<String, AppError> {
    let _ = (webview, channel);
    Err(not_built())
}

/// Whether the profile database is saving, paused (with how much is unsaved), or failed.
#[tauri::command]
#[specta::specta]
pub fn storage_status() -> StorageStatus {
    StorageStatus::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_requests_name_a_sha256_and_a_bounded_page() {
        let sha = "0123456789abcdef".repeat(4);
        assert!(check_blob_request(&sha, 1).is_ok());
        assert!(check_blob_request(&sha, MAX_BLOB_PAGE).is_ok());
        for (name, len) in [
            (sha.to_uppercase(), 1),
            (sha[..63].to_owned(), 1),
            (format!("{}g", &sha[..63]), 1),
            ("../../etc/passwd".to_owned(), 1),
            (sha.clone(), 0),
            (sha.clone(), MAX_BLOB_PAGE + 1),
        ] {
            let error = check_blob_request(&name, len).expect_err("refused");
            assert_eq!(error.code, AppErrorCode::InvalidArgument, "{name} {len}");
        }
    }

    #[test]
    fn chat_commands_answer_internal_until_sessions_are_built() {
        let error = not_built();
        assert_eq!(error.code, AppErrorCode::Internal);
        assert!(
            error
                .message
                .starts_with("Something went wrong inside auracode: "),
            "{}",
            error.message
        );
    }
}
