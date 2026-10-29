//! Settings' "Delete all auracode data": a review of exactly what would go, then a cleanup that
//! runs after auracode quits.
//!
//! The data cannot be deleted while auracode runs (its database, locks and webview profile are
//! open), so applying starts this same executable in its cleanup mode ([`crate::uninstall`]) with
//! the review's choices, detached, and quits. The cleanup waits for this process to exit, deletes
//! what the review showed (minus worktrees the person kept), and says only if something could not
//! be deleted. The next launch is a fresh install.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aura_core::uninstall::{self, GitTool, ItemKind, Os, PlatformDirs, Targets};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppErrorCode};
use crate::state::AppState;

/// How far the review reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DataCleanupScope {
    /// Everything auracode keeps on this device.
    Machine,
    /// Only this launch's own data folder (`AURACODE_DATA_DIR`).
    DataFolder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DataCleanupItemKind {
    /// The data folder: chats, settings, worktrees, checkpoints, adapters.
    Data,
    /// Window position, web caches, preferences.
    App,
    /// An entry auracode made in a data folder it does not own by name.
    Entry,
    /// Update downloads and other leftovers in the temporary folder.
    Temporary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct DataCleanupItem {
    pub kind: DataCleanupItemKind,
    pub path: String,
    /// Size on disk, when it could be counted quickly.
    #[specta(type = Option<specta_typescript::Number>)]
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct DataCleanupWorktree {
    pub path: String,
    /// The repository it belongs to, when Git could tell.
    pub repository: Option<String>,
    pub branch: Option<String>,
    /// What deleting the folder would lose, in one line.
    pub summary: String,
    /// Uncommitted files or commits no other branch has (or Git could not check it).
    pub unsaved: bool,
}

/// Only opaque secure-store targets and decisions are exposed to the renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct DataCleanupKey {
    pub target: String,
    pub kind: String,
    pub remove: bool,
    pub reason: String,
}

/// What "Delete all auracode data" would remove, for the review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct DataCleanupReview {
    /// One use, for [`data_cleanup_apply`], within ten minutes.
    pub token: String,
    pub scope: DataCleanupScope,
    pub items: Vec<DataCleanupItem>,
    pub worktrees: Vec<DataCleanupWorktree>,
    /// Where auracode's keys are: "Windows Credential Manager" or "the macOS keychain".
    pub secure_store: Option<String>,
    pub keys: Vec<DataCleanupKey>,
    pub warnings: Vec<String>,
    /// macOS: the app bundle "move auracode to the Trash" would move; `None` where it cannot.
    pub app_bundle: Option<String>,
}

/// The person's choices in the review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct DataCleanupChoice {
    /// Worktrees with unsaved work to delete too; each must be one the review listed.
    pub remove_worktrees: Vec<String>,
    /// macOS: move the app to the Trash afterwards.
    pub move_app_to_trash: bool,
}

struct Pending {
    token: String,
    at: Instant,
    scope: DataCleanupScope,
    root: Option<PathBuf>,
    unsaved: Vec<String>,
    app_bundle: Option<PathBuf>,
    vault_review: Vec<uninstall::VaultApproval>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
const REVIEW_LIFETIME: Duration = Duration::from_secs(600);

fn failed(message: impl Into<String>) -> AppError {
    AppError::new(AppErrorCode::Internal, message)
}

/// The targets for this launch: everything for the installed app, or only a data folder of its
/// own, never the installed app's data from a development copy.
fn targets(state: &AppState) -> Result<(DataCleanupScope, Targets), AppError> {
    if state.launch.own_data_dir {
        let root = state.data_dir().ok_or_else(|| {
            AppError::new(
                AppErrorCode::DataDirUnknown,
                "auracode does not know where its data folder is.",
            )
        })?;
        Ok((
            DataCleanupScope::DataFolder,
            Targets::data_folder(root.to_path_buf()),
        ))
    } else {
        Ok((
            DataCleanupScope::Machine,
            Targets::machine(Os::current(), &PlatformDirs::current(), None),
        ))
    }
}

/// Reviews what deleting all of auracode's data would remove. Changes nothing; checks
/// auracode's worktrees with read-only Git commands.
#[tauri::command]
#[specta::specta]
pub async fn data_cleanup_review(
    state: State<'_, AppState>,
) -> Result<DataCleanupReview, AppError> {
    let (scope, targets) = targets(&state)?;
    let root = targets.shared_roots.first().cloned();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let mut plan = uninstall::plan(&targets, &GitTool::from_path());
        plan.vault = match aura_sync::vault::NativeStore::for_review() {
            Ok(store) => {
                uninstall::review_vault(&store, &plan.data_roots, plan.default_root.as_deref())
            }
            Err(_) => uninstall::VaultPlan::unavailable(),
        };
        plan
    })
    .await
    .map_err(|error| failed(format!("The review could not finish: {error}")))?;
    let display = |path: &Path| path.display().to_string();
    let worktrees: Vec<DataCleanupWorktree> = plan
        .worktrees
        .iter()
        .map(|worktree| DataCleanupWorktree {
            path: display(&worktree.path),
            repository: worktree.repository.as_deref().map(display),
            branch: worktree.branch.clone(),
            summary: worktree.summary(),
            unsaved: worktree.unsaved(),
        })
        .collect();
    let app_bundle = crate::uninstall::app_bundle();
    let review = DataCleanupReview {
        token: aura_core::ids::new_id(),
        scope,
        items: plan
            .items
            .iter()
            .map(|item| DataCleanupItem {
                kind: match item.kind {
                    ItemKind::Data => DataCleanupItemKind::Data,
                    ItemKind::App => DataCleanupItemKind::App,
                    ItemKind::Entry => DataCleanupItemKind::Entry,
                    ItemKind::Temporary => DataCleanupItemKind::Temporary,
                },
                path: display(&item.path),
                bytes: item.bytes,
            })
            .collect(),
        keys: plan
            .vault
            .rows
            .iter()
            .map(|row| DataCleanupKey {
                target: row.target.clone(),
                kind: match row.kind {
                    uninstall::VaultKind::Index => "Index",
                    uninstall::VaultKind::Account => "Account",
                    uninstall::VaultKind::Unknown => "Unknown",
                }
                .into(),
                remove: row.remove,
                reason: row.reason.clone(),
            })
            .collect(),
        warnings: plan.vault.warnings.clone(),
        secure_store: if cfg!(windows) {
            Some("Windows Credential Manager".into())
        } else if cfg!(target_os = "macos") {
            Some("the macOS keychain".into())
        } else {
            None
        },
        app_bundle: app_bundle
            .as_deref()
            .filter(|_| scope == DataCleanupScope::Machine)
            .map(display),
        worktrees,
    };
    *PENDING
        .lock()
        .map_err(|_| failed("The review is unavailable."))? = Some(Pending {
        vault_review: plan.vault.approvals,
        token: review.token.clone(),
        at: Instant::now(),
        scope,
        root,
        unsaved: review
            .worktrees
            .iter()
            .filter(|worktree| worktree.unsaved)
            .map(|worktree| worktree.path.clone())
            .collect(),
        app_bundle: app_bundle.filter(|_| scope == DataCleanupScope::Machine),
    });
    Ok(review)
}

/// Starts the reviewed cleanup and quits auracode. Running agents and terminals stop without a
/// second question: the review said so. Nothing is deleted until auracode has exited.
#[tauri::command]
#[specta::specta]
pub async fn data_cleanup_apply(
    app: AppHandle,
    token: String,
    choice: DataCleanupChoice,
) -> Result<(), AppError> {
    let pending = PENDING
        .lock()
        .map_err(|_| failed("The review is unavailable."))?
        .take()
        .filter(|pending| pending.token == token && pending.at.elapsed() < REVIEW_LIFETIME)
        .ok_or_else(|| {
            AppError::invalid_argument("This review expired. Review the data to delete again.")
        })?;
    let arguments = cleanup_arguments(&pending, &choice, std::process::id())?;
    let exe = std::env::current_exe()
        .map_err(|error| failed(format!("auracode could not find its own program: {error}")))?;
    spawn_detached(&exe, &arguments)
        .map_err(|error| failed(format!("The cleanup could not start: {error}")))?;
    tracing::info!(scope = ?pending.scope, "deleting all auracode data after quitting");
    if let Some(state) = app.try_state::<AppState>() {
        state.quit.confirm_ahead();
    }
    app.exit(0);
    Ok(())
}

/// The cleanup's command line for a review and the person's choices. Refuses a worktree the
/// review did not list as unsaved.
fn cleanup_arguments(
    pending: &Pending,
    choice: &DataCleanupChoice,
    pid: u32,
) -> Result<Vec<std::ffi::OsString>, AppError> {
    let mut arguments: Vec<std::ffi::OsString> = vec![
        crate::uninstall::CLEANUP_FLAG.into(),
        "--report-failures".into(),
        "--after-pid".into(),
        pid.to_string().into(),
    ];
    if pending.scope == DataCleanupScope::DataFolder {
        let root = pending
            .root
            .as_ref()
            .ok_or_else(|| failed("auracode does not know where its data folder is."))?;
        arguments.extend(["--data-dir".into(), root.clone().into_os_string()]);
    }
    for path in &choice.remove_worktrees {
        if !pending.unsaved.contains(path) {
            return Err(AppError::invalid_argument(
                "A worktree to delete was not in the review. Review the data to delete again.",
            ));
        }
        arguments.extend(["--remove-worktree".into(), path.into()]);
    }
    if choice.remove_worktrees.is_empty() {
        arguments.push("--keep-unsaved-worktrees".into());
    }
    if choice.move_app_to_trash {
        let bundle = pending.app_bundle.as_ref().ok_or_else(|| {
            AppError::invalid_argument("auracode cannot move itself to the Trash from here.")
        })?;
        arguments.extend(["--trash-app".into(), bundle.clone().into_os_string()]);
    }
    arguments.extend([
        "--vault-review".into(),
        serde_json::to_string(&pending.vault_review)
            .map_err(|_| failed("The secure-store review could not be passed to cleanup."))?
            .into(),
    ]);
    Ok(arguments)
}

/// Starts the cleanup so it outlives this process: its own process group, no console, out of
/// any job object that would end it with auracode.
fn spawn_detached(exe: &Path, arguments: &[std::ffi::OsString]) -> std::io::Result<()> {
    let build = || {
        let mut command = Command::new(exe);
        command
            .args(arguments)
            .env_remove(aura_core::paths::DATA_DIR_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // A job that forbids breaking away refuses the flag; then start inside it.
        match build()
            .creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
        {
            Ok(_) => Ok(()),
            Err(_) => build().creation_flags(flags).spawn().map(drop),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        build().process_group(0).spawn().map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(scope: DataCleanupScope) -> Pending {
        Pending {
            vault_review: Vec::new(),
            token: "t".into(),
            at: Instant::now(),
            scope,
            root: Some(PathBuf::from("/data")),
            unsaved: vec!["/data/profiles/local/worktrees/a".into()],
            app_bundle: None,
        }
    }

    fn strings(arguments: Vec<std::ffi::OsString>) -> Vec<String> {
        arguments
            .into_iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn the_cleanup_runs_with_the_review_choices() {
        let keep = DataCleanupChoice {
            remove_worktrees: Vec::new(),
            move_app_to_trash: false,
        };
        assert_eq!(
            strings(cleanup_arguments(&pending(DataCleanupScope::Machine), &keep, 7).unwrap()),
            [
                "--uninstall-cleanup",
                "--report-failures",
                "--after-pid",
                "7",
                "--keep-unsaved-worktrees",
                "--vault-review",
                "[]"
            ]
        );
        let remove = DataCleanupChoice {
            remove_worktrees: vec!["/data/profiles/local/worktrees/a".into()],
            move_app_to_trash: false,
        };
        let arguments =
            strings(cleanup_arguments(&pending(DataCleanupScope::DataFolder), &remove, 7).unwrap());
        assert_eq!(
            arguments[4..],
            [
                "--data-dir",
                "/data",
                "--remove-worktree",
                "/data/profiles/local/worktrees/a",
                "--vault-review",
                "[]"
            ]
        );
        // The arguments always parse back.
        let parsed = crate::uninstall::parse(
            &cleanup_arguments(&pending(DataCleanupScope::DataFolder), &remove, 7).unwrap()[1..],
        )
        .unwrap();
        assert_eq!(parsed.after_pid, Some(7));
        assert!(parsed.report_failures && !parsed.interactive);
    }

    #[test]
    fn a_choice_outside_the_review_is_refused() {
        let unknown = DataCleanupChoice {
            remove_worktrees: vec!["/elsewhere".into()],
            move_app_to_trash: false,
        };
        assert!(cleanup_arguments(&pending(DataCleanupScope::Machine), &unknown, 7).is_err());
        let trash = DataCleanupChoice {
            remove_worktrees: Vec::new(),
            move_app_to_trash: true,
        };
        // No bundle to move (Windows, a disk image, a data folder of its own).
        assert!(cleanup_arguments(&pending(DataCleanupScope::Machine), &trash, 7).is_err());
    }
}
