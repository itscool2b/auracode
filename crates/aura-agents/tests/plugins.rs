//! Plugin library listings run fake CLIs pointed at temporary agent homes through each agent's
//! documented variable (CLAUDE_CONFIG_DIR, CODEX_HOME, PI_CODING_AGENT_DIR). The fakes answer
//! only from `fake-listing.json` in that home, so a passing test proves the home was used.
#![cfg(test)]
mod common;
use aura_protocol::plugins::{ListingState, PluginFeature};
use common::Machine;
use std::path::{Path, PathBuf};

fn home(machine: &Machine, name: &str, answers: serde_json::Value) -> PathBuf {
    let dir = machine.root.path().join("agent-homes").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("fake-listing.json"), answers.to_string()).unwrap();
    dir
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn claude_answers(version: &str) -> serde_json::Value {
    serde_json::json!({
        "plugin list --json --available": {"stdout": serde_json::json!({
            "installed": [{"id": format!("tools@team-{version}"), "version": "1.0.0", "scope": "user", "enabled": true}],
            "available": [{"pluginId": "docs@team", "name": "docs", "marketplaceName": "team"}]
        }).to_string()},
        "plugin marketplace list --json": {"stdout": "[{\"name\":\"team\",\"source\":\"github\",\"repo\":\"owner/plugins\"}]"}
    })
}

#[tokio::test]
async fn claude_listings_use_the_given_home_cache_by_version_and_reread_after_an_update() {
    let machine = Machine::with_tools(&[]);
    let bin = machine.home.join(".local/share/claude/versions/fixture");
    machine.install_tool(&bin, "claude");
    let claude = home(&machine, "claude", claude_answers("a"));
    let env = machine.env_with_path(&[&bin], &[("CLAUDE_CONFIG_DIR", &text(&claude))]);
    let detector = machine.detector(env);
    let first = detector
        .plugin_listings("claude", false, 1_000)
        .await
        .unwrap();
    assert_eq!(first.version, "2.1.310");
    assert_eq!(first.version_change, None);
    let plugins = &first.listings[0];
    assert_eq!(plugins.feature, PluginFeature::Plugins);
    assert_eq!(plugins.state, ListingState::Live);
    assert_eq!(plugins.entries[0].key, "tools@team-a");
    assert_eq!(plugins.available_total, 1);
    assert_eq!(
        first.listings[1].entries[0].description.as_deref(),
        Some("owner/plugins")
    );
    let runs = std::fs::read_to_string(machine.fake.join("claude.listing.log")).unwrap();
    assert_eq!(runs.lines().count(), 2);
    for run in runs.lines() {
        let run: serde_json::Value = serde_json::from_str(run).unwrap();
        assert_eq!(
            run["home"],
            text(&claude),
            "the temporary home, never the real one"
        );
        assert_eq!(run["no_color"], "1");
    }
    // Same version: the cache answers and nothing runs.
    let cached = detector
        .plugin_listings("claude", false, 2_000)
        .await
        .unwrap();
    assert_eq!(cached.updated_at, 1_000);
    assert_eq!(
        std::fs::read_to_string(machine.fake.join("claude.listing.log"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    // The harness was updated outside auracode: detection sees the new version and the listing
    // is read again, reporting the change.
    machine.version("claude", "2.1.312 (Claude Code)");
    std::fs::write(
        claude.join("fake-listing.json"),
        claude_answers("b").to_string(),
    )
    .unwrap();
    detector.detect_all(true).await;
    let after = detector
        .plugin_listings("claude", false, 3_000)
        .await
        .unwrap();
    assert_eq!(after.updated_at, 3_000);
    assert_eq!(after.listings[0].entries[0].key, "tools@team-b");
    let change = after.version_change.unwrap();
    assert_eq!(
        (change.from.as_str(), change.to.as_str()),
        ("2.1.310", "2.1.312")
    );
    // An explicit refresh always runs again.
    let refreshed = detector
        .plugin_listings("claude", true, 4_000)
        .await
        .unwrap();
    assert_eq!(refreshed.updated_at, 4_000);
}

#[tokio::test]
async fn one_failing_codex_command_fails_only_its_feature_and_secrets_never_survive() {
    let machine = Machine::with_tools(&["codex"]);
    let codex = home(
        &machine,
        "codex",
        serde_json::json!({
            "plugin list --json --available": {"stdout": "", "stderr": "Error: marketplace cache is corrupt\n", "code": 1},
            "plugin marketplace list --json": {"stdout": "{\"marketplaces\":[{\"name\":\"local-team\",\"root\":\"C:\\\\x\"}]}"},
            "mcp list --json": {"stdout": serde_json::json!([{"name":"private","enabled":true,
                "transport":{"type":"stdio","command":"node","args":["s.js"],"env":{"TOKEN":"SYNTHETIC_CODEX_SECRET"}}}]).to_string()}
        }),
    );
    let env = machine.env(&[("CODEX_HOME", &text(&codex))]);
    let detector = machine.detector(env);
    let listed = detector.plugin_listings("codex", false, 1).await.unwrap();
    let state = |feature| {
        listed
            .listings
            .iter()
            .find(|listing| listing.feature == feature)
            .unwrap()
            .state
            .clone()
    };
    let ListingState::Failed { reason } = state(PluginFeature::Plugins) else {
        panic!("plugins failed");
    };
    assert!(reason.contains("marketplace cache is corrupt"), "{reason}");
    assert_eq!(state(PluginFeature::Marketplaces), ListingState::Live);
    assert_eq!(state(PluginFeature::McpServers), ListingState::Live);
    assert!(!format!("{listed:?}").contains("SYNTHETIC_CODEX_SECRET"));
}

#[tokio::test]
async fn pi_lists_offline_and_an_agent_without_a_home_variable_fails_plainly() {
    let machine = Machine::with_tools(&[]);
    machine.install_tool(&machine.bin, "pi");
    machine.version("pi", "1.0.2");
    let pi = home(
        &machine,
        "pi",
        serde_json::json!({"list --no-approve": {"stdout": "User packages:\n  npm:pi-tools@1.0.0\n"}}),
    );
    let detector = machine.detector(machine.env(&[("PI_CODING_AGENT_DIR", &text(&pi))]));
    let listed = detector.plugin_listings("pi", false, 1).await.unwrap();
    assert_eq!(listed.listings[0].entries[0].key, "npm:pi-tools@1.0.0");
    let run: serde_json::Value = serde_json::from_str(
        std::fs::read_to_string(machine.fake.join("pi.listing.log"))
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        run["pi_offline"], "1",
        "a listing never reaches the network"
    );
    assert_eq!(run["home"], text(&pi));
    // The same fake without its variable cannot find answers: the listing fails, not guesses.
    let bare = machine.detector(machine.env(&[]));
    let failed = bare.plugin_listings("pi", true, 2).await.unwrap();
    assert!(matches!(
        failed.listings[0].state,
        ListingState::Failed { .. }
    ));
    // Agents without reviewed listing commands are not run at all.
    assert!(bare.plugin_listings("hermes", false, 3).await.is_none());
}
