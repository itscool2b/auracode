//! Explicit composer attachments. Stored identifiers are scoped to a chat by the backend.
use serde::{Deserialize, Serialize};
use specta::Type;

crate::lenient::lenient_enum! {
    /// Pending after a crash or a closed turn is unconfirmed, never proof of delivery.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
    #[serde(rename_all = "snake_case")]
    pub enum SteeringState {
        Pending = "pending",
        Accepted = "accepted",
        Rejected = "rejected",
        Unconfirmed = "unconfirmed",
    }
    fallback = Unconfirmed;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SteeringAck {
    pub message_id: String,
    pub state: SteeringState,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComposerAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: u32,
    pub image: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComposerInput {
    pub text: String,
    pub attachments: Vec<String>,
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComposerDraft {
    pub input: ComposerInput,
    pub files: Vec<ComposerAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FileMention {
    pub path: String,
    pub directory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ProjectFilePreview {
    pub path: String,
    pub bytes: u64,
    pub text: Option<String>,
    pub truncated: bool,
}
