//! Scoped cleanup of auracode's service. Target digests never establish payload kind or origin.
use aura_sync::vault::{NativeStore, SecretStore, VaultEntry, VaultError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

pub const ORIGINS: [&str; 2] = ["https://auracode.si", "https://preview.auracode.si"];

/// Enumeration returns names only, scoped by the platform to auracode's own service.
pub trait AppVault: Send + Sync {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError>;
    fn remove(&self, entry: &VaultEntry) -> Result<(), VaultError>;
    fn entries(&self) -> Result<Vec<VaultEntry>, VaultError>;
}
impl AppVault for NativeStore {
    fn load(&self, entry: &VaultEntry) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        SecretStore::load(self, entry)
    }
    fn remove(&self, entry: &VaultEntry) -> Result<(), VaultError> {
        SecretStore::remove(self, entry)
    }
    fn entries(&self) -> Result<Vec<VaultEntry>, VaultError> {
        self.app_entries()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultKind {
    Index,
    Account,
    Unknown,
}

/// Safe display data. Never contains account IDs, profiles, secret bytes or platform errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRow {
    pub target: String,
    pub kind: VaultKind,
    pub remove: bool,
    pub reason: String,
}

/// Opaque reviewed identity plus value fingerprint, used only to narrow later execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultApproval {
    target: String,
    fingerprint: String,
}

#[derive(Debug, Clone, Default)]
pub struct VaultPlan {
    pub rows: Vec<VaultRow>,
    pub warnings: Vec<String>,
    pub approvals: Vec<VaultApproval>,
}
impl VaultPlan {
    pub fn unavailable() -> Self {
        Self { warnings: vec!["Secure storage is busy or unavailable. All keys are retained. Close every auracode copy, including older versions, and retry.".into()], ..Self::default() }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VaultReport {
    pub indexes: usize,
    pub accounts: usize,
    /// Valid unreferenced bundles removed when the canonical default root is deleted.
    pub swept: usize,
    pub rows: Vec<VaultRow>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

struct Record {
    entry: VaultEntry,
    kind: VaultKind,
    fingerprint: String,
    references: Vec<String>,
}
struct Snapshot {
    records: Vec<Record>,
    owned: HashMap<String, &'static str>,
    orphans: bool,
    uncertain: bool,
}

fn discover(
    vault: &dyn AppVault,
    roots: &[PathBuf],
    default_root: Option<&Path>,
) -> Result<Snapshot, VaultError> {
    let mut owned = HashMap::new();
    let mut uncertain = false;
    for root in roots {
        for origin in ORIGINS {
            match crate::accounts::profile_index_entry(origin, root) {
                Some(entry) => {
                    owned.insert(entry.target(), origin);
                }
                None => uncertain = true,
            }
        }
    }
    let default = default_root.and_then(crate::accounts::cleanup_identity);
    let orphans = default.is_some()
        && roots
            .iter()
            .any(|root| crate::accounts::cleanup_identity(root) == default);
    let mut entries = vault.entries()?;
    // Also load named indexes when a provider's listing is temporarily incomplete.
    for root in roots {
        for origin in ORIGINS {
            if let Some(entry) = crate::accounts::profile_index_entry(origin, root) {
                entries.push(entry);
            }
        }
    }
    entries.sort_by_key(VaultEntry::target);
    entries.dedup();
    let mut records = Vec::new();
    for entry in entries {
        let (kind, fingerprint, references) = match vault.load(&entry) {
            Ok(None) => continue,
            Ok(Some(bytes)) => {
                let fingerprint = format!("{:x}", Sha256::digest(&bytes));
                if let Some(ids) = crate::accounts::cleanup_references(&bytes) {
                    (VaultKind::Index, fingerprint, ids)
                } else if aura_sync::account::valid_stored_bundle(&bytes) {
                    (VaultKind::Account, fingerprint, Vec::new())
                } else {
                    (VaultKind::Unknown, fingerprint, Vec::new())
                }
            }
            Err(_) => (VaultKind::Unknown, String::new(), Vec::new()),
        };
        uncertain |= kind == VaultKind::Unknown;
        // An account payload at an expected index name is not proof of any account identity.
        uncertain |= owned.contains_key(&entry.target()) && kind != VaultKind::Index;
        records.push(Record {
            entry,
            kind,
            fingerprint,
            references,
        });
    }
    Ok(Snapshot {
        records,
        owned,
        orphans,
        uncertain,
    })
}

fn references(record: &Record, origins: &[&str]) -> HashSet<String> {
    record
        .references
        .iter()
        .flat_map(|id| {
            origins
                .iter()
                .filter_map(move |origin| VaultEntry::new(origin, id).ok().map(|e| e.target()))
        })
        .collect()
}

/// The only decision routine, shared by UI review, dry-run and execution's fresh discovery.
/// Inputs contain validated payload classifications; no IO or mutation occurs here.
fn decide(snapshot: &Snapshot, approved: Option<&[VaultApproval]>) -> VaultPlan {
    let mut foreign = HashSet::new();
    let mut owned_accounts = HashSet::new();
    for record in &snapshot.records {
        if record.kind != VaultKind::Index {
            continue;
        }
        let target = record.entry.target();
        let approved_index = approved.is_none_or(|items| {
            items
                .iter()
                .any(|item| item.target == target && item.fingerprint == record.fingerprint)
        });
        if let Some(origin) = snapshot.owned.get(&target)
            && approved_index
        {
            owned_accounts.extend(references(record, &[*origin]));
        } else {
            // A retained index, including one newly created or changed under a deleted root,
            // still owns references. A foreign digest cannot establish its service origin.
            foreign.extend(references(record, &ORIGINS));
        }
    }
    let mut plan = VaultPlan::default();
    if snapshot.uncertain {
        plan.warnings.push("Some secure-store entries or root identities could not be verified. All account keys and retry indexes are retained.".into());
    }
    for record in &snapshot.records {
        let target = record.entry.target();
        let (mut remove, mut reason) = match record.kind {
            VaultKind::Unknown => (false, "Unreadable, malformed or unsupported payload"),
            VaultKind::Index if !snapshot.owned.contains_key(&target) => {
                (false, "Index belongs to another data root")
            }
            VaultKind::Index if snapshot.uncertain => (
                false,
                "Reference discovery is uncertain; retain index for retry",
            ),
            VaultKind::Index => (true, "Index belongs to a deleted root"),
            VaultKind::Account if snapshot.owned.contains_key(&target) => {
                (false, "Unexpected payload at a root index target")
            }
            VaultKind::Account if snapshot.uncertain => (false, "Reference discovery is uncertain"),
            VaultKind::Account if foreign.contains(&target) => {
                (false, "Referenced by another data root")
            }
            VaultKind::Account if owned_accounts.contains(&target) => {
                (true, "Exclusively referenced by deleted roots")
            }
            VaultKind::Account if snapshot.orphans => {
                (true, "Unreferenced account bundle; default root is deleted")
            }
            VaultKind::Account => (false, "Orphan cleanup requires deleting the default root"),
        };
        if remove
            && approved.is_some_and(|items| {
                !items
                    .iter()
                    .any(|item| item.target == target && item.fingerprint == record.fingerprint)
            })
        {
            remove = false;
            reason = "Not approved in this review, or changed since review";
        }
        if remove {
            plan.approvals.push(VaultApproval {
                target: target.clone(),
                fingerprint: record.fingerprint.clone(),
            });
        }
        plan.rows.push(VaultRow {
            target,
            kind: record.kind,
            remove,
            reason: reason.into(),
        });
    }
    // If an owned account cannot safely go, retain its retry index. Shared accounts alone do
    // not retain an owning index, since the surviving foreign index owns their references.
    for record in &snapshot.records {
        let target = record.entry.target();
        if record.kind != VaultKind::Index {
            continue;
        }
        let Some(origin) = snapshot.owned.get(&target) else {
            continue;
        };
        let needed = references(record, &[*origin]);
        let blocked = plan.rows.iter().any(|row| {
            needed.contains(&row.target) && !row.remove && !foreign.contains(&row.target)
        });
        if blocked && let Some(row) = plan.rows.iter_mut().find(|row| row.target == target) {
            row.remove = false;
            row.reason = "An owned account key is retained; keep index for retry".into();
            plan.approvals.retain(|approval| approval.target != target);
        }
    }
    plan
}

pub fn review_vault(
    vault: &dyn AppVault,
    roots: &[PathBuf],
    default_root: Option<&Path>,
) -> VaultPlan {
    match discover(vault, roots, default_root) {
        Ok(snapshot) => decide(&snapshot, None),
        Err(_) => VaultPlan::unavailable(),
    }
}

pub(super) fn clean(
    vault: &dyn AppVault,
    roots: &[PathBuf],
    default_root: Option<&Path>,
    approved: &[VaultApproval],
) -> VaultReport {
    let snapshot = match discover(vault, roots, default_root) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            return VaultReport {
                error: Some(VaultPlan::unavailable().warnings.remove(0)),
                ..VaultReport::default()
            };
        }
    };
    let plan = decide(&snapshot, Some(approved));
    let mut report = VaultReport {
        rows: plan.rows,
        warnings: plan.warnings,
        ..VaultReport::default()
    };
    let owned_accounts: HashSet<_> = snapshot
        .records
        .iter()
        .filter_map(|record| {
            snapshot
                .owned
                .get(&record.entry.target())
                .map(|origin| references(record, &[*origin]))
        })
        .flatten()
        .collect();
    let mut failed = HashSet::new();
    // Accounts first. A failed removal must leave every owning index available for retry.
    for kind in [VaultKind::Account, VaultKind::Index] {
        for record in snapshot.records.iter().filter(|record| record.kind == kind) {
            let target = record.entry.target();
            let Some(row) = report
                .rows
                .iter_mut()
                .find(|row| row.target == target && row.remove)
            else {
                continue;
            };
            if kind == VaultKind::Index
                && let Some(origin) = snapshot.owned.get(&target)
                && references(record, &[*origin])
                    .iter()
                    .any(|key| failed.contains(key))
            {
                row.remove = false;
                row.reason = "Account deletion failed; keep index for retry".into();
                continue;
            }
            match vault.remove(&record.entry) {
                Ok(()) => {
                    row.reason = "Removed".into();
                    if kind == VaultKind::Index {
                        report.indexes += 1;
                    } else if owned_accounts.contains(&target) {
                        report.accounts += 1;
                    } else {
                        report.swept += 1;
                    }
                }
                Err(_) => {
                    failed.insert(target);
                    row.remove = false;
                    row.reason = "Deletion failed; retained for retry".into();
                    report.error = Some("Some secure-store entries could not be deleted. Retry cleanup after unlocking secure storage.".into());
                }
            }
        }
    }
    if !report.warnings.is_empty() {
        report
            .error
            .get_or_insert_with(|| report.warnings.join(" "));
    }
    report
}

#[cfg(test)]
mod tests;
