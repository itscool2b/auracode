//! Deleting everything auracode keeps on this device, as if it had never been installed.
//!
//! The Windows uninstaller and Settings' "Delete all auracode data" both run this through the app
//! binary's `--uninstall-cleanup` mode (the desktop crate's `uninstall` module), so one tested
//! piece of Rust decides what goes on every platform. [`plan`] looks without changing anything;
//! [`execute`] deletes what the plan found, in this order:
//!
//! 1. auracode's secure-store entries ([`vault`]): the index of each data folder and the account
//!    keys it lists, then (machine scope) every remaining entry in auracode's own service;
//! 2. auracode's worktrees ([`worktrees`]): clean ones, and those with unsaved work the person chose
//!    to delete, go with their Git registration; the rest stay where they are, unlocked;
//! 3. the folders and files auracode names after itself ([`Targets`]), around kept worktrees;
//! 4. in a data folder chosen with `AURACODE_DATA_DIR`, only the entries auracode made in it;
//! 5. the updater's leftovers in the temporary folder.
//!
//! What stays, and why, is in `docs/uninstall.md`: the person's agents and every agent home
//! (`~/.claude`, `~/.codex`, `~/.pi` and the rest are never read), their repositories, branches
//! and commits, and files auracode wrote into agent folders at their request. Nothing here starts
//! an agent, contacts the network or follows a link out of the folder it is deleting. A file that
//! cannot be deleted is retried ([`Retry`]) and then reported, never skipped in silence, and a
//! second run over a clean machine is a no-op.

mod remove;
mod targets;
#[cfg(test)]
mod tests;
mod vault;
mod worktrees;

use std::path::{Path, PathBuf};

pub use remove::Retry;
pub use targets::{Os, PlatformDirs, Targets};
pub use vault::{AppVault, ORIGINS, VaultReport};
pub use worktrees::{GitTool, Worktree};

/// How far a cleanup reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Everything for this user on this device: the default data folder, the platform's folders
    /// for auracode, the updater's leftovers and every auracode secure-store entry.
    Machine,
    /// One data folder chosen with `AURACODE_DATA_DIR`: only what auracode made in it and its own
    /// index entry. Account keys stay, since other data folders can use them.
    DataFolder,
}

/// What one plan item is, for the review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    /// The data folder: chats, settings, worktrees, checkpoints, adapters and the webview profile
    /// on Windows.
    Data,
    /// Another folder or file the platform keeps for auracode: window position, web caches,
    /// preferences.
    App,
    /// An entry auracode made in a data folder it does not own by name.
    Entry,
    /// A leftover of the updater or the CLI in the temporary folder.
    Temporary,
}

/// One thing a cleanup removes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub kind: ItemKind,
    pub path: PathBuf,
    /// Its size on disk, when counting it stayed within the budget.
    pub bytes: Option<u64>,
}

/// What a cleanup would remove, read without changing anything.
#[derive(Debug, Clone)]
pub struct Plan {
    pub scope: Scope,
    pub items: Vec<Item>,
    /// Every auracode worktree found in the data folders, clean or not.
    pub worktrees: Vec<Worktree>,
    /// The data folders looked at.
    pub data_roots: Vec<PathBuf>,
}

impl Plan {
    /// Worktrees whose folder holds work that is not saved anywhere else, or could not be checked.
    pub fn unsaved(&self) -> impl Iterator<Item = &Worktree> {
        self.worktrees.iter().filter(|worktree| worktree.unsaved())
    }

    /// Nothing left to remove (a second run, or a machine auracode never ran on).
    pub fn is_empty(&self) -> bool {
        self.items.is_empty() && self.worktrees.is_empty()
    }
}

/// What happens to worktrees with unsaved work. Clean worktrees always go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeChoice {
    /// Keep every worktree with unsaved work (the default, and what a quiet uninstall does).
    KeepUnsaved,
    /// Delete these unsaved worktrees too (the ones the person saw in the review); any other
    /// unsaved worktree, such as one that changed since, stays.
    Remove(Vec<PathBuf>),
}

/// One path that could not be removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub path: PathBuf,
    pub error: String,
    /// How many times it was tried.
    pub attempts: u32,
}

/// What a cleanup did.
#[derive(Debug, Clone, Default)]
pub struct Report {
    /// The plan items and worktree folders that are gone.
    pub removed: Vec<PathBuf>,
    /// Worktrees left in place, with their unsaved work.
    pub kept: Vec<Worktree>,
    /// Everything that could not be removed. Empty means the cleanup is complete.
    pub failed: Vec<Failure>,
    pub vault: VaultReport,
    /// Things worth saying that are not failures (a registration Git could not prune).
    pub notes: Vec<String>,
}

impl Report {
    pub fn complete(&self) -> bool {
        self.failed.is_empty() && self.vault.error.is_none()
    }
}

/// Names auracode creates directly in a data folder. In a folder chosen with
/// `AURACODE_DATA_DIR` only these go (with their `.corrupt-*` copies and `.<name>.tmp-*` debris),
/// since that folder may hold other things.
pub const DATA_ENTRIES: &[&str] = &[
    "device.json",
    "state.json",
    "profiles",
    "run",
    "adapters",
    "agent-executables.json",
    "agent-executables.lock",
    "catalog-releases.json",
    "instructions",
    "accounts.lock",
    "account-passphrase-vault",
    "config-profile-transition.json",
    ".config-profile-transition.lock",
    "EBWebView",
    ".window-state.json",
];

/// Looks at what a cleanup over `targets` would remove. Changes nothing, and runs only read-only
/// Git commands in auracode's own worktrees.
pub fn plan(targets: &Targets, git: &GitTool) -> Plan {
    let mut budget = remove::SizeBudget::default();
    let mut items = Vec::new();
    let mut push = |kind, path: PathBuf, items: &mut Vec<Item>| {
        if std::fs::symlink_metadata(&path).is_ok() {
            let bytes = budget.size(&path);
            items.push(Item { kind, path, bytes });
        }
    };
    for (index, dir) in targets.owned_dirs.iter().enumerate() {
        let kind = if index == 0 && targets.scope == Scope::Machine {
            ItemKind::Data
        } else {
            ItemKind::App
        };
        push(kind, dir.clone(), &mut items);
    }
    for file in &targets.owned_files {
        push(ItemKind::App, file.clone(), &mut items);
    }
    for root in &targets.shared_roots {
        for entry in data_entries(root) {
            push(ItemKind::Entry, entry, &mut items);
        }
    }
    if let Some(temp) = &targets.temp_dir {
        for leftover in temporary_leftovers(temp) {
            push(ItemKind::Temporary, leftover, &mut items);
        }
    }
    let worktrees = targets
        .data_roots
        .iter()
        .flat_map(|root| worktrees::discover(root))
        .map(|path| git.inspect(&path))
        .collect();
    Plan {
        scope: targets.scope,
        items,
        worktrees,
        data_roots: targets.data_roots.clone(),
    }
}

/// Removes what `plan` found. Worktrees with unsaved work stay unless `choice` names them.
/// `vault` is the secure store (`None` skips it, for a machine without one).
pub fn execute(
    plan: &Plan,
    choice: &WorktreeChoice,
    vault: Option<&dyn AppVault>,
    git: &GitTool,
    retry: &Retry,
) -> Report {
    let mut report = Report::default();
    let removing = |worktree: &Worktree| {
        !worktree.unsaved()
            || match choice {
                WorktreeChoice::KeepUnsaved => false,
                WorktreeChoice::Remove(paths) => {
                    paths.iter().any(|path| same(path, &worktree.path))
                }
            }
    };
    // The secure store first: a data folder's index entry is named after the folder's real path,
    // which can only be resolved while the folder exists.
    if let Some(vault) = vault {
        report.vault = vault::clean(vault, &plan.data_roots, plan.scope);
    }
    let mut kept = Vec::new();
    for worktree in &plan.worktrees {
        if removing(worktree) {
            let mut removal = remove::Removal::new(retry);
            git.unlock(worktree);
            removal.remove(&worktree.path, &[]);
            if removal.failed.is_empty() {
                report.removed.push(worktree.path.clone());
                if let Some(note) = git.prune(worktree) {
                    report.notes.push(note);
                }
            }
            report.failed.extend(removal.failed);
        } else {
            // Its folder stays where it is, registered with its repository, and is no longer
            // locked by auracode, so `git worktree remove` works on it like any other.
            git.unlock(worktree);
            kept.push(worktree.path.clone());
            report.kept.push(worktree.clone());
        }
    }
    for item in &plan.items {
        let mut removal = remove::Removal::new(retry);
        removal.remove(&item.path, &kept);
        if removal.failed.is_empty() && !removal.kept_any {
            report.removed.push(item.path.clone());
        }
        report.failed.extend(removal.failed);
    }
    // A data folder chosen with AURACODE_DATA_DIR goes too once nothing else is in it.
    for root in &plan.data_roots {
        if std::fs::remove_dir(root).is_ok() {
            report.removed.push(root.clone());
        }
    }
    report.removed.dedup();
    report
}

/// The entries auracode made directly in `root`, by [`DATA_ENTRIES`].
pub fn data_entries(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| is_data_entry(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

fn is_data_entry(name: &str) -> bool {
    DATA_ENTRIES.iter().any(|known| {
        name == *known
            || name
                .strip_prefix(known)
                .is_some_and(|rest| rest.starts_with(".corrupt-"))
            || name
                .strip_prefix('.')
                .and_then(|rest| rest.strip_prefix(known))
                .is_some_and(|rest| rest.starts_with(".tmp-"))
    })
}

/// The updater's downloads (`auracode-<version>-updater-*`, which the updater keeps) and the CLI's
/// probe folders (`aura-cli-*`) in the temporary folder.
pub fn temporary_leftovers(temp: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(temp) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (name.starts_with("auracode-") && name.contains("-updater-"))
                || name.starts_with("aura-cli-")
        })
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

/// Profiles another auracode process holds right now (`<profile>/owner.lock`), and data folders
/// whose account lock is held: the cleanup waits until this is empty. Never creates a lock file.
pub fn in_use(data_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut busy = Vec::new();
    for root in data_roots {
        if held(&root.join("accounts.lock")) {
            busy.push(root.clone());
        }
        let Ok(profiles) = std::fs::read_dir(root.join("profiles")) else {
            continue;
        };
        for profile in profiles.filter_map(|entry| entry.ok()) {
            if held(&profile.path().join("owner.lock")) {
                busy.push(profile.path());
            }
        }
    }
    busy
}

/// Whether another process holds the lock on `path`. A missing file is not held.
fn held(path: &Path) -> bool {
    let Ok(file) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
    else {
        return false;
    };
    matches!(file.try_lock(), Err(std::fs::TryLockError::WouldBlock))
}

/// Two spellings of one path (`C:/x` and `C:\x`, a verbatim prefix, a different case on Windows).
fn same(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => {
            let normal = |path: &Path| {
                let text = path.to_string_lossy().replace('\\', "/");
                let text = text.trim_start_matches("//?/").trim_end_matches('/');
                if cfg!(windows) {
                    text.to_lowercase()
                } else {
                    text.to_owned()
                }
            };
            normal(left) == normal(right)
        }
    }
}
