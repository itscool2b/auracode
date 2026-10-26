//! Explicit device-local setup. Saving a recipe never executes it.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorktreeSetupInput {
    pub files: Vec<String>,
    pub command: Option<SetupCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SetupCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorktreeSetup {
    pub source: String,
    pub input: WorktreeSetupInput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SetupFile {
    pub path: String,
    pub bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorktreeSetupPreview {
    pub token: String,
    pub worktree_id: String,
    pub source: String,
    pub destination: String,
    pub files: Vec<SetupFile>,
    pub command: Option<SetupCommand>,
    pub warnings: Vec<String>,
    pub expires_at: crate::Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorktreeSetupResult {
    pub copied: Vec<String>,
    pub command_token: Option<String>,
    pub warning: Option<String>,
}
