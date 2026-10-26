//! Temporary synthetic configuration only. No vendor process or user configuration is accessed.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use aura_config::{Provider, Scope, Source, sync::*};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use zeroize::Zeroizing;

#[derive(Default)]
struct Journal {
    values: Mutex<BTreeMap<String, Vec<u8>>>,
    fail_create: AtomicBool,
    fail_replace: AtomicBool,
    after_create: Mutex<Option<CreateHook>>,
}
type CreateHook = Box<dyn FnOnce(&str) + Send>;
impl ConfigApplyJournal for Journal {
    fn create(&self, id: &str, bytes: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError> {
        if self.fail_create.load(Ordering::SeqCst) {
            return Err(ConfigPortError::Storage);
        }
        let mut values = self.values.lock().unwrap();
        if values.contains_key(id) {
            return Err(ConfigPortError::Stale);
        }
        values.insert(id.into(), bytes.to_vec());
        drop(values);
        if let Some(hook) = self.after_create.lock().unwrap().take() {
            hook(id);
        }
        Ok(())
    }
    fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.values
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .map(Zeroizing::new)
            .ok_or(ConfigPortError::Invalid)
    }
    fn replace(
        &self,
        id: &str,
        hash: &str,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<(), ConfigPortError> {
        if self.fail_replace.swap(false, Ordering::SeqCst) {
            return Err(ConfigPortError::Storage);
        }
        let mut values = self.values.lock().unwrap();
        if values
            .get(id)
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
            .as_deref()
            != Some(hash)
        {
            return Err(ConfigPortError::Stale);
        }
        values.insert(id.into(), bytes.to_vec());
        Ok(())
    }
    fn list(&self) -> Result<Vec<String>, ConfigPortError> {
        Ok(self.values.lock().unwrap().keys().cloned().collect())
    }
}

fn scanner(root: &std::path::Path, provider: Provider, installed: bool) -> ConfigScanner {
    ConfigScanner::new(
        vec![ConfigSource {
            installed,
            source: Source {
                id: "fixture".into(),
                provider,
                scope: Scope::User,
                root: root.to_owned(),
                claude_state_only: false,
            },
        }],
        root.to_owned(),
        ConfigScope::Windows,
    )
    .unwrap()
}
fn snapshot(
    format: ConfigFormat,
    path: &str,
    keys: &[&str],
    content: Option<ConfigContent>,
) -> ConfigSnapshot {
    ConfigSnapshot {
        schema: 1,
        identity: ConfigIdentity {
            provider: Provider::Codex,
            scope: ConfigScope::Portable,
            format,
            path: path.into(),
            keys: keys.iter().map(|v| (*v).into()).collect(),
        },
        content,
    }
}
fn file(text: &str) -> ConfigContent {
    ConfigContent::Files(BTreeMap::from([(
        "".into(),
        ConfigFile {
            bytes: text.as_bytes().to_vec(),
            executable: false,
        },
    )]))
}

#[test]
fn application_refuses_changed_provider_binding_before_receipt_creation() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let original = scanner(first.path(), Provider::Codex, true);
    let missing = scanner(first.path(), Provider::Codex, false);
    let moved = scanner(second.path(), Provider::Codex, true);
    assert!(!original.same_sources(&missing));
    assert!(!original.same_sources(&moved));
    for current in [missing, moved] {
        let desired = snapshot(
            ConfigFormat::File,
            "AGENTS.md",
            &[],
            Some(file("Reviewed instructions")),
        );
        let prepared = prepare(&original, desired);
        let journal = Journal::default();
        assert_eq!(
            current.apply(prepared, &journal),
            Err(ConfigPortError::Stale)
        );
        assert!(journal.list().unwrap().is_empty());
        assert!(!first.path().join("AGENTS.md").exists());
        assert!(!second.path().join("AGENTS.md").exists());
    }
}
fn prepare(scanner: &ConfigScanner, desired: ConfigSnapshot) -> PreparedConfigApply {
    let expected = scanner.observe(&desired.identity).unwrap();
    match scanner.prepare_apply(desired, &expected).unwrap() {
        ConfigApplyPreparation::Ready(value) => *value,
        _ => panic!("unexpected skip"),
    }
}
fn id(result: ConfigApplyResult) -> String {
    match result {
        ConfigApplyResult::Applied { id } => id,
        _ => panic!("unexpected recovery"),
    }
}
fn no_stage(root: &std::path::Path) {
    assert!(std::fs::read_dir(root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".auracode-apply-")
    }));
}

#[test]
fn reviewed_file_apply_and_restart_rollback_use_only_external_encrypted_journal_port() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after")));
    let review = prepare(&scan, desired);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "before"
    );
    let journal = Journal::default();
    let receipt = id(scan.apply(review, &journal).unwrap());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "after"
    );
    no_stage(temp.path());
    drop(scan);
    let scan = scanner(temp.path(), Provider::Codex, true);
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "before"
    );
    assert_eq!(journal.list().unwrap().len(), 2);
    no_stage(temp.path());
}

#[test]
fn stale_review_and_failed_durable_journal_create_change_nothing() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("AGENTS.md");
    std::fs::write(&path, "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after")));
    let review = prepare(&scan, desired.clone());
    std::fs::write(&path, "external").unwrap();
    let journal = Journal::default();
    assert_eq!(
        scan.apply(review, &journal).unwrap_err(),
        ConfigPortError::Stale
    );
    assert!(journal.list().unwrap().is_empty());
    let review = prepare(&scan, desired);
    journal.fail_create.store(true, Ordering::SeqCst);
    assert_eq!(
        scan.apply(review, &journal).unwrap_err(),
        ConfigPortError::Storage
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external");
    no_stage(temp.path());
}

#[test]
fn stale_expected_snapshot_is_rejected_before_review() {
    let temp = tempfile::tempdir().unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after")));
    let expected = scan.observe(&desired.identity).unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "external").unwrap();
    assert!(matches!(
        scan.prepare_apply(desired, &expected),
        Err(ConfigPortError::Stale)
    ));
}

#[test]
fn missing_agent_vendor_install_and_wrong_platform_are_explicit_skips() {
    let temp = tempfile::tempdir().unwrap();
    let desired = snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after")));
    assert!(matches!(
        scanner(temp.path(), Provider::Codex, false)
            .prepare_apply(desired.clone(), &LocalSnapshot::Absent)
            .unwrap(),
        ConfigApplyPreparation::Skipped(_)
    ));
    let mut wrong = desired;
    wrong.identity.scope = ConfigScope::Macos;
    assert!(matches!(
        scanner(temp.path(), Provider::Codex, true)
            .prepare_apply(wrong, &LocalSnapshot::Absent)
            .unwrap(),
        ConfigApplyPreparation::Skipped(_)
    ));
    let mut plugin = snapshot(
        ConfigFormat::Json,
        "settings.json",
        &["enabledPlugins"],
        Some(ConfigContent::Value(json!({"fixture":true}))),
    );
    plugin.identity.provider = Provider::Claude;
    assert!(matches!(
        scanner(temp.path(), Provider::Claude, true)
            .prepare_apply(plugin, &LocalSnapshot::Absent)
            .unwrap(),
        ConfigApplyPreparation::Skipped(_)
    ));
}

#[test]
fn json_apply_and_rollback_preserve_private_fields_and_later_unselected_edits() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let before = r#"{ "theme": "old", "env": {"PRIVATE":"fixture"}, "number": 1e2 }"#;
    std::fs::write(&path, before).unwrap();
    let scan = scanner(temp.path(), Provider::Claude, true);
    let mut desired = snapshot(
        ConfigFormat::Json,
        "settings.json",
        &["theme"],
        Some(ConfigContent::Value(json!("new"))),
    );
    desired.identity.provider = Provider::Claude;
    let journal = Journal::default();
    let receipt = id(scan.apply(prepare(&scan, desired), &journal).unwrap());
    let next = std::fs::read_to_string(&path).unwrap();
    assert_eq!(next, before.replace("\"old\"", "\"new\""));
    std::fs::write(&path, next.replace("1e2", "2e2")).unwrap();
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        before.replace("1e2", "2e2")
    );
    no_stage(temp.path());
}

#[test]
fn toml_apply_preserves_comments_and_expands_only_home_prefix() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("config.toml");
    std::fs::write(
        &path,
        "# fixture\nmodel = 'old' # comment\n[projects.'private']\ntrust_level='trusted'\n",
    )
    .unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(
        ConfigFormat::Toml,
        "config.toml",
        &["model"],
        Some(ConfigContent::Value(json!("~/model"))),
    );
    let journal = Journal::default();
    id(scan.apply(prepare(&scan, desired), &journal).unwrap());
    let next = std::fs::read_to_string(&path).unwrap();
    assert!(next.contains("# comment"));
    assert!(next.ends_with("[projects.'private']\ntrust_level='trusted'\n"));
    let observed = scan.scan();
    assert!(
        observed
            .items
            .values()
            .any(|item| item.content == Some(ConfigContent::Value(json!("~/model"))))
    );
}

#[test]
fn user_edits_or_deletes_after_apply_are_never_overwritten_by_rollback() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("AGENTS.md");
    std::fs::write(&path, "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    let receipt = id(scan
        .apply(
            prepare(
                &scan,
                snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
            ),
            &journal,
        )
        .unwrap());
    std::fs::write(&path, "external").unwrap();
    assert_eq!(
        scan.rollback_apply(&receipt, &journal).unwrap_err(),
        ConfigPortError::Stale
    );
    std::fs::remove_file(&path).unwrap();
    assert_eq!(
        scan.rollback_apply(&receipt, &journal).unwrap_err(),
        ConfigPortError::Stale
    );
    assert!(!path.exists());
}

#[test]
fn final_journal_failure_reports_recovery_and_restart_can_restore() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    journal.fail_replace.store(true, Ordering::SeqCst);
    let result = scan
        .apply(
            prepare(
                &scan,
                snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
            ),
            &journal,
        )
        .unwrap();
    let ConfigApplyResult::NeedsRecovery { id: receipt } = result else {
        panic!("must retain old base")
    };
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "after"
    );
    id(scanner(temp.path(), Provider::Codex, true)
        .rollback_apply(&receipt, &journal)
        .unwrap());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "before"
    );
}

fn skill(entries: &[(&str, &str)]) -> ConfigContent {
    ConfigContent::Files(
        entries
            .iter()
            .map(|(path, text)| {
                (
                    (*path).into(),
                    ConfigFile {
                        bytes: text.as_bytes().to_vec(),
                        executable: false,
                    },
                )
            })
            .collect(),
    )
}

#[test]
fn tree_add_edit_delete_and_tombstone_restore_binary_dependencies() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join("skills/fixture/data")).unwrap();
    std::fs::write(temp.path().join("skills/fixture/SKILL.md"), "before").unwrap();
    std::fs::write(temp.path().join("skills/fixture/data/old.bin"), [0, 1, 255]).unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(
        ConfigFormat::Tree,
        "skills/fixture",
        &[],
        Some(skill(&[("SKILL.md", "after"), ("new.txt", "new")])),
    );
    let identity = desired.identity.clone();
    let journal = Journal::default();
    let receipt = id(scan.apply(prepare(&scan, desired), &journal).unwrap());
    assert!(!temp.path().join("skills/fixture/data/old.bin").exists());
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        std::fs::read(temp.path().join("skills/fixture/data/old.bin")).unwrap(),
        [0, 1, 255]
    );
    let receipt = id(scan
        .apply(
            prepare(&scan, ConfigSnapshot::tombstone(identity.clone())),
            &journal,
        )
        .unwrap());
    assert!(matches!(
        scan.observe(&identity).unwrap(),
        LocalSnapshot::Absent
    ));
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        std::fs::read(temp.path().join("skills/fixture/data/old.bin")).unwrap(),
        [0, 1, 255]
    );
    no_stage(temp.path());
}

#[test]
fn newly_added_tree_dependency_invalidates_review() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join("skills/fixture")).unwrap();
    std::fs::write(temp.path().join("skills/fixture/SKILL.md"), "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(
        ConfigFormat::Tree,
        "skills/fixture",
        &[],
        Some(skill(&[("SKILL.md", "after")])),
    );
    let review = prepare(&scan, desired);
    std::fs::write(temp.path().join("skills/fixture/new.txt"), "external").unwrap();
    assert_eq!(
        scan.apply(review, &Journal::default()).unwrap_err(),
        ConfigPortError::Stale
    );
}

#[test]
fn case_aliases_in_a_remote_tree_are_skipped_before_any_file_write() {
    let temp = tempfile::tempdir().unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(
        ConfigFormat::Tree,
        "skills/fixture",
        &[],
        Some(skill(&[("SKILL.md", "one"), ("skill.md", "two")])),
    );
    assert!(matches!(
        scan.prepare_apply(desired, &LocalSnapshot::Absent).unwrap(),
        ConfigApplyPreparation::Skipped(_)
    ));
    assert!(!temp.path().join("skills").exists());
}

#[test]
fn concurrent_creation_after_durable_review_cannot_be_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    let path = temp.path().join("AGENTS.md");
    let target = path.clone();
    *journal.after_create.lock().unwrap() = Some(Box::new(move |_| {
        std::fs::write(target, "external").unwrap()
    }));
    let result = scan
        .apply(
            prepare(
                &scan,
                snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
            ),
            &journal,
        )
        .unwrap();
    assert!(matches!(result, ConfigApplyResult::NeedsRecovery { .. }));
    assert_eq!(std::fs::read_to_string(path).unwrap(), "external");
}

#[test]
fn authenticated_but_falsely_portable_path_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let desired = snapshot(
        ConfigFormat::Toml,
        "config.toml",
        &["model"],
        Some(ConfigContent::Value(json!("/Users/somebody/model"))),
    );
    assert!(matches!(
        scan.prepare_apply(desired, &LocalSnapshot::Absent),
        Err(ConfigPortError::Invalid)
    ));
}

#[test]
fn receipt_ids_are_validated_before_journal_reads() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        scanner(temp.path(), Provider::Codex, true)
            .rollback_apply("../AGENTS.md", &Journal::default())
            .unwrap_err(),
        ConfigPortError::Invalid
    );
}

#[test]
fn crash_after_displacing_original_restores_it_from_verified_publication_stage() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    let root = temp.path().to_owned();
    *journal.after_create.lock().unwrap() = Some(Box::new(move |id| {
        let stage = root.join(format!(".auracode-apply-{id}"));
        std::fs::create_dir(&stage).unwrap();
        std::fs::rename(root.join("AGENTS.md"), stage.join("before-0")).unwrap();
        std::fs::write(stage.join("after-0"), "after").unwrap();
    }));
    let ConfigApplyResult::NeedsRecovery { id: receipt } = scan
        .apply(
            prepare(
                &scan,
                snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
            ),
            &journal,
        )
        .unwrap()
    else {
        panic!("expected interrupted stage")
    };
    assert!(!temp.path().join("AGENTS.md").exists());
    assert_eq!(
        scan.apply_history(&journal).unwrap()[0].status,
        ConfigApplyStatus::RecoveryRequired
    );
    id(scanner(temp.path(), Provider::Codex, true)
        .rollback_apply(&receipt, &journal)
        .unwrap());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("AGENTS.md")).unwrap(),
        "before"
    );
    no_stage(temp.path());
}

#[test]
fn changed_displaced_original_is_retained_and_never_silently_deleted() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "before").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    let root = temp.path().to_owned();
    *journal.after_create.lock().unwrap() = Some(Box::new(move |id| {
        let stage = root.join(format!(".auracode-apply-{id}"));
        std::fs::create_dir(&stage).unwrap();
        std::fs::rename(root.join("AGENTS.md"), stage.join("before-0")).unwrap();
        std::fs::write(stage.join("before-0"), "late external write").unwrap();
    }));
    let ConfigApplyResult::NeedsRecovery { id: receipt } = scan
        .apply(
            prepare(
                &scan,
                snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
            ),
            &journal,
        )
        .unwrap()
    else {
        panic!("expected interrupted stage")
    };
    assert_eq!(
        scan.rollback_apply(&receipt, &journal).unwrap_err(),
        ConfigPortError::Stale
    );
    assert_eq!(
        std::fs::read_to_string(
            temp.path()
                .join(format!(".auracode-apply-{receipt}/before-0"))
        )
        .unwrap(),
        "late external write"
    );
}

#[test]
fn partial_tree_application_restores_completed_files_without_touching_unchanged_ones() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join("skills/fixture")).unwrap();
    std::fs::write(temp.path().join("skills/fixture/SKILL.md"), "before").unwrap();
    std::fs::write(temp.path().join("skills/fixture/tool.txt"), "old tool").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let journal = Journal::default();
    let root = temp.path().to_owned();
    *journal.after_create.lock().unwrap() = Some(Box::new(move |id| {
        std::fs::create_dir(root.join(format!(".auracode-apply-{id}"))).unwrap();
        std::fs::write(root.join("skills/fixture/SKILL.md"), "after").unwrap();
    }));
    let desired = snapshot(
        ConfigFormat::Tree,
        "skills/fixture",
        &[],
        Some(skill(&[("SKILL.md", "after"), ("tool.txt", "new tool")])),
    );
    let ConfigApplyResult::NeedsRecovery { id: receipt } =
        scan.apply(prepare(&scan, desired), &journal).unwrap()
    else {
        panic!("expected interrupted stage")
    };
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("skills/fixture/SKILL.md")).unwrap(),
        "before"
    );
    assert_eq!(
        std::fs::read_to_string(temp.path().join("skills/fixture/tool.txt")).unwrap(),
        "old tool"
    );
    no_stage(temp.path());
}

#[test]
fn mcp_inverse_only_restores_selected_server_and_keeps_other_private_settings() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mcp.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"demo":{"command":"old"}},"private":{"token":"fixture"}}"#,
    )
    .unwrap();
    let scan = scanner(temp.path(), Provider::Pi, true);
    let mut desired = snapshot(
        ConfigFormat::Mcp,
        "mcp.json",
        &["demo"],
        Some(ConfigContent::Value(json!({"command":"new"}))),
    );
    desired.identity.provider = Provider::Pi;
    let journal = Journal::default();
    let receipt = id(scan.apply(prepare(&scan, desired), &journal).unwrap());
    let current = std::fs::read_to_string(&path)
        .unwrap()
        .replace("fixture", "later");
    std::fs::write(&path, current).unwrap();
    id(scan.rollback_apply(&receipt, &journal).unwrap());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
        json!({"mcpServers":{"demo":{"command":"old"}},"private":{"token":"later"}})
    );
}

#[cfg(unix)]
#[test]
fn symlink_replacement_of_target_or_parent_is_refused() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "before").unwrap();
    std::fs::write(outside.path().join("outside"), "private").unwrap();
    let scan = scanner(temp.path(), Provider::Codex, true);
    let review = prepare(
        &scan,
        snapshot(ConfigFormat::File, "AGENTS.md", &[], Some(file("after"))),
    );
    std::fs::remove_file(temp.path().join("AGENTS.md")).unwrap();
    symlink(
        outside.path().join("outside"),
        temp.path().join("AGENTS.md"),
    )
    .unwrap();
    assert_eq!(
        scan.apply(review, &Journal::default()).unwrap_err(),
        ConfigPortError::Stale
    );
    assert_eq!(
        std::fs::read_to_string(outside.path().join("outside")).unwrap(),
        "private"
    );
}
