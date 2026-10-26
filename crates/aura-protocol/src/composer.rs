//! Explicit composer attachments. Stored identifiers are scoped to a chat by the backend.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComposerAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: u32,
    pub image: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComposerInput {
    pub text: String,
    pub attachments: Vec<String>,
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FileMention {
    pub path: String,
    pub directory: bool,
}
