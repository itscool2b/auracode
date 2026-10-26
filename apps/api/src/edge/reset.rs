use super::{Api, Identity, body, json_response, unavailable};
use crate::{
    crypto,
    policy::{ApiError, Result},
    reset_sql as sql,
    types::ResetSync,
};
use serde_json::{Value, json};
use worker::{Request, Response};

impl Api {
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
