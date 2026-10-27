//! Explicit preservation of an unlocked Account workspace in a separate unencrypted Local profile.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct KeepLocalPreview {
    pub token: String,
    pub projects: u32,
    pub chats: u32,
    pub turns: u32,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct KeepLocalResult {
    pub profile_id: String,
    pub display_name: String,
    pub projects: u32,
    pub chats: u32,
    pub turns: u32,
    pub missing_attachments: u32,
}
