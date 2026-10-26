//! Local, explicit configuration inspection. No environment lookup, subprocesses or network calls.
//! The host supplies approved roots. Credentials, sessions and vendor-synced directories are not
//! part of an inventory. Content is untrusted data, never executable instructions for this crate.

mod inventory;
mod mcp;
mod safe_fs;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;

pub use inventory::Library;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
    Pi,
    Shared,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    User,
    Project,
}

/// Backend-only input. For Project, root is the project folder; for User, the provider's config
/// folder. Shared roots are the `skills` directory itself. Claude user MCP needs a separate,
/// explicit state-file source because `.claude.json` lives outside the usual `.claude` folder.
#[derive(Debug, Clone)]
pub struct Source {
    pub id: String,
    pub provider: Provider,
    pub scope: Scope,
    pub root: PathBuf,
    pub claude_state_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Skill,
    Instructions,
    McpServer,
    Plugin,
    Package,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ItemRef {
    pub source_id: String,
    pub kind: Kind,
    /// A logical key, never a caller-selected filesystem path.
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Item {
    pub item: ItemRef,
    pub provider: Provider,
    pub scope: Scope,
    pub label: String,
    pub relative_path: String,
    pub revision: String,
    pub bytes: u32,
    pub copy_blocked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SourceStatus {
    pub id: String,
    pub provider: Provider,
    pub scope: Scope,
    pub available: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct Inventory {
    pub sources: Vec<SourceStatus>,
    pub items: Vec<Item>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemPreview {
    pub item: Item,
    pub text: String,
    pub files: Vec<String>,
    pub notices: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The selected configuration source is unavailable.")]
    Unavailable,
    #[error("The configuration path is unsupported, a link, or outside its approved folder.")]
    UnsafePath,
    #[error("The item exceeds the Library's bounded file or folder limits.")]
    Limit,
    #[error("The selected configuration is malformed or uses an unsupported format.")]
    Format,
    #[error("The item changed after it was displayed. Refresh the Library and try again.")]
    Stale,
    #[error("{0}")]
    Unsupported(String),
    #[error("The configuration file could not be read or written. Check folder permissions.")]
    Io,
}

impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        // OS errors and parser excerpts can include private paths or configuration values.
        Self::Io
    }
}

pub type Result<T> = std::result::Result<T, Error>;
