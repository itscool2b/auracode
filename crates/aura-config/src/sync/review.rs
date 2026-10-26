//! Profile-bound orchestration. Filesystem application is a separate consumed review. Read-only
//! inventory never publishes, advances a base, or treats a missing download as deletion.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};

use super::{
    ConfigContent, ConfigDeviceState, ConfigIdentity, ConfigOperation, ConfigPortError, ConfigScan,
    ConfigScanner, ConfigScope, ConfigSnapshot, ConfigSnapshotHead, ConfigSnapshotMetadata,
    ConfigSyncPort, LocalSnapshot, MAX_SYNC_ITEMS, merge,
};
use crate::Provider;

const PAGE_SIZE: usize = 40;
const PREVIEW_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigChoice {
    Automatic,
    KeepLocal,
    UseRemote,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncItem {
    pub id: String,
    pub label: String,
    pub provider: Option<Provider>,
    pub scope: Option<ConfigScope>,
    pub operation: ConfigOperation,
    pub first_link: bool,
    pub device_only: bool,
    pub skipped: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncInventory {
    pub items: Vec<ConfigSyncItem>,
    pub next_cursor: Option<String>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncPreview {
    pub token: String,
    pub item: ConfigSyncItem,
    pub choice: ConfigChoice,
    pub base: Option<String>,
    pub local: Option<String>,
    pub remote: Option<String>,
    pub result: Option<String>,
    pub conflicts: Vec<String>,
    pub deletes_item: bool,
    pub can_apply: bool,
    pub warnings: Vec<String>,
}

pub struct PreparedConfigReview {
    pub preview: ConfigSyncPreview,
    pub local: LocalSnapshot,
    pub desired: Option<ConfigSnapshot>,
    pub remote_head: Option<ConfigSnapshotHead>,
    pub device: Option<ConfigDeviceState>,
}

struct Context {
    identity: ConfigIdentity,
    base: Option<ConfigSnapshot>,
    remote: Option<ConfigSnapshot>,
    remote_head: Option<ConfigSnapshotHead>,
    local: LocalSnapshot,
    device: Option<ConfigDeviceState>,
}

/// The host runs blocking scans off the UI thread, and holds active-profile admission while this
/// future runs. Only one page's content is decoded at a time; the returned inventory holds no bytes.
pub async fn inventory(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    scan: ConfigScan,
    after: Option<&str>,
) -> Result<ConfigSyncInventory, ConfigPortError> {
    if after.is_some_and(|id| !valid_id(id)) {
        return Err(ConfigPortError::Invalid);
    }
    let mut ids: BTreeSet<String> = scan.items.keys().cloned().collect();
    for item in port.list_heads().await? {
        if !valid_id(&item.id) {
            return Err(ConfigPortError::Invalid);
        }
        ids.insert(item.id);
    }
    for id in port.list_device_ids().await? {
        if !valid_id(&id) {
            return Err(ConfigPortError::Invalid);
        }
        ids.insert(id);
    }
    if ids.len() > MAX_SYNC_ITEMS {
        return Err(ConfigPortError::Limit);
    }
    let ids: Vec<_> = ids
        .into_iter()
        .filter(|id| after.is_none_or(|after| id.as_str() > after))
        .collect();
    let mut result = ConfigSyncInventory {
        items: Vec::new(),
        next_cursor: None,
        notices: scan
            .skipped
            .iter()
            .map(|item| format!("{:?}: {}", item.provider, item.reason))
            .collect(),
    };
    for id in ids.iter().take(PAGE_SIZE) {
        let item = match context(port, scanner, id, scan.items.get(id)).await {
            Ok(context) => describe(id, &context, false)?,
            Err(error) => ConfigSyncItem {
                id: id.clone(),
                label: scan.items.get(id).map_or_else(
                    || "Configuration awaiting download".into(),
                    |item| label(&item.identity),
                ),
                provider: scan.items.get(id).map(|item| item.identity.provider),
                scope: scan.items.get(id).map(|item| item.identity.scope),
                operation: ConfigOperation::Wait,
                first_link: false,
                device_only: false,
                skipped: true,
                detail: Some(error.to_string()),
            },
        };
        result.items.push(item);
    }
    if ids.len() > PAGE_SIZE {
        result.next_cursor = result.items.last().map(|item| item.id.clone());
    }
    Ok(result)
}

pub async fn prepare_review(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    id: &str,
    choice: ConfigChoice,
) -> Result<PreparedConfigReview, ConfigPortError> {
    if !valid_id(id) {
        return Err(ConfigPortError::Invalid);
    }
    let scan = scanner.scan();
    let context = context(port, scanner, id, scan.items.get(id)).await?;
    let mut item = describe(id, &context, true)?;
    let mut decision = merge(
        context.base.as_ref(),
        &context.local,
        context.remote.as_ref(),
    )?;
    let unavailable = matches!(context.local, LocalSnapshot::Unavailable) || item.device_only;
    if !unavailable {
        match choice {
            ConfigChoice::Automatic => {}
            ConfigChoice::KeepLocal => {
                decision.result = Some(match &context.local {
                    LocalSnapshot::Present(value) => value.clone(),
                    LocalSnapshot::Absent => ConfigSnapshot::tombstone(context.identity.clone()),
                    LocalSnapshot::Unavailable => return Err(ConfigPortError::Unavailable),
                });
                decision.operation = ConfigOperation::Publish;
                decision.conflicts.clear();
            }
            ConfigChoice::UseRemote => {
                decision.result = Some(context.remote.clone().ok_or(ConfigPortError::Unavailable)?);
                decision.operation = ConfigOperation::Apply;
                decision.conflicts.clear();
            }
        }
    }
    item.operation = if unavailable {
        ConfigOperation::Wait
    } else {
        decision.operation
    };
    let mut warnings = vec![
        "Review the full change before applying. Configuration can change what an agent executes."
            .into(),
    ];
    if decision.first_link {
        warnings.push("First connection keeps additions from both devices. Missing items are not treated as uninstalls.".into());
    }
    if context.identity.requires_vendor()
        && matches!(
            item.operation,
            ConfigOperation::Apply | ConfigOperation::Merge
        )
    {
        item.operation = ConfigOperation::Wait;
        item.detail = Some(
            "Use the agent's reviewed installation workflow for this package declaration.".into(),
        );
    }
    if item.device_only {
        warnings.push(
            "This item is kept on this device. Enable sync before reviewing an application.".into(),
        );
    }
    let preview = ConfigSyncPreview {
        token: uuid::Uuid::now_v7().to_string(),
        item,
        choice,
        base: display(context.base.as_ref()),
        local: display(match &context.local {
            LocalSnapshot::Present(value) => Some(value),
            _ => None,
        }),
        remote: display(context.remote.as_ref()),
        result: display(decision.result.as_ref()),
        conflicts: decision.conflicts,
        deletes_item: decision
            .result
            .as_ref()
            .is_some_and(|item| item.content.is_none()),
        can_apply: !unavailable
            && !matches!(
                decision.operation,
                ConfigOperation::Conflict | ConfigOperation::Wait
            )
            && !(context.identity.requires_vendor()
                && matches!(
                    decision.operation,
                    ConfigOperation::Apply | ConfigOperation::Merge
                )),
        warnings,
    };
    Ok(PreparedConfigReview {
        preview,
        local: context.local,
        desired: decision.result,
        remote_head: context.remote_head,
        device: context.device,
    })
}

impl PreparedConfigReview {
    /// Mark a failed or partial application without changing its base. This prevents incomplete
    /// local state from being interpreted as an uninstall during subsequent automatic discovery.
    pub async fn retain_skipped(&self, port: &dyn ConfigSyncPort) -> Result<(), ConfigPortError> {
        let previous = self.device.as_ref();
        let expected = previous
            .and_then(|state| state.head.as_ref())
            .map(|head| head.revision.as_str());
        port.save_device_state(&self.preview.item.id, expected, ConfigDeviceState {
            revision:previous.and_then(|state|state.revision.clone()),
            head:previous.and_then(|state|state.head.clone()),
            snapshot:previous.and_then(|state|state.snapshot.clone()),
            device_only:previous.is_some_and(|state|state.device_only),
            skipped:Some("The previous apply did not finish. Review its recovery receipt before retrying.".into()),
        }).await
    }
    /// Recheck immediately before consuming a filesystem review, while holding the configuration
    /// mutation guard. A later remote pull remains mergeable against the exact applied base.
    pub async fn revalidate(
        &self,
        port: &dyn ConfigSyncPort,
        scanner: &ConfigScanner,
    ) -> Result<(), ConfigPortError> {
        let id = &self.preview.item.id;
        if port.read_head(id).await? != self.remote_head {
            return Err(ConfigPortError::Stale);
        }
        let device = port.read_device_state(id).await?;
        if device.as_ref().and_then(|state| state.revision.as_deref())
            != self
                .device
                .as_ref()
                .and_then(|state| state.revision.as_deref())
        {
            return Err(ConfigPortError::Stale);
        }
        let desired = self.desired.as_ref().ok_or(ConfigPortError::Invalid)?;
        if !same_local(&scanner.observe(&desired.identity)?, &self.local) {
            return Err(ConfigPortError::Stale);
        }
        Ok(())
    }

    /// Call only after every required local file action completed. Failed or skipped applies must
    /// retain the old base. Publication and base CAS failures remain visible, with the receipt kept.
    pub async fn complete(
        self,
        port: &dyn ConfigSyncPort,
        scanner: &ConfigScanner,
    ) -> Result<(), ConfigPortError> {
        if !self.preview.can_apply {
            return Err(ConfigPortError::Invalid);
        }
        let desired = self.desired.ok_or(ConfigPortError::Invalid)?;
        let observed = scanner.observe(&desired.identity)?;
        let complete = match &observed {
            LocalSnapshot::Absent => desired.content.is_none(),
            LocalSnapshot::Present(value) => value == &desired,
            LocalSnapshot::Unavailable => false,
        };
        if !complete {
            return Err(ConfigPortError::Stale);
        }
        let encoded = desired.encode()?;
        let id = self.preview.item.id;
        let head = if matches!(
            self.preview.item.operation,
            ConfigOperation::Publish | ConfigOperation::Merge
        ) {
            Some(
                port.publish_snapshot(
                    &id,
                    self.remote_head.as_ref().map(|head| head.revision.as_str()),
                    encoded.clone(),
                    ConfigSnapshotMetadata {
                        schema: desired.schema,
                        scope: desired.identity.scope,
                        deleted: desired.content.is_none(),
                    },
                )
                .await?,
            )
        } else {
            self.remote_head
        };
        // An entirely absent first-link item has nothing to publish or acknowledge.
        let Some(head) = head else { return Ok(()) };
        let expected = self
            .device
            .as_ref()
            .and_then(|state| state.head.as_ref())
            .map(|head| head.revision.clone());
        port.save_device_state(
            &id,
            expected.as_deref(),
            ConfigDeviceState {
                revision: self.device.and_then(|state| state.revision),
                head: Some(head),
                snapshot: Some(encoded),
                device_only: false,
                skipped: None,
            },
        )
        .await
    }
}

pub async fn set_device_only(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    id: &str,
    device_only: bool,
) -> Result<(), ConfigPortError> {
    if !valid_id(id) {
        return Err(ConfigPortError::Invalid);
    }
    if port.read_head(id).await?.is_none()
        && port.read_device_state(id).await?.is_none()
        && !scanner.scan().items.contains_key(id)
    {
        return Err(ConfigPortError::Invalid);
    }
    let mut state = port
        .read_device_state(id)
        .await?
        .unwrap_or(ConfigDeviceState {
            revision: None,
            head: None,
            snapshot: None,
            device_only: false,
            skipped: None,
        });
    let expected = state.head.as_ref().map(|head| head.revision.clone());
    state.device_only = device_only;
    port.save_device_state(id, expected.as_deref(), state).await
}

async fn context(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    id: &str,
    local: Option<&ConfigSnapshot>,
) -> Result<Context, ConfigPortError> {
    let remote_head = port.read_head(id).await?;
    let device = port.read_device_state(id).await?;
    let remote = if let Some(head) = &remote_head {
        let bytes = port.read_snapshot(id, head).await?;
        let value = ConfigSnapshot::decode(&bytes, id)?;
        if value.schema != head.schema || value.content.is_none() != head.deleted {
            return Err(ConfigPortError::Invalid);
        }
        Some(value)
    } else {
        None
    };
    let base = device
        .as_ref()
        .and_then(|state| state.snapshot.as_ref())
        .map(|bytes| ConfigSnapshot::decode(bytes, id))
        .transpose()?;
    if let Some(head) = device.as_ref().and_then(|state| state.head.as_ref()) {
        if base
            .as_ref()
            .is_none_or(|base| base.schema != head.schema || base.content.is_none() != head.deleted)
        {
            return Err(ConfigPortError::Invalid);
        }
    } else if base.is_some() {
        return Err(ConfigPortError::Invalid);
    }
    let identity = local
        .or(remote.as_ref())
        .or(base.as_ref())
        .map(|value| value.identity.clone())
        .ok_or(ConfigPortError::Unavailable)?;
    let local = scanner.observe(&identity)?;
    Ok(Context {
        identity,
        base,
        remote,
        remote_head,
        local,
        device,
    })
}

fn describe(id: &str, context: &Context, retry: bool) -> Result<ConfigSyncItem, ConfigPortError> {
    let device_only = context
        .device
        .as_ref()
        .is_some_and(|state| state.device_only);
    let skipped = context
        .device
        .as_ref()
        .is_some_and(|state| state.skipped.is_some());
    let unavailable = LocalSnapshot::Unavailable;
    let local = if device_only || skipped && !retry {
        &unavailable
    } else {
        &context.local
    };
    let decision = merge(context.base.as_ref(), local, context.remote.as_ref())?;
    Ok(ConfigSyncItem {
        id: id.into(),
        label: label(&context.identity),
        provider: Some(context.identity.provider),
        scope: Some(context.identity.scope),
        operation: decision.operation,
        first_link: decision.first_link,
        device_only,
        skipped,
        detail: if device_only {
            Some("Kept on this device.".into())
        } else if skipped {
            context
                .device
                .as_ref()
                .and_then(|state| state.skipped.clone())
        } else if decision.operation == ConfigOperation::Wait {
            Some("Waiting for this agent, its configuration or a complete download.".into())
        } else {
            None
        },
    })
}
fn label(identity: &ConfigIdentity) -> String {
    if identity.keys.is_empty() {
        identity.path.clone()
    } else {
        format!("{} · {}", identity.path, identity.keys.join(" / "))
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn same_local(left: &LocalSnapshot, right: &LocalSnapshot) -> bool {
    match (left, right) {
        (LocalSnapshot::Present(left), LocalSnapshot::Present(right)) => left == right,
        (LocalSnapshot::Absent, LocalSnapshot::Absent) => true,
        _ => false,
    }
}
fn display(snapshot: Option<&ConfigSnapshot>) -> Option<String> {
    let snapshot = snapshot?;
    let Some(content) = &snapshot.content else {
        return Some("Item deleted".into());
    };
    let mut text = match content {
        ConfigContent::Value(value) => serde_json::to_string_pretty(value).unwrap_or_default(),
        ConfigContent::Files(files) => display_files(files),
    };
    if text.len() > PREVIEW_BYTES {
        let mut boundary = PREVIEW_BYTES;
        while !text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        text.truncate(boundary);
        text.push_str(
            "\n[Preview shortened. The complete bounded item remains in the reviewed snapshot.]",
        );
    }
    Some(text)
}
fn display_files(files: &BTreeMap<String, super::ConfigFile>) -> String {
    let mut output = String::new();
    for (path, file) in files {
        if output.len() > PREVIEW_BYTES {
            break;
        }
        if !path.is_empty() {
            output.push_str(&format!("\n{path}\n"));
        }
        match std::str::from_utf8(&file.bytes) {
            Ok(text) => output.push_str(text),
            Err(_) => output.push_str(&format!("[Binary file, {} bytes]", file.bytes.len())),
        }
        output.push('\n');
    }
    output
}
