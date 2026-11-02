use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectMemory {
    pub project_id: String,
    pub revision: Option<String>,
    pub markdown: String,
    #[specta(type = specta_typescript::Number)]
    pub updated_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct MemoryRevision {
    pub revision: String,
    pub parent_revision: Option<String>,
    pub project_id: String,
    pub markdown: String,
    pub reason: String,
    pub source: String,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct MemoryProposal {
    pub id: String,
    pub project_id: String,
    pub base_revision: Option<String>,
    pub markdown: String,
    pub reason: String,
    pub chat_id: Option<String>,
    pub idempotency_key: String,
    pub state: String,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SaveProjectMemory {
    pub project_id: String,
    pub expected_revision: Option<String>,
    pub markdown: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProposeProjectMemory {
    pub project_id: String,
    pub base_revision: Option<String>,
    pub markdown: String,
    pub reason: String,
    pub chat_id: Option<String>,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AcceptMemoryProposal {
    pub project_id: String,
    pub proposal_id: String,
    pub expected_revision: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProjectMemoryBundle {
    pub schema_version: u32,
    pub project_id: String,
    pub current: ProjectMemory,
    pub history: Vec<MemoryRevision>,
    pub proposals: Vec<MemoryProposal>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportProjectMemory {
    pub bundle: ProjectMemoryBundle,
    pub expected_revision: Option<String>,
}
/// An agent's direct edit: the revision it added, the one it replaced, and the chat it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentMemoryEdit {
    pub revision: String,
    pub parent_revision: Option<String>,
    pub chat_id: String,
}
/// What the window hears after a committed change to a project's memory, history or proposals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectMemoryChanged {
    /// Empty when changes were missed: every open project should be read again.
    pub project_id: Option<String>,
    /// Set only when an agent's direct edit added a revision.
    pub agent_edit: Option<AgentMemoryEdit>,
}
