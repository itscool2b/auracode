//! Versioned envelopes defined in docs/sync-crypto-v1.md, using reviewed AEAD, X25519 and HKDF.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

pub const DEVICE_ALGORITHM: &str = "x25519-hkdf-sha256-xchacha20poly1305-v1";
pub const RECOVERY_ALGORITHM: &str = "recovery-xchacha20poly1305-v1";
pub const REBIND_ALGORITHM: &str = "x25519-hkdf-sha256-xchacha20poly1305-rebind-v1";
const KDF_SALT: &[u8] = b"auracode-hkdf-sha256-v1";
const RECOVERY_PREFIX: &str = "aura-recovery-v1-";
pub const MAX_RECORD_PLAINTEXT: usize = 64 * 1024 - 16;
pub const MAX_BLOB_PLAINTEXT: usize = 4 * 1024 * 1024 - 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("Secure randomness is unavailable.")]
    Random,
    #[error("The encrypted data or key encoding is invalid.")]
    Invalid,
    #[error("This encryption version is unsupported.")]
    Version,
    #[error("The key or authenticated context does not match this data.")]
    Authentication,
    #[error("The data exceeds the encrypted payload limit.")]
    TooLarge,
}
type Result<T> = std::result::Result<T, CryptoError>;

pub struct AccountKey(Zeroizing<[u8; 32]>);
pub struct RecoveryKey(Zeroizing<[u8; 32]>);
pub struct DeviceKey(StaticSecret);
#[cfg(feature = "sqlcipher")]
pub struct DatabaseKey(Zeroizing<[u8; 32]>);
macro_rules! secret_debug {
    ($type:ty) => {
        impl std::fmt::Debug for $type {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(concat!(stringify!($type), "([REDACTED])"))
            }
        }
    };
}
secret_debug!(AccountKey);
secret_debug!(RecoveryKey);
secret_debug!(DeviceKey);
#[cfg(feature = "sqlcipher")]
secret_debug!(DatabaseKey);
#[cfg(feature = "sqlcipher")]
impl DatabaseKey {
    pub(crate) fn secret(&self) -> &[u8] {
        self.0.as_ref()
    }
}

impl AccountKey {
    /// A distinct local-profile key, recoverable from the retained account key and opaque profile
    /// identity. It is never the raw record key and never serialized into a query or UI response.
    #[cfg(feature = "sqlcipher")]
    pub fn database_key(&self, account: &str, profile: &str) -> Result<DatabaseKey> {
        identifier(account)?;
        identifier(profile)?;
        Ok(DatabaseKey(derive(
            self.0.as_ref(),
            &json_context(&("auracode-profile-database-v1", account, profile))?,
        )?))
    }
    pub fn generate() -> Result<Self> {
        Ok(Self(random()?))
    }
    pub(crate) fn restore(secret: &[u8]) -> Result<Self> {
        if secret.len() != 32 {
            return Err(CryptoError::Invalid);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(secret);
        Ok(Self(key))
    }
    pub(crate) fn secret(&self) -> &[u8] {
        self.0.as_ref()
    }
    /// Compare on two trusted screens when accepting a remote approval for the first time. This
    /// public 128-bit fingerprint never substitutes for the encryption key or its recovery proof.
    pub fn fingerprint(&self, account: &str, version: u32) -> Result<String> {
        key_context(account, version)?;
        let mut hash = Sha256::new();
        hash.update(json_context(&(
            "auracode-account-key-fingerprint-v1",
            account,
            version,
        ))?);
        hash.update(self.0.as_ref());
        Ok(hash.finalize()[..16]
            .chunks(2)
            .map(|pair| format!("{:02X}{:02X}", pair[0], pair[1]))
            .collect::<Vec<_>>()
            .join(" "))
    }
}
impl DeviceKey {
    pub fn generate() -> Result<Self> {
        Ok(Self(StaticSecret::from(*random::<32>()?)))
    }
    pub(crate) fn restore(secret: &[u8]) -> Result<Self> {
        if secret.len() != 32 {
            return Err(CryptoError::Invalid);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(secret);
        Ok(Self(StaticSecret::from(*key)))
    }
    pub(crate) fn secret(&self) -> &[u8] {
        self.0.as_bytes()
    }
    pub fn public_key(&self) -> String {
        encode(PublicKey::from(&self.0).as_bytes())
    }
    pub fn approval_code(&self, account: &str, device: &str) -> Result<String> {
        approval_code(account, device, &self.public_key())
    }
}
impl RecoveryKey {
    pub fn generate() -> Result<Self> {
        Ok(Self(random()?))
    }
    /// Display once for the user to retain. The returned text is itself secret and zeroizes on drop.
    pub fn display_once(&self) -> Zeroizing<String> {
        let encoded = Zeroizing::new(encode(self.0.as_ref()));
        Zeroizing::new(format!("{RECOVERY_PREFIX}{}", encoded.as_str()))
    }
    pub fn parse(text: &str) -> Result<Self> {
        let value = text
            .trim()
            .strip_prefix(RECOVERY_PREFIX)
            .ok_or(CryptoError::Invalid)?;
        Ok(Self(decode_array(value)?))
    }
    pub fn auth_proof(&self, account: &str, version: u32) -> Result<Zeroizing<String>> {
        key_context(account, version)?;
        let info = json_context(&("auracode-recovery-auth-v1", account, version))?;
        Ok(Zeroizing::new(encode(
            derive(self.0.as_ref(), &info)?.as_ref(),
        )))
    }
    pub fn verifier(&self, account: &str, version: u32) -> Result<String> {
        Ok(encode(&Sha256::digest(
            self.auth_proof(account, version)?.as_bytes(),
        )))
    }
}

/// The server stores these opaque strings without opening them. Algorithms are exact version tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyEnvelope {
    pub algorithm: String,
    pub ciphertext: String,
    pub nonce: String,
    pub ephemeral_public_key: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedPayload {
    pub nonce: String,
    pub ciphertext: String,
}

pub fn approval_code(account: &str, device: &str, public: &str) -> Result<String> {
    identifier(account)?;
    identifier(device)?;
    let _: Zeroizing<[u8; 32]> = decode_array(public)?;
    let digest = Sha256::digest(json_context(&(
        "auracode-device-approval-v1",
        account,
        device,
        public,
    ))?);
    let number = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    Ok(format!("{number:06}"))
}

pub fn wrap_device(
    key: &AccountKey,
    account: &str,
    device: &str,
    version: u32,
    recipient: &str,
) -> Result<KeyEnvelope> {
    wrap_device_with(
        key,
        account,
        device,
        version,
        recipient,
        StaticSecret::from(*random::<32>()?),
        *random::<24>()?,
    )
}
fn wrap_device_with(
    key: &AccountKey,
    account: &str,
    device: &str,
    version: u32,
    recipient: &str,
    ephemeral: StaticSecret,
    nonce: [u8; 24],
) -> Result<KeyEnvelope> {
    key_context(account, version)?;
    identifier(device)?;
    let recipient_key = PublicKey::from(*decode_array::<32>(recipient)?);
    let shared = ephemeral.diffie_hellman(&recipient_key);
    if !shared.was_contributory() {
        return Err(CryptoError::Invalid);
    }
    let public = encode(PublicKey::from(&ephemeral).as_bytes());
    let context = json_context(&(
        "auracode-device-key-v1",
        account,
        device,
        version,
        recipient,
        &public,
    ))?;
    let wrapped = seal(
        derive(shared.as_bytes(), &context)?.as_ref(),
        &context,
        key.0.as_ref(),
        nonce,
    )?;
    Ok(KeyEnvelope {
        algorithm: DEVICE_ALGORITHM.into(),
        ciphertext: wrapped.ciphertext,
        nonce: wrapped.nonce,
        ephemeral_public_key: Some(public),
    })
}

pub fn unwrap_device(
    envelope: &KeyEnvelope,
    key: &DeviceKey,
    account: &str,
    device: &str,
    version: u32,
) -> Result<AccountKey> {
    key_context(account, version)?;
    identifier(device)?;
    if envelope.algorithm != DEVICE_ALGORITHM {
        return Err(CryptoError::Version);
    }
    let ephemeral = envelope
        .ephemeral_public_key
        .as_deref()
        .ok_or(CryptoError::Invalid)?;
    let public = PublicKey::from(*decode_array::<32>(ephemeral)?);
    let shared = key.0.diffie_hellman(&public);
    if !shared.was_contributory() {
        return Err(CryptoError::Invalid);
    }
    let context = json_context(&(
        "auracode-device-key-v1",
        account,
        device,
        version,
        key.public_key(),
        ephemeral,
    ))?;
    let plain = open(
        derive(shared.as_bytes(), &context)?.as_ref(),
        &context,
        &envelope.nonce,
        &envelope.ciphertext,
        32,
    )?;
    account_key(plain)
}

/// Prove possession of a retained private device key to a fresh sign-in session. The distinct
/// algorithm and context prevent a key envelope from being used as a server-visible proof.
pub fn open_rebind(
    envelope: &KeyEnvelope,
    key: &DeviceKey,
    account: &str,
    device: &str,
    challenge: &str,
) -> Result<Zeroizing<String>> {
    identifier(account)?;
    identifier(device)?;
    identifier(challenge)?;
    if envelope.algorithm != REBIND_ALGORITHM {
        return Err(CryptoError::Version);
    }
    let ephemeral = envelope
        .ephemeral_public_key
        .as_deref()
        .ok_or(CryptoError::Invalid)?;
    let public = PublicKey::from(*decode_array::<32>(ephemeral)?);
    let shared = key.0.diffie_hellman(&public);
    if !shared.was_contributory() {
        return Err(CryptoError::Invalid);
    }
    let context = json_context(&(
        "auracode-device-rebind-v1",
        account,
        device,
        challenge,
        key.public_key(),
        ephemeral,
    ))?;
    let plain = open(
        derive(shared.as_bytes(), &context)?.as_ref(),
        &context,
        &envelope.nonce,
        &envelope.ciphertext,
        32,
    )?;
    if plain.len() != 32 {
        return Err(CryptoError::Invalid);
    }
    Ok(Zeroizing::new(encode(&plain)))
}

pub fn wrap_recovery(
    key: &AccountKey,
    recovery: &RecoveryKey,
    account: &str,
    version: u32,
) -> Result<KeyEnvelope> {
    key_context(account, version)?;
    let info = json_context(&("auracode-recovery-encryption-v1", account, version))?;
    let aad = json_context(&("auracode-recovery-key-v1", account, version))?;
    let wrapped = seal(
        derive(recovery.0.as_ref(), &info)?.as_ref(),
        &aad,
        key.0.as_ref(),
        *random::<24>()?,
    )?;
    Ok(KeyEnvelope {
        algorithm: RECOVERY_ALGORITHM.into(),
        nonce: wrapped.nonce,
        ciphertext: wrapped.ciphertext,
        ephemeral_public_key: None,
    })
}

pub fn unwrap_recovery(
    envelope: &KeyEnvelope,
    recovery: &RecoveryKey,
    account: &str,
    version: u32,
) -> Result<AccountKey> {
    key_context(account, version)?;
    if envelope.algorithm != RECOVERY_ALGORITHM {
        return Err(CryptoError::Version);
    }
    if envelope.ephemeral_public_key.is_some() {
        return Err(CryptoError::Invalid);
    }
    let info = json_context(&("auracode-recovery-encryption-v1", account, version))?;
    let aad = json_context(&("auracode-recovery-key-v1", account, version))?;
    account_key(open(
        derive(recovery.0.as_ref(), &info)?.as_ref(),
        &aad,
        &envelope.nonce,
        &envelope.ciphertext,
        32,
    )?)
}

/// Routing metadata is authenticated together, including tombstones and the merge clock.
pub struct RecordContext<'a> {
    pub account: &'a str,
    pub collection: &'a str,
    pub id: &'a str,
    pub key_version: u32,
    pub hlc: &'a str,
    pub deleted: bool,
}
impl RecordContext<'_> {
    fn aad(&self) -> Result<Vec<u8>> {
        key_context(self.account, self.key_version)?;
        identifier(self.id)?;
        if !matches!(
            self.collection,
            "projects" | "chats" | "chat_chunks" | "config"
        ) || self.hlc.parse::<crate::clock::Hlc>().is_err()
        {
            return Err(CryptoError::Invalid);
        }
        json_context(&(
            "auracode-record-v1",
            self.account,
            self.collection,
            self.id,
            self.key_version,
            self.hlc,
            self.deleted,
        ))
    }
}

pub fn seal_record(
    key: &AccountKey,
    context: &RecordContext<'_>,
    plaintext: &[u8],
) -> Result<SealedPayload> {
    if plaintext.len() > MAX_RECORD_PLAINTEXT {
        return Err(CryptoError::TooLarge);
    }
    seal(key.0.as_ref(), &context.aad()?, plaintext, *random::<24>()?)
}
pub fn open_record(
    key: &AccountKey,
    context: &RecordContext<'_>,
    sealed: &SealedPayload,
) -> Result<Zeroizing<Vec<u8>>> {
    open(
        key.0.as_ref(),
        &context.aad()?,
        &sealed.nonce,
        &sealed.ciphertext,
        MAX_RECORD_PLAINTEXT,
    )
}
pub fn seal_blob(
    key: &AccountKey,
    account: &str,
    id: &str,
    version: u32,
    plaintext: &[u8],
) -> Result<SealedPayload> {
    if plaintext.len() > MAX_BLOB_PLAINTEXT {
        return Err(CryptoError::TooLarge);
    }
    key_context(account, version)?;
    identifier(id)?;
    seal(
        key.0.as_ref(),
        &json_context(&("auracode-blob-v1", account, id, version))?,
        plaintext,
        *random::<24>()?,
    )
}
pub fn open_blob(
    key: &AccountKey,
    account: &str,
    id: &str,
    version: u32,
    sealed: &SealedPayload,
) -> Result<Zeroizing<Vec<u8>>> {
    key_context(account, version)?;
    identifier(id)?;
    open(
        key.0.as_ref(),
        &json_context(&("auracode-blob-v1", account, id, version))?,
        &sealed.nonce,
        &sealed.ciphertext,
        MAX_BLOB_PLAINTEXT,
    )
}

fn random<const N: usize>() -> Result<Zeroizing<[u8; N]>> {
    let mut bytes = Zeroizing::new([0; N]);
    getrandom::fill(bytes.as_mut()).map_err(|_| CryptoError::Random)?;
    Ok(bytes)
}
fn derive(secret: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let mut output = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(KDF_SALT), secret)
        .expand(info, output.as_mut())
        .map_err(|_| CryptoError::Invalid)?;
    Ok(output)
}
fn seal(key: &[u8], aad: &[u8], msg: &[u8], nonce: [u8; 24]) -> Result<SealedPayload> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| CryptoError::Invalid)?;
    let ciphertext = cipher
        .encrypt(&XNonce::from(nonce), Payload { msg, aad })
        .map_err(|_| CryptoError::Authentication)?;
    Ok(SealedPayload {
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
    })
}
fn open(
    key: &[u8],
    aad: &[u8],
    nonce: &str,
    ciphertext: &str,
    max_plaintext: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    let nonce = decode_array::<24>(nonce)?;
    let ciphertext = decode(ciphertext, max_plaintext + 16)?;
    if ciphertext.len() < 16 {
        return Err(CryptoError::Invalid);
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| CryptoError::Invalid)?;
    cipher
        .decrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: ciphertext.as_ref(),
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| CryptoError::Authentication)
}
fn account_key(plain: Zeroizing<Vec<u8>>) -> Result<AccountKey> {
    if plain.len() != 32 {
        return Err(CryptoError::Invalid);
    }
    let mut key = Zeroizing::new([0; 32]);
    key.copy_from_slice(&plain);
    Ok(AccountKey(key))
}
fn json_context(value: &impl Serialize) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| CryptoError::Invalid)
}
fn key_context(account: &str, version: u32) -> Result<()> {
    identifier(account)?;
    if !(1..=1_000_000).contains(&version) {
        return Err(CryptoError::Version);
    }
    Ok(())
}
pub(crate) fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(CryptoError::Invalid);
    }
    Ok(())
}
pub(crate) fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}
pub(crate) fn decode(value: &str, max: usize) -> Result<Zeroizing<Vec<u8>>> {
    if value.len() > max.div_ceil(3) * 4 {
        return Err(CryptoError::TooLarge);
    }
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| CryptoError::Invalid)?,
    );
    if bytes.len() > max || Zeroizing::new(encode(&bytes)).as_str() != value {
        return Err(CryptoError::Invalid);
    }
    Ok(bytes)
}
fn decode_array<const N: usize>(value: &str) -> Result<Zeroizing<[u8; N]>> {
    let bytes = decode(value, N)?;
    if bytes.len() != N {
        return Err(CryptoError::Invalid);
    }
    let mut result = Zeroizing::new([0; N]);
    result.copy_from_slice(&bytes);
    Ok(result)
}

#[cfg(test)]
mod tests;
