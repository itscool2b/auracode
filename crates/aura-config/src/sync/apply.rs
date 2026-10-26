//! Reviewed filesystem transactions. Durable payloads belong to the encrypted active profile.
use zeroize::Zeroizing;

use super::{
    ConfigContent, ConfigFile, ConfigFormat, ConfigIdentity, ConfigPortError, ConfigScanner,
    ConfigSkipped, ConfigSnapshot, LocalSnapshot, edit, scan,
};
use crate::{Source, inventory, safe_fs};
use cap_std::fs::Dir;
use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

mod files;
mod receipt;
use receipt::{Mutation, Receipt, State};

pub const MAX_APPLY_RECEIPT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_APPLY_RECEIPTS: usize = 256;

/// Bound to one unlocked profile, never selected by an IPC argument. Implementations encrypt both
/// receipts and their UUID index, authenticate previous data and serialize index/CAS mutations.
/// `create` must durably save the receipt and index before returning. A missing `read` is Invalid.
/// Receipt hashes are lowercase SHA-256 of the exact returned plaintext bytes. No plaintext
/// receipt, snapshot, or backup may be written into the Account profile or vendor directories.
/// The caller retains the profile and filesystem mutation guards through completion or recovery.
pub trait ConfigApplyJournal: Send + Sync {
    fn create(&self, id: &str, receipt: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError>;
    fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError>;
    fn replace(
        &self,
        id: &str,
        expected_hash: &str,
        receipt: Zeroizing<Vec<u8>>,
    ) -> Result<(), ConfigPortError>;
    fn list(&self) -> Result<Vec<String>, ConfigPortError>;
}

#[derive(Debug, Clone)]
pub struct ConfigApplyPreview {
    pub id: String,
    pub identity: ConfigIdentity,
    pub paths: Vec<String>,
    pub deletes_item: bool,
}

pub enum ConfigApplyPreparation {
    Ready(Box<PreparedConfigApply>),
    Skipped(ConfigSkipped),
}

pub struct PreparedConfigApply {
    preview: ConfigApplyPreview,
    receipt: Receipt,
    root: Dir,
    source: Source,
    created: Instant,
}

impl PreparedConfigApply {
    pub fn preview(&self) -> &ConfigApplyPreview {
        &self.preview
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigApplyResult {
    Applied {
        id: String,
    },
    /// Files may have changed. Retain the old merge base and offer explicit rollback/recovery.
    NeedsRecovery {
        id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigApplyStatus {
    RecoveryRequired,
    Applied,
    RolledBack,
}

#[derive(Debug, Clone)]
pub struct ConfigApplyRecord {
    pub id: String,
    pub identity: ConfigIdentity,
    pub status: ConfigApplyStatus,
    pub restores: Option<String>,
}

impl ConfigScanner {
    /// Metadata only. Snapshot bytes, private document fields and local absolute roots never reach
    /// this history. Unavailable devices may still display a retained recovery receipt.
    pub fn apply_history(
        &self,
        journal: &dyn ConfigApplyJournal,
    ) -> Result<Vec<ConfigApplyRecord>, ConfigPortError> {
        let ids = journal.list()?;
        if ids.len() > MAX_APPLY_RECEIPTS {
            return Err(ConfigPortError::Limit);
        }
        let mut seen = std::collections::HashSet::new();
        let mut history = Vec::new();
        for id in ids {
            if !receipt::valid_id(&id) || !seen.insert(id.clone()) {
                return Err(ConfigPortError::Invalid);
            }
            let receipt = Receipt::decode(&id, &journal.read(&id)?)?;
            history.push(ConfigApplyRecord {
                id,
                identity: receipt.identity.clone(),
                restores: receipt.restores.clone(),
                status: match receipt.state {
                    State::Prepared => ConfigApplyStatus::RecoveryRequired,
                    State::Applied => ConfigApplyStatus::Applied,
                    State::RolledBack => ConfigApplyStatus::RolledBack,
                },
            });
        }
        Ok(history)
    }
    /// A preparation is consumed by apply and expires after ten minutes. No files are changed here.
    /// The host must hold its config maintenance guard from review consumption through completion.
    pub fn prepare_apply(
        &self,
        desired: ConfigSnapshot,
        expected: &LocalSnapshot,
    ) -> Result<ConfigApplyPreparation, ConfigPortError> {
        desired.encode()?;
        let id = &desired.identity;
        let skip = |reason: &str| {
            Ok(ConfigApplyPreparation::Skipped(ConfigSkipped {
                provider: id.provider,
                identity: Some(id.clone()),
                reason: reason.into(),
            }))
        };
        if !id.applies_on(self.platform) {
            return skip("This configuration belongs to another operating system.");
        }
        if id.requires_vendor() {
            return skip("Use the agent's reviewed installation workflow for this declaration.");
        }
        let Some(source) = self.source(id) else {
            return skip("This configuration source is not available on this device.");
        };
        if !source.installed {
            return skip("Install this agent to apply its waiting configuration.");
        }
        if matches!(expected, LocalSnapshot::Unavailable) {
            return skip("This local item could not be inspected and is retained.");
        }
        let current = self.observe(id)?;
        if !same_local(&current, expected) {
            return Err(ConfigPortError::Stale);
        }
        let root = inventory::open(&source.source).map_err(|_| ConfigPortError::Unavailable)?;
        let raw = scan::read_content(&root, id).map_err(|_| ConfigPortError::Invalid)?;
        let observed_raw = match &raw {
            None => LocalSnapshot::Absent,
            Some(content) => {
                let (mut identity, content, local_fields) =
                    self.normalize(id.clone(), content.clone())?;
                if identity.scope == super::ConfigScope::Portable {
                    identity.scope = id.scope;
                }
                LocalSnapshot::Present(ConfigSnapshot {
                    schema: 1,
                    identity,
                    content: Some(content),
                    local_fields,
                })
            }
        };
        if !same_local(&observed_raw, expected) {
            return Err(ConfigPortError::Stale);
        }
        let mut content = desired.content.clone();
        if let Some(ConfigContent::Value(value)) = &mut content {
            edit::expand_home(value, self.home.to_str().ok_or(ConfigPortError::Invalid)?);
        }
        // Authenticated foreign metadata can still lie about its OS scope. Normalize the actual
        // expanded payload before any write, using the same rules as discovery.
        if let Some(content) = &content {
            let (mut observed, normalized, _) = self.normalize(id.clone(), content.clone())?;
            if observed.scope == super::ConfigScope::Portable {
                observed.scope = id.scope;
            }
            if observed != *id || Some(normalized) != desired.content {
                return Err(ConfigPortError::Invalid);
            }
        }
        if id.format == ConfigFormat::Mcp {
            // Keep the exact local spelling of unchanged routing fields. Expanding a portable home
            // path must not falsely appear to redirect credentials because of slash differences.
            if let (
                Some(ConfigContent::Value(local)),
                Some(ConfigContent::Value(public)),
                Some(ConfigContent::Value(desired_value)),
            ) = (&raw, &mut content, &desired.content)
            {
                let (_, ConfigContent::Value(normalized), _) =
                    self.normalize(id.clone(), ConfigContent::Value(local.clone()))?
                else {
                    return Err(ConfigPortError::Invalid);
                };
                for key in ["command", "args", "url", "type"] {
                    if normalized.get(key) == desired_value.get(key) {
                        let object = public.as_object_mut().ok_or(ConfigPortError::Invalid)?;
                        if let Some(value) = local.get(key) {
                            object.insert(key.into(), value.clone());
                        } else {
                            object.remove(key);
                        }
                    }
                }
            }
            let local = match &raw {
                Some(ConfigContent::Value(value)) => Some(value),
                _ => None,
            };
            if content.is_some()
                && local
                    .map(|value| super::mcp::project(value, id.provider))
                    .transpose()
                    .map_err(|_| ConfigPortError::Invalid)?
                    .is_some_and(|(_, fields)| {
                        fields
                            .iter()
                            .any(|field| desired.local_fields.binary_search(field).is_err())
                    })
            {
                return skip(
                    "This MCP server has additional local setup requirements. Refresh its merge review before applying.",
                );
            }
            let public = match &content {
                Some(ConfigContent::Value(value)) => Some(value),
                _ => None,
            };
            content = match super::mcp::preserve(public, local, &desired.local_fields, id.provider)
            {
                Ok(value) => value.map(ConfigContent::Value),
                Err(_) => {
                    return skip(
                        "This MCP server needs local setup, or this change would redirect or remove its private settings. Review it in the agent's configuration.",
                    );
                }
            };
        }
        let mutations = mutations(&root, id, raw.as_ref(), content.as_ref())?;
        let mut names = std::collections::HashSet::new();
        if mutations
            .iter()
            .any(|file| !names.insert(file.path.to_lowercase()))
        {
            return skip("This item contains filenames that collide on a supported filesystem.");
        }
        if self.platform == super::ConfigScope::Windows
            && mutations
                .iter()
                .any(|file| file.after.as_ref().is_some_and(|file| file.executable))
        {
            return skip(
                "This item requires executable permissions that this operating system cannot preserve.",
            );
        }
        let receipt = Receipt {
            id: uuid::Uuid::now_v7().to_string(),
            source: source.source.id.clone(),
            realm: realm(&source.source)?,
            identity: id.clone(),
            state: State::Prepared,
            restores: None,
            files: mutations,
        };
        // Check the complete receipt limit before returning a review, including unselected local
        // document bytes, which are retained only inside the encrypted rollback payload.
        receipt.encode()?;
        Ok(ConfigApplyPreparation::Ready(Box::new(
            PreparedConfigApply {
                preview: ConfigApplyPreview {
                    id: receipt.id.clone(),
                    identity: id.clone(),
                    paths: receipt.files.iter().map(|file| file.path.clone()).collect(),
                    deletes_item: desired.content.is_none(),
                },
                receipt,
                root,
                source: source.source.clone(),
                created: Instant::now(),
            },
        )))
    }

    pub fn apply(
        &self,
        prepared: PreparedConfigApply,
        journal: &dyn ConfigApplyJournal,
    ) -> Result<ConfigApplyResult, ConfigPortError> {
        if prepared.created.elapsed() > Duration::from_secs(600) {
            return Err(ConfigPortError::Stale);
        }
        if !prepared.receipt.identity.applies_on(self.platform)
            || self
                .source(&prepared.receipt.identity)
                .is_none_or(|current| !current.installed || current.source != prepared.source)
        {
            return Err(ConfigPortError::Stale);
        }
        self.check_root(&prepared.source, &prepared.root, &prepared.receipt)?;
        check_files(&prepared.root, &prepared.receipt.files)?;
        // Also detect new or removed dependencies not in the reviewed tree's changed-file list.
        if prepared.receipt.identity.format == ConfigFormat::Tree {
            let actual = scan::read_content(&prepared.root, &prepared.receipt.identity)
                .map_err(|_| ConfigPortError::Stale)?;
            let expected = tree_before(&prepared.receipt);
            if actual != expected {
                return Err(ConfigPortError::Stale);
            }
        }
        self.execute(prepared.source, prepared.root, prepared.receipt, journal)
    }

    fn check_root(
        &self,
        source: &Source,
        root: &Dir,
        receipt: &Receipt,
    ) -> Result<(), ConfigPortError> {
        let current = self
            .source(&receipt.identity)
            .filter(|source| source.installed)
            .ok_or(ConfigPortError::Unavailable)?;
        if current.source != *source
            || !receipt.identity.applies_on(self.platform)
            || receipt.identity.requires_vendor()
            || realm(source)? != receipt.realm
        {
            return Err(ConfigPortError::Stale);
        }
        let reopened = inventory::open(source).map_err(|_| ConfigPortError::Stale)?;
        if files::identity(&reopened).map_err(|_| ConfigPortError::Storage)?
            != files::identity(root).map_err(|_| ConfigPortError::Storage)?
        {
            return Err(ConfigPortError::Stale);
        }
        Ok(())
    }

    fn execute(
        &self,
        source: Source,
        root: Dir,
        mut receipt: Receipt,
        journal: &dyn ConfigApplyJournal,
    ) -> Result<ConfigApplyResult, ConfigPortError> {
        let bytes = receipt.encode()?;
        let hash = safe_fs::hash(&bytes);
        journal.create(&receipt.id, bytes)?;
        let work = || -> Result<(), ConfigPortError> {
            let stage =
                files::create_stage(&root, &receipt).map_err(|_| ConfigPortError::Storage)?;
            for (index, mutation) in receipt.files.iter().enumerate() {
                self.check_root(&source, &root, &receipt)?;
                if mutation.before != mutation.after {
                    files::mutate(&root, &stage, index, mutation)
                        .map_err(|_| ConfigPortError::Storage)?;
                }
            }
            drop(stage);
            self.check_root(&source, &root, &receipt)?;
            for mutation in &receipt.files {
                if files::read(&root, &mutation.path).map_err(|_| ConfigPortError::Storage)?
                    != mutation.after
                {
                    return Err(ConfigPortError::Stale);
                }
            }
            files::prune(&root, &receipt).map_err(|_| ConfigPortError::Storage)?;
            files::cleanup(&root, &receipt, false).map_err(|_| ConfigPortError::Storage)?;
            Ok(())
        };
        if work().is_err() {
            return Ok(ConfigApplyResult::NeedsRecovery {
                id: receipt.id.clone(),
            });
        }
        receipt.state = State::Applied;
        if journal
            .replace(&receipt.id, &hash, receipt.encode()?)
            .is_err()
        {
            return Ok(ConfigApplyResult::NeedsRecovery {
                id: receipt.id.clone(),
            });
        }
        Ok(ConfigApplyResult::Applied {
            id: receipt.id.clone(),
        })
    }

    /// Explicit recovery is durable and restartable. User edits to selected files/values block
    /// rollback; unrelated JSON/TOML values are preserved. The inverse has its own encrypted receipt.
    pub fn rollback_apply(
        &self,
        id: &str,
        journal: &dyn ConfigApplyJournal,
    ) -> Result<ConfigApplyResult, ConfigPortError> {
        if !receipt::valid_id(id) {
            return Err(ConfigPortError::Invalid);
        }
        let bytes = journal.read(id)?;
        let hash = safe_fs::hash(&bytes);
        let mut original = Receipt::decode(id, &bytes)?;
        if original.state == State::RolledBack {
            return Ok(ConfigApplyResult::Applied { id: id.into() });
        }
        let source = self
            .source(&original.identity)
            .filter(|source| source.installed)
            .ok_or(ConfigPortError::Unavailable)?
            .source
            .clone();
        if source.id != original.source {
            return Err(ConfigPortError::Stale);
        }
        let root = inventory::open(&source).map_err(|_| ConfigPortError::Unavailable)?;
        self.check_root(&source, &root, &original)?;
        // A crash may have displaced a file without publishing its replacement. Its verified old
        // inode can be restored without overwriting any new file. Unknown stage data is retained.
        files::cleanup(&root, &original, true).map_err(|_| ConfigPortError::Stale)?;
        let mut inverse = Vec::new();
        for mutation in &original.files {
            let current = files::read(&root, &mutation.path).map_err(|_| ConfigPortError::Stale)?;
            if current == mutation.before {
                continue;
            }
            let before = if original.identity.format == ConfigFormat::Mcp
                && current != mutation.after
            {
                let Some(current) = &current else {
                    return Err(ConfigPortError::Stale);
                };
                let selected = |file: &Option<ConfigFile>| {
                    edit::selected(
                        file.as_ref().map_or(&[], |file| file.bytes.as_slice()),
                        &original.identity,
                    )
                    .map_err(|_| ConfigPortError::Stale)
                };
                let current_value = selected(&Some(current.clone()))?;
                let before_value = selected(&mutation.before)?;
                let after_value = selected(&mutation.after)?;
                let project = |value: Option<&serde_json::Value>| {
                    value
                        .map(|value| super::mcp::project(value, original.identity.provider))
                        .transpose()
                        .map_err(|_| ConfigPortError::Stale)
                };
                let current_public = project(current_value.as_ref())?.map(|(value, _)| value);
                let before_public = project(before_value.as_ref())?;
                if current_public == before_public.as_ref().map(|(value, _)| value.clone()) {
                    continue;
                }
                if current_public != project(after_value.as_ref())?.map(|(value, _)| value) {
                    return Err(ConfigPortError::Stale);
                }
                let (public, required) = before_public
                    .map_or((None, Vec::new()), |(value, fields)| (Some(value), fields));
                let restored = super::mcp::preserve(
                    public.as_ref(),
                    current_value.as_ref(),
                    &required,
                    original.identity.provider,
                )
                .map_err(|_| ConfigPortError::Stale)?;
                Some(ConfigFile {
                    bytes: edit::document(&current.bytes, &original.identity, restored.as_ref())
                        .map_err(|_| ConfigPortError::Stale)?,
                    executable: current.executable,
                })
            } else if matches!(
                original.identity.format,
                ConfigFormat::Json | ConfigFormat::Toml | ConfigFormat::Mcp
            ) && current != mutation.after
            {
                let Some(current) = &current else {
                    return Err(ConfigPortError::Stale);
                };
                let selected = |file: &Option<ConfigFile>| -> Result<Option<serde_json::Value>,ConfigPortError> {
                    edit::selected(file.as_ref().map_or(&[],|file| file.bytes.as_slice()),&original.identity).map_err(|_| ConfigPortError::Stale)
                };
                let selected_current = selected(&Some(current.clone()))?;
                if selected_current == selected(&mutation.before)? {
                    continue;
                }
                if selected_current != selected(&mutation.after)? {
                    return Err(ConfigPortError::Stale);
                }
                Some(ConfigFile {
                    bytes: edit::document(
                        &current.bytes,
                        &original.identity,
                        selected(&mutation.before)?.as_ref(),
                    )
                    .map_err(|_| ConfigPortError::Invalid)?,
                    executable: current.executable,
                })
            } else {
                if current != mutation.after {
                    return Err(ConfigPortError::Stale);
                }
                mutation.before.clone()
            };
            inverse.push(Mutation {
                path: mutation.path.clone(),
                before: current,
                after: before,
            });
        }
        if !inverse.is_empty() {
            let receipt = Receipt {
                id: uuid::Uuid::now_v7().to_string(),
                source: source.id.clone(),
                realm: original.realm.clone(),
                identity: original.identity.clone(),
                state: State::Prepared,
                restores: Some(id.into()),
                files: inverse,
            };
            if let result @ ConfigApplyResult::NeedsRecovery { .. } =
                self.execute(source, root, receipt, journal)?
            {
                return Ok(result);
            }
        }
        original.state = State::RolledBack;
        if journal.replace(id, &hash, original.encode()?).is_err() {
            return Ok(ConfigApplyResult::NeedsRecovery { id: id.into() });
        }
        Ok(ConfigApplyResult::Applied { id: id.into() })
    }
}

fn same_local(left: &LocalSnapshot, right: &LocalSnapshot) -> bool {
    match (left, right) {
        (LocalSnapshot::Absent, LocalSnapshot::Absent) => true,
        (LocalSnapshot::Present(left), LocalSnapshot::Present(right)) => left == right,
        _ => false,
    }
}

fn realm(source: &Source) -> Result<String, ConfigPortError> {
    std::fs::canonicalize(&source.root)
        .map_err(|_| ConfigPortError::Unavailable)?
        .to_str()
        .map(str::to_owned)
        .ok_or(ConfigPortError::Invalid)
}

fn check_files(root: &Dir, files: &[Mutation]) -> Result<(), ConfigPortError> {
    for mutation in files {
        if self::files::read(root, &mutation.path).map_err(|_| ConfigPortError::Stale)?
            != mutation.before
        {
            return Err(ConfigPortError::Stale);
        }
    }
    Ok(())
}

fn tree_before(receipt: &Receipt) -> Option<ConfigContent> {
    let prefix = format!("{}/", receipt.identity.path);
    let files: BTreeMap<_, _> = receipt
        .files
        .iter()
        .filter_map(|mutation| {
            mutation.before.as_ref().map(|file| {
                (
                    mutation
                        .path
                        .strip_prefix(&prefix)
                        .unwrap_or_default()
                        .into(),
                    file.clone(),
                )
            })
        })
        .collect();
    (!files.is_empty()).then_some(ConfigContent::Files(files))
}

fn mutations(
    root: &Dir,
    id: &ConfigIdentity,
    before: Option<&ConfigContent>,
    after: Option<&ConfigContent>,
) -> Result<Vec<Mutation>, ConfigPortError> {
    if matches!(
        id.format,
        ConfigFormat::Json | ConfigFormat::Toml | ConfigFormat::Mcp
    ) {
        let old = files::read(root, &id.path).map_err(|_| ConfigPortError::Invalid)?;
        let expected_selected = match before {
            Some(ConfigContent::Value(value)) => Some(value.clone()),
            None => None,
            _ => return Err(ConfigPortError::Invalid),
        };
        if edit::selected(old.as_ref().map_or(&[], |file| file.bytes.as_slice()), id)
            .map_err(|_| ConfigPortError::Invalid)?
            != expected_selected
        {
            return Err(ConfigPortError::Stale);
        }
        let value = match after {
            Some(ConfigContent::Value(value)) => Some(value),
            None => None,
            _ => return Err(ConfigPortError::Invalid),
        };
        let bytes = edit::document(
            old.as_ref().map_or(&[], |file| file.bytes.as_slice()),
            id,
            value,
        )
        .map_err(|_| ConfigPortError::Invalid)?;
        let new = if old.is_none() && value.is_none() {
            None
        } else {
            Some(ConfigFile {
                bytes,
                executable: old.as_ref().is_some_and(|file| file.executable),
            })
        };
        return Ok(vec![Mutation {
            path: id.path.clone(),
            before: old,
            after: new,
        }]);
    }
    let empty = BTreeMap::new();
    fn files<'a>(
        content: Option<&'a ConfigContent>,
        empty: &'a BTreeMap<String, ConfigFile>,
    ) -> Result<&'a BTreeMap<String, ConfigFile>, ConfigPortError> {
        match content {
            Some(ConfigContent::Files(files)) => Ok(files),
            None => Ok(empty),
            _ => Err(ConfigPortError::Invalid),
        }
    }
    let before = files(before, &empty)?;
    let after = files(after, &empty)?;
    let paths: BTreeSet<_> = before.keys().chain(after.keys()).collect();
    Ok(paths
        .into_iter()
        .map(|path| Mutation {
            path: if id.format == ConfigFormat::File {
                id.path.clone()
            } else {
                format!("{}/{path}", id.path)
            },
            before: before.get(path).cloned(),
            after: after.get(path).cloned(),
        })
        .collect())
}
