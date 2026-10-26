//! Installation classification uses paths as evidence, never as shell commands.
use aura_protocol::agents::{AgentHost, AgentInstallation, InstallChannel, VersionVerification};

/// Metadata-only resolution follows symlinks without reading agent configuration or credentials.
/// Failure to resolve never changes the working launch path or invents an update channel.
pub(crate) fn native(
    agent_id: &str,
    printed_version: &str,
    launch_path: &str,
) -> Option<AgentInstallation> {
    let version = crate::catalog::parse_version(printed_version)?;
    let resolved_path = std::fs::canonicalize(launch_path)
        .ok()
        .and_then(|path| path.into_os_string().into_string().ok());
    let channel = resolved_path
        .as_deref()
        .map(|path| classify_channel(agent_id, path))
        .unwrap_or_default();
    let verified = match agent_id {
        "claude" => Some(("2.1.310", "Windows native smoke and protocol fixtures")),
        "claude-acp" => Some(("2.1.310", "ACP adapter 0.95.0 compatibility fixtures")),
        "codex" => Some((
            "0.162.1",
            "Windows free controls and protocol fixtures; tool smoke pending",
        )),
        _ => None,
    };
    Some(AgentInstallation {
        agent_id: agent_id.into(),
        provider: provider_namespace(agent_id).into(),
        host: AgentHost::Native,
        launch_path: launch_path.into(),
        resolved_path,
        verification: verification(&version, verified),
        version,
        channel,
    })
}

/// Native and alternate transports of the same vendor share one transcript namespace.
pub fn provider_namespace(agent_id: &str) -> &str {
    match agent_id {
        "claude" | "claude-acp" => "claude",
        "codex" | "codex-acp" => "codex",
        "antigravity" | "agy-stream" => "antigravity",
        "grok" | "grok-stream" => "grok",
        "opencode" | "opencode-v2" => "opencode",
        other => other,
    }
}

/// Canonical path classification is conservative. A copied or unknown binary stays unknown.
/// The caller still launches the original symlink/shim, never this classified target path.
pub fn classify_channel(agent_id: &str, resolved_path: &str) -> InstallChannel {
    let normalized = resolved_path.replace('\\', "/");
    let parts: Vec<_> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let lower: Vec<_> = parts.iter().map(|part| part.to_ascii_lowercase()).collect();
    // Bundled paths take precedence over nested npm/Homebrew-looking subdirectories.
    if let Some(application) = parts.iter().zip(&lower).find_map(|(original, lower)| {
        lower
            .ends_with(".app")
            .then(|| original.trim_end_matches(".app").to_string())
    }) {
        return InstallChannel::Bundled { application };
    }
    if lower
        .windows(2)
        .any(|pair| pair == ["resources", "app"] || pair == ["resources", "app.asar.unpacked"])
    {
        return InstallChannel::Bundled {
            application: "desktop application".into(),
        };
    }
    if lower.iter().any(|part| part == "extensions")
        && lower.iter().any(|part| {
            part.starts_with("anthropic.claude-code-") || part.starts_with("openai.chatgpt-")
        })
    {
        return InstallChannel::Bundled {
            application: "editor extension".into(),
        };
    }
    let provider = provider_namespace(agent_id);
    let package = match provider {
        "claude" => Some(["@anthropic-ai", "claude-code"]),
        "codex" => Some(["@openai", "codex"]),
        _ => None,
    };
    if let Some(package) = package.filter(|package| {
        lower
            .windows(3)
            .any(|parts| parts == ["node_modules", package[0], package[1]])
    }) {
        return InstallChannel::Npm {
            package: format!("{}/{}", package[0], package[1]),
        };
    }
    let formula = if provider == "claude" {
        "claude-code"
    } else {
        provider
    };
    if let Some(parts) = lower.windows(2).find(|parts| {
        matches!(parts[0].as_str(), "cellar" | "caskroom")
            && (parts[1] == formula || parts[1] == format!("{formula}@latest"))
    }) {
        return InstallChannel::Homebrew {
            formula: parts[1].clone(),
        };
    }
    if (provider == "claude"
        && lower
            .windows(4)
            .any(|parts| parts == [".local", "share", "claude", "versions"]))
        || (provider == "claude"
            && lower.ends_with(&[".local".into(), "bin".into(), "claude.exe".into()]))
        || (provider == "codex"
            && lower
                .windows(3)
                .any(|parts| parts == [".codex", "packages", "standalone"]))
    {
        return InstallChannel::VendorStandalone;
    }
    InstallChannel::Unknown
}

/// A badge records exact compatibility evidence, not an inferred promise about a newer version.
pub fn verification(found: &str, verified: Option<(&str, &str)>) -> VersionVerification {
    match verified {
        Some((version, scope)) if found == version => VersionVerification::Verified {
            version: version.into(),
            scope: scope.into(),
        },
        Some((version, _)) => VersionVerification::Untested {
            last_verified: Some(version.into()),
        },
        None => VersionVerification::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_package_and_vendor_layouts_are_classified_without_changing_launch_paths() {
        assert_eq!(
            classify_channel(
                "claude-acp",
                "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
            ),
            InstallChannel::Npm {
                package: "@anthropic-ai/claude-code".into()
            }
        );
        assert_eq!(
            classify_channel(
                "codex",
                "/home/user/.codex/packages/standalone/releases/0.164.0/codex"
            ),
            InstallChannel::VendorStandalone
        );
        assert_eq!(
            classify_channel("claude", "/home/user/.local/share/claude/versions/2.1.310"),
            InstallChannel::VendorStandalone
        );
        assert_eq!(
            classify_channel("codex", "/opt/homebrew/Cellar/codex/0.164.0/bin/codex"),
            InstallChannel::Homebrew {
                formula: "codex".into()
            }
        );
        assert_eq!(
            classify_channel("codex", "/some/unknown/bin/codex"),
            InstallChannel::Unknown
        );
        assert_eq!(
            classify_channel(
                "claude",
                "/tmp/not-node_modules/@anthropic-ai/claude-code/cli.js"
            ),
            InstallChannel::Unknown
        );
    }

    #[test]
    fn bundled_copies_are_read_only_even_when_they_contain_a_known_package() {
        assert!(matches!(
            classify_channel(
                "codex",
                "/Applications/Editor.app/Contents/Resources/node_modules/@openai/codex/bin/codex"
            ),
            InstallChannel::Bundled { .. }
        ));
        assert!(matches!(
            classify_channel(
                "claude",
                "C:\\Editor\\resources\\app\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
            ),
            InstallChannel::Bundled { .. }
        ));
        assert!(matches!(
            classify_channel(
                "claude",
                "/home/user/.vscode/extensions/anthropic.claude-code-2.1.310/resources/claude"
            ),
            InstallChannel::Bundled { .. }
        ));
    }

    #[test]
    fn transport_aliases_share_a_provider_but_unrelated_agents_do_not() {
        assert_eq!(provider_namespace("codex"), provider_namespace("codex-acp"));
        assert_ne!(provider_namespace("codex"), provider_namespace("claude"));
        assert_eq!(provider_namespace("custom-codex"), "custom-codex");
    }

    #[test]
    fn prereleases_and_newer_versions_do_not_inherit_verified_badges() {
        let verified = Some(("0.164.0", "Windows protocol fixtures"));
        assert!(matches!(
            verification("0.164.0", verified),
            VersionVerification::Verified { .. }
        ));
        for version in ["0.164.0-alpha.1", "0.165.0", "0.163.0"] {
            assert!(matches!(
                verification(version, verified),
                VersionVerification::Untested { .. }
            ));
        }
    }
}
