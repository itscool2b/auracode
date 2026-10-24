//! Profiles: separate sets of projects and chats on one machine.
//!
//! M0 ships a single "Local" profile (no account). From M6/M7 each signed-in account gets its own
//! profile, so switching accounts swaps the whole data set instead of mixing them. Each profile is a
//! directory `<data root>/profiles/<id>/`:
//!
//! ```text
//! profile.json     ProfileMeta; written last when creating, so its presence means "complete"
//! aura.db          the SQLite store (crate::store)
//! attachments/     content-addressed files referenced from chats
//! checkpoints/     shadow git repos for per-turn snapshots
//! logs/            raw protocol logs per session
//! backups/         pre-migration backups and quarantined databases
//! ```
//!
//! `<data root>/state.json` records the active profile. Whatever state the files are in, opening the
//! active profile yields a usable profile: a missing, corrupt, or dangling `state.json` falls back to
//! Local (recreating it if needed) with a warning, and a stray file where a profile folder belongs is
//! moved aside, never an error that blocks startup.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::Error as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{CoreError, Result};
use crate::fsutil::{self, JsonFile};
use crate::ids::new_id;
use crate::paths::DataRoot;
use crate::time::now_millis;

/// Id of the profile used without an account.
pub const LOCAL_PROFILE_ID: &str = "local";

const PROFILE_FILE: &str = "profile.json";
const DB_FILE: &str = "aura.db";
const ATTACHMENTS_DIR: &str = "attachments";
const CHECKPOINTS_DIR: &str = "checkpoints";
const LOGS_DIR: &str = "logs";
const BACKUPS_DIR: &str = "backups";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    /// Data that lives only on this machine.
    Local,
    /// Data that belongs to a signed-in account (M6/M7).
    Account,
}

impl ProfileKind {
    fn default_display_name(self) -> &'static str {
        match self {
            ProfileKind::Local => "Local",
            ProfileKind::Account => "Account",
        }
    }
}

/// The contents of `profile.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ProfileMeta {
    pub id: String,
    pub kind: ProfileKind,
    pub display_name: String,
    /// Unix ms, exported to TypeScript as `number` (see `DeviceIdentity::created_at`).
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}

/// A profile and the directory holding its data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub meta: ProfileMeta,
    pub dir: PathBuf,
}

impl Profile {
    /// `<dir>/aura.db`
    pub fn db_path(&self) -> PathBuf {
        self.dir.join(DB_FILE)
    }

    /// `<dir>/attachments`
    pub fn attachments_dir(&self) -> PathBuf {
        self.dir.join(ATTACHMENTS_DIR)
    }

    /// `<dir>/checkpoints`
    pub fn checkpoints_dir(&self) -> PathBuf {
        self.dir.join(CHECKPOINTS_DIR)
    }

    /// `<dir>/logs`
    pub fn logs_dir(&self) -> PathBuf {
        self.dir.join(LOGS_DIR)
    }

    /// `<dir>/backups`
    pub fn backups_dir(&self) -> PathBuf {
        self.dir.join(BACKUPS_DIR)
    }

    /// `<dir>/profile.json`
    pub fn meta_path(&self) -> PathBuf {
        self.dir.join(PROFILE_FILE)
    }

    /// Recreates any missing subdirectory (a user may delete `logs/`), so callers can rely on them.
    /// Something other than a folder where one belongs (a stray file named `logs`) is moved aside
    /// first, since failing here would fail every launch.
    fn ensure_layout(&self) -> Result<()> {
        fsutil::ensure_private_dir(&self.dir)?;
        for dir in [
            self.attachments_dir(),
            self.checkpoints_dir(),
            self.logs_dir(),
            self.backups_dir(),
        ] {
            fsutil::ensure_private_dir(&dir)?;
        }
        Ok(())
    }
}

/// The contents of `state.json`. Fields written by a newer auracode are kept in `extra` and written
/// back untouched, so running an older build doesn't erase them.
#[derive(Debug, Serialize, Deserialize)]
struct AppState {
    active_profile: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// What reading one profile directory produced.
#[derive(Debug)]
enum ProfileRead {
    Missing,
    Valid(Profile),
    Invalid(CoreError),
}

/// Access to the profiles under one data root.
#[derive(Debug, Clone)]
pub struct Profiles {
    root: DataRoot,
}

impl Profiles {
    pub fn new(root: DataRoot) -> Profiles {
        Profiles { root }
    }

    pub fn root(&self) -> &DataRoot {
        &self.root
    }

    /// Opens the profile named in `state.json`, bootstrapping Local on first run.
    ///
    /// Never fails because of what's in the files: a missing or corrupt `state.json`, or one naming a
    /// profile that is missing, invalid, or unreadable, falls back to Local (recreating it if needed),
    /// rewrites `state.json`, and logs a warning. A `state.json` that can't be read also falls back
    /// to Local, but is left alone, so a passing fault doesn't forget the user's choice. A file where
    /// a profile folder or one of its subfolders belongs is moved aside. Only real I/O failures (disk
    /// full, no permission to the data root) are errors.
    pub fn open_active(&self) -> Result<Profile> {
        self.root.ensure()?;
        let state_path = self.root.state_file();
        let mut extra = Map::new();
        match fsutil::read_json::<AppState>(&state_path) {
            JsonFile::Valid(state) => {
                match self.read_profile_or_invalid(&state.active_profile) {
                    ProfileRead::Valid(profile) => {
                        profile.ensure_layout()?;
                        return Ok(profile);
                    }
                    ProfileRead::Missing => tracing::warn!(
                        profile = %state.active_profile,
                        "the active profile no longer exists; falling back to Local"
                    ),
                    ProfileRead::Invalid(error) => tracing::warn!(
                        profile = %state.active_profile,
                        %error,
                        "the active profile can't be opened; falling back to Local"
                    ),
                }
                extra = state.extra;
            }
            JsonFile::Missing if self.profiles_dir_is_empty() => {
                tracing::info!("first run: creating the Local profile");
            }
            JsonFile::Missing => tracing::warn!("state.json is missing; falling back to Local"),
            JsonFile::Unusable(error) => {
                let backup = fsutil::quarantine_file(&state_path)?;
                tracing::warn!(%error, backup = %backup.display(), "state.json is unusable; falling back to Local");
            }
            JsonFile::Unreadable(error) => {
                // A read error says nothing about the contents (a passing I/O fault, a permissions
                // mix-up), so the file is left as it is: this run uses Local, and the next one reads
                // the user's choice again.
                tracing::warn!(%error, "state.json could not be read; using Local for now and leaving it alone");
                return self.ensure_local();
            }
        }
        let local = self.ensure_local()?;
        self.write_state(LOCAL_PROFILE_ID, extra)?;
        Ok(local)
    }

    /// Every readable profile: `local` first, then other Local profiles, then accounts, each oldest
    /// first (a stable order for the profile switcher even when two share a creation millisecond). A
    /// directory that isn't a valid profile (bad name, missing or corrupt `profile.json`, id mismatch)
    /// is skipped with a warning so one damaged profile can't hide the others.
    pub fn list(&self) -> Result<Vec<ProfileMeta>> {
        let profiles_dir = self.root.profiles_dir();
        let entries = match fs::read_dir(&profiles_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => {
                return Err(CoreError::Io {
                    path: profiles_dir,
                    source,
                });
            }
        };

        let mut profiles = Vec::new();
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    tracing::warn!(dir = %profiles_dir.display(), %error, "skipping an unreadable profiles entry");
                    continue;
                }
            };
            let path = entry.path();
            if !path.is_dir() {
                // Stray files such as .DS_Store are not profiles.
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                tracing::warn!(path = %path.display(), "skipping a profile folder with a non-UTF-8 name");
                continue;
            };
            match self.read_profile_or_invalid(&name) {
                ProfileRead::Valid(profile) => profiles.push(profile.meta),
                ProfileRead::Missing => {
                    tracing::warn!(path = %path.display(), "skipping a profile folder without profile.json");
                }
                ProfileRead::Invalid(error) => {
                    tracing::warn!(path = %path.display(), %error, "skipping an unreadable profile");
                }
            }
        }
        profiles.sort_by(|a, b| list_order(a).cmp(&list_order(b)));
        Ok(profiles)
    }

    /// Creates a profile. A Local profile gets the id `local` while no `local` profile exists;
    /// otherwise (an Account profile, or a second Local one, e.g. data kept from a deleted account)
    /// the id is a new UUIDv7. A blank display name becomes "Local" or "Account".
    pub fn create(&self, kind: ProfileKind, display_name: &str) -> Result<Profile> {
        self.root.ensure()?;
        let id = if kind == ProfileKind::Local
            && matches!(self.read_profile(LOCAL_PROFILE_ID)?, ProfileRead::Missing)
        {
            LOCAL_PROFILE_ID.to_string()
        } else {
            new_id()
        };
        let trimmed = display_name.trim();
        let display_name = if trimmed.is_empty() {
            kind.default_display_name()
        } else {
            trimmed
        };
        self.write_new_profile(id, kind, display_name.to_string())
    }

    /// Loads an existing profile by id.
    pub fn get(&self, id: &str) -> Result<Profile> {
        match self.read_profile(id)? {
            ProfileRead::Valid(profile) => Ok(profile),
            ProfileRead::Missing => Err(CoreError::ProfileNotFound(id.to_string())),
            ProfileRead::Invalid(error) => Err(error),
        }
    }

    /// Makes `id` the active profile and persists the choice. The id is validated before it touches
    /// the filesystem, and the profile must exist and be readable.
    pub fn set_active(&self, id: &str) -> Result<Profile> {
        let profile = self.get(id)?;
        self.root.ensure()?;
        profile.ensure_layout()?;
        let extra = match fsutil::read_json::<AppState>(&self.root.state_file()) {
            JsonFile::Valid(state) => state.extra,
            JsonFile::Missing | JsonFile::Unusable(_) | JsonFile::Unreadable(_) => Map::new(),
        };
        self.write_state(id, extra)?;
        Ok(profile)
    }

    /// The Local profile, created or repaired as needed. A corrupt `profile.json` is moved aside and
    /// rewritten; nothing else in the directory (the database above all) is touched. A file where the
    /// profile folder belongs is moved aside first: every read below would fail with "not a
    /// directory", and so would every launch.
    fn ensure_local(&self) -> Result<Profile> {
        fsutil::ensure_private_dir(&self.root.profile_dir(LOCAL_PROFILE_ID)?)?;
        match self.read_profile(LOCAL_PROFILE_ID)? {
            ProfileRead::Valid(profile) => {
                profile.ensure_layout()?;
                Ok(profile)
            }
            ProfileRead::Missing => self.write_new_profile(
                LOCAL_PROFILE_ID.to_string(),
                ProfileKind::Local,
                ProfileKind::Local.default_display_name().to_string(),
            ),
            ProfileRead::Invalid(error) => {
                let meta_path = self.root.profile_dir(LOCAL_PROFILE_ID)?.join(PROFILE_FILE);
                let backup = fsutil::quarantine_file(&meta_path)?;
                tracing::warn!(%error, backup = %backup.display(), "the Local profile.json was unusable; recreated it");
                self.write_new_profile(
                    LOCAL_PROFILE_ID.to_string(),
                    ProfileKind::Local,
                    ProfileKind::Local.default_display_name().to_string(),
                )
            }
        }
    }

    /// Creates the directory and subdirectories, then writes `profile.json` last, so a crash midway
    /// leaves a folder `list()` skips rather than a half-made profile it shows.
    fn write_new_profile(
        &self,
        id: String,
        kind: ProfileKind,
        display_name: String,
    ) -> Result<Profile> {
        let dir = self.root.profile_dir(&id)?;
        let profile = Profile {
            meta: ProfileMeta {
                id,
                kind,
                display_name,
                created_at: now_millis(),
            },
            dir,
        };
        profile.ensure_layout()?;
        fsutil::write_json_atomic(&profile.meta_path(), &profile.meta)?;
        tracing::info!(profile = %profile.meta.id, kind = ?profile.meta.kind, "created profile");
        Ok(profile)
    }

    fn write_state(&self, active_profile: &str, extra: Map<String, Value>) -> Result<()> {
        let state = AppState {
            active_profile: active_profile.to_string(),
            extra,
        };
        fsutil::write_json_atomic(&self.root.state_file(), &state)
    }

    /// Reads `profiles/<id>/profile.json`. An invalid id is an `Err`, so callers handling user input
    /// get `InvalidProfileId` before any path is built.
    fn read_profile(&self, id: &str) -> Result<ProfileRead> {
        let dir = self.root.profile_dir(id)?;
        let meta_path = dir.join(PROFILE_FILE);
        Ok(match fsutil::read_json::<ProfileMeta>(&meta_path) {
            JsonFile::Missing => ProfileRead::Missing,
            JsonFile::Unusable(error) | JsonFile::Unreadable(error) => ProfileRead::Invalid(error),
            JsonFile::Valid(meta) if meta.id != id => {
                ProfileRead::Invalid(id_mismatch(&meta_path, &meta.id, id))
            }
            JsonFile::Valid(meta) => ProfileRead::Valid(Profile { meta, dir }),
        })
    }

    /// [`Profiles::read_profile`] for ids from files, where an invalid id is just another broken
    /// reference to fall back from.
    fn read_profile_or_invalid(&self, id: &str) -> ProfileRead {
        self.read_profile(id).unwrap_or_else(ProfileRead::Invalid)
    }

    fn profiles_dir_is_empty(&self) -> bool {
        fs::read_dir(self.root.profiles_dir())
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true)
    }
}

fn list_order(meta: &ProfileMeta) -> (bool, bool, i64, &str) {
    (
        meta.id != LOCAL_PROFILE_ID,
        meta.kind != ProfileKind::Local,
        meta.created_at,
        meta.id.as_str(),
    )
}

/// A `profile.json` copied into another profile's folder would make two folders claim one id.
fn id_mismatch(meta_path: &Path, found: &str, folder: &str) -> CoreError {
    CoreError::Json {
        path: meta_path.to_path_buf(),
        source: serde_json::Error::custom(format!(
            "its id {found:?} does not match its folder {folder:?}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::validate_profile_id;

    fn setup() -> (tempfile::TempDir, Profiles) {
        let dir = tempfile::tempdir().expect("tempdir");
        let profiles = Profiles::new(DataRoot::at(dir.path().join("aura")));
        (dir, profiles)
    }

    fn state_json(profiles: &Profiles) -> Value {
        let bytes = fs::read(profiles.root().state_file()).expect("state.json");
        serde_json::from_slice(&bytes).expect("state.json is JSON")
    }

    fn write_state_raw(profiles: &Profiles, body: &str) {
        profiles.root().ensure().expect("ensure");
        fs::write(profiles.root().state_file(), body).expect("write state");
    }

    #[test]
    fn first_open_creates_local_and_state() {
        let (_dir, profiles) = setup();
        let profile = profiles.open_active().expect("open");
        assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(profile.meta.kind, ProfileKind::Local);
        assert_eq!(profile.meta.display_name, "Local");
        assert_eq!(profile.dir, profiles.root().profiles_dir().join("local"));
        for dir in [
            profile.attachments_dir(),
            profile.checkpoints_dir(),
            profile.logs_dir(),
            profile.backups_dir(),
        ] {
            assert!(dir.is_dir(), "{}", dir.display());
        }
        assert_eq!(profile.db_path(), profile.dir.join("aura.db"));
        let meta: ProfileMeta =
            serde_json::from_slice(&fs::read(profile.meta_path()).expect("profile.json"))
                .expect("meta");
        assert_eq!(meta, profile.meta);
        assert_eq!(state_json(&profiles)["active_profile"], "local");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&profile.dir)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
        // Opening again changes nothing.
        assert_eq!(profiles.open_active().expect("reopen"), profile);
    }

    #[test]
    fn json_formats_are_snake_case() {
        let meta = ProfileMeta {
            id: "local".into(),
            kind: ProfileKind::Account,
            display_name: "A".into(),
            created_at: 1,
        };
        assert_eq!(
            serde_json::to_value(&meta).expect("serialize"),
            serde_json::json!({"id": "local", "kind": "account", "display_name": "A", "created_at": 1})
        );
    }

    #[test]
    fn state_naming_a_missing_profile_falls_back_to_local_and_is_rewritten() {
        let (_dir, profiles) = setup();
        let ghost = new_id();
        write_state_raw(&profiles, &format!(r#"{{"active_profile": "{ghost}"}}"#));
        let profile = profiles.open_active().expect("open");
        assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(state_json(&profiles)["active_profile"], "local");
    }

    #[test]
    fn state_naming_an_invalid_id_falls_back_to_local() {
        let (_dir, profiles) = setup();
        write_state_raw(&profiles, r#"{"active_profile": "../../etc"}"#);
        let profile = profiles.open_active().expect("open");
        assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(state_json(&profiles)["active_profile"], "local");
    }

    #[test]
    fn state_naming_a_corrupt_profile_falls_back_to_local_without_touching_it() {
        let (_dir, profiles) = setup();
        let account = profiles
            .create(ProfileKind::Account, "me@example.com")
            .expect("create");
        profiles.set_active(&account.meta.id).expect("activate");
        fs::write(account.meta_path(), b"{ broken").expect("corrupt");
        let profile = profiles.open_active().expect("open");
        assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(
            fs::read(account.meta_path()).expect("left alone"),
            b"{ broken"
        );
    }

    #[test]
    fn corrupt_state_falls_back_to_local_and_is_kept_aside() {
        let (_dir, profiles) = setup();
        write_state_raw(&profiles, "not json at all");
        let profile = profiles.open_active().expect("open");
        assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(state_json(&profiles)["active_profile"], "local");
        let kept: Vec<PathBuf> = fs::read_dir(profiles.root().root())
            .expect("read_dir")
            .map(|entry| entry.expect("entry").path())
            .filter(|path| fsutil::file_name_lossy(path).starts_with("state.json.corrupt-"))
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(fs::read(&kept[0]).expect("bytes"), b"not json at all");
    }

    #[test]
    fn missing_state_with_existing_profiles_reopens_local() {
        let (_dir, profiles) = setup();
        let first = profiles.open_active().expect("first");
        fs::remove_file(profiles.root().state_file()).expect("delete state");
        assert_eq!(profiles.open_active().expect("open"), first);
        assert_eq!(state_json(&profiles)["active_profile"], "local");
    }

    #[test]
    fn a_corrupt_local_profile_json_is_recreated_without_touching_the_data() {
        let (_dir, profiles) = setup();
        let local = profiles.open_active().expect("first");
        fs::write(local.db_path(), b"pretend database").expect("db");
        fs::write(local.meta_path(), b"{{{{").expect("corrupt");
        let repaired = profiles.open_active().expect("open");
        assert_eq!(repaired.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(
            fs::read(repaired.db_path()).expect("db kept"),
            b"pretend database"
        );
        let kept = fs::read_dir(&local.dir)
            .expect("read_dir")
            .map(|entry| entry.expect("entry").path())
            .any(|path| fsutil::file_name_lossy(&path).starts_with("profile.json.corrupt-"));
        assert!(kept, "the corrupt profile.json is kept aside");
    }

    fn corrupt_copies(dir: &Path, prefix: &str) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .expect("read_dir")
            .map(|entry| entry.expect("entry").path())
            .filter(|path| fsutil::file_name_lossy(path).starts_with(prefix))
            .collect()
    }

    #[test]
    fn a_file_where_the_local_profile_folder_should_be_is_moved_aside() {
        for with_state in [false, true] {
            let (_dir, profiles) = setup();
            profiles.root().ensure().expect("ensure");
            if with_state {
                write_state_raw(&profiles, r#"{"active_profile": "local"}"#);
            }
            let local_dir = profiles.root().profiles_dir().join(LOCAL_PROFILE_ID);
            fs::write(&local_dir, b"not a folder").expect("write");

            let profile = profiles.open_active().expect("open");
            assert_eq!(profile.meta.id, LOCAL_PROFILE_ID);
            assert!(profile.dir.is_dir());
            assert!(profile.logs_dir().is_dir());
            let kept = corrupt_copies(&profiles.root().profiles_dir(), "local.corrupt-");
            assert_eq!(kept.len(), 1, "with_state {with_state}: {kept:?}");
            assert_eq!(fs::read(&kept[0]).expect("kept"), b"not a folder");
            // The moved file is not mistaken for a profile.
            let ids: Vec<String> = profiles
                .list()
                .expect("list")
                .into_iter()
                .map(|meta| meta.id)
                .collect();
            assert_eq!(ids, vec![LOCAL_PROFILE_ID.to_string()]);
        }
    }

    #[test]
    fn files_where_profile_subfolders_should_be_are_moved_aside() {
        let (_dir, profiles) = setup();
        let local = profiles.open_active().expect("first");
        fs::write(local.db_path(), b"the database").expect("db");
        let subdirs = [
            local.attachments_dir(),
            local.checkpoints_dir(),
            local.logs_dir(),
            local.backups_dir(),
        ];
        for dir in &subdirs {
            fs::remove_dir_all(dir).expect("remove");
            fs::write(dir, b"stray").expect("write a file in its place");
        }
        let reopened = profiles.open_active().expect("open");
        assert_eq!(reopened, local);
        for dir in &subdirs {
            assert!(dir.is_dir(), "{}", dir.display());
            let name = format!("{}.corrupt-", fsutil::file_name_lossy(dir));
            let kept = corrupt_copies(&local.dir, &name);
            assert_eq!(kept.len(), 1, "{name}: {kept:?}");
            assert_eq!(fs::read(&kept[0]).expect("kept"), b"stray");
        }
        assert_eq!(
            fs::read(local.db_path()).expect("db untouched"),
            b"the database"
        );
    }

    #[test]
    fn a_file_in_place_of_a_subfolder_is_moved_aside_when_activating_a_profile() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "work")
            .expect("create");
        fs::remove_dir_all(account.attachments_dir()).expect("remove");
        fs::write(account.attachments_dir(), b"stray").expect("write");
        let activated = profiles.set_active(&account.meta.id).expect("activate");
        assert!(activated.attachments_dir().is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_state_json_falls_back_to_local_and_is_left_alone() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "work")
            .expect("create");
        profiles.set_active(&account.meta.id).expect("activate");
        let state = profiles.root().state_file();
        let before = fs::read(&state).expect("state.json");
        fs::set_permissions(&state, fs::Permissions::from_mode(0o000)).expect("chmod");
        if fs::read(&state).is_ok() {
            eprintln!("skipping: file permissions are not enforced for this user");
            return;
        }
        let opened = profiles.open_active();
        fs::set_permissions(&state, fs::Permissions::from_mode(0o600)).expect("chmod back");
        assert_eq!(opened.expect("open").meta.id, LOCAL_PROFILE_ID);
        assert_eq!(fs::read(&state).expect("kept"), before, "left as it was");
        assert!(corrupt_copies(profiles.root().root(), "state.json.corrupt-").is_empty());
        // Readable again: the user's choice is back.
        assert_eq!(profiles.open_active().expect("open"), account);
    }

    #[test]
    fn missing_subdirectories_are_recreated_on_open() {
        let (_dir, profiles) = setup();
        let local = profiles.open_active().expect("first");
        fs::remove_dir_all(local.logs_dir()).expect("remove logs");
        let reopened = profiles.open_active().expect("open");
        assert!(reopened.logs_dir().is_dir());
    }

    #[test]
    fn created_account_profiles_are_listed() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "  me@example.com  ")
            .expect("create");
        assert_eq!(account.meta.kind, ProfileKind::Account);
        assert_eq!(account.meta.display_name, "me@example.com");
        assert!(validate_profile_id(&account.meta.id).is_ok());
        assert_eq!(
            uuid::Uuid::parse_str(&account.meta.id)
                .expect("uuid")
                .get_version_num(),
            7
        );
        assert!(account.backups_dir().is_dir());

        let listed = profiles.list().expect("list");
        let ids: Vec<&str> = listed.iter().map(|meta| meta.id.as_str()).collect();
        assert_eq!(ids, vec![LOCAL_PROFILE_ID, account.meta.id.as_str()]);
        assert_eq!(listed[1], account.meta);
    }

    #[test]
    fn create_local_uses_local_once_then_uuids() {
        let (_dir, profiles) = setup();
        let first = profiles.create(ProfileKind::Local, "").expect("first");
        assert_eq!(first.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(first.meta.display_name, "Local");
        let second = profiles
            .create(ProfileKind::Local, "Kept from old account")
            .expect("second");
        assert_ne!(second.meta.id, LOCAL_PROFILE_ID);
        assert_eq!(second.meta.kind, ProfileKind::Local);
        let blank_account = profiles
            .create(ProfileKind::Account, "   ")
            .expect("account");
        assert_eq!(blank_account.meta.display_name, "Account");
    }

    #[test]
    fn set_active_persists_across_instances() {
        let (dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "work")
            .expect("create");
        let activated = profiles.set_active(&account.meta.id).expect("activate");
        assert_eq!(activated, account);

        let fresh = Profiles::new(DataRoot::at(dir.path().join("aura")));
        assert_eq!(fresh.open_active().expect("open"), account);
    }

    #[test]
    fn set_active_keeps_unknown_state_fields() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "work")
            .expect("create");
        write_state_raw(
            &profiles,
            r#"{"active_profile": "local", "window": {"w": 900}}"#,
        );
        profiles.set_active(&account.meta.id).expect("activate");
        let state = state_json(&profiles);
        assert_eq!(state["active_profile"], account.meta.id.as_str());
        assert_eq!(state["window"]["w"], 900);
    }

    #[test]
    fn set_active_rejects_traversal() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let before = fs::read(profiles.root().state_file()).expect("state");
        assert!(
            matches!(profiles.set_active("../evil"), Err(CoreError::InvalidProfileId(ref id)) if id == "../evil")
        );
        assert_eq!(
            fs::read(profiles.root().state_file()).expect("state"),
            before
        );
    }

    #[test]
    fn set_active_on_a_missing_profile_is_not_found() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let ghost = new_id();
        assert!(
            matches!(profiles.set_active(&ghost), Err(CoreError::ProfileNotFound(ref id)) if *id == ghost)
        );
        assert_eq!(state_json(&profiles)["active_profile"], "local");
    }

    #[test]
    fn list_skips_unusable_profile_dirs() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let good = profiles.create(ProfileKind::Account, "good").expect("good");
        let bad = profiles.create(ProfileKind::Account, "bad").expect("bad");
        fs::write(bad.meta_path(), b"\x00\x01 not json").expect("corrupt");

        let profiles_dir = profiles.root().profiles_dir();
        fs::create_dir(profiles_dir.join("Not-Valid")).expect("bad name");
        fs::create_dir(profiles_dir.join("emptyprofile")).expect("no profile.json");
        fs::write(profiles_dir.join(".DS_Store"), b"x").expect("stray file");
        // A profile.json copied into the wrong folder.
        let copied = profiles_dir.join("copied");
        fs::create_dir(&copied).expect("mkdir");
        fs::copy(good.meta_path(), copied.join("profile.json")).expect("copy");

        let ids: Vec<String> = profiles
            .list()
            .expect("list")
            .into_iter()
            .map(|meta| meta.id)
            .collect();
        assert_eq!(ids, vec![LOCAL_PROFILE_ID.to_string(), good.meta.id]);
    }

    #[test]
    fn list_orders_local_first_then_other_local_then_accounts() {
        let (_dir, profiles) = setup();
        // Created in the "wrong" order, and fast enough that creation times collide.
        let account_a = profiles
            .create(ProfileKind::Account, "a")
            .expect("account a");
        let first_local = profiles
            .create(ProfileKind::Local, "")
            .expect("first local");
        let second_local = profiles
            .create(ProfileKind::Local, "kept")
            .expect("second local");
        let account_b = profiles
            .create(ProfileKind::Account, "b")
            .expect("account b");
        assert_eq!(
            first_local.meta.id, LOCAL_PROFILE_ID,
            "the first Local profile takes the id `local`"
        );
        let ids: Vec<String> = profiles
            .list()
            .expect("list")
            .into_iter()
            .map(|meta| meta.id)
            .collect();
        assert_eq!(
            ids,
            vec![
                first_local.meta.id,
                second_local.meta.id,
                account_a.meta.id,
                account_b.meta.id
            ]
        );
    }

    #[test]
    fn list_of_a_fresh_root_is_empty() {
        let (_dir, profiles) = setup();
        assert!(profiles.list().expect("list").is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn list_skips_an_unreadable_profile_dir() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let locked = profiles
            .create(ProfileKind::Account, "locked")
            .expect("create");
        fs::set_permissions(&locked.dir, fs::Permissions::from_mode(0o000)).expect("chmod");
        let enforced = fs::read(locked.meta_path()).is_err();
        let listed = profiles.list();
        // Restore before asserting so the temp dir can always be cleaned up.
        fs::set_permissions(&locked.dir, fs::Permissions::from_mode(0o700)).expect("chmod back");
        if !enforced {
            eprintln!("skipping: directory permissions are not enforced for this user");
            return;
        }
        let ids: Vec<String> = listed
            .expect("list")
            .into_iter()
            .map(|meta| meta.id)
            .collect();
        assert_eq!(ids, vec![LOCAL_PROFILE_ID.to_string()]);
    }

    #[test]
    fn get_distinguishes_missing_invalid_and_corrupt() {
        let (_dir, profiles) = setup();
        let local = profiles.open_active().expect("bootstrap");
        assert_eq!(profiles.get(LOCAL_PROFILE_ID).expect("get"), local);
        assert!(matches!(
            profiles.get("nope"),
            Err(CoreError::ProfileNotFound(_))
        ));
        assert!(matches!(
            profiles.get("NOPE"),
            Err(CoreError::InvalidProfileId(_))
        ));
        fs::write(local.meta_path(), b"[]").expect("corrupt");
        assert!(matches!(
            profiles.get(LOCAL_PROFILE_ID),
            Err(CoreError::Json { .. })
        ));
    }

    #[test]
    fn state_json_with_a_bom_is_accepted() {
        let (_dir, profiles) = setup();
        profiles.open_active().expect("bootstrap");
        let account = profiles
            .create(ProfileKind::Account, "work")
            .expect("create");
        write_state_raw(
            &profiles,
            &format!("\u{feff}{{\"active_profile\": \"{}\"}}", account.meta.id),
        );
        assert_eq!(profiles.open_active().expect("open"), account);
    }
}
