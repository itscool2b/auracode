//! Redaction, applied in the writer task before any byte reaches disk.
//!
//! 1. JSON keys, compared ASCII-lowercase with `_` and `-` removed: every string at or under a
//!    credential key (equal to or ending with `token`, `secret`, `password`, `passwd`, `apikey`,
//!    `authorization`, `cookie`, `credential`, `credentials`, `privatekey`, `sessionkey`) or an
//!    identity key (containing `email`, or one of `account`, `oauthaccount`, `organization`, ...)
//!    becomes `"<REDACTED>"`; numbers and booleans are kept, so `inputTokens` counts stay readable.
//! 2. Every value of an `env` object, and the `value` of `{ "name", "value" }` entries under `env`
//!    or `headers` arrays.
//! 3. Every remaining string (object keys included), every raw line and stderr line: the secret
//!    literals from [`Redactor::set_secrets`] to `<SECRET>`, token shapes (`sk-ant-...`, `ghp_...`,
//!    JWTs, `Bearer ...`, ...) to `<TOKEN>`, and email addresses to `<EMAIL>`.
//!
//! The stderr tail shown in an error card, or stored in an error's detail, passes
//! [`Redactor::redact_text`] too, in the session actor: drivers hand it over raw.

use std::borrow::Cow;
use std::fmt;
use std::sync::{LazyLock, RwLock, RwLockReadGuard};

use regex::{Captures, NoExpand, Regex};
use serde_json::{Map, Value};

/// What a secret literal becomes.
const SECRET: &str = "<SECRET>";

/// What a string under a credential or identity key becomes.
const REDACTED: &str = "<REDACTED>";

/// What a token shape becomes.
const TOKEN: &str = "<TOKEN>";

/// What an email address becomes.
const EMAIL: &str = "<EMAIL>";

/// Secret literals shorter than this are ignored: they would redact ordinary words.
const MIN_SECRET_CHARS: usize = 12;

/// A key is a credential key when, normalized, it equals or ends with one of these.
const CREDENTIAL_SUFFIXES: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "credentials",
    "privatekey",
    "sessionkey",
];

/// A key is an identity key when, normalized, it contains `email` or equals one of these.
const IDENTITY_KEYS: &[&str] = &[
    "account",
    "oauthaccount",
    "organization",
    "organizationname",
    "organizationuuid",
    "orgid",
    "orgname",
    "accountuuid",
    "accountid",
    "userid",
    "username",
    "fullname",
];

/// Token shapes, each starting at a word boundary so `task-...` or `risk-...` never match.
static TOKENS: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\b(?:",
        r"sk-ant-[A-Za-z0-9_-]{10,}",
        r"|sk-[A-Za-z0-9_-]{20,}",
        r"|gh[pousr]_[A-Za-z0-9]{20,}",
        r"|github_pat_[A-Za-z0-9_]{20,}",
        r"|xox[abpr]-[A-Za-z0-9-]{10,}",
        r"|AKIA[0-9A-Z]{16}",
        r"|AIza[0-9A-Za-z_-]{35}",
        r"|glpat-[A-Za-z0-9_-]{20,}",
        r"|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*",
        r")",
    ))
    .ok()
});

/// `Bearer <token>`; the scheme word and its spacing are kept.
static BEARER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"\b((?i:bearer))(\s+)[A-Za-z0-9._~+/=-]{16,}").ok());

/// `"key": "value"` pairs in JSON text that could not be parsed (a record cut at the size cap), so
/// the key rules still reach the string values they can see.
static KEYED_STRING: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#""((?:[^"\\]|\\.){1,128})"(\s*:\s*)"(?:[^"\\]|\\.)*""#).ok());

/// Compiled patterns and the secret literals of every env resolved so far. Shared as
/// `Arc<Redactor>`: the env resolver adds the literals, protocol logs and the session actor redact
/// with them.
pub struct Redactor {
    secrets: RwLock<Secrets>,
}

#[derive(Default)]
struct Secrets {
    /// Longest first, so a literal that contains another is replaced whole.
    literals: Vec<String>,
    /// Every literal as one alternation, longest first; `None` when there are none or the
    /// alternation does not compile (then the literals are replaced one by one).
    pattern: Option<Regex>,
}

impl Redactor {
    /// The standard rules, with no secret literals yet.
    pub fn standard() -> Redactor {
        Redactor {
            secrets: RwLock::new(Secrets::default()),
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
        let before = secrets.literals.len();
        for value in values {
            if value.chars().count() >= MIN_SECRET_CHARS && !secrets.literals.contains(&value) {
                secrets.literals.push(value);
            }
        }
        if secrets.literals.len() == before {
            return;
        }
        secrets
            .literals
            .sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        let alternation = secrets
            .literals
            .iter()
            .map(|literal| regex::escape(literal))
            .collect::<Vec<_>>()
            .join("|");
        secrets.pattern = Regex::new(&alternation).ok();
    }

    /// Redacts a JSON value in place (rules 1 to 3).
    pub fn redact_value(&self, value: &mut Value) {
        let secrets = self.read();
        walk(value, false, &secrets);
    }

    /// Redacts free text (rule 3).
    pub fn redact_text<'a>(&self, text: &'a str) -> Cow<'a, str> {
        let secrets = self.read();
        redact_str(text, &secrets)
    }

    /// Redacts JSON text that could not be parsed, such as the head of a line cut at the record
    /// cap: the string value of every `"key": "value"` pair whose key rule matches becomes
    /// `"<REDACTED>"`, then rule 3 applies to the whole text.
    pub(crate) fn redact_json_text<'a>(&self, text: &'a str) -> Cow<'a, str> {
        let secrets = self.read();
        let keyed = match KEYED_STRING.as_ref() {
            Some(pattern) if text.contains('"') => pattern.replace_all(text, |caps: &Captures| {
                let key = caps.get(1).map_or("", |key| key.as_str());
                if sensitive_key(&normalize_key(key)) {
                    let gap = caps.get(2).map_or(":", |gap| gap.as_str());
                    format!("\"{key}\"{gap}\"{REDACTED}\"")
                } else {
                    caps.get(0)
                        .map_or_else(String::new, |whole| whole.as_str().to_owned())
                }
            }),
            _ => Cow::Borrowed(text),
        };
        match keyed {
            Cow::Borrowed(text) => redact_str(text, &secrets),
            Cow::Owned(text) => Cow::Owned(redact_str(&text, &secrets).into_owned()),
        }
    }

    /// The longest secret literal, in bytes (0 without any).
    pub(crate) fn longest_secret(&self) -> usize {
        self.read().literals.first().map_or(0, String::len)
    }

    fn read(&self) -> RwLockReadGuard<'_, Secrets> {
        match self.secrets.read() {
            Ok(secrets) => secrets,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

impl fmt::Debug for Redactor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Redactor")
            .field("secrets", &self.read().literals.len())
            .finish_non_exhaustive()
    }
}

/// Rules 1 to 3 over one value. `blank` is set under a credential, identity or env key: every
/// string there becomes `<REDACTED>`, numbers and booleans are kept.
fn walk(value: &mut Value, blank: bool, secrets: &Secrets) {
    match value {
        Value::String(text) => {
            if blank {
                REDACTED.clone_into(text);
            } else if let Cow::Owned(redacted) = redact_str(text, secrets) {
                *text = redacted;
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, blank, secrets);
            }
        }
        Value::Object(fields) => {
            for (key, field) in fields.iter_mut() {
                if blank {
                    walk(field, true, secrets);
                    continue;
                }
                let key = normalize_key(key);
                if sensitive_key(&key) || (key == "env" && field.is_object()) {
                    walk(field, true, secrets);
                } else if (key == "env" || key == "headers") && field.is_array() {
                    walk_name_values(field, secrets);
                } else {
                    walk(field, false, secrets);
                }
            }
            redact_keys(fields, secrets);
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

/// An `env` or `headers` array: the `value` of each `{ "name", "value" }` entry is blanked, the rest
/// follows the normal rules.
fn walk_name_values(array: &mut Value, secrets: &Secrets) {
    let Value::Array(items) = array else {
        return;
    };
    for item in items {
        let is_pair = item
            .as_object()
            .is_some_and(|entry| entry.contains_key("name") && entry.contains_key("value"));
        if !is_pair {
            walk(item, false, secrets);
            continue;
        }
        if let Value::Object(entry) = item {
            for (key, field) in entry.iter_mut() {
                walk(field, key == "value", secrets);
            }
            redact_keys(entry, secrets);
        }
    }
}

/// Rule 3 over an object's keys: a key holding an email or a token is replaced, in place.
fn redact_keys(fields: &mut Map<String, Value>, secrets: &Secrets) {
    let changes = fields
        .keys()
        .any(|key| matches!(redact_str(key, secrets), Cow::Owned(_)));
    if !changes {
        return;
    }
    let old = std::mem::take(fields);
    for (key, field) in old {
        let key = redact_str(&key, secrets).into_owned();
        fields.insert(key, field);
    }
}

/// A key as the rules compare it: ASCII-lowercase, without `_` and `-`.
fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '_' && *c != '-')
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whether a normalized key is a credential key or an identity key.
fn sensitive_key(key: &str) -> bool {
    CREDENTIAL_SUFFIXES
        .iter()
        .any(|suffix| key.ends_with(suffix))
        || key.contains("email")
        || IDENTITY_KEYS.contains(&key)
}

/// Rule 3: secret literals, then token shapes, then `Bearer` tokens, then email addresses.
fn redact_str<'a>(text: &'a str, secrets: &Secrets) -> Cow<'a, str> {
    let mut text = Cow::Borrowed(text);
    if let Some(pattern) = &secrets.pattern {
        text = replace(text, pattern, SECRET);
    } else {
        for literal in &secrets.literals {
            if text.contains(literal.as_str()) {
                text = Cow::Owned(text.replace(literal.as_str(), SECRET));
            }
        }
    }
    if let Some(tokens) = TOKENS.as_ref() {
        text = replace(text, tokens, TOKEN);
    }
    if let Some(bearer) = BEARER.as_ref() {
        let replaced = match bearer.replace_all(&text, "${1}${2}<TOKEN>") {
            Cow::Borrowed(_) => None,
            Cow::Owned(changed) => Some(changed),
        };
        if let Some(changed) = replaced {
            text = Cow::Owned(changed);
        }
    }
    let masked = match mask_emails(&text) {
        Cow::Borrowed(_) => None,
        Cow::Owned(changed) => Some(changed),
    };
    if let Some(changed) = masked {
        text = Cow::Owned(changed);
    }
    text
}

/// Replaces every match of `pattern` with `replacement`, keeping the borrow when nothing matched.
fn replace<'a>(text: Cow<'a, str>, pattern: &Regex, replacement: &str) -> Cow<'a, str> {
    let changed = match pattern.replace_all(&text, NoExpand(replacement)) {
        Cow::Borrowed(_) => None,
        Cow::Owned(changed) => Some(changed),
    };
    match changed {
        Some(changed) => Cow::Owned(changed),
        None => text,
    }
}

fn is_local_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"._%+-".contains(&byte)
}

fn is_domain_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'
}

/// A dotted domain whose last label is at least two letters (so `react@18.3.1` and
/// `user@localhost` are not emails).
fn is_domain(domain: &[u8]) -> bool {
    let Some(dot) = domain.iter().rposition(|&byte| byte == b'.') else {
        return false;
    };
    let tld = domain.get(dot + 1..).unwrap_or_default();
    dot > 0 && tld.len() >= 2 && tld.iter().all(u8::is_ascii_alphabetic)
}

/// Replaces every `local@domain.tld` with `<EMAIL>` (the Claude spike's rules). Only ASCII bytes
/// are ever consumed, so every cut lands on a character boundary.
fn mask_emails(text: &str) -> Cow<'_, str> {
    if !text.contains('@') {
        return Cow::Borrowed(text);
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'@' {
            let mut start = at;
            while start > copied && is_local_char(bytes[start - 1]) {
                start -= 1;
            }
            let mut end = at + 1;
            while end < bytes.len() && is_domain_char(bytes[end]) {
                end += 1;
            }
            // A sentence can end right after an address.
            while end > at + 1 && matches!(bytes[end - 1], b'.' | b'-') {
                end -= 1;
            }
            if start < at && is_domain(&bytes[at + 1..end]) {
                out.push_str(text.get(copied..start).unwrap_or_default());
                out.push_str(EMAIL);
                copied = end;
                at = end;
                continue;
            }
        }
        at += 1;
    }
    if copied == 0 {
        return Cow::Borrowed(text);
    }
    out.push_str(text.get(copied..).unwrap_or_default());
    Cow::Owned(out)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const KEY: &str = "sk-proj-0123456789abcdef";

    #[test]
    fn the_patterns_compile() {
        assert!(TOKENS.is_some());
        assert!(BEARER.is_some());
        assert!(KEYED_STRING.is_some());
    }

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
        redactor.set_secrets(vec!["a newer resolution value".into(), KEY.into()]);
        assert_eq!(format!("{redactor:?}"), "Redactor { secrets: 2, .. }");
        assert_eq!(
            redactor.redact_text(&format!("true abcdefghijk {KEY} a newer resolution value")),
            "true abcdefghijk <SECRET> <SECRET>"
        );
        assert_eq!(redactor.longest_secret(), "a newer resolution value".len());
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
    fn literals_with_regex_characters_match_literally() {
        let redactor = Redactor::standard();
        redactor.set_secrets(vec!["p@ss.w*rd(1)+[x]".into()]);
        assert_eq!(
            redactor.redact_text("login p@ss.w*rd(1)+[x] and pass"),
            "login <SECRET> and pass"
        );
    }

    #[test]
    fn token_shapes_become_a_placeholder() {
        let redactor = Redactor::standard();
        for (text, expected) in [
            ("key sk-ant-api03-abcdefghij", "key <TOKEN>"),
            (
                "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
                "OPENAI_API_KEY=<TOKEN>",
            ),
            ("ghp_0123456789abcdefghijABCD in url", "<TOKEN> in url"),
            ("gho_0123456789abcdefghij", "<TOKEN>"),
            ("github_pat_11ABCDEFG0123456789_abcdefghij", "<TOKEN>"),
            ("slack xoxb-1234-5678-abcdefghij", "slack <TOKEN>"),
            ("aws AKIAABCDEFGHIJKLMNOP", "aws <TOKEN>"),
            (
                "google AIzaSyA-0123456789abcdefghijklmnopqrstu",
                "google <TOKEN>",
            ),
            ("gitlab glpat-0123456789abcdefghij", "gitlab <TOKEN>"),
            (
                "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl end",
                "jwt <TOKEN> end",
            ),
            (
                "Authorization: Bearer abcdefghijklmnop.qrstuvwx",
                "Authorization: Bearer <TOKEN>",
            ),
            (
                "authorization: bearer abcdefghijklmnopqrst",
                "authorization: bearer <TOKEN>",
            ),
        ] {
            assert_eq!(redactor.redact_text(text), expected, "{text}");
        }
    }

    #[test]
    fn lookalikes_of_token_shapes_are_kept() {
        let redactor = Redactor::standard();
        for text in [
            "task-abcdefghijklmnopqrstuvwxyz",
            "risk-assessment-report-for-2026-q1",
            "sk-short",
            "ghp_short",
            "AKIA too short",
            "Bearer short",
            "eyJhbGciOiJIUzI1NiJ9 alone",
            "my_sk-abcdefghijklmnopqrstuvwxyz0123",
        ] {
            assert_eq!(redactor.redact_text(text), text, "{text}");
        }
    }

    #[test]
    fn emails_are_masked_and_lookalikes_are_not() {
        let redactor = Redactor::standard();
        assert_eq!(redactor.redact_text("a.b+c@example.com"), "<EMAIL>");
        assert_eq!(
            redactor.redact_text(r#"{"email":"x_y@mail.co.uk","n":1}"#),
            r#"{"email":"<EMAIL>","n":1}"#
        );
        assert_eq!(
            redactor.redact_text("write to me@x.io."),
            "write to <EMAIL>."
        );
        assert_eq!(
            redactor.redact_text("two a@b.cd and c@d.ef"),
            "two <EMAIL> and <EMAIL>"
        );
        for untouched in [
            "@anthropic-ai/claude-code",
            "react@18.3.1",
            "user@localhost",
            "a@b.c",
            "é@ü",
            "@",
            "@scope/pkg@1.2.3",
        ] {
            assert_eq!(redactor.redact_text(untouched), untouched);
        }
    }

    #[test]
    fn credential_keys_blank_their_strings_and_keep_numbers() {
        let redactor = Redactor::standard();
        let mut value = json!({
            "accessToken": "opaque-value",
            "client_secret": "opaque",
            "refresh-token": {"value": "x", "expires": 3600, "valid": true, "nested": ["a", 1]},
            "password": "hunter2",
            "Authorization": "Basic Zm9vOmJhcg==",
            "cookie": "session=abc",
            "privateKey": "-----BEGIN",
            "session_key": "k",
            "apiKey": "short",
            "credentials": {"user": "me"},
            "usage": {"inputTokens": 120, "outputTokens": 30, "cachedReadTokens": 5, "totalTokens": 155},
            "token_count": 9,
            "apiKeySource": "user",
            "token": 42,
            "maxTokens": 4096,
        });
        redactor.redact_value(&mut value);
        assert_eq!(
            value,
            json!({
                "accessToken": "<REDACTED>",
                "client_secret": "<REDACTED>",
                "refresh-token": {"value": "<REDACTED>", "expires": 3600, "valid": true, "nested": ["<REDACTED>", 1]},
                "password": "<REDACTED>",
                "Authorization": "<REDACTED>",
                "cookie": "<REDACTED>",
                "privateKey": "<REDACTED>",
                "session_key": "<REDACTED>",
                "apiKey": "<REDACTED>",
                "credentials": {"user": "<REDACTED>"},
                "usage": {"inputTokens": 120, "outputTokens": 30, "cachedReadTokens": 5, "totalTokens": 155},
                "token_count": 9,
                "apiKeySource": "user",
                "token": 42,
                "maxTokens": 4096,
            })
        );
    }

    #[test]
    fn identity_keys_blank_their_strings_and_model_names_stay() {
        let redactor = Redactor::standard();
        // Claude's initialize account object and claude-acp's auth status update.
        let mut value = json!({
            "result": {
                "account": {"email": "me@example.com", "organization": "Acme", "subscriptionType": "max", "uuid": "1-2"},
                "models": [{"value": "opus", "displayName": "Opus 5", "name": "claude-opus"}],
            },
            "params": {"authStatus": {"account": {"email": "me@example.com", "organization": "Acme"}}},
            "emailAddress": "x@y.zz",
            "user_email": "u@v.ww",
            "oauthAccount": {"accountUuid": "acc"},
            "organizationName": "Acme",
            "organization_uuid": "org-1",
            "orgId": "o",
            "orgName": "n",
            "accountId": "a",
            "userId": "u",
            "user-name": "me",
            "fullName": "Me Myself",
            "accounting": "kept",
        });
        redactor.redact_value(&mut value);
        assert_eq!(
            value,
            json!({
                "result": {
                    "account": {"email": "<REDACTED>", "organization": "<REDACTED>", "subscriptionType": "<REDACTED>", "uuid": "<REDACTED>"},
                    "models": [{"value": "opus", "displayName": "Opus 5", "name": "claude-opus"}],
                },
                "params": {"authStatus": {"account": {"email": "<REDACTED>", "organization": "<REDACTED>"}}},
                "emailAddress": "<REDACTED>",
                "user_email": "<REDACTED>",
                "oauthAccount": {"accountUuid": "<REDACTED>"},
                "organizationName": "<REDACTED>",
                "organization_uuid": "<REDACTED>",
                "orgId": "<REDACTED>",
                "orgName": "<REDACTED>",
                "accountId": "<REDACTED>",
                "userId": "<REDACTED>",
                "user-name": "<REDACTED>",
                "fullName": "<REDACTED>",
                "accounting": "kept",
            })
        );
    }

    #[test]
    fn env_objects_and_name_value_entries_hide_values() {
        let redactor = Redactor::standard();
        let mut value = json!({
            "mcpServers": [
                {"name": "fs", "command": "/bin/fs", "args": ["--root", "/w"],
                 "env": [{"name": "API_KEY", "value": "v1"}, {"name": "MODE", "value": "fast"}]},
                {"name": "web", "type": "http", "url": "https://example.com/mcp",
                 "headers": [{"name": "X-Api", "value": "h1"}]},
            ],
            "env": {"PATH": "/usr/bin", "PORT": 3000},
            "notEnv": {"name": "n", "value": "kept"},
        });
        redactor.redact_value(&mut value);
        assert_eq!(
            value,
            json!({
                "mcpServers": [
                    {"name": "fs", "command": "/bin/fs", "args": ["--root", "/w"],
                     "env": [{"name": "API_KEY", "value": "<REDACTED>"}, {"name": "MODE", "value": "<REDACTED>"}]},
                    {"name": "web", "type": "http", "url": "https://example.com/mcp",
                     "headers": [{"name": "X-Api", "value": "<REDACTED>"}]},
                ],
                "env": {"PATH": "<REDACTED>", "PORT": 3000},
                "notEnv": {"name": "n", "value": "kept"},
            })
        );
    }

    #[test]
    fn every_remaining_string_and_key_gets_the_text_rules() {
        let redactor = Redactor::standard();
        redactor.set_secrets(vec![KEY.into()]);
        let mut value = json!({
            "error": {"message": format!("bad key {KEY} for me@example.com"), "code": -32000},
            "list": [KEY, 12, true, null, "Bearer abcdefghijklmnopqrstu"],
            "me@example.com": "keyed by email",
            "untouched": "fine",
        });
        redactor.redact_value(&mut value);
        assert_eq!(
            value,
            json!({
                "error": {"message": "bad key <SECRET> for <EMAIL>", "code": -32000},
                "list": ["<SECRET>", 12, true, null, "Bearer <TOKEN>"],
                "<EMAIL>": "keyed by email",
                "untouched": "fine",
            })
        );
        // The key order survives a rewritten key.
        let keys: Vec<&String> = value.as_object().expect("object").keys().collect();
        assert_eq!(keys, ["error", "list", "<EMAIL>", "untouched"]);
    }

    #[test]
    fn unparsable_json_text_still_hides_keyed_strings() {
        let redactor = Redactor::standard();
        let text = r#"{"jsonrpc":"2.0","result":{"account":{"email":"me@example.com"},"accessToken" : "opaque","name":"kept","password":"p\"q","huge":"aaaa"#;
        assert_eq!(
            redactor.redact_json_text(text),
            r#"{"jsonrpc":"2.0","result":{"account":{"email":"<REDACTED>"},"accessToken" : "<REDACTED>","name":"kept","password":"<REDACTED>","huge":"aaaa"#
        );
        assert!(matches!(
            redactor.redact_json_text("no keys here"),
            Cow::Borrowed(_)
        ));
    }
}
