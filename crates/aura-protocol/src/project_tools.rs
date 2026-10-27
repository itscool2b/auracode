//! Explicit native project utilities. Review tokens belong to one saved chat and folder.
use crate::Millis;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProjectShell {
    PowerShell,
    CommandPrompt,
    Zsh,
    Bash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProjectEditor {
    Cursor,
    VsCode,
    VsCodeInsiders,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProjectShellChoice {
    pub id: ProjectShell,
    pub label: String,
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProjectToolsReview {
    pub token: String,
    pub folder: String,
    pub shells: Vec<ProjectShellChoice>,
    pub editors: Vec<ProjectEditor>,
    pub expires_at: Millis,
}
