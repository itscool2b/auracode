//! A terminal chat's launch: the agent's own interactive interface, started with what the chat's
//! driver would get (program, environment, account, shared MCP, project memory, the session to
//! continue) but the CLI's interactive arguments instead of its protocol. Credential values travel
//! only in the environment, never on the command line, where other programs and logs can read them.
use std::path::PathBuf;

use aura_process::{EnvKey, LaunchSpec};
use aura_protocol::{
    Autonomy,
    mcp::{McpTransport, ResolvedMcpServer},
};
use serde_json::{Value, json};

/// The vendor session a terminal opens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalSession {
    /// Continue this session (Claude Code's session ID, Codex's thread ID).
    Resume(String),
    /// A new Claude Code session under this ID, chosen up front so Chat can resume it later.
    NewClaude(String),
    /// A new session the agent names itself (Codex).
    New,
}

pub struct TerminalOptions<'a> {
    pub servers: &'a [ResolvedMcpServer],
    pub autonomy: Autonomy,
    pub session: TerminalSession,
    /// The model the chat chose, if it chose one.
    pub model: Option<String>,
    pub add_dirs: &'a [PathBuf],
    /// The terminal's first message: the visible handoff when the chat moved here from another
    /// agent, so the new agent starts with the conversation so far.
    pub first_message: Option<String>,
}

/// The launch, and the shared servers it had to leave out, with why, for the chat to say.
#[derive(Debug, Clone)]
pub struct TerminalLaunch {
    pub launch: LaunchSpec,
    pub omitted: Vec<String>,
}

/// Claude Code's interactive interface. Its MCP descriptor names environment variables
/// (`${AURA_MCP_0_env_0}`) whose values the launch sets, as the protocol launch does.
pub fn claude(base: &LaunchSpec, options: &TerminalOptions<'_>) -> TerminalLaunch {
    let mut launch = base.clone();
    launch.args.clear();
    launch.label = format!("{} (terminal)", base.label);
    crate::mcp::claude(options.servers, &mut launch);
    let mode = match options.autonomy {
        Autonomy::Ask => "default",
        Autonomy::AutoEdit => "acceptEdits",
        Autonomy::FullAuto => "bypassPermissions",
    };
    launch
        .args
        .extend(["--permission-mode".into(), mode.into()]);
    if options.autonomy == Autonomy::FullAuto {
        launch
            .args
            .push("--allow-dangerously-skip-permissions".into());
    }
    match &options.session {
        TerminalSession::Resume(id) => launch.args.push(format!("--resume={id}").into()),
        TerminalSession::NewClaude(id) => launch.args.push(format!("--session-id={id}").into()),
        TerminalSession::New => {}
    }
    if let Some(model) = &options.model {
        launch.args.push(format!("--model={model}").into());
    }
    for dir in options.add_dirs {
        launch
            .args
            .extend(["--add-dir".into(), dir.as_os_str().to_owned()]);
    }
    if let Some(message) = &options.first_message {
        launch.args.push(message.into());
    }
    TerminalLaunch {
        launch,
        omitted: Vec::new(),
    }
}

/// A key Codex's `-c` path can carry without quoting: its parser splits the path at dots.
fn plain_key(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A TOML value for `-c`: JSON strings, arrays and inline tables of strings are valid TOML.
fn toml(value: &Value) -> String {
    match value {
        Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .map(|(k, v)| format!("{}={}", Value::String(k.clone()), toml(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Array(items) => {
            format!("[{}]", items.iter().map(toml).collect::<Vec<_>>().join(","))
        }
        other => other.to_string(),
    }
}

/// Codex's interactive interface. Shared servers go in `-c mcp_servers.<name>.*` overrides; a
/// command's environment credentials are set on Codex's process and forwarded by name
/// (`env_vars`), and an address's header credentials through `env_http_headers`.
pub fn codex(base: &LaunchSpec, options: &TerminalOptions<'_>) -> TerminalLaunch {
    let mut launch = base.clone();
    launch.args.clear();
    launch.label = format!("{} (terminal)", base.label);
    let mut omitted = Vec::new();
    if let TerminalSession::Resume(id) = &options.session {
        launch.args.extend(["resume".into(), id.into()]);
    }
    let (approval, sandbox) = match options.autonomy {
        Autonomy::FullAuto => ("never", "danger-full-access"),
        Autonomy::AutoEdit => ("on-request", "workspace-write"),
        Autonomy::Ask => ("untrusted", "read-only"),
    };
    launch.args.extend([
        "--ask-for-approval".into(),
        approval.into(),
        "--sandbox".into(),
        sandbox.into(),
    ]);
    if let Some(model) = &options.model {
        launch.args.extend(["--model".into(), model.into()]);
    }
    for dir in options.add_dirs {
        launch
            .args
            .extend(["--add-dir".into(), dir.as_os_str().to_owned()]);
    }
    // Names compare as the OS compares them (TOKEN and token are one variable on Windows). A
    // variable forwarded to one server must not carry another's value, nor replace one the launch
    // already sets (the account's, say); auracode's own AURA_ names are reserved.
    let launch_names: std::collections::BTreeSet<EnvKey> = launch
        .set_env
        .iter()
        .map(|(name, _)| EnvKey::new(name.clone()))
        .collect();
    let mut forwarded = std::collections::BTreeMap::<EnvKey, String>::new();
    let mut headers = 0usize;
    for server in options.servers {
        let name = &server.definition.name;
        if !plain_key(name) {
            omitted.push(format!(
                "{name}: Codex's terminal cannot take a server name with dots"
            ));
            continue;
        }
        let mut overrides: Vec<(String, Value)> = Vec::new();
        let mut env = Vec::new();
        match &server.definition.transport {
            McpTransport::Stdio { command, args } => {
                // auracode's own project-memory server uses the reserved names by design.
                let own_memory = crate::mcp::managed_memory(server);
                let reserved = !own_memory
                    && server.credentials.env.keys().any(|key| {
                        key.get(..5)
                            .is_some_and(|p| p.eq_ignore_ascii_case("AURA_"))
                            || launch_names.contains(&EnvKey::new(key))
                    });
                if reserved {
                    omitted.push(format!(
                        "{name}: it needs a variable auracode sets for the launch itself"
                    ));
                    continue;
                }
                let mut own = std::collections::BTreeMap::<EnvKey, &String>::new();
                let clash = server.credentials.env.iter().any(|(key, value)| {
                    let name = EnvKey::new(key);
                    own.insert(name.clone(), value)
                        .is_some_and(|other| other != value)
                        || forwarded
                            .get(&name)
                            .is_some_and(|existing| existing != value)
                });
                if clash {
                    omitted.push(format!(
                        "{name}: another shared server needs a different value in the same variable"
                    ));
                    continue;
                }
                overrides.push(("command".into(), json!(command)));
                overrides.push(("args".into(), json!(args)));
                if !server.credentials.env.is_empty() {
                    overrides.push((
                        "env_vars".into(),
                        json!(server.credentials.env.keys().collect::<Vec<_>>()),
                    ));
                    for (key, value) in &server.credentials.env {
                        env.push((key.clone(), value.clone()));
                    }
                }
            }
            McpTransport::Http { url } => {
                overrides.push(("url".into(), json!(url)));
                if !server.credentials.headers.is_empty() {
                    let mut names = serde_json::Map::new();
                    for (header, value) in &server.credentials.headers {
                        let mut variable = format!("AURA_CODEX_MCP_HEADER_{headers}");
                        while launch_names.contains(&EnvKey::new(&variable)) {
                            headers += 1;
                            variable = format!("AURA_CODEX_MCP_HEADER_{headers}");
                        }
                        headers += 1;
                        names.insert(header.clone(), json!(variable));
                        env.push((variable, value.clone()));
                    }
                    overrides.push(("env_http_headers".into(), Value::Object(names)));
                }
            }
            McpTransport::Sse { .. } => {
                omitted.push(format!("{name}: Codex does not take legacy SSE servers"));
                continue;
            }
        }
        overrides.push(("enabled".into(), json!(true)));
        for (key, value) in overrides {
            launch.args.extend([
                "-c".into(),
                format!("mcp_servers.{name}.{key}={}", toml(&value)).into(),
            ]);
        }
        for (key, value) in env {
            let name = EnvKey::new(&key);
            forwarded.insert(name.clone(), value.clone());
            launch
                .set_env
                .retain(|(existing, _)| EnvKey::new(existing.clone()) != name);
            launch.set_env.push((key.into(), value.into()));
        }
    }
    if let Some(message) = &options.first_message {
        launch.args.push(message.into());
    }
    TerminalLaunch { launch, omitted }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::mcp::{McpCredentials, McpDefinition};
    use std::collections::BTreeMap;

    fn base() -> LaunchSpec {
        LaunchSpec {
            label: "claude".into(),
            program: PathBuf::from("/bin/claude"),
            args: vec!["-p".into(), "--output-format".into(), "stream-json".into()],
            cwd: aura_process::ProcessCwd::ChatFolder,
            set_env: vec![("CLAUDE_CONFIG_DIR".into(), "/accounts/two".into())],
            daemons: Vec::new(),
            startup_timeout: std::time::Duration::from_secs(30),
        }
    }

    fn server(name: &str, transport: McpTransport, env: &[(&str, String)]) -> ResolvedMcpServer {
        let values: BTreeMap<String, String> = env
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect();
        let http = matches!(transport, McpTransport::Http { .. });
        ResolvedMcpServer {
            definition: McpDefinition {
                id: "61a6ce00-b99f-4f8a-9148-8f880f3c735f".into(),
                name: name.into(),
                project_id: None,
                enabled: true,
                transport,
                env_keys: if http {
                    vec![]
                } else {
                    values.keys().cloned().collect()
                },
                header_keys: if http {
                    values.keys().cloned().collect()
                } else {
                    vec![]
                },
                agents: None,
            },
            revision: 1,
            credentials: McpCredentials {
                env: if http {
                    BTreeMap::new()
                } else {
                    values.clone()
                },
                headers: if http { values } else { BTreeMap::new() },
            },
        }
    }

    fn args(launch: &LaunchSpec) -> Vec<String> {
        launch
            .args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    fn options(servers: &[ResolvedMcpServer], session: TerminalSession) -> TerminalOptions<'_> {
        TerminalOptions {
            servers,
            autonomy: Autonomy::AutoEdit,
            session,
            model: Some("opus".into()),
            add_dirs: &[],
            first_message: None,
        }
    }

    #[test]
    fn claude_drops_the_protocol_resumes_the_chats_session_and_keeps_the_account() {
        let made = claude(&base(), &options(&[], TerminalSession::Resume("s1".into())));
        let argv = args(&made.launch);
        assert!(
            !argv.iter().any(|a| a == "-p" || a.contains("stream-json")),
            "{argv:?}"
        );
        assert!(argv.contains(&"--resume=s1".to_owned()));
        assert!(argv.contains(&"--model=opus".to_owned()));
        assert_eq!(
            argv[..2],
            ["--permission-mode".to_owned(), "acceptEdits".to_owned()]
        );
        assert!(
            made.launch
                .set_env
                .iter()
                .any(|(k, _)| k == "CLAUDE_CONFIG_DIR")
        );
        let new = claude(
            &base(),
            &options(&[], TerminalSession::NewClaude("n1".into())),
        );
        assert!(args(&new.launch).contains(&"--session-id=n1".to_owned()));
    }

    #[test]
    fn a_handoff_is_the_terminals_first_message_after_every_option() {
        let mut opts = options(&[], TerminalSession::New);
        opts.first_message = Some("Visible conversation handoff".into());
        for made in [claude(&base(), &opts), codex(&base(), &opts)] {
            assert_eq!(
                args(&made.launch).last().map(String::as_str),
                Some("Visible conversation handoff")
            );
        }
    }

    #[test]
    fn credentials_never_reach_either_command_line() {
        let secret = format!("value-{}", 41);
        let servers = [
            server(
                "docs",
                McpTransport::Stdio {
                    command: "node".into(),
                    args: vec!["s.js".into()],
                },
                &[("TOKEN", secret.clone())],
            ),
            server(
                "remote",
                McpTransport::Http {
                    url: "https://example.test/mcp".into(),
                },
                &[("X-Key", secret.clone())],
            ),
        ];
        for made in [
            claude(&base(), &options(&servers, TerminalSession::New)),
            codex(&base(), &options(&servers, TerminalSession::New)),
        ] {
            assert!(!args(&made.launch).iter().any(|a| a.contains(&secret)));
            assert!(
                made.launch
                    .set_env
                    .iter()
                    .any(|(_, v)| v.to_string_lossy() == secret)
            );
        }
    }

    #[test]
    fn codex_forwards_a_commands_variables_by_name_and_headers_through_the_environment() {
        let secret = format!("value-{}", 7);
        let servers = [
            server(
                "docs",
                McpTransport::Stdio {
                    command: "node".into(),
                    args: vec!["s.js".into()],
                },
                &[("TOKEN", secret.clone())],
            ),
            server(
                "remote",
                McpTransport::Http {
                    url: "https://example.test/mcp".into(),
                },
                &[("X-Key", secret.clone())],
            ),
        ];
        let made = codex(
            &base(),
            &options(&servers, TerminalSession::Resume("t1".into())),
        );
        let args = args(&made.launch);
        assert_eq!(args[..2], ["resume".to_owned(), "t1".to_owned()]);
        assert!(
            args.contains(&r#"mcp_servers.docs.command="node""#.to_owned()),
            "{args:?}"
        );
        assert!(args.contains(&r#"mcp_servers.docs.args=["s.js"]"#.to_owned()));
        assert!(args.contains(&r#"mcp_servers.docs.env_vars=["TOKEN"]"#.to_owned()));
        assert!(
            args.contains(
                &r#"mcp_servers.remote.env_http_headers={"X-Key"="AURA_CODEX_MCP_HEADER_0"}"#
                    .to_owned()
            )
        );
        assert!(
            made.launch
                .set_env
                .iter()
                .any(|(k, v)| k == "TOKEN" && v.to_string_lossy() == secret)
        );
        assert!(made.omitted.is_empty());
    }

    #[test]
    fn codex_never_lets_a_server_variable_replace_the_launchs_or_auracodes_own() {
        let mut launch = base();
        launch
            .set_env
            .push(("AURA_CODEX_MCP_HEADER_0".into(), "taken".into()));
        let servers = [
            server(
                "account",
                McpTransport::Stdio {
                    command: "a".into(),
                    args: vec![],
                },
                &[("CLAUDE_CONFIG_DIR", format!("v{}", 1))],
            ),
            server(
                "reserved",
                McpTransport::Stdio {
                    command: "b".into(),
                    args: vec![],
                },
                &[("aura_codex_mcp_header_9", format!("v{}", 2))],
            ),
            server(
                "remote",
                McpTransport::Http {
                    url: "https://example.test/mcp".into(),
                },
                &[("X-Key", format!("v{}", 3))],
            ),
        ];
        let made = codex(&launch, &options(&servers, TerminalSession::New));
        assert_eq!(made.omitted.len(), 2, "{:?}", made.omitted);
        // The header takes the next free name, leaving the launch's own value alone.
        assert!(
            args(&made.launch)
                .iter()
                .any(|a| a.contains("AURA_CODEX_MCP_HEADER_1"))
        );
        let taken = made
            .launch
            .set_env
            .iter()
            .find(|(k, _)| k == "AURA_CODEX_MCP_HEADER_0");
        assert_eq!(
            taken.map(|(_, v)| v.to_string_lossy().into_owned()),
            Some("taken".into())
        );
    }

    #[test]
    fn codex_keeps_project_memory_whose_variables_are_auracodes_own() {
        let mut memory = server(
            "aura_project_memory",
            McpTransport::Stdio {
                command: "auracode".into(),
                args: vec!["--aura-memory-helper".into()],
            },
            &[("AURA_MEMORY_TOKEN", format!("t{}", 1))],
        );
        memory.definition.id = "aura-project-memory".into();
        let made = codex(
            &base(),
            &options(std::slice::from_ref(&memory), TerminalSession::New),
        );
        assert!(made.omitted.is_empty(), "{:?}", made.omitted);
        assert!(
            args(&made.launch)
                .iter()
                .any(|a| a.starts_with("mcp_servers.aura_project_memory."))
        );
        // Another server may still not take auracode's names.
        let mut other = memory.clone();
        other.definition.id = "61a6ce00-b99f-4f8a-9148-8f880f3c735f".into();
        other.definition.name = "imposter".into();
        assert_eq!(
            codex(&base(), &options(&[other], TerminalSession::New))
                .omitted
                .len(),
            1
        );
    }

    #[test]
    fn codex_compares_variable_names_as_the_os_does() {
        let servers = [
            server(
                "one",
                McpTransport::Stdio {
                    command: "a".into(),
                    args: vec![],
                },
                &[("TOKEN", format!("v{}", 1))],
            ),
            server(
                "two",
                McpTransport::Stdio {
                    command: "b".into(),
                    args: vec![],
                },
                &[("token", format!("v{}", 2))],
            ),
        ];
        let made = codex(&base(), &options(&servers, TerminalSession::New));
        // One variable on Windows, two elsewhere.
        assert_eq!(
            made.omitted.len(),
            usize::from(cfg!(windows)),
            "{:?}",
            made.omitted
        );
    }

    #[test]
    fn codex_leaves_out_what_it_cannot_take_and_says_why() {
        let servers = [
            server(
                "legacy",
                McpTransport::Sse {
                    url: "https://example.test/sse".into(),
                },
                &[],
            ),
            server(
                "dotted.name",
                McpTransport::Http {
                    url: "https://example.test/mcp".into(),
                },
                &[],
            ),
            server(
                "one",
                McpTransport::Stdio {
                    command: "a".into(),
                    args: vec![],
                },
                &[("TOKEN", format!("v{}", 1))],
            ),
            server(
                "two",
                McpTransport::Stdio {
                    command: "b".into(),
                    args: vec![],
                },
                &[("TOKEN", format!("v{}", 2))],
            ),
        ];
        let made = codex(&base(), &options(&servers, TerminalSession::New));
        assert_eq!(made.omitted.len(), 3, "{:?}", made.omitted);
        assert!(
            args(&made.launch)
                .iter()
                .any(|a| a.starts_with("mcp_servers.one."))
        );
        assert!(
            !args(&made.launch)
                .iter()
                .any(|a| a.starts_with("mcp_servers.two."))
        );
    }
}
