//! Refresh installed-agent discovery after returning to the app, without repeated focus probes.
use crate::state::AppState;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

const COOLDOWN: Duration = Duration::from_secs(60);
pub struct RefreshGate(Mutex<Gate>);
struct Gate {
    last: Instant,
    running: bool,
}
impl Default for RefreshGate {
    fn default() -> Self {
        // Startup already probes the catalog. The first window focus must not duplicate it.
        Self(Mutex::new(Gate {
            last: Instant::now(),
            running: false,
        }))
    }
}
impl RefreshGate {
    fn claim(self: &Arc<Self>, now: Instant) -> Option<RefreshLease> {
        let mut gate = self.0.lock().ok()?;
        if gate.running || now.saturating_duration_since(gate.last) < COOLDOWN {
            return None;
        }
        gate.running = true;
        gate.last = now;
        Some(RefreshLease(self.clone()))
    }
}
struct RefreshLease(Arc<RefreshGate>);
impl Drop for RefreshLease {
    fn drop(&mut self) {
        if let Ok(mut gate) = self.0.0.lock() {
            gate.running = false;
        }
    }
}
pub fn on_focus(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if state.launch.is_smoke() || state.quit.is_quitting() {
        return;
    }
    let Some(lease) = state.catalog_refresh.claim(Instant::now()) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        // The existing command owns profile admission, re-resolves the environment, and bounds
        // installed-version probes. Running sessions keep their original launch specifications.
        let _ = crate::commands::agents_refresh(app).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn focus_bursts_and_slow_probes_are_coalesced() {
        let now = Instant::now();
        let gate = Arc::new(RefreshGate(Mutex::new(Gate {
            last: now,
            running: false,
        })));
        assert!(gate.claim(now).is_none());
        assert!(gate.claim(now + COOLDOWN / 2).is_none());
        let active = gate.claim(now + COOLDOWN).unwrap();
        assert!(gate.claim(now + COOLDOWN * 4).is_none());
        drop(active);
        assert!(
            gate.claim(now + COOLDOWN + Duration::from_secs(1))
                .is_none()
        );
        assert!(gate.claim(now + COOLDOWN * 4).is_some());
    }
}
