//! Bounded automatic work only for identities explicitly claimed by a reviewed Account action.
//! The host retains profile admission, the configuration mutation lock and owned work throughout.
use std::collections::BTreeSet;

use super::{
    ConfigApplyJournal, ConfigApplyPreparation, ConfigApplyResult, ConfigApplyStatus, ConfigChoice,
    ConfigOperation, ConfigPortError, ConfigScanner, ConfigSyncOutcome, ConfigSyncPort,
    PreparedConfigApply, PreparedConfigReview, managed, prepare_review,
};
use managed::{ConfigClaim, ConfigManagedStore, ManagedDocument};

const BATCH_SIZE: usize = 8;

#[derive(Default)]
pub struct AutomaticBatch {
    pub next_cursor: Option<String>,
    pub completed: usize,
    pub needs_attention: bool,
}

/// Round-robin cursor visits a bounded number of committed identities. Unclaimed and unresolved
/// items never become eligible merely because a remote snapshot or merge base exists.
fn candidates(document: &ManagedDocument, after: Option<&str>) -> (Vec<String>, Option<String>) {
    let mut ids = document
        .items
        .iter()
        .filter(|(id, item)| {
            item.committed
                && item.pending.is_none()
                && after.is_none_or(|after| id.as_str() > after)
        })
        .map(|(id, _)| id.clone());
    let page: Vec<_> = ids.by_ref().take(BATCH_SIZE).collect();
    let cursor = ids.next().and_then(|_| page.last().cloned());
    (page, cursor)
}

pub async fn automatic_batch(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    journal: &dyn ConfigApplyJournal,
    store: &dyn ConfigManagedStore,
    after: Option<&str>,
    reviewed: &BTreeSet<String>,
) -> Result<AutomaticBatch, ConfigPortError> {
    let document = store.load()?.document;
    let (ids, next_cursor) = candidates(&document, after);
    let recovery: BTreeSet<_> = scanner
        .apply_history(journal)?
        .into_iter()
        .filter(|item| item.status == ConfigApplyStatus::RecoveryRequired)
        .map(|item| item.identity.id())
        .collect::<Result<_, _>>()?;
    let mut result = AutomaticBatch {
        next_cursor,
        ..Default::default()
    };
    for id in ids {
        if reviewed.contains(&id) || recovery.contains(&id) {
            continue;
        }
        let Some(device) = port.read_device_state(&id).await? else {
            continue;
        };
        if device.snapshot.is_none()
            || device.head.is_none()
            || device.device_only
            || device.skipped.is_some()
        {
            continue;
        }
        let review = match prepare_review(port, scanner, &id, ConfigChoice::Automatic).await {
            Ok(review) => review,
            Err(_) => {
                result.needs_attention = true;
                continue;
            }
        };
        if !review.preview.can_apply || review.preview.item.first_link {
            result.needs_attention |= review.preview.item.operation == ConfigOperation::Conflict;
            continue;
        }
        let Some(desired) = &review.desired else {
            continue;
        };
        if desired.identity.requires_vendor() {
            continue;
        }
        // Do not rewrite an unchanged base/ownership document every polling interval.
        if review.preview.item.operation == ConfigOperation::InSync
            && device.head == review.remote_head
        {
            continue;
        }
        let files = if matches!(
            review.preview.item.operation,
            ConfigOperation::Apply | ConfigOperation::Merge
        ) {
            match scanner.prepare_apply(desired.clone(), &review.local)? {
                ConfigApplyPreparation::Ready(files) => Some(files),
                ConfigApplyPreparation::Skipped(_) => {
                    review.retain_skipped(port).await?;
                    result.needs_attention = true;
                    continue;
                }
            }
        } else {
            None
        };
        let outcome = execute_review(port, scanner, journal, store, &review, files, None).await?;
        if outcome.completed {
            result.completed += 1;
        } else {
            result.needs_attention = true;
        }
    }
    Ok(result)
}

/// Shared manual/automatic transaction. A prepared ownership claim precedes every file effect,
/// publication and base acknowledgment. An ambiguous failure retains its pending claim for review.
pub async fn execute_review(
    port: &dyn ConfigSyncPort,
    scanner: &ConfigScanner,
    journal: &dyn ConfigApplyJournal,
    store: &dyn ConfigManagedStore,
    review: &PreparedConfigReview,
    files: Option<Box<PreparedConfigApply>>,
    resumed: Option<&ConfigClaim>,
) -> Result<ConfigSyncOutcome, ConfigPortError> {
    if !review.preview.can_apply {
        return Err(ConfigPortError::Invalid);
    }
    review.revalidate(port, scanner).await?;
    let desired = review.desired.as_ref().ok_or(ConfigPortError::Invalid)?;
    let writes_files = matches!(
        review.preview.item.operation,
        ConfigOperation::Apply | ConfigOperation::Merge
    );
    if writes_files != files.is_some()
        || files
            .as_ref()
            .is_some_and(|files| files.preview().identity != desired.identity)
    {
        return Err(ConfigPortError::Invalid);
    }
    let claim = match resumed {
        Some(previous) => managed::resume_claim(store, previous, &review.local, desired)?,
        None => managed::prepare_claim(store, &review.local, desired)?,
    };
    let mut receipt_id = None;
    if let Some(prepared) = files {
        let id = prepared.preview().id.clone();
        match scanner.apply(*prepared, journal) {
            Ok(ConfigApplyResult::Applied { id }) => receipt_id = Some(id),
            Ok(ConfigApplyResult::NeedsRecovery { id }) => return Ok(incomplete(review, port, Some(id), "The local change needs recovery. Open History to restore it before reviewing again.".into()).await),
            Err(error) => {
                let recorded = scanner.apply_history(journal).ok().filter(|items| items.iter().any(|item| item.id == id)).map(|_| id);
                return Ok(incomplete(review, port, recorded, format!("The local change could not finish: {error}")).await);
            }
        }
    }
    if let Err(error) = review.complete(port, scanner).await {
        return Ok(incomplete(review, port, receipt_id, format!("The configuration acknowledgment did not finish: {error} Review this item again to reconcile its pending claim.")).await);
    }
    if managed::commit_claim(store, &claim, desired).is_err() {
        return Ok(ConfigSyncOutcome { item_id: review.preview.item.id.clone(), receipt_id, completed: false,
            message: "Configuration was applied, but Account ownership could not be acknowledged. Review this item again before switching profiles.".into() });
    }
    Ok(ConfigSyncOutcome { item_id: review.preview.item.id.clone(), receipt_id, completed: true,
        message: "Configuration saved to this Account profile. Cloud delivery is shown in Account sync status.".into() })
}

async fn incomplete(
    review: &PreparedConfigReview,
    port: &dyn ConfigSyncPort,
    receipt_id: Option<String>,
    message: String,
) -> ConfigSyncOutcome {
    let retained = review.retain_skipped(port).await;
    ConfigSyncOutcome {
        item_id: review.preview.item.id.clone(),
        receipt_id,
        completed: false,
        message: if retained.is_ok() {
            message
        } else {
            format!(
                "{message} The skipped marker could not be saved. The pending ownership claim and any recovery receipt are retained; refresh before retrying."
            )
        },
    }
}

#[cfg(test)]
mod tests {
    use super::super::{ConfigFormat, ConfigIdentity, ConfigScope, ConfigSnapshot};
    use super::*;
    use crate::Provider;
    #[test]
    fn candidates_are_bounded_and_never_include_unclaimed_or_unresolved_items() {
        let mut document = ManagedDocument::default();
        for index in 0..12 {
            let snapshot = ConfigSnapshot::tombstone(ConfigIdentity {
                provider: Provider::Codex,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Toml,
                path: "config.toml".into(),
                keys: vec![format!("item{index}")],
            });
            let id = snapshot.identity.id().unwrap();
            document.items.insert(
                id,
                managed::ManagedItem {
                    baseline: snapshot.clone(),
                    saved: snapshot,
                    committed: index != 0,
                    pending: (index == 1).then(|| managed::PendingClaim {
                        token: uuid::Uuid::now_v7().to_string(),
                        desired_hash: "0".repeat(64),
                    }),
                },
            );
        }
        let (first, cursor) = candidates(&document, None);
        let (second, end) = candidates(&document, cursor.as_deref());
        assert_eq!(first.len(), 8);
        assert_eq!(second.len(), 2);
        assert!(end.is_none());
        assert!(first.iter().all(|id| !second.contains(id)));
        for id in first.iter().chain(&second) {
            assert!(document.items[id].committed);
            assert!(document.items[id].pending.is_none());
        }
    }
}
