use std::fs;

use aura_config::{
    Provider, Scope, Source,
    sync::{
        ConfigContent, ConfigFormat, ConfigIdentity, ConfigScanner, ConfigScope, ConfigSource,
        LocalSnapshot,
    },
};
use tempfile::TempDir;

fn scanner(temp: &TempDir, provider: Provider, installed: bool) -> ConfigScanner {
    ConfigScanner::new(
        vec![ConfigSource {
            source: Source {
                id: "fixture".into(),
                provider,
                scope: Scope::User,
                root: temp.path().join("config"),
                claude_state_only: false,
            },
            installed,
        }],
        temp.path().join("home"),
        ConfigScope::Windows,
    )
    .unwrap()
}
fn file_id(provider: Provider, path: &str) -> ConfigIdentity {
    ConfigIdentity {
        provider,
        scope: ConfigScope::Portable,
        format: ConfigFormat::File,
        path: path.into(),
        keys: Vec::new(),
    }
}
fn fixture() -> TempDir {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("config")).unwrap();
    temp
}

#[test]
fn settings_are_independent_keys_and_protected_fields_are_never_snapshots() {
    let temp = fixture();
    fs::write(
        temp.path().join("config/settings.json"),
        r#"{
        "model":"test-model","editor":{"font":"mono","size":12},
        "env":{"PRIVATE":"SYNTHETIC_PRIVATE"},"apiKey":"SYNTHETIC_KEY","empty":{}
    }"#,
    )
    .unwrap();
    let scan = scanner(&temp, Provider::Pi, true).scan();
    assert_eq!(scan.items.len(), 3);
    let keys: Vec<_> = scan
        .items
        .values()
        .map(|item| item.identity.keys.join("/"))
        .collect();
    assert!(keys.contains(&"model".into()));
    assert!(keys.contains(&"editor/font".into()));
    for item in scan.items.values() {
        let encoded = item.encode().unwrap();
        let text = std::str::from_utf8(&encoded).unwrap();
        assert!(!text.contains("SYNTHETIC_"));
        assert!(!text.contains("apiKey"));
    }
}

#[test]
fn missing_agents_and_unavailable_roots_wait_even_if_old_files_exist() {
    let temp = fixture();
    fs::write(temp.path().join("config/AGENTS.md"), "fixture").unwrap();
    let id = file_id(Provider::Codex, "AGENTS.md");
    let scanner = scanner(&temp, Provider::Codex, false);
    assert!(scanner.scan().items.is_empty());
    assert!(matches!(
        scanner.observe(&id).unwrap(),
        LocalSnapshot::Unavailable
    ));
    fs::remove_dir_all(temp.path().join("config")).unwrap();
    let active = ConfigScanner::new(
        vec![ConfigSource {
            source: Source {
                id: "fixture".into(),
                provider: Provider::Codex,
                scope: Scope::User,
                root: temp.path().join("config"),
                claude_state_only: false,
            },
            installed: true,
        }],
        temp.path().join("home"),
        ConfigScope::Windows,
    )
    .unwrap();
    assert!(matches!(
        active.observe(&id).unwrap(),
        LocalSnapshot::Unavailable
    ));
}

#[test]
fn only_a_successful_observation_can_prove_a_leaf_was_removed() {
    let temp = fixture();
    let scanner = scanner(&temp, Provider::Pi, true);
    fs::write(
        temp.path().join("config/settings.json"),
        r#"{"editor":{"font":"mono"}}"#,
    )
    .unwrap();
    let scan = scanner.scan();
    let id = scan.items.values().next().unwrap().identity.clone();
    fs::write(temp.path().join("config/settings.json"), r#"{"editor":{}}"#).unwrap();
    assert!(scanner.scan().items.is_empty());
    assert!(matches!(
        scanner.observe(&id).unwrap(),
        LocalSnapshot::Absent
    ));
    fs::write(temp.path().join("config/settings.json"), "broken").unwrap();
    assert!(matches!(
        scanner.observe(&id).unwrap(),
        LocalSnapshot::Unavailable
    ));
    fs::write(
        temp.path().join("config/settings.json"),
        r#"{"editor":false}"#,
    )
    .unwrap();
    assert!(matches!(
        scanner.observe(&id).unwrap(),
        LocalSnapshot::Unavailable
    ));
}

#[test]
fn duplicate_keys_are_not_silently_collapsed() {
    let temp = fixture();
    let scanner = scanner(&temp, Provider::Pi, true);
    fs::write(
        temp.path().join("config/settings.json"),
        r#"{"editor":{"font":"one","font":"two"}}"#,
    )
    .unwrap();
    let scan = scanner.scan();
    assert!(scan.items.is_empty());
    assert!(!scan.skipped.is_empty());
}

#[test]
fn codex_trust_and_auth_stay_local_while_normal_keys_are_discovered() {
    let temp = fixture();
    fs::write(temp.path().join("config/config.toml"), "model='fixture'\n[projects.private]\ntrust_level='trusted'\n[model_providers.demo]\nbase_url='https://example.invalid'\napi_key='SYNTHETIC_PRIVATE'\n").unwrap();
    let scan = scanner(&temp, Provider::Codex, true).scan();
    assert_eq!(scan.items.len(), 2);
    for item in scan.items.values() {
        let encoded = item.encode().unwrap();
        let value = std::str::from_utf8(&encoded).unwrap();
        assert!(!value.contains("SYNTHETIC_PRIVATE"));
        assert!(!value.contains("trusted"));
    }
}

#[test]
fn own_home_paths_are_portable_and_other_platform_paths_are_scoped() {
    let temp = fixture();
    let home = temp.path().join("home");
    let document = serde_json::json!({"cacheLocation":home.join("working").to_string_lossy(),
        "editorPath":"C:\\Tools\\editor.exe", "otherPath":"/Applications/Editor.app"});
    fs::write(
        temp.path().join("config/settings.json"),
        serde_json::to_vec(&document).unwrap(),
    )
    .unwrap();
    let scan = scanner(&temp, Provider::Pi, true).scan();
    let portable = scan
        .items
        .values()
        .find(|item| item.identity.keys == ["cacheLocation"])
        .unwrap();
    assert_eq!(portable.identity.scope, ConfigScope::Portable);
    assert!(portable.content == Some(ConfigContent::Value(serde_json::json!("~/working"))));
    let windows = scan
        .items
        .values()
        .find(|item| item.identity.keys == ["editorPath"])
        .unwrap();
    assert_eq!(windows.identity.scope, ConfigScope::Windows);
    let mac = scan
        .items
        .values()
        .find(|item| item.identity.keys == ["otherPath"])
        .unwrap();
    assert_eq!(mac.identity.scope, ConfigScope::Macos);
    assert!(matches!(
        scanner(&temp, Provider::Pi, true)
            .observe(&mac.identity)
            .unwrap(),
        LocalSnapshot::Unavailable
    ));
}

#[test]
fn skills_preserve_binary_dependencies_and_skip_protected_or_incomplete_bundles() {
    let temp = fixture();
    let root = temp.path().join("config/skills");
    for name in ["valid", "private", "incomplete"] {
        fs::create_dir_all(root.join(name)).unwrap();
    }
    fs::write(root.join("valid/SKILL.md"), "# Fixture skill").unwrap();
    fs::write(root.join("valid/image.bin"), [0u8, 255, 1]).unwrap();
    fs::write(root.join("private/SKILL.md"), "# Fixture skill").unwrap();
    fs::write(root.join("private/.env"), "SYNTHETIC_PRIVATE").unwrap();
    let scanner = scanner(&temp, Provider::Claude, true);
    let scan = scanner.scan();
    assert_eq!(scan.items.len(), 1);
    assert_eq!(scan.skipped.len(), 2);
    let item = scan.items.values().next().unwrap();
    let Some(ConfigContent::Files(files)) = &item.content else {
        panic!("expected files")
    };
    assert_eq!(files["image.bin"].bytes, vec![0, 255, 1]);
    assert!(matches!(
        scanner
            .observe(&ConfigIdentity {
                provider: Provider::Claude,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Tree,
                path: "skills/private".into(),
                keys: Vec::new()
            })
            .unwrap(),
        LocalSnapshot::Unavailable
    ));
}

#[test]
fn mcp_with_private_fields_waits_without_exporting_them() {
    let temp = fixture();
    fs::write(
        temp.path().join("config/mcp.json"),
        r#"{"mcpServers":{"safe":{"command":"fixture-tool"},
        "private":{"command":"fixture-tool","env":{"KEY":"SYNTHETIC_PRIVATE"}}}}"#,
    )
    .unwrap();
    let scanner = scanner(&temp, Provider::Pi, true);
    let scan = scanner.scan();
    assert_eq!(scan.items.len(), 1);
    assert_eq!(scan.skipped.len(), 1);
    let id = ConfigIdentity {
        provider: Provider::Pi,
        scope: ConfigScope::Portable,
        format: ConfigFormat::Mcp,
        path: "mcp.json".into(),
        keys: vec!["private".into()],
    };
    assert!(matches!(
        scanner.observe(&id).unwrap(),
        LocalSnapshot::Unavailable
    ));
    assert!(!scan.skipped[0].reason.contains("SYNTHETIC_PRIVATE"));
}

#[test]
fn shared_skills_are_one_source_and_project_roots_are_refused() {
    let temp = fixture();
    fs::create_dir(temp.path().join("config/demo")).unwrap();
    fs::write(temp.path().join("config/demo/SKILL.md"), "# Shared").unwrap();
    let scan = scanner(&temp, Provider::Shared, true).scan();
    assert_eq!(scan.items.len(), 1);
    let source = Source {
        id: "project".into(),
        provider: Provider::Claude,
        scope: Scope::Project,
        root: temp.path().join("config"),
        claude_state_only: false,
    };
    assert!(
        ConfigScanner::new(
            vec![ConfigSource {
                source,
                installed: true
            }],
            temp.path().into(),
            ConfigScope::Windows
        )
        .is_err()
    );
}
