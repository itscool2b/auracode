use super::{Api, Identity, body, json_response};
use crate::{
    crypto,
    policy::{self, ApiError, Result},
    possession, sql,
    types::{BeginRebind, ClientKind, VerifyRebind},
};
use serde_json::{Value, json};
use worker::{Request, Response};

impl Api {
    pub(super) async fn begin_rebind(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        if identity.session.client_kind != ClientKind::Desktop
            || identity.session.device_id.is_some()
        {
            return Err(ApiError::Forbidden);
        }
        self.rate("device-rebind", &identity.session.user_id, 600, 10)
            .await?;
        let input: BeginRebind = body(request).await?;
        policy::identifier(&input.device_id)?;
        let row:Value=self.db.first("SELECT public_key FROM devices WHERE id=?1 AND user_id=?2 AND approved_at IS NOT NULL AND revoked_at IS NULL",vec![json!(input.device_id),json!(identity.session.user_id)]).await?.ok_or(ApiError::NotFound)?;
        let public = row["public_key"].as_str().ok_or(ApiError::Unavailable)?;
        let challenge = crypto::random_token()?;
        let (envelope, proof) = possession::seal(
            &identity.session.user_id,
            &input.device_id,
            &challenge,
            public,
        )?;
        let verifier = crypto::verifier(&self.key, "device-rebind", &[&challenge, proof.as_str()])?;
        let changed: Option<Value> = self
            .db
            .first(
                sql::BEGIN_REBIND,
                vec![
                    json!(challenge),
                    json!(identity.hash),
                    json!(input.device_id),
                    json!(verifier),
                    json!(self.now),
                ],
            )
            .await?;
        if changed.is_none() {
            return Err(ApiError::Forbidden);
        }
        json_response(
            json!({"challenge_id":challenge,"device_id":input.device_id,"envelope":envelope,"expires_in":300}),
        )
    }
    pub(super) async fn verify_rebind(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        if identity.session.client_kind != ClientKind::Desktop
            || identity.session.device_id.is_some()
        {
            return Err(ApiError::Forbidden);
        }
        self.rate("verify-rebind", &identity.session.user_id, 600, 20)
            .await?;
        let input: VerifyRebind = body(request).await?;
        crypto::decode(&input.challenge_id, 32, 32)?;
        crypto::decode(&input.proof, 32, 32)?;
        let verifier = crypto::verifier(
            &self.key,
            "device-rebind",
            &[&input.challenge_id, &input.proof],
        )?;
        let claim = crypto::random_token()?;
        self.db
            .batch(vec![
                (
                    sql::CONSUME_REBIND,
                    vec![
                        json!(input.challenge_id),
                        json!(identity.hash),
                        json!(verifier),
                        json!(self.now),
                        json!(claim),
                    ],
                ),
                (
                    sql::FINISH_REBIND,
                    vec![
                        json!(input.challenge_id),
                        json!(identity.hash),
                        json!(claim),
                    ],
                ),
            ])
            .await?;
        let consumed:Option<Value>=self.db.first("SELECT device_id FROM device_rebind_challenges WHERE id=?1 AND session_hash=?2 AND consumed_by=?3",vec![json!(input.challenge_id),json!(identity.hash),json!(claim)]).await?;
        if consumed.is_none() {
            return Err(ApiError::Forbidden);
        }
        let device = self.approved(identity).await?;
        json_response(json!({"device_id":device,"rebound":true}))
    }
}
