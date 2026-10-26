use aura_protocol::account::{AccountFailure, AccountFailureCode as Code};
use aura_sync::{account::AccountError, api::ApiError, crypto::CryptoError, vault::VaultError};

pub(super) fn failure(code: Code, message: &str) -> AccountFailure {
    AccountFailure {
        code,
        message: message.into(),
        retry_after_seconds: None,
    }
}
pub(super) fn state() -> AccountFailure {
    failure(
        Code::InvalidState,
        "This account action is unavailable in the current state.",
    )
}
pub(super) fn storage() -> AccountFailure {
    failure(
        Code::LocalStorage,
        "The account profile could not be opened or saved. Existing data was preserved.",
    )
}
pub(super) fn account(error: AccountError) -> AccountFailure {
    match error {
        AccountError::Api(error) => api(error),
        AccountError::Vault(error) => vault(error),
        AccountError::Crypto(error) => crypto(error),
        AccountError::State => state(),
        AccountError::StoredData => failure(
            Code::SecureStorage,
            "The saved account has an invalid or unsupported format. It was preserved.",
        ),
    }
}
pub(super) fn vault(error: VaultError) -> AccountFailure {
    failure(Code::SecureStorage, &error.to_string())
}
pub(super) fn crypto(error: CryptoError) -> AccountFailure {
    failure(
        if error == CryptoError::Authentication {
            Code::KeyMismatch
        } else {
            Code::Protocol
        },
        &error.to_string(),
    )
}
pub(super) fn api(error: ApiError) -> AccountFailure {
    let code = match error {
        ApiError::Origin | ApiError::InvalidInput => Code::InvalidInput,
        ApiError::Offline => Code::Offline,
        ApiError::TimedOut => Code::TimedOut,
        ApiError::Unauthorized => Code::Unauthorized,
        ApiError::Deleted => Code::Deleted,
        ApiError::Forbidden => Code::Forbidden,
        ApiError::InvalidCode => Code::InvalidCode,
        ApiError::Conflict => Code::Conflict,
        ApiError::Quota => Code::Quota,
        ApiError::RateLimited { .. } => Code::RateLimited,
        ApiError::DeliveryFailed { .. } => Code::DeliveryFailed,
        ApiError::Unavailable => Code::Unavailable,
        ApiError::NotFound => Code::NotFound,
        ApiError::Protocol => Code::Protocol,
    };
    let retry_after_seconds = match error {
        ApiError::RateLimited {
            retry_after_seconds,
        }
        | ApiError::DeliveryFailed {
            retry_after_seconds,
        } => Some(retry_after_seconds),
        _ => None,
    };
    AccountFailure {
        code,
        message: error.to_string(),
        retry_after_seconds,
    }
}
