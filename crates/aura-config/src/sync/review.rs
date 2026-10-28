//! Profile-bound orchestration. Filesystem application is a separate consumed review. Read-only
//! inventory never publishes, advances a base, or treats a missing download as deletion.
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
#[serde(rename = "ConfigSyncChoice")]
pub enum ConfigChoice {
    Automatic,
    KeepLocal,
    UseRemote,
}

/// Why an item is not applied on this device yet. Each has one defined behaviour: the item keeps
/// its last synchronized base, nothing is removed, and the review says what would let it apply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConfigHold {
    /// The agent is not installed here. Its items wait until it is.
    AgentMissing,
    /// The person turned sync off for this agent on this device.
    SyncPaused,
    /// The installed agent is older than the version this feature needs here.
    NeedsVersion {
        feature: String,
        minimum: String,
        found: Option<String>,
    },
    /// A plugin's marketplace is not added here. `source` is a GitHub repository to add it from,
    /// when the other device synchronized one.
    MarketplaceMissing {
        marketplace: String,
        source: Option<String>,
    },
    /// A plugin or package declaration that only the agent's own installer can apply.
    VendorInstall,
    /// It uses paths of another operating system and stays with devices of that system.
    DeviceSpecific { platform: ConfigScope },
    /// An MCP command path that does not exist here. It is never written.
    MissingPath { path: String },
    /// An MCP command auracode will not look up: a network share, a device path, a `..` escape
    /// or another system's form. It is kept for the device it came from and never written here.
    ForeignPath { path: String },
    /// A previous apply or install did not finish; the reason says why.
    Retained { reason: String },
    /// The account could not be reached. The saved state is kept.
    Offline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigVendorKind {
    Marketplace,
    Plugin,
    Package,
}

/// One step of the agent's own reviewed installer that would make a declaration true here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ConfigVendorStep {
    pub provider: Provider,
    pub kind: ConfigVendorKind,
    /// `name@marketplace`, a GitHub `owner/repository` or a package source.
    pub target: String,
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
    pub hold: Option<ConfigHold>,
    /// Another device removed it. Applying removes it here after a confirmed review.
    pub removed_upstream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncInventory {
    pub items: Vec<ConfigSyncItem>,
    pub next_cursor: Option<String>,
    pub notices: Vec<String>,
    /// The account could not be reached: items are local only and nothing is applied.
    pub offline: bool,
    /// Agents whose sync is off on this device (`claude`, `codex`, `pi`). Filled by the host.
    pub paused: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigReceiptStatus {
    Applied,
    RecoveryRequired,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncReceipt {
    pub id: String,
    pub item_id: String,
    pub label: String,
    pub provider: Provider,
    pub status: ConfigReceiptStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfigSyncOutcome {
    pub item_id: String,
    pub receipt_id: Option<String>,
    pub completed: bool,
    pub message: String,
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
    /// The agent's own installer steps, in order, for a declaration it must install itself.
    pub vendor_steps: Vec<ConfigVendorStep>,
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
    let heads = match port.list_heads().await {
        Err(ConfigPortError::Offline) => return Ok(offline(&scan, after)),
        heads => heads?,
    };
    for item in heads {
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
        offline: false,
        paused: Vec::new(),
    };
    for id in ids.iter().take(PAGE_SIZE) {
        let item = match context(port, scanner, id, scan.items.get(id)).await {
            Ok(context) => describe(id, &context, false, scanner)?,
            Err(error) => {
                result.offline |= error == ConfigPortError::Offline;
                ConfigSyncItem {
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
                    skipped: error != ConfigPortError::Offline,
                    detail: Some(error.to_string()),
                    hold: (error == ConfigPortError::Offline).then_some(ConfigHold::Offline),
                    removed_upstream: false,
                }
            }
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
    let mut item = describe(id, &context, true, scanner)?;
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
    // A manual conflict choice selects public content, not permission to remove another device's
    // local setup requirements. Missing private values remain a native apply prerequisite.
    if let Some(result) = &mut decision.result {
        if result.content.is_some() {
            let local = match &context.local {
                LocalSnapshot::Present(value) => Some(value),
                _ => None,
            };
            let requirements = [context.base.as_ref(), local, context.remote.as_ref()]
                .into_iter()
                .flatten()
                .filter(|snapshot| snapshot.content.is_some())
                .flat_map(|snapshot| snapshot.local_fields.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            if result.local_fields != requirements {
                result.local_fields = requirements;
                if matches!(
                    decision.operation,
                    ConfigOperation::Apply | ConfigOperation::InSync
                ) {
                    decision.operation = ConfigOperation::Merge;
                }
            }
        }
        result.encode()?;
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
    if let Some(result) = &decision.result
        && !result.local_fields.is_empty()
    {
        warnings.push(format!(
            "Required setup stays local: {}. Values are never included in sync.",
            result.local_fields.join(", ")
        ));
    }
    if decision.first_link {
        warnings.push("First connection keeps additions from both devices. Missing items are not treated as uninstalls.".into());
    }
    let mut vendor = Vec::new();
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
        if !item.hold.as_ref().is_some_and(blocks) {
            vendor = vendor_steps(
                port,
                scanner,
                &context.identity,
                decision.result.as_ref(),
                &mut item.hold,
            )
            .await;
        }
    }
    if item.device_only {
        warnings.push(
            "This item is kept on this device. Enable sync before reviewing an application.".into(),
        );
    }
    let held = item.hold.as_ref().is_some_and(blocks);
    if let Some(hold) = &item.hold {
        warnings.push(hold_sentence(hold));
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
            && !held
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
        vendor_steps: vendor,
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
        self.retain_with(
            port,
            "The previous apply did not finish. Review its recovery receipt before retrying."
                .into(),
        )
        .await
    }

    async fn retain_with(
        &self,
        port: &dyn ConfigSyncPort,
        reason: String,
    ) -> Result<(), ConfigPortError> {
        let previous = self.device.as_ref();
        let expected = previous
            .and_then(|state| state.head.as_ref())
            .map(|head| head.revision.as_str());
        port.save_device_state(
            &self.preview.item.id,
            expected,
            ConfigDeviceState {
                revision: previous.and_then(|state| state.revision.clone()),
                head: previous.and_then(|state| state.head.clone()),
                snapshot: previous.and_then(|state| state.snapshot.clone()),
                device_only: previous.is_some_and(|state| state.device_only),
                skipped: Some(reason),
            },
        )
        .await
    }

    /// After the agent's own installer ran for the declaration this review offered steps for.
    /// When it succeeded and the declaration is now exactly what was reviewed, the item is
    /// acknowledged like any applied item. Otherwise the declaration is put back to the value the
    /// review saw (if the installer changed it), the item keeps its old base and is marked
    /// retained with the reason, and every other item is left alone.
    pub async fn finish_vendor(
        &self,
        port: &dyn ConfigSyncPort,
        scanner: &ConfigScanner,
        journal: &dyn super::ConfigApplyJournal,
        succeeded: bool,
        failure: Option<String>,
    ) -> Result<ConfigSyncOutcome, ConfigPortError> {
        let desired = self.desired.as_ref().ok_or(ConfigPortError::Invalid)?;
        if !desired.identity.requires_vendor() || self.preview.vendor_steps.is_empty() {
            return Err(ConfigPortError::Invalid);
        }
        let observed = scanner.observe(&desired.identity)?;
        let reached = match &observed {
            LocalSnapshot::Absent => desired.content.is_none(),
            LocalSnapshot::Present(value) => value == desired,
            LocalSnapshot::Unavailable => false,
        };
        let id = self.preview.item.id.clone();
        if succeeded && reached {
            self.acknowledge(port, scanner, false).await?;
            return Ok(ConfigSyncOutcome {
                item_id: id,
                receipt_id: None,
                completed: true,
                message:
                    "Installed with the agent's own command and saved to this Account profile."
                        .into(),
            });
        }
        let mut receipt_id = None;
        let changed = !same_local(&observed, &self.local)
            && !matches!(observed, LocalSnapshot::Unavailable)
            && !matches!(self.local, LocalSnapshot::Unavailable);
        if changed {
            let previous = match &self.local {
                LocalSnapshot::Present(value) => value.clone(),
                _ => ConfigSnapshot::tombstone(desired.identity.clone()),
            };
            if let super::ConfigApplyPreparation::Ready(prepared) =
                scanner.prepare_vendor_restore(previous, &observed)?
            {
                match scanner.apply(*prepared, journal)? {
                    super::ConfigApplyResult::Applied { id } => receipt_id = Some(id),
                    super::ConfigApplyResult::NeedsRecovery { id } => {
                        receipt_id = Some(id);
                    }
                }
            }
        }
        let why = failure.unwrap_or_else(|| {
            if succeeded {
                "The installer finished, but the declaration differs from the review.".into()
            } else {
                "The installer did not finish.".into()
            }
        });
        let message = format!(
            "{why} {}",
            if receipt_id.is_some() {
                "Its declaration was restored to how it was. Other items are unchanged."
            } else {
                "Nothing was changed. Other items are unchanged."
            }
        );
        self.retain_with(port, message.clone()).await?;
        Ok(ConfigSyncOutcome {
            item_id: id,
            receipt_id,
            completed: false,
            message,
        })
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
        &self,
        port: &dyn ConfigSyncPort,
        scanner: &ConfigScanner,
    ) -> Result<(), ConfigPortError> {
        if !self.preview.can_apply {
            return Err(ConfigPortError::Invalid);
        }
        let publish = matches!(
            self.preview.item.operation,
            ConfigOperation::Publish | ConfigOperation::Merge
        );
        self.acknowledge(port, scanner, publish).await
    }

    async fn acknowledge(
        &self,
        port: &dyn ConfigSyncPort,
        scanner: &ConfigScanner,
        publish: bool,
    ) -> Result<(), ConfigPortError> {
        let desired = self.desired.as_ref().ok_or(ConfigPortError::Invalid)?;
        let observed = scanner.observe(&desired.identity)?;
        let complete = match &observed {
            LocalSnapshot::Absent => desired.content.is_none(),
            LocalSnapshot::Present(value) => value == desired,
            LocalSnapshot::Unavailable => false,
        };
        if !complete {
            return Err(ConfigPortError::Stale);
        }
        let encoded = desired.encode()?;
        let id = &self.preview.item.id;
        let head = if publish {
            Some(
                port.publish_snapshot(
                    id,
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
            self.remote_head.clone()
        };
        // An entirely absent first-link item has nothing to publish or acknowledge.
        let Some(head) = head else { return Ok(()) };
        let expected = self
            .device
            .as_ref()
            .and_then(|state| state.head.as_ref())
            .map(|head| head.revision.clone());
        port.save_device_state(
            id,
            expected.as_deref(),
            ConfigDeviceState {
                revision: self
                    .device
                    .as_ref()
                    .and_then(|state| state.revision.clone()),
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

fn describe(
    id: &str,
    context: &Context,
    retry: bool,
    scanner: &ConfigScanner,
) -> Result<ConfigSyncItem, ConfigPortError> {
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
    let reason = context
        .device
        .as_ref()
        .and_then(|state| state.skipped.clone());
    let hold = if device_only {
        None
    } else {
        hold(context, scanner, decision.operation, reason.as_deref())
    };
    Ok(ConfigSyncItem {
        removed_upstream: decision.operation == ConfigOperation::Apply
            && context
                .remote
                .as_ref()
                .is_some_and(|remote| remote.content.is_none()),
        hold: hold.clone(),
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
        } else if let Some(hold) = &hold {
            Some(hold_sentence(hold))
        } else if decision.operation == ConfigOperation::Wait {
            Some("Waiting for this agent, its configuration or a complete download.".into())
        } else {
            None
        },
    })
}
/// The first reason this item is held on this device, in the order a person would fix them.
fn hold(
    context: &Context,
    scanner: &ConfigScanner,
    operation: ConfigOperation,
    skipped: Option<&str>,
) -> Option<ConfigHold> {
    let identity = &context.identity;
    if !identity.applies_on(scanner.platform()) {
        return Some(ConfigHold::DeviceSpecific {
            platform: identity.scope,
        });
    }
    let source = scanner.source(identity);
    match source {
        None => return Some(ConfigHold::AgentMissing),
        Some(source) if !source.installed => return Some(ConfigHold::AgentMissing),
        Some(source) if source.paused => return Some(ConfigHold::SyncPaused),
        Some(_) => {}
    }
    if let Some(reason) = skipped {
        return Some(ConfigHold::Retained {
            reason: reason.into(),
        });
    }
    let incoming = matches!(operation, ConfigOperation::Apply | ConfigOperation::Merge);
    if identity.requires_vendor() && incoming {
        let found = source.and_then(|source| source.version.clone());
        if let Some((feature, minimum)) = feature_floor(identity.provider)
            && found
                .as_deref()
                .is_none_or(|found| !version_at_least(found, minimum))
        {
            return Some(ConfigHold::NeedsVersion {
                feature: feature.into(),
                minimum: minimum.into(),
                found,
            });
        }
        if let Some(marketplace) = plugin_marketplace(identity)
            && scanner.has_marketplace(identity.provider, &marketplace) == Some(false)
        {
            return Some(ConfigHold::MarketplaceMissing {
                marketplace,
                source: None,
            });
        }
        return Some(ConfigHold::VendorInstall);
    }
    if identity.format == super::ConfigFormat::Mcp
        && incoming
        && let Some(ConfigContent::Value(value)) = context
            .remote
            .as_ref()
            .and_then(|remote| remote.content.as_ref())
        && let Some((path, refused)) = scanner.command_problem(value)
    {
        return Some(if refused {
            ConfigHold::ForeignPath { path }
        } else {
            ConfigHold::MissingPath { path }
        });
    }
    None
}

/// The version an agent needs before auracode can run its reviewed plugin or package installer:
/// the same floors as the vendor recipes in aura-agents (`config_vendor::prepare`).
pub fn feature_floor(provider: Provider) -> Option<(&'static str, &'static str)> {
    match provider {
        Provider::Claude => Some(("plugins", "2.1.310")),
        Provider::Codex => Some(("plugins", "0.162.1")),
        Provider::Pi => Some(("packages", "1.0.2")),
        Provider::Shared => None,
    }
}

/// Dotted numeric comparison of the leading version (`2.1.310`, `0.162.1-alpha`). An unreadable
/// version is never treated as new enough.
pub fn version_at_least(found: &str, minimum: &str) -> bool {
    fn parts(value: &str) -> Option<Vec<u64>> {
        let start = value.find(|c: char| c.is_ascii_digit())?;
        let core: String = value[start..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        core.split('.')
            .filter(|part| !part.is_empty())
            .map(|part| part.parse().ok())
            .collect()
    }
    let (Some(mut found), Some(mut minimum)) = (parts(found), parts(minimum)) else {
        return false;
    };
    let width = found.len().max(minimum.len());
    found.resize(width, 0);
    minimum.resize(width, 0);
    found >= minimum
}

/// The marketplace of a plugin declaration: Claude `enabledPlugins/<plugin>@<marketplace>`, Codex
/// `plugins/<plugin>@<marketplace>/...`.
fn plugin_marketplace(identity: &ConfigIdentity) -> Option<String> {
    match identity.keys.first().map(String::as_str) {
        Some("enabledPlugins" | "plugins") => identity
            .keys
            .get(1)?
            .split_once('@')
            .map(|(_, marketplace)| marketplace.to_owned())
            .filter(|marketplace| !marketplace.is_empty()),
        _ => None,
    }
}

/// The installer steps that make an incoming declaration true here, after looking up the
/// marketplace source when the other device synchronized one from GitHub.
async fn vendor_steps(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    identity: &ConfigIdentity,
    desired: Option<&ConfigSnapshot>,
    hold: &mut Option<ConfigHold>,
) -> Vec<ConfigVendorStep> {
    let provider = identity.provider;
    let mut steps = Vec::new();
    if let Some(ConfigHold::MarketplaceMissing {
        marketplace,
        source,
    }) = hold
    {
        *source = marketplace_source(port, identity, marketplace).await;
        if let Some(repository) = source.clone() {
            steps.push(ConfigVendorStep {
                provider,
                kind: ConfigVendorKind::Marketplace,
                target: repository,
            });
        }
    }
    let desired_value = match desired.and_then(|desired| desired.content.as_ref()) {
        Some(ConfigContent::Value(value)) => Some(value),
        _ => None,
    };
    if plugin_marketplace(identity).is_some() {
        let enabled = desired_value.is_some_and(|value| {
            value
                .as_bool()
                .or_else(|| value.get("enabled").and_then(Value::as_bool))
                .unwrap_or(true)
        });
        if enabled && let Some(plugin) = identity.keys.get(1) {
            steps.push(ConfigVendorStep {
                provider,
                kind: ConfigVendorKind::Plugin,
                target: plugin.clone(),
            });
        }
    } else if provider == Provider::Pi
        && identity.keys.first().is_some_and(|key| key == "packages")
        && let Some(Value::Array(packages)) = desired_value
    {
        let local = match scanner.observe(identity) {
            Ok(LocalSnapshot::Present(ConfigSnapshot {
                content: Some(ConfigContent::Value(Value::Array(local))),
                ..
            })) => local,
            _ => Vec::new(),
        };
        for package in packages.iter().filter(|package| !local.contains(package)) {
            if let Some(name) = package
                .as_str()
                .or_else(|| package.get("source").and_then(Value::as_str))
            {
                steps.push(ConfigVendorStep {
                    provider,
                    kind: ConfigVendorKind::Package,
                    target: name.to_owned(),
                });
            }
        }
    }
    steps
}

/// A GitHub `owner/repository` for a marketplace another device declared, read from its own
/// synchronized declaration. Local folders and other hosts give none: they are device-specific.
async fn marketplace_source(
    port: &dyn ConfigSyncPort,
    plugin: &ConfigIdentity,
    marketplace: &str,
) -> Option<String> {
    let (path, format, keys) = match plugin.provider {
        Provider::Claude => (
            "settings.json",
            super::ConfigFormat::Json,
            vec!["extraKnownMarketplaces".to_owned(), marketplace.to_owned()],
        ),
        Provider::Codex => (
            "config.toml",
            super::ConfigFormat::Toml,
            vec![
                "marketplaces".to_owned(),
                marketplace.to_owned(),
                "source".to_owned(),
            ],
        ),
        _ => return None,
    };
    let identity = ConfigIdentity {
        provider: plugin.provider,
        scope: ConfigScope::Portable,
        format,
        path: path.into(),
        keys,
    };
    let id = identity.id().ok()?;
    let head = port.read_head(&id).await.ok()??;
    let bytes = port.read_snapshot(&id, &head).await.ok()?;
    let snapshot = ConfigSnapshot::decode(&bytes, &id).ok()?;
    let Some(ConfigContent::Value(value)) = snapshot.content else {
        return None;
    };
    let text = match plugin.provider {
        Provider::Claude => value
            .get("source")
            .filter(|source| source.get("source").and_then(Value::as_str) == Some("github"))
            .and_then(|source| source.get("repo"))
            .and_then(Value::as_str)?
            .to_owned(),
        _ => value.as_str()?.to_owned(),
    };
    let repository = text
        .trim_start_matches("https://github.com/")
        .trim_end_matches(".git")
        .trim_end_matches('/');
    let mut parts = repository.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return None;
    };
    [owner, name]
        .iter()
        .all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        })
        .then(|| format!("{owner}/{name}"))
}

/// One sentence for a hold, for the review's warnings.
pub fn hold_sentence(hold: &ConfigHold) -> String {
    match hold {
        ConfigHold::AgentMissing => "This agent is not installed on this device. The item waits here and is applied once it is.".into(),
        ConfigHold::SyncPaused => "Sync is off for this agent on this device. Turn it on to apply this item.".into(),
        ConfigHold::NeedsVersion { feature, minimum, found } => format!(
            "The agent here ({}) is older than {minimum}, which {feature} need. Update the agent, then review again.",
            found.as_deref().unwrap_or("an unknown version")
        ),
        ConfigHold::MarketplaceMissing { marketplace, source: Some(source) } => format!(
            "The marketplace {marketplace} is not added on this device. Add it from {source}, then install the plugin."
        ),
        ConfigHold::MarketplaceMissing { marketplace, source: None } => format!(
            "The marketplace {marketplace} is not added on this device, and the other device did not sync where it comes from. Add it with the agent first."
        ),
        ConfigHold::VendorInstall => "The agent's own installer applies this declaration. Run its reviewed command below.".into(),
        ConfigHold::DeviceSpecific { platform } => format!(
            "This item uses {} paths. It stays with devices on that system and is never applied here.",
            match platform {
                ConfigScope::Windows => "Windows",
                ConfigScope::Macos => "macOS",
                ConfigScope::Portable => "portable",
            }
        ),
        ConfigHold::MissingPath { path } => format!(
            "The command {path} does not exist on this device, so this server is not written here."
        ),
        ConfigHold::ForeignPath { path } => format!(
            "The command {path} is a network, device or relative path, so it is not looked up or written here. It stays with the device it came from."
        ),
        ConfigHold::Retained { reason } => reason.clone(),
        ConfigHold::Offline => "The account cannot be reached. The last synchronized state is kept until you are back online.".into(),
    }
}

/// Holds that stop an apply here. A retained item can be reviewed again, and installer holds stop
/// through the installer path.
fn blocks(hold: &ConfigHold) -> bool {
    !matches!(
        hold,
        ConfigHold::Retained { .. }
            | ConfigHold::VendorInstall
            | ConfigHold::MarketplaceMissing { .. }
    )
}

/// The account is unreachable: list what this device has, held, and apply nothing.
fn offline(scan: &ConfigScan, after: Option<&str>) -> ConfigSyncInventory {
    let items: Vec<_> = scan
        .items
        .iter()
        .filter(|(id, _)| after.is_none_or(|after| id.as_str() > after))
        .take(PAGE_SIZE)
        .map(|(id, snapshot)| ConfigSyncItem {
            id: id.clone(),
            label: label(&snapshot.identity),
            provider: Some(snapshot.identity.provider),
            scope: Some(snapshot.identity.scope),
            operation: ConfigOperation::Wait,
            first_link: false,
            device_only: false,
            skipped: false,
            detail: Some(hold_sentence(&ConfigHold::Offline)),
            hold: Some(ConfigHold::Offline),
            removed_upstream: false,
        })
        .collect();
    let next_cursor = (scan
        .items
        .keys()
        .filter(|id| after.is_none_or(|after| id.as_str() > after))
        .count()
        > PAGE_SIZE)
        .then(|| items.last().map(|item| item.id.clone()))
        .flatten();
    ConfigSyncInventory {
        items,
        next_cursor,
        notices: vec![hold_sentence(&ConfigHold::Offline)],
        offline: true,
        paused: Vec::new(),
    }
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
