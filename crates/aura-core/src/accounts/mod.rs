//! Account actions serialized above the E2E client. Construction/restoration never contacts the
//! network. Only explicit sign-in actions send email, codes or recovery proofs.
use crate::profile::{Profile, ProfileKind, Profiles};
use aura_protocol::account::*;
use aura_sync::{
    account::{Access, Account, FirstKeySetup},
    api::ApiClient,
    crypto::{AccountKey, RecoveryKey},
    vault::{SecretStore, VaultEntry},
    wire::Platform,
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, MutexGuard};
use zeroize::Zeroizing;
mod audit;
mod error;
mod index;
mod network;
pub use audit::audit_profile;
use index::Index;
pub type Result<T> = std::result::Result<T, AccountFailure>;

pub struct Accounts {
    _owner: std::fs::File,
    api: ApiClient,
    vault: Arc<dyn SecretStore>,
    index_entry: VaultEntry,
    profiles: Profiles,
    inner: Mutex<Inner>,
}
struct Inner {
    index: Index,
    account: Option<Account>,
    challenge: Option<(String, Instant)>,
    recovery: Option<PendingRecovery>,
}
struct PendingRecovery {
    id: String,
    expires: Instant,
    setup: FirstKeySetup,
}

/// Confirmed local decryption material for opening one account profile. This is Rust-only.
pub struct AccountProfile {
    pub profile: Profile,
    pub account_id: String,
    pub key: Arc<AccountKey>,
    pub key_version: u32,
    pub device_id: Option<String>,
}
impl Accounts {
    /// The injected store must be NativeStore, or the explicitly chosen passphrase fallback.
    pub async fn open(
        api: ApiClient,
        vault: Arc<dyn SecretStore>,
        profiles: Profiles,
    ) -> Result<Self> {
        let root = profiles.root().root().to_owned();
        let origin = api.origin().to_owned();
        let (owner, index_entry) = tokio::task::spawn_blocking(move || {
            let owner = index::acquire(&root)?;
            Ok::<_, AccountFailure>((owner, index::entry(&origin, &root)?))
        })
        .await
        .map_err(|_| error::storage())??;
        let index = Index::load(vault.clone(), index_entry.clone(), api.origin().into()).await?;
        Ok(Self {
            _owner: owner,
            api,
            vault,
            index_entry,
            profiles,
            inner: Mutex::new(Inner {
                index,
                account: None,
                challenge: None,
                recovery: None,
            }),
        })
    }
    fn action(&self) -> Result<MutexGuard<'_, Inner>> {
        self.inner.try_lock().map_err(|_| {
            error::failure(
                AccountFailureCode::InvalidState,
                "Another account action is in progress. Try again when it finishes.",
            )
        })
    }
    pub async fn status(&self) -> Result<AccountStatus> {
        snapshot(&*self.inner.lock().await)
    }
    /// Select a remembered account by its local profile only, without contacting the server.
    pub async fn restore_profile(&self, profile: &str, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        let account = inner
            .index
            .accounts
            .iter()
            .find(|(_, value)| value.as_deref() == Some(profile))
            .map(|(account, _)| account.clone())
            .ok_or_else(error::state)?;
        let restored = Account::restore(self.api.clone(), &account, self.vault.clone(), now)
            .await
            .map_err(error::account)?;
        inner.account = Some(restored.ok_or_else(|| error::failure(AccountFailureCode::SecureStorage, "The key for this account profile is unavailable. Sign in and recover or unlock its secure store."))?);
        inner.recovery = None;
        snapshot(&inner)
    }
    pub async fn request_code(
        &self,
        email: &str,
        turnstile_token: &str,
    ) -> Result<SignInChallenge> {
        let mut inner = self.action()?;
        let challenge = self
            .api
            .begin_auth(email, turnstile_token)
            .await
            .map_err(error::api)?;
        inner.challenge = Some((
            challenge.challenge_id.clone(),
            Instant::now() + Duration::from_secs(challenge.expires_in.into()),
        ));
        Ok(SignInChallenge {
            id: challenge.challenge_id,
            expires_in: challenge.expires_in,
            resend_after: challenge.resend_after,
        })
    }
    pub async fn verify_code(&self, challenge: &str, code: &str) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        if !inner
            .challenge
            .as_ref()
            .is_some_and(|(id, expires)| id == challenge && *expires > Instant::now())
        {
            return Err(error::state());
        }
        let verified = self
            .api
            .verify_auth(challenge, code)
            .await
            .map_err(error::api)?;
        inner.challenge = None;
        let mut index = inner.index.clone();
        index.ensure(&verified.user_id)?;
        // Persist the index before saving a bearer, so a crash never strands a newly remembered
        // account session without a discoverable binding. A missing bundle is a recoverable state.
        index
            .save(self.vault.clone(), self.index_entry.clone())
            .await?;
        inner.index = index;
        inner.recovery = None;
        inner.account = Some(
            Account::signed_in(self.api.clone(), verified, self.vault.clone())
                .await
                .map_err(error::account)?,
        );
        snapshot(&inner)
    }
    pub async fn refresh(&self, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .connect(now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn register_device(
        &self,
        name: &str,
        platform: Platform,
        now: i64,
    ) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .register(name, platform, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn prepare_recovery(&self) -> Result<RecoverySetup> {
        let mut inner = self.action()?;
        let setup = account(&mut inner)?
            .prepare_first_key()
            .map_err(error::account)?;
        let id = crate::ids::new_id();
        let recovery_key = setup.recovery_text().to_string();
        inner.recovery = Some(PendingRecovery {
            id: id.clone(),
            expires: Instant::now() + Duration::from_secs(600),
            setup,
        });
        Ok(RecoverySetup { id, recovery_key })
    }
    pub async fn cancel_setup(&self) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        inner.challenge = None;
        inner.recovery = None;
        snapshot(&inner)
    }
    pub async fn confirm_recovery(
        &self,
        id: &str,
        retained: bool,
        now: i64,
    ) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        if !retained
            || !inner
                .recovery
                .as_ref()
                .is_some_and(|pending| pending.id == id && pending.expires > Instant::now())
        {
            return Err(error::state());
        }
        let pending = inner.recovery.take().ok_or_else(error::state)?;
        account(&mut inner)?
            .initialize(pending.setup, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn recover(&self, text: String, now: i64) -> Result<AccountStatus> {
        let text = Zeroizing::new(text);
        let recovery = RecoveryKey::parse(&text).map_err(error::crypto)?;
        let mut inner = self.action()?;
        inner.recovery = None;
        account(&mut inner)?
            .recover(recovery, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn confirm_fingerprint(&self, fingerprint: &str, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .confirm_account_key(fingerprint, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn devices(&self, now: i64) -> Result<Vec<AccountDevice>> {
        let mut inner = self.action()?;
        let account = account(&mut inner)?;
        let devices = account.devices(now).await.map_err(error::account)?;
        devices
            .into_iter()
            .map(|device| {
                Ok(AccountDevice {
                    current: account.device_id() == Some(device.id.as_str()),
                    id: device.id,
                    name: device.name,
                    platform: device.platform,
                    verification_code: device.verification_code,
                    created_at: millis(device.created_at)?,
                    last_seen: millis(device.last_seen)?,
                    approved_at: device.approved_at.map(millis).transpose()?,
                    revoked_at: device.revoked_at.map(millis).transpose()?,
                })
            })
            .collect()
    }
    pub async fn approve_device(&self, id: &str, code: &str, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .approve(id, code, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn revoke_device(&self, id: &str, now: i64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        account(&mut inner)?
            .revoke_device(id, now)
            .await
            .map_err(error::account)?;
        snapshot(&inner)
    }
    pub async fn sign_out(&self) -> Result<AccountSignOut> {
        let mut inner = self.action()?;
        inner.challenge = None;
        inner.recovery = None;
        let result = account(&mut inner)?
            .sign_out()
            .await
            .map_err(error::account)?;
        Ok(AccountSignOut {
            status: snapshot(&inner)?,
            server_revoked: result.server_revoked,
        })
    }
    /// Prepare local profile access. This never changes the active pointer, starts agents, or
    /// enables sync. The runtime must open every keyed service before committing a profile switch.
    pub async fn local_profile(&self) -> Result<AccountProfile> {
        let mut inner = self.action()?;
        let account = account(&mut inner)?;
        let (key, key_version) = account.local_key_handle().ok_or_else(error::state)?;
        let account_id = account.id().to_owned();
        let device_id = account.device_id().map(str::to_owned);
        let existing = inner.index.accounts.get(&account_id).cloned().flatten();
        let profiles = self.profiles.clone();
        let profile = tokio::task::spawn_blocking(move || match existing {
            Some(id) => profiles.get(&id),
            None => profiles.create(ProfileKind::Account, "Account"),
        })
        .await
        .map_err(|_| error::storage())?
        .map_err(|_| error::storage())?;
        if profile.meta.kind != ProfileKind::Account {
            return Err(error::storage());
        }
        if inner
            .index
            .accounts
            .get(&account_id)
            .and_then(Option::as_ref)
            != Some(&profile.meta.id)
        {
            let mut index = inner.index.clone();
            index.ensure(&account_id)?;
            index
                .accounts
                .insert(account_id.clone(), Some(profile.meta.id.clone()));
            index
                .save(self.vault.clone(), self.index_entry.clone())
                .await?;
            inner.index = index;
        }
        Ok(AccountProfile {
            profile,
            account_id,
            key,
            key_version,
            device_id,
        })
    }
}
fn account(inner: &mut Inner) -> Result<&mut Account> {
    inner.account.as_mut().ok_or_else(error::state)
}
fn millis(seconds: i64) -> Result<i64> {
    seconds
        .checked_mul(1000)
        .filter(|value| (0..=9_007_199_254_740_991).contains(value))
        .ok_or_else(|| error::api(aura_sync::api::ApiError::Protocol))
}
fn snapshot(inner: &Inner) -> Result<AccountStatus> {
    let Some(account) = &inner.account else {
        return Ok(AccountStatus {
            access: AccountAccess::SignedOut,
            account_id: None,
            device_id: None,
            profile_id: None,
            local_key_available: false,
            approval_code: None,
            fingerprint: None,
            sync: inactive(),
        });
    };
    let (access, approval_code, candidate) = match account.access() {
        Access::VerificationRequired => (AccountAccess::VerificationRequired, None, None),
        Access::NeedsDevice => (AccountAccess::NeedsDevice, None, None),
        Access::NeedsFirstKey => (AccountAccess::NeedsFirstKey, None, None),
        Access::PendingApproval { code } => {
            (AccountAccess::PendingApproval, Some(code.clone()), None)
        }
        Access::VerifyAccountKey { fingerprint } => (
            AccountAccess::VerifyAccountKey,
            None,
            Some(fingerprint.clone()),
        ),
        Access::Ready => (AccountAccess::Ready, None, None),
        Access::SignedOut => (AccountAccess::SignedOut, None, None),
        Access::Expired => (AccountAccess::Expired, None, None),
        Access::Denied => (AccountAccess::Denied, None, None),
    };
    Ok(AccountStatus {
        access,
        account_id: Some(account.id().into()),
        device_id: account.device_id().map(str::to_owned),
        profile_id: inner.index.accounts.get(account.id()).cloned().flatten(),
        local_key_available: account.local_key().is_some(),
        approval_code,
        fingerprint: candidate.or(account.key_fingerprint().map_err(error::account)?),
        sync: inactive(),
    })
}
fn inactive() -> AccountSyncStatus {
    AccountSyncStatus {
        state: AccountSyncState::Inactive,
        pending_changes: None,
        last_sync_at: None,
        message: None,
    }
}

#[cfg(test)]
mod tests;
