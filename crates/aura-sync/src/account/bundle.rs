//! Small, versioned binary bundle stored only inside the selected secure store.
use super::{AccountError, Result};
use crate::{
    crypto::{self, AccountKey, DeviceKey},
    wire::SessionToken,
};
use std::sync::Arc;
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"AURA-ACCOUNT";
pub(super) struct Bundle {
    pub device_key: DeviceKey,
    pub device_id: Option<String>,
    pub session: Option<SavedSession>,
    pub account_key: Option<SavedKey>,
    pub account_deleted: bool,
    pub pending_reset: Option<super::PendingReset>,
}
pub(super) struct SavedSession {
    pub token: SessionToken,
    pub expires_at: i64,
}
pub(super) struct SavedKey {
    pub key: Arc<AccountKey>,
    pub version: u32,
    pub confirmed: bool,
    pub local_proof: bool,
}
impl Bundle {
    pub fn new() -> Result<Self> {
        Ok(Self {
            device_key: DeviceKey::generate()?,
            device_id: None,
            session: None,
            account_key: None,
            account_deleted: false,
            pending_reset: None,
        })
    }
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>> {
        let mut value = Zeroizing::new(Vec::with_capacity(256));
        value.extend_from_slice(MAGIC);
        value.push(3);
        value.extend_from_slice(self.device_key.secret());
        let id = self.device_id.as_deref().unwrap_or_default();
        if !id.is_empty() {
            crypto::identifier(id)?;
        }
        value.push(id.len() as u8);
        value.extend_from_slice(id.as_bytes());
        value.push(u8::from(self.session.is_some()));
        if let Some(session) = &self.session {
            value.extend_from_slice(&session.expires_at.to_be_bytes());
            value.extend_from_slice(session.token.expose().as_bytes()); // canonical base64url32, 43 bytes
        }
        value.push(u8::from(self.account_key.is_some()));
        if let Some(key) = &self.account_key {
            value.extend_from_slice(&key.version.to_be_bytes());
            value.push(u8::from(key.confirmed));
            value.push(u8::from(key.local_proof));
            value.extend_from_slice(key.key.secret());
        }
        value.push(u8::from(self.account_deleted));
        let pending = match &self.pending_reset {
            Some(pending) => serde_json::to_vec(pending).map_err(|_| AccountError::StoredData)?,
            None => Vec::new(),
        };
        if pending.len() > 1536 {
            return Err(AccountError::StoredData);
        }
        value.extend_from_slice(&(pending.len() as u16).to_be_bytes());
        value.extend_from_slice(&pending);
        Ok(value)
    }
    pub fn decode(value: &[u8]) -> Result<Self> {
        let mut cursor = Cursor(value);
        if cursor.take(MAGIC.len())? != MAGIC {
            return Err(AccountError::StoredData);
        }
        let version = cursor.take(1)?[0];
        if !matches!(version, 1..=3) {
            return Err(AccountError::StoredData);
        }
        let device_key = DeviceKey::restore(cursor.take(32)?)?;
        let length = usize::from(cursor.take(1)?[0]);
        let device_id = if length == 0 {
            None
        } else {
            let id =
                std::str::from_utf8(cursor.take(length)?).map_err(|_| AccountError::StoredData)?;
            crypto::identifier(id).map_err(|_| AccountError::StoredData)?;
            Some(id.to_owned())
        };
        let session = if cursor.flag()? {
            let expires_at = i64::from_be_bytes(
                cursor
                    .take(8)?
                    .try_into()
                    .map_err(|_| AccountError::StoredData)?,
            );
            if expires_at <= 0 {
                return Err(AccountError::StoredData);
            }
            let text =
                std::str::from_utf8(cursor.take(43)?).map_err(|_| AccountError::StoredData)?;
            Some(SavedSession {
                token: SessionToken::parse(text.to_owned())?,
                expires_at,
            })
        } else {
            None
        };
        let account_key = if cursor.flag()? {
            let version = u32::from_be_bytes(
                cursor
                    .take(4)?
                    .try_into()
                    .map_err(|_| AccountError::StoredData)?,
            );
            if !(1..=1_000_000).contains(&version) {
                return Err(AccountError::StoredData);
            }
            let confirmed = cursor.flag()?;
            let local_proof = cursor.flag()?;
            Some(SavedKey {
                key: Arc::new(AccountKey::restore(cursor.take(32)?)?),
                version,
                confirmed,
                local_proof,
            })
        } else {
            None
        };
        let account_deleted = version >= 2 && cursor.flag()?;
        let pending_reset = if version >= 3 {
            let length = u16::from_be_bytes(
                cursor
                    .take(2)?
                    .try_into()
                    .map_err(|_| AccountError::StoredData)?,
            ) as usize;
            if length > 1536 {
                return Err(AccountError::StoredData);
            }
            if length == 0 {
                None
            } else {
                let pending: super::PendingReset = serde_json::from_slice(cursor.take(length)?)
                    .map_err(|_| AccountError::StoredData)?;
                crypto::identifier(&pending.request.review_id)
                    .map_err(|_| AccountError::StoredData)?;
                if !(2..=1_000_000).contains(&pending.version)
                    || pending.request.confirmation != "RESET SYNC"
                    || device_id.is_none()
                    || account_key
                        .as_ref()
                        .is_none_or(|key| key.version != pending.version)
                {
                    return Err(AccountError::StoredData);
                }
                Some(pending)
            }
        } else {
            None
        };
        if !cursor.0.is_empty() || (account_deleted && session.is_some()) {
            return Err(AccountError::StoredData);
        }
        Ok(Self {
            device_key,
            device_id,
            session,
            account_key,
            account_deleted,
            pending_reset,
        })
    }
}
struct Cursor<'a>(&'a [u8]);
impl<'a> Cursor<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        if length > self.0.len() {
            return Err(AccountError::StoredData);
        }
        let (value, remaining) = self.0.split_at(length);
        self.0 = remaining;
        Ok(value)
    }
    fn flag(&mut self) -> Result<bool> {
        match self.take(1)? {
            [0] => Ok(false),
            [1] => Ok(true),
            _ => Err(AccountError::StoredData),
        }
    }
}
