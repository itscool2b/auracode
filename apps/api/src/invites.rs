//! Private-preview membership is deployment configuration, never account or billing state.
use crate::policy::{self, ApiError, Result};
use std::collections::BTreeSet;

pub const SECRET: &str = "CLOUD_ACCOUNT_ALLOWLIST";
const MAX_BYTES: usize = 16 * 1024;
const MAX_ADDRESSES: usize = 256;

pub struct Allowlist(BTreeSet<String>);

impl Allowlist {
    pub fn parse(value: &str) -> Result<Self> {
        if value.len() > MAX_BYTES {
            return Err(ApiError::Unavailable);
        }
        let values: Vec<String> = serde_json::from_str(value).map_err(|_| ApiError::Unavailable)?;
        if values.is_empty() || values.len() > MAX_ADDRESSES {
            return Err(ApiError::Unavailable);
        }
        let entries = values
            .iter()
            .map(|value| policy::email(value).map_err(|_| ApiError::Unavailable))
            .collect::<Result<BTreeSet<_>>>()?;
        Ok(Self(entries))
    }

    pub fn contains(&self, email: &str) -> bool {
        self.0.contains(email)
    }

    pub fn require(&self, email: &str) -> Result<()> {
        if self.contains(email) {
            Ok(())
        } else {
            Err(ApiError::InviteRequired)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_is_bounded_and_fails_closed_as_a_whole() {
        for value in [
            "",
            " ",
            "null",
            "[]",
            "{}",
            "[1]",
            "[\"\"]",
            "[\"ok@example.invalid\",\"invalid\"]",
        ] {
            assert!(matches!(
                Allowlist::parse(value),
                Err(ApiError::Unavailable)
            ));
        }
        assert!(Allowlist::parse(&" ".repeat(MAX_BYTES + 1)).is_err());
        assert!(
            Allowlist::parse(
                &serde_json::to_string(&vec!["a@example.invalid"; MAX_ADDRESSES + 1])
                    .expect("fixture")
            )
            .is_err()
        );
    }

    #[test]
    fn membership_uses_the_email_contract_without_domain_or_alias_expansion() {
        let list = Allowlist::parse(r#"[" Invited@Example.Invalid ", "invited@example.invalid"]"#)
            .expect("list");
        assert!(list.require("invited@example.invalid").is_ok());
        for value in [
            "other@example.invalid",
            "invited+alias@example.invalid",
            "invited@example.invalid.evil",
        ] {
            assert_eq!(list.require(value), Err(ApiError::InviteRequired));
        }
    }
}
