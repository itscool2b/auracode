//! Redaction, applied in the writer task before any byte reaches disk.
//!
//! 1. JSON keys, compared ASCII-lowercase with `_` and `-` removed: every string at or under a
//!    credential key (equal to or ending with `token`, `secret`, `password`, `passwd`, `apikey`,
//!    `authorization`, `cookie`, `credential`, `credentials`, `privatekey`, `sessionkey`) or an
//!    identity key (containing `email`, or one of `account`, `oauthaccount`, `organization`, ...)
//!    becomes `"<REDACTED>"`; numbers and booleans are kept.
//! 2. Every value of an `env` object, and the `value` of `{ "name", "value" }` entries under `env`
//!    or `headers` arrays.
//! 3. Every remaining string, every raw line and stderr line: email addresses to `<EMAIL>`, token
//!    shapes (`sk-ant-...`, `ghp_...`, JWTs, `Bearer ...`, ...) to `<TOKEN>`, and the secret
//!    literals from [`Redactor::set_secrets`] to `<SECRET>`.
//!
//! The stderr tail shown in an error card, or stored in an error's detail, passes
//! [`Redactor::redact_text`] too.

use std::borrow::Cow;
use std::fmt;
use std::sync::RwLock;

/// Compiled patterns and the secret literals of the current env. Shared as `Arc<Redactor>`.
pub struct Redactor {
    secrets: RwLock<Vec<String>>,
}

impl Redactor {
    /// The standard rules. This build redacts nothing yet: the rules are package A's.
    pub fn standard() -> Redactor {
        Redactor {
            secrets: RwLock::new(Vec::new()),
        }
    }

    /// Replaces the secret literals: env values of secret-looking names (`KEY`, `TOKEN`, `SECRET`,
    /// `PASSWORD`, `CREDENTIAL`), at least 12 characters long.
    pub fn set_secrets(&self, values: Vec<String>) {
        match self.secrets.write() {
            Ok(mut secrets) => *secrets = values,
            Err(poisoned) => *poisoned.into_inner() = values,
        }
    }

    /// Redacts a JSON value in place (rules 1 to 3).
    pub fn redact_value(&self, _value: &mut serde_json::Value) {}

    /// Redacts free text (rule 3).
    pub fn redact_text<'a>(&self, text: &'a str) -> Cow<'a, str> {
        Cow::Borrowed(text)
    }
}

impl fmt::Debug for Redactor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let secrets = match self.secrets.read() {
            Ok(secrets) => secrets.len(),
            Err(poisoned) => poisoned.into_inner().len(),
        };
        f.debug_struct("Redactor")
            .field("secrets", &secrets)
            .finish_non_exhaustive()
    }
}
