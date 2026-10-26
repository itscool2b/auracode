//! Cloudflare runtime adapter. No request payload, token, email or provider error is logged.
mod account;
mod auth;
mod cleanup;
mod db;
mod devices;
mod export;
mod rebind;
mod sync;

use crate::{
    crypto,
    policy::{self, ApiError, Result},
    types::{ClientKind, Session},
};
use futures_util::StreamExt;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use worker::{Context, Env, Method, Request, Response, event};

pub(super) struct Api {
    env: Env,
    db: db::Db,
    key: Vec<u8>,
    origin: String,
    now: i64,
}
pub(super) struct Identity {
    session: Session,
    hash: String,
    token: String,
}

#[event(fetch)]
pub async fn fetch(mut request: Request, env: Env, _context: Context) -> worker::Result<Response> {
    let operation = async {
        let origin = env.var("APP_ORIGIN").map_err(unavailable)?.to_string();
        if !origin.starts_with("https://") || origin.ends_with('/') {
            return Err(ApiError::Unavailable);
        }
        let key = crypto::decode(
            &env.secret("AUTH_HMAC_KEY")
                .map_err(unavailable)?
                .to_string(),
            32,
            64,
        )
        .map_err(|_| ApiError::Unavailable)?;
        let db = db::Db(env.d1("DB").map_err(unavailable)?);
        let api = Api {
            env,
            db,
            key,
            origin,
            now: (js_sys::Date::now() / 1000.0) as i64,
        };
        api.route(&mut request).await
    };
    let result = match futures_util::future::select(
        Box::pin(operation),
        Box::pin(worker::Delay::from(std::time::Duration::from_secs(45))),
    )
    .await
    {
        futures_util::future::Either::Left((result, _)) => result,
        futures_util::future::Either::Right(_) => Err(ApiError::Unavailable),
    };
    let mut response = match result {
        Ok(response) => response,
        Err(error) => {
            let mut response =
                Response::from_json(&json!({"error":error,"message":error.to_string()}))?
                    .with_status(error.status());
            if matches!(error, ApiError::RateLimited | ApiError::DeliveryFailed) {
                response.headers_mut().set("Retry-After", "60")?;
            }
            response
        }
    };
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    response
        .headers_mut()
        .set("Referrer-Policy", "no-referrer")?;
    Ok(response)
}

impl Api {
    async fn route(&self, request: &mut Request) -> Result<Response> {
        let path = request.path();
        let method = request.method();
        if let Some(origin) = request.headers().get("Origin").map_err(unavailable)? {
            policy::browser_origin(Some(&origin), &self.origin)?;
        }
        match (method.clone(), path.as_str()) {
            (Method::Get, "/api/v1/health") => {
                return json_response(json!({"ok":true,"protocol":1}));
            }
            (Method::Get, "/api/v1/config") => {
                let site_key = self
                    .env
                    .var("TURNSTILE_SITE_KEY")
                    .ok()
                    .map(|v| v.to_string())
                    .filter(|v| !v.is_empty());
                return json_response(json!({"turnstile_site_key":site_key,"protocol":1}));
            }
            (Method::Post, "/api/v1/auth/challenges") => return self.begin_auth(request).await,
            (Method::Post, "/api/v1/auth/verify") => return self.verify_auth(request).await,
            _ => {}
        }
        let identity = self.authenticate(request).await?;
        match (method, path.as_str()) {
            (Method::Get, "/api/v1/account") => self.account(&identity).await,
            (Method::Get, "/api/v1/account/export") => self.export(&identity).await,
            (Method::Post, "/api/v1/auth/logout-all") => self.logout_all(&identity).await,
            (Method::Post, "/api/v1/account/email/challenges") => {
                self.begin_email(request, &identity).await
            }
            (Method::Post, "/api/v1/account/email/verify") => {
                self.verify_email(request, &identity).await
            }
            (Method::Get, "/api/v1/auth/session") => json_response(
                json!({"session":identity.session,"csrf_token":self.csrf(&identity.token)?}),
            ),
            (Method::Post, "/api/v1/auth/logout") => {
                self.db
                    .run(
                        "UPDATE sessions SET revoked_at=?2 WHERE token_hash=?1",
                        vec![json!(identity.hash), json!(self.now)],
                    )
                    .await?;
                let mut response = json_response(json!({"ok":true}))?;
                response
                    .headers_mut()
                    .set(
                        "Set-Cookie",
                        &format!(
                            "{}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
                            policy::COOKIE
                        ),
                    )
                    .map_err(unavailable)?;
                Ok(response)
            }
            (Method::Delete, "/api/v1/account") => self.delete_account(&identity).await,
            (Method::Get, "/api/v1/devices") => self.list_devices(&identity).await,
            (Method::Post, "/api/v1/devices") => self.register_device(request, &identity).await,
            (Method::Post, "/api/v1/devices/approve") => {
                self.approve_device(request, &identity).await
            }
            (Method::Post, "/api/v1/devices/rebind/challenges") => {
                self.begin_rebind(request, &identity).await
            }
            (Method::Post, "/api/v1/devices/rebind/verify") => {
                self.verify_rebind(request, &identity).await
            }
            (Method::Post, "/api/v1/devices/recover") => {
                self.recover_device(request, &identity).await
            }
            (Method::Post, "/api/v1/keys") => self.initialize_keys(request, &identity).await,
            (Method::Get, "/api/v1/keys") => self.get_keys(&identity).await,
            (Method::Get, "/api/v1/sync") => self.pull(request, &identity).await,
            (Method::Post, "/api/v1/sync") => self.push(request, &identity).await,
            (Method::Delete, path) if path.starts_with("/api/v1/devices/") => {
                self.revoke_device(&identity, &path[16..]).await
            }
            (Method::Get, path) if path.starts_with("/api/v1/devices/") => {
                crate::policy::identifier(&path[16..])?;
                let device:Option<crate::types::Device>=self.db.first("SELECT id,name,platform,public_key,verification_code,created_at,last_seen,approved_at,revoked_at FROM devices WHERE id=?1 AND user_id=?2",vec![json!(&path[16..]),json!(identity.session.user_id)]).await?;
                json_response(json!({"device":device.ok_or(ApiError::NotFound)?}))
            }
            (Method::Put, path) if path.starts_with("/api/v1/blobs/") => {
                self.put_blob(request, &identity, &path[14..]).await
            }
            (Method::Get, path) if path.starts_with("/api/v1/blobs/") => {
                self.get_blob(&identity, &path[14..]).await
            }
            _ => Err(ApiError::NotFound),
        }
    }

    async fn authenticate(&self, request: &Request) -> Result<Identity> {
        let cookie = request
            .headers()
            .get("Cookie")
            .map_err(unavailable)?
            .unwrap_or_default();
        let cookie = policy::cookie_token(&cookie)?;
        let bearer = request
            .headers()
            .get("Authorization")
            .map_err(unavailable)?;
        let (token, kind) = match (cookie, bearer.as_deref()) {
            (Some(token), None) => (token, ClientKind::Browser),
            (None, Some(header)) => (
                header
                    .strip_prefix("Bearer ")
                    .ok_or(ApiError::Unauthorized)?,
                ClientKind::Desktop,
            ),
            _ => return Err(ApiError::Unauthorized),
        };
        crypto::decode(token, 32, 32).map_err(|_| ApiError::Unauthorized)?;
        let hash = crypto::hash(token);
        let session: Session = self
            .db
            .first(crate::sql::AUTHENTICATE, vec![json!(hash), json!(self.now)])
            .await?
            .ok_or(ApiError::Unauthorized)?;
        if session.client_kind != kind {
            return Err(ApiError::Unauthorized);
        }
        if kind == ClientKind::Browser && !matches!(request.method(), Method::Get | Method::Head) {
            policy::browser_origin(
                request
                    .headers()
                    .get("Origin")
                    .map_err(unavailable)?
                    .as_deref(),
                &self.origin,
            )?;
            let csrf = request
                .headers()
                .get("X-Auracode-CSRF")
                .map_err(unavailable)?
                .ok_or(ApiError::Forbidden)?;
            if !crypto::equal(&crypto::hash(&csrf), &session.csrf_hash) {
                return Err(ApiError::Forbidden);
            }
        }
        Ok(Identity {
            session,
            hash,
            token: token.into(),
        })
    }
    fn csrf(&self, token: &str) -> Result<String> {
        crypto::verifier(&self.key, "csrf", &[token])
    }
    async fn approved(&self, identity: &Identity) -> Result<String> {
        let value: Option<Value> = self
            .db
            .first(
                crate::sql::APPROVED,
                vec![json!(identity.hash), json!(self.now)],
            )
            .await?;
        value
            .and_then(|row| row["id"].as_str().map(str::to_owned))
            .ok_or(ApiError::Forbidden)
    }
}

pub(super) fn unavailable(_: impl std::fmt::Debug) -> ApiError {
    ApiError::Unavailable
}
pub(super) fn json_response(value: Value) -> Result<Response> {
    Response::from_json(&value).map_err(unavailable)
}
pub(super) async fn body<T: DeserializeOwned>(request: &mut Request) -> Result<T> {
    let content = request
        .headers()
        .get("Content-Type")
        .map_err(unavailable)?
        .unwrap_or_default();
    if content.split(';').next() != Some("application/json") {
        return Err(ApiError::InvalidRequest);
    }
    if request
        .headers()
        .get("Content-Length")
        .map_err(unavailable)?
        .is_some_and(|n| n.parse::<usize>().map_or(true, |n| n > policy::MAX_BODY))
    {
        return Err(ApiError::InvalidRequest);
    }
    let mut stream = request.stream().map_err(|_| ApiError::InvalidRequest)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ApiError::InvalidRequest)?;
        if bytes.len().saturating_add(chunk.len()) > policy::MAX_BODY {
            return Err(ApiError::InvalidRequest);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError::InvalidRequest)
}
