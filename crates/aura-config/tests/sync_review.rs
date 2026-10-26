#![allow(clippy::unwrap_used)] // Synthetic storage and filesystem fixtures only.
use aura_config::{Provider, Scope, Source, sync::*};
use std::{collections::BTreeMap, fs, sync::Mutex};
use zeroize::Zeroizing;

#[derive(Default)]
struct Data {
    heads: BTreeMap<String, ConfigSnapshotHead>,
    bytes: BTreeMap<String, Vec<u8>>,
    device: BTreeMap<String, ConfigDeviceState>,
    writes: usize,
    offline: bool,
}
#[derive(Default)]
struct Port(Mutex<Data>);
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
    fn remote(&self, snapshot: &ConfigSnapshot) -> ConfigSnapshotHead {
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
}
impl ConfigSyncPort for Port {
    fn list_heads(&self) -> ConfigFuture<'_, Vec<ConfigSnapshotRef>> {
        Box::pin(async {
            Ok(self
                .0
                .lock()
                .unwrap()
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
        Box::pin(async move { Ok(self.0.lock().unwrap().heads.get(id).cloned()) })
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
fn fixture() -> (tempfile::TempDir, ConfigScanner, ConfigSnapshot) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("config");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("AGENTS.md"), "local instructions\n").unwrap();
    let scanner = ConfigScanner::new(
        vec![ConfigSource {
            source: Source {
                id: "fixture".into(),
                provider: Provider::Codex,
                scope: Scope::User,
                root,
                claude_state_only: false,
            },
            installed: true,
        }],
        temp.path().join("home"),
        ConfigScope::Windows,
    )
    .unwrap();
    let snapshot = scanner.scan().items.into_values().next().unwrap();
    (temp, scanner, snapshot)
}

#[tokio::test]
async fn explicit_conflict_choices_preserve_both_devices_local_setup_requirements() {
    let (temp, scanner, _) = fixture();
    fs::write(temp.path().join("config/config.toml"),"[mcp_servers.demo]\ncommand = 'fixture-tool'\n[mcp_servers.demo.env]\nLOCAL_KEY = 'synthetic-local-value'\n").unwrap();
    let local = scanner
        .scan()
        .items
        .into_values()
        .find(|item| item.identity.format == ConfigFormat::Mcp)
        .unwrap();
    let mut remote = local.clone();
    remote.local_fields = vec!["env/REMOTE_KEY".into()];
    let port = Port::default();
    port.remote(&remote);
    for choice in [ConfigChoice::KeepLocal, ConfigChoice::UseRemote] {
        let review = prepare_review(&port, &scanner, &local.identity.id().unwrap(), choice)
            .await
            .unwrap();
        assert_eq!(
            review.desired.as_ref().unwrap().local_fields,
            vec!["env/LOCAL_KEY", "env/REMOTE_KEY"]
        );
        assert!(
            !review
                .preview
                .local
                .as_ref()
                .unwrap()
                .contains("synthetic-local-value")
        );
        assert_eq!(port.0.lock().unwrap().writes, 0);
    }
}

#[tokio::test]
async fn codex_plugin_declarations_wait_for_native_installation() {
    let (temp, scanner, _) = fixture();
    fs::write(
        temp.path().join("config/config.toml"),
        "[plugins.'example@market']\nenabled = true\n",
    )
    .unwrap();
    let plugin = scanner
        .scan()
        .items
        .into_values()
        .find(|item| {
            item.identity
                .keys
                .first()
                .is_some_and(|key| key == "plugins")
        })
        .unwrap();
    assert!(plugin.identity.requires_vendor());
    let port = Port::default();
    port.remote(&plugin);
    let review = prepare_review(
        &port,
        &scanner,
        &plugin.identity.id().unwrap(),
        ConfigChoice::UseRemote,
    )
    .await
    .unwrap();
    assert!(!review.preview.can_apply);
    assert_eq!(review.preview.item.operation, ConfigOperation::Wait);
}
#[tokio::test]
async fn inventory_is_read_only_and_first_link_requires_explicit_review_completion() {
    let (_temp, scanner, snapshot) = fixture();
    let port = Port::default();
    let id = snapshot.identity.id().unwrap();
    let view = inventory(&port, &scanner, scanner.scan(), None)
        .await
        .unwrap();
    assert_eq!(view.items[0].operation, ConfigOperation::Publish);
    assert_eq!(port.0.lock().unwrap().writes, 0);
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert!(review.preview.can_apply);
    assert!(review.preview.item.first_link);
    review.revalidate(&port, &scanner).await.unwrap();
    review.complete(&port, &scanner).await.unwrap();
    let data = port.0.lock().unwrap();
    assert_eq!(data.writes, 2);
    assert!(data.device[&id].head.is_some());
}
#[tokio::test]
async fn a_failed_or_partial_local_apply_cannot_advance_the_base() {
    let (temp, scanner, mut remote) = fixture();
    let port = Port::default();
    let id = remote.identity.id().unwrap();
    if let Some(ConfigContent::Files(files)) = &mut remote.content {
        files.get_mut("").unwrap().bytes = b"remote instructions\n".to_vec();
    }
    port.remote(&remote);
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::UseRemote)
        .await
        .unwrap();
    assert_eq!(
        review.complete(&port, &scanner).await.unwrap_err(),
        ConfigPortError::Stale
    );
    assert!(port.0.lock().unwrap().device.is_empty());
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::UseRemote)
        .await
        .unwrap();
    fs::write(
        temp.path().join("config/AGENTS.md"),
        "remote instructions\n",
    )
    .unwrap();
    review.complete(&port, &scanner).await.unwrap();
    assert!(port.0.lock().unwrap().device.contains_key(&id));
}
#[tokio::test]
async fn changed_remote_or_device_decisions_invalidate_reviews() {
    let (_temp, scanner, snapshot) = fixture();
    let port = Port::default();
    let id = snapshot.identity.id().unwrap();
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    port.remote(&snapshot);
    assert_eq!(
        review.revalidate(&port, &scanner).await.unwrap_err(),
        ConfigPortError::Stale
    );
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    set_device_only(&port, &scanner, &id, true).await.unwrap();
    assert_eq!(
        review.revalidate(&port, &scanner).await.unwrap_err(),
        ConfigPortError::Stale
    );
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::KeepLocal)
        .await
        .unwrap();
    assert!(!review.preview.can_apply);
    assert!(review.preview.item.device_only);
}
#[tokio::test]
async fn missing_download_never_becomes_a_remote_delete_or_local_publish() {
    let (_temp, scanner, snapshot) = fixture();
    let port = Port::default();
    let id = snapshot.identity.id().unwrap();
    port.remote(&snapshot);
    port.0.lock().unwrap().offline = true;
    let view = inventory(&port, &scanner, scanner.scan(), None)
        .await
        .unwrap();
    assert_eq!(view.items[0].operation, ConfigOperation::Wait);
    assert!(
        prepare_review(&port, &scanner, &id, ConfigChoice::KeepLocal)
            .await
            .is_err()
    );
    assert_eq!(port.0.lock().unwrap().writes, 0);
}
#[tokio::test]
async fn device_only_can_be_removed_without_deleting_the_last_base() {
    let (_temp, scanner, snapshot) = fixture();
    let port = Port::default();
    let id = snapshot.identity.id().unwrap();
    prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap()
        .complete(&port, &scanner)
        .await
        .unwrap();
    let before = port.0.lock().unwrap().device[&id].snapshot.clone();
    set_device_only(&port, &scanner, &id, true).await.unwrap();
    set_device_only(&port, &scanner, &id, false).await.unwrap();
    assert_eq!(port.0.lock().unwrap().device[&id].snapshot, before);
    assert!(
        set_device_only(&port, &scanner, &"a".repeat(64), true)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn interrupted_application_marks_waiting_without_advancing_base() {
    let (_temp, scanner, snapshot) = fixture();
    let port = Port::default();
    let id = snapshot.identity.id().unwrap();
    prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap()
        .complete(&port, &scanner)
        .await
        .unwrap();
    let before = port.0.lock().unwrap().device[&id].snapshot.clone();
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    review.retain_skipped(&port).await.unwrap();
    let view = inventory(&port, &scanner, scanner.scan(), None)
        .await
        .unwrap();
    assert_eq!(view.items[0].operation, ConfigOperation::Wait);
    assert!(view.items[0].skipped);
    assert_eq!(port.0.lock().unwrap().device[&id].snapshot, before);
}
