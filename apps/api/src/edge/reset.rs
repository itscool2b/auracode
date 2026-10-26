use super::{Api, Identity, body, json_response, unavailable};
use crate::{
    crypto,
    policy::{ApiError, Result},
    reset_sql as sql,
    types::{CancelReset, ResetSync},
};
use serde_json::{Value, json};
use worker::{Request, Response};

impl Api {
    pub(super) async fn cancel_reset(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        let input: CancelReset = body(request).await?;
        crate::policy::identifier(&input.review_id)?;
        self.db
            .run(
                sql::CANCEL,
                vec![
                    json!(input.review_id),
                    json!(identity.hash),
                    json!(self.now),
                ],
            )
            .await?;
        let review:Option<Value>=self.db.first("SELECT consumed_by,request_hash,key_version+1 AS key_version,device_id FROM sync_reset_reviews WHERE id=?1 AND user_id=?2",vec![json!(input.review_id),json!(identity.session.user_id)]).await?;
        let key: Option<Value> = self
            .db
            .first(
                "SELECT key_version FROM user_keys WHERE user_id=?1",
                vec![json!(identity.session.user_id)],
            )
            .await?;
        let current = key.ok_or(ApiError::Conflict)?;
        let outcome = match review {
            Some(value) if value["consumed_by"] == "cancelled" => "cancelled",
            Some(value) if value["request_hash"].is_string() => "committed",
            Some(_) => return Err(ApiError::Conflict),
            None => "absent",
        };
        // Absent means no request can still consume this receipt. The client must additionally
        // compare the current generation and retain its key if that generation could have committed.
        json_response(json!({"outcome":outcome,"key_version":current["key_version"]}))
    }
    pub(super) async fn review_reset(&self, identity: &Identity) -> Result<Response> {
        self.rate("reset", &identity.session.user_id, 3600, 5)
            .await?;
        let id = crypto::random_token()?;
        self.db
            .run(
                sql::REVIEW,
                vec![json!(id), json!(identity.hash), json!(self.now)],
            )
            .await?;
        let review: Option<Value> = self.db.first("SELECT id,key_version+1 AS key_version,expires_at,
            (SELECT COUNT(*) FROM sync_changes WHERE user_id=r.user_id) AS records,
            (SELECT COUNT(*) FROM blobs WHERE user_id=r.user_id) AS blobs,
            (SELECT COUNT(*) FROM devices WHERE user_id=r.user_id AND revoked_at IS NULL AND id<>r.device_id) AS other_devices
            FROM sync_reset_reviews r WHERE id=?1",vec![json!(id)]).await?;
        json_response(json!({"review":review.ok_or(ApiError::Forbidden)?}))
    }
    pub(super) async fn reset_sync(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        let input: ResetSync = body(request).await?;
        input.validate()?;
        let request_hash = crypto::hash(&serde_json::to_string(&input).map_err(unavailable)?);
        let operation = crypto::random_token()?;
        let base = || vec![json!(input.review_id), json!(operation)];
        let wrapped = serde_json::to_string(&input.wrapped_key).map_err(unavailable)?;
        let recovery = serde_json::to_string(&input.recovery_envelope).map_err(unavailable)?;
        // D1 batch is atomic. A condition lost to revocation, expiry or another reset leaves every
        // effect inert. A retry has a different operation token and cannot run any effect again.
        self.db
            .batch(vec![
                (
                    sql::CONSUME,
                    vec![
                        json!(input.review_id),
                        json!(identity.hash),
                        json!(self.now),
                        json!(operation),
                        json!(request_hash),
                    ],
                ),
                (
                    sql::KEYS,
                    vec![
                        json!(input.review_id),
                        json!(operation),
                        json!(input.recovery_verifier),
                        json!(recovery),
                        json!(self.now),
                    ],
                ),
                (sql::HEADS, base()),
                (sql::CHANGES, base()),
                (sql::BLOBS, base()),
                (sql::QUOTA, base()),
                (
                    sql::DEVICES,
                    vec![json!(input.review_id), json!(operation), json!(self.now)],
                ),
                (
                    sql::SESSIONS,
                    vec![json!(input.review_id), json!(operation), json!(self.now)],
                ),
                (
                    sql::DEVICE,
                    vec![
                        json!(input.review_id),
                        json!(operation),
                        json!(self.now),
                        json!(wrapped),
                    ],
                ),
            ])
            .await?;
        let done: Option<Value> = self
            .db
            .first(
                "SELECT r.id FROM sync_reset_reviews r JOIN user_keys k ON k.user_id=r.user_id
            WHERE r.id=?1 AND r.session_hash=?2 AND r.request_hash=?3 AND r.consumed_by IS NOT NULL
            AND k.key_version=r.key_version+1 AND k.initialized_by=r.device_id",
                vec![
                    json!(input.review_id),
                    json!(identity.hash),
                    json!(request_hash),
                ],
            )
            .await?;
        if done.is_none() {
            return Err(ApiError::Conflict);
        }
        self.approved(identity).await?;
        self.get_keys(identity).await
    }
}
