//! Configuration sync boundary. The active account runtime owns encryption, the network and local
//! encrypted persistence. This crate receives no account key, bearer or vault handle.

use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

mod apply;
mod edit;
mod mcp;
mod merge;
mod review;
mod scan;
mod snapshot;

pub use apply::{
    ConfigApplyJournal, ConfigApplyPreparation, ConfigApplyPreview, ConfigApplyRecord,
    ConfigApplyResult, ConfigApplyStatus, MAX_APPLY_RECEIPT_BYTES, MAX_APPLY_RECEIPTS,
    PreparedConfigApply,
};
pub use merge::{ConfigDecision, ConfigOperation, LocalSnapshot, merge};
pub use review::{
    ConfigChoice, ConfigReceiptStatus, ConfigSyncInventory, ConfigSyncItem, ConfigSyncOutcome,
    ConfigSyncPreview, ConfigSyncReceipt, PreparedConfigReview, inventory, prepare_review,
    set_device_only,
};
pub use scan::{ConfigScan, ConfigScanner, ConfigSkipped, ConfigSource};
pub use snapshot::{ConfigContent, ConfigFile, ConfigFormat, ConfigIdentity, ConfigSnapshot};

/// A single item snapshot fits below the authenticated cloud blob plaintext limit. Larger bundles
/// stay explicitly skipped rather than being interpreted as a deleted item.
pub const MAX_SNAPSHOT_BYTES: usize = 3 * 1024 * 1024;
pub const MAX_SYNC_ITEMS: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigScope {
    Portable,
    Windows,
    Macos,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigSnapshotMetadata {
    pub schema: u32,
    pub scope: ConfigScope,
    /// A tombstone is explicit. Empty valid content is never a deletion.
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigSnapshotHead {
    pub revision: String,
    pub content_hash: String,
    pub blob_id: String,
    pub schema: u32,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigSnapshotRef {
    /// Local logical ID only. The account port derives a keyed opaque ID for its wire record.
    pub id: String,
    pub head: ConfigSnapshotHead,
}

/// Per-device merge base. Snapshot contents stay in the encrypted profile, never the agent's
/// configuration folder or a plaintext sidecar. The port zeroizes returned bytes when dropped.
pub struct ConfigDeviceState {
    /// Opaque local state revision returned by read and echoed on save. None means create-only;
    /// this also detects changes to device-only/skipped flags when the merge base is unchanged.
    pub revision: Option<String>,
    pub head: Option<ConfigSnapshotHead>,
    pub snapshot: Option<Zeroizing<Vec<u8>>>,
    pub device_only: bool,
    pub skipped: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ConfigPortError {
    #[error("Open an unlocked Account profile to sync configuration.")]
    Unavailable,
    #[error("The account is offline. Its saved configuration state is retained.")]
    Offline,
    #[error("Configuration changed after review. Refresh and review again.")]
    Stale,
    #[error("Configuration sync exceeded its bounded item or snapshot limit.")]
    Limit,
    #[error("The configuration snapshot could not be authenticated or decoded.")]
    Invalid,
    #[error("Configuration sync state could not be saved. Its previous merge base is retained.")]
    Storage,
}

pub type ConfigFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ConfigPortError>> + Send + 'a>>;

/// This port is bound to one active Account profile and device, not selected by an IPC argument.
/// Head metadata, scopes, logical IDs and snapshot payloads are encrypted before leaving the device.
/// All lists are capped at MAX_SYNC_ITEMS, payloads at MAX_SNAPSHOT_BYTES. Missing heads are not
/// tombstones. A locally committed publish remains in the durable outbox until acknowledged.
pub trait ConfigSyncPort: Send + Sync {
    fn list_heads(&self) -> ConfigFuture<'_, Vec<ConfigSnapshotRef>>;
    fn read_head<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigSnapshotHead>>;
    /// Authenticate against this exact item/head and verify content_hash before returning bytes.
    fn read_snapshot<'a>(
        &'a self,
        id: &'a str,
        head: &'a ConfigSnapshotHead,
    ) -> ConfigFuture<'a, Zeroizing<Vec<u8>>>;
    /// None means create only. The writer atomically checks the expected revision, stores the
    /// authenticated head and enqueues the publication. It never silently overwrites a newer pull.
    fn publish_snapshot<'a>(
        &'a self,
        id: &'a str,
        expected_revision: Option<&'a str>,
        snapshot: Zeroizing<Vec<u8>>,
        metadata: ConfigSnapshotMetadata,
    ) -> ConfigFuture<'a, ConfigSnapshotHead>;

    fn list_device_ids(&self) -> ConfigFuture<'_, Vec<String>>;
    fn read_device_state<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigDeviceState>>;
    /// Only advance a base after every reviewed file action succeeds. Partial copies and skipped
    /// applications retain the old base so absence cannot become a remote uninstall.
    fn save_device_state<'a>(
        &'a self,
        id: &'a str,
        expected_head: Option<&'a str>,
        state: ConfigDeviceState,
    ) -> ConfigFuture<'a, ()>;
}
