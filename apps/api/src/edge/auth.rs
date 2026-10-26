use super::{Api, Identity, body, json_response, unavailable};
use crate::{
    crypto,
    policy::{self, ApiError, Result},
    sql,
    types::{BeginAuth, ClientKind, VerifyAuth},
};
use futures_util::future::{Either, select};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;
use worker::{
    AbortController, Delay, EmailMessage, Fetch, Headers, Method, Request, RequestInit, Response,
};

#[derive(Deserialize)]
struct Challenge {
    email: String,
    email_key: String,
    client_kind: ClientKind,
}

impl Api {
    pub(super) async fn rate(
        &self,
        domain: &str,
        key: &str,
        period: i64,
        limit: i64,
    ) -> Result<()> {
        let key = crypto::verifier(&self.key, "rate", &[domain, key])?;
        let start = self.now - self.now.rem_euclid(period);
        let row: Option<Value> = self
            .db
            .first(
                sql::RATE,
                vec![
                    json!(key),
                    json!(start),
                    json!(start + period),
                    json!(limit),
                ],
            )
            .await?;
        if row.is_none() {
            return Err(ApiError::RateLimited);
        }
        Ok(())
    }
    pub(super) fn ip(&self, request: &Request) -> Result<String> {
        let value = request
            .headers()
            .get("CF-Connecting-IP")
            .map_err(unavailable)?
            .ok_or(ApiError::Unavailable)?;
        if value.parse::<std::net::IpAddr>().is_err() {
            return Err(ApiError::Unavailable);
        }
        Ok(value)
    }
    pub(super) async fn begin_auth(&self, request: &mut Request) -> Result<Response> {
        let allowlist = self.allowlist()?;
        let input: BeginAuth = body(request).await?;
        if input.client_kind == ClientKind::Browser {
            policy::browser_origin(
                request
                    .headers()
                    .get("Origin")
                    .map_err(unavailable)?
                    .as_deref(),
                &self.origin,
            )?;
        }
        let email = policy::email(&input.email)?;
        if !allowlist.contains(&email) && !self.existing_account(&email).await? {
            return Err(ApiError::InviteRequired);
        }
        let ip = self.ip(request)?;
        self.rate("send-ip", &ip, 3600, 20).await?;
        if input.turnstile_token.is_empty() || input.turnstile_token.len() > 2048 {
            return Err(ApiError::InvalidRequest);
        }
        self.verify_turnstile(&input.turnstile_token, &ip).await?;
        let email_key = crypto::verifier(&self.key, "email", &[&email])?;
        self.rate("send-email", &email_key, 3600, 5).await?;
        let id = crypto::random_token()?;
        let code = crypto::random_code()?;
        let verifier = crypto::verifier(&self.key, "code", &[&id, &email_key, &code])?;
        let row: Option<Value> = self
            .db
            .first(
                sql::BEGIN_AUTH,
                vec![
                    json!(id),
                    json!(email_key),
                    json!(email),
                    json!(verifier),
                    json!(input.client_kind.as_str()),
                    json!(self.now),
                    json!(self.now + policy::CODE_TTL),
                ],
            )
            .await?;
        if row.is_none() {
            return Err(ApiError::RateLimited);
        }
        let delivered = self.deliver(&email, &code).await.is_ok();
        self.db
            .run(
                "UPDATE auth_challenges SET delivery=?2 WHERE id=?1 AND delivery='pending'",
                vec![json!(id), json!(if delivered { "sent" } else { "failed" })],
            )
            .await?;
        if !delivered {
            return Err(ApiError::DeliveryFailed);
        }
        json_response(
            json!({"challenge_id":id,"expires_in":policy::CODE_TTL,"resend_after":policy::RESEND_SECONDS}),
        )
    }
    pub(super) async fn verify_turnstile(&self, token: &str, ip: &str) -> Result<()> {
        let headers = Headers::new();
        headers
            .set("Content-Type", "application/json")
            .map_err(unavailable)?;
        let secret = self
            .env
            .secret("TURNSTILE_SECRET")
            .map_err(unavailable)?
            .to_string();
        let request = Request::new_with_init(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            RequestInit::new()
                .with_method(Method::Post)
                .with_headers(headers)
                .with_body(Some(
                    json!({"secret":secret,"response":token,"remoteip":ip})
                        .to_string()
                        .into(),
                )),
        )
        .map_err(unavailable)?;
        let controller = AbortController::default();
        let signal = controller.signal();
        let fetch = Fetch::Request(request);
        let pending = Box::pin(fetch.send_with_signal(&signal));
        let timeout = Box::pin(Delay::from(Duration::from_secs(10)));
        let mut response = match select(pending, timeout).await {
            Either::Left((result, _)) => result.map_err(unavailable)?,
            Either::Right(_) => {
                controller.abort();
                return Err(ApiError::Unavailable);
            }
        };
        if !(200..300).contains(&response.status_code()) {
            return Err(ApiError::Unavailable);
        }
        let value: Value = response.json().await.map_err(unavailable)?;
        let expected = worker::Url::parse(&self.origin).map_err(unavailable)?;
        if value["success"] != true
            || value["action"] != "signin"
            || value["hostname"].as_str() != expected.host_str()
        {
            return Err(ApiError::Forbidden);
        }
        Ok(())
    }
    pub(super) async fn deliver(&self, email: &str, code: &str) -> Result<()> {
        let sender = policy::email(&self.env.var("EMAIL_FROM").map_err(unavailable)?.to_string())
            .map_err(|_| ApiError::Unavailable)?;
        let domain = sender.rsplit_once('@').ok_or(ApiError::Unavailable)?.1;
        let message_id = crypto::random_token()?;
        let date = js_sys::Date::new_0().to_utc_string();
        let raw = format!(
            "From: auracode <{sender}>\r\nTo: {email}\r\nDate: {date}\r\nMessage-ID: <{message_id}@{domain}>\r\nSubject: Your auracode sign-in code\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour auracode code is {code}.\r\nIt expires in 10 minutes. If you did not request it, ignore this email.\r\n"
        );
        let message = EmailMessage::new(&sender, email, &raw).map_err(unavailable)?;
        let binding = self.env.send_email("EMAIL").map_err(unavailable)?;
        // Never replay an ambiguous send automatically. A failed or timed-out challenge cannot be
        // consumed, even if delivery eventually succeeds. The user retries after the cooldown.
        match select(
            Box::pin(binding.send(&message)),
            Box::pin(Delay::from(Duration::from_secs(15))),
        )
        .await
        {
            Either::Left((Ok(_), _)) => Ok(()),
            _ => Err(ApiError::DeliveryFailed),
        }
    }
    pub(super) async fn verify_auth(&self, request: &mut Request) -> Result<Response> {
        let allowlist = self.allowlist()?;
        self.rate("verify-ip", &self.ip(request)?, 600, 50).await?;
        let input: VerifyAuth = body(request).await?;
        crypto::decode(&input.challenge_id, 32, 32)?;
        if input.code.len() != 6 || !input.code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(ApiError::InvalidCode);
        }
        let challenge: Challenge = self
            .db
            .first(
                "SELECT email,email_key,client_kind FROM auth_challenges WHERE id=?1",
                vec![json!(input.challenge_id)],
            )
            .await?
            .ok_or(ApiError::InvalidCode)?;
        let invited = allowlist.contains(&challenge.email);
        if !invited && !self.existing_account(&challenge.email).await? {
            return Err(ApiError::InviteRequired);
        }
        if challenge.client_kind == ClientKind::Browser {
            policy::browser_origin(
                request
                    .headers()
                    .get("Origin")
                    .map_err(unavailable)?
                    .as_deref(),
                &self.origin,
            )?;
        }
        self.rate("verify-email", &challenge.email_key, 600, 15)
            .await?;
        let verifier = crypto::verifier(
            &self.key,
            "code",
            &[&input.challenge_id, &challenge.email_key, &input.code],
        )?;
        let token = crypto::random_token()?;
        let hash = crypto::hash(&token);
        let csrf = self.csrf(&token)?;
        let user = crypto::random_token()?;
        let claim = crypto::random_token()?;
        let mut statements = vec![(
            sql::CONSUME_CODE,
            vec![
                json!(input.challenge_id),
                json!(verifier),
                json!(claim),
                json!(self.now),
            ],
        )];
        if invited {
            statements.push((
                sql::CREATE_USER,
                vec![json!(user), json!(claim), json!(self.now)],
            ));
        }
        // An uninvited account is never created or recreated. CREATE_SESSION joins a nondeleted
        // existing account inside the same atomic batch, even if deletion raced the earlier read.
        statements.push((
            sql::CREATE_SESSION,
            vec![
                json!(hash),
                json!(claim),
                json!(crypto::hash(&csrf)),
                json!(self.now),
                json!(self.now + policy::SESSION_TTL),
            ],
        ));
        self.db.batch(statements).await?;
        let session: Option<Value> = self
            .db
            .first(sql::AUTHENTICATE, vec![json!(hash), json!(self.now)])
            .await?;
        let session = session.ok_or(ApiError::InvalidCode)?;
        // Rotate the presented browser session only after the new verification committed.
        if challenge.client_kind == ClientKind::Browser {
            let cookie = request
                .headers()
                .get("Cookie")
                .map_err(unavailable)?
                .unwrap_or_default();
            if let Some(old) = policy::cookie_token(&cookie)? {
                self.db
                    .run(
                        "UPDATE sessions SET revoked_at=?3 WHERE token_hash=?1 AND user_id=?2",
                        vec![
                            json!(crypto::hash(old)),
                            session["user_id"].clone(),
                            json!(self.now),
                        ],
                    )
                    .await?;
            }
        }
        let mut response = json_response(
            json!({"user_id":session["user_id"],"expires_at":self.now+policy::SESSION_TTL,"csrf_token":csrf,"token":if challenge.client_kind==ClientKind::Desktop {Some(&token)} else {None}}),
        )?;
        if challenge.client_kind == ClientKind::Browser {
            response
                .headers_mut()
                .set("Set-Cookie", &policy::session_cookie(&token))
                .map_err(unavailable)?;
        }
        Ok(response)
    }
    pub(super) async fn delete_account(&self, identity: &Identity) -> Result<Response> {
        if !(0..=300).contains(&(self.now - identity.session.created_at)) {
            return Err(ApiError::Forbidden);
        }
        self.db
            .batch(vec![
                (
                    crate::deletion_sql::REMEMBER,
                    vec![json!(identity.hash), json!(self.now)],
                ),
                (
                    crate::deletion_sql::DELETE,
                    vec![json!(identity.hash), json!(self.now)],
                ),
                (
                    crate::deletion_sql::REVOKE,
                    vec![json!(identity.hash), json!(self.now)],
                ),
            ])
            .await?;
        let receipt: Option<Value> = self
            .db
            .first(
                crate::deletion_sql::RECEIPT,
                vec![json!(identity.hash), json!(self.now)],
            )
            .await?;
        if receipt.is_none() {
            return Err(ApiError::Unauthorized);
        }
        json_response(json!({"deletion_pending":true}))
    }
}
