//! Bounded HTTPS transport. No redirects, automatic retries, cookies or payload diagnostics.
use crate::{
    crypto::{self, KeyEnvelope},
    wire::*,
};
use reqwest::{
    Client, Method, Url,
    header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::time::Duration;
use zeroize::Zeroizing;

const MAX_BODY: usize = 6 * 1024 * 1024;
const MAX_BATCH: usize = 32;
pub const MAX_CURSOR: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ApiError {
    #[error("The account service requires a valid HTTPS origin.")]
    Origin,
    #[error("The request contains an invalid value.")]
    InvalidInput,
    #[error("The account service could not be reached.")]
    Offline,
    #[error("The account request timed out.")]
    TimedOut,
    #[error("Sign in again. Local data remains on this device.")]
    Unauthorized,
    #[error("This account was deleted. Retained local data is still available.")]
    Deleted,
    #[error("This device is not approved or the request is not allowed.")]
    Forbidden,
    #[error("The code is invalid or expired.")]
    InvalidCode,
    #[error("The item changed. Fetch it before retrying.")]
    Conflict,
    #[error("Sync is paused because the storage quota was reached.")]
    Quota,
    #[error("Too many requests. Try again after the cooldown.")]
    RateLimited { retry_after_seconds: u32 },
    #[error("The email could not be delivered. Request another code after the cooldown.")]
    DeliveryFailed { retry_after_seconds: u32 },
    #[error("The account service is temporarily unavailable.")]
    Unavailable,
    #[error("The requested item was not found.")]
    NotFound,
    #[error("The account service returned an invalid or unsupported response.")]
    Protocol,
}
type Result<T> = std::result::Result<T, ApiError>;

#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    origin: Url,
}
impl ApiClient {
    pub fn origin(&self) -> &str {
        self.origin.as_str()
    }
    pub fn new(origin: &str) -> Result<Self> {
        Self::build(origin, false)
    }
    #[cfg(test)]
    pub(crate) fn local_test(origin: &str) -> Self {
        Self::build(origin, true).expect("local test origin")
    }
    fn build(origin: &str, allow_local_test: bool) -> Result<Self> {
        let origin = Url::parse(origin).map_err(|_| ApiError::Origin)?;
        let local =
            allow_local_test && origin.scheme() == "http" && origin.host_str() == Some("127.0.0.1");
        if (!local && origin.scheme() != "https")
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(ApiError::Origin);
        }
        let builder = Client::builder()
            .https_only(!local)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("auracode/", env!("CARGO_PKG_VERSION")));
        let builder = if local { builder.no_proxy() } else { builder };
        let http = builder.build().map_err(|_| ApiError::Offline)?;
        Ok(Self { http, origin })
    }

    fn request(
        &self,
        method: Method,
        path: &str,
        token: Option<&SessionToken>,
        body: Option<Vec<u8>>,
    ) -> Result<reqwest::Request> {
        let url = self
            .origin
            .join(&format!("api/v1/{path}"))
            .map_err(|_| ApiError::InvalidInput)?;
        let mut request = self.http.request(method, url);
        if let Some(token) = token {
            let value = Zeroizing::new(format!("Bearer {}", token.expose()));
            let mut header = HeaderValue::from_str(&value).map_err(|_| ApiError::InvalidInput)?;
            header.set_sensitive(true);
            request = request.header(AUTHORIZATION, header);
        }
        if let Some(body) = body {
            if body.len() > MAX_BODY {
                return Err(ApiError::InvalidInput);
            }
            request = request.header(CONTENT_TYPE, "application/json").body(body);
        }
        request.build().map_err(|_| ApiError::InvalidInput)
    }
    async fn send<R: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        token: Option<&SessionToken>,
        body: Option<&impl Serialize>,
    ) -> Result<R> {
        let body = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| ApiError::InvalidInput)?;
        let request = self.request(method, path, token, body)?;
        let mut response = self.http.execute(request).await.map_err(network)?;
        let status = response.status().as_u16();
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(60)
            .clamp(1, 86_400);
        // Revocation and policy responses do not depend on a potentially huge/malformed body.
        // In particular, every 401 must halt the caller's authenticated sync state.
        if status >= 300 && !matches!(status, 400 | 503) {
            return Err(failure(status, None, retry));
        }
        let limit = if status >= 300 { 16 * 1024 } else { MAX_BODY };
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(ApiError::Protocol);
        }
        let mut bytes = Zeroizing::new(Vec::new());
        while let Some(chunk) = response.chunk().await.map_err(network)? {
            if bytes.len().saturating_add(chunk.len()) > limit {
                return Err(ApiError::Protocol);
            }
            bytes.extend_from_slice(&chunk);
        }
        if !(200..300).contains(&status) {
            #[derive(Deserialize)]
            struct Failure {
                error: String,
            }
            let kind = serde_json::from_slice::<Failure>(&bytes)
                .ok()
                .map(|value| value.error);
            return Err(failure(status, kind.as_deref(), retry));
        }
        serde_json::from_slice(&bytes).map_err(|_| ApiError::Protocol)
    }
    async fn get<R: DeserializeOwned>(&self, path: &str, token: &SessionToken) -> Result<R> {
        self.send(Method::GET, path, Some(token), None::<&()>).await
    }
    async fn post<R: DeserializeOwned>(
        &self,
        path: &str,
        token: Option<&SessionToken>,
        body: &impl Serialize,
    ) -> Result<R> {
        self.send(Method::POST, path, token, Some(body)).await
    }

    pub async fn begin_auth(&self, email: &str, turnstile_token: &str) -> Result<Challenge> {
        if email.len() > 254
            || email.is_empty()
            || turnstile_token.is_empty()
            || turnstile_token.len() > 4096
        {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Begin<'a> {
            email: &'a str,
            turnstile_token: &'a str,
            client_kind: &'a str,
        }
        let challenge: Challenge = self
            .post(
                "auth/challenges",
                None,
                &Begin {
                    email,
                    turnstile_token,
                    client_kind: "desktop",
                },
            )
            .await?;
        if crypto::decode(&challenge.challenge_id, 32).map_or(true, |value| value.len() != 32)
            || challenge.expires_in > 3600
            || challenge.resend_after > 3600
        {
            return Err(ApiError::Protocol);
        }
        Ok(challenge)
    }
    pub async fn verify_auth(&self, challenge_id: &str, code: &str) -> Result<VerifiedSession> {
        if crypto::decode(challenge_id, 32).map_or(true, |value| value.len() != 32)
            || code.len() != 6
            || !code.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Verify<'a> {
            challenge_id: &'a str,
            code: &'a str,
        }
        let session: VerifiedSession = self
            .post("auth/verify", None, &Verify { challenge_id, code })
            .await?;
        id(&session.user_id).map_err(|_| ApiError::Protocol)?;
        if session.expires_at <= 0 {
            return Err(ApiError::Protocol);
        }
        Ok(session)
    }
    pub async fn session(&self, token: &SessionToken) -> Result<Session> {
        #[derive(Deserialize)]
        struct Reply {
            session: Session,
        }
        let reply: Reply = self.get("auth/session", token).await?;
        if reply.session.client_kind != "desktop"
            || id(&reply.session.user_id).is_err()
            || reply
                .session
                .device_id
                .as_deref()
                .is_some_and(|value| id(value).is_err())
            || reply.session.created_at < 0
            || reply.session.expires_at <= reply.session.created_at
        {
            return Err(ApiError::Protocol);
        }
        Ok(reply.session)
    }
    pub async fn logout(&self, token: &SessionToken) -> Result<()> {
        let _: serde_json::Value = self.post("auth/logout", Some(token), &()).await?;
        Ok(())
    }
    pub async fn register_device(
        &self,
        token: &SessionToken,
        name: &str,
        platform: Platform,
        public_key: &str,
    ) -> Result<RegisteredDevice> {
        if name.trim().is_empty()
            || name.len() > 80
            || name.chars().any(char::is_control)
            || crypto::decode(public_key, 32).map_or(true, |key| key.len() != 32)
        {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Register<'a> {
            name: &'a str,
            platform: Platform,
            public_key: &'a str,
        }
        let device: RegisteredDevice = self
            .post(
                "devices",
                Some(token),
                &Register {
                    name,
                    platform,
                    public_key,
                },
            )
            .await?;
        if id(&device.device_id).is_err() || !code(&device.verification_code) || device.approved {
            return Err(ApiError::Protocol);
        }
        Ok(device)
    }
    pub async fn devices(&self, token: &SessionToken) -> Result<Vec<Device>> {
        #[derive(Deserialize)]
        struct Reply {
            devices: Vec<Device>,
        }
        let reply: Reply = self.get("devices", token).await?;
        let mut ids = std::collections::HashSet::new();
        if reply.devices.len() > 100
            || reply
                .devices
                .iter()
                .any(|device| !valid_device(device) || !ids.insert(&device.id))
        {
            return Err(ApiError::Protocol);
        }
        Ok(reply.devices)
    }
    pub async fn device(&self, token: &SessionToken, device: &str) -> Result<Device> {
        id(device)?;
        #[derive(Deserialize)]
        struct Reply {
            device: Device,
        }
        let reply: Reply = self.get(&format!("devices/{device}"), token).await?;
        if reply.device.id != device || !valid_device(&reply.device) {
            return Err(ApiError::Protocol);
        }
        Ok(reply.device)
    }
    pub async fn begin_rebind(
        &self,
        token: &SessionToken,
        device_id: &str,
    ) -> Result<RebindChallenge> {
        id(device_id)?;
        #[derive(Serialize)]
        struct Begin<'a> {
            device_id: &'a str,
        }
        let reply: RebindChallenge = self
            .post(
                "devices/rebind/challenges",
                Some(token),
                &Begin { device_id },
            )
            .await?;
        if reply.device_id != device_id
            || !(1..=300).contains(&reply.expires_in)
            || !binary(&reply.challenge_id, 32, 32)
            || reply.envelope.algorithm != crypto::REBIND_ALGORITHM
        {
            return Err(ApiError::Protocol);
        }
        Ok(reply)
    }
    pub async fn verify_rebind(
        &self,
        token: &SessionToken,
        challenge: &RebindChallenge,
        proof: &str,
    ) -> Result<()> {
        if !binary(&challenge.challenge_id, 32, 32) || !binary(proof, 32, 32) {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Verify<'a> {
            challenge_id: &'a str,
            proof: &'a str,
        }
        #[derive(Deserialize)]
        struct Reply {
            device_id: String,
            rebound: bool,
        }
        let reply: Reply = self
            .post(
                "devices/rebind/verify",
                Some(token),
                &Verify {
                    challenge_id: &challenge.challenge_id,
                    proof,
                },
            )
            .await?;
        if !reply.rebound || reply.device_id != challenge.device_id {
            return Err(ApiError::Protocol);
        }
        Ok(())
    }
    pub async fn keys(&self, token: &SessionToken) -> Result<Keys> {
        self.get("keys", token).await
    }
    pub async fn review_reset(&self, token: &SessionToken) -> Result<ResetReview> {
        #[derive(Deserialize)]
        struct Response {
            review: ResetReview,
        }
        let response: Response = self
            .post("sync/reset/review", Some(token), &serde_json::json!({}))
            .await?;
        crypto::identifier(&response.review.id).map_err(|_| ApiError::Protocol)?;
        if !(2..=1_000_000).contains(&response.review.key_version) {
            return Err(ApiError::Protocol);
        }
        Ok(response.review)
    }
    pub async fn reset_sync(&self, token: &SessionToken, input: &ResetRequest) -> Result<Keys> {
        self.post("sync/reset", Some(token), input).await
    }
    pub async fn cancel_reset(&self, token: &SessionToken, id: &str) -> Result<ResetCancellation> {
        self.post(
            "sync/reset/cancel",
            Some(token),
            &serde_json::json!({"review_id":id}),
        )
        .await
    }
    pub async fn initialize_keys(
        &self,
        token: &SessionToken,
        wrapped_key: &KeyEnvelope,
        recovery_envelope: &KeyEnvelope,
        recovery_verifier: &str,
    ) -> Result<Keys> {
        #[derive(Serialize)]
        struct Initialize<'a> {
            wrapped_key: &'a KeyEnvelope,
            recovery_envelope: &'a KeyEnvelope,
            recovery_verifier: &'a str,
        }
        self.post(
            "keys",
            Some(token),
            &Initialize {
                wrapped_key,
                recovery_envelope,
                recovery_verifier,
            },
        )
        .await
    }
    pub async fn approve_device(
        &self,
        token: &SessionToken,
        device_id: &str,
        verification_code: &str,
        wrapped_key: &KeyEnvelope,
    ) -> Result<()> {
        id(device_id)?;
        if !code(verification_code) {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Approve<'a> {
            device_id: &'a str,
            verification_code: &'a str,
            wrapped_key: &'a KeyEnvelope,
        }
        let _: serde_json::Value = self
            .post(
                "devices/approve",
                Some(token),
                &Approve {
                    device_id,
                    verification_code,
                    wrapped_key,
                },
            )
            .await?;
        Ok(())
    }
    pub async fn recover_device(
        &self,
        token: &SessionToken,
        recovery_proof: &str,
        wrapped_key: &KeyEnvelope,
    ) -> Result<Keys> {
        #[derive(Serialize)]
        struct Recover<'a> {
            recovery_proof: &'a str,
            wrapped_key: &'a KeyEnvelope,
        }
        self.post(
            "devices/recover",
            Some(token),
            &Recover {
                recovery_proof,
                wrapped_key,
            },
        )
        .await
    }
    pub async fn revoke_device(&self, token: &SessionToken, device: &str) -> Result<()> {
        id(device)?;
        let _: serde_json::Value = self
            .send(
                Method::DELETE,
                &format!("devices/{device}"),
                Some(token),
                None::<&()>,
            )
            .await?;
        Ok(())
    }
    pub async fn pull(&self, token: &SessionToken, after: u64) -> Result<Pull> {
        if after > MAX_CURSOR {
            return Err(ApiError::InvalidInput);
        }
        let pull: Pull = self.get(&format!("sync?after={after}"), token).await?;
        let mut previous = after;
        if pull.records.len() > MAX_BATCH {
            return Err(ApiError::Protocol);
        }
        for change in &pull.records {
            if change.server_seq <= previous || !valid_change(change) {
                return Err(ApiError::Protocol);
            }
            previous = change.server_seq;
        }
        if pull.next_cursor != previous || pull.has_more && pull.records.len() != MAX_BATCH {
            return Err(ApiError::Protocol);
        }
        Ok(pull)
    }
    pub async fn push(&self, token: &SessionToken, records: &[EncryptedRecord]) -> Result<Heads> {
        let mut ids = std::collections::HashSet::new();
        if records.is_empty()
            || records.len() > MAX_BATCH
            || records.iter().any(|record| {
                !valid_record(record) || !ids.insert((&record.collection, &record.id))
            })
        {
            return Err(ApiError::InvalidInput);
        }
        #[derive(Serialize)]
        struct Push<'a> {
            records: &'a [EncryptedRecord],
        }
        let heads: Heads = self.post("sync", Some(token), &Push { records }).await?;
        if heads.heads.len() != records.len()
            || heads.heads.iter().zip(records).any(|(head, record)| {
                !valid_change(head)
                    || head.record.collection != record.collection
                    || head.record.id != record.id
            })
        {
            return Err(ApiError::Protocol);
        }
        Ok(heads)
    }
    pub async fn blob(&self, token: &SessionToken, blob: &str) -> Result<Blob> {
        id(blob)?;
        self.get(&format!("blobs/{blob}"), token).await
    }
    pub async fn put_blob(
        &self,
        token: &SessionToken,
        blob: &str,
        sealed: &crypto::SealedPayload,
        key_version: u32,
        expected_etag: Option<&str>,
    ) -> Result<String> {
        id(blob)?;
        #[derive(Serialize)]
        struct Put<'a> {
            nonce: &'a str,
            ciphertext: &'a str,
            key_version: u32,
            expected_etag: Option<&'a str>,
        }
        #[derive(Deserialize)]
        struct Reply {
            etag: String,
        }
        let reply: Reply = self
            .send(
                Method::PUT,
                &format!("blobs/{blob}"),
                Some(token),
                Some(&Put {
                    nonce: &sealed.nonce,
                    ciphertext: &sealed.ciphertext,
                    key_version,
                    expected_etag,
                }),
            )
            .await?;
        if crypto::decode(&reply.etag, 32).map_or(true, |value| value.len() != 32) {
            return Err(ApiError::Protocol);
        }
        Ok(reply.etag)
    }
}
fn id(value: &str) -> Result<()> {
    crypto::identifier(value).map_err(|_| ApiError::InvalidInput)
}
fn code(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_digit())
}
fn valid_device(device: &Device) -> bool {
    id(&device.id).is_ok()
        && code(&device.verification_code)
        && binary(&device.public_key, 32, 32)
        && !device.name.trim().is_empty()
        && device.name.len() <= 80
        && !device.name.chars().any(char::is_control)
        && matches!(device.platform.as_str(), "windows" | "macos")
}
fn binary(value: &str, min: usize, max: usize) -> bool {
    crypto::decode(value, max).is_ok_and(|bytes| bytes.len() >= min)
}
fn valid_record(record: &EncryptedRecord) -> bool {
    matches!(
        record.collection.as_str(),
        "projects" | "chats" | "chat_chunks" | "config"
    ) && id(&record.id).is_ok()
        && record.hlc.parse::<crate::clock::Hlc>().is_ok()
        && (1..=1_000_000).contains(&record.key_version)
        && binary(&record.nonce, 24, 24)
        && binary(&record.ciphertext, 16, crypto::MAX_RECORD_PLAINTEXT + 16)
}
fn valid_change(change: &Change) -> bool {
    (1..=MAX_CURSOR).contains(&change.server_seq)
        && valid_record(&change.record)
        && change
            .record
            .hlc
            .rsplit_once(':')
            .is_some_and(|(_, device)| device == change.device_id)
}
fn network(error: reqwest::Error) -> ApiError {
    if error.is_timeout() {
        ApiError::TimedOut
    } else {
        ApiError::Offline
    }
}
fn failure(status: u16, code: Option<&str>, retry: u32) -> ApiError {
    match status {
        401 => ApiError::Unauthorized,
        403 => ApiError::Forbidden,
        404 => ApiError::NotFound,
        409 => ApiError::Conflict,
        410 if code == Some("account_deleted") => ApiError::Deleted,
        413 => ApiError::Quota,
        429 => ApiError::RateLimited {
            retry_after_seconds: retry,
        },
        400 if code == Some("invalid_code") => ApiError::InvalidCode,
        400 => ApiError::InvalidInput,
        503 if code == Some("delivery_failed") => ApiError::DeliveryFailed {
            retry_after_seconds: retry,
        },
        500..=599 => ApiError::Unavailable,
        _ => ApiError::Protocol,
    }
}

#[cfg(test)]
mod tests;
