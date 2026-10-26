//! Active-profile scheduler binding. Event payloads contain only profile identity and public status.
use crate::{state::AppState, sync::lock};
use aura_core::{
    session::{SinkGone, StatusSink},
    sync::engine::SyncEngine,
};
use aura_protocol::{SessionStatus, account::AccountStatus, session::ChatStatusUpdate};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex, Weak},
};
use tauri::{Emitter, Manager};

pub const SYNC_CHANGED: &str = "account-sync-changed";
struct TurnSink {
    engine: Weak<SyncEngine>,
    active: Mutex<HashSet<String>>,
}
impl StatusSink for TurnSink {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone> {
        let engine = self.engine.upgrade().ok_or(SinkGone)?;
        let mut active = lock(&self.active);
        if matches!(
            update.status,
            SessionStatus::Running | SessionStatus::Cancelling
        ) {
            active.insert(update.chat_id.clone());
        } else if active.remove(&update.chat_id) {
            engine.trigger();
        }
        Ok(())
    }
    fn owner(&self) -> &str {
        "auracode-account-sync"
    }
}

/// Attach only after successful profile publication. Holding the lease prevents another switch
/// from racing the installation; the worker's writer and identity never change afterward.
pub(crate) async fn attach(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(lease) = state.account_config() else {
        return;
    };
    let Some(chats) = state.chats() else {
        return;
    };
    if let Some(engine) = chats.sync_engine.get() {
        engine.resume();
        return;
    }
    let Some(identity) = chats.sync_identity.clone() else {
        return;
    };
    let Some(profile) = state.app_info().profile else {
        return;
    };
    let Ok(accounts) = state.accounts.get().await else {
        return;
    };
    let engine = Arc::new(SyncEngine::start(
        chats.store.clone(),
        accounts,
        identity,
        &tokio::runtime::Handle::current(),
    ));
    if chats.sync_engine.set(engine.clone()).is_err() {
        engine.stop();
        return;
    }
    chats.manager.status_subscribe(Arc::new(TurnSink {
        engine: Arc::downgrade(&engine),
        active: Mutex::default(),
    }));
    let generation = lease.generation();
    let mut status = engine.subscribe();
    let app = app.clone();
    tokio::spawn(async move {
        let mut configured_at = None;
        loop {
            if !generation.is_current() {
                break;
            }
            let value = status.borrow().clone();
            if value.state == aura_protocol::account::AccountSyncState::Idle
                && value.last_sync_at.is_some()
                && configured_at != value.last_sync_at
            {
                configured_at = value.last_sync_at;
                crate::config_sync::after_exchange(&app, generation.clone()).await;
                if !generation.is_current() {
                    break;
                }
            }
            let _ = app.emit(SYNC_CHANGED, (&profile.id, &value));
            if value.state == aura_protocol::account::AccountSyncState::Inactive {
                break;
            }
            if status.changed().await.is_err() {
                break;
            }
        }
    });
}
pub fn trigger(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if state.quit.is_quitting() || state.app_info().profile_switching {
        return;
    }
    if let Some(chats) = state.chats()
        && let Some(engine) = chats.sync_engine.get()
    {
        engine.trigger();
    }
}
pub(crate) fn with_status(state: &AppState, mut status: AccountStatus) -> AccountStatus {
    if let Some(chats) = state.chats()
        && let Some(identity) = &chats.sync_identity
        && status.account_id.as_deref() == Some(identity.account.as_str())
        && status.device_id.as_deref() == Some(identity.device.as_str())
        && let Some(engine) = chats.sync_engine.get()
    {
        status.sync = engine.status();
    }
    status
}
