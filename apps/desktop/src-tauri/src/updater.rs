//! Explicit signed app updates. React only renders status and requests an operation.
//! No startup requests, credential access, updater IPC grants or automatic installation.
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{
    sessions::{self, AppQuitHost, ExitRequest, QuitHost, QuitOutcome, QuitQuestion},
    state::AppState,
    sync::lock,
};

const MAX_MANIFEST: usize = 64 * 1024;
const MAX_PACKAGE: usize = 512 * 1024 * 1024;

pub(crate) fn staging() -> bool {
    matches!(option_env!("AURACODE_UPDATER_CHANNEL"), Some("staging"))
}
fn channel() -> &'static str {
    if staging() { "staging" } else { "stable" }
}
fn manifest(staging: bool) -> &'static str {
    if staging {
        "https://download.auracode.si/staging/latest.json"
    } else {
        "https://download.auracode.si/latest.json"
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
    Disabled,
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    WaitingForIdle,
    Installing,
    RestartRequired,
    Failed,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct UpdateStatus {
    pub channel: String,
    pub phase: UpdatePhase,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub downloaded_bytes: u32,
    pub total_bytes: Option<u32>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type, thiserror::Error)]
#[error("{message}")]
pub struct UpdateError {
    pub message: String,
}

fn error(message: impl Into<String>) -> UpdateError {
    UpdateError {
        message: message.into(),
    }
}
fn public_key() -> Option<&'static str> {
    option_env!("AURACODE_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .filter(|key| !key.is_empty())
}

struct Pending {
    update: Update,
    bytes: Option<Vec<u8>>,
}
struct Inner {
    status: UpdateStatus,
    pending: Option<Pending>,
}
pub struct Updates {
    busy: AtomicBool,
    inner: Mutex<Inner>,
}

impl Default for Updates {
    fn default() -> Self {
        let enabled = public_key().is_some() && cfg!(any(windows, target_os = "macos"));
        Self { busy: AtomicBool::new(false), inner: Mutex::new(Inner {
            pending: None,
            status: UpdateStatus { channel: channel().into(), phase: if enabled { UpdatePhase::Idle } else { UpdatePhase::Disabled }, version: None, notes: None,
                downloaded_bytes: 0, total_bytes: None,
                message: (!enabled).then(|| "This build has no configured update signing key. Install a verified release manually.".into()) },
        }) }
    }
}

struct Operation<'a>(&'a Updates);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        let mut inner = lock(&self.0.inner);
        if matches!(
            inner.status.phase,
            UpdatePhase::Checking | UpdatePhase::Downloading
        ) {
            inner.status.phase = UpdatePhase::Failed;
            inner.status.message =
                Some("The update operation was interrupted. Retry when ready.".into());
        }
        self.0.busy.store(false, Ordering::Release);
    }
}
impl Updates {
    fn snapshot(&self) -> UpdateStatus {
        lock(&self.inner).status.clone()
    }
    fn begin(&self) -> Result<Operation<'_>, UpdateError> {
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err(error("Another update operation is still running."));
        }
        Ok(Operation(self))
    }
    fn phase(&self, phase: UpdatePhase, message: Option<String>) {
        let mut inner = lock(&self.inner);
        inner.status.phase = phase;
        inner.status.message = message;
    }
}

fn available(state: &AppState) -> Result<&'static str, UpdateError> {
    if state.quit.is_quitting() {
        return Err(error("auracode is already closing."));
    }
    if !cfg!(any(windows, target_os = "macos")) || state.launch.is_smoke() {
        return Err(error(
            "Application updates are unavailable for this launch.",
        ));
    }
    public_key().ok_or_else(|| error("This build has no configured update signing key."))
}

#[tauri::command]
#[specta::specta]
pub fn app_update_status(updates: State<'_, Updates>) -> UpdateStatus {
    updates.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn app_update_check(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    updates: State<'_, Updates>,
) -> Result<UpdateStatus, UpdateError> {
    let key = available(&state)?;
    let _operation = updates.begin()?;
    updates.phase(UpdatePhase::Checking, None);
    let result = async {
        let response = client(Duration::from_secs(30))?
            .get(manifest(staging()))
            .send()
            .await
            .map_err(|_| error("Could not reach the update service. Retry when online."))?;
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }
        let bytes = bounded_response(response, MAX_MANIFEST, |_| {}).await?;
        let manifest = serde_json::from_slice(&bytes)
            .map_err(|_| error("The update manifest is not valid JSON."))?;
        let updater = app
            .updater_builder()
            .pubkey(key)
            .build()
            .map_err(|_| error("The update verifier could not be configured."))?;
        // This API applies target/version selection and mandates a signed version, even when the
        // manifest was fetched separately. Separate fetch permits a hard metadata size bound.
        let update = updater
            .restore_update(manifest)
            .map_err(|_| error("No valid update for this platform was found in the manifest."))?;
        if let Some(update) = &update {
            validate_download_url(&update.download_url)?;
        }
        Ok::<_, UpdateError>(update)
    }
    .await;
    match result {
        Ok(update) => {
            let mut inner = lock(&updates.inner);
            inner.status = UpdateStatus {
                channel: channel().into(),
                phase: if update.is_some() {
                    UpdatePhase::Available
                } else {
                    UpdatePhase::Idle
                },
                version: update.as_ref().map(|u| u.version.clone()),
                notes: update.as_ref().and_then(|u| u.body.clone()),
                downloaded_bytes: 0,
                total_bytes: None,
                message: None,
            };
            inner.pending = update.map(|update| Pending {
                update,
                bytes: None,
            });
        }
        Err(err) => {
            updates.phase(UpdatePhase::Failed, Some(err.message.clone()));
            return Err(err);
        }
    }
    Ok(updates.snapshot())
}

#[tauri::command]
#[specta::specta]
pub async fn app_update_download(
    state: State<'_, AppState>,
    updates: State<'_, Updates>,
) -> Result<UpdateStatus, UpdateError> {
    available(&state)?;
    let _operation = updates.begin()?;
    let update = lock(&updates.inner)
        .pending
        .as_ref()
        .map(|p| p.update.clone())
        .ok_or_else(|| error("Check for an update first."))?;
    validate_download_url(&update.download_url)?;
    {
        let mut inner = lock(&updates.inner);
        inner.status.downloaded_bytes = 0;
        inner.status.total_bytes = None;
        if let Some(pending) = inner.pending.as_mut() {
            pending.bytes = None;
        }
    }
    updates.phase(UpdatePhase::Downloading, None);
    let result = async {
        let response = client(Duration::from_secs(300))?
            .get(update.download_url.clone())
            .send()
            .await
            .map_err(|_| error("The update download could not start. Retry when online."))?;
        lock(&updates.inner).status.total_bytes = response
            .content_length()
            .and_then(|n| u32::try_from(n).ok());
        let bytes = bounded_response(response, MAX_PACKAGE, |total| {
            lock(&updates.inner).status.downloaded_bytes = total as u32
        })
        .await?;
        update.verify(&bytes).map_err(|_| {
            error("The update signature or signed version is invalid. Nothing was installed.")
        })?;
        Ok::<_, UpdateError>(bytes)
    }
    .await;
    match result {
        Ok(bytes) => {
            if let Some(pending) = lock(&updates.inner).pending.as_mut() {
                pending.bytes = Some(bytes);
            }
            updates.phase(UpdatePhase::Ready, None);
        }
        Err(err) => {
            updates.phase(UpdatePhase::Failed, Some(err.message.clone()));
            return Err(err);
        }
    }
    Ok(updates.snapshot())
}

fn client(timeout: Duration) -> Result<reqwest::Client, UpdateError> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .user_agent(concat!("auracode/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| error("The update connection could not be configured."))
}

fn validate_download_url(url: &reqwest::Url) -> Result<(), UpdateError> {
    validate_channel_url(url, staging())
}

fn validate_channel_url(url: &reqwest::Url, staging: bool) -> Result<(), UpdateError> {
    if url.scheme() != "https"
        || url.host_str() != Some("download.auracode.si")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with(if staging {
            "/staging/releases/"
        } else {
            "/releases/"
        })
        || url.path().contains('%')
    {
        return Err(error(
            "The update artifact is outside the trusted release location.",
        ));
    }
    Ok(())
}

fn check_size(current: usize, incoming: usize, limit: usize) -> Result<usize, UpdateError> {
    current
        .checked_add(incoming)
        .filter(|total| *total <= limit)
        .ok_or_else(|| error("The update response exceeds its size limit."))
}

async fn bounded_response(
    mut response: reqwest::Response,
    limit: usize,
    mut progress: impl FnMut(usize),
) -> Result<Vec<u8>, UpdateError> {
    if !response.status().is_success() {
        return Err(error(
            "The update service returned an unsuccessful response.",
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err(error("The update response exceeds its size limit."));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error("The update download was interrupted. Retry when ready."))?
    {
        let total = check_size(bytes.len(), chunk.len(), limit)?;
        bytes.extend_from_slice(&chunk);
        progress(total);
    }
    Ok(bytes)
}

/// Updates never accept the ordinary quit flow's option to discard unsaved work.
struct UpdateQuit<H>(H);
impl<H: QuitHost> QuitHost for UpdateQuit<H> {
    fn owned_work_guard(&self) -> Option<Box<dyn Send + '_>> {
        // install retains the transition, session-idle and terminal-idle barriers through this
        // entire flow and installation. Ordinary drain admission correctly refuses that state.
        Some(Box::new(()))
    }
    async fn wait_owned_work(&self, deadline: Duration) -> bool {
        self.0.wait_owned_work(deadline).await
    }
    fn owned_work_blocked(&self) {
        self.0.owned_work_blocked();
    }
    async fn flush_drafts(&self) -> bool {
        self.0.flush_drafts().await
    }
    fn hide_window(&self) {} // Keep progress and any failure visible.
    fn show_window(&self) {
        self.0.show_window();
    }
    fn storage(&self) -> aura_protocol::session::StorageStatus {
        self.0.storage()
    }
    async fn ask_to_quit_unsaved(&self, _question: QuitQuestion) -> bool {
        false
    }
    async fn stop_sessions(&self, deadline: Duration) -> aura_core::session::ShutdownSummary {
        self.0.stop_sessions(deadline).await
    }
    async fn close_store(&self, deadline: Duration) -> bool {
        self.0.close_store(deadline).await
    }
    fn close_registry(&self) {
        self.0.close_registry();
    }
    fn exit(&self, _code: i32) {} // Only the verified installer can exit after successful cleanup.
}

#[tauri::command]
#[specta::specta]
pub async fn app_update_install(app: tauri::AppHandle) -> Result<UpdateStatus, UpdateError> {
    // Installation and cleanup outlive a lost/reloaded IPC caller.
    match tauri::async_runtime::spawn(install(app.clone())).await {
        Ok(result) => result,
        Err(_) => {
            let state = app.state::<AppState>();
            if state.quit.is_quitting() {
                state.quit.abandon();
            }
            let updates = app.state::<Updates>();
            updates.phase(
                UpdatePhase::RestartRequired,
                Some("The update task failed. Restart auracode before retrying.".into()),
            );
            Ok(updates.snapshot())
        }
    }
}

async fn install(app: tauri::AppHandle) -> Result<UpdateStatus, UpdateError> {
    let state = app.state::<AppState>();
    let _transition = state.transition.try_lock().map_err(|_| {
        error("Wait for the profile transition to finish before installing an update.")
    })?;
    let updates = app.state::<Updates>();
    available(&state)?;
    let _operation = updates.begin()?;
    if !lock(&updates.inner)
        .pending
        .as_ref()
        .is_some_and(|pending| pending.bytes.is_some())
    {
        return Err(error("Download and verify an update before installing it."));
    }
    let chats = state.chats().ok_or_else(|| {
        error("The current profile is unavailable. Restart auracode before updating.")
    })?;
    if !matches!(
        chats.manager.storage_status().state,
        aura_protocol::session::StorageState::Ok
    ) {
        updates.phase(
            UpdatePhase::WaitingForIdle,
            Some("Resolve the storage error before installing an update.".into()),
        );
        return Ok(updates.snapshot());
    }
    let Some(_sessions) = chats.manager.try_quiesce_when_idle() else {
        updates.phase(UpdatePhase::WaitingForIdle, Some("Stop all agents and wait for folder operations and agent updates to finish, then retry installation.".into()));
        return Ok(updates.snapshot());
    };
    let Some(_terminals) = state.terminals.try_quiesce_when_idle() else {
        updates.phase(
            UpdatePhase::WaitingForIdle,
            Some("Close all terminals, then retry installation.".into()),
        );
        return Ok(updates.snapshot());
    };
    if state.quit.on_exit_requested() != ExitRequest::StartQuit {
        return Err(error("auracode is already closing."));
    }
    updates.phase(UpdatePhase::Installing, None);
    let outcome = sessions::run_quit(
        &state.quit,
        &UpdateQuit(AppQuitHost {
            app: &app,
            chats: &chats,
        }),
        0,
    )
    .await;
    match outcome {
        QuitOutcome::Kept => {
            updates.phase(
                UpdatePhase::Ready,
                Some("Save your drafts and resolve storage errors before installing.".into()),
            );
            return Ok(updates.snapshot());
        }
        QuitOutcome::Exited {
            saved: true,
            summary: Some(summary),
        } if summary.forced == 0 => {}
        _ => {
            updates.phase(UpdatePhase::RestartRequired, Some("Cleanup could not be confirmed. The update was not installed. Restart auracode before retrying.".into()));
            return Ok(updates.snapshot());
        }
    }
    state.terminals.stop_all();
    if let Some(shell) = app.try_state::<std::sync::Arc<crate::native_shell::NativeShell>>() {
        shell.shutdown();
    }
    let pending = lock(&updates.inner)
        .pending
        .take()
        .ok_or_else(|| error("The verified update is no longer available."))?;
    let bytes = pending
        .bytes
        .ok_or_else(|| error("The verified update is no longer available."))?;
    // install verifies the package again. On Windows it exits after launching NSIS; macOS returns.
    match tauri::async_runtime::spawn_blocking(move || pending.update.install(bytes)).await {
        Ok(Ok(())) => app.restart(),
        _ => {
            updates.phase(UpdatePhase::RestartRequired, Some("The installer failed after storage closed. Restart auracode and retry the update.".into()));
            Ok(updates.snapshot())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeQuit {
        drafts: bool,
        saved: bool,
        calls: Mutex<Vec<&'static str>>,
    }
    impl QuitHost for FakeQuit {
        fn owned_work_guard(&self) -> Option<Box<dyn Send + '_>> {
            // Match a real host while install already holds the stronger idle admission barrier.
            None
        }
        async fn flush_drafts(&self) -> bool {
            lock(&self.calls).push("flush");
            self.drafts
        }
        fn hide_window(&self) {
            lock(&self.calls).push("hide");
        }
        fn show_window(&self) {
            lock(&self.calls).push("show");
        }
        fn storage(&self) -> aura_protocol::session::StorageStatus {
            aura_protocol::session::StorageStatus {
                state: aura_protocol::session::StorageState::Ok,
                unsaved_bytes: 0,
            }
        }
        async fn ask_to_quit_unsaved(&self, _: QuitQuestion) -> bool {
            lock(&self.calls).push("discard");
            true
        }
        async fn stop_sessions(&self, _: Duration) -> aura_core::session::ShutdownSummary {
            lock(&self.calls).push("stop");
            aura_core::session::ShutdownSummary {
                sessions: 0,
                graceful: 0,
                forced: 0,
                took: Duration::ZERO,
            }
        }
        async fn close_store(&self, _: Duration) -> bool {
            lock(&self.calls).push("save");
            self.saved
        }
        fn close_registry(&self) {
            lock(&self.calls).push("registry");
        }
        fn exit(&self, _: i32) {
            lock(&self.calls).push("exit");
        }
    }

    #[tokio::test]
    async fn update_cleanup_never_offers_to_discard_an_unsaved_draft() {
        let quit = sessions::Quit::default();
        assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
        let host = UpdateQuit(FakeQuit {
            drafts: false,
            saved: true,
            calls: Mutex::new(Vec::new()),
        });
        assert_eq!(sessions::run_quit(&quit, &host, 0).await, QuitOutcome::Kept);
        assert_eq!(*lock(&host.0.calls), ["flush", "show"]);
        assert!(!quit.is_quitting(), "the user can retry after saving");
    }

    #[tokio::test]
    async fn update_cleanup_waits_for_storage_and_never_exits_the_app_itself() {
        for saved in [true, false] {
            let quit = sessions::Quit::default();
            assert_eq!(quit.on_exit_requested(), ExitRequest::StartQuit);
            let host = UpdateQuit(FakeQuit {
                drafts: true,
                saved,
                calls: Mutex::new(Vec::new()),
            });
            let outcome = sessions::run_quit(&quit, &host, 0).await;
            assert!(
                matches!(outcome, QuitOutcome::Exited { saved: actual, .. } if actual == saved)
            );
            assert_eq!(*lock(&host.0.calls), ["flush", "stop", "save", "registry"]);
        }
    }

    #[test]
    fn update_artifacts_never_follow_a_manifest_to_another_origin() {
        assert!(
            validate_channel_url(
                &"https://download.auracode.si/releases/0.2.0/app.exe"
                    .parse()
                    .unwrap(),
                false
            )
            .is_ok()
        );
        for url in [
            "http://download.auracode.si/releases/x",
            "https://other.example/releases/x",
            "https://user@download.auracode.si/releases/x",
            "https://download.auracode.si/private/x",
            "https://download.auracode.si/releases/%2fprivate",
            "https://download.auracode.si/releases/x?token=anything",
            "https://download.auracode.si:8443/releases/x",
        ] {
            assert!(
                validate_channel_url(&url.parse().unwrap(), false).is_err(),
                "{url}"
            );
        }
    }
    #[test]
    fn staging_and_stable_never_cross_release_prefixes() {
        let stable = "https://download.auracode.si/releases/0.2.0/app.exe"
            .parse()
            .unwrap();
        let staging = "https://download.auracode.si/staging/releases/0.2.0/app.exe"
            .parse()
            .unwrap();
        assert!(validate_channel_url(&stable, false).is_ok());
        assert!(validate_channel_url(&staging, true).is_ok());
        assert!(validate_channel_url(&stable, true).is_err());
        assert!(validate_channel_url(&staging, false).is_err());
        assert_ne!(manifest(true), manifest(false));
        for path in [
            "/staging/releases/../latest.json",
            "/staging/releases/%2e%2e/latest.json",
            "/staging/releases/file.exe?x=1",
            "/staging/releases/file.exe#ignored",
        ] {
            assert!(
                validate_channel_url(
                    &format!("https://download.auracode.si{path}")
                        .parse()
                        .unwrap(),
                    true
                )
                .is_err()
            );
        }
    }
    #[test]
    fn chunk_bounds_apply_without_content_length_and_before_allocation() {
        assert_eq!(check_size(5, 5, 10).unwrap(), 10);
        assert!(check_size(5, 6, 10).is_err());
        assert!(check_size(usize::MAX, 1, usize::MAX).is_err());
    }
    #[test]
    fn abandoned_operations_unlock_retry_and_keep_failure_visible() {
        let updates = Updates::default();
        let operation = updates.begin().unwrap();
        updates.phase(UpdatePhase::Downloading, None);
        assert!(updates.begin().is_err());
        drop(operation);
        assert_eq!(updates.snapshot().phase, UpdatePhase::Failed);
        assert!(updates.begin().is_ok());
    }
}
