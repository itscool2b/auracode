//! Whether the person has told Claude Code to ask before something: an `ask` rule in one of the
//! settings files Claude reads its permission rules from.
//!
//! Claude asks about a command made of several by saying only that its parts were looked at
//! (`subcommandResults`), not why any one of them asks. So a planning turn on Full access cannot
//! tell "Claude could not prove this read-only" from "one part matched an ask rule the person
//! wrote". Where an ask rule exists at all, such a request is shown, as it would be outside Plan;
//! where none does, there is nothing it could be hiding (`Session::plans_unasked`).

use std::{
    ffi::OsString,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::driver::SessionSetup;

/// The settings files Claude Code takes permission rules from for a chat in `folder`: the
/// person's own (`config_dir`), the project's two in the folder and in each folder above it, and
/// the ones an organisation manages on this computer.
pub(super) fn settings_files(config_dir: Option<&Path>, folder: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    if let Some(dir) = config_dir {
        files.push(dir.join("settings.json"));
    }
    for dir in folder.ancestors() {
        files.push(dir.join(".claude").join("settings.json"));
        files.push(dir.join(".claude").join("settings.local.json"));
    }
    for managed in [
        r"C:\Program Files\ClaudeCode\managed-settings.json",
        r"C:\ProgramData\ClaudeCode\managed-settings.json",
        "/Library/Application Support/ClaudeCode/managed-settings.json",
        "/etc/claude-code/managed-settings.json",
    ] {
        files.push(PathBuf::from(managed));
    }
    files
}

/// Whether any of `files` holds an ask rule. A file that is there but cannot be read or
/// understood counts as holding one: it cannot be ruled out.
pub(super) fn asks_by_rule(files: &[PathBuf]) -> bool {
    files.iter().any(|file| match std::fs::read(file) {
        Err(error) => !matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory),
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Err(_) => true,
            Ok(settings) => match &settings["permissions"]["ask"] {
                Value::Null => false,
                Value::Array(rules) => !rules.is_empty(),
                _ => true,
            },
        },
    })
}

/// Where this chat's Claude keeps the person's settings: the folder its launch names
/// (`CLAUDE_CONFIG_DIR`, which a chat on an added account has), else the one the agent's
/// environment names, else `.claude` in the home folder.
pub(super) fn config_dir(setup: &SessionSetup) -> Option<PathBuf> {
    let named = |name: &str| -> Option<OsString> {
        setup
            .launch
            .set_env
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
            .or_else(|| {
                setup
                    .env
                    .vars
                    .get(&o7_process::env::EnvKey::new(name))
                    .cloned()
            })
            .filter(|value| !value.is_empty())
    };
    named("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            named("USERPROFILE")
                .or_else(|| named("HOME"))
                .map(|home| PathBuf::from(home).join(".claude"))
        })
        .filter(|dir| dir.is_absolute())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ask_rule_in_any_settings_file_is_found_and_an_unreadable_file_counts_as_one() {
        let root = tempfile::tempdir().expect("folder");
        let home = root.path().join("home").join(".claude");
        let project = root.path().join("work").join("app");
        std::fs::create_dir_all(&home).expect("home");
        std::fs::create_dir_all(project.join(".claude")).expect("project");
        let files = settings_files(Some(&home), &project);
        assert_eq!(files[0], home.join("settings.json"));
        assert!(files.contains(&project.join(".claude").join("settings.local.json")));
        // The folders above the project are looked in too.
        assert!(
            files.contains(
                &root
                    .path()
                    .join("work")
                    .join(".claude")
                    .join("settings.json")
            )
        );
        let here: Vec<PathBuf> = files
            .iter()
            .filter(|file| file.starts_with(root.path()))
            .cloned()
            .collect();

        // No file at all, then files without an ask rule.
        assert!(!asks_by_rule(&here));
        std::fs::write(
            home.join("settings.json"),
            r#"{"permissions":{"allow":["Bash(git status:*)"],"ask":[]}}"#,
        )
        .expect("write");
        std::fs::write(project.join(".claude").join("settings.json"), "{}").expect("write");
        assert!(!asks_by_rule(&here));

        // One ask rule anywhere is enough.
        std::fs::write(
            project.join(".claude").join("settings.local.json"),
            r#"{"permissions":{"ask":["Bash(git push:*)"]}}"#,
        )
        .expect("write");
        assert!(asks_by_rule(&here));
        std::fs::remove_file(project.join(".claude").join("settings.local.json")).expect("remove");
        assert!(!asks_by_rule(&here));

        // A file that cannot be understood, or whose ask is not a list, cannot be ruled out.
        std::fs::write(home.join("settings.json"), "{ not json").expect("write");
        assert!(asks_by_rule(&here));
        std::fs::write(
            home.join("settings.json"),
            r#"{"permissions":{"ask":"Bash"}}"#,
        )
        .expect("write");
        assert!(asks_by_rule(&here));
    }
}
