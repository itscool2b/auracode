//! Remote access: paired browsers and linked bots reaching this computer's chats through the
//! relay (`aura-remote`, `docs/remote-sessions.md`). Off until the person turns it on in Settings.
//!
//! The service belongs to the installation: one connection to the relay, whichever profile is
//! open. A device or a bot link belongs to the profile it was made in and reaches no other
//! (`aura_remote::Registry`): when another profile opens, browsers are told to start over, the
//! other profile's devices are ended, and the relay is given only this profile's bot links.

use std::sync::Arc;

use aura_core::session::{FrameSink, SinkGone, StatusSink};
use aura_protocol::{
    EventBatch, UiAnswer,
    remote::{RemoteBotLink, RemotePairing, RemoteStatus},
    session::{Availability, ChatAttach, ChatStatusUpdate, HistoryPage, PromptAck},
    workspace::{ProjectChatCreate, WorkspaceChat, WorkspaceFilter},
};
use aura_remote::{
    Backend, BackendError, BoxFuture, Frames, Overview, RegistryError, RemoteAgent, Service,
    Statuses,
};
use tauri::{Emitter, Manager, State};

use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};

/// Sent with a [`RemoteStatus`] whenever what Settings shows about remote access changed.
pub const REMOTE_CHANGED: &str = "auracode-remote-changed";
/// History pages a browser asks for after the first: small enough to seal into one message.
const PAGE_BYTES: u32 = 256 * 1024;

/// The relay and the website it belongs to. Release builds reach only auracode's own; a
/// development build may name a relay on this machine.
fn origins() -> (String, String) {
    if cfg!(debug_assertions)
        && let (Ok(relay), Ok(site)) = (
            std::env::var("AURACODE_REMOTE_RELAY"),
            std::env::var("AURACODE_REMOTE_SITE"),
        )
    {
        return (relay, site);
    }
    let site = match option_env!("AURACODE_API_ORIGIN") {
        Some("https://preview.auracode.si") => "https://preview.auracode.si",
        _ => "https://auracode.si",
    };
    (site.replacen("https://", "wss://", 1), site.to_owned())
}

/// Starts the service once the app's state exists. Smoke runs never get one.
pub(crate) fn setup(app: &tauri::AppHandle, runtime: &tokio::runtime::Handle) {
    let state = app.state::<AppState>();
    if state.launch.is_smoke() {
        return;
    }
    let Some(folder) = state.data_dir() else {
        return;
    };
    let (relay, site) = origins();
    let host_name = state
        .app_info()
        .device
        .map(|device| device.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "This computer".into());
    let notify = app.clone();
    let config = aura_remote::Config {
        path: folder.join("remote.json"),
        relay,
        site,
        host_name,
        profile: open_profile(&state),
        backend: Arc::new(AppBackend {
            app: app.clone(),
            profile: String::new(),
        }),
        changed: Arc::new(move || {
            if let Some(service) = notify.try_state::<Service>() {
                let _ = notify.emit(REMOTE_CHANGED, service.status());
            }
        }),
    };
    match Service::start(config, runtime) {
        Ok(service) => {
            app.manage(service);
        }
        // Settings shows why; nothing else depends on remote access.
        Err(error) => {
            tracing::warn!(%error, "remote access is unavailable");
            app.manage(Unavailable(error.to_string()));
        }
    }
}

/// Why the service could not start: its saved settings could not be read.
struct Unavailable(String);

/// The open profile's id, which a device or a bot link is bound to; empty while none is open.
fn open_profile(state: &AppState) -> String {
    state
        .app_info()
        .profile
        .map(|profile| profile.id)
        .unwrap_or_default()
}

pub(crate) fn profile_changed(app: &tauri::AppHandle) {
    if let Some(service) = app.try_state::<Service>() {
        service.profile_changed(&open_profile(&app.state::<AppState>()));
    }
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if let Some(service) = app.try_state::<Service>() {
        service.shutdown();
    }
}

fn service(app: &tauri::AppHandle) -> Result<Service, AppError> {
    if let Some(service) = app.try_state::<Service>() {
        return Ok(service.inner().clone());
    }
    Err(AppError::new(
        AppErrorCode::StorageUnavailable,
        match app.try_state::<Unavailable>() {
            Some(reason) => reason.0.clone(),
            None => "Remote access is not available in this run.".into(),
        },
    ))
}

fn refused(error: RegistryError) -> AppError {
    let code = match error {
        RegistryError::TooManyDevices | RegistryError::TooManyBots | RegistryError::NoWorkspace => {
            AppErrorCode::InvalidArgument
        }
        _ => AppErrorCode::StorageUnavailable,
    };
    AppError::new(code, error.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn remote_status(app: tauri::AppHandle) -> Result<RemoteStatus, AppError> {
    Ok(service(&app)?.status())
}

/// Turns remote access on or off. Off closes the connection at once; paired devices and bot
/// links stay saved, and work again when it is back on.
#[tauri::command]
#[specta::specta]
pub fn remote_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<RemoteStatus, AppError> {
    let service = service(&app)?;
    service.set_enabled(enabled).map_err(refused)?;
    Ok(service.status())
}

/// Opens a pairing link, good once and for ten minutes. It replaces the link before it.
#[tauri::command]
#[specta::specta]
pub fn remote_pair(app: tauri::AppHandle) -> Result<RemotePairing, AppError> {
    let service = service(&app)?;
    if !service.status().enabled {
        return Err(AppError::invalid_argument(
            "Turn remote access on before pairing a device.",
        ));
    }
    service.pair().map_err(refused)
}

#[tauri::command]
#[specta::specta]
pub fn remote_cancel_pairing(app: tauri::AppHandle) -> Result<RemoteStatus, AppError> {
    let service = service(&app)?;
    service.cancel_pairing();
    Ok(service.status())
}

/// Removes a paired device. Its open sessions end and its key stops working.
#[tauri::command]
#[specta::specta]
pub fn remote_remove_device(app: tauri::AppHandle, id: String) -> Result<RemoteStatus, AppError> {
    let service = service(&app)?;
    service.remove_device(&id).map_err(refused)?;
    Ok(service.status())
}

/// Creates a bot link. Its address carries the bot's token and is returned only here.
#[tauri::command]
#[specta::specta]
pub fn remote_create_bot(app: tauri::AppHandle, name: String) -> Result<RemoteBotLink, AppError> {
    service(&app)?.create_bot(&name).map_err(refused)
}

#[tauri::command]
#[specta::specta]
pub fn remote_remove_bot(app: tauri::AppHandle, id: String) -> Result<RemoteStatus, AppError> {
    let service = service(&app)?;
    service.remove_bot(&id).map_err(refused)?;
    Ok(service.status())
}

/// One profile's chats, as remote sessions reach them. Every call takes the same lease a window's
/// command does, and takes it only while `profile` is the open profile, both read under one lock:
/// a session accepted for one profile is never served another's chats, wherever a switch lands.
/// The service binds a profile before every call; unbound (`profile` empty), nothing is served.
struct AppBackend {
    app: tauri::AppHandle,
    profile: String,
}

fn failed(error: AppError) -> BackendError {
    // The same codes the window gets, in the same words.
    let code = match error.code {
        AppErrorCode::ChatNotFound => "not_found",
        AppErrorCode::RequestNotPending => "request_not_pending",
        AppErrorCode::OptionInvalid => "option_invalid",
        AppErrorCode::PromptEmpty => "empty",
        AppErrorCode::PromptTooLarge => "too_large",
        AppErrorCode::QueueFull => "queue_full",
        AppErrorCode::UnknownAgent | AppErrorCode::AgentUnavailable => "agent_unavailable",
        AppErrorCode::InvalidFolder | AppErrorCode::InvalidArgument => "invalid",
        AppErrorCode::TooManyAgents | AppErrorCode::TooManySubscriptions => "busy",
        AppErrorCode::StorageUnavailable | AppErrorCode::ShuttingDown => "unavailable",
        _ => "failed",
    };
    BackendError::new(code, error.message)
}

struct FrameAdapter {
    owner: String,
    frames: Frames,
}

impl FrameSink for FrameAdapter {
    fn send(&self, frame: &EventBatch) -> Result<(), SinkGone> {
        if (self.frames)(frame) {
            Ok(())
        } else {
            Err(SinkGone)
        }
    }

    fn owner(&self) -> &str {
        &self.owner
    }
}

struct StatusAdapter {
    owner: String,
    statuses: Statuses,
}

impl StatusSink for StatusAdapter {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone> {
        if (self.statuses)(update) {
            Ok(())
        } else {
            Err(SinkGone)
        }
    }

    fn owner(&self) -> &str {
        &self.owner
    }
}

impl AppBackend {
    fn state(&self) -> State<'_, AppState> {
        self.app.state::<AppState>()
    }

    /// The bound profile's session manager, under a command lease.
    fn sessions(
        &self,
    ) -> Result<crate::state::ProfileLease<aura_core::session::SessionManager>, AppError> {
        self.state().sessions_of(&self.profile)
    }

    /// The agent a new chat starts with: the one asked for, else the project's, else the one
    /// Settings names, else the first that is ready.
    async fn agent_for(&self, folder_id: &str, asked: Option<&str>) -> Result<String, AppError> {
        if let Some(agent) = asked {
            return Ok(agent.to_owned());
        }
        let sessions = self.sessions()?;
        let snapshot = sessions
            .workspace_snapshot(WorkspaceFilter {
                include_archived: false,
                project_id: None,
            })
            .await?;
        let project = snapshot
            .projects
            .iter()
            .find(|project| project.folders.iter().any(|folder| folder.id == folder_id))
            .ok_or_else(|| AppError::invalid_argument("That folder is no longer here."))?;
        if let Some(agent) = &project.default_agent {
            return Ok(agent.clone());
        }
        if let Some(agent) = default_agent(&self.state()) {
            return Ok(agent);
        }
        sessions
            .agents(false)
            .await
            .into_iter()
            .find(|agent| matches!(agent.availability, Availability::Ready { .. }))
            .map(|agent| agent.id)
            .ok_or_else(|| {
                AppError::new(
                    AppErrorCode::AgentUnavailable,
                    "No agent is ready on this computer.",
                )
            })
    }
}

fn default_agent(state: &AppState) -> Option<String> {
    state
        .setup_service()
        .and_then(|setup| setup.preferences().ok())
        .and_then(|preferences| preferences.general.default_agent)
}

impl Backend for AppBackend {
    fn bound(self: Arc<Self>, profile: &str) -> Arc<dyn Backend> {
        Arc::new(Self {
            app: self.app.clone(),
            profile: profile.to_owned(),
        })
    }

    fn overview(&self) -> BoxFuture<'_, Result<Overview, BackendError>> {
        Box::pin(async move {
            let state = self.state();
            let sessions = self.sessions().map_err(failed)?;
            let snapshot = sessions
                .workspace_snapshot(WorkspaceFilter {
                    include_archived: false,
                    project_id: None,
                })
                .await
                .map_err(|error| failed(error.into()))?;
            let agents = sessions
                .agents(false)
                .await
                .into_iter()
                .map(|agent| RemoteAgent {
                    available: matches!(agent.availability, Availability::Ready { .. }),
                    id: agent.id,
                    name: agent.name,
                })
                .collect();
            Ok(Overview {
                host_name: state
                    .app_info()
                    .device
                    .map(|device| device.name)
                    .unwrap_or_default(),
                projects: snapshot.projects,
                chats: snapshot.chats,
                agents,
                default_agent: default_agent(&state),
            })
        })
    }

    fn watch(&self, owner: &str, statuses: Statuses) -> Result<(), BackendError> {
        // No lease: the subscription belongs to the manager, and ends with it.
        let chats = self.state().chats_of(&self.profile).map_err(failed)?;
        chats.manager.status_subscribe(Arc::new(StatusAdapter {
            owner: owner.to_owned(),
            statuses,
        }));
        Ok(())
    }

    fn attach<'a>(
        &'a self,
        chat_id: &'a str,
        owner: &'a str,
        frames: Frames,
    ) -> BoxFuture<'a, Result<ChatAttach, BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            // One chat per browser: what it followed before is let go first.
            sessions.drop_owner(owner);
            sessions
                .attach(
                    chat_id,
                    Arc::new(FrameAdapter {
                        owner: owner.to_owned(),
                        frames,
                    }),
                )
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn release(&self, owner: &str) {
        if let Some(chats) = self.state().chats() {
            chats.manager.drop_owner(owner);
        }
    }

    fn history<'a>(
        &'a self,
        chat_id: &'a str,
        before_seq: u32,
    ) -> BoxFuture<'a, Result<HistoryPage, BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .history(chat_id, before_seq, Some(PAGE_BYTES))
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn send<'a>(
        &'a self,
        chat_id: &'a str,
        text: String,
    ) -> BoxFuture<'a, Result<PromptAck, BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .send(chat_id, text)
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .interrupt(chat_id)
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn permission<'a>(
        &'a self,
        chat_id: &'a str,
        request_id: &'a str,
        option_id: Option<String>,
    ) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .respond_permission(chat_id, request_id, option_id)
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn answer<'a>(
        &'a self,
        chat_id: &'a str,
        request_id: &'a str,
        answer: Option<UiAnswer>,
    ) -> BoxFuture<'a, Result<(), BackendError>> {
        Box::pin(async move {
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .respond_ui(chat_id, request_id, answer)
                .await
                .map_err(|error| failed(error.into()))
        })
    }

    fn create<'a>(
        &'a self,
        folder_id: &'a str,
        agent_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<WorkspaceChat, BackendError>> {
        Box::pin(async move {
            let agent_id = self.agent_for(folder_id, agent_id).await.map_err(failed)?;
            let sessions = self.sessions().map_err(failed)?;
            sessions
                .chat_project_create(ProjectChatCreate {
                    agent_id,
                    folder_id: folder_id.to_owned(),
                    // Asked for from afar, there is nobody to show the busy-folder warning to.
                    allow_busy_folder: true,
                })
                .await
                .map_err(|error| failed(error.into()))
        })
    }
}
