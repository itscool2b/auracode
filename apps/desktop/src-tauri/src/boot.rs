//! The startup sequence: data root, device identity, active profile, profile database.
//!
//! [`boot`] never fails and never panics. Repairs aura-core made on the way (a recreated device
//! identity, a quarantined database, a migration) become notices; the first step that cannot
//! complete becomes the fatal error the UI shows on its error screen, with the data path, instead
//! of the app crashing before a window exists.

use std::path::PathBuf;

use aura_core::device::{DeviceIdentity, DeviceLoad};
use aura_core::paths::{DATA_DIR_ENV, DataRoot};
use aura_core::profile::{ProfileMeta, Profiles};
use aura_core::store::{OpenOutcome, Salvage, Store};
use serde::Serialize;

/// The profile database as the info card shows it.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
pub struct DbInfo {
    pub path: String,
    pub schema_version: u32,
    /// What opening the database had to do (create, migrate, recover).
    pub outcome: OpenOutcome,
}

/// Everything startup produced, complete or not.
#[derive(Debug)]
pub struct Booted {
    /// `None` only when no data folder could be determined at all.
    pub data_dir: Option<PathBuf>,
    pub device: Option<DeviceIdentity>,
    pub profile: Option<ProfileMeta>,
    pub store: Option<Store>,
    pub db: Option<DbInfo>,
    /// Sentences the UI lists: repairs that happened, data that was moved aside.
    pub notices: Vec<String>,
    /// The error that stopped startup, as a sentence the UI shows as is.
    pub fatal: Option<String>,
}

/// Whether `AURACODE_DATA_DIR` is set to something non-blank.
pub fn data_dir_overridden() -> bool {
    std::env::var_os(DATA_DIR_ENV).is_some_and(|value| !value.to_string_lossy().trim().is_empty())
}

/// The data root: `app_data_dir` from Tauri, unless `AURACODE_DATA_DIR` overrides it, in which case
/// aura-core resolves it exactly as the CLI does (so both always open the same profile). Without
/// either, aura-core's own resolution is the last resort.
pub fn choose_root(
    env_override: bool,
    app_data_dir: Option<PathBuf>,
) -> aura_core::Result<DataRoot> {
    match app_data_dir {
        Some(dir) if !env_override => Ok(DataRoot::at(dir)),
        _ => DataRoot::resolve(),
    }
}

/// Runs the startup sequence on `root`.
pub fn boot(root: aura_core::Result<DataRoot>) -> Booted {
    let mut booted = Booted {
        data_dir: None,
        device: None,
        profile: None,
        store: None,
        db: None,
        notices: Vec::new(),
        fatal: None,
    };
    let root = match root {
        Ok(root) => root,
        Err(error) => return booted.fail("find the data folder", &error),
    };
    booted.data_dir = Some(root.root().to_path_buf());

    if let Err(error) = root.ensure() {
        return booted.fail("create the data folder", &error);
    }

    match DeviceIdentity::load_or_create(&root) {
        Ok(load) => {
            if let DeviceLoad::Recreated { backup, .. } = &load {
                booted.notices.push(format!(
                    "This device's identity file was damaged, so auracode created a new one. The old file was kept at {}.",
                    backup.display()
                ));
            }
            booted.device = Some(load.identity().clone());
        }
        Err(error) => return booted.fail("load this device's identity", &error),
    }

    let profile = match Profiles::new(root).open_active() {
        Ok(profile) => profile,
        Err(error) => return booted.fail("open your profile", &error),
    };
    booted.profile = Some(profile.meta.clone());

    match Store::open(&profile) {
        Ok((store, info)) => {
            match &info.outcome {
                OpenOutcome::Created | OpenOutcome::Opened => {}
                OpenOutcome::Migrated { from, to, backup } => {
                    booted.notices.push(match backup {
                        Some(backup) => format!(
                            "Your data was upgraded from version {from} to {to}. A copy of the old database was kept at {backup}."
                        ),
                        None => format!("Your data was upgraded from version {from} to {to}."),
                    });
                }
                OpenOutcome::RecoveredFromCorruption {
                    quarantined,
                    salvage,
                } => {
                    booted.notices.push(recovery_notice(quarantined, salvage));
                }
            }
            booted.db = Some(DbInfo {
                path: info.path.display().to_string(),
                schema_version: info.schema_version,
                outcome: info.outcome,
            });
            booted.store = Some(store);
        }
        Err(error) => return booted.fail("open your database", &error),
    }

    booted
}

/// The notice for a database aura-core had to repair: how much of it the new database holds, and
/// where the damaged original is, since whatever the copy lacks is only there.
pub fn recovery_notice(quarantined: &str, salvage: &Salvage) -> String {
    match salvage {
        Salvage::Complete => format!(
            "Your database was damaged, so auracode rebuilt it. Nothing was lost; the damaged copy was kept at {quarantined}."
        ),
        Salvage::Partial { tables } if !tables.is_empty() => format!(
            "Your database was damaged, so auracode rebuilt it from what it could still read. Some records could not be read ({}); the damaged copy was kept at {quarantined}.",
            tables.join(", ")
        ),
        Salvage::Partial { .. } => format!(
            "Your database was damaged, so auracode rebuilt it from what it could still read. Some records could not be read; the damaged copy was kept at {quarantined}."
        ),
        Salvage::Nothing => format!(
            "Your database was damaged and nothing in it could be read, so auracode started a fresh one. The damaged copy was kept at {quarantined}."
        ),
    }
}

impl Booted {
    fn fail(mut self, step: &str, error: &aura_core::CoreError) -> Booted {
        tracing::error!(%error, step, "startup could not complete");
        // aura-core's messages are complete sentences; keep them verbatim.
        self.fatal = Some(error.to_string());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fresh() -> (tempfile::TempDir, DataRoot) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = DataRoot::at(dir.path().join("data"));
        (dir, root)
    }

    #[test]
    fn first_launch_creates_everything_without_notices() {
        let (_dir, root) = fresh();
        let booted = boot(Ok(root.clone()));
        assert_eq!(booted.fatal, None);
        assert!(booted.notices.is_empty(), "{:?}", booted.notices);
        assert_eq!(booted.data_dir.as_deref(), Some(root.root()));
        assert!(booted.device.is_some());
        assert_eq!(
            booted.profile.as_ref().map(|p| p.id.as_str()),
            Some(aura_core::profile::LOCAL_PROFILE_ID)
        );
        let db = booted.db.expect("db info");
        assert_eq!(db.outcome, OpenOutcome::Created);
        assert_eq!(db.schema_version, aura_core::store::SCHEMA_VERSION);
        assert!(booted.store.is_some());
    }

    #[test]
    fn second_launch_opens_the_same_data() {
        let (_dir, root) = fresh();
        let first = boot(Ok(root.clone()));
        let device_id = first.device.expect("device").device_id;
        drop(first.store);
        let second = boot(Ok(root));
        assert_eq!(second.fatal, None);
        assert_eq!(second.device.expect("device").device_id, device_id);
        assert_eq!(second.db.expect("db").outcome, OpenOutcome::Opened);
    }

    #[test]
    fn a_damaged_device_file_becomes_a_notice() {
        let (_dir, root) = fresh();
        root.ensure().expect("ensure");
        fs::write(root.device_file(), b"{ not json").expect("write");
        let booted = boot(Ok(root));
        assert_eq!(booted.fatal, None);
        assert_eq!(booted.notices.len(), 1, "{:?}", booted.notices);
        assert!(booted.notices[0].contains("identity file was damaged"));
        assert!(booted.notices[0].contains("device.json.corrupt-"));
    }

    #[test]
    fn a_damaged_database_is_recovered_and_reported() {
        let (_dir, root) = fresh();
        let first = boot(Ok(root.clone()));
        let db_path = PathBuf::from(first.db.expect("db").path);
        drop(first.store);
        fs::write(&db_path, vec![0x5a; 8192]).expect("corrupt the database");

        let booted = boot(Ok(root));
        assert_eq!(booted.fatal, None);
        let db = booted.db.expect("db");
        let OpenOutcome::RecoveredFromCorruption {
            quarantined,
            salvage,
        } = &db.outcome
        else {
            panic!("expected a recovery, got {:?}", db.outcome);
        };
        assert!(PathBuf::from(quarantined).exists());
        assert_eq!(
            booted.notices,
            vec![recovery_notice(quarantined, salvage)],
            "one notice, naming where the damaged copy is"
        );
        assert!(booted.notices[0].contains(quarantined.as_str()));
    }

    #[test]
    fn the_recovery_notice_says_how_much_survived() {
        let kept = "/data/backups/aura.db.corrupt-1";
        let complete = recovery_notice(kept, &Salvage::Complete);
        assert!(complete.contains("Nothing was lost"), "{complete}");
        let partial = recovery_notice(
            kept,
            &Salvage::Partial {
                tables: vec!["chats".into(), "events".into()],
            },
        );
        assert!(
            partial.contains("Some records could not be read (chats, events)"),
            "{partial}"
        );
        let unnamed = recovery_notice(kept, &Salvage::Partial { tables: Vec::new() });
        assert!(!unnamed.contains("()"), "{unnamed}");
        let nothing = recovery_notice(kept, &Salvage::Nothing);
        assert!(nothing.contains("started a fresh one"), "{nothing}");
        for notice in [complete, partial, unnamed, nothing] {
            assert!(notice.starts_with("Your database was damaged"), "{notice}");
            assert!(notice.contains(kept), "{notice}");
        }
    }

    #[test]
    fn data_from_a_newer_version_is_fatal_and_untouched() {
        let (_dir, root) = fresh();
        let first = boot(Ok(root.clone()));
        let store = first.store.expect("store");
        store
            .conn()
            .pragma_update(None, "user_version", 99)
            .expect("bump user_version");
        let db_path = store.path().to_path_buf();
        drop(store);
        let before = fs::read(&db_path).expect("read");

        let booted = boot(Ok(root));
        let fatal = booted.fatal.expect("fatal error");
        assert!(fatal.contains("newer version of auracode"), "{fatal}");
        assert!(booted.store.is_none());
        assert!(booted.device.is_some(), "steps before the failure are kept");
        assert!(booted.data_dir.is_some());
        assert_eq!(
            fs::read(&db_path).expect("read"),
            before,
            "nothing was written"
        );
    }

    #[test]
    fn an_unusable_data_folder_is_fatal_not_a_panic() {
        let dir = tempfile::tempdir().expect("tempdir");
        // A file where the data folder should be: creating folders under it fails on every OS.
        let blocker = dir.path().join("data");
        fs::write(&blocker, b"not a folder").expect("write");
        let booted = boot(Ok(DataRoot::at(blocker.join("nested"))));
        let fatal = booted.fatal.expect("fatal error");
        assert!(fatal.starts_with("Could not access"), "{fatal}");
        assert!(booted.device.is_none());
        assert!(booted.data_dir.is_some(), "the path is still shown");
    }

    #[test]
    fn no_data_folder_at_all_is_fatal() {
        let booted = boot(Err(aura_core::CoreError::NoDataDir));
        let fatal = booted.fatal.expect("fatal error");
        assert!(fatal.contains("AURACODE_DATA_DIR"), "{fatal}");
        assert_eq!(booted.data_dir, None);
    }

    #[test]
    fn tauri_app_data_dir_is_used_unless_overridden() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = choose_root(false, Some(dir.path().to_path_buf())).expect("root");
        assert_eq!(root.root(), dir.path());
    }
}
