//! Account/session state. Only Ready can send sync requests; local keys survive auth failures.
//! A caller serializes commands to one Account. UI work never receives the bearer or private keys.
use crate::{
    api::{ApiClient, ApiError},
    crypto::{self, AccountKey, RecoveryKey},
    vault::{SecretStore, VaultEntry, VaultError},
    wire::*,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicU64, Ordering},
    },
};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;
mod bundle;
use bundle::{Bundle, SavedKey, SavedSession};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Access {
    VerificationRequired,
    NeedsDevice,
    NeedsFirstKey,
    PendingApproval { code: String },
    VerifyAccountKey { fingerprint: String },
    Ready,
    SignedOut,
    Expired,
    Denied,
    Deleted,
}
#[derive(Debug, thiserror::Error)]
pub enum AccountError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Crypto(#[from] crypto::CryptoError),
    #[error(transparent)]
    Vault(#[from] VaultError),
    #[error("The saved account has an invalid or unsupported format. It was preserved.")]
    StoredData,
    #[error("This account action is unavailable in the current state.")]
    State,
}
pub type Result<T> = std::result::Result<T, AccountError>;

pub struct Account {
    api: ApiClient,
    id: String,
    entry: VaultEntry,
    store: Arc<dyn SecretStore>,
    bundle: Bundle,
    access: Access,
    writes: Arc<Writes>,
    epoch: u64,
}
#[derive(Default)]
struct Writes {
    serial: Mutex<()>,
    generation: AtomicU64,
    epoch: AtomicU64,
}
fn writes_for(entry: &VaultEntry) -> Result<Arc<Writes>> {
    static WRITES: OnceLock<Mutex<HashMap<VaultEntry, Weak<Writes>>>> = OnceLock::new();
    let mut entries = WRITES
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| VaultError::Unavailable)?;
    if let Some(writes) = entries.get(entry).and_then(Weak::upgrade) {
        return Ok(writes);
    }
    entries.retain(|_, value| value.strong_count() > 0);
    let writes = Arc::new(Writes::default());
    entries.insert(entry.clone(), Arc::downgrade(&writes));
    Ok(writes)
}
/// The UI displays this recovery text and asks the user to retain it before calling initialize.
/// Dropping this value cancels setup; it never changes server state on its own.
pub struct FirstKeySetup {
    account: String,
    device: String,
    key: AccountKey,
    recovery: RecoveryKey,
}
impl FirstKeySetup {
    pub fn recovery_text(&self) -> Zeroizing<String> {
        self.recovery.display_once()
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignOut {
    pub server_revoked: bool,
}

impl Account {
    /// Accept a verified desktop sign-in only after secure storage is chosen. Existing private keys
    /// are retained, but prior approval is not assumed valid for this new session.
    pub async fn signed_in(
        api: ApiClient,
        verified: VerifiedSession,
        store: Arc<dyn SecretStore>,
    ) -> Result<Self> {
        if verified.expires_at <= 0 {
            return Err(ApiError::Protocol.into());
        }
        let entry = VaultEntry::new(api.origin(), &verified.user_id)?;
        let writes = writes_for(&entry)?;
        let epoch = writes.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let mut bundle = match load(&store, &entry).await? {
            Some(bundle) => bundle,
            None => Bundle::new()?,
        };
        if bundle.account_deleted {
            return Err(ApiError::Deleted.into());
        }
        bundle.session = Some(SavedSession {
            token: verified.token,
            expires_at: verified.expires_at,
        });
        let account = Self {
            api,
            id: verified.user_id,
            entry,
            store,
            bundle,
            access: Access::VerificationRequired,
            writes,
            epoch,
        };
        account.persist().await?;
        Ok(account)
    }
    /// Restore local decryption material without network access. A retained session still needs
    /// connect() before sync, and expired sessions are removed while the data key is retained.
    pub async fn restore(
        api: ApiClient,
        id: &str,
        store: Arc<dyn SecretStore>,
        now: i64,
    ) -> Result<Option<Self>> {
        let entry = VaultEntry::new(api.origin(), id)?;
        let writes = writes_for(&entry)?;
        let epoch = writes.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let Some(bundle) = load(&store, &entry).await? else {
            return Ok(None);
        };
        let access = if bundle.account_deleted {
            Access::Deleted
        } else if bundle.session.is_some() {
            Access::VerificationRequired
        } else {
            Access::SignedOut
        };
        let mut account = Self {
            api,
            id: id.into(),
            entry,
            store,
            bundle,
            access,
            writes,
            epoch,
        };
        if account
            .bundle
            .session
            .as_ref()
            .is_some_and(|session| session.expires_at <= now)
        {
            account.clear_session(Access::Expired).await?;
        }
        Ok(Some(account))
    }
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn device_id(&self) -> Option<&str> {
        self.bundle.device_id.as_deref()
    }
    pub fn access(&self) -> &Access {
        &self.access
    }
    pub fn local_key(&self) -> Option<(&AccountKey, u32)> {
        self.bundle
            .account_key
            .as_ref()
            .filter(|key| key.confirmed)
            .map(|key| (key.key.as_ref(), key.version))
    }
    /// Rust-only handle for the profile's storage writer. It grants offline data access, never
    /// network authorization. The last owner zeroizes the key; unconfirmed remote keys stay private.
    pub fn local_key_handle(&self) -> Option<(Arc<AccountKey>, u32)> {
        self.bundle
            .account_key
            .as_ref()
            .filter(|key| key.confirmed)
            .map(|key| (Arc::clone(&key.key), key.version))
    }
    /// Show this on the trusted approving device for comparison with the new device's fingerprint.
    pub fn key_fingerprint(&self) -> Result<Option<String>> {
        self.local_key()
            .map(|(key, version)| {
                key.fingerprint(&self.id, version)
                    .map_err(AccountError::from)
            })
            .transpose()
    }
    pub async fn connect(&mut self, now: i64) -> Result<()> {
        self.check(now).await?;
        self.access = Access::VerificationRequired;
        let reply = self.api.session(self.token()?).await;
        let session = self.response(reply).await?;
        if session.user_id != self.id || session.expires_at <= now {
            return Err(ApiError::Protocol.into());
        }
        if let Some(saved) = self.bundle.session.as_mut() {
            saved.expires_at = session.expires_at;
        }
        self.persist().await?;
        match (session.device_id, self.bundle.device_id.clone()) {
            (Some(remote), Some(local)) if remote == local => {}
            (Some(remote), None) => {
                // A registration response may have been lost. Adopt only the session's device with
                // the retained private key's actual public counterpart.
                let reply = self.api.device(self.token()?, &remote).await;
                let device = self.response(reply).await?;
                if device.public_key != self.bundle.device_key.public_key()
                    || device.revoked_at.is_some()
                {
                    return Err(ApiError::Protocol.into());
                }
                self.bundle.device_id = Some(remote);
                self.persist().await?;
            }
            (Some(_), Some(_)) => return Err(ApiError::Protocol.into()),
            (None, Some(device)) => {
                let reply = self.api.device(self.token()?, &device).await;
                let retained = self.response(reply).await?;
                if retained.public_key != self.bundle.device_key.public_key() {
                    return Err(ApiError::Protocol.into());
                }
                if retained.revoked_at.is_some() {
                    self.clear_session(Access::Denied).await?;
                    return Err(ApiError::Forbidden.into());
                }
                if retained.approved_at.is_none() {
                    // Rebind proves an approved device, not an abandoned pending registration.
                    // A new explicit registration can proceed under this fresh unbound session.
                    self.bundle.device_id = None;
                    self.bundle.device_key = crypto::DeviceKey::generate()?;
                    if self
                        .bundle
                        .account_key
                        .as_ref()
                        .is_some_and(|key| !key.confirmed)
                    {
                        self.bundle.account_key = None;
                    }
                    self.persist().await?;
                    self.access = Access::NeedsDevice;
                    return Ok(());
                }
                let reply = self.api.begin_rebind(self.token()?, &device).await;
                let challenge = self.response(reply).await?;
                let proof = crypto::open_rebind(
                    &challenge.envelope,
                    &self.bundle.device_key,
                    &self.id,
                    &device,
                    &challenge.challenge_id,
                )?;
                let reply = self
                    .api
                    .verify_rebind(self.token()?, &challenge, &proof)
                    .await;
                self.response(reply).await?;
            }
            (None, None) => {
                self.access = Access::NeedsDevice;
                return Ok(());
            }
        }
        let reply = self.api.keys(self.token()?).await;
        match self.response(reply).await {
            Ok(keys) => self.accept_keys(keys).await,
            Err(AccountError::Api(ApiError::NotFound)) if self.local_key().is_none() => {
                self.access = Access::NeedsFirstKey;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }
    pub async fn register(&mut self, name: &str, platform: Platform, now: i64) -> Result<()> {
        self.check(now).await?;
        if self.access != Access::NeedsDevice || self.bundle.device_id.is_some() {
            return Err(AccountError::State);
        }
        // The private key was persisted by signed_in before registration can bind its public key.
        self.access = Access::VerificationRequired;
        let reply = self
            .api
            .register_device(
                self.token()?,
                name,
                platform,
                &self.bundle.device_key.public_key(),
            )
            .await;
        let device = self.response(reply).await?;
        self.bundle.device_id = Some(device.device_id.clone());
        self.persist().await?;
        let expected = self
            .bundle
            .device_key
            .approval_code(&self.id, &device.device_id)?;
        if device.verification_code != expected {
            return Err(ApiError::Protocol.into());
        }
        self.connect(now).await
    }
    pub fn prepare_first_key(&self) -> Result<FirstKeySetup> {
        self.current()?;
        if self.access != Access::NeedsFirstKey {
            return Err(AccountError::State);
        }
        Ok(FirstKeySetup {
            account: self.id.clone(),
            device: self.device_id().ok_or(AccountError::State)?.into(),
            key: AccountKey::generate()?,
            recovery: RecoveryKey::generate()?,
        })
    }
    /// Call only after the user confirms that they retained setup.recovery_text().
    pub async fn initialize(&mut self, setup: FirstKeySetup, now: i64) -> Result<()> {
        self.check(now).await?;
        if self.access != Access::NeedsFirstKey
            || setup.account != self.id
            || self.device_id() != Some(setup.device.as_str())
        {
            return Err(AccountError::State);
        }
        self.access = Access::VerificationRequired;
        let wrapped = crypto::wrap_device(
            &setup.key,
            &self.id,
            &setup.device,
            1,
            &self.bundle.device_key.public_key(),
        )?;
        let recovery = crypto::wrap_recovery(&setup.key, &setup.recovery, &self.id, 1)?;
        let verifier = setup.recovery.verifier(&self.id, 1)?;
        self.bundle.account_key = Some(SavedKey {
            key: Arc::new(setup.key),
            version: 1,
            confirmed: false,
            local_proof: true,
        });
        self.persist().await?;
        let reply = self
            .api
            .initialize_keys(self.token()?, &wrapped, &recovery, &verifier)
            .await;
        let keys = self.response(reply).await?;
        self.accept_keys(keys).await
    }
    pub async fn recover(&mut self, recovery: RecoveryKey, now: i64) -> Result<()> {
        self.check(now).await?;
        if !matches!(self.access, Access::PendingApproval { .. }) {
            return Err(AccountError::State);
        }
        self.access = Access::VerificationRequired;
        let reply = self.api.keys(self.token()?).await;
        let keys = self.response(reply).await?;
        let key = crypto::unwrap_recovery(
            &keys.recovery_envelope,
            &recovery,
            &self.id,
            keys.key_version,
        )?;
        let device = self.device_id().ok_or(AccountError::State)?;
        let wrapped = crypto::wrap_device(
            &key,
            &self.id,
            device,
            keys.key_version,
            &self.bundle.device_key.public_key(),
        )?;
        let proof = recovery.auth_proof(&self.id, keys.key_version)?;
        self.check_pinned_key(&key, keys.key_version)?;
        self.bundle.account_key = Some(SavedKey {
            key: Arc::new(key),
            version: keys.key_version,
            confirmed: false,
            local_proof: true,
        });
        self.persist().await?;
        let reply = self
            .api
            .recover_device(self.token()?, &proof, &wrapped)
            .await;
        let keys = self.response(reply).await?;
        self.accept_keys(keys).await
    }
    /// The UI must explicitly compare the displayed code on both devices before invoking this.
    pub async fn approve(&mut self, device_id: &str, code: &str, now: i64) -> Result<()> {
        self.ready(now).await?;
        let reply = self.api.device(self.token()?, device_id).await;
        let device = self.response(reply).await?;
        if device.revoked_at.is_some()
            || device.approved_at.is_some()
            || device.created_at < now.saturating_sub(600)
            || device.created_at > now.saturating_add(300)
            || crypto::approval_code(&self.id, device_id, &device.public_key)? != code
        {
            return Err(AccountError::State);
        }
        let (key, version) = self.local_key().ok_or(AccountError::State)?;
        let wrapped = crypto::wrap_device(key, &self.id, device_id, version, &device.public_key)?;
        let reply = self
            .api
            .approve_device(self.token()?, device_id, code, &wrapped)
            .await;
        self.response(reply).await
    }
    /// Explicit local acknowledgement after comparing the complete fingerprint with the trusted
    /// approving device. A server-approved envelope alone never enables a new device's first sync.
    pub async fn confirm_account_key(&mut self, fingerprint: &str, now: i64) -> Result<()> {
        self.check(now).await?;
        let Access::VerifyAccountKey {
            fingerprint: expected,
        } = &self.access
        else {
            return Err(AccountError::State);
        };
        if fingerprint != expected {
            return Err(AccountError::State);
        }
        let key = self
            .bundle
            .account_key
            .as_mut()
            .ok_or(AccountError::State)?;
        key.confirmed = true;
        let bytes = self.bundle.encode()?;
        if let Some(key) = self.bundle.account_key.as_mut() {
            key.confirmed = false;
        }
        self.persist_data(bytes).await?;
        if let Some(key) = self.bundle.account_key.as_mut() {
            key.confirmed = true;
        }
        self.access = Access::Ready;
        Ok(())
    }
    pub async fn devices(&mut self, now: i64) -> Result<Vec<Device>> {
        self.check(now).await?;
        let reply = self.api.devices(self.token()?).await;
        let mut devices = self.response(reply).await?;
        for device in &mut devices {
            // The code is bound to the returned public key. Approval independently refetches it
            // and compares the code the user entered from the recipient device.
            device.verification_code =
                crypto::approval_code(&self.id, &device.id, &device.public_key)?;
        }
        Ok(devices)
    }
    pub async fn revoke_device(&mut self, id: &str, now: i64) -> Result<()> {
        self.ready(now).await?;
        let reply = self.api.revoke_device(self.token()?, id).await;
        self.response(reply).await?;
        if self.device_id() == Some(id) {
            self.clear_session(Access::Denied).await?;
        }
        Ok(())
    }
    pub async fn pull(&mut self, after: u64, now: i64) -> Result<Pull> {
        self.ready(now).await?;
        let reply = self.api.pull(self.token()?, after).await;
        self.response(reply).await
    }
    pub async fn push(&mut self, records: &[EncryptedRecord], now: i64) -> Result<Heads> {
        self.ready(now).await?;
        let reply = self.api.push(self.token()?, records).await;
        self.response(reply).await
    }
    pub async fn blob(&mut self, id: &str, now: i64) -> Result<Blob> {
        self.ready(now).await?;
        let reply = self.api.blob(self.token()?, id).await;
        self.response(reply).await
    }
    /// Blob IDs are immutable random IDs. A retried create after a lost acknowledgement accepts
    /// only the exact prior ciphertext, never an unrelated server object or a blind replacement.
    pub async fn upload_blob(
        &mut self,
        id: &str,
        sealed: &crypto::SealedPayload,
        version: u32,
        now: i64,
    ) -> Result<String> {
        self.ready(now).await?;
        let reply = self
            .api
            .put_blob(self.token()?, id, sealed, version, None)
            .await;
        match self.response(reply).await {
            Err(AccountError::Api(ApiError::Conflict)) => {
                let found = self.blob(id, now).await?;
                if found.key_version != version
                    || found.nonce != sealed.nonce
                    || found.ciphertext != sealed.ciphertext
                    || found.size_bytes
                        != crypto::decode(&sealed.ciphertext, 4 * 1024 * 1024)?.len() as u64
                {
                    return Err(ApiError::Protocol.into());
                }
                Ok(found.etag)
            }
            other => other,
        }
    }
    pub async fn sign_out(&mut self) -> Result<SignOut> {
        // Halt immediately even if persistence or server revocation fails. Do not report success
        // when secure storage could not remove the session from its retained local bundle.
        self.access = Access::SignedOut;
        let session = self.bundle.session.take();
        self.current()?;
        let persisted = self.persist().await;
        let server_revoked = if let Some(session) = session {
            matches!(
                self.api.logout(&session.token).await,
                Ok(()) | Err(ApiError::Unauthorized)
            )
        } else {
            false
        };
        persisted?;
        Ok(SignOut { server_revoked })
    }
    async fn accept_keys(&mut self, keys: Keys) -> Result<()> {
        let device = self.device_id().ok_or(AccountError::State)?;
        let Some(wrapped) = keys.wrapped_key else {
            if keys.approved_at.is_some() {
                return Err(ApiError::Protocol.into());
            }
            self.access = Access::PendingApproval {
                code: self.bundle.device_key.approval_code(&self.id, device)?,
            };
            return Ok(());
        };
        if keys.approved_at.is_none() {
            return Err(ApiError::Protocol.into());
        }
        let key = crypto::unwrap_device(
            &wrapped,
            &self.bundle.device_key,
            &self.id,
            device,
            keys.key_version,
        )?;
        self.check_pinned_key(&key, keys.key_version)?;
        let proven = self
            .bundle
            .account_key
            .as_ref()
            .is_some_and(|key| key.confirmed || key.local_proof);
        let was_confirmed = self.local_key().is_some();
        let fingerprint = key.fingerprint(&self.id, keys.key_version)?;
        let previous = self.bundle.account_key.replace(SavedKey {
            key: Arc::new(key),
            version: keys.key_version,
            confirmed: proven,
            local_proof: false,
        });
        let encoded = self.bundle.encode()?;
        // Cancellation can drop this future while its blocking save continues. Do not expose a
        // newly obtained data key until it is durably saved. An already retained key stays usable.
        if let Some(key) = self.bundle.account_key.as_mut() {
            key.confirmed = was_confirmed;
        }
        if let Err(error) = self.persist_data(encoded).await {
            self.bundle.account_key = previous;
            return Err(error);
        }
        if let Some(key) = self.bundle.account_key.as_mut() {
            key.confirmed = proven;
        }
        self.access = if proven {
            Access::Ready
        } else {
            Access::VerifyAccountKey { fingerprint }
        };
        Ok(())
    }
    fn check_pinned_key(&self, key: &AccountKey, version: u32) -> Result<()> {
        if let Some(existing) = self
            .bundle
            .account_key
            .as_ref()
            .filter(|key| key.confirmed || key.local_proof)
            && (existing.version != version
                || !bool::from(existing.key.secret().ct_eq(key.secret())))
        {
            return Err(ApiError::Protocol.into());
        }
        Ok(())
    }
    async fn ready(&mut self, now: i64) -> Result<()> {
        self.check(now).await?;
        if self.access == Access::Ready {
            Ok(())
        } else {
            Err(AccountError::State)
        }
    }
    async fn check(&mut self, now: i64) -> Result<()> {
        self.current()?;
        if self.bundle.account_deleted {
            return Err(ApiError::Deleted.into());
        }
        let session = self.bundle.session.as_ref().ok_or(AccountError::State)?;
        if session.expires_at <= now {
            self.clear_session(Access::Expired).await?;
            return Err(ApiError::Unauthorized.into());
        }
        Ok(())
    }
    fn token(&self) -> Result<&SessionToken> {
        self.bundle
            .session
            .as_ref()
            .map(|session| &session.token)
            .ok_or(AccountError::State)
    }
    async fn response<T>(&mut self, result: std::result::Result<T, ApiError>) -> Result<T> {
        self.current()?;
        match result {
            Err(ApiError::Deleted) => {
                self.bundle.account_deleted = true;
                self.clear_session(Access::Deleted).await?;
                Err(ApiError::Deleted.into())
            }
            Err(ApiError::Unauthorized) => {
                self.clear_session(Access::Expired).await?;
                Err(ApiError::Unauthorized.into())
            }
            Err(ApiError::Forbidden) => {
                self.clear_session(Access::Denied).await?;
                Err(ApiError::Forbidden.into())
            }
            result => result.map_err(AccountError::from),
        }
    }
    async fn clear_session(&mut self, access: Access) -> Result<()> {
        self.bundle.session = None;
        self.access = if self.bundle.account_deleted {
            Access::Deleted
        } else {
            access
        };
        self.persist().await
    }
    async fn persist(&self) -> Result<()> {
        self.persist_data(self.bundle.encode()?).await
    }
    async fn persist_data(&self, bytes: Zeroizing<Vec<u8>>) -> Result<()> {
        self.current()?;
        let store = self.store.clone();
        let entry = self.entry.clone();
        let writes = self.writes.clone();
        let epoch = self.epoch;
        let generation = writes.generation.fetch_add(1, Ordering::SeqCst) + 1;
        tokio::task::spawn_blocking(move || {
            let _guard = writes.serial.lock().map_err(|_| VaultError::Unavailable)?;
            // A cancelled, queued write may run after a newer sign-out/save has been requested.
            // It must not resurrect that older session. In-flight writes finish before the next.
            if writes.generation.load(Ordering::SeqCst) == generation
                && writes.epoch.load(Ordering::SeqCst) == epoch
            {
                store.save(&entry, &bytes)
            } else {
                Ok(())
            }
        })
        .await
        .map_err(|_| VaultError::Unavailable)??;
        self.current()?;
        Ok(())
    }
    fn current(&self) -> Result<()> {
        if self.writes.epoch.load(Ordering::SeqCst) == self.epoch {
            Ok(())
        } else {
            Err(AccountError::State)
        }
    }
}
async fn load(store: &Arc<dyn SecretStore>, entry: &VaultEntry) -> Result<Option<Bundle>> {
    let store = store.clone();
    let entry = entry.clone();
    let writes = writes_for(&entry)?;
    tokio::task::spawn_blocking(move || {
        let _guard = writes.serial.lock().map_err(|_| VaultError::Unavailable)?;
        store.load(&entry)
    })
    .await
    .map_err(|_| VaultError::Unavailable)??
    .map(|bytes| Bundle::decode(&bytes))
    .transpose()
}

#[cfg(test)]
mod tests;
