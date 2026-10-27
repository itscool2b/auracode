//! Reviewed local erasure. The encrypted secure-store index retains an operation until profile
//! files, the app-owned account bundle and its binding are durably removed. No cloud API is used.
use super::*;
use serde::{Deserialize, Serialize};
mod files;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Receipt {
    pub account_id: String,
    pub profile_id: String,
    pub token: String,
    pub meta_hash: String,
    pub tree_hash: String,
    phase: Phase,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Prepared,
    Staged,
    FilesRemoved,
    KeyRemoved,
}
pub(super) struct Review {
    receipt: Receipt,
    expires: Instant,
}
impl Receipt {
    pub(super) fn valid(&self, index: &Index) -> bool {
        [&self.profile_id, &self.token]
            .into_iter()
            .all(|value| uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == *value))
            && [&self.meta_hash, &self.tree_hash]
                .into_iter()
                .all(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
            && index
                .accounts
                .get(&self.account_id)
                .and_then(Option::as_deref)
                == Some(self.profile_id.as_str())
    }
}
impl Accounts {
    pub async fn removal_candidates(&self) -> Result<Vec<AccountRemovalCandidate>> {
        let inner = self.inner.lock().await;
        let pending = inner
            .index
            .removal
            .as_ref()
            .map(|receipt| receipt.profile_id.clone());
        let ids: Vec<_> = inner.index.accounts.values().flatten().cloned().collect();
        let profiles = self.profiles.clone();
        tokio::task::spawn_blocking(move || {
            ids.into_iter()
                .map(|id| {
                    let display_name = profiles
                        .get(&id)
                        .map(|profile| profile.meta.display_name)
                        .unwrap_or_else(|_| "Account workspace".into());
                    Ok(AccountRemovalCandidate {
                        pending: pending.as_ref() == Some(&id),
                        profile_id: id,
                        display_name,
                    })
                })
                .collect()
        })
        .await
        .map_err(|_| error::storage())?
    }
    pub async fn prepare_removal(&self, id: &str, now: i64) -> Result<AccountRemovalReview> {
        let mut inner = self.action()?;
        self.removal_admission()?;
        let account_id = inner
            .index
            .accounts
            .iter()
            .find(|(_, profile)| profile.as_deref() == Some(id))
            .map(|(account, _)| account.clone())
            .ok_or_else(error::state)?;
        let other_profiles = inner
            .index
            .accounts
            .values()
            .flatten()
            .filter(|profile| profile.as_str() != id)
            .count() as u32;
        if let Some(receipt) = inner.index.removal.clone() {
            if receipt.profile_id != id {
                return Err(error::state());
            }
            inner.removal = Some(Review {
                receipt: receipt.clone(),
                expires: Instant::now() + Duration::from_secs(300),
            });
            return Ok(AccountRemovalReview {
                token: receipt.token,
                profile_id: id.into(),
                display_name: "Account workspace".into(),
                other_profiles,
                pending_changes: None,
                resuming: true,
            });
        }
        let target = Account::restore(self.api.clone(), &account_id, self.vault.clone(), now)
            .await
            .map_err(error::account)?;
        if target
            .as_ref()
            .is_some_and(|account| account.pending_reset_version().is_some())
        {
            return Err(error::state());
        }
        let root = self.profiles.root().root().to_owned();
        let profile = id.to_owned();
        let (display_name, meta_hash, tree_hash) =
            tokio::task::spawn_blocking(move || files::review(&root, &profile))
                .await
                .map_err(|_| error::storage())??;
        let token = crate::ids::new_id();
        inner.removal = Some(Review {
            receipt: Receipt {
                account_id,
                profile_id: id.into(),
                token: token.clone(),
                meta_hash,
                tree_hash,
                phase: Phase::Prepared,
            },
            expires: Instant::now() + Duration::from_secs(300),
        });
        Ok(AccountRemovalReview {
            token,
            profile_id: id.into(),
            display_name,
            other_profiles,
            pending_changes: None,
            resuming: false,
        })
    }
    pub async fn remove_from_device(
        &self,
        token: &str,
        confirmation: &str,
    ) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        self.remove_from_device_locked(&mut inner,token,confirmation).await.map_err(|failure|{
            if inner.index.removal.is_some(){error::failure(failure.code,"Removal did not finish. Some local files may already be erased. Review the pending removal to continue; cancellation is available only before files are staged.")}else{failure}
        })
    }
    async fn remove_from_device_locked(
        &self,
        inner: &mut Inner,
        token: &str,
        confirmation: &str,
    ) -> Result<AccountStatus> {
        self.removal_admission()?;
        if confirmation != "REMOVE" {
            return Err(error::state());
        }
        let review = inner
            .removal
            .take()
            .filter(|review| review.receipt.token == token && review.expires > Instant::now())
            .ok_or_else(error::state)?;
        let mut receipt = review.receipt;
        if !receipt.valid(&inner.index) {
            return Err(error::state());
        }
        match &inner.index.removal {
            Some(current) if current.token != token => return Err(error::state()),
            Some(current) => receipt = current.clone(),
            None => self.save_removal(inner, Some(receipt.clone())).await?,
        }
        if receipt.phase == Phase::Prepared {
            self.removal_files(receipt.clone(), files::stage).await?;
            receipt.phase = Phase::Staged;
            self.save_removal(inner, Some(receipt.clone())).await?;
        }
        if receipt.phase == Phase::Staged {
            self.removal_files(receipt.clone(), files::erase_files)
                .await?;
            receipt.phase = Phase::FilesRemoved;
            self.save_removal(inner, Some(receipt.clone())).await?;
        }
        if receipt.phase == Phase::FilesRemoved {
            let entry =
                VaultEntry::new(self.api.origin(), &receipt.account_id).map_err(error::vault)?;
            let vault = self.vault.clone();
            tokio::task::spawn_blocking(move || vault.remove(&entry).map_err(error::vault))
                .await
                .map_err(|_| error::storage())??;
            if inner
                .account
                .as_ref()
                .is_some_and(|account| account.id() == receipt.account_id)
            {
                inner.account = None;
                inner.challenge = None;
                inner.recovery = None;
                inner.reset = None;
            }
            receipt.phase = Phase::KeyRemoved;
            self.save_removal(inner, Some(receipt.clone())).await?;
        }
        self.removal_files(receipt.clone(), files::finish).await?;
        let mut index = inner.index.clone();
        index.accounts.remove(&receipt.account_id);
        index.removal = None;
        index
            .save(self.vault.clone(), self.index_entry.clone())
            .await?;
        inner.index = index;
        snapshot(inner)
    }
    pub async fn cancel_removal(&self, token: &str) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        self.removal_admission()?;
        let receipt = inner
            .index
            .removal
            .clone()
            .filter(|receipt| receipt.token == token && receipt.phase == Phase::Prepared)
            .ok_or_else(error::state)?;
        self.removal_files(receipt, files::cancel_unstarted).await?;
        self.save_removal(&mut inner, None).await?;
        inner.removal = None;
        snapshot(&inner)
    }
    fn removal_admission(&self) -> Result<()> {
        let root = self.profiles.root().root();
        if !matches!(crate::config_transition::pending(root), Ok(None)) {
            return Err(error::state());
        }
        let current =
            crate::config_transition::active_profile(root).map_err(|_| error::storage())?;
        if self
            .profiles
            .get(&current)
            .map_err(|_| error::storage())?
            .meta
            .kind
            != ProfileKind::Local
        {
            return Err(error::failure(
                AccountFailureCode::InvalidState,
                "Switch to Local and finish configuration recovery before removing an Account from this device.",
            ));
        }
        Ok(())
    }
    async fn save_removal(&self, inner: &mut Inner, receipt: Option<Receipt>) -> Result<()> {
        let mut index = inner.index.clone();
        index.removal = receipt;
        index
            .save(self.vault.clone(), self.index_entry.clone())
            .await?;
        inner.index = index;
        Ok(())
    }
    async fn removal_files(
        &self,
        receipt: Receipt,
        operation: fn(&std::path::Path, &Receipt) -> Result<()>,
    ) -> Result<()> {
        let root = self.profiles.root().root().to_owned();
        tokio::task::spawn_blocking(move || operation(&root, &receipt))
            .await
            .map_err(|_| error::storage())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maximum_index_and_receipt_fit_the_platform_vault_limit() {
        let mut index = Index::default();
        for value in 0..8 {
            index.accounts.insert(
                format!("{}{}", "a".repeat(127), value),
                Some(crate::ids::new_id()),
            );
        }
        let (account, profile) = index.accounts.first_key_value().unwrap();
        index.removal = Some(Receipt {
            account_id: account.clone(),
            profile_id: profile.clone().unwrap(),
            token: crate::ids::new_id(),
            meta_hash: "f".repeat(64),
            tree_hash: "f".repeat(64),
            phase: Phase::FilesRemoved,
        });
        assert!(serde_json::to_vec(&index).unwrap().len() <= 2048);
    }
}
