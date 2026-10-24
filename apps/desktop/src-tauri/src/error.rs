//! The error every fallible command returns to the UI.
//!
//! A stable `code` is what the UI's logic switches on; `message` is a full sentence it can show as
//! is, matching the style of aura-core's errors.

use serde::{Deserialize, Serialize};

/// What went wrong, as a stable code the UI can switch on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCode {
    /// An argument was outside what the command accepts.
    InvalidArgument,
    /// Too many demo streams are already running.
    TooManyStreams,
    /// The main window does not exist (it was closed, or creating it failed).
    WindowUnavailable,
    /// A command that only works in smoke mode (`AURACODE_SMOKE=1`) was called outside it.
    NotInSmokeMode,
    /// Startup could not determine a data folder at all, so there is nothing to show.
    DataDirUnknown,
    /// The system file manager could not show the data folder.
    RevealFailed,
}

/// A command failure, serialized as `{ code, message }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> AppError {
        AppError {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_argument(message: impl Into<String>) -> AppError {
        AppError::new(AppErrorCode::InvalidArgument, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_message() {
        let error = AppError::new(AppErrorCode::TooManyStreams, "Too many.");
        assert_eq!(
            serde_json::to_value(&error).expect("serialize"),
            serde_json::json!({ "code": "too_many_streams", "message": "Too many." })
        );
        assert_eq!(error.to_string(), "Too many.");
    }
}
