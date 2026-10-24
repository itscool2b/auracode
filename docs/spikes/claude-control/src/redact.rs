//! Redaction for fixtures and summaries that get committed.
//!
//! Raw CLI output carries the user's identity in a few places: the account email and
//! organization in the initialize response, the home directory inside every path, and the same
//! paths again in Claude Code's project-directory encoding. Replacements are literal and longest
//! first, so a path that contains the home directory is replaced as a whole; any email-shaped
//! token left after that is masked as a backstop.

use serde_json::Value;

/// Shorter needles would shred unrelated text (a two-letter display name, a small pid).
const MIN_NEEDLE: usize = 4;

#[derive(Debug, Default)]
pub struct Redactor {
    rules: Vec<(String, String)>,
}

impl Redactor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, needle: &str, placeholder: &str) {
        self.add_min(needle, placeholder, MIN_NEEDLE);
    }

    /// Like [`Redactor::add`] with a caller-chosen floor, for sources (environment values) where
    /// short values are common words or numbers rather than identities.
    pub fn add_min(&mut self, needle: &str, placeholder: &str, min_len: usize) {
        if needle.len() < min_len.max(MIN_NEEDLE) || self.rules.iter().any(|(existing, _)| existing == needle) {
            return;
        }
        self.rules.push((needle.to_owned(), placeholder.to_owned()));
        self.rules.sort_by_key(|(existing, _)| std::cmp::Reverse(existing.len()));
    }

    /// A directory and its Claude Code project-directory spelling.
    pub fn add_path(&mut self, path: &str, placeholder: &str, encoded_placeholder: &str) {
        self.add(path, placeholder);
        self.add(&encode_project_dir(path), encoded_placeholder);
    }

    pub fn apply(&self, text: &str) -> String {
        let mut out = text.to_owned();
        for (needle, placeholder) in &self.rules {
            if out.contains(needle.as_str()) {
                out = out.replace(needle.as_str(), placeholder);
            }
        }
        mask_emails(&out)
    }
}

/// Claude Code's name for a working directory under `~/.claude/projects/`: every character that
/// is not ASCII alphanumeric becomes `-` (paths over 200 characters are also truncated and
/// hashed by the CLI, which no spike path reaches).
pub fn encode_project_dir(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// Identity values from Claude Code's own account cache (`~/.claude.json`), so they are
/// redacted even where they show up without a telltale key. Only these string fields are read.
pub fn account_needles(claude_json: &Value) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    let account = &claude_json["oauthAccount"];
    for (key, placeholder) in [
        ("emailAddress", "<EMAIL>"),
        ("accountUuid", "<ACCOUNT_UUID>"),
        ("organizationUuid", "<ORG_UUID>"),
        ("organizationName", "<ORG_NAME>"),
        ("displayName", "<USER_NAME>"),
        ("fullName", "<USER_NAME>"),
    ] {
        if let Some(value) = account[key].as_str() {
            out.push((value.to_owned(), placeholder));
        }
    }
    if let Some(value) = claude_json["userID"].as_str() {
        out.push((value.to_owned(), "<USER_ID>"));
    }
    out
}

fn is_local_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"._%+-".contains(&b)
}

fn is_domain_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'.' || b == b'-'
}

/// A dotted domain whose last label is at least two letters (so `react@18.3.1` and
/// `user@localhost` are not emails).
fn is_domain(domain: &[u8]) -> bool {
    let Some(dot) = domain.iter().rposition(|&b| b == b'.') else { return false };
    let tld = &domain[dot + 1..];
    dot > 0 && tld.len() >= 2 && tld.iter().all(u8::is_ascii_alphabetic)
}

/// Replaces every `local@domain.tld` with `<EMAIL>`. Only ASCII bytes are ever consumed, so
/// every cut lands on a character boundary.
pub fn mask_emails(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            let mut start = i;
            while start > copied && is_local_char(bytes[start - 1]) {
                start -= 1;
            }
            let mut end = i + 1;
            while end < bytes.len() && is_domain_char(bytes[end]) {
                end += 1;
            }
            // A sentence can end right after an address.
            while end > i + 1 && matches!(bytes[end - 1], b'.' | b'-') {
                end -= 1;
            }
            if start < i && is_domain(&bytes[i + 1..end]) {
                out.push_str(&text[copied..start]);
                out.push_str("<EMAIL>");
                copied = end;
                i = end;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&text[copied..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emails_are_masked_and_lookalikes_are_not() {
        assert_eq!(mask_emails("a.b+c@example.com"), "<EMAIL>");
        assert_eq!(mask_emails(r#"{"email":"x_y@mail.co.uk","n":1}"#), r#"{"email":"<EMAIL>","n":1}"#);
        assert_eq!(mask_emails("write to me@x.io."), "write to <EMAIL>.");
        assert_eq!(mask_emails("two a@b.cd and c@d.ef"), "two <EMAIL> and <EMAIL>");
        for untouched in ["@anthropic-ai/claude-code", "react@18.3.1", "user@localhost", "a@b.c", "é@ü", "@"] {
            assert_eq!(mask_emails(untouched), untouched);
        }
    }

    #[test]
    fn longer_needles_win_over_contained_ones() {
        let mut r = Redactor::new();
        r.add_path("/Users/someone", "<HOME>", "<HOME_ENC>");
        r.add_path("/tmp/-Users-someone-x/spike", "<SPIKE>", "<SPIKE_ENC>");
        assert_eq!(r.apply("cwd /tmp/-Users-someone-x/spike/dir-a"), "cwd <SPIKE>/dir-a");
        assert_eq!(r.apply("projects/-tmp--Users-someone-x-spike-dir-a/"), "projects/<SPIKE_ENC>-dir-a/");
        assert_eq!(
            r.apply("/Users/someone/.claude and -Users-someone-Desktop"),
            "<HOME>/.claude and <HOME_ENC>-Desktop"
        );
    }

    #[test]
    fn short_needles_are_ignored() {
        let mut r = Redactor::new();
        r.add("ab", "<X>");
        r.add_min("xhigh", "<ENV>", 16);
        r.add_min("0123456789abcdef", "<TOKEN>", 16);
        assert_eq!(r.apply("ab xhigh 0123456789abcdef"), "ab xhigh <TOKEN>");
    }

    #[test]
    fn account_identity_is_collected_from_claude_json() {
        let doc = json!({
            "oauthAccount": {"emailAddress": "me@example.com", "accountUuid": "acc-1", "organizationUuid": "org-1",
                             "organizationName": "Mine", "billingType": "x"},
            "userID": "hash",
        });
        let needles = account_needles(&doc);
        assert!(needles.contains(&("me@example.com".to_owned(), "<EMAIL>")));
        assert!(needles.contains(&("org-1".to_owned(), "<ORG_UUID>")));
        assert!(needles.contains(&("hash".to_owned(), "<USER_ID>")));
        assert!(!needles.iter().any(|(v, _)| v == "x"));
    }

    #[test]
    fn project_dir_encoding_matches_claude_code() {
        assert_eq!(
            encode_project_dir("/Users/me/Desktop/coding-folder/auracode"),
            "-Users-me-Desktop-coding-folder-auracode"
        );
        assert_eq!(encode_project_dir("/tmp/a_b.c"), "-tmp-a-b-c");
    }
}
