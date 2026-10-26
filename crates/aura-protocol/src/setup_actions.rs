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
