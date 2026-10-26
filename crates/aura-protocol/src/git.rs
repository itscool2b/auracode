//! Reviewable Git workspace operations. A preview never authorizes a later, changed repository.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Millis;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GitFileState {
    pub path: String,
    pub index: String,
    pub worktree: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GitWorkspace {
    pub root: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub files: Vec<GitFileState>,
    pub blockers: Vec<String>,
    pub has_submodules: bool,
    pub is_linked_worktree: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct IsolationInput {
    pub slug: String,
    pub bring_changes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct IsolationPreview {
    pub token: String,
    pub source: GitWorkspace,
    pub branch: String,
    pub path: String,
    pub bring_changes: bool,
    pub warnings: Vec<String>,
    pub expires_at: Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeState {
    Creating,
    Ready,
    RecoveryRequired,
    Missing,
    Retired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ManagedWorktree {
    pub id: String,
    pub chat_id: String,
    pub source: String,
    pub path: String,
    pub branch: String,
    pub base_commit: String,
    pub state: WorktreeState,
    pub detail: Option<String>,
    pub created_at: Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct IsolationResult {
    pub worktree: ManagedWorktree,
    pub warning: Option<String>,
}
