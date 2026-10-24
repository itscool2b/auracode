//! The app-wide state Tauri manages: startup results, the profile store, running demo streams,
//! and the launch switches.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use aura_core::device::DeviceIdentity;
use aura_core::profile::ProfileMeta;
use aura_core::store::Store;
use serde::Serialize;

use crate::boot::{Booted, DbInfo};
use crate::demo::DemoSessions;
use crate::glass::GlassEffect;
use crate::launch::{LaunchMode, LaunchOptions};
use crate::os::OsInfo;
use crate::sync::lock;
use crate::window::ShowOnce;

/// Everything the UI needs to know about this launch, from `app_info`.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct AppInfo {
    /// auracode's version (the Cargo workspace version).
    pub app_version: String,
    pub tauri_version: String,
    /// `"macos"`, `"windows"`, `"linux"`, or Rust's name for another OS.
    pub os: String,
    /// The release as the OS reports it (`"26.6.2"`, `"10.0.22631"`, a Linux distribution name).
    pub os_version: String,
    /// `"aarch64"`, `"x86_64"`, ...
    pub arch: String,
    /// The data root. `null` only when no data folder could be determined at all.
    pub data_dir: Option<String>,
    /// `null` when startup failed before the identity was loaded (see `fatal`).
    pub device: Option<DeviceIdentity>,
    /// The active profile; `null` when startup failed before opening it.
    pub profile: Option<ProfileMeta>,
    /// The profile database; `null` when startup failed before opening it.
    pub db: Option<DbInfo>,
    /// The native material behind the window. `none` means the UI must paint an opaque background.
    pub glass: GlassEffect,
    /// What to open into: the normal screen, the smoke run, or the stress view.
    pub launch: LaunchMode,
    /// Sentences to show: repairs startup made, launch settings that were ignored.
    pub notices: Vec<String>,
    /// Why startup could not complete, as a sentence to show on the error screen.
    pub fatal: Option<String>,
}

/// State managed by Tauri for the whole app.
pub struct AppState {
    info: AppInfo,
    /// The data root as a path (`info.data_dir` is its display string): the one folder the page
    /// may reveal, through `reveal_data_dir`.
    data_dir: Option<PathBuf>,
    /// The profile database. `rusqlite::Connection` is `Send` but not `Sync`, hence the mutex.
    store: Mutex<Option<Store>>,
    pub demos: DemoSessions,
    pub launch: LaunchOptions,
    /// Shared with the startup fallback timer, so whichever shows the window first wins.
    pub window_shown: Arc<ShowOnce>,
    /// Set by the first smoke report (or the watchdog); later ones are ignored.
    pub smoke_reported: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(
        booted: Booted,
        os: &OsInfo,
        glass: GlassEffect,
        launch: LaunchOptions,
        app_version: String,
    ) -> AppState {
        let mut notices = booted.notices;
        notices.extend(launch.notices());
        let info = AppInfo {
            app_version,
            tauri_version: tauri::VERSION.to_string(),
            os: os.os.to_string(),
            os_version: os.display.clone(),
            arch: std::env::consts::ARCH.to_string(),
            data_dir: booted
                .data_dir
                .as_ref()
                .map(|dir| dir.display().to_string()),
            device: booted.device,
            profile: booted.profile,
            db: booted.db,
            glass,
            launch: launch.mode(),
            notices,
            fatal: booted.fatal,
        };
        AppState {
            info,
            data_dir: booted.data_dir,
            store: Mutex::new(booted.store),
            demos: DemoSessions::default(),
            launch,
            window_shown: Arc::default(),
            smoke_reported: Arc::default(),
        }
    }

    /// The startup snapshot, with the schema version read live from the database so the card shows
    /// what is on disk now.
    pub fn app_info(&self) -> AppInfo {
        let mut info = self.info.clone();
        if let (Some(db), Some(store)) = (info.db.as_mut(), lock(&self.store).as_ref()) {
            match store.schema_version() {
                Ok(version) => db.schema_version = version,
                Err(error) => tracing::warn!(%error, "could not read the schema version"),
            }
        }
        info
    }

    /// The data root startup chose, whether or not it could be created. `None` only when no data
    /// folder could be determined at all.
    pub fn data_dir(&self) -> Option<&Path> {
        self.data_dir.as_deref()
    }

    /// Closes the profile database, at exit. The process ends without running destructors, and
    /// only a closed connection folds SQLite's write-ahead log back into the file and removes it;
    /// a log left behind tells the next launch this one did not end cleanly
    /// (`StoreInfo::unclean_shutdown`). Returns whether a database was open.
    pub fn close_store(&self) -> bool {
        lock(&self.store).take().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boot::boot;
    use crate::launch::{NO_GLASS_ENV, STRESS_ENV};
    use aura_core::paths::DataRoot;

    fn os() -> OsInfo {
        OsInfo {
            os: "macos",
            version: None,
            display: "26.6.2".into(),
        }
    }

    #[test]
    fn app_info_combines_startup_os_glass_and_launch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let booted = boot(Ok(DataRoot::at(dir.path().join("data"))));
        let launch = LaunchOptions::from_lookup(|name| match name {
            STRESS_ENV => Some("orbs=0".into()),
            NO_GLASS_ENV => Some("1".into()),
            _ => None,
        });
        let state = AppState::new(booted, &os(), GlassEffect::None, launch, "0.1.0".into());
        let info = state.app_info();

        assert_eq!(info.app_version, "0.1.0");
        assert_eq!(info.tauri_version, tauri::VERSION);
        assert_eq!(info.os, "macos");
        assert_eq!(info.os_version, "26.6.2");
        assert_eq!(info.arch, std::env::consts::ARCH);
        assert_eq!(info.glass, GlassEffect::None);
        assert_eq!(info.launch, LaunchMode::Normal);
        assert_eq!(info.fatal, None);
        assert!(info.device.is_some() && info.profile.is_some());
        assert_eq!(
            info.db.as_ref().map(|db| db.schema_version),
            Some(aura_core::store::SCHEMA_VERSION)
        );
        assert_eq!(info.notices.len(), 2, "{:?}", info.notices);
        assert!(info.notices[0].starts_with("AURACODE_STRESS was ignored"));

        let data = dir.path().join("data");
        assert_eq!(state.data_dir(), Some(data.as_path()));
        assert_eq!(info.data_dir, Some(data.display().to_string()));
    }

    #[test]
    fn closing_the_store_at_exit_leaves_no_write_ahead_log() {
        let dir = tempfile::tempdir().expect("tempdir");
        let booted = boot(Ok(DataRoot::at(dir.path().join("data"))));
        let db = PathBuf::from(&booted.db.as_ref().expect("db").path);
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        let launch = LaunchOptions::from_lookup(|_| None);
        let state = AppState::new(booted, &os(), GlassEffect::None, launch, "0.1.0".into());
        assert!(
            std::fs::metadata(&wal).is_ok_and(|meta| meta.len() > 0),
            "creating the database wrote to its log"
        );

        assert!(state.close_store());
        assert!(!wal.exists(), "the log was folded back into the database");
        assert!(!state.close_store(), "closing twice is harmless");
        // The startup facts are still there for a late app_info.
        assert!(state.app_info().db.is_some());
    }

    #[test]
    fn a_failed_startup_still_answers_app_info() {
        let booted = boot(Err(aura_core::CoreError::NoDataDir));
        let launch = LaunchOptions::from_lookup(|_| None);
        let state = AppState::new(booted, &os(), GlassEffect::Vibrancy, launch, "0.1.0".into());
        let info = state.app_info();
        assert!(info.fatal.is_some());
        assert_eq!(info.data_dir, None);
        assert_eq!(state.data_dir(), None, "nothing to reveal");
        assert_eq!(info.device, None);
        assert_eq!(info.db, None);
        let json = serde_json::to_value(&info).expect("serialize");
        assert_eq!(json["glass"], "vibrancy");
        assert_eq!(json["launch"]["type"], "normal");
        assert!(json["device"].is_null());
    }
}
