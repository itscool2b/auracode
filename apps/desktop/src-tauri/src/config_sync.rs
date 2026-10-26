//! Account-bound configuration reviews. A renderer never chooses a profile, root, key or receipt
//! payload. Owned work keeps profile and filesystem admission until durable completion.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use aura_config::sync::{
    self, ConfigApplyPreparation, ConfigApplyResult, ConfigApplyStatus, ConfigChoice,
    ConfigOperation, ConfigPortError, ConfigReceiptStatus, ConfigScanner, ConfigSyncInventory,
    ConfigSyncOutcome, ConfigSyncPreview, ConfigSyncReceipt, PreparedConfigApply,
    PreparedConfigReview,
};
use tauri::State;

use crate::{
    account_config::AccountConfigServices,
    config_library::LibraryService,
    error::{AppError, AppErrorCode},
    state::{AppState, ProfileGeneration},
};

const REVIEW_LIFETIME: Duration = Duration::from_secs(10 * 60);

struct Pending {
    generation: ProfileGeneration,
    _slot: tokio::sync::OwnedSemaphorePermit,
    created: Instant,
    scanner: ConfigScanner,
    review: PreparedConfigReview,
    files: Option<Box<PreparedConfigApply>>,
}

pub struct ConfigSyncService {
    pending: Mutex<HashMap<String, Pending>>,
    previews: Arc<tokio::sync::Semaphore>,
}

impl Default for ConfigSyncService {
    fn default() -> Self {
        Self {
            pending: Mutex::default(),
            previews: Arc::new(tokio::sync::Semaphore::new(4)),
        }
    }
}

impl ConfigSyncService {
    pub(crate) fn reset_profile(&self) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }
    fn prune(&self) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|_, pending| {
                pending.created.elapsed() < REVIEW_LIFETIME && pending.generation.is_current()
            });
    }
}

struct Work {
    scanner: ConfigScanner,
    notices: Vec<String>,
    generation: ProfileGeneration,
    runtime: tokio::runtime::Handle,
}

async fn run<T, F>(state: &AppState, library: &LibraryService, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(Work, &AccountConfigServices) -> Result<T, ConfigPortError> + Send + 'static,
{
    let account = state.account_config()?;
    let sessions = state.sessions()?;
    let (scanner, notices) = sessions.config_sync_scanner().await?;
    let guard = Arc::clone(&library.mutation).lock_owned().await;
    let runtime = tokio::runtime::Handle::current();
    let manager = (*sessions).clone();
    manager
        .config_sync_work(move || {
            let _guard = guard;
            let _sessions = sessions;
            let context = Work {
                scanner,
                notices,
                generation: account.generation(),
                runtime,
            };
            work(context, &account)
        })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_inventory(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    after: Option<String>,
) -> Result<ConfigSyncInventory, AppError> {
    run(&state, &library, move |work, account| {
        let mut result = work.runtime.block_on(sync::inventory(
            account.port.as_ref(),
            &work.scanner,
            work.scanner.scan(),
            after.as_deref(),
        ))?;
        result.notices.extend(work.notices);
        Ok(result)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_preview(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    service: State<'_, Arc<ConfigSyncService>>,
    id: String,
    choice: ConfigChoice,
) -> Result<ConfigSyncPreview, AppError> {
    service.prune();
    let slot = Arc::clone(&service.previews)
        .try_acquire_owned()
        .map_err(|_| {
            AppError::new(
                AppErrorCode::InvalidArgument,
                "Close another configuration review before opening a new one.",
            )
        })?;
    let service = Arc::clone(&service);
    run(&state, &library, move |work, account| {
        let mut review = work.runtime.block_on(sync::prepare_review(
            account.port.as_ref(),
            &work.scanner,
            &id,
            choice,
        ))?;
        review.preview.warnings.extend(work.notices);
        let unresolved = work
            .scanner
            .apply_history(account.journal.as_ref())?
            .iter()
            .any(|record| {
                record.identity.id().as_deref() == Ok(id.as_str())
                    && record.status == ConfigApplyStatus::RecoveryRequired
            });
        let mut files = None;
        if unresolved {
            review.preview.can_apply = false;
            review.preview.warnings.push(
                "Recover the unfinished change in History before applying this item again.".into(),
            );
        } else if review.preview.can_apply
            && matches!(
                review.preview.item.operation,
                ConfigOperation::Apply | ConfigOperation::Merge
            )
        {
            match work.scanner.prepare_apply(
                review.desired.clone().ok_or(ConfigPortError::Invalid)?,
                &review.local,
            )? {
                ConfigApplyPreparation::Ready(prepared) => files = Some(prepared),
                ConfigApplyPreparation::Skipped(skipped) => {
                    review.preview.can_apply = false;
                    review.preview.warnings.push(skipped.reason);
                }
            }
        }
        let preview = review.preview.clone();
        if preview.can_apply {
            service
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(
                    preview.token.clone(),
                    Pending {
                        generation: work.generation,
                        _slot: slot,
                        created: Instant::now(),
                        scanner: work.scanner,
                        review,
                        files,
                    },
                );
        }
        Ok(preview)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn config_sync_cancel(service: State<'_, Arc<ConfigSyncService>>, token: String) {
    service
        .pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&token);
}

fn incomplete(
    review: &PreparedConfigReview,
    work: &Work,
    account: &AccountConfigServices,
    receipt_id: Option<String>,
    message: String,
) -> ConfigSyncOutcome {
    let retained = work
        .runtime
        .block_on(review.retain_skipped(account.port.as_ref()));
    ConfigSyncOutcome {
        item_id: review.preview.item.id.clone(),
        receipt_id,
        completed: false,
        message: if retained.is_ok() {
            message
        } else {
            format!(
                "{message} The skipped marker could not be saved. The previous base and any recovery receipt remain available; refresh before retrying."
            )
        },
    }
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_apply(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    service: State<'_, Arc<ConfigSyncService>>,
    token: String,
) -> Result<ConfigSyncOutcome, AppError> {
    service.prune();
    let pending = service
        .pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&token)
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::InvalidArgument,
                "This configuration review expired or was already used. Review the item again.",
            )
        })?;
    run(&state, &library, move |work, account| {
        if !pending.generation.is_current() || pending.created.elapsed() >= REVIEW_LIFETIME { return Err(ConfigPortError::Stale); }
        if !pending.scanner.same_sources(&work.scanner) { return Err(ConfigPortError::Stale); }
        let scanner = &work.scanner;
        let review = &pending.review;
        if scanner.apply_history(account.journal.as_ref())?.iter().any(|record|
            record.identity.id().as_deref() == Ok(review.preview.item.id.as_str()) && record.status == ConfigApplyStatus::RecoveryRequired) {
            return Err(ConfigPortError::Stale);
        }
        work.runtime.block_on(review.revalidate(account.port.as_ref(), scanner))?;
        let mut receipt_id = None;
        if let Some(prepared) = pending.files {
            let id = prepared.preview().id.clone();
            match scanner.apply(*prepared, account.journal.as_ref()) {
                Ok(ConfigApplyResult::Applied { id }) => receipt_id = Some(id),
                Ok(ConfigApplyResult::NeedsRecovery { id }) => return Ok(incomplete(review, &work, account, Some(id), "The local change needs recovery. Open History to restore it before retrying.".into())),
                Err(error) => {
                    let recorded = scanner.apply_history(account.journal.as_ref()).ok().filter(|items| items.iter().any(|item|item.id == id)).map(|_|id);
                    return Ok(incomplete(review, &work, account, recorded, format!("The local change could not finish: {error}")));
                }
            }
        }
        if let Err(error) = work.runtime.block_on(review.complete(account.port.as_ref(), scanner)) {
            return Ok(incomplete(review, &work, account, receipt_id, format!("The configuration was not acknowledged as synchronized: {error} Review the item again.")));
        }
        Ok(ConfigSyncOutcome { item_id: review.preview.item.id.clone(), receipt_id, completed: true,
            message: "Configuration saved to this Account profile. Cloud delivery is shown in Account sync status.".into() })
    }).await
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_device_only(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    id: String,
    device_only: bool,
) -> Result<(), AppError> {
    run(&state, &library, move |work, account| {
        work.runtime.block_on(sync::set_device_only(
            account.port.as_ref(),
            &work.scanner,
            &id,
            device_only,
        ))
    })
    .await
}

fn receipt(record: sync::ConfigApplyRecord) -> Result<ConfigSyncReceipt, ConfigPortError> {
    Ok(ConfigSyncReceipt {
        id: record.id,
        item_id: record.identity.id()?,
        label: if record.identity.keys.is_empty() {
            record.identity.path.clone()
        } else {
            format!(
                "{} · {}",
                record.identity.path,
                record.identity.keys.join(" / ")
            )
        },
        provider: record.identity.provider,
        status: match record.status {
            ConfigApplyStatus::Applied => ConfigReceiptStatus::Applied,
            ConfigApplyStatus::RecoveryRequired => ConfigReceiptStatus::RecoveryRequired,
            ConfigApplyStatus::RolledBack => ConfigReceiptStatus::RolledBack,
        },
    })
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_history(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
) -> Result<Vec<ConfigSyncReceipt>, AppError> {
    run(&state, &library, move |work, account| {
        work.scanner
            .apply_history(account.journal.as_ref())?
            .into_iter()
            .map(receipt)
            .collect()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn config_sync_rollback(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    id: String,
) -> Result<ConfigSyncOutcome, AppError> {
    run(&state, &library, move |work, account| {
        let record = work.scanner.apply_history(account.journal.as_ref())?.into_iter().find(|record|record.id == id).ok_or(ConfigPortError::Invalid)?;
        let item_id = record.identity.id()?;
        match work.scanner.rollback_apply(&id, account.journal.as_ref())? {
            ConfigApplyResult::Applied { id } => Ok(ConfigSyncOutcome { item_id, receipt_id: Some(id), completed: true,
                message: "Local configuration restored. Review the item before synchronizing this change.".into() }),
            ConfigApplyResult::NeedsRecovery { id } => Ok(ConfigSyncOutcome { item_id, receipt_id: Some(id), completed: false,
                message: "Recovery is incomplete. The encrypted receipt is retained. Resolve the reported local file conflict before retrying.".into() }),
        }
    }).await
}
