//! Active-profile scheduler binding. Event payloads contain only profile identity and public status.
use crate::{state::AppState, sync::lock};
use aura_core::{
    session::{SinkGone, StatusSink},
    sync::engine::SyncEngine,
};
use aura_protocol::{
    SessionStatus,
    account::{AccountStatus, AccountSyncState, AccountSyncStatus},
    session::ChatStatusUpdate,
};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex, Weak, atomic::Ordering},
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
            let mut value = status.borrow().clone();
            if value.state == AccountSyncState::Idle
                && value.last_sync_at.is_some()
                && configured_at != value.last_sync_at
            {
                configured_at = value.last_sync_at;
                let state = app.state::<AppState>();
                if !state.quit.is_quitting()
                    && let Ok(sessions) = state.sessions()
                    && generation.is_current()
                {
                    // Retain profile admission until actor and writer acknowledgements finish.
                    // Each idle actor revalidates its own process, queue and mutation state.
                    let imported = sessions.reconcile_synced_history().await;
                    chats
                        .sync_history_error
                        .store(imported.is_err(), Ordering::Release);
                    if imported.is_ok_and(|count| count > 0) {
                        engine.trigger();
                    }
                }
                crate::config_sync::after_exchange(&app, generation.clone()).await;
                if !generation.is_current() {
                    break;
                }
            }
            history_status(&mut value, chats.sync_history_error.load(Ordering::Acquire));
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
        history_status(
            &mut status.sync,
            chats.sync_history_error.load(Ordering::Acquire),
        );
    }
    status
}

fn history_status(status: &mut AccountSyncStatus, failed: bool) {
    if failed && status.state == AccountSyncState::Idle {
        status.state = AccountSyncState::Error;
        status.message = Some("Remote history could not be applied. Saved conversations are retained. Sync will retry automatically.".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_import_is_visible_without_hiding_network_or_revocation_status() {
        for initial in [
            AccountSyncState::Idle,
            AccountSyncState::Offline,
            AccountSyncState::Paused,
        ] {
            let mut status = AccountSyncStatus {
                state: initial,
                pending_changes: Some(2),
                last_sync_at: Some(123),
                message: Some("Existing network status".into()),
            };
            history_status(&mut status, true);
            assert_eq!(status.pending_changes, Some(2));
            if initial == AccountSyncState::Idle {
                assert_eq!(status.state, AccountSyncState::Error);
                assert!(
                    status
                        .message
                        .as_deref()
                        .is_some_and(|text| text.contains("Saved conversations are retained"))
                );
            } else {
                assert_eq!(status.state, initial);
                assert_eq!(status.message.as_deref(), Some("Existing network status"));
            }
        }
    }
}
