use super::{CloneError, Result};

pub(super) fn remote(input: &str) -> Result<String> {
    let (prefix, path) = if let Some(path) = input.strip_prefix("https://github.com/") {
        ("https://github.com/", path)
    } else if let Some(path) = input.strip_prefix("git@github.com:") {
        ("git@github.com:", path)
    } else if let Some(path) = input.strip_prefix("ssh://git@github.com/") {
        ("git@github.com:", path)
    } else {
        return Err(CloneError::message(
            "Use a GitHub HTTPS URL or git@github.com:owner/repository.git. Credentials, custom ports and other hosts are not accepted.",
        ));
    };
    let path = path.strip_suffix(".git").unwrap_or(path);
    let Some((owner, repo)) = path.split_once('/') else {
        return Err(CloneError::message(
            "The GitHub URL needs an owner and repository.",
        ));
    };
    if owner.is_empty()
        || owner.len() > 39
        || owner.starts_with('-')
        || owner.ends_with('-')
        || !owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || repo.is_empty()
        || repo.len() > 100
        || matches!(repo, "." | "..")
        || !repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(CloneError::message(
            "The GitHub owner or repository name is invalid. Paste a repository URL without credentials, query text or a branch path.",
        ));
    }
    Ok(format!("{prefix}{owner}/{repo}.git"))
}

pub(super) fn name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.as_bytes()[3].is_ascii_digit());
    if name.is_empty()
        || name.len() > 100
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || reserved
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_. ".contains(&byte))
    {
        return Err(CloneError::message(
            "Choose a new folder name using letters, numbers, spaces, dots, hyphens or underscores. Device names and hidden folders are not accepted.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn github_urls_never_accept_credentials_options_or_another_transport() {
        for input in [
            "https://github.com/owner/repo",
            "https://github.com/owner/repo.git",
        ] {
            assert_eq!(remote(input).unwrap(), "https://github.com/owner/repo.git");
        }
        assert_eq!(
            remote("ssh://git@github.com/owner/repo.git").unwrap(),
            "git@github.com:owner/repo.git"
        );
        for input in [
            "https://token@github.com/o/r",
            "https://github.com.evil/o/r",
            "https://github.com:443/o/r",
            "https://github.com/o/r?token=private",
            "https://github.com/o/r#main",
            "https://github.com/o/r/tree/main",
            "https://github.com/o/%2e%2e",
            "git@github.com:-o/r",
            "git@github.com:o/r\narg",
            "ext::command",
            "file:///repo",
            "--upload-pack=command",
        ] {
            assert!(remote(input).is_err(), "{input}");
        }
    }
    #[test]
    fn names_are_single_portable_nondevice_components() {
        for input in ["Orbit", "my-project", "repo.1", "My project"] {
            name(input).unwrap();
        }
        for input in [
            "", ".", "..", ".git", "a/b", "a\\b", "C:repo", "nul.txt", "COM1", "repo.", "repo ",
            "repo\n", "../repo",
        ] {
            assert!(name(input).is_err(), "{input}");
        }
    }
}
