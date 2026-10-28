//! Account-bound configuration reviews. A renderer never chooses a profile, root, key or receipt
//! payload. Owned work keeps profile and filesystem admission until durable completion.
use std::{
    collections::{BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use aura_config::sync::{
    self, ConfigApplyPreparation, ConfigApplyResult, ConfigApplyStatus, ConfigChoice,
    ConfigOperation, ConfigPortError, ConfigReceiptStatus, ConfigScanner, ConfigSyncInventory,
    ConfigSyncOutcome, ConfigSyncPreview, ConfigSyncReceipt, PreparedConfigApply,
    PreparedConfigReview,
    automatic::{automatic_batch, execute_review},
    managed::ConfigClaim,
};
use tauri::{Manager, State};

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
    claim: Option<ConfigClaim>,
}

pub struct ConfigSyncService {
    pending: Mutex<HashMap<String, Pending>>,
    previews: Arc<tokio::sync::Semaphore>,
    automatic_cursor: Mutex<Option<String>>,
    automatic_notice: Mutex<Option<String>>,
}

impl Default for ConfigSyncService {
    fn default() -> Self {
        Self {
            pending: Mutex::default(),
            previews: Arc::new(tokio::sync::Semaphore::new(4)),
            automatic_cursor: Mutex::default(),
            automatic_notice: Mutex::default(),
        }
    }
}

impl ConfigSyncService {
    pub(crate) fn reset_profile(&self) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        *crate::sync::lock(&self.automatic_cursor) = None;
        *crate::sync::lock(&self.automatic_notice) = None;
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
    let paused = crate::plugin_library::paused_agents(state);
    let (scanner, notices) = sessions.config_sync_scanner_for(&paused).await?;
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
    service: State<'_, Arc<ConfigSyncService>>,
    after: Option<String>,
) -> Result<ConfigSyncInventory, AppError> {
    let notice = crate::sync::lock(&service.automatic_notice).clone();
    run(&state, &library, move |work, account| {
        let mut result = work.runtime.block_on(sync::inventory(
            account.port.as_ref(),
            &work.scanner,
            work.scanner.scan(),
            after.as_deref(),
        ))?;
        result.notices.extend(work.notices);
        result.notices.extend(notice);
        let claims = account.managed.load()?.document;
        for item in &mut result.items {
            if claims.items.get(&item.id).is_some_and(|claim| claim.pending.is_some()) {
                item.skipped = true;
                item.detail = Some("An earlier synchronization was not fully acknowledged. Resolve any History recovery, then review this item again before switching profiles.".into());
            }
        }
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
        let claim = account.managed.load()?.document.items.get(&id)
            .and_then(|item| item.pending.as_ref())
            .map(|pending| ConfigClaim { id: id.clone(), token: pending.token.clone() });
        if claim.is_some() {
            review.preview.warnings.push("This fresh review reconciles an unfinished Account claim. The original device baseline is preserved.".into());
        }
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
        // A declaration the agent must install stays reviewable until its installer finishes.
        if preview.can_apply || !preview.vendor_steps.is_empty() {
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
                        claim,
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
        if !pending.generation.is_current() || pending.created.elapsed() >= REVIEW_LIFETIME {
            return Err(ConfigPortError::Stale);
        }
        if !pending.scanner.same_sources(&work.scanner) {
            return Err(ConfigPortError::Stale);
        }
        let scanner = &work.scanner;
        let review = &pending.review;
        if scanner
            .apply_history(account.journal.as_ref())?
            .iter()
            .any(|record| {
                record.identity.id().as_deref() == Ok(review.preview.item.id.as_str())
                    && record.status == ConfigApplyStatus::RecoveryRequired
            })
        {
            return Err(ConfigPortError::Stale);
        }
        work.runtime.block_on(execute_review(
            account.port.as_ref(),
            scanner,
            account.journal.as_ref(),
            account.managed.as_ref(),
            review,
            pending.files,
            pending.claim.as_ref(),
        ))
    })
    .await
}

/// The agent's own installer ran for a reviewed declaration (`succeeded` and `exit_code` come
/// from its terminal). Success that produced exactly the reviewed declaration is acknowledged;
/// anything else restores that declaration and keeps every other item as it was.
#[tauri::command]
#[specta::specta]
pub async fn config_sync_vendor_finish(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    service: State<'_, Arc<ConfigSyncService>>,
    token: String,
    succeeded: bool,
    exit_code: Option<i32>,
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
        if !pending.generation.is_current() {
            return Err(ConfigPortError::Stale);
        }
        let failure = (!succeeded).then(|| match exit_code {
            Some(code) => format!("The install exited with code {code}."),
            None => "The install was stopped before it finished.".into(),
        });
        work.runtime.block_on(pending.review.finish_vendor(
            account.port.as_ref(),
            &work.scanner,
            account.journal.as_ref(),
            succeeded,
            failure,
        ))
    })
    .await
}

/// Apply all for one agent: each ready item is its own transaction; one failure keeps the rest.
#[tauri::command]
#[specta::specta]
pub async fn config_sync_apply_agent(
    state: State<'_, AppState>,
    library: State<'_, Arc<LibraryService>>,
    service: State<'_, Arc<ConfigSyncService>>,
    agent_id: String,
) -> Result<Vec<ConfigSyncOutcome>, AppError> {
    let provider = match agent_id.as_str() {
        "claude" => aura_config::Provider::Claude,
        "codex" => aura_config::Provider::Codex,
        "pi" => aura_config::Provider::Pi,
        _ => {
            return Err(AppError::new(
                AppErrorCode::InvalidArgument,
                "Configuration sync covers Claude Code, Codex and Pi.",
            ));
        }
    };
    service.prune();
    let reviewed: BTreeSet<_> = crate::sync::lock(&service.pending)
        .values()
        .map(|item| item.review.preview.item.id.clone())
        .collect();
    run(&state, &library, move |work, account| {
        work.runtime.block_on(aura_config::sync::automatic::apply_agent(
            account.port.as_ref(),
            &work.scanner,
            account.journal.as_ref(),
            account.managed.as_ref(),
            provider,
            &reviewed,
        ))
    })
    .await
}

/// Runs after a successful encrypted exchange. The owned worker retains all profile and mutation
/// guards; profile publication cannot race a late batch from the departing Account.
pub(crate) async fn after_exchange(app: &tauri::AppHandle, generation: ProfileGeneration) {
    if !generation.is_current() {
        return;
    }
    let state = app.state::<AppState>();
    if state.quit.is_quitting() || state.app_info().profile_switching {
        return;
    }
    let library = app.state::<Arc<LibraryService>>();
    let service = Arc::clone(&app.state::<Arc<ConfigSyncService>>());
    let worker = service.clone();
    let expected = generation.clone();
    let result = run(&state, &library, move |work, account| {
        if !expected.is_current() { return Err(ConfigPortError::Stale); }
        worker.prune();
        let reviewed: BTreeSet<_> = crate::sync::lock(&worker.pending).values()
            .map(|item| item.review.preview.item.id.clone()).collect();
        let cursor = crate::sync::lock(&worker.automatic_cursor).clone();
        let batch = work.runtime.block_on(automatic_batch(account.port.as_ref(), &work.scanner,
            account.journal.as_ref(), account.managed.as_ref(), cursor.as_deref(), &reviewed))?;
        *crate::sync::lock(&worker.automatic_cursor) = batch.next_cursor;
        *crate::sync::lock(&worker.automatic_notice) = batch.needs_attention.then(||
            "Some configuration needs your review. Conflicts and unfinished changes stay out of automatic sync.".into());
        Ok(batch.completed)
    }).await;
    if !generation.is_current() {
        return;
    }
    match result {
        Ok(completed) if completed > 0 => crate::account_sync::trigger(app),
        Ok(_) => {},
        Err(_) => *crate::sync::lock(&service.automatic_notice) = Some(
            "Automatic configuration sync could not finish. Existing settings and recovery records are retained. Open a review for details.".into()),
    }
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
        // Pause before restoring files, so the next polling cycle cannot immediately publish the
        // restored local content as a new automatic change. Failed persistence leaves files alone.
        work.runtime.block_on(async {
            let mut device = account.port.read_device_state(&item_id).await?.unwrap_or(sync::ConfigDeviceState {
                revision: None, head: None, snapshot: None, device_only: false, skipped: None,
            });
            let expected = device.head.as_ref().map(|head| head.revision.clone());
            device.skipped = Some("Local configuration was restored from History. Review it before synchronizing again.".into());
            account.port.save_device_state(&item_id, expected.as_deref(), device).await
        })?;
        match work.scanner.rollback_apply(&id, account.journal.as_ref())? {
            ConfigApplyResult::Applied { id } => Ok(ConfigSyncOutcome { item_id, receipt_id: Some(id), completed: true,
                message: "Local configuration restored. Review the item before synchronizing this change.".into() }),
            ConfigApplyResult::NeedsRecovery { id } => Ok(ConfigSyncOutcome { item_id, receipt_id: Some(id), completed: false,
                message: "Recovery is incomplete. The encrypted receipt is retained. Resolve the reported local file conflict before retrying.".into() }),
        }
    }).await
}
