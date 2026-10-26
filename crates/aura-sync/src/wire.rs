//! Cloud API v1 DTOs. API timestamps are Unix seconds; record HLCs contain milliseconds.
use crate::crypto::{self, KeyEnvelope};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// An opaque bearer token, never serialized back into a UI response or diagnostic string.
pub struct SessionToken(Zeroizing<String>);
impl SessionToken {
    pub fn parse(value: String) -> Result<Self, crypto::CryptoError> {
        let value = Zeroizing::new(value);
        if crypto::decode(&value, 32)?.len() != 32 {
            return Err(crypto::CryptoError::Invalid);
        }
        Ok(Self(value))
    }
    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}
impl std::fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionToken([REDACTED])")
    }
}
impl<'de> Deserialize<'de> for SessionToken {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Challenge {
    pub challenge_id: String,
    pub expires_in: u32,
    pub resend_after: u32,
}
#[derive(Deserialize)]
pub struct VerifiedSession {
    pub user_id: String,
    pub expires_at: i64,
    pub token: SessionToken,
}
#[derive(Clone, Deserialize)]
pub struct Session {
    pub user_id: String,
    pub client_kind: String,
    pub device_id: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Windows,
    Macos,
}
#[derive(Debug, Clone, Deserialize)]
pub struct RegisteredDevice {
    pub device_id: String,
    pub verification_code: String,
    pub approved: bool,
}
#[derive(Debug, Clone, Deserialize)]
pub struct RebindChallenge {
    pub challenge_id: String,
    pub device_id: String,
    pub envelope: KeyEnvelope,
    pub expires_in: u32,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub public_key: String,
    pub verification_code: String,
    pub created_at: i64,
    pub last_seen: i64,
    pub approved_at: Option<i64>,
    pub revoked_at: Option<i64>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Keys {
    pub key_version: u32,
    pub recovery_envelope: KeyEnvelope,
    pub wrapped_key: Option<KeyEnvelope>,
    pub approved_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedRecord {
    pub collection: String,
    pub id: String,
    pub hlc: String,
    pub deleted: bool,
    pub nonce: String,
    pub ciphertext: String,
    pub key_version: u32,
}
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Change {
    pub server_seq: u64,
    pub device_id: String,
    #[serde(flatten)]
    pub record: EncryptedRecord,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Pull {
    pub records: Vec<Change>,
    pub next_cursor: u64,
    pub has_more: bool,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Heads {
    pub heads: Vec<Change>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Blob {
    pub etag: String,
    pub nonce: String,
    pub key_version: u32,
    pub size_bytes: u64,
    pub ciphertext: String,
}
