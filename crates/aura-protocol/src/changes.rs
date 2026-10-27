//! Checkpoint-backed Changes and explicit revert previews.

use crate::Millis;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CheckpointSummary {
    pub id: String,
    pub turn_id: String,
    pub created_at: Millis,
    pub file_count: u32,
    pub total_bytes: u32,
    /// Exclusions and limits are visible. Excluded paths are never removed by a revert.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ChangesSnapshot {
    pub checkpoint: Option<CheckpointSummary>,
    pub files: Vec<ChangedFile>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ChangedFile {
    pub path: String,
    pub kind: ChangeKind,
    pub before_bytes: Option<u32>,
    pub after_bytes: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ChangeDiff {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RevertPreview {
    pub token: String,
    pub checkpoint_id: String,
    pub files: Vec<ChangedFile>,
    pub expires_at: Millis,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RevertResult {
    pub applied: Vec<String>,
    /// A partial failure is explicit; the caller must not report full success.
    pub error: Option<String>,
    /// Original files are preserved here whenever a revert replaces or removes them.
    pub recovery_paths: Vec<String>,
}
