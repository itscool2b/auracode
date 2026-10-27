//! Reviewed setup actions. Paths and arguments are supplied by Rust, never by the renderer.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentInstallReview {
    pub agent_id: String,
    pub package: String,
    pub version: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub working_directory: String,
    pub revision: String,
    pub timeout_seconds: u32,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CloneInput {
    pub remote: String,
    pub parent: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CloneReview {
    pub id: String,
    pub remote: String,
    pub parent: String,
    pub destination: String,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CloneState {
    Running,
    Ready,
    Canceled,
    Failed,
    Interrupted,
    CleanupPending,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct CloneRecord {
    pub id: String,
    pub remote: String,
    pub parent: String,
    pub destination: String,
    pub journal: String,
    pub state: CloneState,
    pub detail: String,
}
