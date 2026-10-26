use crate::{
    crypto,
    policy::{self, ApiError, Result},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    Browser,
    Desktop,
}
impl ClientKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::Desktop => "desktop",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BeginAuth {
    pub email: String,
    pub turnstile_token: String,
    pub client_kind: ClientKind,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyAuth {
    pub challenge_id: String,
    pub code: String,
}

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub user_id: String,
    pub client_kind: ClientKind,
    pub device_id: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    #[serde(skip_serializing)]
    pub csrf_hash: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterDevice {
    pub name: String,
    pub platform: String,
    pub public_key: String,
}
impl RegisterDevice {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.len() > 80
            || self.name.chars().any(char::is_control)
            || !matches!(self.platform.as_str(), "windows" | "macos")
        {
            return Err(ApiError::InvalidRequest);
        }
        let bytes = crypto::decode(&self.public_key, 32, 32)?;
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(ApiError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub public_key: String,
    pub verification_code: String,
    pub created_at: i64,
    pub last_seen: i64,
    pub approved_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

/// Versioned client key envelope. The server validates bounds, never opens it.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyEnvelope {
    pub algorithm: String,
    pub ciphertext: String,
    pub nonce: String,
    pub ephemeral_public_key: Option<String>,
}
impl KeyEnvelope {
    pub fn validate(&self, recovery: bool) -> Result<()> {
        let algorithm = if recovery {
            "recovery-xchacha20poly1305-v1"
        } else {
            "x25519-hkdf-sha256-xchacha20poly1305-v1"
        };
        if self.algorithm != algorithm {
            return Err(ApiError::InvalidRequest);
        }
        crypto::decode(&self.ciphertext, 48, 48)?;
        crypto::decode(&self.nonce, 24, 24)?;
        match (&self.ephemeral_public_key, recovery) {
            (Some(key), false) => {
                crypto::decode(key, 32, 32)?;
            }
            (None, true) => {}
            _ => return Err(ApiError::InvalidRequest),
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitializeKeys {
    pub wrapped_key: KeyEnvelope,
    pub recovery_envelope: KeyEnvelope,
    pub recovery_verifier: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApproveDevice {
    pub device_id: String,
    pub verification_code: String,
    pub wrapped_key: KeyEnvelope,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoverDevice {
    pub recovery_proof: String,
    pub wrapped_key: KeyEnvelope,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub collection: String,
    pub id: String,
    pub hlc: String,
    pub deleted: bool,
    pub nonce: String,
    pub ciphertext: String,
    pub key_version: i64,
}
impl Record {
    pub fn validate(&self, device: &str, now_ms: i64) -> Result<usize> {
        if !matches!(
            self.collection.as_str(),
            "projects" | "chats" | "chat_chunks" | "config"
        ) {
            return Err(ApiError::InvalidRequest);
        }
        policy::identifier(&self.id)?;
        // Fixed-width numeric components make the SQL lexical comparison exactly the HLC order.
        let parts: Vec<_> = self.hlc.split(':').collect();
        if parts.len() != 3
            || parts[0].len() != 13
            || parts[1].len() != 10
            || parts[2] != device
            || !parts[0]
                .bytes()
                .chain(parts[1].bytes())
                .all(|b| b.is_ascii_digit())
        {
            return Err(ApiError::InvalidRequest);
        }
        let timestamp: i64 = parts[0].parse().map_err(|_| ApiError::InvalidRequest)?;
        if timestamp > now_ms.saturating_add(300_000)
            || self.key_version < 1
            || self.key_version > 1_000_000
        {
            return Err(ApiError::InvalidRequest);
        }
        crypto::decode(&self.nonce, 24, 24)?;
        Ok(crypto::decode(&self.ciphertext, 16, policy::MAX_RECORD)?.len())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Push {
    pub records: Vec<Record>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PutBlob {
    pub nonce: String,
    pub ciphertext: String,
    pub key_version: i64,
    pub expected_etag: Option<String>,
}

/// SQLite returns booleans as integers. Keep the public wire identical to submitted Record fields.
pub fn wire_change(mut row: serde_json::Value) -> Result<serde_json::Value> {
    row["deleted"] = match row["deleted"].as_i64() {
        Some(0) => serde_json::Value::Bool(false),
        Some(1) => serde_json::Value::Bool(true),
        _ => return Err(ApiError::Unavailable),
    };
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_tombstones_are_canonical_booleans_on_the_wire() {
        for (stored, expected) in [(0, false), (1, true)] {
            let row = wire_change(serde_json::json!({"deleted": stored})).expect("row");
            assert_eq!(row["deleted"], expected);
        }
        assert!(wire_change(serde_json::json!({"deleted": 2})).is_err());
        assert!(wire_change(serde_json::json!({})).is_err());
    }
    #[test]
    fn record_clock_must_bind_its_device_and_sort_numerically() {
        let mut record = Record {
            collection: "chats".into(),
            id: "c".into(),
            hlc: "1793000000000:0000000001:device".into(),
            deleted: false,
            nonce: crypto::encode(&[0; 24]),
            ciphertext: crypto::encode(&[1; 16]),
            key_version: 1,
        };
        assert_eq!(
            record.validate("device", 1793000000000).expect("record"),
            16
        );
        assert!(record.validate("another", 1793000000000).is_err());
        assert!(record.validate("device", 0).is_err());
        record.hlc = "1793000000000:1:device".into();
        assert!(record.validate("device", 1793000000000).is_err());
    }
}
