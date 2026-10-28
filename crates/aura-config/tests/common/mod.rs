//! Synthetic sync port, managed store and journal for the per-agent sync tests. No network and no
//! real agent home: every fixture lives in a temporary folder.
#![allow(dead_code, clippy::unwrap_used)]
use aura_config::sync::*;
use std::{collections::BTreeMap, sync::Mutex};
use zeroize::Zeroizing;

#[derive(Default)]
pub struct Data {
    pub heads: BTreeMap<String, ConfigSnapshotHead>,
    pub bytes: BTreeMap<String, Vec<u8>>,
    pub device: BTreeMap<String, ConfigDeviceState>,
    pub writes: usize,
    /// The account cannot be reached at all.
    pub offline: bool,
}

#[derive(Default)]
pub struct Port(pub Mutex<Data>);

fn state_clone(state: &ConfigDeviceState) -> ConfigDeviceState {
    ConfigDeviceState {
        revision: state.revision.clone(),
        head: state.head.clone(),
        snapshot: state.snapshot.clone(),
        device_only: state.device_only,
        skipped: state.skipped.clone(),
    }
}

impl Port {
    /// What another device published.
    pub fn remote(&self, snapshot: &ConfigSnapshot) -> ConfigSnapshotHead {
        let id = snapshot.identity.id().unwrap();
        let bytes = snapshot.encode().unwrap();
        let mut data = self.0.lock().unwrap();
        let head = ConfigSnapshotHead {
            revision: uuid::Uuid::now_v7().to_string(),
            content_hash: "fixture".into(),
            blob_id: "fixture".into(),
            schema: 1,
            deleted: snapshot.content.is_none(),
        };
        data.heads.insert(id.clone(), head.clone());
        data.bytes.insert(id, bytes.to_vec());
        head
    }
    pub fn skipped(&self, id: &str) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .device
            .get(id)
            .and_then(|state| state.skipped.clone())
    }
    pub fn all_bytes(&self) -> Vec<u8> {
        self.0
            .lock()
            .unwrap()
            .bytes
            .values()
            .flatten()
            .copied()
            .collect()
    }
}

impl ConfigSyncPort for Port {
    fn list_heads(&self) -> ConfigFuture<'_, Vec<ConfigSnapshotRef>> {
        Box::pin(async {
            let data = self.0.lock().unwrap();
            if data.offline {
                return Err(ConfigPortError::Offline);
            }
            Ok(data
                .heads
                .iter()
                .map(|(id, head)| ConfigSnapshotRef {
                    id: id.clone(),
                    head: head.clone(),
                })
                .collect())
        })
    }
    fn read_head<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigSnapshotHead>> {
        Box::pin(async move {
            let data = self.0.lock().unwrap();
            if data.offline {
                return Err(ConfigPortError::Offline);
            }
            Ok(data.heads.get(id).cloned())
        })
    }
    fn read_snapshot<'a>(
        &'a self,
        id: &'a str,
        _head: &'a ConfigSnapshotHead,
    ) -> ConfigFuture<'a, Zeroizing<Vec<u8>>> {
        Box::pin(async move {
            let data = self.0.lock().unwrap();
            if data.offline {
                return Err(ConfigPortError::Offline);
            }
            data.bytes
                .get(id)
                .cloned()
                .map(Zeroizing::new)
                .ok_or(ConfigPortError::Invalid)
        })
    }
    fn publish_snapshot<'a>(
        &'a self,
        id: &'a str,
        expected: Option<&'a str>,
        snapshot: Zeroizing<Vec<u8>>,
        _metadata: ConfigSnapshotMetadata,
    ) -> ConfigFuture<'a, ConfigSnapshotHead> {
        Box::pin(async move {
            let value = ConfigSnapshot::decode(&snapshot, id)?;
            {
                let mut data = self.0.lock().unwrap();
                if data.heads.get(id).map(|head| head.revision.as_str()) != expected {
                    return Err(ConfigPortError::Stale);
                }
                data.writes += 1;
            }
            Ok(self.remote(&value))
        })
    }
    fn list_device_ids(&self) -> ConfigFuture<'_, Vec<String>> {
        Box::pin(async { Ok(self.0.lock().unwrap().device.keys().cloned().collect()) })
    }
    fn read_device_state<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigDeviceState>> {
        Box::pin(async move { Ok(self.0.lock().unwrap().device.get(id).map(state_clone)) })
    }
    fn save_device_state<'a>(
        &'a self,
        id: &'a str,
        expected: Option<&'a str>,
        mut state: ConfigDeviceState,
    ) -> ConfigFuture<'a, ()> {
        Box::pin(async move {
            let mut data = self.0.lock().unwrap();
            let old = data.device.get(id);
            if old.and_then(|state| state.revision.as_ref()) != state.revision.as_ref()
                || old
                    .and_then(|state| state.head.as_ref())
                    .map(|head| head.revision.as_str())
                    != expected
            {
                return Err(ConfigPortError::Stale);
            }
            state.revision = Some(uuid::Uuid::now_v7().to_string());
            data.device.insert(id.into(), state);
            data.writes += 1;
            Ok(())
        })
    }
}

pub struct Managed(Mutex<Vec<u8>>);
impl Default for Managed {
    fn default() -> Self {
        Self(Mutex::new(
            managed::ManagedDocument::default()
                .encode()
                .unwrap()
                .to_vec(),
        ))
    }
}
fn hash(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}
impl managed::ConfigManagedStore for Managed {
    fn load(&self) -> Result<managed::ManagedRead, ConfigPortError> {
        let bytes = self.0.lock().unwrap();
        Ok(managed::ManagedRead {
            revision: hash(&bytes),
            document: managed::ManagedDocument::decode(&bytes)?,
        })
    }
    fn save(
        &self,
        expected: &str,
        document: &managed::ManagedDocument,
    ) -> Result<(), ConfigPortError> {
        let mut bytes = self.0.lock().unwrap();
        if hash(&bytes) != expected {
            return Err(ConfigPortError::Stale);
        }
        *bytes = document.encode()?.to_vec();
        Ok(())
    }
}

/// `fail_after`: the number of receipts created before every later create fails, to stop one
/// item's transaction before it writes anything.
#[derive(Default)]
pub struct Journal {
    pub items: Mutex<BTreeMap<String, Vec<u8>>>,
    pub fail_after: Mutex<Option<usize>>,
}
impl ConfigApplyJournal for Journal {
    fn create(&self, id: &str, bytes: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError> {
        let mut items = self.items.lock().unwrap();
        if self
            .fail_after
            .lock()
            .unwrap()
            .is_some_and(|limit| items.len() >= limit)
        {
            return Err(ConfigPortError::Storage);
        }
        if items.contains_key(id) {
            return Err(ConfigPortError::Stale);
        }
        items.insert(id.into(), bytes.to_vec());
        Ok(())
    }
    fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.items
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .map(Zeroizing::new)
            .ok_or(ConfigPortError::Invalid)
    }
    fn replace(
        &self,
        id: &str,
        expected: &str,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<(), ConfigPortError> {
        let mut items = self.items.lock().unwrap();
        if items.get(id).map(|item| hash(item)).as_deref() != Some(expected) {
            return Err(ConfigPortError::Stale);
        }
        items.insert(id.into(), bytes.to_vec());
        Ok(())
    }
    fn list(&self) -> Result<Vec<String>, ConfigPortError> {
        Ok(self.items.lock().unwrap().keys().cloned().collect())
    }
}
