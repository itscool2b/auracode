//! The app-wide state Tauri manages: startup results, the profile store, the database repair
//! notice, the background integrity check, running demo streams, and the launch switches.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use aura_core::device::DeviceIdentity;
use aura_core::owner::ProfileOwner;
use aura_core::profile::ProfileMeta;
use aura_core::store::Store;
use serde::Serialize;

use crate::boot::{Booted, DbInfo, Recovery};
use crate::demo::DemoSessions;
use crate::error::{AppError, AppErrorCode};
use crate::glass::GlassEffect;
use crate::integrity::IntegrityCheck;
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
    /// Sentences to show: repairs startup made, launch settings that were ignored. None of them
    /// can be dismissed.
    pub notices: Vec<String>,
    /// The notice that the database was damaged and repaired, shown on every launch until the user
    /// dismisses it (`acknowledge_recovery`): whatever the repair could not save is only in the
    /// damaged copy it names. `null` when there is none, and once it has been dismissed.
    pub recovery_notice: Option<String>,
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
    /// The profile's owner lock, held for the app's life: one process runs a profile's sessions.
    _owner: Option<ProfileOwner>,
    /// The repair whose notice is still shown, until `acknowledge_recovery` succeeds. Locked
    /// before `store` whenever both are held.
    recovery: Mutex<Option<Recovery>>,
    /// The background check after a session that did not close the database. Started once the
    /// window is shown, closed at exit before the store.
    pub integrity: IntegrityCheck,
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
            // Filled in live by `app_info`, since dismissing it changes it.
            recovery_notice: None,
            fatal: booted.fatal,
        };
        AppState {
            info,
            data_dir: booted.data_dir,
            store: Mutex::new(booted.store),
            _owner: booted.owner,
            recovery: Mutex::new(booted.recovery),
            integrity: IntegrityCheck::new(booted.integrity_check),
            demos: DemoSessions::default(),
            launch,
            window_shown: Arc::default(),
            smoke_reported: Arc::default(),
        }
    }

    /// The startup snapshot, with what can change since read live: the schema version from the
    /// database, so the card shows what is on disk now, and the repair notice, which goes once
    /// dismissed (a reloaded page must not show it again).
    pub fn app_info(&self) -> AppInfo {
        let mut info = self.info.clone();
        if let (Some(db), Some(store)) = (info.db.as_mut(), lock(&self.store).as_ref()) {
            match store.schema_version() {
                Ok(version) => db.schema_version = version,
                Err(error) => tracing::warn!(%error, "could not read the schema version"),
            }
        }
        info.recovery_notice = lock(&self.recovery)
            .as_ref()
            .map(|recovery| recovery.notice.clone());
        info
    }

    /// The data root startup chose, whether or not it could be created. `None` only when no data
    /// folder could be determined at all.
    pub fn data_dir(&self) -> Option<&Path> {
        self.data_dir.as_deref()
    }

    /// Dismisses the repair notice for good: aura-core removes the repair's record (keeping the
    /// damaged copy), so no later launch reports it. It acknowledges exactly the repair startup
    /// reported; nothing can name another path. With no notice (there was none, or it was already
    /// dismissed) this does nothing, so calling it twice is harmless. On failure the notice stays,
    /// in `app_info` and on the next launch.
    pub fn acknowledge_recovery(&self) -> Result<(), AppError> {
        let mut recovery = lock(&self.recovery);
        let Some(pending) = recovery.as_ref() else {
            return Ok(());
        };
        let store = lock(&self.store);
        let Some(store) = store.as_ref() else {
            return Err(AppError::new(
                AppErrorCode::AcknowledgeFailed,
                "Could not dismiss the notice: the database is closed.",
            ));
        };
        match store.acknowledge_recovery(&pending.quarantined) {
            Ok(removed) => {
                if !removed {
                    // Another auracode process (the CLI) acknowledged it, or its record was
                    // removed by hand: either way there is nothing left to report.
                    tracing::info!(quarantined = %pending.quarantined, "the database repair was already acknowledged");
                }
                *recovery = None;
                Ok(())
            }
            Err(error) => {
                tracing::warn!(%error, quarantined = %pending.quarantined, "could not acknowledge the database repair");
                Err(AppError::new(
                    AppErrorCode::AcknowledgeFailed,
                    format!("Could not dismiss the notice: {error}"),
                ))
            }
        }
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
    use aura_core::store::OpenOutcome;

    fn os() -> OsInfo {
        OsInfo {
            os: "macos",
            version: None,
            display: "26.6.2".into(),
        }
    }

    fn state(booted: Booted) -> AppState {
        let launch = LaunchOptions::from_lookup(|_| None);
        AppState::new(booted, &os(), GlassEffect::None, launch, "0.1.0".into())
    }

    /// A data root whose database the last launch found damaged and repaired. Returns the folder,
    /// the root, and the path the repair moved the damaged database to.
    fn repaired() -> (tempfile::TempDir, DataRoot, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let quarantined = damage_and_repair(&root);
        (dir, root, quarantined)
    }

    /// Damages `root`'s database and boots, which repairs it. Returns where the damaged copy went.
    fn damage_and_repair(root: &DataRoot) -> String {
        let first = boot(Ok(root.clone()));
        let db = PathBuf::from(&first.db.as_ref().expect("db").path);
        drop(first);
        std::fs::write(&db, vec![0x5a; 8192]).expect("damage the database");
        let repaired = boot(Ok(root.clone()));
        let quarantined = repaired
            .recovery
            .as_ref()
            .expect("a repair to report")
            .quarantined
            .clone();
        drop(repaired);
        quarantined
    }

    /// `<quarantined>.json`, aura-core's record of the repair: removing it is what acknowledging
    /// does.
    fn record(quarantined: &str) -> PathBuf {
        PathBuf::from(format!("{quarantined}.json"))
    }

    /// Whether `notice` is about the repair that moved the damaged copy to exactly `quarantined`
    /// (every notice ends with "kept at <path>."; a plain `contains` would also match a later
    /// repair's `<path>.1`).
    fn names(notice: &str, quarantined: &str) -> bool {
        notice.ends_with(&format!(" {quarantined}."))
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
        assert_eq!(info.recovery_notice, None);
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
        assert_eq!(
            state.integrity.pending(),
            None,
            "a first launch checks nothing"
        );
    }

    #[test]
    fn closing_the_store_at_exit_leaves_no_write_ahead_log() {
        let dir = tempfile::tempdir().expect("tempdir");
        let booted = boot(Ok(DataRoot::at(dir.path().join("data"))));
        let db = PathBuf::from(&booted.db.as_ref().expect("db").path);
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        let state = state(booted);
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
        assert_eq!(info.recovery_notice, None);
        let json = serde_json::to_value(&info).expect("serialize");
        assert_eq!(json["glass"], "vibrancy");
        assert_eq!(json["launch"]["type"], "normal");
        assert!(json["device"].is_null());
        assert!(json["recovery_notice"].is_null());
    }

    #[test]
    fn a_dismissed_repair_notice_is_gone_now_and_on_the_next_launch() {
        let (_dir, root, quarantined) = repaired();
        let state = state(boot(Ok(root.clone())));
        let info = state.app_info();
        let notice = info.recovery_notice.expect("the repair is still reported");
        assert!(names(&notice, &quarantined), "{notice}");
        assert!(info.notices.is_empty(), "{:?}", info.notices);

        state.acknowledge_recovery().expect("acknowledge");
        assert_eq!(
            state.app_info().recovery_notice,
            None,
            "a reloaded page no longer shows it"
        );
        assert!(
            !record(&quarantined).exists(),
            "the repair's record is gone"
        );
        assert!(
            Path::new(&quarantined).exists(),
            "the damaged copy itself is kept"
        );
        drop(state);

        let next = state_after_exit(&root);
        assert_eq!(next.app_info().recovery_notice, None);
        assert_eq!(next.app_info().db.expect("db").outcome, OpenOutcome::Opened);
    }

    /// The state of the next launch.
    fn state_after_exit(root: &DataRoot) -> AppState {
        state(boot(Ok(root.clone())))
    }

    #[test]
    fn acknowledging_twice_is_harmless() {
        let (_dir, root, quarantined) = repaired();
        let state = state(boot(Ok(root.clone())));
        state.acknowledge_recovery().expect("acknowledge");
        state
            .acknowledge_recovery()
            .expect("a second acknowledge does nothing");
        assert_eq!(state.app_info().recovery_notice, None);
        assert!(Path::new(&quarantined).exists());
        drop(state);
        assert_eq!(state_after_exit(&root).app_info().recovery_notice, None);
    }

    #[test]
    fn acknowledging_without_a_notice_does_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = state(boot(Ok(DataRoot::at(dir.path().join("data")))));
        assert_eq!(state.app_info().recovery_notice, None);
        state.acknowledge_recovery().expect("nothing to dismiss");
        // Not even a store is needed when there is nothing to acknowledge.
        state.close_store();
        state
            .acknowledge_recovery()
            .expect("still nothing to dismiss");
    }

    /// The page passes no path, and the shell passes on only the one startup recorded: with two
    /// repairs on record, dismissing the reported (newest) one leaves the older one, which the next
    /// launch reports in turn.
    #[test]
    fn only_the_repair_startup_reported_is_acknowledged() {
        let (_dir, root, older) = repaired();
        let newer = damage_and_repair(&root);
        assert_ne!(older, newer);

        let state = state(boot(Ok(root.clone())));
        let notice = state.app_info().recovery_notice.expect("a notice");
        assert!(names(&notice, &newer), "the newest repair first: {notice}");
        state.acknowledge_recovery().expect("acknowledge");
        assert!(!record(&newer).exists());
        assert!(record(&older).exists(), "the other repair was not touched");
        drop(state);

        let next = state_after_exit(&root);
        let notice = next.app_info().recovery_notice.expect("the older repair");
        assert!(names(&notice, &older), "{notice}");
    }

    #[test]
    fn acknowledging_with_the_store_closed_fails_and_keeps_the_notice() {
        let (_dir, root, quarantined) = repaired();
        let state = state(boot(Ok(root.clone())));
        assert!(state.close_store());
        let error = state
            .acknowledge_recovery()
            .expect_err("the store is closed");
        assert_eq!(error.code, AppErrorCode::AcknowledgeFailed);
        assert!(
            error.message.contains("database is closed"),
            "{}",
            error.message
        );
        assert!(
            state.app_info().recovery_notice.is_some(),
            "the notice stays"
        );
        assert!(record(&quarantined).exists());
        drop(state);
        assert!(
            state_after_exit(&root).app_info().recovery_notice.is_some(),
            "and shows again on the next launch"
        );
    }

    /// An I/O failure (here: no permission to delete in the backups folder) keeps the notice, and
    /// a later attempt that can write succeeds.
    #[cfg(unix)]
    #[test]
    fn acknowledging_that_cannot_remove_the_record_fails_and_keeps_the_notice() {
        use std::os::unix::fs::PermissionsExt;

        let (_dir, root, quarantined) = repaired();
        let state = state(boot(Ok(root.clone())));
        let backups = Path::new(&quarantined).parent().expect("backups folder");
        let mode = std::fs::metadata(backups).expect("metadata").permissions();
        std::fs::set_permissions(backups, std::fs::Permissions::from_mode(0o500)).expect("chmod");
        // Root ignores permissions, so there would be nothing to fail.
        if std::fs::write(backups.join("probe"), b"").is_ok() {
            std::fs::set_permissions(backups, mode).expect("restore");
            eprintln!("skipped: this user can write to a read-only folder");
            return;
        }

        let result = state.acknowledge_recovery();
        std::fs::set_permissions(backups, mode).expect("restore");
        let error = result.expect_err("the record could not be removed");
        assert_eq!(error.code, AppErrorCode::AcknowledgeFailed);
        assert!(
            error.message.starts_with("Could not dismiss the notice: "),
            "{}",
            error.message
        );
        assert!(error.message.contains(&quarantined), "{}", error.message);
        assert!(
            state.app_info().recovery_notice.is_some(),
            "the notice stays"
        );
        assert!(record(&quarantined).exists());

        state
            .acknowledge_recovery()
            .expect("works once it can write");
        assert_eq!(state.app_info().recovery_notice, None);
    }

    #[test]
    fn a_launch_after_a_crash_holds_its_integrity_check_until_the_window_shows() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        let first = boot(Ok(root.clone()));
        let db = first.store.as_ref().expect("store").path().to_path_buf();
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        let (file, log) = (
            std::fs::read(&db).expect("read"),
            std::fs::read(&wal).expect("read the log"),
        );
        drop(first);
        // Put back what a crash would have left: the file and its unfolded log.
        std::fs::write(&db, file).expect("restore");
        std::fs::write(&wal, log).expect("restore the log");

        let state = state(boot(Ok(root)));
        assert_eq!(state.integrity.pending(), Some(db));
        assert!(!state.integrity.close(), "nothing running yet");
        assert_eq!(state.integrity.pending(), None, "and now nothing ever will");
    }
}
