use serde::Serialize;

pub type Result<T> = std::result::Result<T, ApiError>;
pub const CODE_TTL: i64 = 600;
pub const RESEND_SECONDS: i64 = 60;
pub const SESSION_TTL: i64 = 30 * 24 * 60 * 60;
pub const MAX_RECORD: usize = 64 * 1024;
pub const MAX_BLOB: usize = 4 * 1024 * 1024;
pub const MAX_BATCH: usize = 32;
pub const MAX_BODY: usize = 6 * 1024 * 1024;
pub const COOKIE: &str = "__Host-auracode";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum ApiError {
    #[error("Invalid request")]
    InvalidRequest,
    #[error("Sign in again")]
    Unauthorized,
    #[error("This account was deleted; retained local data is still available")]
    AccountDeleted,
    #[error("This operation is not allowed")]
    Forbidden,
    #[error("The code is invalid or expired")]
    InvalidCode,
    #[error("Too many requests; try again later")]
    RateLimited,
    #[error("Email could not be delivered; request a new code after the cooldown")]
    DeliveryFailed,
    #[error("The item changed; fetch it before retrying")]
    Conflict,
    #[error("Storage quota exceeded")]
    Quota,
    #[error("Service temporarily unavailable")]
    Unavailable,
    #[error("Not found")]
    NotFound,
}

impl ApiError {
    pub fn status(self) -> u16 {
        match self {
            Self::InvalidRequest | Self::InvalidCode => 400,
            Self::Unauthorized => 401,
            Self::Forbidden => 403,
            Self::NotFound => 404,
            Self::Conflict => 409,
            Self::AccountDeleted => 410,
            Self::Quota => 413,
            Self::RateLimited => 429,
            Self::DeliveryFailed | Self::Unavailable => 503,
        }
    }
}

pub fn email(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    let Some((local, domain)) = value.split_once('@') else {
        return Err(ApiError::InvalidRequest);
    };
    if value.len() > 254
        || local.is_empty()
        || local.len() > 64
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
        || !local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&b))
        || !domain
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return Err(ApiError::InvalidRequest);
    }
    Ok(value)
}

pub fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(ApiError::InvalidRequest);
    }
    Ok(())
}

pub fn browser_origin(origin: Option<&str>, expected: &str) -> Result<()> {
    if origin != Some(expected) {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

pub fn cookie_token(header: &str) -> Result<Option<&str>> {
    let mut found = None;
    for part in header.split(';') {
        if let Some((name, value)) = part.trim().split_once('=')
            && name == COOKIE
        {
            if found.is_some() {
                return Err(ApiError::Unauthorized);
            }
            found = Some(value);
        }
    }
    Ok(found)
}

pub fn session_cookie(token: &str) -> String {
    format!("{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_and_cookie_ambiguity_fail_closed() {
        for origin in [
            None,
            Some("null"),
            Some("https://auracode.si.evil.invalid"),
            Some("http://auracode.si"),
        ] {
            assert_eq!(
                browser_origin(origin, "https://auracode.si"),
                Err(ApiError::Forbidden)
            );
        }
        assert!(browser_origin(Some("https://auracode.si"), "https://auracode.si").is_ok());
        assert!(cookie_token("__Host-auracode=a; __Host-auracode=b").is_err());
        assert_eq!(
            cookie_token("other=x; __Host-auracode=a").expect("cookie"),
            Some("a")
        );
        assert!(session_cookie("x").contains("Secure; HttpOnly; SameSite=Strict"));
    }
    #[test]
    fn email_cannot_inject_headers_and_ids_cannot_escape_r2_prefixes() {
        assert_eq!(
            email(" Person@Example.COM ").expect("email"),
            "person@example.com"
        );
        for value in ["a@x.com\r\nBcc:evil@x.com", "a@@x.com", "x", "a@.x.com"] {
            assert!(email(value).is_err());
        }
        for value in ["../other", "a/b", "", "a\\b", "a%2fb"] {
            assert!(identifier(value).is_err());
        }
    }
}
