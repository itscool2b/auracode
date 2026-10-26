//! Small, profile-local setup preferences. No agent, account or credential data belongs here.
//! The profile owner lock serializes processes; this store serializes commands within that owner.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::fsutil::{quarantine_file, write_json_atomic};

const VERSION: u32 = 1;
const MAX_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    #[default]
    Welcome,
    Agents,
    Account,
    Motion,
    Project,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum MotionPreference {
    /// Full motion still honors the operating system's reduced-motion setting.
    #[default]
    Full,
    Reduced,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SetupPreferences {
    pub revision: u32,
    pub step: SetupStep,
    pub motion: MotionPreference,
    pub completed: bool,
    pub first_project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct SetupSnapshot {
    pub preferences: SetupPreferences,
    /// Stable for this process, even when React remounts or the webview reloads.
    pub cold_start: bool,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SetupAction {
    Visit { step: SetupStep },
    Motion { value: MotionPreference },
    Project { project_id: String },
    Finish,
    Restart,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    version: u32,
    boot_seen: bool,
    preferences: SetupPreferences,
}

impl Default for Record {
    fn default() -> Self {
        Self {
            version: VERSION,
            boot_seen: false,
            preferences: SetupPreferences {
                revision: 0,
                step: SetupStep::Welcome,
                motion: MotionPreference::Full,
                completed: false,
                first_project_id: None,
            },
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SetupError {
    #[error("Setup changed in another view. Reload it and try again.")]
    Stale,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Setup preferences were saved by a newer auracode. They have been left unchanged.")]
    NewerVersion,
    #[error("Could not save setup preferences: {0}")]
    Storage(#[from] crate::CoreError),
}

pub struct OnboardingStore {
    path: PathBuf,
    #[cfg(feature = "account-sync")]
    encrypted: Option<crate::profile_files::EncryptedRecord>,
    record: Mutex<Record>,
    cold_start: bool,
    notice: Option<String>,
}

impl OnboardingStore {
    /// Call only while holding this profile's owner lock. Missing files begin at Welcome.
    pub fn open(profile_dir: &Path) -> Result<Self, SetupError> {
        // Preserve the directory-based Local API, but never let an Account caller silently choose
        // plaintext setup storage. Only auracode's bounded profile metadata is examined.
        if let Some(value) = read(&profile_dir.join("profile.json"))? {
            let profile: crate::profile::ProfileMeta =
                serde_json::from_value(value).map_err(|_| {
                    SetupError::Invalid(
                        "The profile metadata must be repaired before opening setup.",
                    )
                })?;
            if profile.kind == crate::profile::ProfileKind::Account {
                return Err(SetupError::Invalid(
                    "Unlock this account's setup preferences first.",
                ));
            }
        }
        let path = profile_dir.join("onboarding.json");
        let mut notice = None;
        let record = match read(&path)? {
            None => Record::default(),
            Some(value) => {
                // Check the version before deserializing fields so future layouts stay intact.
                if value
                    .get("version")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|version| version > u64::from(VERSION))
                {
                    return Err(SetupError::NewerVersion);
                }
                match serde_json::from_value::<Record>(value) {
                    Ok(record) if record.version == VERSION => record,
                    _ => {
                        let moved = quarantine_file(&path)?;
                        notice = Some(format!(
                            "Setup preferences could not be read. The previous file is preserved at {}. Your chats are unchanged.",
                            moved.display()
                        ));
                        Record::default()
                    }
                }
            }
        };
        Ok(Self {
            path,
            #[cfg(feature = "account-sync")]
            encrypted: None,
            cold_start: !record.boot_seen,
            record: Mutex::new(record),
            notice,
        })
    }

    #[cfg(feature = "account-sync")]
    pub fn open_account(
        profile: &crate::profile::Profile,
        key: std::sync::Arc<aura_sync::crypto::files::ProfileFileKey>,
    ) -> Result<Self, SetupError> {
        if profile.meta.kind != crate::profile::ProfileKind::Account {
            return Err(SetupError::Invalid(
                "An account setup key requires an Account profile.",
            ));
        }
        let path = profile.dir.join("onboarding.json");
        match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(crate::CoreError::io(&path)(error).into()),
            Ok(_) => {
                return Err(SetupError::Invalid(
                    "Existing setup preferences need an explicit encrypted import. They were retained.",
                ));
            }
        }
        let file = crate::profile_files::EncryptedRecord::open(
            &profile.dir.join("metadata"),
            "onboarding",
            MAX_BYTES as usize,
            key,
        )
        .map_err(crate::CoreError::io(&path))?;
        let record = match file.read().map_err(crate::CoreError::io(&path))? {
            None => Record::default(),
            Some(bytes) => {
                let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
                    SetupError::Invalid("The encrypted setup record is invalid and was retained.")
                })?;
                if value
                    .get("version")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|version| version > u64::from(VERSION))
                {
                    return Err(SetupError::NewerVersion);
                }
                let record: Record = serde_json::from_value(value).map_err(|_| {
                    SetupError::Invalid("The encrypted setup record is invalid and was retained.")
                })?;
                if record.version != VERSION {
                    return Err(SetupError::Invalid(
                        "The encrypted setup version is unsupported and was retained.",
                    ));
                }
                record
            }
        };
        Ok(Self {
            path,
            encrypted: Some(file),
            cold_start: !record.boot_seen,
            record: Mutex::new(record),
            notice: None,
        })
    }

    fn save(&self, record: &Record) -> Result<(), SetupError> {
        #[cfg(feature = "account-sync")]
        if let Some(file) = &self.encrypted {
            let bytes = serde_json::to_vec(record)
                .map_err(|_| SetupError::Invalid("Setup preferences could not be encoded."))?;
            file.write(&bytes)
                .map_err(crate::CoreError::io(&self.path))?;
            return Ok(());
        }
        write_json_atomic(&self.path, record)?;
        Ok(())
    }

    /// Marks the boot seen only when the interface asks for setup, never in headless runs.
    pub fn snapshot(&self) -> Result<SetupSnapshot, SetupError> {
        let mut record = self
            .record
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !record.boot_seen {
            let mut next = record.clone();
            next.boot_seen = true;
            self.save(&next)?;
            *record = next;
        }
        Ok(self.view(&record))
    }

    pub fn apply(&self, revision: u32, action: SetupAction) -> Result<SetupSnapshot, SetupError> {
        let mut record = self
            .record
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if revision != record.preferences.revision {
            return Err(SetupError::Stale);
        }
        let mut next = record.clone();
        match action {
            SetupAction::Visit { step } => next.preferences.step = step,
            SetupAction::Motion { value } => next.preferences.motion = value,
            SetupAction::Project { project_id } => {
                if project_id.is_empty()
                    || project_id.len() > 128
                    || project_id.chars().any(char::is_control)
                {
                    return Err(SetupError::Invalid("The project identifier is invalid."));
                }
                next.preferences.first_project_id = Some(project_id);
            }
            SetupAction::Finish => next.preferences.completed = true,
            SetupAction::Restart => {
                next.preferences.step = SetupStep::Welcome;
                next.preferences.completed = false;
            }
        }
        next.preferences.revision = revision
            .checked_add(1)
            .ok_or(SetupError::Invalid("Setup revision limit reached."))?;
        self.save(&next)?;
        *record = next;
        Ok(self.view(&record))
    }

    fn view(&self, record: &Record) -> SetupSnapshot {
        SetupSnapshot {
            preferences: record.preferences.clone(),
            cold_start: self.cold_start,
            notice: self.notice.clone(),
        }
    }
}

fn read(path: &Path) -> Result<Option<serde_json::Value>, SetupError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => return Ok(Some(serde_json::Value::Null)),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(crate::CoreError::Io {
                path: path.into(),
                source,
            }
            .into());
        }
    }
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(crate::CoreError::Io {
                path: path.into(),
                source,
            }
            .into());
        }
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(crate::CoreError::io(path))?;
    // Invalid and oversized files take the same preserving recovery path in open().
    if bytes.len() as u64 > MAX_BYTES {
        return Ok(Some(serde_json::Value::Null));
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    Ok(Some(
        serde_json::from_slice(bytes).unwrap_or(serde_json::Value::Null),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_resumes_and_boot_is_stable_across_reads() {
        let dir = tempfile::tempdir().unwrap();
        let store = OnboardingStore::open(dir.path()).unwrap();
        assert!(store.snapshot().unwrap().cold_start);
        assert!(store.snapshot().unwrap().cold_start);
        store
            .apply(
                0,
                SetupAction::Visit {
                    step: SetupStep::Motion,
                },
            )
            .unwrap();
        store
            .apply(
                1,
                SetupAction::Motion {
                    value: MotionPreference::Off,
                },
            )
            .unwrap();
        let reopened = OnboardingStore::open(dir.path())
            .unwrap()
            .snapshot()
            .unwrap();
        assert!(!reopened.cold_start);
        assert_eq!(reopened.preferences.step, SetupStep::Motion);
        assert_eq!(reopened.preferences.motion, MotionPreference::Off);
    }

    #[test]
    fn finish_and_restart_keep_preferences_and_reject_stale_views() {
        let dir = tempfile::tempdir().unwrap();
        let store = OnboardingStore::open(dir.path()).unwrap();
        store
            .apply(
                0,
                SetupAction::Project {
                    project_id: "project".into(),
                },
            )
            .unwrap();
        assert!(matches!(
            store.apply(0, SetupAction::Finish),
            Err(SetupError::Stale)
        ));
        assert!(
            store
                .apply(1, SetupAction::Finish)
                .unwrap()
                .preferences
                .completed
        );
        let restarted = store.apply(2, SetupAction::Restart).unwrap().preferences;
        assert!(!restarted.completed);
        assert_eq!(restarted.first_project_id.as_deref(), Some("project"));
        assert_eq!(restarted.step, SetupStep::Welcome);
    }

    #[test]
    fn failed_write_does_not_advance_memory_or_acknowledge_success() {
        let dir = tempfile::tempdir().unwrap();
        let store = OnboardingStore::open(dir.path()).unwrap();
        std::fs::create_dir(dir.path().join("onboarding.json")).unwrap();
        assert!(store.apply(0, SetupAction::Finish).is_err());
        assert_eq!(store.record.lock().unwrap().preferences.revision, 0);
        assert!(!store.record.lock().unwrap().preferences.completed);
    }

    #[test]
    fn damaged_preferences_are_preserved_but_future_data_is_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        std::fs::write(&path, b"broken").unwrap();
        let store = OnboardingStore::open(dir.path()).unwrap();
        assert!(store.snapshot().unwrap().notice.is_some());
        assert!(
            std::fs::read_dir(dir.path())
                .unwrap()
                .any(|entry| std::fs::read(entry.unwrap().path()).unwrap() == b"broken")
        );
        std::fs::write(&path, br#"{"version":2,"future":true}"#).unwrap();
        assert!(matches!(
            OnboardingStore::open(dir.path()),
            Err(SetupError::NewerVersion)
        ));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            br#"{"version":2,"future":true}"#
        );
    }
    #[cfg(feature = "account-sync")]
    #[test]
    fn account_preferences_reopen_encrypted_and_reject_plaintext_or_unknown_formats() {
        use crate::profile::{Profile, ProfileKind, ProfileMeta};
        use aura_sync::crypto::AccountKey;
        let temp = tempfile::tempdir().unwrap();
        let profile = Profile {
            meta: ProfileMeta {
                id: "profile".into(),
                kind: ProfileKind::Account,
                display_name: "Account".into(),
                created_at: 0,
            },
            dir: temp.path().to_path_buf(),
        };
        write_json_atomic(&profile.meta_path(), &profile.meta).unwrap();
        assert!(OnboardingStore::open(&profile.dir).is_err());
        let key = std::sync::Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        );
        let store = OnboardingStore::open_account(&profile, key.clone()).unwrap();
        store.snapshot().unwrap();
        store
            .apply(
                0,
                SetupAction::Project {
                    project_id: "synthetic private project".into(),
                },
            )
            .unwrap();
        store
            .apply(
                1,
                SetupAction::Motion {
                    value: MotionPreference::Off,
                },
            )
            .unwrap();
        let reopened = OnboardingStore::open_account(&profile, key.clone())
            .unwrap()
            .snapshot()
            .unwrap();
        assert!(!reopened.cold_start);
        assert_eq!(
            reopened.preferences.first_project_id.as_deref(),
            Some("synthetic private project")
        );
        assert_eq!(reopened.preferences.motion, MotionPreference::Off);
        assert!(!profile.dir.join("onboarding.json").exists());
        for entry in std::fs::read_dir(profile.dir.join("metadata")).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(
                !bytes
                    .windows(b"synthetic private project".len())
                    .any(|part| part == b"synthetic private project")
            );
        }
        let file = store.encrypted.as_ref().unwrap();
        file.write(br#"{"version":999,"future":true}"#).unwrap();
        assert!(matches!(
            OnboardingStore::open_account(&profile, key.clone()),
            Err(SetupError::NewerVersion)
        ));
        assert_eq!(
            file.read().unwrap().unwrap(),
            br#"{"version":999,"future":true}"#
        );
        std::fs::write(profile.dir.join("onboarding.json"), b"legacy").unwrap();
        assert!(OnboardingStore::open_account(&profile, key).is_err());
        assert_eq!(
            std::fs::read(profile.dir.join("onboarding.json")).unwrap(),
            b"legacy"
        );
    }
}
