use super::{Api, Identity, body, json_response};
use crate::{
    account_sql, crypto,
    policy::{self, ApiError, Result},
    types::VerifyAuth,
};
use serde::Deserialize;
use serde_json::{Value, json};
use worker::{Request, Response};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChangeEmail {
    email: String,
    turnstile_token: String,
}

impl Api {
    pub(super) async fn account(&self, identity: &Identity) -> Result<Response> {
        let row:Value=self.db.first("SELECT id,email,created_at,sync_used_bytes,sync_limit_bytes,blob_reserved_bytes,blob_limit_bytes FROM users WHERE id=?1 AND deletion_requested_at IS NULL",vec![json!(identity.session.user_id)]).await?.ok_or(ApiError::Unauthorized)?;
        json_response(json!({"account":row}))
    }
    pub(super) async fn logout_all(&self, identity: &Identity) -> Result<Response> {
        self.db
            .run(
                "UPDATE sessions SET revoked_at=?2 WHERE user_id=?1",
                vec![json!(identity.session.user_id), json!(self.now)],
            )
            .await?;
        json_response(json!({"ok":true}))
    }
    pub(super) async fn begin_email(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        if self.now - identity.session.created_at > 300 {
            return Err(ApiError::Forbidden);
        }
        self.rate("change-email-user", &identity.session.user_id, 3600, 5)
            .await?;
        let input: ChangeEmail = body(request).await?;
        let email = policy::email(&input.email)?;
        let allowlist = self.allowlist()?;
        if input.turnstile_token.is_empty() || input.turnstile_token.len() > 2048 {
            return Err(ApiError::InvalidRequest);
        }
        let ip = self.ip(request)?;
        self.rate("send-ip", &ip, 3600, 20).await?;
        self.verify_turnstile(&input.turnstile_token, &ip).await?;
        // Membership is answered only after the bot check, as when signing in.
        allowlist.require(&email)?;
        let key = crypto::verifier(&self.key, "email", &[&email])?;
        self.rate("send-email", &key, 3600, 5).await?;
        let id = crypto::random_token()?;
        let code = crypto::random_code()?;
        let verifier = crypto::verifier(
            &self.key,
            "email-change",
            &[&id, &identity.hash, &key, &code],
        )?;
        let changed: Option<Value> = self
            .db
            .first(
                account_sql::BEGIN,
                vec![
                    json!(id),
                    json!(identity.hash),
                    json!(email),
                    json!(key),
                    json!(verifier),
                    json!(self.now),
                ],
            )
            .await?;
        if changed.is_none() {
            return Err(ApiError::RateLimited);
        }
        let delivered = self
            .deliver(crate::mail::Purpose::NewEmail, &email, &code)
            .await
            .is_ok();
        self.db
            .run(
                "UPDATE email_changes SET delivery=?2 WHERE id=?1 AND delivery='pending'",
                vec![json!(id), json!(if delivered { "sent" } else { "failed" })],
            )
            .await?;
        if !delivered {
            return Err(ApiError::DeliveryFailed);
        }
        json_response(json!({"challenge_id":id,"expires_in":600,"resend_after":60}))
    }
    pub(super) async fn verify_email(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        self.rate("verify-email-change", &identity.session.user_id, 600, 15)
            .await?;
        let input: VerifyAuth = body(request).await?;
        crypto::decode(&input.challenge_id, 32, 32)?;
        if input.code.len() != 6 || !input.code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(ApiError::InvalidCode);
        }
        let row: Value = self
            .db
            .first(
                "SELECT email,email_key FROM email_changes WHERE id=?1 AND session_hash=?2",
                vec![json!(input.challenge_id), json!(identity.hash)],
            )
            .await?
            .ok_or(ApiError::InvalidCode)?;
        self.allowlist()?
            .require(row["email"].as_str().ok_or(ApiError::Unavailable)?)?;
        let key = row["email_key"].as_str().ok_or(ApiError::Unavailable)?;
        let verifier = crypto::verifier(
            &self.key,
            "email-change",
            &[&input.challenge_id, &identity.hash, key, &input.code],
        )?;
        let claim = crypto::random_token()?;
        self.db
            .batch(vec![
                (
                    account_sql::CONSUME,
                    vec![
                        json!(input.challenge_id),
                        json!(identity.hash),
                        json!(verifier),
                        json!(self.now),
                        json!(claim),
                    ],
                ),
                (account_sql::APPLY, vec![json!(claim)]),
                (
                    account_sql::REVOKE,
                    vec![json!(claim), json!(self.now), json!(identity.hash)],
                ),
            ])
            .await?;
        let row:Option<Value>=self.db.first("SELECT u.email=c.email AS changed FROM email_changes c JOIN users u ON u.id=c.user_id WHERE c.consumed_by=?1",vec![json!(claim)]).await?;
        match row.and_then(|v| v["changed"].as_i64()) {
            Some(1) => json_response(json!({"changed":true})),
            Some(_) => Err(ApiError::Conflict),
            None => Err(ApiError::InvalidCode),
        }
    }
}
