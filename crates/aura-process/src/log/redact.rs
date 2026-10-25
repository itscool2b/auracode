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
//! [`Redactor::redact_text`] too, in the session actor: drivers hand it over raw.

use std::borrow::Cow;
use std::fmt;
use std::sync::RwLock;

/// What a secret literal becomes.
const SECRET: &str = "<SECRET>";

/// Secret literals shorter than this are ignored: they would redact ordinary words.
const MIN_SECRET_CHARS: usize = 12;

/// Compiled patterns and the secret literals of every env resolved so far. Shared as
/// `Arc<Redactor>`: the env resolver adds the literals, protocol logs and the session actor redact
/// with them.
pub struct Redactor {
    /// Longest first, so a literal that contains another is replaced whole.
    secrets: RwLock<Vec<String>>,
}

impl Redactor {
    /// The standard rules. This build replaces only the secret literals: the key rules and the
    /// patterns are package A's.
    pub fn standard() -> Redactor {
        Redactor {
            secrets: RwLock::new(Vec::new()),
        }
    }

    /// Adds secret literals: the values of an env's secret-looking variables
    /// ([`secret_values`](crate::env::secret_values)). Values shorter than 12 characters are
    /// ignored, and the literals added earlier stay, because running sessions keep the env they
    /// started with.
    pub fn set_secrets(&self, values: Vec<String>) {
        let mut secrets = match self.secrets.write() {
            Ok(secrets) => secrets,
            Err(poisoned) => poisoned.into_inner(),
        };
        for value in values {
            if value.chars().count() >= MIN_SECRET_CHARS && !secrets.contains(&value) {
                secrets.push(value);
            }
        }
        secrets.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    }

    /// Redacts a JSON value in place (rules 1 to 3).
    pub fn redact_value(&self, value: &mut serde_json::Value) {
        match value {
            serde_json::Value::String(text) => {
                if let Cow::Owned(redacted) = self.redact_text(text) {
                    *text = redacted;
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    self.redact_value(item);
                }
            }
            serde_json::Value::Object(fields) => {
                for field in fields.values_mut() {
                    self.redact_value(field);
                }
            }
            serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            }
        }
    }

    /// Redacts free text (rule 3).
    pub fn redact_text<'a>(&self, text: &'a str) -> Cow<'a, str> {
        let secrets = match self.secrets.read() {
            Ok(secrets) => secrets,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut text = Cow::Borrowed(text);
        for secret in secrets.iter() {
            if text.contains(secret.as_str()) {
                text = Cow::Owned(text.replace(secret.as_str(), SECRET));
            }
        }
        text
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const KEY: &str = "sk-proj-0123456789abcdef";

    #[test]
    fn secret_literals_become_a_placeholder_in_text() {
        let redactor = Redactor::standard();
        assert!(matches!(
            redactor.redact_text("nothing to hide"),
            Cow::Borrowed(_)
        ));
        redactor.set_secrets(vec![KEY.into()]);
        assert_eq!(
            redactor.redact_text(&format!("Invalid API key {KEY}; check {KEY}.")),
            "Invalid API key <SECRET>; check <SECRET>."
        );
        assert!(matches!(
            redactor.redact_text("nothing to hide"),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn short_literals_are_ignored_and_earlier_ones_stay() {
        let redactor = Redactor::standard();
        redactor.set_secrets(vec!["true".into(), "abcdefghijk".into(), KEY.into()]);
        redactor.set_secrets(vec!["ghp_a_newer_resolution_value".into(), KEY.into()]);
        assert_eq!(format!("{redactor:?}"), "Redactor { secrets: 2, .. }");
        assert_eq!(
            redactor.redact_text(&format!(
                "true abcdefghijk {KEY} ghp_a_newer_resolution_value"
            )),
            "true abcdefghijk <SECRET> <SECRET>"
        );
    }

    #[test]
    fn a_literal_inside_a_longer_one_never_splits_it() {
        let redactor = Redactor::standard();
        let long = format!("{KEY}-and-more");
        redactor.set_secrets(vec![KEY.into(), long.clone()]);
        assert_eq!(
            redactor.redact_text(&format!("{long} {KEY}")),
            "<SECRET> <SECRET>"
        );
    }

    #[test]
    fn every_string_of_a_json_value_is_redacted() {
        let redactor = Redactor::standard();
        redactor.set_secrets(vec![KEY.into()]);
        let mut value = json!({
            "error": {"message": format!("bad key {KEY}"), "code": -32000},
            "list": [KEY, 12, true, null],
            "untouched": "fine",
        });
        redactor.redact_value(&mut value);
        assert_eq!(
            value,
            json!({
                "error": {"message": "bad key <SECRET>", "code": -32000},
                "list": ["<SECRET>", 12, true, null],
                "untouched": "fine",
            })
        );
    }
}
