//! Which inherited environment variables a spawned Claude Code must not see.
//!
//! A running Claude Code session exports markers into every process it starts: its Bash tool,
//! its hooks, and anything those launch. auracode started from such a terminal (always the case
//! while developing it) would pass them on, and the child `claude` would then believe it is
//! nested inside that session. The list is the plan's (`CLAUDECODE`, `CLAUDE_CODE_*`,
//! `CLAUDE_EFFORT`, `CODEX_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`) plus `CLAUDE_PID`, which
//! this machine's Claude Code session also exports and which is just as much a parent marker.

use std::ffi::{OsStr, OsString};

const EXACT: &[&str] = &["CLAUDECODE", "CLAUDE_EFFORT", "CLAUDE_PID", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"];
const PREFIXES: &[&str] = &["CLAUDE_CODE_", "CODEX_"];

/// Whether a variable is removed. Windows compares variable names case-insensitively, so this
/// does too there; a name that is not valid Unicode can't be one of ours and is kept.
pub fn is_scrubbed(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else { return false };
    let name = if cfg!(windows) { name.to_ascii_uppercase() } else { name.to_owned() };
    EXACT.contains(&name.as_str()) || PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// The child's environment (the input minus scrubbed names) and the names that were removed, so
/// a run log can say what was dropped without ever recording a value.
pub fn scrub(vars: impl IntoIterator<Item = (OsString, OsString)>) -> (Vec<(OsString, OsString)>, Vec<String>) {
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for (name, value) in vars {
        if is_scrubbed(&name) {
            dropped.push(name.to_string_lossy().into_owned());
        } else {
            kept.push((name, value));
        }
    }
    dropped.sort();
    (kept, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
    }

    #[test]
    fn parent_session_markers_are_dropped() {
        for name in [
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_SESSION_ID",
            "CLAUDE_CODE_MESSAGING_SOCKET",
            "CLAUDE_CODE_MESSAGING_TOKEN",
            "CLAUDE_CODE_CHILD_SESSION",
            "CLAUDE_EFFORT",
            "CLAUDE_PID",
            "CODEX_HOME",
            "CODEX_THREAD_ID",
            "NODE_OPTIONS",
            "ELECTRON_RUN_AS_NODE",
        ] {
            assert!(is_scrubbed(OsStr::new(name)), "{name} should be scrubbed");
        }
    }

    #[test]
    fn user_configuration_survives() {
        // CLAUDE_CONFIG_DIR picks the account's config home; dropping it would silently switch the
        // child to a different login.
        for name in ["CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "HTTPS_PROXY", "PATH", "HOME", "CLAUDE", "CODEX"] {
            assert!(!is_scrubbed(OsStr::new(name)), "{name} should be kept");
        }
    }

    #[test]
    fn scrub_keeps_values_and_reports_only_names() {
        let (kept, dropped) =
            scrub(env(&[("PATH", "/bin"), ("CLAUDECODE", "1"), ("CLAUDE_CODE_SESSION_ID", "abc"), ("HOME", "/h")]));
        assert_eq!(kept, env(&[("PATH", "/bin"), ("HOME", "/h")]));
        assert_eq!(dropped, vec!["CLAUDECODE".to_owned(), "CLAUDE_CODE_SESSION_ID".to_owned()]);
    }

    #[cfg(not(windows))]
    #[test]
    fn names_are_case_sensitive_off_windows() {
        assert!(!is_scrubbed(OsStr::new("claudecode")));
    }

    #[cfg(unix)]
    #[test]
    fn a_non_unicode_name_is_kept() {
        use std::os::unix::ffi::OsStrExt;
        assert!(!is_scrubbed(OsStr::from_bytes(b"CLAUDE_CODE_\xff")));
    }
}
