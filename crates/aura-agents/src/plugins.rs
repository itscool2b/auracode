//! Live Plugin library listings from each agent's own CLI. Only reviewed, read-only commands with a
//! documented machine-readable output (or, for Pi, a fixed plain-text list) run here, through the
//! same bounded helper launch as version probes. Commands that start MCP servers to check them
//! (`claude mcp list`, `pi mcp list`, `opencode mcp list`) are never run: their features come from
//! files. Parsers keep names and public facts only. Secret values in the output (Codex prints MCP
//! env and header values) are dropped while parsing and the raw output is wiped.
//!
//! Sources (checked 2026-10-28 against the installed CLIs' `--help` and the vendors' docs, listed in
//! docs/plugin-library.md): `claude plugin list --json --available`, `claude plugin marketplace
//! list --json` (Claude Code 2.1.312); `codex plugin list --json --available`, `codex plugin
//! marketplace list --json`, `codex mcp list --json` (Codex 0.162.1); `pi list` (Pi 1.0.2).
use std::ffi::OsString;
use std::sync::Arc;
use std::time::Duration;

use aura_process::{
    EnvKey, HelperEnv, HelperOutput, HelperSpec, LeftoverRegistry, Redactor, ResolvedEnv,
    run_helper, secret_values,
};
use aura_protocol::agents::{AgentHost, AgentInstallation};
use aura_protocol::plugins::{FeatureListing, ListingState, PluginEntry, PluginFeature};
use serde_json::Value;

/// A listing command is killed with its tree after this.
pub const LISTING_TIMEOUT: Duration = Duration::from_secs(20);
/// Claude's full plugin directory is about 2 MB of JSON; anything past this is refused.
pub const LISTING_MAX_STDOUT: usize = 6 * 1024 * 1024;
/// Installed and configured entries kept per feature.
pub const MAX_ENTRIES: usize = 1000;
/// Available entries kept per feature; the total is still counted.
pub const MAX_AVAILABLE: usize = 400;
const MAX_TEXT: usize = 256;
const MAX_DESCRIPTION: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Parser {
    ClaudePlugins,
    ClaudeMarketplaces,
    CodexPlugins,
    CodexMarketplaces,
    CodexMcp,
    PiPackages,
}

/// One reviewed read-only listing command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListingRecipe {
    pub feature: PluginFeature,
    pub args: &'static [&'static str],
    /// Fixed variables for this command only: never credentials, never paths.
    pub set: &'static [(&'static str, &'static str)],
    parser: Parser,
}

/// The reviewed listing commands of a provider namespace, in display order. Empty for agents
/// without a machine-readable listing.
pub fn recipes(provider: &str) -> &'static [ListingRecipe] {
    const CLAUDE: &[ListingRecipe] = &[
        ListingRecipe {
            feature: PluginFeature::Plugins,
            args: &["plugin", "list", "--json", "--available"],
            set: &[],
            parser: Parser::ClaudePlugins,
        },
        ListingRecipe {
            feature: PluginFeature::Marketplaces,
            args: &["plugin", "marketplace", "list", "--json"],
            set: &[],
            parser: Parser::ClaudeMarketplaces,
        },
    ];
    const CODEX: &[ListingRecipe] = &[
        ListingRecipe {
            feature: PluginFeature::Plugins,
            args: &["plugin", "list", "--json", "--available"],
            set: &[],
            parser: Parser::CodexPlugins,
        },
        ListingRecipe {
            feature: PluginFeature::Marketplaces,
            args: &["plugin", "marketplace", "list", "--json"],
            set: &[],
            parser: Parser::CodexMarketplaces,
        },
        ListingRecipe {
            feature: PluginFeature::McpServers,
            args: &["mcp", "list", "--json"],
            set: &[],
            parser: Parser::CodexMcp,
        },
    ];
    const PI: &[ListingRecipe] = &[ListingRecipe {
        feature: PluginFeature::Packages,
        // Project-local files are ignored: a listing never extends trust to a folder.
        args: &["list", "--no-approve"],
        set: &[("PI_OFFLINE", "1")],
        parser: Parser::PiPackages,
    }];
    match provider {
        "claude" => CLAUDE,
        "codex" => CODEX,
        "pi" => PI,
        _ => &[],
    }
}

/// The command as a person types it, for the "From ..." line.
pub fn display_command(provider: &str, recipe: &ListingRecipe) -> String {
    std::iter::once(provider)
        .chain(recipe.args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parses one command's output. `Err` carries a fixed sentence, never the output itself.
fn parse(parser: Parser, bytes: &[u8]) -> Result<(Vec<PluginEntry>, Vec<PluginEntry>, u32), ()> {
    if parser == Parser::PiPackages {
        let text = std::str::from_utf8(bytes).map_err(|_| ())?;
        return Ok((pi_packages(text), Vec::new(), 0));
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
    match parser {
        Parser::ClaudePlugins => {
            // `--available` wraps the lists in an object; older builds print the installed array.
            let (installed, available) = match &value {
                Value::Array(_) => (&value, None),
                Value::Object(object) => {
                    (object.get("installed").ok_or(())?, object.get("available"))
                }
                _ => return Err(()),
            };
            let installed = list(installed, MAX_ENTRIES, |item| {
                let key = text(item.get("id")?)?;
                Some(PluginEntry {
                    label: key.split('@').next().unwrap_or(&key).to_owned(),
                    marketplace: key.split_once('@').map(|(_, market)| market.to_owned()),
                    version: item.get("version").and_then(text),
                    scope: item.get("scope").and_then(text),
                    enabled: item.get("enabled").and_then(Value::as_bool),
                    ..entry(key, true)
                })
            })?;
            let (available, total) = available_list(available)?;
            Ok((installed, available, total))
        }
        Parser::CodexPlugins => {
            let object = value.as_object().ok_or(())?;
            let installed = list(object.get("installed").ok_or(())?, MAX_ENTRIES, |item| {
                let mut entry = plugin_entry(item, true)?;
                entry.enabled = item.get("enabled").and_then(Value::as_bool);
                Some(entry)
            })?;
            let (available, total) = available_list(object.get("available"))?;
            Ok((installed, available, total))
        }
        Parser::ClaudeMarketplaces => {
            let entries = list(&value, MAX_ENTRIES, |item| {
                let name = text(item.get("name")?)?;
                let kind = item.get("source").and_then(text);
                Some(PluginEntry {
                    // A GitHub repository is public context; a local path or URL stays out.
                    description: item
                        .get("repo")
                        .and_then(text)
                        .filter(|repo| github_repo(repo)),
                    kind,
                    ..entry(name.clone(), true)
                })
            })?;
            Ok((entries, Vec::new(), 0))
        }
        Parser::CodexMarketplaces => {
            let entries = list(value.get("marketplaces").ok_or(())?, MAX_ENTRIES, |item| {
                let name = text(item.get("name")?)?;
                let kind = item
                    .get("marketplaceSource")
                    .and_then(|source| source.get("sourceType"))
                    .and_then(text);
                Some(PluginEntry {
                    kind,
                    ..entry(name, true)
                })
            })?;
            Ok((entries, Vec::new(), 0))
        }
        Parser::CodexMcp => {
            let entries = list(&value, MAX_ENTRIES, codex_mcp)?;
            Ok((entries, Vec::new(), 0))
        }
        Parser::PiPackages => Err(()),
    }
}

fn entry(key: String, installed: bool) -> PluginEntry {
    PluginEntry {
        label: key.clone(),
        key,
        description: None,
        version: None,
        marketplace: None,
        scope: None,
        enabled: None,
        installed,
        kind: None,
        local_fields: Vec::new(),
        library: None,
    }
}

fn plugin_entry(item: &Value, installed: bool) -> Option<PluginEntry> {
    let key = text(item.get("pluginId")?)?;
    Some(PluginEntry {
        label: item
            .get("name")
            .and_then(text)
            .unwrap_or_else(|| key.split('@').next().unwrap_or(&key).to_owned()),
        marketplace: item.get("marketplaceName").and_then(text),
        version: item.get("version").and_then(text),
        description: item
            .get("description")
            .and_then(Value::as_str)
            .map(|value| clip(value, MAX_DESCRIPTION))
            .filter(|value| !value.is_empty()),
        kind: item
            .get("source")
            .and_then(|source| source.get("source"))
            .and_then(text),
        ..entry(key, installed)
    })
}

fn available_list(value: Option<&Value>) -> Result<(Vec<PluginEntry>, u32), ()> {
    let Some(value) = value else {
        return Ok((Vec::new(), 0));
    };
    let array = value.as_array().ok_or(())?;
    let total = u32::try_from(array.len()).unwrap_or(u32::MAX);
    Ok((
        list(value, MAX_AVAILABLE, |item| plugin_entry(item, false))?,
        total,
    ))
}

/// A bounded list; entries that fail validation are skipped rather than guessed.
fn list(
    value: &Value,
    cap: usize,
    each: impl Fn(&Value) -> Option<PluginEntry>,
) -> Result<Vec<PluginEntry>, ()> {
    Ok(value
        .as_array()
        .ok_or(())?
        .iter()
        .filter_map(each)
        .take(cap)
        .collect())
}

/// Codex prints each server's env and header values. Only their names survive this function.
fn codex_mcp(item: &Value) -> Option<PluginEntry> {
    let name = text(item.get("name")?)?;
    let transport = item.get("transport");
    let kind = transport.and_then(|value| value.get("type")).and_then(text);
    let mut fields = Vec::new();
    for (group, label) in [
        ("env", "env"),
        ("http_headers", "http_headers"),
        ("env_http_headers", "env_http_headers"),
    ] {
        if let Some(object) = transport
            .and_then(|value| value.get(group))
            .and_then(Value::as_object)
        {
            fields.extend(
                object
                    .keys()
                    .filter(|key| safe_name(key))
                    .map(|key| format!("{label}/{key}")),
            );
        }
    }
    if let Some(names) = transport
        .and_then(|value| value.get("env_vars"))
        .and_then(Value::as_array)
    {
        fields.extend(
            names
                .iter()
                .filter_map(Value::as_str)
                .filter(|key| safe_name(key))
                .map(|key| format!("env_vars/{key}")),
        );
    }
    if transport
        .and_then(|value| value.get("bearer_token_env_var"))
        .is_some_and(|value| !value.is_null())
    {
        fields.push("bearer_token_env_var".into());
    }
    fields.sort();
    fields.dedup();
    // What it runs, without arguments (they can carry keys) or URL paths and queries.
    let description = match kind.as_deref() {
        Some("stdio") => transport
            .and_then(|value| value.get("command"))
            .and_then(Value::as_str)
            .map(program_name),
        _ => transport
            .and_then(|value| value.get("url"))
            .and_then(Value::as_str)
            .and_then(url_host),
    };
    Some(PluginEntry {
        enabled: item.get("enabled").and_then(Value::as_bool),
        kind,
        description,
        local_fields: fields,
        ..entry(name, true)
    })
}

/// `pi list`: "User packages:" and "Project packages:" headings over indented sources.
fn pi_packages(text: &str) -> Vec<PluginEntry> {
    let mut scope = None;
    let mut entries = Vec::new();
    for line in text.lines().take(4096) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(char::is_whitespace) {
            scope = match trimmed {
                "User packages:" => Some("user"),
                "Project packages:" => Some("project"),
                _ => None,
            };
            continue;
        }
        let Some(scope) = scope else { continue };
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        let (source, filtered) = match trimmed.strip_suffix(" (filtered)") {
            Some(source) => (source, true),
            None => (trimmed, false),
        };
        let index = entries.len() + 1;
        let label = if package_safe(source) {
            source.to_owned()
        } else {
            // Private sources can embed paths or credentials; keep a neutral name only.
            format!("Package {index} (private source)")
        };
        entries.push(PluginEntry {
            scope: Some(scope.into()),
            kind: Some(
                if source.starts_with("npm:") {
                    "npm"
                } else if source.starts_with("git:") {
                    "git"
                } else {
                    "local"
                }
                .into(),
            ),
            description: filtered.then(|| "Some resources are filtered".into()),
            ..entry(label, true)
        });
    }
    entries
}

fn package_safe(source: &str) -> bool {
    source.len() <= MAX_TEXT
        && (source.starts_with("npm:") || source.starts_with("git:github.com/"))
        && source
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@/._-:^~".contains(c))
}

fn github_repo(value: &str) -> bool {
    value.split_once('/').is_some_and(|(owner, repo)| {
        [owner, repo].iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        })
    })
}

fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.$".contains(&byte))
}

/// A bounded single-line identifier. Anything with control characters is refused, not cleaned.
fn text(value: &Value) -> Option<String> {
    let value = value.as_str()?.trim();
    (!value.is_empty() && value.len() <= MAX_TEXT && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

fn clip(value: &str, limit: usize) -> String {
    let single: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let single = single.trim();
    if single.chars().count() <= limit {
        return single.to_owned();
    }
    let mut clipped: String = single.chars().take(limit - 1).collect();
    clipped.push('…');
    clipped
}

fn program_name(command: &str) -> String {
    let name = command
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(command)
        .trim_end_matches(".exe");
    clip(name, 64)
}

fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    // Drop any user information before the host.
    let host = authority.rsplit('@').next()?;
    (!host.is_empty()).then(|| clip(host, 128))
}

/// Turns one finished command into its listing. The raw output is wiped here in every case.
pub fn listing_from_output(
    provider: &str,
    recipe: &ListingRecipe,
    output: Result<HelperOutput, String>,
    redact: &Redactor,
) -> FeatureListing {
    let command = display_command(provider, recipe);
    let failed = |reason: String| FeatureListing {
        feature: recipe.feature,
        state: ListingState::Failed { reason },
        command: Some(command.clone()),
        entries: Vec::new(),
        available: Vec::new(),
        available_total: 0,
    };
    let mut output = match output {
        Ok(output) => output,
        Err(reason) => return failed(format!("`{command}` could not start: {reason}")),
    };
    let first_stderr = output
        .stderr_tail
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("WARNING:"))
        .map(|line| {
            redact
                .redact_text(line)
                .chars()
                .take(200)
                .collect::<String>()
        });
    let code = output.exit.and_then(|exit| exit.code);
    let result = if output.timed_out {
        Err(format!(
            "`{command}` did not answer within {} seconds.",
            LISTING_TIMEOUT.as_secs()
        ))
    } else if output.stdout_truncated {
        Err(format!(
            "`{command}` printed more than {} MB.",
            LISTING_MAX_STDOUT / (1024 * 1024)
        ))
    } else if code != Some(0) {
        Err(match (first_stderr, code) {
            (Some(line), _) => format!("`{command}` failed: {line}"),
            (None, Some(code)) => format!("`{command}` failed with exit code {code}."),
            (None, None) => format!("`{command}` was stopped."),
        })
    } else {
        parse(recipe.parser, &output.stdout)
            .map_err(|()| format!("`{command}` printed output auracode could not read."))
    };
    // Codex prints MCP env and header values; nothing of the raw output outlives the parse.
    output.stdout.fill(0);
    output.stdout.clear();
    match result {
        Ok((entries, available, available_total)) => FeatureListing {
            feature: recipe.feature,
            state: ListingState::Live,
            command: Some(command),
            entries,
            available,
            available_total,
        },
        Err(reason) => failed(reason),
    }
}

/// One provider's listings with the installed version they were read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentListings {
    pub version: String,
    pub updated_at: aura_protocol::Millis,
    pub listings: Vec<FeatureListing>,
    /// Set on the read that followed a version change.
    pub version_change: Option<aura_protocol::plugins::VersionChange>,
}

/// Whether a cached listing can answer: the same installed version and no explicit refresh. A
/// different version means the harness was updated or replaced, so its plugins are read again.
pub fn cache_answers(cached: Option<&AgentListings>, version: &str, refresh: bool) -> bool {
    !refresh && cached.is_some_and(|cached| cached.version == version)
}

/// Runs every reviewed listing of one detected native installation, one at a time. A failed
/// command fails only its own feature.
pub(crate) async fn run_listings(
    installation: &AgentInstallation,
    env: Arc<ResolvedEnv>,
    registry: &LeftoverRegistry,
) -> Vec<FeatureListing> {
    let provider = crate::installation::provider_namespace(&installation.agent_id).to_owned();
    let recipes = recipes(&provider);
    if recipes.is_empty() {
        return Vec::new();
    }
    let unavailable = |reason: &str| {
        recipes
            .iter()
            .map(|recipe| FeatureListing {
                feature: recipe.feature,
                state: ListingState::Failed {
                    reason: reason.to_owned(),
                },
                command: Some(display_command(&provider, recipe)),
                entries: Vec::new(),
                available: Vec::new(),
                available_total: 0,
            })
            .collect::<Vec<_>>()
    };
    if installation.host != AgentHost::Native {
        return unavailable("auracode lists plugins only for agents installed on this computer.");
    }
    if crate::maintenance::check_unchanged(installation).is_err() {
        return unavailable("The installation changed since detection. Refresh agents.");
    }
    let (id, path, vars) = (
        installation.agent_id.clone(),
        std::path::PathBuf::from(&installation.launch_path),
        env.vars.clone(),
    );
    let Ok(Ok((program, prefix))) =
        tokio::task::spawn_blocking(move || crate::npm_entry::command(&id, &path, &vars)).await
    else {
        return unavailable("The agent's program could not be resolved.");
    };
    let home = env
        .vars
        .get(&EnvKey::from(if cfg!(windows) {
            "USERPROFILE"
        } else {
            "HOME"
        }))
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let redactor = Redactor::standard();
    redactor.set_secrets(secret_values(&env.vars));
    let mut listings = Vec::new();
    for recipe in recipes {
        let set = recipe
            .set
            .iter()
            .chain(&[("NO_COLOR", "1")])
            .map(|(key, value)| (OsString::from(*key), OsString::from(*value)))
            .collect();
        let output = run_helper(
            registry,
            HelperSpec {
                program: program.clone(),
                args: prefix
                    .iter()
                    .cloned()
                    .chain(recipe.args.iter().map(OsString::from))
                    .collect(),
                cwd: home.clone(),
                env: HelperEnv::Resolved(Arc::clone(&env)),
                set,
                new_session: false,
                timeout: LISTING_TIMEOUT,
                max_stdout: LISTING_MAX_STDOUT,
            },
        )
        .await
        .map_err(|error| error.to_string());
        listings.push(listing_from_output(&provider, recipe, output, &redactor));
    }
    listings
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_process::ExitInfo;

    fn ok(stdout: &str) -> Result<HelperOutput, String> {
        Ok(HelperOutput {
            exit: Some(ExitInfo {
                code: Some(0),
                signal: None,
                at_ms: 0,
            }),
            stdout: stdout.as_bytes().to_vec(),
            ..Default::default()
        })
    }
    fn run(provider: &str, feature: PluginFeature, stdout: &str) -> FeatureListing {
        let recipe = recipes(provider)
            .iter()
            .find(|recipe| recipe.feature == feature)
            .unwrap();
        listing_from_output(provider, recipe, ok(stdout), &Redactor::standard())
    }

    #[test]
    fn claude_plugins_and_marketplaces_parse_the_documented_json() {
        // Shapes recorded from Claude Code 2.1.312 with a local fixture marketplace.
        let listing = run(
            "claude",
            PluginFeature::Plugins,
            r#"{"installed":[{"id":"tools@local-team","version":"1.0.0","scope":"user","enabled":true,
              "installPath":"C:\\Users\\person\\.claude\\plugins\\cache\\local-team\\tools\\1.0.0"},
              {"id":"other@local-team","version":"0.2.0","scope":"project","enabled":false}],
              "available":[{"pluginId":"superpowers@anthropic-plugin-directory","name":"superpowers",
              "description":"Core skills library","marketplaceName":"anthropic-plugin-directory",
              "version":"6.4.2","source":{"source":"url","url":"https://github.com/obra/superpowers.git"}},
              {"pluginId":"bad\u0007@x","name":"bad"}]}"#,
        );
        assert_eq!(listing.state, ListingState::Live);
        assert_eq!(
            listing.command.as_deref(),
            Some("claude plugin list --json --available")
        );
        assert_eq!(listing.entries.len(), 2);
        let tools = &listing.entries[0];
        assert_eq!(
            (tools.key.as_str(), tools.label.as_str()),
            ("tools@local-team", "tools")
        );
        assert_eq!(tools.marketplace.as_deref(), Some("local-team"));
        assert_eq!(tools.enabled, Some(true));
        assert_eq!(listing.entries[1].enabled, Some(false));
        assert_eq!(listing.available_total, 2);
        assert_eq!(
            listing.available.len(),
            1,
            "the control character entry is skipped"
        );
        assert_eq!(listing.available[0].kind.as_deref(), Some("url"));
        assert!(
            !format!("{listing:?}").contains("person"),
            "no install path"
        );
        // An older build prints only the installed array.
        let older = run(
            "claude",
            PluginFeature::Plugins,
            r#"[{"id":"tools@team","enabled":true}]"#,
        );
        assert_eq!(older.entries.len(), 1);
        assert_eq!(older.available_total, 0);
        let markets = run(
            "claude",
            PluginFeature::Marketplaces,
            r#"[{"name":"local-team","source":"directory","path":"C:\\Users\\person\\market"},
              {"name":"team","source":"github","repo":"owner/plugins"}]"#,
        );
        assert_eq!(markets.entries[0].kind.as_deref(), Some("directory"));
        assert_eq!(markets.entries[0].description, None);
        assert_eq!(
            markets.entries[1].description.as_deref(),
            Some("owner/plugins")
        );
        assert!(!format!("{markets:?}").contains("person"));
    }

    #[test]
    fn codex_mcp_keeps_only_the_names_of_secret_fields() {
        // Codex 0.162.1 prints env values and headers in `codex mcp list --json`.
        let listing = run(
            "codex",
            PluginFeature::McpServers,
            r#"[{"name":"private","enabled":true,"transport":{"type":"stdio","command":"C:\\tools\\node.exe",
               "args":["server.js","--api-key","SYNTHETIC_ARG_SECRET"],"env":{"TOKEN":"SYNTHETIC_ENV_SECRET"},
               "env_vars":["PASSTHROUGH"],"cwd":null}},
              {"name":"remote","enabled":false,"transport":{"type":"streamable_http",
               "url":"https://user:SYNTHETIC_URL_SECRET@mcp.example.test/v1?key=SYNTHETIC_QUERY",
               "bearer_token_env_var":"MCP_TOKEN","http_headers":{"Authorization":"Bearer SYNTHETIC_HEADER"}}}]"#,
        );
        let text = format!("{listing:?}");
        for secret in [
            "SYNTHETIC_ARG_SECRET",
            "SYNTHETIC_ENV_SECRET",
            "SYNTHETIC_URL_SECRET",
            "SYNTHETIC_QUERY",
            "SYNTHETIC_HEADER",
        ] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
        assert_eq!(listing.entries[0].description.as_deref(), Some("node"));
        assert_eq!(
            listing.entries[0].local_fields,
            ["env/TOKEN", "env_vars/PASSTHROUGH"]
        );
        assert_eq!(
            listing.entries[1].description.as_deref(),
            Some("mcp.example.test")
        );
        assert_eq!(
            listing.entries[1].local_fields,
            ["bearer_token_env_var", "http_headers/Authorization"]
        );
        assert_eq!(listing.entries[1].enabled, Some(false));
    }

    #[test]
    fn codex_plugins_and_marketplaces_parse_the_documented_json() {
        let plugins = run(
            "codex",
            PluginFeature::Plugins,
            r#"{"installed":[{"pluginId":"tools@local-team","name":"tools","marketplaceName":"local-team",
               "version":"1.0.0","installed":true,"enabled":true,"source":{"source":"local","path":"C:\\x"}}],
               "available":[{"pluginId":"docs@openai","name":"docs","marketplaceName":"openai","installed":false}]}"#,
        );
        assert_eq!(plugins.entries[0].key, "tools@local-team");
        assert_eq!(plugins.entries[0].enabled, Some(true));
        assert!(!plugins.available[0].installed);
        let markets = run(
            "codex",
            PluginFeature::Marketplaces,
            r#"{"marketplaces":[{"name":"local-team","root":"C:\\Users\\person\\m"}]}"#,
        );
        assert_eq!(markets.entries[0].key, "local-team");
        assert!(!format!("{markets:?}").contains("person"));
    }

    #[test]
    fn pi_list_reads_both_scopes_and_hides_private_sources() {
        let listing = run(
            "pi",
            PluginFeature::Packages,
            "User packages:\n  npm:pi-tools@1.0.0\n  git:github.com/team/pi-ext@v1.2.0 (filtered)\n  \
             https://user:SYNTHETIC@example.test/private.git\nProject packages:\n  npm:@team/local@2.0.0\n",
        );
        let keys: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert_eq!(
            keys,
            [
                "npm:pi-tools@1.0.0",
                "git:github.com/team/pi-ext@v1.2.0",
                "Package 3 (private source)",
                "npm:@team/local@2.0.0"
            ]
        );
        assert_eq!(listing.entries[3].scope.as_deref(), Some("project"));
        assert!(listing.entries[1].description.is_some());
        assert!(!format!("{listing:?}").contains("SYNTHETIC"));
        assert!(
            run("pi", PluginFeature::Packages, "No packages installed.\n")
                .entries
                .is_empty()
        );
    }

    #[test]
    fn failures_have_a_defined_reason_and_never_quote_stdout() {
        let recipe = &recipes("claude")[0];
        let redactor = Redactor::standard();
        let failed = |output| listing_from_output("claude", recipe, output, &redactor);
        let timed_out = failed(Ok(HelperOutput {
            timed_out: true,
            ..Default::default()
        }));
        assert!(
            matches!(&timed_out.state, ListingState::Failed { reason } if reason.contains("20 seconds"))
        );
        let exit = failed(Ok(HelperOutput {
            exit: Some(ExitInfo {
                code: Some(1),
                signal: None,
                at_ms: 0,
            }),
            stdout: b"SYNTHETIC_STDOUT".to_vec(),
            stderr_tail: "error: unknown option '--available'\n".into(),
            ..Default::default()
        }));
        let ListingState::Failed { reason } = &exit.state else {
            panic!("failed");
        };
        assert!(reason.contains("unknown option"), "{reason}");
        assert!(!reason.contains("SYNTHETIC_STDOUT"));
        let garbage = failed(ok("not json"));
        assert!(
            matches!(&garbage.state, ListingState::Failed { reason } if reason.contains("could not read"))
        );
        let missing = failed(Err("not found".into()));
        assert!(matches!(&missing.state, ListingState::Failed { .. }));
        assert!(
            recipes("opencode").is_empty(),
            "OpenCode installs plugins at startup"
        );
        assert!(
            !recipes("claude")
                .iter()
                .chain(recipes("pi"))
                .any(|recipe| recipe.args.contains(&"mcp")),
            "MCP health checks start servers"
        );
    }
}
