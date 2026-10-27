use super::*;
use serde::{Deserialize, Serialize};

/// This setup is transient until explicit destructive confirmation. Only its recovery text and
/// public review may be shown. The exact request enters the encrypted bundle before network IO.
pub struct ResetSetup {
    account: String,
    device: String,
    pub review: ResetReview,
    key: AccountKey,
    recovery: RecoveryKey,
}
impl ResetSetup {
    pub fn recovery_text(&self) -> Zeroizing<String> {
        self.recovery.display_once()
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PendingReset {
    pub version: u32,
    pub request: ResetRequest,
}
impl Account {
    pub fn pending_reset_version(&self) -> Option<u32> {
        self.bundle
            .pending_reset
            .as_ref()
            .map(|pending| pending.version)
    }
    pub fn reset_committed(&self) -> bool {
        self.bundle.pending_reset.as_ref().is_some_and(|pending| {
            self.bundle
                .account_key
                .as_ref()
                .is_some_and(|key| key.confirmed && key.version == pending.version)
        })
    }
    pub async fn prepare_reset(&mut self, now: i64) -> Result<ResetSetup> {
        self.check(now).await?;
        if !matches!(self.access, Access::PendingApproval { .. })
            || self.local_key().is_some()
            || self.bundle.pending_reset.is_some()
        {
            return Err(AccountError::State);
        }
        let reply = self.api.review_reset(self.token()?).await;
        let review = self.response(reply).await?;
        if review.expires_at <= now || review.expires_at > now.saturating_add(600) {
            return Err(ApiError::Protocol.into());
        }
        Ok(ResetSetup {
            account: self.id.clone(),
            device: self.device_id().ok_or(AccountError::State)?.into(),
            review,
            key: AccountKey::generate()?,
            recovery: RecoveryKey::generate()?,
        })
    }
    pub async fn confirm_reset(
        &mut self,
        setup: ResetSetup,
        confirmation: &str,
        now: i64,
    ) -> Result<()> {
        self.check(now).await?;
        if confirmation != "RESET SYNC"
            || setup.account != self.id
            || Some(setup.device.as_str()) != self.device_id()
            || setup.review.expires_at <= now
            || self.bundle.pending_reset.is_some()
            || self.local_key().is_some()
            || !matches!(self.access, Access::PendingApproval { .. })
        {
            return Err(AccountError::State);
        }
        let version = setup.review.key_version;
        let request = ResetRequest {
            review_id: setup.review.id,
            confirmation: confirmation.into(),
            wrapped_key: crypto::wrap_device(
                &setup.key,
                &self.id,
                &setup.device,
                version,
                &self.bundle.device_key.public_key(),
            )?,
            recovery_envelope: crypto::wrap_recovery(
                &setup.key,
                &setup.recovery,
                &self.id,
                version,
            )?,
            recovery_verifier: setup.recovery.verifier(&self.id, version)?,
        };
        self.bundle.account_key = Some(SavedKey {
            key: Arc::new(setup.key),
            version,
            confirmed: false,
            local_proof: true,
        });
        self.bundle.pending_reset = Some(PendingReset { version, request });
        // Failed persistence keeps the in-memory pending operation, and every explicit retry must
        // persist it again before dispatch. Neither a failure nor cancellation drops its new key.
        self.retry_reset(now).await
    }
    pub async fn retry_reset(&mut self, now: i64) -> Result<()> {
        self.check(now).await?;
        let pending = self
            .bundle
            .pending_reset
            .clone()
            .ok_or(AccountError::State)?;
        if self.reset_committed() {
            return Ok(());
        }
        self.persist().await?;
        let reply = self.api.reset_sync(self.token()?, &pending.request).await;
        let keys = self.response(reply).await?;
        if keys.key_version != pending.version {
            return Err(ApiError::Protocol.into());
        }
        self.accept_keys(keys).await
    }
    /// Explicitly abandon only after the server arbitrates cancellation against commit. A committed
    /// operation keeps its key and must reconnect to prove the stored device envelope instead.
    pub async fn cancel_reset(&mut self, now: i64) -> Result<bool> {
        self.check(now).await?;
        let pending = self
            .bundle
            .pending_reset
            .as_ref()
            .ok_or(AccountError::State)?;
        let version = pending.version;
        if self.reset_committed() {
            return Ok(false);
        }
        let reply = self
            .api
            .cancel_reset(self.token()?, &pending.request.review_id)
            .await;
        let cancelled = self.response(reply).await?;
        if cancelled.outcome == ResetOutcome::Committed
            || cancelled.outcome == ResetOutcome::Absent && cancelled.key_version == version
        {
            return Ok(false);
        }
        if cancelled.outcome != ResetOutcome::Cancelled && cancelled.outcome != ResetOutcome::Absent
        {
            return Err(ApiError::Protocol.into());
        }
        let pending = self.bundle.pending_reset.take();
        let key = self.bundle.account_key.take();
        if let Err(error) = self.persist().await {
            self.bundle.pending_reset = pending;
            self.bundle.account_key = key;
            return Err(error);
        }
        self.access = Access::VerificationRequired;
        Ok(true)
    }
    /// The coordinator calls this only after durably detaching the previous profile binding. A reset
    /// cannot open an old encrypted database with its new key even after a lost writer acknowledgement.
    pub async fn acknowledge_reset_profile(&mut self) -> Result<()> {
        if !self.reset_committed() {
            return Err(AccountError::State);
        }
        let previous = self.bundle.pending_reset.take();
        if let Err(error) = self.persist().await {
            self.bundle.pending_reset = previous;
            return Err(error);
        }
        Ok(())
    }
}
