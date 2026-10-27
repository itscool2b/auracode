use super::*;
pub(super) struct PendingSetup {
    id: String,
    expires: Instant,
    setup: aura_sync::account::ResetSetup,
}
impl Accounts {
    pub async fn reset_status(&self) -> Result<AccountResetStatus> {
        let inner = self.inner.lock().await;
        Ok(AccountResetStatus {
            pending: inner
                .account
                .as_ref()
                .is_some_and(|account| account.pending_reset_version().is_some()),
            committed: inner.account.as_ref().is_some_and(Account::reset_committed),
        })
    }
    pub async fn prepare_sync_reset(&self, now: i64) -> Result<AccountResetReview> {
        let mut inner = self.action()?;
        let setup = account(&mut inner)?
            .prepare_reset(now)
            .await
            .map_err(error::account)?;
        let id = setup.review.id.clone();
        let value = AccountResetReview {
            id: id.clone(),
            key_version: setup.review.key_version,
            records: setup.review.records,
            blobs: setup.review.blobs,
            other_devices: setup.review.other_devices,
            recovery_key: setup.recovery_text().to_string(),
        };
        inner.reset = Some(PendingSetup {
            id,
            expires: Instant::now() + Duration::from_secs(300),
            setup,
        });
        Ok(value)
    }
    pub async fn confirm_sync_reset(
        &self,
        id: &str,
        confirmation: &str,
        retained: bool,
        now: i64,
    ) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        if !retained
            || confirmation != "RESET SYNC"
            || !inner
                .reset
                .as_ref()
                .is_some_and(|pending| pending.id == id && pending.expires > Instant::now())
        {
            return Err(error::state());
        }
        let setup = inner.reset.take().ok_or_else(error::state)?.setup;
        account(&mut inner)?
            .confirm_reset(setup, confirmation, now)
            .await
            .map_err(error::account)?;
        self.finish_reset_binding(&mut inner).await?;
        snapshot(&inner)
    }
    pub async fn retry_sync_reset(&self, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .retry_reset(now)
            .await
            .map_err(error::account)?;
        self.finish_reset_binding(&mut inner).await?;
        snapshot(&inner)
    }
    pub async fn cancel_sync_reset(&self, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        let abandoned = account(&mut inner)?
            .cancel_reset(now)
            .await
            .map_err(error::account)?;
        if !abandoned {
            account(&mut inner)?
                .connect(now)
                .await
                .map_err(error::account)?;
            self.finish_reset_binding(&mut inner).await?;
            if account(&mut inner)?.pending_reset_version().is_some() {
                return Err(error::failure(
                    AccountFailureCode::Conflict,
                    "The reset may have completed. Its new key was retained. Refresh account access to verify the committed device envelope.",
                ));
            }
        }
        snapshot(&inner)
    }
    pub(super) async fn finish_reset_binding(&self, inner: &mut Inner) -> Result<()> {
        if !inner.account.as_ref().is_some_and(Account::reset_committed) {
            return Ok(());
        }
        let id = account(inner)?.id().to_owned();
        let mut next = inner.index.clone();
        next.accounts.insert(id, None);
        // Old profile files are retained. Never try their ciphertext with the fresh account key.
        // The index acknowledgement precedes clearing the durable reset marker.
        next.save(self.vault.clone(), self.index_entry.clone())
            .await?;
        inner.index = next;
        account(inner)?
            .acknowledge_reset_profile()
            .await
            .map_err(error::account)
    }
}
