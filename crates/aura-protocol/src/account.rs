//! Account UI data. Bearers, private keys and encrypted key envelopes never cross this boundary.
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Millis;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountConfiguration {
    pub service_origin: String,
    pub verification_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AccountVaultMode {
    Native,
    PassphraseLocked,
    PassphraseUnlocked,
    RestartRequired,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountVaultStatus {
    pub mode: AccountVaultMode,
    pub can_create: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountResetStatus {
    pub pending: bool,
    pub committed: bool,
}
#[derive(Serialize, Deserialize, Type)]
pub struct AccountResetReview {
    pub id: String,
    pub key_version: u32,
    pub records: u32,
    pub blobs: u32,
    pub other_devices: u32,
    pub recovery_key: String,
}
impl std::fmt::Debug for AccountResetReview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountResetReview")
            .field("id", &self.id)
            .field("key_version", &self.key_version)
            .field("recovery_key", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AccountAccess {
    SignedOut,
    VerificationRequired,
    NeedsDevice,
    NeedsFirstKey,
    PendingApproval,
    VerifyAccountKey,
    Ready,
    Expired,
    Denied,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountStatus {
    pub access: AccountAccess,
    pub account_id: Option<String>,
    pub device_id: Option<String>,
    /// An opaque local profile, available only after a locally trusted key exists.
    pub profile_id: Option<String>,
    pub local_key_available: bool,
    /// Computed from this device's own public key, never trusted from the server.
    pub approval_code: Option<String>,
    /// Compare this with the trusted approving device before confirming a new remote key.
    pub fingerprint: Option<String>,
    pub sync: AccountSyncStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AccountSyncState {
    Inactive,
    Idle,
    Syncing,
    Offline,
    Paused,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountSyncStatus {
    pub state: AccountSyncState,
    pub pending_changes: Option<u32>,
    // The wire is JSON number; the runtime bounds account timestamps to the exact JS range.
    #[specta(type = Option<specta_typescript::Number>)]
    pub last_sync_at: Option<Millis>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SignInChallenge {
    pub id: String,
    pub expires_in: u32,
    pub resend_after: u32,
}

/// The recovery key is intentionally shown only in response to an explicit setup action. Keep it
/// in transient UI memory, never diagnostics, analytics, URLs or frontend persistence.
#[derive(Serialize, Deserialize, Type)]
pub struct RecoverySetup {
    pub id: String,
    pub recovery_key: String,
}
impl std::fmt::Debug for RecoverySetup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecoverySetup")
            .field("id", &self.id)
            .field("recovery_key", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub verification_code: String,
    pub current: bool,
    #[specta(type = specta_typescript::Number)]
    pub created_at: Millis,
    #[specta(type = specta_typescript::Number)]
    pub last_seen: Millis,
    #[specta(type = Option<specta_typescript::Number>)]
    pub approved_at: Option<Millis>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub revoked_at: Option<Millis>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AccountFailureCode {
    InvalidInput,
    InvalidState,
    Offline,
    TimedOut,
    Unauthorized,
    Deleted,
    Forbidden,
    InvalidCode,
    Conflict,
    Quota,
    RateLimited,
    DeliveryFailed,
    Unavailable,
    NotFound,
    Protocol,
    SecureStorage,
    LocalStorage,
    KeyMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountFailure {
    pub code: AccountFailureCode,
    pub message: String,
    pub retry_after_seconds: Option<u32>,
}
impl std::fmt::Display for AccountFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for AccountFailure {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AccountSignOut {
    pub status: AccountStatus,
    /// False means the local session is removed, but remote revocation could not be confirmed.
    pub server_revoked: bool,
}
