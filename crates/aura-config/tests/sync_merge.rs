use std::collections::BTreeMap;

use aura_config::{
    Provider,
    sync::{
        ConfigContent, ConfigFile, ConfigFormat, ConfigIdentity, ConfigOperation, ConfigScope,
        ConfigSnapshot, LocalSnapshot, merge,
    },
};
use serde_json::json;

fn setting(value: serde_json::Value) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        local_fields: Vec::new(),
        identity: ConfigIdentity {
            provider: Provider::Pi,
            scope: ConfigScope::Portable,
            format: ConfigFormat::Json,
            path: "settings.json".into(),
            keys: vec!["editor".into()],
        },
        content: Some(ConfigContent::Value(value)),
    }
}
fn text(value: &str) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        local_fields: Vec::new(),
        identity: ConfigIdentity {
            provider: Provider::Codex,
            scope: ConfigScope::Portable,
            format: ConfigFormat::File,
            path: "AGENTS.md".into(),
            keys: Vec::new(),
        },
        content: Some(ConfigContent::Files(BTreeMap::from([(
            "".into(),
            ConfigFile {
                bytes: value.as_bytes().to_vec(),
                executable: false,
            },
        )]))),
    }
}
fn local(snapshot: &ConfigSnapshot) -> LocalSnapshot {
    LocalSnapshot::Present(snapshot.clone())
}

#[test]
fn first_link_is_union_even_when_the_other_device_has_a_tombstone() {
    let present = setting(json!({"font": "mono"}));
    let deleted = ConfigSnapshot::tombstone(present.identity.clone());
    for remote in [None, Some(&deleted)] {
        let result = merge(None, &local(&present), remote).unwrap();
        assert!(result.first_link);
        assert_eq!(result.operation, ConfigOperation::Publish);
        assert!(result.result == Some(present.clone()));
    }
    let result = merge(None, &LocalSnapshot::Absent, Some(&present)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Apply);
    assert!(result.result == Some(present));
}

#[test]
fn absence_only_becomes_a_delete_with_a_known_base() {
    let base = setting(json!({"font":"mono"}));
    let result = merge(Some(&base), &LocalSnapshot::Absent, Some(&base)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Publish);
    assert!(result.result.unwrap().content.is_none());
    let missing_remote = merge(Some(&base), &local(&base), None).unwrap();
    assert_eq!(missing_remote.operation, ConfigOperation::Wait);
}

#[test]
fn unavailable_or_skipped_items_never_publish_deletions() {
    let base = setting(json!({"font":"mono"}));
    for previous in [None, Some(&base)] {
        let result = merge(previous, &LocalSnapshot::Unavailable, Some(&base)).unwrap();
        assert_eq!(result.operation, ConfigOperation::Wait);
        assert!(result.result.is_none());
    }
}

#[test]
fn unchanged_local_applies_explicit_remote_delete() {
    let base = setting(json!(12));
    let deleted = ConfigSnapshot::tombstone(base.identity.clone());
    let result = merge(Some(&base), &local(&base), Some(&deleted)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Apply);
    assert!(result.result == Some(deleted));
}

#[test]
fn concurrent_edit_and_delete_require_a_choice() {
    let base = setting(json!(12));
    let changed = setting(json!(14));
    let deleted = ConfigSnapshot::tombstone(base.identity.clone());
    let result = merge(Some(&base), &local(&changed), Some(&deleted)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Conflict);
    assert!(result.result.is_none());
}

#[test]
fn settings_merge_non_overlapping_keys_and_nested_deletes() {
    let base = setting(json!({"font": "mono", "size": 12, "nested":{"a":1,"b":2}}));
    let left = setting(json!({"font": "serif", "size": 12, "nested":{"b":2}}));
    let right = setting(json!({"font": "mono", "size": 14, "nested":{"a":1,"b":3}}));
    let result = merge(Some(&base), &local(&left), Some(&right)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Merge);
    assert!(result.result == Some(setting(json!({"font":"serif","size":14,"nested":{"b":3}}))));
}

#[test]
fn first_link_merges_disjoint_object_keys_without_losing_either() {
    let left = setting(json!({"font":"mono"}));
    let right = setting(json!({"size":14}));
    let result = merge(None, &local(&left), Some(&right)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Merge);
    assert!(result.result == Some(setting(json!({"font":"mono","size":14}))));
}

#[test]
fn conflicting_setting_values_are_not_discarded_or_embedded_in_errors() {
    let base = setting(json!({"font":"base"}));
    let left = setting(json!({"font":"left-value"}));
    let right = setting(json!({"font":"right-value"}));
    let result = merge(Some(&base), &local(&left), Some(&right)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Conflict);
    assert_eq!(result.conflicts, vec!["/font"]);
    assert!(result.result.is_none());
}

#[test]
fn text_merges_disjoint_lines_but_never_writes_conflict_markers() {
    let base = text("one\ntwo\nthree\nfour\nfive\n");
    let left = text("ONE\ntwo\nthree\nfour\nfive\n");
    let right = text("one\ntwo\nthree\nfour\nFIVE\n");
    let result = merge(Some(&base), &local(&left), Some(&right)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Merge);
    assert!(result.result == Some(text("ONE\ntwo\nthree\nfour\nFIVE\n")));
    let overlap = text("different\ntwo\nthree\nfour\nfive\n");
    let result = merge(Some(&base), &local(&left), Some(&overlap)).unwrap();
    assert_eq!(result.operation, ConfigOperation::Conflict);
    assert!(result.result.is_none());
}

#[test]
fn snapshots_are_canonical_item_bound_and_future_schemas_are_preserved_by_refusal() {
    let first = setting(json!({"z":1,"a":{"y":2,"x":3}}));
    let second = setting(json!({"a":{"x":3,"y":2},"z":1}));
    assert_eq!(&*first.encode().unwrap(), &*second.encode().unwrap());
    let id = first.identity.id().unwrap();
    assert!(ConfigSnapshot::decode(&first.encode().unwrap(), &id).unwrap() == first);
    assert!(ConfigSnapshot::decode(&first.encode().unwrap(), "different-item").is_err());
    let mut future = serde_json::to_value(first).unwrap();
    future["schema"] = json!(2);
    assert!(ConfigSnapshot::decode(&serde_json::to_vec(&future).unwrap(), &id).is_err());
}

#[test]
fn forbidden_destinations_and_sensitive_config_never_encode() {
    for path in [
        "../AGENTS.md",
        "auth.json",
        "sessions/AGENTS.md",
        "skills/demo/../../auth.json",
    ] {
        let mut candidate = text("content");
        candidate.identity.path = path.into();
        assert!(candidate.encode().is_err());
    }
    for value in [
        json!({"apiKey":"synthetic"}),
        json!({"nested":{"password":"synthetic"}}),
        json!({"command":"Bearer synthetic"}),
    ] {
        assert!(setting(value).encode().is_err());
    }
    let mut trust = setting(json!("trusted"));
    trust.identity.provider = Provider::Codex;
    trust.identity.format = ConfigFormat::Toml;
    trust.identity.path = "config.toml".into();
    trust.identity.keys = vec!["projects".into(), "private".into(), "trust_level".into()];
    assert!(trust.encode().is_err());
}

#[test]
fn tree_dependencies_cannot_escape_or_include_credential_files() {
    let mut candidate = text("content");
    candidate.identity.provider = Provider::Claude;
    candidate.identity.format = ConfigFormat::Tree;
    candidate.identity.path = "skills/test".into();
    for path in ["../outside", ".env", "folder/auth.json", "C:/outside"] {
        candidate.content = Some(ConfigContent::Files(BTreeMap::from([(
            path.into(),
            ConfigFile {
                bytes: b"synthetic".to_vec(),
                executable: false,
            },
        )])));
        assert!(candidate.encode().is_err());
    }
}

#[test]
fn platform_specific_items_do_not_apply_on_the_other_platform() {
    let mut identity = text("content").identity;
    identity.scope = ConfigScope::Windows;
    assert!(identity.applies_on(ConfigScope::Windows));
    assert!(!identity.applies_on(ConfigScope::Macos));
    identity.scope = ConfigScope::Portable;
    assert!(identity.applies_on(ConfigScope::Macos));
}
