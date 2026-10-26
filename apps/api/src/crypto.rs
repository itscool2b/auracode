//! Reviewed primitives with domain separation. None of these values are safe to log.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::policy::{ApiError, Result};

pub fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode(text: &str, min: usize, max: usize) -> Result<Vec<u8>> {
    if text.len() > max.saturating_mul(4).div_ceil(3) + 4 {
        return Err(ApiError::InvalidRequest);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| ApiError::InvalidRequest)?;
    if !(min..=max).contains(&bytes.len()) || encode(&bytes) != text {
        return Err(ApiError::InvalidRequest);
    }
    Ok(bytes)
}

pub fn random_token() -> Result<String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| ApiError::Unavailable)?;
    Ok(encode(&bytes))
}

pub fn random_code() -> Result<String> {
    // Rejection sampling avoids a biased six-digit code space.
    loop {
        let mut bytes = [0; 4];
        getrandom::fill(&mut bytes).map_err(|_| ApiError::Unavailable)?;
        let value = u32::from_le_bytes(bytes);
        if value < u32::MAX - u32::MAX % 1_000_000 {
            return Ok(format!("{:06}", value % 1_000_000));
        }
    }
}

pub fn hash(value: &str) -> String {
    encode(&Sha256::digest(value.as_bytes()))
}

pub fn device_code(account: &str, device: &str, public_key: &str) -> Result<String> {
    let context = serde_json::to_vec(&["auracode-device-approval-v1", account, device, public_key])
        .map_err(|_| ApiError::Unavailable)?;
    let digest = Sha256::digest(context);
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
    Ok(format!("{:06}", value % 1_000_000))
}

pub fn verifier(key: &[u8], domain: &str, fields: &[&str]) -> Result<String> {
    if key.len() < 32 {
        return Err(ApiError::Unavailable);
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| ApiError::Unavailable)?;
    mac.update(domain.as_bytes());
    for field in fields {
        mac.update(&(field.len() as u64).to_be_bytes());
        mac.update(field.as_bytes());
    }
    Ok(encode(&mac.finalize().into_bytes()))
}

pub fn equal(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_code_matches_the_independent_client_vector_and_binds_the_public_key() {
        let key = "zo060cy2M-x7cMF4FKXHbs0CloUFDTRHRboFhw5YfVk";
        assert_eq!(
            device_code("account", "device", key).expect("code"),
            "484647"
        );
        assert_ne!(device_code("other", "device", key).expect("code"), "484647");
        assert_ne!(
            device_code("account", "other", key).expect("code"),
            "484647"
        );
    }

    #[test]
    fn code_and_session_secrets_have_the_required_shape() {
        for _ in 0..20 {
            let code = random_code().expect("code");
            assert_eq!(code.len(), 6);
            assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        }
        let token = random_token().expect("token");
        assert_eq!(decode(&token, 32, 32).expect("bytes").len(), 32);
        assert_ne!(token, random_token().expect("next"));
    }

    #[test]
    fn verifiers_bind_the_challenge_and_domain_without_ambiguous_concatenation() {
        let key = [42; 32];
        let first = verifier(&key, "code", &["challenge", "123456"]).expect("mac");
        assert_ne!(
            first,
            verifier(&key, "code", &["other", "123456"]).expect("mac")
        );
        assert_ne!(
            first,
            verifier(&key, "rate", &["challenge", "123456"]).expect("mac")
        );
        assert_ne!(
            verifier(&key, "x", &["ab", "c"]).expect("mac"),
            verifier(&key, "x", &["a", "bc"]).expect("mac")
        );
        assert!(!equal(&first, "123456"));
        assert!(verifier(&[], "code", &[]).is_err());
    }

    #[test]
    fn noncanonical_or_oversized_encodings_are_rejected_before_use() {
        assert!(decode("AA==", 1, 1).is_err());
        assert!(decode(&encode(&[0; 25]), 24, 24).is_err());
        assert!(decode("/", 1, 32).is_err());
    }
}
