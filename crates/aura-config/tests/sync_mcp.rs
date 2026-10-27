#![allow(clippy::unwrap_used, clippy::panic)]
use aura_config::{Provider, Scope, Source, sync::*};
use serde_json::json;

fn snapshot(fields: &[&str]) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        identity: ConfigIdentity {
            provider: Provider::Pi,
            scope: ConfigScope::Portable,
            format: ConfigFormat::Mcp,
            path: "mcp.json".into(),
            keys: vec!["demo".into()],
        },
        content: Some(ConfigContent::Value(json!({"command":"fixture-tool"}))),
        local_fields: fields.iter().map(|field| (*field).into()).collect(),
    }
}

#[test]
fn required_local_names_union_during_first_link_and_are_not_silently_dropped() {
    let left = snapshot(&["env/A"]);
    let right = snapshot(&["env/B"]);
    let decision = merge(None, &LocalSnapshot::Present(left.clone()), Some(&right)).unwrap();
    assert_eq!(decision.operation, ConfigOperation::Merge);
    assert_eq!(
        decision.result.unwrap().local_fields,
        vec!["env/A", "env/B"]
    );
    let empty = snapshot(&[]);
    let decision = merge(
        Some(&left),
        &LocalSnapshot::Present(left.clone()),
        Some(&empty),
    )
    .unwrap();
    assert_eq!(decision.operation, ConfigOperation::Merge);
    assert_eq!(decision.result.unwrap().local_fields, vec!["env/A"]);
    let decision = merge(
        Some(&left),
        &LocalSnapshot::Present(empty.clone()),
        Some(&empty),
    )
    .unwrap();
    assert_eq!(decision.operation, ConfigOperation::Merge);
    assert_eq!(decision.result.unwrap().local_fields, vec!["env/A"]);
}

#[test]
fn tombstones_have_no_local_requirements_and_old_public_snapshots_decode() {
    let before = snapshot(&["env/A"]);
    let deleted = ConfigSnapshot::tombstone(before.identity.clone());
    let decision = merge(
        Some(&before),
        &LocalSnapshot::Present(before.clone()),
        Some(&deleted),
    )
    .unwrap();
    assert_eq!(decision.operation, ConfigOperation::Apply);
    assert!(decision.result.unwrap().local_fields.is_empty());
    let public = snapshot(&[]);
    let bytes = public.encode().unwrap();
    assert!(
        !std::str::from_utf8(&bytes)
            .unwrap()
            .contains("local_fields")
    );
    assert!(
        ConfigSnapshot::decode(&bytes, &public.identity.id().unwrap())
            .unwrap()
            .local_fields
            .is_empty()
    );
}

#[test]
fn forged_duplicate_or_unknown_requirement_metadata_is_refused() {
    for names in [
        &["env/A", "env/A"][..],
        &["env/Z", "env/A"],
        &["oauth/token"],
        &["env/A=VALUE"],
        &["env/../KEY"],
        &["bearer_token_env_var"],
    ] {
        assert!(snapshot(names).encode().is_err());
    }
    let mut wrong = snapshot(&["env/A"]);
    wrong.identity.format = ConfigFormat::Json;
    wrong.identity.path = "settings.json".into();
    assert!(wrong.encode().is_err());
    let mut deleted = ConfigSnapshot::tombstone(snapshot(&[]).identity);
    deleted.local_fields = vec!["env/A".into()];
    assert!(deleted.encode().is_err());
}

#[test]
fn unsupported_options_and_inline_secret_arguments_still_wait_without_export() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(
        temp.path().join("mcp.json"),
        r#"{"mcpServers":{
        "unknown":{"command":"fixture-tool","unknownOption":"PRIVATE"},
        "argument":{"command":"fixture-tool","args":["--token=PRIVATE"],"env":{"KEY":"LOCAL"}},
        "malformed":{"command":"fixture-tool","env":{"KEY":{"nested":"PRIVATE"}}}
    }}"#,
    )
    .unwrap();
    let scan = ConfigScanner::new(
        vec![ConfigSource {
            installed: true,
            source: Source {
                id: "fixture".into(),
                provider: Provider::Pi,
                scope: Scope::User,
                root: temp.path().to_owned(),
                claude_state_only: false,
            },
        }],
        temp.path().to_owned(),
        ConfigScope::Windows,
    )
    .unwrap()
    .scan();
    assert!(scan.items.is_empty());
    assert_eq!(scan.skipped.len(), 3);
    assert!(
        scan.skipped
            .iter()
            .all(|item| !item.reason.contains("PRIVATE") && !item.reason.contains("LOCAL"))
    );
}
