//! The Plugin library, one section per agent: what that agent supports, read from its own CLI
//! where it has a reviewed machine-readable listing (aura-agents) and from its files otherwise
//! (aura-config), with the harness status detection computed and the device's sync switch.
//! Assembly is pure; [`SessionManager::plugin_library`] gathers the facts.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aura_agents::plugins::AgentListings;
use aura_config::{Inventory, Item, Kind, Provider, extensions::Extensions};
use aura_process::EnvKey;
use aura_protocol::plugins::{
    AgentPlugins, AgentSync, FeatureListing, HarnessStatus, ListingState, PluginEntry,
    PluginFeature, PluginLibrary, PluginLibraryRef, PluginSystem,
};
use aura_protocol::session::{AgentEntry, Availability};

use super::{SessionError, SessionManager};

/// Everything one Plugin library answer is built from.
#[derive(Default)]
pub struct PluginFacts {
    pub agents: Vec<AgentEntry>,
    /// Per provider namespace; absent when the agent is not installed or has no listing commands.
    pub listings: BTreeMap<String, AgentListings>,
    pub inventory: Inventory,
    /// Per provider namespace, including `opencode`.
    pub extensions: BTreeMap<String, Extensions>,
    /// The Account workspace is open, so configuration sync can run.
    pub sync_available: bool,
    pub paused: Vec<String>,
}

const SKILLS: &str = "No CLI lists skills, so these come from the agent's skills folder.";
const FOLDER: &str = "The CLI has no listing for these, so they come from the agent's folder.";

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Skill => "skill",
        Kind::Instructions => "instructions",
        Kind::McpServer => "mcp_server",
        Kind::Plugin => "plugin",
        Kind::Package => "package",
    }
}

fn from_item(item: &Item) -> PluginEntry {
    PluginEntry {
        key: item.item.key.clone(),
        label: item.label.clone(),
        description: None,
        version: None,
        marketplace: item
            .item
            .key
            .split_once('@')
            .map(|(_, market)| market.to_owned())
            .filter(|_| item.item.kind == Kind::Plugin),
        scope: Some(
            if item.provider == Provider::Shared {
                "shared"
            } else {
                "user"
            }
            .into(),
        ),
        enabled: None,
        installed: true,
        kind: None,
        local_fields: Vec::new(),
        library: Some(PluginLibraryRef {
            source_id: item.item.source_id.clone(),
            kind: kind_name(item.item.kind).into(),
            key: item.item.key.clone(),
            revision: item.revision.clone(),
        }),
    }
}

fn named(key: &str) -> PluginEntry {
    PluginEntry {
        key: key.into(),
        label: key.into(),
        description: None,
        version: None,
        marketplace: None,
        scope: Some("user".into()),
        enabled: None,
        installed: true,
        kind: None,
        local_fields: Vec::new(),
        library: None,
    }
}

fn items(inventory: &Inventory, providers: &[Provider], kind: Kind) -> Vec<PluginEntry> {
    inventory
        .items
        .iter()
        .filter(|item| {
            item.item.kind == kind
                && providers.contains(&item.provider)
                && item.scope == aura_config::Scope::User
        })
        .map(from_item)
        .collect()
}

fn files(feature: PluginFeature, reason: &str, entries: Vec<PluginEntry>) -> FeatureListing {
    FeatureListing {
        feature,
        state: ListingState::Files {
            reason: reason.into(),
        },
        command: None,
        entries,
        available: Vec::new(),
        available_total: 0,
    }
}

/// The CLI's listing when it ran; its files when it failed (keeping the failure) or never ran.
fn live_or_files(
    listings: Option<&AgentListings>,
    feature: PluginFeature,
    fallback: Vec<PluginEntry>,
    not_run: &str,
) -> FeatureListing {
    let Some(listing) = listings.and_then(|listings| {
        listings
            .listings
            .iter()
            .find(|listing| listing.feature == feature)
    }) else {
        return files(feature, not_run, fallback);
    };
    let mut listing = listing.clone();
    if matches!(listing.state, ListingState::Failed { .. }) && listing.entries.is_empty() {
        listing.entries = fallback;
    } else {
        // Link live rows to their file items so they can open their preview and copy review.
        for entry in &mut listing.entries {
            if entry.library.is_none() {
                entry.library = fallback
                    .iter()
                    .find(|item| item.key == entry.key)
                    .and_then(|item| item.library.clone());
            }
        }
    }
    listing
}

fn sync(facts: &PluginFacts, agent: &str, supported: bool) -> AgentSync {
    if !supported {
        return AgentSync::Unsupported {
            reason: "Configuration sync covers Claude Code, Codex and Pi.".into(),
        };
    }
    if !facts.sync_available {
        return AgentSync::Unsupported {
            reason: "Open your Account workspace to sync across devices.".into(),
        };
    }
    if facts.paused.iter().any(|paused| paused == agent) {
        AgentSync::Off
    } else {
        AgentSync::On
    }
}

pub fn assemble(facts: &PluginFacts) -> PluginLibrary {
    let entry = |id: &str| facts.agents.iter().find(|agent| agent.id == id);
    let ext = |id: &str| facts.extensions.get(id).cloned().unwrap_or_default();
    let mut library = PluginLibrary::default();
    for (id, name) in [
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("pi", "Pi"),
        ("opencode", "OpenCode"),
    ] {
        let agent = entry(id);
        let installed =
            agent.is_some_and(|agent| matches!(agent.availability, Availability::Ready { .. }));
        let version = agent
            .and_then(|agent| agent.installation.as_ref())
            .map(|installation| installation.version.clone());
        let harness = agent
            .and_then(|agent| agent.harness.clone())
            .unwrap_or(if agent.is_some() {
                HarnessStatus::Checking
            } else {
                HarnessStatus::NotInstalled
            });
        let listings = facts.listings.get(id);
        let extensions = ext(id);
        let not_run = if installed {
            "The agent's listing did not run. These come from its folder."
        } else {
            "Not installed on this device. These come from its folder, if any."
        };
        let (system, summary, features, supported) = match id {
            "claude" => (
                PluginSystem::Marketplace,
                "Plugins from marketplaces, plus skills, MCP servers, slash commands, subagents and hooks.",
                vec![
                    live_or_files(
                        listings,
                        PluginFeature::Plugins,
                        items(&facts.inventory, &[Provider::Claude], Kind::Plugin),
                        not_run,
                    ),
                    live_or_files(
                        listings,
                        PluginFeature::Marketplaces,
                        extensions
                            .marketplaces
                            .iter()
                            .map(|name| named(name))
                            .collect(),
                        not_run,
                    ),
                    files(
                        PluginFeature::Skills,
                        SKILLS,
                        items(&facts.inventory, &[Provider::Claude], Kind::Skill),
                    ),
                    files(
                        PluginFeature::McpServers,
                        "`claude mcp list` connects to every server to check it, so these come from ~/.claude.json.",
                        items(&facts.inventory, &[Provider::Claude], Kind::McpServer),
                    ),
                    files(
                        PluginFeature::Commands,
                        FOLDER,
                        extensions.commands.iter().map(|name| named(name)).collect(),
                    ),
                    files(
                        PluginFeature::Subagents,
                        FOLDER,
                        extensions
                            .subagents
                            .iter()
                            .map(|name| named(name))
                            .collect(),
                    ),
                    files(
                        PluginFeature::Hooks,
                        FOLDER,
                        extensions.hooks.iter().map(|name| named(name)).collect(),
                    ),
                ],
                true,
            ),
            "codex" => (
                PluginSystem::Marketplace,
                "Plugins from marketplaces, plus MCP servers, skills, subagents and hooks.",
                vec![
                    live_or_files(
                        listings,
                        PluginFeature::Plugins,
                        items(&facts.inventory, &[Provider::Codex], Kind::Plugin),
                        not_run,
                    ),
                    live_or_files(
                        listings,
                        PluginFeature::Marketplaces,
                        extensions
                            .marketplaces
                            .iter()
                            .map(|name| named(name))
                            .collect(),
                        not_run,
                    ),
                    live_or_files(
                        listings,
                        PluginFeature::McpServers,
                        items(&facts.inventory, &[Provider::Codex], Kind::McpServer),
                        not_run,
                    ),
                    files(
                        PluginFeature::Skills,
                        SKILLS,
                        items(
                            &facts.inventory,
                            &[Provider::Codex, Provider::Shared],
                            Kind::Skill,
                        ),
                    ),
                    files(
                        PluginFeature::Subagents,
                        FOLDER,
                        extensions
                            .subagents
                            .iter()
                            .map(|name| named(name))
                            .collect(),
                    ),
                    files(
                        PluginFeature::Hooks,
                        FOLDER,
                        extensions.hooks.iter().map(|name| named(name)).collect(),
                    ),
                ],
                true,
            ),
            "pi" => (
                PluginSystem::Packages,
                "Pi has no plugin marketplace. It installs packages from npm or git, and reads skills, MCP servers and prompt templates from its folder.",
                vec![
                    live_or_files(
                        listings,
                        PluginFeature::Packages,
                        items(&facts.inventory, &[Provider::Pi], Kind::Package),
                        not_run,
                    ),
                    files(
                        PluginFeature::Skills,
                        SKILLS,
                        items(&facts.inventory, &[Provider::Pi], Kind::Skill),
                    ),
                    files(
                        PluginFeature::McpServers,
                        "`pi mcp list` starts every server to check it, so these come from mcp.json.",
                        items(&facts.inventory, &[Provider::Pi], Kind::McpServer),
                    ),
                    files(
                        PluginFeature::Commands,
                        FOLDER,
                        extensions.commands.iter().map(|name| named(name)).collect(),
                    ),
                ],
                true,
            ),
            _ => {
                const OPENCODE: &str = "OpenCode installs its plugins and checks its servers whenever it runs, so auracode reads ~/.config/opencode instead.";
                let servers = extensions
                    .servers
                    .iter()
                    .map(|server| PluginEntry {
                        kind: server.kind.clone(),
                        enabled: server.enabled,
                        local_fields: server.local_fields.clone(),
                        ..named(&server.name)
                    })
                    .collect();
                (
                    PluginSystem::Declared,
                    "OpenCode loads npm plugins named in its config and local plugin files, plus MCP servers, skills, commands and agents.",
                    vec![
                        files(
                            PluginFeature::Plugins,
                            OPENCODE,
                            extensions.plugins.iter().map(|name| named(name)).collect(),
                        ),
                        files(PluginFeature::McpServers, OPENCODE, servers),
                        files(
                            PluginFeature::Skills,
                            OPENCODE,
                            extensions.skills.iter().map(|name| named(name)).collect(),
                        ),
                        files(
                            PluginFeature::Commands,
                            OPENCODE,
                            extensions.commands.iter().map(|name| named(name)).collect(),
                        ),
                        files(
                            PluginFeature::Subagents,
                            OPENCODE,
                            extensions
                                .subagents
                                .iter()
                                .map(|name| named(name))
                                .collect(),
                        ),
                    ],
                    false,
                )
            }
        };
        library.agents.push(AgentPlugins {
            agent_id: id.into(),
            name: name.into(),
            installed,
            version,
            system,
            summary: summary.into(),
            features,
            harness,
            updated_at: listings.map(|listings| listings.updated_at),
            version_change: listings.and_then(|listings| listings.version_change.clone()),
            sync: sync(facts, id, supported),
            notices: extensions.notices.clone(),
        });
    }
    library
        .notices
        .extend(facts.inventory.notices.iter().cloned());
    library.notices.push(
        "Cursor, Grok Build, Antigravity and Hermes are not listed: auracode has no reviewed way to read their extensions yet.".into(),
    );
    library
}

/// OpenCode's global folder: `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`, on every OS.
fn opencode_root(env: &aura_process::EnvMap) -> Option<PathBuf> {
    let variable = |key: &str| {
        env.get(&EnvKey::from(key))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    };
    variable("XDG_CONFIG_HOME")
        .map(|config| config.join("opencode"))
        .or_else(|| {
            if cfg!(windows) {
                variable("USERPROFILE").or_else(|| variable("HOME"))
            } else {
                variable("HOME")
            }
            .map(|home| home.join(".config").join("opencode"))
        })
}

impl SessionManager {
    /// The Plugin library. `refresh` probes the agents again and reruns every listing; otherwise
    /// a listing is reused unless its agent's installed version changed since it was read.
    pub async fn plugin_library(
        &self,
        refresh: bool,
        sync_available: bool,
        paused: Vec<String>,
    ) -> Result<PluginLibrary, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let agents = self.agents(refresh).await;
        let now = crate::time::now_millis();
        let mut listings = BTreeMap::new();
        for id in ["claude", "codex", "pi"] {
            if let Some(listing) = self.deps().detector.plugin_listings(id, refresh, now).await {
                listings.insert(id.to_owned(), listing);
            }
        }
        let roots = self.config_library_roots(None).await?;
        let env = self.deps().env.get().await;
        let opencode = opencode_root(&env.vars);
        let (inventory, extensions) = self
            .deps()
            .rt
            .spawn_blocking(move || {
                let inventory = aura_config::Library::new(roots.sources.clone())
                    .map(|library| library.inspect())
                    .unwrap_or_default();
                let mut extensions = BTreeMap::new();
                for source in &roots.sources {
                    if source.scope != aura_config::Scope::User || source.claude_state_only {
                        continue;
                    }
                    let id = match source.provider {
                        Provider::Claude => "claude",
                        Provider::Codex => "codex",
                        Provider::Pi => "pi",
                        Provider::Shared => continue,
                    };
                    extensions.insert(
                        id.to_owned(),
                        aura_config::extensions::inspect(source.provider, &source.root),
                    );
                }
                if let Some(root) = opencode {
                    extensions.insert(
                        "opencode".to_owned(),
                        aura_config::extensions::inspect_opencode(Path::new(&root)),
                    );
                }
                (inventory, extensions)
            })
            .await
            .map_err(|_| SessionError::Internal("The Plugin library could not be read.".into()))?;
        Ok(assemble(&PluginFacts {
            agents,
            listings,
            inventory,
            extensions,
            sync_available,
            paused,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::agents::{
        AgentHost, AgentInstallation, InstallChannel, VersionVerification,
    };

    fn agent(id: &str, version: Option<&str>, harness: Option<HarnessStatus>) -> AgentEntry {
        AgentEntry {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            availability: match version {
                Some(version) => Availability::Ready {
                    version: Some(version.into()),
                    path: format!("/bin/{id}"),
                },
                None => Availability::Missing {
                    reason: "not found".into(),
                },
            },
            launch: String::new(),
            needs_download: false,
            last_verified: String::new(),
            installation: version.map(|version| AgentInstallation {
                agent_id: id.into(),
                provider: id.into(),
                host: AgentHost::Native,
                launch_path: format!("/bin/{id}"),
                resolved_path: None,
                version: version.into(),
                channel: InstallChannel::VendorStandalone,
                verification: VersionVerification::Unknown,
            }),
            latest_release: None,
            harness,
            connections: None,
        }
    }

    fn listing(feature: PluginFeature, state: ListingState, keys: &[&str]) -> FeatureListing {
        FeatureListing {
            feature,
            state,
            command: Some("claude plugin list --json --available".into()),
            entries: keys.iter().map(|key| named(key)).collect(),
            available: Vec::new(),
            available_total: 0,
        }
    }

    #[test]
    fn each_agent_gets_its_own_section_with_what_it_supports() {
        let mut facts = PluginFacts {
            agents: vec![
                agent(
                    "claude",
                    Some("2.1.312"),
                    Some(HarnessStatus::UpdateAvailable {
                        version: "2.1.312".into(),
                        latest: "2.1.314".into(),
                        source: "npm latest".into(),
                        checked_at: Some(1),
                    }),
                ),
                agent("codex", Some("0.162.1"), None),
                agent("pi", None, Some(HarnessStatus::NotInstalled)),
            ],
            sync_available: true,
            paused: vec!["codex".into()],
            ..Default::default()
        };
        facts.listings.insert(
            "claude".into(),
            AgentListings {
                version: "2.1.312".into(),
                updated_at: 42,
                listings: vec![
                    listing(PluginFeature::Plugins, ListingState::Live, &["tools@team"]),
                    listing(
                        PluginFeature::Marketplaces,
                        ListingState::Failed {
                            reason: "`claude plugin marketplace list --json` failed.".into(),
                        },
                        &[],
                    ),
                ],
                version_change: Some(aura_protocol::plugins::VersionChange {
                    from: "2.1.310".into(),
                    to: "2.1.312".into(),
                }),
            },
        );
        facts.extensions.insert(
            "claude".into(),
            Extensions {
                marketplaces: vec!["team".into()],
                hooks: vec!["PreToolUse".into()],
                ..Default::default()
            },
        );
        let library = assemble(&facts);
        let ids: Vec<_> = library
            .agents
            .iter()
            .map(|agent| agent.agent_id.as_str())
            .collect();
        assert_eq!(ids, ["claude", "codex", "pi", "opencode"]);
        let claude = &library.agents[0];
        assert_eq!(claude.updated_at, Some(42));
        assert!(claude.version_change.is_some());
        assert!(matches!(
            claude.harness,
            HarnessStatus::UpdateAvailable { .. }
        ));
        assert_eq!(claude.sync, AgentSync::On);
        let feature = |agent: &AgentPlugins, feature| {
            agent
                .features
                .iter()
                .find(|listing| listing.feature == feature)
                .unwrap()
                .clone()
        };
        assert_eq!(
            feature(claude, PluginFeature::Plugins).state,
            ListingState::Live
        );
        // A failed listing keeps its reason and falls back to the declared names.
        let markets = feature(claude, PluginFeature::Marketplaces);
        assert!(matches!(markets.state, ListingState::Failed { .. }));
        assert_eq!(markets.entries[0].key, "team");
        assert!(matches!(
            feature(claude, PluginFeature::McpServers).state,
            ListingState::Files { .. }
        ));
        assert_eq!(
            feature(claude, PluginFeature::Hooks).entries[0].key,
            "PreToolUse"
        );
        let codex = &library.agents[1];
        assert_eq!(codex.sync, AgentSync::Off);
        assert_eq!(codex.harness, HarnessStatus::Checking);
        let pi = &library.agents[2];
        assert_eq!(pi.system, PluginSystem::Packages);
        assert!(pi.summary.starts_with("Pi has no plugin marketplace"));
        assert!(!pi.installed);
        assert!(
            pi.features
                .iter()
                .all(|listing| !matches!(listing.state, ListingState::Live))
        );
        let opencode = &library.agents[3];
        assert_eq!(opencode.harness, HarnessStatus::NotInstalled);
        assert!(matches!(opencode.sync, AgentSync::Unsupported { .. }));
        // Without an Account workspace no agent offers a sync switch.
        facts.sync_available = false;
        assert!(
            assemble(&facts)
                .agents
                .iter()
                .all(|agent| matches!(agent.sync, AgentSync::Unsupported { .. }))
        );
    }
}
