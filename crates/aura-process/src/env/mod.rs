//! The environment agents start with.
//!
//! Finder and the Dock start apps with launchd's bare `PATH`, so on macOS and Linux the env comes
//! from the user's login shell (`$SHELL -i -l -c` with nonce markers and `env -0`, in a new session,
//! 10 s; then `-l -c`, 5 s; then a fallback), and on Windows from the registry (HKLM, then HKCU). It
//! is resolved in the background at boot, shared by every caller, and kept in memory only: it holds
//! API keys, so it never reaches disk.
//!
//! Every child then gets [`child_env`]: the resolved env, minus the scrub's denylist ([`scrub`]),
//! plus the spawn's own `set` entries. Values are never logged; reports carry names only.

mod scrub;
mod shell;
mod which;
mod windows;

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::runtime::Handle;

use crate::registry::LeftoverRegistry;

pub use scrub::{DenyReason, ScrubReport, deny_reason, node_options_has_debugger_hook, scrub};
pub use shell::parse_env0;
pub use which::{find_exe, find_program};
pub use windows::{expand_env_strings, merge_windows_path};

/// An environment variable name. `Eq`, `Ord` and `Hash` ignore ASCII case on Windows, where
/// `Path` and `PATH` are one variable; elsewhere names compare exactly.
#[derive(Clone)]
pub struct EnvKey(OsString);

impl EnvKey {
    pub fn new(name: impl Into<OsString>) -> EnvKey {
        EnvKey(name.into())
    }

    pub fn as_os_str(&self) -> &OsStr {
        &self.0
    }

    pub fn into_os_string(self) -> OsString {
        self.0
    }

    /// The name as compared: ASCII-uppercased on Windows.
    fn folded(&self) -> impl Iterator<Item = u8> + '_ {
        self.0.as_encoded_bytes().iter().map(|byte| {
            if cfg!(windows) {
                byte.to_ascii_uppercase()
            } else {
                *byte
            }
        })
    }
}

impl PartialEq for EnvKey {
    fn eq(&self, other: &EnvKey) -> bool {
        self.folded().eq(other.folded())
    }
}

impl Eq for EnvKey {}

impl PartialOrd for EnvKey {
    fn partial_cmp(&self, other: &EnvKey) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for EnvKey {
    fn cmp(&self, other: &EnvKey) -> Ordering {
        self.folded().cmp(other.folded())
    }
}

impl Hash for EnvKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for byte in self.folded() {
            state.write_u8(byte);
        }
    }
}

impl fmt::Debug for EnvKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}

impl From<&str> for EnvKey {
    fn from(name: &str) -> EnvKey {
        EnvKey(name.into())
    }
}

impl From<String> for EnvKey {
    fn from(name: String) -> EnvKey {
        EnvKey(name.into())
    }
}

impl From<OsString> for EnvKey {
    fn from(name: OsString) -> EnvKey {
        EnvKey(name)
    }
}

impl From<&OsStr> for EnvKey {
    fn from(name: &OsStr) -> EnvKey {
        EnvKey(name.to_os_string())
    }
}

/// A complete environment, by name.
pub type EnvMap = BTreeMap<EnvKey, OsString>;

/// A resolved environment. `Debug` prints names only: values hold API keys.
#[derive(Clone)]
pub struct ResolvedEnv {
    pub vars: EnvMap,
    pub source: EnvSource,
    pub warnings: Vec<String>,
    pub resolved_at_ms: i64,
}

impl fmt::Debug for ResolvedEnv {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResolvedEnv")
            .field("vars", &self.vars.keys().collect::<Vec<_>>())
            .field("source", &self.source)
            .field("warnings", &self.warnings)
            .field("resolved_at_ms", &self.resolved_at_ms)
            .finish()
    }
}

/// Where a [`ResolvedEnv`] came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvSource {
    LoginShell {
        shell: PathBuf,
        /// `-i -l` worked; false after the `-l` retry.
        interactive: bool,
        took_ms: u64,
    },
    WindowsRegistry,
    /// auracode's own env plus the known dirs, because the shell failed.
    Fallback {
        reason: String,
    },
}

/// How the resolver runs. `None` fields take the user's real values (tests set them).
#[derive(Clone)]
pub struct EnvResolverConfig {
    /// The interactive login shell's limit.
    pub timeout: Duration,
    /// The non-interactive retry's limit.
    pub retry_timeout: Duration,
    /// A failed attempt older than this is retried on the next `get`.
    pub retry_after: Duration,
    pub shell: Option<PathBuf>,
    /// The shell's input env instead of auracode's own.
    pub base: Option<EnvMap>,
    pub home: Option<PathBuf>,
    pub known_dirs: Option<Vec<PathBuf>>,
}

/// Prints `base` names only: values hold API keys.
impl fmt::Debug for EnvResolverConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EnvResolverConfig")
            .field("timeout", &self.timeout)
            .field("retry_timeout", &self.retry_timeout)
            .field("retry_after", &self.retry_after)
            .field("shell", &self.shell)
            .field(
                "base",
                &self
                    .base
                    .as_ref()
                    .map(|base| base.keys().collect::<Vec<_>>()),
            )
            .field("home", &self.home)
            .field("known_dirs", &self.known_dirs)
            .finish()
    }
}

impl EnvResolverConfig {
    /// 10 s, 5 s, 60 s, and the user's real shell, env, home and known dirs.
    pub fn standard() -> EnvResolverConfig {
        EnvResolverConfig {
            timeout: Duration::from_secs(10),
            retry_timeout: Duration::from_secs(5),
            retry_after: Duration::from_secs(60),
            shell: None,
            base: None,
            home: None,
            known_dirs: None,
        }
    }
}

/// Resolves the env once in the background and hands every caller the same result.
#[derive(Debug)]
pub struct EnvResolver {
    current: Mutex<Arc<ResolvedEnv>>,
}

impl EnvResolver {
    /// Starts resolving on `rt`; boot never waits for it.
    ///
    /// This build resolves at once to auracode's own env minus [`strip_launch_context`], reported
    /// as [`EnvSource::Fallback`]: the login-shell resolution is package A's.
    pub fn start(
        config: EnvResolverConfig,
        _registry: Arc<LeftoverRegistry>,
        _rt: Handle,
    ) -> Arc<EnvResolver> {
        let mut vars = config.base.unwrap_or_else(process_env);
        strip_launch_context(&mut vars);
        Arc::new(EnvResolver {
            current: Mutex::new(Arc::new(ResolvedEnv {
                vars,
                source: EnvSource::Fallback {
                    reason: "login-shell resolution is not built in this build".into(),
                },
                warnings: Vec::new(),
                resolved_at_ms: now_millis(),
            })),
        })
    }

    /// Tests: no shell; [`get`](Self::get) returns `env` at once.
    pub fn fixed(env: ResolvedEnv) -> Arc<EnvResolver> {
        Arc::new(EnvResolver {
            current: Mutex::new(Arc::new(env)),
        })
    }

    /// The resolved env, sharing the attempt in flight.
    pub async fn get(&self) -> Arc<ResolvedEnv> {
        self.current_env()
    }

    /// The last resolved env, if any attempt finished.
    pub fn current(&self) -> Option<Arc<ResolvedEnv>> {
        Some(self.current_env())
    }

    /// Starts a new attempt. Running sessions keep the env they started with.
    pub fn refresh(&self) {}

    pub fn status(&self) -> ResolverStatus {
        let env = self.current_env();
        match &env.source {
            EnvSource::LoginShell { took_ms, .. } => ResolverStatus::Ready {
                source: env.source.clone(),
                took_ms: *took_ms,
                vars: env.vars.len(),
            },
            EnvSource::WindowsRegistry => ResolverStatus::Ready {
                source: env.source.clone(),
                took_ms: 0,
                vars: env.vars.len(),
            },
            EnvSource::Fallback { reason } => ResolverStatus::Fallback {
                reason: reason.clone(),
            },
        }
    }

    fn current_env(&self) -> Arc<ResolvedEnv> {
        match self.current.lock() {
            Ok(current) => Arc::clone(&current),
            Err(poisoned) => Arc::clone(&poisoned.into_inner()),
        }
    }
}

/// Where the resolver is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolverStatus {
    Resolving,
    Ready {
        source: EnvSource,
        took_ms: u64,
        vars: usize,
    },
    Fallback {
        reason: String,
    },
}

/// Variables that describe how auracode itself was launched, which the resolver's shell must not
/// inherit: a dev launch from Apple Terminal would replay its session restore against the user's
/// tab history, and a `pnpm dev` launch would leak `npm_config_*` into every agent. Whatever the
/// user's own rc files export comes back through the shell's output.
const LAUNCH_CONTEXT_NAMES: &[&str] = &[
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERM_SESSION_ID",
    "INIT_CWD",
];

/// Prefix families of launch-context variables (see [`LAUNCH_CONTEXT_NAMES`]).
const LAUNCH_CONTEXT_PREFIXES: &[&str] = &["SHELL_SESSION_", "npm_", "PNPM_", "pnpm_", "TAURI_"];

/// Removes the variables that describe how auracode itself was launched; returns their names,
/// sorted. Applies to the resolver shell's input and to the fallback. Names compare as
/// [`EnvKey`]s do (ASCII case-insensitively on Windows).
pub fn strip_launch_context(vars: &mut EnvMap) -> Vec<String> {
    let doomed: Vec<EnvKey> = vars
        .keys()
        .filter(|key| is_launch_context(key.as_os_str()))
        .cloned()
        .collect();
    let mut removed: Vec<String> = doomed
        .into_iter()
        .filter_map(|key| {
            vars.remove(&key)?;
            Some(key.as_os_str().to_string_lossy().into_owned())
        })
        .collect();
    removed.sort();
    removed
}

fn is_launch_context(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    LAUNCH_CONTEXT_NAMES
        .iter()
        .any(|exact| scrub::name_eq(name, exact))
        || LAUNCH_CONTEXT_PREFIXES
            .iter()
            .any(|prefix| scrub::name_starts_with(name, prefix))
}

/// The complete env of one child: resolved, scrubbed, then every `set` entry.
pub fn child_env(resolved: &ResolvedEnv, set: &[(OsString, OsString)]) -> (EnvMap, ScrubReport) {
    let mut vars = resolved.vars.clone();
    let report = scrub(&mut vars);
    for (name, value) in set {
        vars.insert(EnvKey::from(name.clone()), value.clone());
    }
    (vars, report)
}

/// auracode's own environment.
pub fn process_env() -> EnvMap {
    std::env::vars_os()
        .map(|(name, value)| (EnvKey::from(name), value))
        .collect()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> EnvMap {
        pairs
            .iter()
            .map(|(name, value)| (EnvKey::from(*name), OsString::from(*value)))
            .collect()
    }

    fn names(vars: &EnvMap) -> Vec<String> {
        vars.keys()
            .map(|key| key.as_os_str().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn env_keys_ignore_case_only_on_windows() {
        let path = EnvKey::from("PATH");
        let mixed = EnvKey::from("Path");
        assert_eq!(path == mixed, cfg!(windows));
        let mut vars = EnvMap::new();
        vars.insert(path, "a".into());
        vars.insert(mixed, "b".into());
        assert_eq!(vars.len(), if cfg!(windows) { 1 } else { 2 });
    }

    #[test]
    fn launch_context_is_stripped_and_named() {
        let mut vars = map(&[
            ("PATH", "/usr/bin"),
            ("HOME", "/Users/me"),
            ("TERM_PROGRAM", "Apple_Terminal"),
            ("TERM_PROGRAM_VERSION", "455"),
            ("TERM_SESSION_ID", "w0t0p0"),
            ("SHELL_SESSION_HISTFILE", "/x"),
            ("npm_config_user_agent", "pnpm/12"),
            ("npm_lifecycle_event", "dev"),
            ("npm_execpath", "/opt/pnpm"),
            ("INIT_CWD", "/repo"),
            ("PNPM_HOME", "/pnpm"),
            ("pnpm_config_verify_deps_before_run", "false"),
            ("TAURI_ENV_PLATFORM", "darwin"),
            ("TERM", "xterm-256color"),
            ("SHELL", "/bin/zsh"),
        ]);
        let removed = strip_launch_context(&mut vars);
        assert_eq!(
            removed,
            [
                "INIT_CWD",
                "PNPM_HOME",
                "SHELL_SESSION_HISTFILE",
                "TAURI_ENV_PLATFORM",
                "TERM_PROGRAM",
                "TERM_PROGRAM_VERSION",
                "TERM_SESSION_ID",
                "npm_config_user_agent",
                "npm_execpath",
                "npm_lifecycle_event",
                "pnpm_config_verify_deps_before_run",
            ]
        );
        assert_eq!(names(&vars), ["HOME", "PATH", "SHELL", "TERM"]);
    }

    #[test]
    fn child_env_scrubs_then_sets() {
        let resolved = ResolvedEnv {
            vars: map(&[
                ("PATH", "/usr/bin"),
                ("CLAUDECODE", "1"),
                ("CLAUDE_CODE_EXECUTABLE", ""),
            ]),
            source: EnvSource::WindowsRegistry,
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        // A `set` entry wins even for a name the scrub removes.
        let set = vec![
            (
                OsString::from("CLAUDE_CODE_EXECUTABLE"),
                OsString::from("/usr/local/bin/claude"),
            ),
            (OsString::from("CLAUDECODE"), OsString::from("set-by-us")),
        ];
        let (vars, report) = child_env(&resolved, &set);
        assert_eq!(report.removed, ["CLAUDECODE"]);
        assert_eq!(
            vars.get(&EnvKey::from("CLAUDE_CODE_EXECUTABLE")),
            Some(&OsString::from("/usr/local/bin/claude"))
        );
        assert_eq!(
            vars.get(&EnvKey::from("CLAUDECODE")),
            Some(&OsString::from("set-by-us"))
        );
        assert_eq!(
            vars.get(&EnvKey::from("PATH")),
            Some(&OsString::from("/usr/bin"))
        );
        // The resolved env itself is untouched.
        assert!(resolved.vars.contains_key(&EnvKey::from("CLAUDECODE")));
    }

    #[test]
    fn resolved_env_debug_never_prints_values() {
        let env = ResolvedEnv {
            vars: map(&[("ANTHROPIC_API_KEY", "sk-ant-api03-secret")]),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        let text = format!("{env:?}");
        assert!(text.contains("ANTHROPIC_API_KEY"), "{text}");
        assert!(!text.contains("secret"), "{text}");
    }

    #[tokio::test]
    async fn the_stub_resolver_answers_at_once_without_launch_context() {
        let base = map(&[("PATH", "/usr/bin"), ("TERM_PROGRAM", "vscode")]);
        let config = EnvResolverConfig {
            base: Some(base),
            ..EnvResolverConfig::standard()
        };
        let resolver = EnvResolver::start(config, LeftoverRegistry::disabled(), Handle::current());
        let env = resolver.get().await;
        assert_eq!(names(&env.vars), ["PATH"]);
        assert!(matches!(env.source, EnvSource::Fallback { .. }));
        assert!(matches!(resolver.status(), ResolverStatus::Fallback { .. }));
        assert!(resolver.current().is_some());
    }

    #[tokio::test]
    async fn a_fixed_resolver_returns_its_env() {
        let env = ResolvedEnv {
            vars: map(&[("PATH", "/bin")]),
            source: EnvSource::LoginShell {
                shell: PathBuf::from("/bin/zsh"),
                interactive: true,
                took_ms: 120,
            },
            warnings: Vec::new(),
            resolved_at_ms: 5,
        };
        let resolver = EnvResolver::fixed(env);
        assert_eq!(resolver.get().await.resolved_at_ms, 5);
        assert_eq!(
            resolver.status(),
            ResolverStatus::Ready {
                source: EnvSource::LoginShell {
                    shell: PathBuf::from("/bin/zsh"),
                    interactive: true,
                    took_ms: 120,
                },
                took_ms: 120,
                vars: 1,
            }
        );
    }
}
