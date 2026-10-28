//! Per-agent configuration sync across devices: every edge case the Plugin library promises has
//! a defined behaviour here, on temporary agent homes with a synthetic account port.
#![allow(clippy::unwrap_used)]
mod common;
use aura_config::{Provider, Scope, Source, sync::*};
use common::{Journal, Managed, Port};
use serde_json::json;
use std::{fs, path::Path};

struct Device {
    temp: tempfile::TempDir,
}
impl Device {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        for dir in ["claude", "codex", "home"] {
            fs::create_dir_all(temp.path().join(dir)).unwrap();
        }
        Self { temp }
    }
    fn root(&self, name: &str) -> std::path::PathBuf {
        self.temp.path().join(name)
    }
    fn scanner(&self, sources: &[(Provider, bool, Option<&str>, bool)]) -> ConfigScanner {
        ConfigScanner::new(
            sources
                .iter()
                .map(|(provider, installed, version, paused)| ConfigSource {
                    source: Source {
                        id: format!("user:{provider:?}"),
                        provider: *provider,
                        scope: Scope::User,
                        root: self.root(match provider {
                            Provider::Claude => "claude",
                            _ => "codex",
                        }),
                        claude_state_only: false,
                    },
                    installed: *installed,
                    version: version.map(Into::into),
                    paused: *paused,
                })
                .collect(),
            self.root("home"),
            ConfigScope::Windows,
        )
        .unwrap()
    }
    fn codex(&self) -> ConfigScanner {
        self.scanner(&[(Provider::Codex, true, Some("0.162.1"), false)])
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.temp.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.temp.path().join(path)).unwrap()
    }
}

fn identity(provider: Provider, format: ConfigFormat, path: &str, keys: &[&str]) -> ConfigIdentity {
    ConfigIdentity {
        provider,
        scope: ConfigScope::Portable,
        format,
        path: path.into(),
        keys: keys.iter().map(|key| (*key).into()).collect(),
    }
}
fn file(provider: Provider, path: &str, text: &str) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        identity: identity(provider, ConfigFormat::File, path, &[]),
        content: Some(ConfigContent::Files(
            [(
                String::new(),
                ConfigFile {
                    bytes: text.as_bytes().to_vec(),
                    executable: false,
                },
            )]
            .into(),
        )),
        local_fields: Vec::new(),
    }
}
fn value(identity: ConfigIdentity, value: serde_json::Value) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        identity,
        content: Some(ConfigContent::Value(value)),
        local_fields: Vec::new(),
    }
}
async fn item(port: &Port, scanner: &ConfigScanner, id: &str) -> ConfigSyncItem {
    inventory(port, scanner, scanner.scan(), None)
        .await
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.id == id)
        .unwrap()
}
/// Links this device's copy as the base both devices start from.
async fn link(port: &Port, scanner: &ConfigScanner, id: &str) {
    let review = prepare_review(port, scanner, id, ConfigChoice::Automatic)
        .await
        .unwrap();
    review.complete(port, scanner).await.unwrap();
}

#[tokio::test]
async fn an_agent_missing_here_keeps_its_items_pending_and_shown() {
    let device = Device::new();
    let scanner = device.scanner(&[(Provider::Codex, false, None, false)]);
    let port = Port::default();
    let remote = file(Provider::Codex, "rules/team.rules", "allow git\n");
    let id = remote.identity.id().unwrap();
    port.remote(&remote);
    let shown = item(&port, &scanner, &id).await;
    assert_eq!(shown.operation, ConfigOperation::Wait);
    assert_eq!(shown.hold, Some(ConfigHold::AgentMissing));
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert!(!review.preview.can_apply);
    assert!(
        review
            .preview
            .warnings
            .iter()
            .any(|w| w.contains("not installed"))
    );
    assert!(!device.root("codex/rules").exists());
    assert_eq!(port.0.lock().unwrap().writes, 0);
}

#[tokio::test]
async fn a_paused_agent_neither_publishes_nor_applies() {
    let device = Device::new();
    device.write("codex/rules/local.rules", "allow ls\n");
    let scanner = device.scanner(&[(Provider::Codex, true, Some("0.162.1"), true)]);
    let scan = scanner.scan();
    assert!(scan.items.is_empty(), "nothing is offered for publication");
    assert!(
        scan.skipped
            .iter()
            .any(|skip| skip.reason.contains("Sync is off"))
    );
    let port = Port::default();
    let remote = file(Provider::Codex, "rules/team.rules", "allow git\n");
    let id = remote.identity.id().unwrap();
    port.remote(&remote);
    assert_eq!(
        item(&port, &scanner, &id).await.hold,
        Some(ConfigHold::SyncPaused)
    );
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::UseRemote)
        .await
        .unwrap();
    assert!(!review.preview.can_apply);
    assert!(!device.root("codex/rules/team.rules").exists());
}

#[tokio::test]
async fn an_older_agent_holds_a_plugin_with_its_reason() {
    let device = Device::new();
    let scanner = device.scanner(&[(Provider::Codex, true, Some("0.150.0"), false)]);
    let port = Port::default();
    let plugin = value(
        identity(
            Provider::Codex,
            ConfigFormat::Toml,
            "config.toml",
            &["plugins", "tools@team", "enabled"],
        ),
        json!(true),
    );
    let id = plugin.identity.id().unwrap();
    port.remote(&plugin);
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert_eq!(
        review.preview.item.hold,
        Some(ConfigHold::NeedsVersion {
            feature: "plugins".into(),
            minimum: "0.162.1".into(),
            found: Some("0.150.0".into()),
        })
    );
    assert!(!review.preview.can_apply);
    assert!(review.preview.vendor_steps.is_empty());
    assert!(
        review
            .preview
            .warnings
            .iter()
            .any(|w| w.contains("0.162.1"))
    );
    assert!(version_at_least("codex-cli 0.162.1", "0.162.1"));
    assert!(!version_at_least("unknown", "0.162.1"));
}

#[tokio::test]
async fn a_missing_marketplace_is_offered_in_the_review_from_the_synced_source() {
    let device = Device::new();
    let port = Port::default();
    // Claude: the other device declared the marketplace from GitHub and enabled its plugin.
    let scanner = device.scanner(&[(Provider::Claude, true, Some("2.1.312"), false)]);
    port.remote(&value(
        identity(
            Provider::Claude,
            ConfigFormat::Json,
            "settings.json",
            &["extraKnownMarketplaces", "team"],
        ),
        json!({"source": {"source": "github", "repo": "owner/plugins"}}),
    ));
    let plugin = value(
        identity(
            Provider::Claude,
            ConfigFormat::Json,
            "settings.json",
            &["enabledPlugins", "tools@team"],
        ),
        json!(true),
    );
    let id = plugin.identity.id().unwrap();
    port.remote(&plugin);
    assert!(matches!(
        item(&port, &scanner, &id).await.hold,
        Some(ConfigHold::MarketplaceMissing { .. })
    ));
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert_eq!(
        review.preview.item.hold,
        Some(ConfigHold::MarketplaceMissing {
            marketplace: "team".into(),
            source: Some("owner/plugins".into()),
        })
    );
    let steps: Vec<_> = review
        .preview
        .vendor_steps
        .iter()
        .map(|step| (step.kind, step.target.as_str()))
        .collect();
    assert_eq!(
        steps,
        [
            (ConfigVendorKind::Marketplace, "owner/plugins"),
            (ConfigVendorKind::Plugin, "tools@team")
        ]
    );
    assert!(
        !review.preview.can_apply,
        "only the agent's installer applies it"
    );
    // Codex: a marketplace added from a local folder elsewhere has no source to offer.
    let codex = device.codex();
    port.remote(&value(
        identity(
            Provider::Codex,
            ConfigFormat::Toml,
            "config.toml",
            &["marketplaces", "local", "source"],
        ),
        json!("C:/Users/other/market"),
    ));
    let local_plugin = value(
        identity(
            Provider::Codex,
            ConfigFormat::Toml,
            "config.toml",
            &["plugins", "tools@local", "enabled"],
        ),
        json!(true),
    );
    port.remote(&local_plugin);
    let review = prepare_review(
        &port,
        &codex,
        &local_plugin.identity.id().unwrap(),
        ConfigChoice::Automatic,
    )
    .await
    .unwrap();
    assert_eq!(
        review.preview.item.hold,
        Some(ConfigHold::MarketplaceMissing {
            marketplace: "local".into(),
            source: None
        })
    );
    // Once the marketplace is added here, only the install remains.
    device.write(
        "codex/config.toml",
        "[marketplaces.local]\nsource_type = 'local'\nsource = 'C:/m'\n",
    );
    let review = prepare_review(
        &port,
        &codex,
        &local_plugin.identity.id().unwrap(),
        ConfigChoice::Automatic,
    )
    .await
    .unwrap();
    assert_eq!(review.preview.item.hold, Some(ConfigHold::VendorInstall));
    assert_eq!(review.preview.vendor_steps.len(), 1);
}

#[tokio::test]
async fn a_failed_plugin_install_restores_that_item_and_keeps_the_others() {
    let device = Device::new();
    let before = r#"{"model":"opus","extraKnownMarketplaces":{"team":{"source":{"source":"github","repo":"owner/plugins"}}}}"#;
    device.write("claude/settings.json", before);
    let scanner = device.scanner(&[(Provider::Claude, true, Some("2.1.312"), false)]);
    let port = Port::default();
    let journal = Journal::default();
    let plugin = value(
        identity(
            Provider::Claude,
            ConfigFormat::Json,
            "settings.json",
            &["enabledPlugins", "tools@team"],
        ),
        json!(true),
    );
    let id = plugin.identity.id().unwrap();
    port.remote(&plugin);
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert_eq!(review.preview.vendor_steps.len(), 1);
    // The installer wrote the declaration, then failed.
    device.write(
        "claude/settings.json",
        r#"{"model":"opus","extraKnownMarketplaces":{"team":{"source":{"source":"github","repo":"owner/plugins"}}},"enabledPlugins":{"tools@team":true}}"#,
    );
    let outcome = review
        .finish_vendor(
            &port,
            &scanner,
            &journal,
            false,
            Some("The install exited with code 1.".into()),
        )
        .await
        .unwrap();
    assert!(!outcome.completed);
    assert!(outcome.message.contains("code 1"), "{}", outcome.message);
    assert!(outcome.message.contains("restored"), "{}", outcome.message);
    let settings: serde_json::Value =
        serde_json::from_str(&device.read("claude/settings.json")).unwrap();
    assert!(
        settings.pointer("/enabledPlugins/tools@team").is_none(),
        "{settings}"
    );
    assert_eq!(settings["model"], "opus", "other settings are untouched");
    assert!(port.skipped(&id).unwrap().contains("code 1"));
    assert_eq!(
        item(&port, &scanner, &id).await.hold,
        Some(ConfigHold::Retained {
            reason: port.skipped(&id).unwrap()
        })
    );
    // A later install that succeeds is acknowledged like any applied item.
    let retry = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    device.write(
        "claude/settings.json",
        r#"{"model":"opus","extraKnownMarketplaces":{"team":{"source":{"source":"github","repo":"owner/plugins"}}},"enabledPlugins":{"tools@team":true}}"#,
    );
    let done = retry
        .finish_vendor(&port, &scanner, &journal, true, None)
        .await
        .unwrap();
    assert!(done.completed, "{}", done.message);
    assert_eq!(port.skipped(&id), None);
    assert_eq!(
        item(&port, &scanner, &id).await.operation,
        ConfigOperation::InSync
    );
}

#[tokio::test]
async fn os_specific_commands_and_missing_paths_are_never_applied() {
    let device = Device::new();
    let scanner = device.codex();
    let port = Port::default();
    let mut mac = value(
        identity(
            Provider::Codex,
            ConfigFormat::Mcp,
            "config.toml",
            &["mac-tool"],
        ),
        json!({"command": "/Users/person/bin/tool", "args": []}),
    );
    mac.identity.scope = ConfigScope::Macos;
    let mac_id = mac.identity.id().unwrap();
    port.remote(&mac);
    let review = prepare_review(&port, &scanner, &mac_id, ConfigChoice::UseRemote)
        .await
        .unwrap();
    assert_eq!(
        review.preview.item.hold,
        Some(ConfigHold::DeviceSpecific {
            platform: ConfigScope::Macos
        })
    );
    assert!(!review.preview.can_apply);
    let missing = value(
        identity(
            Provider::Codex,
            ConfigFormat::Mcp,
            "config.toml",
            &["home-tool"],
        ),
        json!({"command": "~/bin/missing-tool", "args": []}),
    );
    let missing_id = missing.identity.id().unwrap();
    port.remote(&missing);
    let review = prepare_review(&port, &scanner, &missing_id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert_eq!(
        review.preview.item.hold,
        Some(ConfigHold::MissingPath {
            path: "~/bin/missing-tool".into()
        })
    );
    assert!(!review.preview.can_apply);
    // Once the program exists on this device the same server applies.
    device.write("home/bin/missing-tool", "fixture program, never run");
    let review = prepare_review(&port, &scanner, &missing_id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert_eq!(review.preview.item.hold, None);
    assert!(review.preview.can_apply);
    assert!(
        !device.root("codex/config.toml").exists(),
        "nothing written by a review"
    );
}

#[tokio::test]
async fn secrets_in_mcp_env_and_headers_never_leave_the_device() {
    let device = Device::new();
    device.write(
        "codex/config.toml",
        "[mcp_servers.private]\ncommand = 'node'\nargs = ['s.js']\n[mcp_servers.private.env]\nTOKEN = 'SYNTHETIC_ENV_SECRET'\n[mcp_servers.remote]\nurl = 'https://mcp.example.test'\n[mcp_servers.remote.http_headers]\nX-Key = 'SYNTHETIC_HEADER_SECRET'\n",
    );
    let scanner = device.codex();
    let port = Port::default();
    for (id, _) in scanner.scan().items {
        link(&port, &scanner, &id).await;
    }
    let published = String::from_utf8_lossy(&port.all_bytes()).into_owned();
    assert!(
        published.contains("env/TOKEN"),
        "the name travels: {published}"
    );
    assert!(!published.contains("SYNTHETIC_ENV_SECRET"));
    assert!(!published.contains("SYNTHETIC_HEADER_SECRET"));
}

#[tokio::test]
async fn conflicts_removals_and_offline_have_defined_states() {
    let device = Device::new();
    device.write("codex/rules/team.rules", "allow ls\n");
    let scanner = device.codex();
    let port = Port::default();
    let local = file(Provider::Codex, "rules/team.rules", "allow ls\n");
    let id = local.identity.id().unwrap();
    link(&port, &scanner, &id).await;
    // Both devices changed the same item: the existing conflict review.
    device.write("codex/rules/team.rules", "allow ls\nallow cat\n");
    port.remote(&file(Provider::Codex, "rules/team.rules", "deny ls\n"));
    let conflicted = item(&port, &scanner, &id).await;
    assert!(matches!(
        conflicted.operation,
        ConfigOperation::Conflict | ConfigOperation::Merge
    ));
    // Removed upstream: this device still matches the base and the other removed it.
    device.write("codex/rules/team.rules", "deny ls\n");
    link(&port, &scanner, &id).await;
    port.remote(&ConfigSnapshot::tombstone(local.identity.clone()));
    let removed = item(&port, &scanner, &id).await;
    assert!(removed.removed_upstream);
    let review = prepare_review(&port, &scanner, &id, ConfigChoice::Automatic)
        .await
        .unwrap();
    assert!(
        review.preview.deletes_item,
        "the removal needs its confirmed review"
    );
    // Offline: local items are listed, held, and nothing is written.
    let writes = port.0.lock().unwrap().writes;
    port.0.lock().unwrap().offline = true;
    let view = inventory(&port, &scanner, scanner.scan(), None)
        .await
        .unwrap();
    assert!(view.offline);
    assert!(
        view.items
            .iter()
            .all(|item| item.hold == Some(ConfigHold::Offline))
    );
    assert_eq!(port.0.lock().unwrap().writes, writes);
    assert!(Path::new(&device.root("codex/rules/team.rules")).exists());
}

#[tokio::test]
async fn applying_one_agent_is_atomic_per_item_and_a_failure_keeps_the_others() {
    let device = Device::new();
    device.write("codex/rules/a.rules", "allow a\n");
    device.write("codex/rules/b.rules", "allow b\n");
    let scanner = device.codex();
    let port = Port::default();
    let store = Managed::default();
    let journal = Journal::default();
    let ids: Vec<_> = scanner.scan().items.into_keys().collect();
    for id in &ids {
        link(&port, &scanner, id).await;
    }
    port.remote(&file(
        Provider::Codex,
        "rules/a.rules",
        "allow a\nallow a2\n",
    ));
    port.remote(&file(
        Provider::Codex,
        "rules/b.rules",
        "allow b\nallow b2\n",
    ));
    // The second item's transaction cannot record its receipt, so it never writes.
    *journal.fail_after.lock().unwrap() = Some(1);
    let outcomes = automatic::apply_agent(
        &port,
        &scanner,
        &journal,
        &store,
        Provider::Codex,
        &Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(outcomes.len(), 2);
    assert_eq!(
        outcomes.iter().filter(|outcome| outcome.completed).count(),
        1
    );
    let failed = outcomes.iter().find(|outcome| !outcome.completed).unwrap();
    assert!(!failed.message.is_empty());
    let texts = [
        device.read("codex/rules/a.rules"),
        device.read("codex/rules/b.rules"),
    ];
    assert_eq!(
        texts
            .iter()
            .filter(|text| text.lines().count() == 2)
            .count(),
        1,
        "exactly one item applied: {texts:?}"
    );
    assert!(
        port.skipped(&failed.item_id).is_some(),
        "the failed item keeps its base, marked"
    );
    // Other agents are never touched by one agent's apply.
    let none = automatic::apply_agent(
        &port,
        &scanner,
        &journal,
        &store,
        Provider::Claude,
        &Default::default(),
    )
    .await
    .unwrap();
    assert!(none.is_empty());
}
