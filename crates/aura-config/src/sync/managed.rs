//! Explicit account ownership of selected configuration. A merge base alone never claims a path.
//! The entire bounded document is atomically encrypted by the host, including pending claims.
use super::{ConfigPortError, ConfigSnapshot, LocalSnapshot, MAX_SYNC_ITEMS};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

pub const MAX_MANAGED_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedItem {
    /// The original device content before this Account first claimed this item. A tombstone means
    /// no item existed. This baseline never changes during normal synchronization.
    pub baseline: ConfigSnapshot,
    /// Last explicitly completed Account content, or a safe outgoing snapshot at profile switch.
    pub saved: ConfigSnapshot,
    pub committed: bool,
    pub pending: Option<PendingClaim>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingClaim {
    pub token: String,
    pub desired_hash: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedDocument {
    pub schema: u32,
    pub items: BTreeMap<String, ManagedItem>,
}
impl Default for ManagedDocument {
    fn default() -> Self {
        Self {
            schema: 1,
            items: BTreeMap::new(),
        }
    }
}
pub struct ManagedRead {
    pub revision: String,
    pub document: ManagedDocument,
}
/// Bound to one unlocked Account. Neither callers nor IPC supply encryption keys or filenames.
/// `save` checks SHA-256 of exact prior encoded bytes and durably replaces one encrypted record.
/// Missing/corrupt state is Invalid, never an empty document. `open` alone may initialize a fresh
/// empty directory; a failed acknowledgment must not be reported as a completed claim/switch.
pub trait ConfigManagedStore: Send + Sync {
    fn load(&self) -> Result<ManagedRead, ConfigPortError>;
    fn save(
        &self,
        expected_revision: &str,
        document: &ManagedDocument,
    ) -> Result<(), ConfigPortError>;
}

impl ManagedDocument {
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.validate()?;
        let bytes = Zeroizing::new(serde_json::to_vec(self).map_err(|_| ConfigPortError::Invalid)?);
        if bytes.len() > MAX_MANAGED_BYTES {
            return Err(ConfigPortError::Limit);
        }
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, ConfigPortError> {
        if bytes.len() > MAX_MANAGED_BYTES {
            return Err(ConfigPortError::Limit);
        }
        let document: Self = serde_json::from_slice(bytes).map_err(|_| ConfigPortError::Invalid)?;
        document.validate()?;
        Ok(document)
    }
    fn validate(&self) -> Result<(), ConfigPortError> {
        if self.schema != 1 || self.items.len() > MAX_SYNC_ITEMS {
            return Err(ConfigPortError::Invalid);
        }
        for (id, item) in &self.items {
            item.baseline.encode()?;
            item.saved.encode()?;
            if item.baseline.identity != item.saved.identity || item.baseline.identity.id()? != *id
            {
                return Err(ConfigPortError::Invalid);
            }
            if let Some(pending) = &item.pending
                && (uuid::Uuid::parse_str(&pending.token).is_err()
                    || pending.desired_hash.len() != 64
                    || !pending
                        .desired_hash
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit()))
            {
                return Err(ConfigPortError::Invalid);
            }
        }
        Ok(())
    }
    pub fn has_pending(&self) -> bool {
        self.items.values().any(|item| item.pending.is_some())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigClaim {
    pub id: String,
    pub token: String,
}

pub fn snapshot_hash(snapshot: &ConfigSnapshot) -> Result<String, ConfigPortError> {
    Ok(crate::safe_fs::hash(&snapshot.encode()?))
}
/// Must run before any apply/publication/base advancement. The caller holds profile, Library
/// mutation and maintenance admission throughout prepare, operation and commit (or recovery).
pub fn prepare_claim(
    store: &dyn ConfigManagedStore,
    local: &LocalSnapshot,
    desired: &ConfigSnapshot,
) -> Result<ConfigClaim, ConfigPortError> {
    let id = desired.identity.id()?;
    let current = match local {
        LocalSnapshot::Present(snapshot) if snapshot.identity == desired.identity => {
            snapshot.clone()
        }
        LocalSnapshot::Absent => ConfigSnapshot::tombstone(desired.identity.clone()),
        _ => return Err(ConfigPortError::Unavailable),
    };
    let mut read = store.load()?;
    let item = read
        .document
        .items
        .entry(id.clone())
        .or_insert_with(|| ManagedItem {
            baseline: current.clone(),
            saved: current.clone(),
            committed: false,
            pending: None,
        });
    if item.pending.is_some() {
        return Err(ConfigPortError::Stale);
    }
    // A canceled, never-committed first claim owns nothing and may capture a fresh baseline.
    if !item.committed {
        item.baseline = current.clone();
        item.saved = current;
    }
    let token = uuid::Uuid::now_v7().to_string();
    item.pending = Some(PendingClaim {
        token: token.clone(),
        desired_hash: snapshot_hash(desired)?,
    });
    store.save(&read.revision, &read.document)?;
    Ok(ConfigClaim { id, token })
}
/// Call only after the exact desired files and merge base were acknowledged. Failure retains the
/// pending marker and the original baseline. No caller may declare a successful profile switch.
pub fn commit_claim(
    store: &dyn ConfigManagedStore,
    claim: &ConfigClaim,
    desired: &ConfigSnapshot,
) -> Result<(), ConfigPortError> {
    let mut read = store.load()?;
    let item = read
        .document
        .items
        .get_mut(&claim.id)
        .ok_or(ConfigPortError::Stale)?;
    if desired.identity.id()? != claim.id
        || item.pending.as_ref().is_none_or(|pending| {
            pending.token != claim.token
                || snapshot_hash(desired).as_deref() != Ok(pending.desired_hash.as_str())
        })
    {
        return Err(ConfigPortError::Stale);
    }
    item.saved = desired.clone();
    item.committed = true;
    item.pending = None;
    store.save(&read.revision, &read.document)
}
/// Cancel only when the host proved no filesystem/publication/base action began, or after a
/// verified rollback. A generic failure/timeout is not proof and must retain its pending marker.
pub fn cancel_claim(
    store: &dyn ConfigManagedStore,
    claim: &ConfigClaim,
) -> Result<(), ConfigPortError> {
    let mut read = store.load()?;
    let item = read
        .document
        .items
        .get_mut(&claim.id)
        .ok_or(ConfigPortError::Stale)?;
    if item
        .pending
        .as_ref()
        .is_none_or(|pending| pending.token != claim.token)
    {
        return Err(ConfigPortError::Stale);
    }
    item.pending = None;
    store.save(&read.revision, &read.document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Provider,
        sync::{ConfigContent, ConfigFormat, ConfigIdentity, ConfigScope},
    };
    use std::sync::Mutex;
    struct Memory {
        bytes: Mutex<Vec<u8>>,
        fail: Mutex<bool>,
    }
    impl Memory {
        fn new() -> Self {
            Self {
                bytes: Mutex::new(ManagedDocument::default().encode().unwrap().to_vec()),
                fail: Mutex::new(false),
            }
        }
    }
    impl ConfigManagedStore for Memory {
        fn load(&self) -> Result<ManagedRead, ConfigPortError> {
            let bytes = self.bytes.lock().unwrap();
            Ok(ManagedRead {
                revision: crate::safe_fs::hash(&bytes),
                document: ManagedDocument::decode(&bytes)?,
            })
        }
        fn save(&self, expected: &str, document: &ManagedDocument) -> Result<(), ConfigPortError> {
            let mut bytes = self.bytes.lock().unwrap();
            if crate::safe_fs::hash(&bytes) != expected {
                return Err(ConfigPortError::Stale);
            }
            if *self.fail.lock().unwrap() {
                return Err(ConfigPortError::Storage);
            }
            *bytes = document.encode()?.to_vec();
            Ok(())
        }
    }
    fn snapshot(value: &str) -> ConfigSnapshot {
        ConfigSnapshot {
            schema: 1,
            identity: ConfigIdentity {
                provider: Provider::Claude,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Json,
                path: "settings.json".into(),
                keys: vec!["model".into()],
            },
            content: Some(ConfigContent::Value(value.into())),
            local_fields: vec![],
        }
    }
    #[test]
    fn first_claim_preserves_baseline_and_later_claims_only_replace_saved_account_content() {
        let store = Memory::new();
        let baseline = snapshot("local");
        let account = snapshot("account-a");
        let claim =
            prepare_claim(&store, &LocalSnapshot::Present(baseline.clone()), &account).unwrap();
        assert!(store.load().unwrap().document.has_pending());
        commit_claim(&store, &claim, &account).unwrap();
        let second = snapshot("account-b");
        let claim = prepare_claim(&store, &LocalSnapshot::Present(account), &second).unwrap();
        commit_claim(&store, &claim, &second).unwrap();
        let read = store.load().unwrap();
        let item = &read.document.items[&claim.id];
        assert!(item.committed);
        assert!(item.baseline == baseline);
        assert!(item.saved == second);
        assert!(!read.document.has_pending());
    }
    #[test]
    fn pending_claim_blocks_reentry_and_failed_commit_retains_recovery_evidence() {
        let store = Memory::new();
        let desired = snapshot("account");
        let claim = prepare_claim(&store, &LocalSnapshot::Absent, &desired).unwrap();
        assert_eq!(
            prepare_claim(&store, &LocalSnapshot::Absent, &desired).unwrap_err(),
            ConfigPortError::Stale
        );
        assert_eq!(
            commit_claim(&store, &claim, &snapshot("different")),
            Err(ConfigPortError::Stale)
        );
        *store.fail.lock().unwrap() = true;
        assert_eq!(
            commit_claim(&store, &claim, &desired),
            Err(ConfigPortError::Storage)
        );
        assert!(store.load().unwrap().document.has_pending());
        *store.fail.lock().unwrap() = false;
        cancel_claim(&store, &claim).unwrap();
        let local = snapshot("new-unmanaged-content");
        let retry =
            prepare_claim(&store, &LocalSnapshot::Present(local.clone()), &desired).unwrap();
        assert!(store.load().unwrap().document.items[&retry.id].baseline == local);
    }
    #[test]
    fn unavailable_future_and_mismatched_identity_state_is_never_an_empty_baseline() {
        let store = Memory::new();
        let desired = snapshot("account");
        assert_eq!(
            prepare_claim(&store, &LocalSnapshot::Unavailable, &desired).unwrap_err(),
            ConfigPortError::Unavailable
        );
        assert!(ManagedDocument::decode(br#"{"schema":2,"items":{}}"#).is_err());
        let mut document = ManagedDocument::default();
        document.items.insert(
            "wrong".into(),
            ManagedItem {
                baseline: desired.clone(),
                saved: desired,
                committed: true,
                pending: None,
            },
        );
        assert!(document.encode().is_err());
    }
}
