//! The catalog: every agent auracode knows, as data.
//!
//! The npm adapters' version floors are the CLI versions they bundle (claude-agent-acp 0.95.0
//! bundles the Agent SDK with Claude Code 2.1.309; codex-acp 2.2.2 depends on `@openai/codex`
//! ^0.160.1). auracode always drives the user's own CLI behind an adapter, forced through the
//! adapter's variable ([`UserBinary::env`]), never the one the adapter bundles.

use std::sync::LazyLock;
use std::time::Duration;

use aura_process::DaemonMatch;
use aura_protocol::DriverKind;

/// One agent auracode can start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub kind: DriverKind,
    /// The driver's dialect for this agent (`"hermes"`, `"claude-acp"`, ...).
    pub dialect: &'static str,
    pub recipe: Recipe,
    pub startup_timeout: Duration,
    /// Turns run in a daemon that outlives the agent process (Hermes' gateway): cancels wait longer,
    /// and resumes compare the replay with stored history.
    pub turns_survive_process: bool,
    /// Copied into the launch spec: spared by the kill rule.
    pub daemons: Vec<DaemonMatch>,
    /// The version auracode was last verified with, for the "untested version" badge.
    pub last_verified: &'static str,
}

/// How to find and start an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Recipe {
    /// A binary on the user's `PATH`.
    Binary {
        program: &'static str,
        args: &'static [&'static str],
        version_args: &'static [&'static str],
        min_version: Option<&'static str>,
    },
    /// The user's CLI directly, with an explicit executable override and a required version.
    /// Windows shell shims are rejected; no adapter or package installation is involved.
    NativeBinary {
        user_binary: UserBinary,
        /// Protocol transport flags. Session, model and permission flags belong to the driver.
        args: &'static [&'static str],
    },
    /// An npm adapter installed once per version into `<data root>/adapters`, launched as
    /// `node <entry>` from its own folder, driving the user's own CLI.
    NpmAdapter {
        package: &'static str,
        version: &'static str,
        /// The package's `bin` entry to run.
        bin: &'static str,
        min_node_major: u32,
        user_binary: UserBinary,
    },
    /// Runs inside auracode (the demo agent); no process.
    Builtin,
}

/// The user's own CLI, run directly or by an adapter. An adapter always sets `env` to its path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserBinary {
    /// "Claude Code", for messages.
    pub label: &'static str,
    pub program: &'static str,
    /// Executable override: `CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`.
    pub env: &'static str,
    pub version_args: &'static [&'static str],
    pub min_version: &'static str,
}

/// Every agent auracode knows, in the order the New chat screen lists them. Built once.
pub fn catalog() -> &'static [AgentSpec] {
    static CATALOG: LazyLock<Vec<AgentSpec>> = LazyLock::new(build_catalog);
    &CATALOG
}

/// The agent with this id.
pub fn get(id: &str) -> Option<&'static AgentSpec> {
    catalog().iter().find(|spec| spec.id == id)
}

const START_TIMEOUT: Duration = Duration::from_secs(60);

fn build_catalog() -> Vec<AgentSpec> {
    vec![
        AgentSpec {
            id: "hermes",
            name: "Hermes",
            description: "Hermes Agent through its ACP mode (hermes acp). Its turns run in the Hermes gateway.",
            kind: DriverKind::Acp,
            dialect: "hermes",
            recipe: Recipe::Binary {
                program: "hermes",
                args: &["acp"],
                version_args: &["--version"],
                min_version: None,
            },
            // The gateway may start first.
            startup_timeout: START_TIMEOUT,
            turns_survive_process: true,
            daemons: vec![DaemonMatch {
                program: None,
                args_in_order: vec!["hermes_cli.main".into(), "gateway".into(), "run".into()],
            }],
            last_verified: "Hermes 0.22.5",
        },
        AgentSpec {
            id: "claude",
            name: "Claude Code",
            description: "Your Claude Code, driven directly through its native control protocol.",
            kind: DriverKind::Claude,
            dialect: "claude",
            recipe: Recipe::NativeBinary {
                user_binary: UserBinary {
                    label: "Claude Code",
                    program: "claude",
                    env: "CLAUDE_CODE_EXECUTABLE",
                    version_args: &["--version"],
                    min_version: "2.1.310",
                },
                args: &[
                    "-p",
                    "--input-format",
                    "stream-json",
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--include-partial-messages",
                    "--permission-prompt-tool",
                    "stdio",
                ],
            },
            startup_timeout: START_TIMEOUT,
            turns_survive_process: false,
            daemons: vec![DaemonMatch {
                program: Some("claude".into()),
                args_in_order: vec!["daemon".into(), "run".into()],
            }],
            last_verified: "Claude Code 2.1.310 (macOS)",
        },
        AgentSpec {
            id: "claude-acp",
            name: "Claude Code (ACP)",
            description: "Your Claude Code, driven through the claude-agent-acp adapter.",
            kind: DriverKind::Acp,
            dialect: "claude-acp",
            recipe: Recipe::NpmAdapter {
                package: "@agentclientprotocol/claude-agent-acp",
                version: "0.95.0",
                bin: "claude-agent-acp",
                min_node_major: 22,
                user_binary: UserBinary {
                    label: "Claude Code",
                    program: "claude",
                    env: "CLAUDE_CODE_EXECUTABLE",
                    version_args: &["--version"],
                    min_version: "2.1.309",
                },
            },
            startup_timeout: START_TIMEOUT,
            turns_survive_process: false,
            // A precaution: seen as `claude daemon run --origin transient ...` on this Mac.
            daemons: vec![DaemonMatch {
                program: Some("claude".into()),
                args_in_order: vec!["daemon".into(), "run".into()],
            }],
            last_verified: "adapter 0.95.0 with Claude Code 2.1.310",
        },
        AgentSpec {
            id: "codex",
            name: "Codex",
            description: "Your Codex CLI, driven directly through its native app-server.",
            kind: DriverKind::Codex,
            dialect: "codex",
            recipe: Recipe::NativeBinary {
                user_binary: UserBinary {
                    label: "Codex",
                    program: "codex",
                    env: "CODEX_PATH",
                    version_args: &["--version"],
                    min_version: "0.162.1",
                },
                args: &["app-server", "--listen", "stdio://"],
            },
            startup_timeout: START_TIMEOUT,
            turns_survive_process: false,
            daemons: vec![DaemonMatch {
                program: Some("codex".into()),
                args_in_order: vec!["app-server".into(), "daemon".into()],
            }],
            last_verified: "Codex 0.162.1 schema and fixtures (Windows); live verification pending",
        },
        AgentSpec {
            id: "codex-acp",
            name: "Codex (ACP)",
            description: "Your Codex CLI, driven through the codex-acp adapter.",
            kind: DriverKind::Acp,
            dialect: "codex-acp",
            recipe: Recipe::NpmAdapter {
                package: "@agentclientprotocol/codex-acp",
                version: "2.2.2",
                bin: "codex-acp",
                min_node_major: 22,
                user_binary: UserBinary {
                    label: "Codex",
                    program: "codex",
                    env: "CODEX_PATH",
                    version_args: &["--version"],
                    min_version: "0.160.1",
                },
            },
            startup_timeout: START_TIMEOUT,
            turns_survive_process: false,
            daemons: Vec::new(),
            last_verified: "adapter 2.2.2 with Codex 0.164.0",
        },
        AgentSpec {
            id: "mock",
            name: "Demo agent (scripted, no AI)",
            description: "A scripted agent for trying auracode without an AI: it streams a demo turn, asks for permissions and questions, and can fail on purpose.",
            kind: DriverKind::Mock,
            dialect: "mock",
            recipe: Recipe::Builtin,
            startup_timeout: Duration::from_secs(5),
            turns_survive_process: false,
            daemons: Vec::new(),
            last_verified: "auracode",
        },
    ]
}

/// The first `x.y.z` in `text` (a leading `v` is allowed and dropped): `"Claude Code 2.1.310"` gives
/// `"2.1.310"`, `"v26.0.0"` gives `"26.0.0"`.
pub fn parse_version(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    for start in 0..bytes.len() {
        let starts_run =
            bytes[start].is_ascii_digit() && (start == 0 || !bytes[start - 1].is_ascii_digit());
        if !starts_run {
            continue;
        }
        if let Some(end) = version_end(bytes, start) {
            return text.get(start..end).map(str::to_owned);
        }
    }
    None
}

/// Where `digits.digits.digits` starting at `start` ends, if it is there.
fn version_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut at = start;
    for part in 0..3 {
        let digits = bytes[at..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        if digits == 0 {
            return None;
        }
        at += digits;
        if part < 2 {
            if bytes.get(at) != Some(&b'.') {
                return None;
            }
            at += 1;
        }
    }
    Some(at)
}

/// Whether `found` is at least `floor`, comparing `x.y.z` numerically. A version that does not
/// parse never satisfies a floor.
pub fn version_at_least(found: &str, floor: &str) -> bool {
    match (numeric(found), numeric(floor)) {
        (Some(found), Some(floor)) => found >= floor,
        _ => false,
    }
}

fn numeric(version: &str) -> Option<(u64, u64, u64)> {
    let version = parse_version(version)?;
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn the_catalog_lists_native_claude_before_its_compatibility_adapter() {
        let ids: Vec<&str> = catalog().iter().map(|spec| spec.id).collect();
        assert_eq!(
            ids,
            [
                "hermes",
                "claude",
                "claude-acp",
                "codex",
                "codex-acp",
                "mock"
            ]
        );
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
        assert_eq!(get("codex-acp").map(|spec| spec.name), Some("Codex (ACP)"));
        assert!(get("agent").is_none());
        assert!(std::ptr::eq(catalog(), catalog()), "built once");
    }

    #[test]
    fn each_agent_has_its_drivers_and_limits() {
        let hermes = get("hermes").expect("hermes");
        assert_eq!(hermes.kind, DriverKind::Acp);
        assert!(hermes.turns_survive_process);
        assert_eq!(hermes.startup_timeout, Duration::from_secs(60));
        assert_eq!(
            hermes.daemons[0].args_in_order,
            ["hermes_cli.main", "gateway", "run"]
        );
        assert!(matches!(
            hermes.recipe,
            Recipe::Binary {
                program: "hermes",
                args: ["acp"],
                min_version: None,
                ..
            }
        ));

        let native = get("claude").expect("native Claude");
        assert_eq!(native.kind, DriverKind::Claude);
        assert_eq!(native.dialect, "claude");
        assert!(!native.turns_survive_process);
        assert!(matches!(
            native.recipe,
            Recipe::NativeBinary {
                user_binary: UserBinary {
                    program: "claude",
                    env: "CLAUDE_CODE_EXECUTABLE",
                    min_version: "2.1.310",
                    ..
                },
                ..
            }
        ));

        let claude = get("claude-acp").expect("claude");
        let Recipe::NpmAdapter {
            package,
            version,
            bin,
            min_node_major,
            user_binary,
        } = &claude.recipe
        else {
            panic!("claude-acp is an npm adapter");
        };
        assert_eq!(
            (*package, *version, *bin, *min_node_major),
            (
                "@agentclientprotocol/claude-agent-acp",
                "0.95.0",
                "claude-agent-acp",
                22
            )
        );
        assert_eq!(
            (
                user_binary.program,
                user_binary.env,
                user_binary.min_version
            ),
            ("claude", "CLAUDE_CODE_EXECUTABLE", "2.1.309")
        );
        assert_eq!(claude.daemons[0].program.as_deref(), Some("claude"));

        let codex = get("codex-acp").expect("codex");
        assert!(matches!(
            &codex.recipe,
            Recipe::NpmAdapter {
                version: "2.2.2",
                user_binary: UserBinary {
                    env: "CODEX_PATH",
                    min_version: "0.160.1",
                    ..
                },
                ..
            }
        ));
        assert!(codex.daemons.is_empty());

        let mock = get("mock").expect("mock");
        assert_eq!(mock.kind, DriverKind::Mock);
        assert_eq!(mock.recipe, Recipe::Builtin);
        assert_eq!(mock.startup_timeout, Duration::from_secs(5));
    }

    #[test]
    fn versions_parse_from_cli_output() {
        for (text, version) in [
            ("2.1.310 (Claude Code)", Some("2.1.310")),
            ("codex-cli 0.164.0", Some("0.164.0")),
            ("Hermes Agent v0.22.5", Some("0.22.5")),
            ("v26.0.0", Some("26.0.0")),
            ("11.12.1\n", Some("11.12.1")),
            ("node 22.1 then 1.2.3.4", Some("1.2.3")),
            ("build 20251024.1.2", Some("20251024.1.2")),
            ("1.2", None),
            ("1..2.3", None),
            ("", None),
            ("no digits", None),
        ] {
            assert_eq!(parse_version(text).as_deref(), version, "{text:?}");
        }
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(version_at_least("2.1.310", "2.1.309"));
        assert!(version_at_least("2.1.309", "2.1.309"));
        assert!(!version_at_least("2.1.99", "2.1.309"));
        assert!(version_at_least("0.164.0", "0.160.1"));
        assert!(!version_at_least("0.9.9", "0.160.1"));
        assert!(version_at_least("v26.0.0", "22.0.0"));
        assert!(!version_at_least("garbage", "1.0.0"));
        assert!(!version_at_least("1.0.0", "garbage"));
        assert!(!version_at_least("99999999999999999999.0.0", "1.0.0"));
    }
}
