//! Live-agent bookkeeping: the cap on live agents, and one live process per native session across
//! chats.
//!
//! A chat holds a slot from the moment its start begins (preparation included) until its driver
//! ended and the processes a force stop or a crash kills are gone, so a 13th start fails at once
//! instead of evicting anything. A native session is claimed for the resume id before spawning and
//! again for the id the agent returns at `Ready`, and stays claimed as long as the slot: two
//! processes on one session interleave one transcript (the Claude spike), so the second chat is
//! refused.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use aura_process::{EnvKey, LaunchSpec, ProcessCwd, ResolvedEnv};

/// Native and ACP transports use the same provider's transcript store. The namespace also
/// includes its host and configuration directory, because another realm can reuse the same id.
/// All current launches are local; a future remote launcher must supply its host realm here.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct NativeSessionScope {
    provider: String,
    host: String,
    config_dir: Option<PathBuf>,
}

impl NativeSessionScope {
    pub(crate) fn local(
        agent_id: &str,
        device_id: &str,
        env: &ResolvedEnv,
        launch: &LaunchSpec,
        folder: &Path,
    ) -> Self {
        let (provider, config) = match agent_id {
            "claude" | "claude-acp" => ("claude", Some(("CLAUDE_CONFIG_DIR", ".claude"))),
            "codex" | "codex-acp" => ("codex", Some(("CODEX_HOME", ".codex"))),
            "opencode" | "opencode-v2" => ("opencode", None),
            "antigravity" | "agy-stream" => ("antigravity", None),
            "grok" | "grok-stream" => ("grok", None),
            other => (other, None),
        };
        // Only configuration-path variables are consulted. Credential files and values are
        // neither inspected nor added to the claim key.
        let variable = |name: &str| -> Option<OsString> {
            let key = EnvKey::from(name);
            launch
                .set_env
                .iter()
                .rev()
                .find(|(name, _)| EnvKey::from(name.as_os_str()) == key)
                .map(|(_, value)| value.clone())
                .or_else(|| env.vars.get(&key).cloned())
                .filter(|value| !value.is_empty())
        };
        let config_dir = config.and_then(|(override_name, default)| {
            let home = if cfg!(windows) {
                variable("USERPROFILE").or_else(|| variable("HOME"))
            } else {
                variable("HOME")
            };
            variable(override_name)
                .map(PathBuf::from)
                .or_else(|| home.map(|home| PathBuf::from(home).join(default)))
                .map(|path| {
                    // ACP's Node launcher runs in its installation directory, but the native
                    // CLI it creates uses the session's chat folder.
                    let cwd = if matches!(agent_id, "claude-acp" | "codex-acp") {
                        folder
                    } else {
                        match &launch.cwd {
                            ProcessCwd::ChatFolder => folder,
                            ProcessCwd::Fixed(cwd) => cwd,
                        }
                    };
                    normalize_path(if path.is_absolute() {
                        path
                    } else {
                        cwd.join(path)
                    })
                })
        });
        Self {
            provider: provider.into(),
            host: device_id.into(),
            config_dir,
        }
    }
}

/// Resolve directory aliases using metadata only. A new configuration directory may not exist
/// yet, so resolve its nearest existing ancestor before normalizing the remaining components.
/// No provider configuration or credential file is read.
pub(super) fn normalize_path(path: PathBuf) -> PathBuf {
    let path = path
        .ancestors()
        .find_map(|ancestor| {
            std::fs::canonicalize(ancestor)
                .ok()
                .and_then(|root| path.strip_prefix(ancestor).ok().map(|tail| root.join(tail)))
        })
        .unwrap_or(path);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    #[cfg(windows)]
    {
        fold_windows_path(normalized)
    }
    #[cfg(not(windows))]
    {
        normalized
    }
}

/// Claim keys conservatively treat Windows paths as case insensitive, including a not-yet-created
/// suffix. Windows' invariant casing preserves UTF-16 paths without a lossy UTF-8 conversion.
#[cfg(windows)]
#[allow(unsafe_code)] // The OS casing API has no safe standard-library equivalent.
fn fold_windows_path(path: PathBuf) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Globalization::{
        LCMAP_UPPERCASE, LCMapStringEx, LOCALE_NAME_INVARIANT,
    };

    let source = path.as_os_str().encode_wide().collect::<Vec<_>>();
    let Ok(length) = i32::try_from(source.len()) else {
        return path;
    };
    // SAFETY: the source is live for both calls, its length is explicit, and the first call only
    // queries the required output length. Optional NLS arguments are null.
    let required = unsafe {
        LCMapStringEx(
            LOCALE_NAME_INVARIANT,
            LCMAP_UPPERCASE,
            source.as_ptr(),
            length,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            std::ptr::null(),
            0,
        )
    };
    if required <= 0 {
        let mut fallback = path.into_os_string();
        fallback.make_ascii_uppercase();
        return fallback.into();
    }
    let mut output = vec![0_u16; required as usize];
    // SAFETY: the output buffer has the length returned above, and neither buffer is moved or
    // mutated for the duration of the call.
    let written = unsafe {
        LCMapStringEx(
            LOCALE_NAME_INVARIANT,
            LCMAP_UPPERCASE,
            source.as_ptr(),
            length,
            output.as_mut_ptr(),
            required,
            std::ptr::null(),
            std::ptr::null(),
            0,
        )
    };
    if written <= 0 {
        return path;
    }
    output.truncate(written as usize);
    OsString::from_wide(&output).into()
}

/// The live agents of every chat.
#[derive(Debug)]
pub(crate) struct LiveAgents {
    max: usize,
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    quiescing: bool,
    maintenance: usize,
    owned_draining: bool,
    slots: HashSet<String>,
    folders: HashMap<String, Vec<PathBuf>>,
    mutations: HashSet<PathBuf>,
    folder_uses: HashMap<PathBuf, usize>,
    /// `(provider realm, native_session_id)` -> the chat holding it.
    sessions: HashMap<(NativeSessionScope, String), String>,
}

pub(crate) struct MaintenanceGuard<'a>(&'a LiveAgents);
impl Drop for MaintenanceGuard<'_> {
    fn drop(&mut self) {
        self.0.end_maintenance();
    }
}

impl LiveAgents {
    pub(crate) fn new(max: usize) -> LiveAgents {
        LiveAgents {
            max,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes a slot for `chat` (idempotent); false when every slot is taken.
    pub(crate) fn acquire(&self, chat: &str) -> bool {
        let mut inner = self.lock();
        if inner.quiescing || inner.owned_draining {
            return false;
        }
        if inner.slots.contains(chat) {
            return true;
        }
        if inner.slots.len() >= self.max {
            return false;
        }
        inner.slots.insert(chat.to_owned());
        true
    }

    pub(crate) fn quiescing(&self) -> bool {
        let inner = self.lock();
        inner.quiescing || inner.owned_draining
    }

    /// Atomically excludes new starts and folder mutations while the caller prepares an update.
    pub(crate) fn try_quiesce(&self) -> bool {
        let mut inner = self.lock();
        if inner.quiescing
            || inner.owned_draining
            || inner.maintenance > 0
            || !inner.slots.is_empty()
            || !inner.mutations.is_empty()
            || !inner.folder_uses.is_empty()
        {
            return false;
        }
        inner.quiescing = true;
        true
    }

    pub(crate) fn resume_admission(&self) {
        self.lock().quiescing = false;
    }

    pub(crate) fn try_maintenance(&self) -> Option<MaintenanceGuard<'_>> {
        self.begin_maintenance().then(|| MaintenanceGuard(self))
    }

    pub(crate) fn begin_maintenance(&self) -> bool {
        let mut inner = self.lock();
        if inner.quiescing || inner.owned_draining {
            return false;
        }
        let Some(count) = inner.maintenance.checked_add(1) else {
            return false;
        };
        inner.maintenance = count;
        true
    }

    pub(crate) fn end_maintenance(&self) {
        self.lock().maintenance -= 1;
    }

    pub(crate) fn begin_owned_drain(&self) -> bool {
        let mut inner = self.lock();
        if inner.owned_draining || inner.quiescing {
            return false;
        }
        inner.owned_draining = true;
        true
    }

    pub(crate) fn end_owned_drain(&self) {
        self.lock().owned_draining = false;
    }

    pub(crate) fn owned_work_count(&self) -> usize {
        let inner = self.lock();
        inner.maintenance.saturating_add(inner.mutations.len())
    }

    pub(crate) fn project_terminal_count(&self) -> usize {
        self.lock().folder_uses.values().sum()
    }

    /// Gives `chat`'s slot back, and every native session it held.
    pub(crate) fn release(&self, chat: &str) {
        let mut inner = self.lock();
        inner.slots.remove(chat);
        inner.folders.remove(chat);
        inner.sessions.retain(|_, holder| holder != chat);
    }

    /// Claims a native session for `chat`; false when another chat holds it.
    pub(crate) fn claim(
        &self,
        scope: &NativeSessionScope,
        native_session_id: &str,
        chat: &str,
    ) -> bool {
        let mut inner = self.lock();
        // UUID spelling (case, hyphens) must not create another claim for one native transcript.
        // Non-UUID IDs remain opaque for providers with a different identifier format.
        let identity = uuid::Uuid::parse_str(native_session_id)
            .map(|id| id.to_string())
            .unwrap_or_else(|_| native_session_id.to_owned());
        let key = (scope.clone(), identity);
        match inner.sessions.get(&key) {
            Some(holder) if holder != chat => false,
            _ => {
                inner.sessions.insert(key, chat.to_owned());
                true
            }
        }
    }

    pub(crate) fn count(&self) -> usize {
        self.lock().slots.len()
    }

    pub(crate) fn contains(&self, chat: &str) -> bool {
        self.lock().slots.contains(chat)
    }

    /// Canonical folder registration is atomic with revert reservations, before native spawn.
    #[cfg(test)]
    pub(crate) fn set_folder(&self, chat: &str, folder: PathBuf) -> bool {
        self.set_folders(chat, vec![folder])
    }
    pub(crate) fn set_folders(&self, chat: &str, folders: Vec<PathBuf>) -> bool {
        let mut inner = self.lock();
        if folders.is_empty()
            || folders.iter().any(|folder| {
                inner
                    .mutations
                    .iter()
                    .any(|held| folder.starts_with(held) || held.starts_with(folder))
            })
        {
            return false;
        }
        inner.folders.insert(chat.into(), folders);
        true
    }

    pub(crate) fn reserve_folder(&self, folder: &Path) -> bool {
        let mut inner = self.lock();
        if inner.quiescing
            || inner.owned_draining
            || inner
                .folder_uses
                .keys()
                .any(|held| folder.starts_with(held) || held.starts_with(folder))
            || inner
                .mutations
                .iter()
                .any(|held| folder.starts_with(held) || held.starts_with(folder))
            || inner.slots.iter().any(|chat| {
                inner.folders.get(chat).is_none_or(|held| {
                    held.iter()
                        .any(|held| folder.starts_with(held) || held.starts_with(folder))
                })
            })
        {
            return false;
        }
        inner.mutations.insert(folder.into());
        true
    }

    pub(crate) fn release_folder(&self, folder: &Path) {
        self.lock().mutations.remove(folder);
    }

    /// A terminal can share a folder with agents, but cannot race destructive folder operations.
    pub(crate) fn begin_folder_use(&self, folder: PathBuf) -> bool {
        let mut inner = self.lock();
        if inner.quiescing
            || inner.owned_draining
            || inner
                .mutations
                .iter()
                .any(|held| folder.starts_with(held) || held.starts_with(&folder))
        {
            return false;
        }
        let count = inner.folder_uses.entry(folder).or_default();
        let Some(next) = count.checked_add(1) else {
            return false;
        };
        *count = next;
        true
    }

    pub(crate) fn end_folder_use(&self, folder: &Path) {
        let mut inner = self.lock();
        if let Some(count) = inner.folder_uses.get_mut(folder) {
            *count -= 1;
            if *count == 0 {
                inner.folder_uses.remove(folder);
            }
        }
    }

    pub(crate) fn max(&self) -> usize {
        self.max
    }
}

#[cfg(test)]
mod tests {
    use aura_process::{EnvMap, EnvSource};
    use std::time::Duration;

    use super::*;

    #[test]
    fn project_terminal_shares_agents_but_excludes_overlapping_mutations_and_idle_barriers() {
        let live = LiveAgents::new(12);
        let folder = PathBuf::from("/fixture/project");
        assert!(live.acquire("agent"));
        assert!(live.set_folder("agent", folder.clone()));
        assert!(live.begin_folder_use(folder.clone()));
        assert!(live.begin_folder_use(folder.join("child")));
        assert_eq!(live.project_terminal_count(), 2);
        assert_eq!(live.owned_work_count(), 0);
        assert!(live.acquire("second"));
        assert!(live.set_folder("second", folder.clone()));
        live.release("agent");
        live.release("second");
        assert!(!live.reserve_folder(&folder));
        assert!(!live.reserve_folder(Path::new("/fixture")));
        assert!(!live.reserve_folder(&folder.join("child/deeper")));
        assert!(!live.try_quiesce());
        live.end_folder_use(&folder);
        assert!(!live.reserve_folder(&folder));
        live.end_folder_use(&folder.join("child"));
        assert!(live.reserve_folder(&folder));
        assert!(!live.begin_folder_use(folder.join("child")));
        live.release_folder(&folder);
        assert!(live.try_quiesce());
        assert!(!live.begin_folder_use(folder.clone()));
        live.resume_admission();
        assert!(live.begin_owned_drain());
        assert!(!live.begin_folder_use(folder));
    }

    #[test]
    fn update_quiesce_excludes_agent_starts_and_git_mutations_atomically() {
        let live = LiveAgents::new(12);
        let folder = Path::new("/fixture");
        assert!(live.acquire("one"));
        assert!(!live.try_quiesce());
        live.release("one");
        assert!(live.reserve_folder(folder));
        assert!(!live.try_quiesce());
        live.release_folder(folder);
        assert!(live.try_quiesce());
        assert!(!live.try_quiesce());
        assert!(!live.begin_owned_drain());
        assert!(!live.acquire("two"));
        assert!(!live.reserve_folder(folder));
        live.resume_admission();
        assert!(live.acquire("two"));
    }

    #[test]
    fn racing_start_and_update_cannot_both_be_admitted() {
        for _ in 0..32 {
            let live = LiveAgents::new(12);
            let barrier = std::sync::Barrier::new(2);
            std::thread::scope(|scope| {
                let start = scope.spawn(|| {
                    barrier.wait();
                    live.acquire("racing")
                });
                barrier.wait();
                let update = live.try_quiesce();
                assert_ne!(start.join().unwrap(), update);
            });
        }
    }

    #[test]
    fn vendor_maintenance_blocks_application_update_until_its_owner_finishes() {
        let live = LiveAgents::new(12);
        let first = live.try_maintenance().unwrap();
        let second = live.try_maintenance().unwrap();
        assert!(!live.try_quiesce());
        drop(first);
        assert!(!live.try_quiesce());
        drop(second);
        assert!(live.try_quiesce());
        assert!(live.try_maintenance().is_none());
        live.resume_admission();
        assert!(live.try_maintenance().is_some());
    }

    #[test]
    fn owned_terminal_maintenance_stays_counted_during_quit_and_preserves_session_cap() {
        let live = LiveAgents::new(1);
        assert!(live.begin_maintenance());
        assert!(live.acquire("one"));
        assert!(!live.acquire("two"));
        assert_eq!(live.owned_work_count(), 1);
        assert!(live.begin_owned_drain());
        assert!(!live.begin_maintenance());
        assert!(live.try_maintenance().is_none());
        assert_eq!(live.owned_work_count(), 1);
        live.end_maintenance();
        assert_eq!(live.owned_work_count(), 0);
        live.end_owned_drain();
        live.release("one");
        assert!(live.try_quiesce());
    }

    #[test]
    fn quit_drain_waits_existing_owners_and_blocks_new_work_until_released() {
        let live = LiveAgents::new(4);
        let maintenance = live.try_maintenance().unwrap();
        let folder = Path::new("owned-folder");
        assert!(live.reserve_folder(folder));
        assert!(live.begin_owned_drain());
        let drain = super::super::OwnedWorkDrain { live: &live };
        assert!(!live.begin_owned_drain());
        assert_eq!(live.owned_work_count(), 2);
        assert!(live.try_maintenance().is_none());
        assert!(!live.reserve_folder(Path::new("new-folder")));
        assert!(!live.acquire("new-chat"));
        assert!(!live.try_quiesce());
        drop(maintenance);
        assert_eq!(live.owned_work_count(), 1);
        live.release_folder(folder);
        assert_eq!(live.owned_work_count(), 0);
        drop(drain);
        assert!(live.try_maintenance().is_some());
        assert!(live.acquire("new-chat"));
    }

    #[test]
    fn folder_mutation_reservation_excludes_live_agents_and_late_starts() {
        let live = LiveAgents::new(4);
        let folder = PathBuf::from("/target");
        assert!(live.acquire("starting"));
        assert!(
            !live.reserve_folder(&folder),
            "an unresolved startup may target this folder"
        );
        assert!(live.set_folder("starting", PathBuf::from("/other")));
        assert!(
            live.reserve_folder(&folder),
            "an unrelated running folder is allowed"
        );
        assert!(live.acquire("later"));
        assert!(
            !live.set_folder("later", folder.clone()),
            "a later start cannot spawn in a reserved folder"
        );
        live.release("later");
        live.release_folder(&folder);
        assert!(live.acquire("target"));
        assert!(live.set_folder("target", folder.clone()));
        assert!(!live.reserve_folder(&folder));
        live.release("target");
        assert!(live.reserve_folder(&folder));
    }

    fn scope(agent: &str, host: &str, vars: &[(&str, &str)]) -> NativeSessionScope {
        let env = ResolvedEnv {
            vars: vars
                .iter()
                .map(|(name, value)| (EnvKey::from(*name), (*value).into()))
                .collect::<EnvMap>(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        NativeSessionScope::local(agent, host, &env, &launch(), Path::new("/work"))
    }

    fn launch() -> LaunchSpec {
        LaunchSpec {
            label: "test".into(),
            program: "agent".into(),
            args: Vec::new(),
            cwd: ProcessCwd::ChatFolder,
            set_env: Vec::new(),
            daemons: Vec::new(),
            startup_timeout: Duration::from_secs(60),
        }
    }

    #[test]
    fn slots_are_capped_and_idempotent() {
        let live = LiveAgents::new(2);
        assert!(live.acquire("a"));
        assert!(live.acquire("a"), "the same chat again");
        assert!(live.acquire("b"));
        assert!(!live.acquire("c"), "nothing is evicted to make room");
        assert_eq!(live.count(), 2);
        live.release("a");
        assert!(live.acquire("c"));
    }

    #[test]
    fn a_native_session_belongs_to_one_chat() {
        let live = LiveAgents::new(12);
        let claude = scope("claude-acp", "local", &[]);
        assert!(live.claim(&claude, "s1", "a"));
        assert!(live.claim(&claude, "s1", "a"), "its own claim");
        assert!(!live.claim(&claude, "s1", "b"));
        assert!(
            live.claim(&scope("codex-acp", "local", &[]), "s1", "b"),
            "another agent's id space"
        );
        live.release("a");
        assert!(live.claim(&claude, "s1", "b"));
    }

    #[test]
    fn uuid_spelling_does_not_create_another_native_session() {
        let live = LiveAgents::new(12);
        let claude = scope("claude", "local", &[]);
        assert!(live.claim(&claude, "019abcde-0000-7000-8000-000000000001", "one"));
        assert!(!live.claim(&claude, "019ABCDE000070008000000000000001", "two"));
        assert!(live.claim(&claude, "s1", "one"));
        assert!(
            live.claim(&claude, "S1", "two"),
            "other identifiers stay opaque"
        );
    }

    #[test]
    fn native_and_acp_aliases_share_claims_in_both_directions() {
        for (native, acp) in [
            ("claude", "claude-acp"),
            ("codex", "codex-acp"),
            ("opencode", "opencode-v2"),
            ("antigravity", "agy-stream"),
            ("grok", "grok-stream"),
        ] {
            for (first, second) in [(native, acp), (acp, native)] {
                let live = LiveAgents::new(12);
                assert!(live.claim(&scope(first, "local", &[]), "s1", "a"));
                assert!(!live.claim(&scope(second, "local", &[]), "s1", "b"));
                live.release("a");
                assert!(live.claim(&scope(second, "local", &[]), "s1", "b"));
            }
        }
    }

    #[test]
    fn host_and_configuration_realms_keep_separate_native_id_spaces() {
        for (provider, variable) in [("claude", "CLAUDE_CONFIG_DIR"), ("codex", "CODEX_HOME")] {
            let live = LiveAgents::new(12);
            assert!(live.claim(
                &scope(provider, "local", &[(variable, "/config/one")]),
                "s1",
                "a"
            ));
            assert!(live.claim(
                &scope(provider, "remote", &[(variable, "/config/one")]),
                "s1",
                "b"
            ));
            assert!(live.claim(
                &scope(provider, "local", &[(variable, "/config/two")]),
                "s1",
                "c"
            ));
            assert!(!live.claim(
                &scope(provider, "local", &[(variable, "/config/./one")]),
                "s1",
                "d"
            ));
        }
    }

    #[test]
    fn launch_overrides_and_default_home_resolve_the_configuration_realm() {
        let env = ResolvedEnv {
            vars: [
                (EnvKey::from("HOME"), "/users/me".into()),
                (EnvKey::from("USERPROFILE"), "/users/me".into()),
            ]
            .into(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        let mut launch = launch();
        let default =
            NativeSessionScope::local("claude", "local", &env, &launch, Path::new("/work"));
        launch
            .set_env
            .push(("CLAUDE_CONFIG_DIR".into(), "/users/me/.claude".into()));
        assert_eq!(
            default,
            NativeSessionScope::local("claude-acp", "local", &env, &launch, Path::new("/work"))
        );
        launch
            .set_env
            .push(("CLAUDE_CONFIG_DIR".into(), "/separate".into()));
        assert_ne!(
            default,
            NativeSessionScope::local("claude", "local", &env, &launch, Path::new("/work"))
        );
    }

    #[test]
    fn relative_configuration_roots_use_the_native_clis_folder_for_acp() {
        let env = ResolvedEnv {
            vars: [(EnvKey::from("CLAUDE_CONFIG_DIR"), "config".into())].into(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        let mut launch = launch();
        let native =
            NativeSessionScope::local("claude", "local", &env, &launch, Path::new("/work"));
        launch.cwd = ProcessCwd::Fixed("/adapter".into());
        assert_eq!(
            native,
            NativeSessionScope::local("claude-acp", "local", &env, &launch, Path::new("/work"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_case_aliases_cannot_claim_the_same_native_session_twice() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("Répo");
        std::fs::create_dir(&folder).unwrap();
        let env = ResolvedEnv {
            vars: [(EnvKey::from("CLAUDE_CONFIG_DIR"), "NewConfig".into())].into(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        let first = NativeSessionScope::local("claude", "local", &env, &launch(), &folder);
        let alias = PathBuf::from(folder.to_str().unwrap().to_uppercase());
        let second = NativeSessionScope::local("claude-acp", "local", &env, &launch(), &alias);
        let live = LiveAgents::new(12);
        assert!(live.claim(&first, "session", "one"));
        assert!(!live.claim(&second, "session", "two"));
        assert_eq!(
            normalize_path(folder.join("NEWCONFIG")),
            first.config_dir.unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn directory_symlinks_share_a_claim_but_distinct_case_sensitive_paths_do_not() {
        let temp = tempfile::tempdir().unwrap();
        let real = temp.path().join("real");
        let alias = temp.path().join("alias");
        std::fs::create_dir(&real).unwrap();
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        assert_eq!(
            normalize_path(real.join("new")),
            normalize_path(alias.join("new"))
        );
        assert_ne!(
            normalize_path(real.join("New")),
            normalize_path(real.join("new"))
        );
    }
}
