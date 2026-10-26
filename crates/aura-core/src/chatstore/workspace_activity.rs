//! Shared admission between in-memory dispatch and writer-owned parent tombstone projection.
use rusqlite::Connection;
#[cfg(feature = "account-sync")]
use rusqlite::params;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

pub(crate) struct Activity(
    Mutex<BTreeMap<String, State>>,
    tokio::sync::watch::Sender<u64>,
);
impl Default for Activity {
    fn default() -> Self {
        Self(Mutex::default(), tokio::sync::watch::channel(0).0)
    }
}
#[derive(Default)]
pub(crate) struct State {
    available: bool,
    active: bool,
    #[cfg(test)]
    remove_before_begin: bool,
}
pub(crate) struct Turn {
    activity: Arc<Activity>,
    chat: String,
}
impl Drop for Turn {
    fn drop(&mut self) {
        if let Some(state) = self.activity.lock().get_mut(&self.chat) {
            state.active = false;
        }
    }
}
impl Activity {
    pub(crate) fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.1.subscribe()
    }
    pub(crate) fn changed(&self) {
        self.1
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }
    pub(crate) fn lock(&self) -> MutexGuard<'_, BTreeMap<String, State>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    pub(crate) fn begin(self: &Arc<Self>, chat: &str) -> Option<Turn> {
        let mut states = self.lock();
        let state = states.get_mut(chat)?;
        #[cfg(test)]
        if std::mem::take(&mut state.remove_before_begin) {
            state.available = false;
        }
        if !state.available || state.active {
            return None;
        }
        state.active = true;
        Some(Turn {
            activity: self.clone(),
            chat: chat.into(),
        })
    }
    #[cfg(test)]
    pub(crate) fn remove_before_begin(&self, chat: &str) {
        self.lock()
            .get_mut(chat)
            .expect("loaded test chat")
            .remove_before_begin = true;
    }
    pub(crate) fn available(&self, chat: &str) -> bool {
        self.lock().get(chat).is_some_and(|state| state.available)
    }
    pub(crate) fn loaded(&self, conn: &Connection, chat: &str) -> rusqlite::Result<()> {
        let mut states = self.lock();
        states.entry(chat.into()).or_default().available =
            super::workspace_removal::available(conn, chat)?;
        Ok(())
    }
}
/// Keep the lock through projection and cache refresh. Dispatch either precedes the projection
/// and defers it, or observes the committed unavailable parent before sending a prompt.
#[cfg(feature = "account-sync")]
pub(crate) fn prepare(conn: &Connection, states: &BTreeMap<String, State>) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS aura_workspace_active(chat_id TEXT PRIMARY KEY); DELETE FROM aura_workspace_active;")?;
    for (id, state) in states {
        if state.active {
            conn.execute(
                "INSERT INTO aura_workspace_active(chat_id) VALUES(?1)",
                params![id],
            )?;
        }
    }
    Ok(())
}
pub(crate) fn refresh(conn: &Connection, states: &mut BTreeMap<String, State>) -> bool {
    let mut changed = false;
    for (id, state) in states {
        let available = super::workspace_removal::available(conn, id).unwrap_or(false);
        changed |= state.available != available;
        state.available = available;
    }
    changed
}
