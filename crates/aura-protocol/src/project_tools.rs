//! Explicit native project utilities. Review tokens belong to one saved chat and folder.
use crate::Millis;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProjectShell {
    /// The person's own login shell (`$SHELL`, else the passwd entry) with their startup files,
    /// as their terminal app starts it. macOS and Linux.
    Login,
    PowerShell,
    CommandPrompt,
    Zsh,
    Bash,
}

/// Editors detected in their standard install locations, each started from its own detected
/// launcher; on macOS Cursor and the VS Code builds open through their OS URL handler instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProjectEditor {
    Cursor,
    VsCode,
    VsCodeInsiders,
    Zed,
    IntellijIdea,
    #[serde(rename = "webstorm")]
    WebStorm,
    #[serde(rename = "pycharm")]
    PyCharm,
    #[serde(rename = "rustrover")]
    RustRover,
    #[serde(rename = "goland")]
    GoLand,
    #[serde(rename = "clion")]
    CLion,
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

/// The editors found in their standard install locations, and the one a chat's files open in:
/// Settings' choice when it is installed, otherwise the first one found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct DetectedEditors {
    pub editors: Vec<ProjectEditor>,
    pub opens_in: Option<ProjectEditor>,
}
