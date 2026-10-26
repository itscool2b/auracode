use super::{Api, Identity, body, json_response};
use crate::{
    crypto,
    policy::{self, ApiError, Result},
    sql,
    types::{ApproveDevice, ClientKind, Device, InitializeKeys, RecoverDevice, RegisterDevice},
};
use serde_json::{Value, json};
use worker::{Request, Response};

impl Api {
    pub(super) async fn list_devices(&self, identity: &Identity) -> Result<Response> {
        let devices:Vec<Device>=self.db.all("SELECT id,name,platform,public_key,verification_code,created_at,last_seen,approved_at,revoked_at FROM devices WHERE user_id=?1 ORDER BY created_at DESC LIMIT 100",vec![json!(identity.session.user_id)]).await?;
        json_response(json!({"devices":devices}))
    }
    pub(super) async fn register_device(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        if identity.session.client_kind != ClientKind::Desktop
            || identity.session.device_id.is_some()
        {
            return Err(ApiError::Conflict);
        }
        self.rate("register", &identity.session.user_id, 3600, 10)
            .await?;
        let input: RegisterDevice = body(request).await?;
        input.validate()?;
        let id = crypto::random_token()?;
        let verification = crypto::device_code(&identity.session.user_id, &id, &input.public_key)?;
        self.db
            .batch(vec![
                (
                    sql::REGISTER_DEVICE,
                    vec![
                        json!(id),
                        json!(identity.hash),
                        json!(input.name),
                        json!(input.platform),
                        json!(input.public_key),
                        json!(verification),
                        json!(self.now),
                    ],
                ),
                (sql::BIND_DEVICE, vec![json!(id), json!(identity.hash)]),
            ])
            .await?;
        let value: Option<Value> = self
            .db
            .first(
                "SELECT id FROM devices WHERE id=?1 AND user_id=?2",
                vec![json!(id), json!(identity.session.user_id)],
            )
            .await?;
        if value.is_none() {
            return Err(ApiError::Conflict);
        }
        json_response(json!({"device_id":id,"verification_code":verification,"approved":false}))
    }
    fn pending_device<'a>(&self, identity: &'a Identity) -> Result<&'a str> {
        if identity.session.client_kind != ClientKind::Desktop {
            return Err(ApiError::Forbidden);
        }
        identity
            .session
            .device_id
            .as_deref()
            .ok_or(ApiError::Forbidden)
    }
    pub(super) async fn initialize_keys(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        let device = self.pending_device(identity)?;
        let input: InitializeKeys = body(request).await?;
        input.wrapped_key.validate(false)?;
        input.recovery_envelope.validate(true)?;
        crypto::decode(&input.recovery_verifier, 32, 32)?;
        let wrapped = serde_json::to_string(&input.wrapped_key).map_err(super::unavailable)?;
        let recovery =
            serde_json::to_string(&input.recovery_envelope).map_err(super::unavailable)?;
        self.db
            .batch(vec![
                (
                    sql::INITIALIZE_KEYS,
                    vec![
                        json!(identity.hash),
                        json!(self.now),
                        json!(input.recovery_verifier),
                        json!(recovery),
                    ],
                ),
                (
                    sql::INITIALIZE_DEVICE,
                    vec![
                        json!(device),
                        json!(identity.session.user_id),
                        json!(self.now),
                        json!(wrapped),
                    ],
                ),
            ])
            .await?;
        self.approved(identity).await?;
        self.get_keys(identity).await
    }
    pub(super) async fn approve_device(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        self.approved(identity).await?;
        let input: ApproveDevice = body(request).await?;
        policy::identifier(&input.device_id)?;
        input.wrapped_key.validate(false)?;
        if input.verification_code.len() != 6 {
            return Err(ApiError::InvalidRequest);
        }
        self.rate("approve", &identity.session.user_id, 600, 10)
            .await?;
        let wrapped = serde_json::to_string(&input.wrapped_key).map_err(super::unavailable)?;
        let changed: Option<Value> = self
            .db
            .first(
                sql::APPROVE_DEVICE,
                vec![
                    json!(input.device_id),
                    json!(identity.session.user_id),
                    json!(self.now),
                    json!(wrapped),
                    json!(input.verification_code),
                    json!(identity.hash),
                ],
            )
            .await?;
        if changed.is_none() {
            return Err(ApiError::Conflict);
        }
        json_response(json!({"approved":true}))
    }
    pub(super) async fn recover_device(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        let device = self.pending_device(identity)?;
        self.rate("recovery", &identity.session.user_id, 3600, 5)
            .await?;
        let input: RecoverDevice = body(request).await?;
        input.wrapped_key.validate(false)?;
        crypto::decode(&input.recovery_proof, 32, 32)?;
        let wrapped = serde_json::to_string(&input.wrapped_key).map_err(super::unavailable)?;
        let row: Option<Value> = self
            .db
            .first(
                sql::RECOVER_DEVICE,
                vec![
                    json!(device),
                    json!(identity.session.user_id),
                    json!(self.now),
                    json!(wrapped),
                    json!(crypto::hash(&input.recovery_proof)),
                    json!(identity.hash),
                ],
            )
            .await?;
        if row.is_none() {
            return Err(ApiError::Forbidden);
        }
        self.get_keys(identity).await
    }
    pub(super) async fn get_keys(&self, identity: &Identity) -> Result<Response> {
        let device = self.pending_device(identity)?;
        let row:Option<Value>=self.db.first("SELECT k.key_version,k.recovery_envelope,d.wrapped_key,d.approved_at FROM user_keys k
        JOIN devices d ON d.user_id=k.user_id WHERE d.id=?1 AND k.user_id=?2 AND d.revoked_at IS NULL",vec![json!(device),json!(identity.session.user_id)]).await?;
        // Pending devices may retrieve only the recovery ciphertext, never another device's envelope.
        let mut value = row.ok_or(ApiError::NotFound)?;
        for field in ["recovery_envelope", "wrapped_key"] {
            if let Some(text) = value[field].as_str() {
                value[field] = serde_json::from_str(text).map_err(super::unavailable)?;
            }
        }
        json_response(value)
    }
    pub(super) async fn revoke_device(
        &self,
        identity: &Identity,
        device: &str,
    ) -> Result<Response> {
        policy::identifier(device)?;
        self.db.batch(vec![
            ("UPDATE devices SET revoked_at=?3,wrapped_key=NULL WHERE id=?1 AND user_id=?2 AND revoked_at IS NULL",vec![json!(device),json!(identity.session.user_id),json!(self.now)]),
            ("UPDATE sessions SET revoked_at=?3 WHERE device_id=?1 AND user_id=?2",vec![json!(device),json!(identity.session.user_id),json!(self.now)])
        ]).await?;
        json_response(json!({"revoked":true}))
    }
}
