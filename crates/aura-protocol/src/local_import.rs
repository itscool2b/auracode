//! Explicit Local project copies into the active Account profile. No native sessions are copied.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LocalImportProject {
    pub project_id: String,
    pub name: String,
    pub folders: u32,
    pub chats: u32,
    pub turns: u32,
    pub revision: String,
    pub already_imported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LocalImportPreview {
    pub projects: Vec<LocalImportProject>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LocalImportSelection {
    pub project_id: String,
    pub revision: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LocalImportResult {
    pub project_ids: Vec<String>,
    pub chats: u32,
    pub turns: u32,
    pub missing_attachments: u32,
}
