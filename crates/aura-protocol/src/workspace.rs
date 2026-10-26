//! Project and chat organization. These records do not alter the transcript's wire contract.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Millis;
use crate::session::{ChatSummary, FolderState};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorkspaceFilter {
    /// Archived chats are excluded unless the caller explicitly asks to include them.
    pub include_archived: bool,
    /// Filters chats only; projects remain available as move destinations.
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorkspaceSnapshot {
    pub projects: Vec<ProjectSummary>,
    pub chats: Vec<WorkspaceChat>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub default_agent: Option<String>,
    pub default_model: Option<String>,
    pub folders: Vec<ProjectFolder>,
    pub created_at: Millis,
    pub updated_at: Millis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectFolder {
    pub id: String,
    pub project_id: String,
    pub display_name: String,
    /// This device's path only. An unavailable device mapping is never borrowed from another.
    pub path: Option<String>,
    pub folder_state: FolderState,
    pub unavailable_reason: Option<String>,
    pub kind: FolderKind,
    pub git_remote_url: Option<String>,
    pub git_default_branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FolderKind {
    Local,
    Git,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorkspaceChat {
    pub chat: ChatSummary,
    pub project_id: String,
    pub folder_id: Option<String>,
    pub pinned: bool,
    pub archived: bool,
}

/// Complete editable project values. `None` clears an optional field on update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectInput {
    pub name: String,
    pub color: Option<String>,
    pub default_agent: Option<String>,
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectCreate {
    pub project: ProjectInput,
    pub folder: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ChatCreatePreview {
    pub folder: ProjectFolder,
    /// Sessions holding this canonical folder, including preparation and shutdown.
    pub busy_chats: Vec<ChatSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectChatCreate {
    pub agent_id: String,
    pub folder_id: String,
    /// Explicit acknowledgment of the busy-folder warning. The server rechecks before creation.
    pub allow_busy_folder: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ChatMove {
    pub project_id: String,
    /// Must belong to the destination project. `None` preserves the current primary path by
    /// attaching a matching folder to that project, never by moving files on disk.
    pub folder_id: Option<String>,
    pub allow_busy_folder: bool,
}
