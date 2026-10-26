//! Read-only transition planning. Each profile owns only explicitly claimed identities. Shared
//! vendor homes stay in place, and unmatched local content is a conflict rather than an overwrite.
use super::{
    ConfigFormat, ConfigIdentity, ConfigPortError, ConfigScanner, ConfigSnapshot, LocalSnapshot,
    managed::ManagedDocument,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

pub const MAX_TRANSITION_ACTIONS: usize = 128;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionAction {
    pub expected: ConfigSnapshot,
    pub desired: ConfigSnapshot,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionStep {
    pub action: TransitionAction,
    /// Written before dispatch. An absent receipt in the apply journal proves no file action was
    /// authorized only when the selected content still equals this step's expected snapshot.
    pub receipt: Option<String>,
    pub applied: bool,
    pub restored: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransitionPhase {
    Prepared,
    Applying,
    FilesReady,
    Restoring,
    Restored,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionRecord {
    pub schema: u32,
    pub id: String,
    pub from_profile: String,
    pub to_profile: String,
    pub phase: TransitionPhase,
    /// Canonical roots are encrypted metadata used only for comparison, never path authority.
    pub realms: BTreeMap<String, String>,
    pub steps: Vec<TransitionStep>,
}
pub struct TransitionRead {
    pub revision: String,
    pub record: TransitionRecord,
}
pub trait ConfigTransitionStore: Send + Sync {
    fn load(&self) -> Result<Option<TransitionRead>, ConfigPortError>;
    fn save(
        &self,
        expected_revision: Option<&str>,
        record: &TransitionRecord,
    ) -> Result<(), ConfigPortError>;
}
impl TransitionRecord {
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.validate()?;
        let bytes = Zeroizing::new(serde_json::to_vec(self).map_err(|_| ConfigPortError::Invalid)?);
        if bytes.len() > super::managed::MAX_MANAGED_BYTES {
            return Err(ConfigPortError::Limit);
        }
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, ConfigPortError> {
        if bytes.len() > super::managed::MAX_MANAGED_BYTES {
            return Err(ConfigPortError::Limit);
        }
        let record: Self = serde_json::from_slice(bytes).map_err(|_| ConfigPortError::Invalid)?;
        record.validate()?;
        Ok(record)
    }
    fn validate(&self) -> Result<(), ConfigPortError> {
        if self.schema != 1
            || !canonical_uuid(&self.id)
            || !profile_id(&self.from_profile)
            || !profile_id(&self.to_profile)
            || self.from_profile == self.to_profile
            || self.steps.len() > MAX_TRANSITION_ACTIONS
            || self.realms.len() > 6
            || self.realms.iter().any(|(name, path)| {
                name.len() > 128 || path.len() > 32768 || path.chars().any(char::is_control)
            })
        {
            return Err(ConfigPortError::Invalid);
        }
        for step in &self.steps {
            step.action.expected.encode()?;
            step.action.desired.encode()?;
            if step.action.expected.identity != step.action.desired.identity
                || step.action.desired.identity.requires_vendor()
                || step.receipt.as_ref().is_some_and(|id| !canonical_uuid(id))
                || step.applied && step.receipt.is_none()
                || step.restored && step.receipt.is_none()
                || self.phase == TransitionPhase::Prepared
                    && (step.receipt.is_some() || step.applied || step.restored)
                || self.phase == TransitionPhase::FilesReady && (!step.applied || step.restored)
                || self.phase == TransitionPhase::Restored
                    && step.receipt.is_some()
                    && !step.restored
            {
                return Err(ConfigPortError::Invalid);
            }
        }
        Ok(())
    }
}
fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
}
fn profile_id(value: &str) -> bool {
    value == "local" || canonical_uuid(value)
}
fn save_transition(
    store: &dyn ConfigTransitionStore,
    record: &TransitionRecord,
) -> Result<(), ConfigPortError> {
    let previous = store.load()?;
    if previous
        .as_ref()
        .is_none_or(|old| old.record.id != record.id)
    {
        return Err(ConfigPortError::Stale);
    }
    store.save(previous.as_ref().map(|old| old.revision.as_str()), record)
}

impl ConfigScanner {
    pub fn transition_record(
        &self,
        from_profile: &str,
        to_profile: &str,
        plan: &TransitionPlan,
    ) -> Result<TransitionRecord, ConfigPortError> {
        let record = TransitionRecord {
            schema: 1,
            id: uuid::Uuid::now_v7().to_string(),
            from_profile: from_profile.into(),
            to_profile: to_profile.into(),
            phase: TransitionPhase::Prepared,
            realms: self.transition_realms()?,
            steps: plan
                .actions
                .iter()
                .cloned()
                .map(|action| TransitionStep {
                    action,
                    receipt: None,
                    applied: false,
                    restored: false,
                })
                .collect(),
        };
        record.encode()?;
        Ok(record)
    }
    fn transition_realms(&self) -> Result<BTreeMap<String, String>, ConfigPortError> {
        let mut realms = BTreeMap::new();
        for source in &self.sources {
            if !source.installed {
                continue;
            }
            let root = match std::fs::canonicalize(&source.source.root) {
                Ok(root) => root,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    source.source.root.clone()
                }
                Err(_) => return Err(ConfigPortError::Unavailable),
            };
            realms.insert(
                source.source.id.clone(),
                root.to_str().ok_or(ConfigPortError::Invalid)?.into(),
            );
        }
        realms.insert(
            "home".into(),
            self.home.to_str().ok_or(ConfigPortError::Invalid)?.into(),
        );
        Ok(realms)
    }
    /// The host must have durably written its nonsecret recovery locator before calling this.
    /// Any failure leaves that locator and encrypted transaction in place until recovery.
    pub fn apply_profile_transition(
        &self,
        record: &mut TransitionRecord,
        store: &dyn ConfigTransitionStore,
        journal: &dyn super::ConfigApplyJournal,
    ) -> Result<(), ConfigPortError> {
        record.validate()?;
        if self.transition_realms()? != record.realms
            || !matches!(
                record.phase,
                TransitionPhase::Prepared | TransitionPhase::Applying
            )
        {
            return Err(ConfigPortError::Stale);
        }
        record.phase = TransitionPhase::Applying;
        save_transition(store, record)?;
        for index in 0..record.steps.len() {
            if record.steps[index].applied {
                continue;
            }
            // A dispatched but unacknowledged action is recovery, never an automatic replay.
            if record.steps[index].receipt.is_some() {
                return Err(ConfigPortError::Stale);
            }
            let action = &record.steps[index].action;
            let expected = if action.expected.content.is_none() {
                LocalSnapshot::Absent
            } else {
                LocalSnapshot::Present(action.expected.clone())
            };
            let prepared = match self.prepare_apply(action.desired.clone(), &expected)? {
                super::ConfigApplyPreparation::Ready(prepared) => prepared,
                super::ConfigApplyPreparation::Skipped(_) => {
                    return Err(ConfigPortError::Unavailable);
                }
            };
            record.steps[index].receipt = Some(prepared.preview().id.clone());
            save_transition(store, record)?;
            match self.apply(*prepared, journal)? {
                super::ConfigApplyResult::Applied { .. } => {}
                super::ConfigApplyResult::NeedsRecovery { .. } => {
                    return Err(ConfigPortError::Storage);
                }
            }
            record.steps[index].applied = true;
            save_transition(store, record)?;
        }
        self.verify_transition_side(record, false)?;
        record.phase = TransitionPhase::FilesReady;
        save_transition(store, record)
    }
    pub fn restore_profile_transition(
        &self,
        record: &mut TransitionRecord,
        store: &dyn ConfigTransitionStore,
        journal: &dyn super::ConfigApplyJournal,
    ) -> Result<(), ConfigPortError> {
        record.validate()?;
        if self.transition_realms()? != record.realms {
            return Err(ConfigPortError::Stale);
        }
        record.phase = TransitionPhase::Restoring;
        save_transition(store, record)?;
        for index in (0..record.steps.len()).rev() {
            if record.steps[index].restored || record.steps[index].receipt.is_none() {
                continue;
            }
            let id = record.steps[index]
                .receipt
                .as_deref()
                .ok_or(ConfigPortError::Invalid)?;
            if journal.list()?.iter().any(|known| known == id) {
                match self.rollback_apply(id, journal)? {
                    super::ConfigApplyResult::Applied { .. } => {}
                    super::ConfigApplyResult::NeedsRecovery { .. } => {
                        return Err(ConfigPortError::Storage);
                    }
                }
            } else if self.transition_snapshot(&record.steps[index].action.expected.identity)?
                != record.steps[index].action.expected
            {
                return Err(ConfigPortError::Stale);
            }
            record.steps[index].restored = true;
            save_transition(store, record)?;
        }
        self.verify_transition_side(record, true)?;
        record.phase = TransitionPhase::Restored;
        save_transition(store, record)
    }
    pub fn verify_transition_side(
        &self,
        record: &TransitionRecord,
        original: bool,
    ) -> Result<(), ConfigPortError> {
        record.validate()?;
        if self.transition_realms()? != record.realms {
            return Err(ConfigPortError::Stale);
        }
        let mut expected = BTreeMap::new();
        for step in &record.steps {
            let id = step.action.expected.identity.id()?;
            if original {
                expected.entry(id).or_insert(&step.action.expected);
            } else {
                expected.insert(id, &step.action.desired);
            }
        }
        for value in expected.values() {
            if self.transition_snapshot(&value.identity)? != **value {
                return Err(ConfigPortError::Stale);
            }
        }
        Ok(())
    }
}
pub struct TransitionPlan {
    /// Durably preserve these outgoing observations before the first filesystem action.
    pub outgoing: Option<ManagedDocument>,
    /// Ordered outgoing baseline restores followed by incoming Account applications.
    pub actions: Vec<TransitionAction>,
}

impl ConfigScanner {
    pub fn plan_profile_transition(
        &self,
        outgoing: Option<&ManagedDocument>,
        incoming: Option<&ManagedDocument>,
    ) -> Result<TransitionPlan, ConfigPortError> {
        for document in [outgoing, incoming].into_iter().flatten() {
            document.encode()?;
            if document.has_pending() {
                return Err(ConfigPortError::Stale);
            }
        }
        let mut identities = BTreeMap::new();
        for document in [outgoing, incoming].into_iter().flatten() {
            for (id, item) in &document.items {
                if item.committed {
                    identities.insert(id.clone(), item.saved.identity.clone());
                }
            }
        }
        let identities: Vec<_> = identities.into_values().collect();
        for (index, left) in identities.iter().enumerate() {
            for right in &identities[index + 1..] {
                if self.overlapping_config(left, right)? {
                    return Err(ConfigPortError::Invalid);
                }
            }
        }
        let mut plan = TransitionPlan {
            outgoing: outgoing.cloned(),
            actions: Vec::new(),
        };
        let mut restored = BTreeMap::new();
        if let Some(document) = &mut plan.outgoing {
            for (id, item) in &mut document.items {
                if !item.committed {
                    continue;
                }
                let current = self.transition_snapshot(&item.saved.identity)?;
                item.saved = current.clone();
                restored.insert(id.clone(), item.baseline.clone());
                push_action(&mut plan.actions, current, item.baseline.clone())?;
            }
            document.encode()?;
        }
        if let Some(document) = incoming {
            for (id, item) in &document.items {
                if !item.committed {
                    continue;
                }
                let current = match restored.get(id) {
                    Some(value) => value.clone(),
                    None => self.transition_snapshot(&item.saved.identity)?,
                };
                if current != item.baseline {
                    return Err(ConfigPortError::Stale);
                }
                push_action(&mut plan.actions, current, item.saved.clone())?;
            }
        }
        Ok(plan)
    }
    pub fn transition_snapshot(
        &self,
        identity: &ConfigIdentity,
    ) -> Result<ConfigSnapshot, ConfigPortError> {
        match self.observe(identity)? {
            LocalSnapshot::Present(snapshot) => Ok(snapshot),
            LocalSnapshot::Absent => Ok(ConfigSnapshot::tombstone(identity.clone())),
            LocalSnapshot::Unavailable => Err(ConfigPortError::Unavailable),
        }
    }
    fn overlapping_config(
        &self,
        left: &ConfigIdentity,
        right: &ConfigIdentity,
    ) -> Result<bool, ConfigPortError> {
        let address = |identity: &ConfigIdentity| -> Result<String, ConfigPortError> {
            let source = self
                .source(identity)
                .filter(|source| source.installed)
                .ok_or(ConfigPortError::Unavailable)?;
            let root = std::fs::canonicalize(&source.source.root)
                .map_err(|_| ConfigPortError::Unavailable)?;
            let text = root
                .join(&identity.path)
                .to_str()
                .ok_or(ConfigPortError::Invalid)?
                .replace('\\', "/");
            Ok(if self.platform == super::ConfigScope::Windows {
                text.to_lowercase()
            } else {
                text
            })
        };
        let a = address(left)?;
        let b = address(right)?;
        if a != b {
            return Ok(
                left.format == ConfigFormat::Tree && b.starts_with(&format!("{a}/"))
                    || right.format == ConfigFormat::Tree && a.starts_with(&format!("{b}/")),
            );
        }
        if matches!(left.format, ConfigFormat::File | ConfigFormat::Tree)
            || matches!(right.format, ConfigFormat::File | ConfigFormat::Tree)
        {
            return Ok(true);
        }
        let keys = |identity: &ConfigIdentity| {
            let mut keys = identity.keys.clone();
            if identity.format == ConfigFormat::Mcp {
                keys.insert(
                    0,
                    if identity.provider == crate::Provider::Codex {
                        "mcp_servers"
                    } else {
                        "mcpServers"
                    }
                    .into(),
                );
            }
            keys
        };
        let a = keys(left);
        let b = keys(right);
        Ok(a.starts_with(&b) || b.starts_with(&a))
    }
}
fn push_action(
    actions: &mut Vec<TransitionAction>,
    expected: ConfigSnapshot,
    desired: ConfigSnapshot,
) -> Result<(), ConfigPortError> {
    if expected == desired {
        return Ok(());
    }
    if desired.identity.requires_vendor() {
        return Err(ConfigPortError::Unavailable);
    }
    if actions.len() == MAX_TRANSITION_ACTIONS {
        return Err(ConfigPortError::Limit);
    }
    actions.push(TransitionAction { expected, desired });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Provider, Scope, Source,
        sync::{
            ConfigContent, ConfigScope, ConfigSource,
            managed::{ManagedItem, PendingClaim},
        },
    };
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    #[derive(Default)]
    struct Memory {
        bytes: Mutex<Option<Vec<u8>>>,
        count: AtomicUsize,
        fail_at: AtomicUsize,
    }
    impl ConfigTransitionStore for Memory {
        fn load(&self) -> Result<Option<TransitionRead>, ConfigPortError> {
            self.bytes
                .lock()
                .unwrap()
                .as_ref()
                .map(|bytes| {
                    Ok(TransitionRead {
                        revision: crate::safe_fs::hash(bytes),
                        record: TransitionRecord::decode(bytes)?,
                    })
                })
                .transpose()
        }
        fn save(
            &self,
            expected: Option<&str>,
            record: &TransitionRecord,
        ) -> Result<(), ConfigPortError> {
            let mut bytes = self.bytes.lock().unwrap();
            if bytes
                .as_ref()
                .map(|bytes| crate::safe_fs::hash(bytes))
                .as_deref()
                != expected
            {
                return Err(ConfigPortError::Stale);
            }
            if self.count.fetch_add(1, Ordering::SeqCst) + 1 == self.fail_at.load(Ordering::SeqCst)
            {
                return Err(ConfigPortError::Storage);
            }
            *bytes = Some(record.encode()?.to_vec());
            Ok(())
        }
    }
    #[derive(Default)]
    struct Journal(Mutex<BTreeMap<String, Vec<u8>>>);
    impl super::super::ConfigApplyJournal for Journal {
        fn create(&self, id: &str, bytes: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError> {
            let mut map = self.0.lock().unwrap();
            if map.contains_key(id) {
                return Err(ConfigPortError::Stale);
            }
            map.insert(id.into(), bytes.to_vec());
            Ok(())
        }
        fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
            self.0
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
            let mut map = self.0.lock().unwrap();
            if map
                .get(id)
                .map(|bytes| crate::safe_fs::hash(bytes))
                .as_deref()
                != Some(hash)
            {
                return Err(ConfigPortError::Stale);
            }
            map.insert(id.into(), bytes.to_vec());
            Ok(())
        }
        fn list(&self) -> Result<Vec<String>, ConfigPortError> {
            Ok(self.0.lock().unwrap().keys().cloned().collect())
        }
    }
    fn snapshot(value: &str) -> ConfigSnapshot {
        ConfigSnapshot {
            schema: 1,
            identity: ConfigIdentity {
                provider: Provider::Claude,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Json,
                path: "settings.json".into(),
                keys: vec!["model".into()],
            },
            content: Some(ConfigContent::Value(value.into())),
            local_fields: vec![],
        }
    }
    fn managed(baseline: ConfigSnapshot, saved: ConfigSnapshot) -> ManagedDocument {
        let id = baseline.identity.id().unwrap();
        ManagedDocument {
            schema: 1,
            items: BTreeMap::from([(
                id,
                ManagedItem {
                    baseline,
                    saved,
                    committed: true,
                    pending: None,
                },
            )]),
        }
    }
    fn scanner(root: &std::path::Path) -> ConfigScanner {
        ConfigScanner::new(
            vec![ConfigSource {
                source: Source {
                    id: "user:claude".into(),
                    provider: Provider::Claude,
                    scope: Scope::User,
                    root: root.into(),
                    claude_state_only: false,
                },
                installed: true,
            }],
            root.into(),
            ConfigScope::Windows,
        )
        .unwrap()
    }
    #[test]
    fn outgoing_edits_are_preserved_then_incoming_applies_against_the_original_baseline() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("settings.json"),
            r#"{"model":"edited-a","unmanaged":42}"#,
        )
        .unwrap();
        let scanner = scanner(temp.path());
        let a = managed(snapshot("local"), snapshot("saved-a"));
        let b = managed(snapshot("local"), snapshot("saved-b"));
        let plan = scanner.plan_profile_transition(Some(&a), Some(&b)).unwrap();
        assert_eq!(plan.actions.len(), 2);
        assert!(plan.actions[0].expected == snapshot("edited-a"));
        assert!(plan.actions[0].desired == snapshot("local"));
        assert!(plan.actions[1].desired == snapshot("saved-b"));
        assert!(
            plan.outgoing.unwrap().items.values().next().unwrap().saved == snapshot("edited-a")
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("settings.json")).unwrap(),
            r#"{"model":"edited-a","unmanaged":42}"#
        );
    }
    #[test]
    fn incoming_unmanaged_conflict_or_pending_claim_never_plans_an_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("settings.json"),
            r#"{"model":"new-unmanaged"}"#,
        )
        .unwrap();
        let scanner = scanner(temp.path());
        let mut incoming = managed(snapshot("local"), snapshot("account"));
        assert!(matches!(
            scanner.plan_profile_transition(None, Some(&incoming)),
            Err(ConfigPortError::Stale)
        ));
        incoming.items.values_mut().next().unwrap().pending = Some(PendingClaim {
            token: uuid::Uuid::now_v7().to_string(),
            desired_hash: "a".repeat(64),
        });
        assert!(matches!(
            scanner.plan_profile_transition(None, Some(&incoming)),
            Err(ConfigPortError::Stale)
        ));
    }
    #[test]
    fn overlapping_parent_child_fields_are_rejected_before_any_file_action() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("settings.json"), "{}").unwrap();
        let scanner = scanner(temp.path());
        let first = snapshot("value");
        let mut second = first.clone();
        second.identity.keys.push("child".into());
        let a = managed(first.clone(), first);
        let b = managed(second.clone(), second);
        assert!(matches!(
            scanner.plan_profile_transition(Some(&a), Some(&b)),
            Err(ConfigPortError::Invalid)
        ));
    }
    #[test]
    fn applied_transition_is_durable_and_rollback_restores_original_managed_values() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("settings.json"),
            r#"{"model":"a","unmanaged":42}"#,
        )
        .unwrap();
        let scanner = scanner(temp.path());
        let a = managed(snapshot("local"), snapshot("a"));
        let b = managed(snapshot("local"), snapshot("b"));
        let plan = scanner.plan_profile_transition(Some(&a), Some(&b)).unwrap();
        let mut record = scanner
            .transition_record(
                &uuid::Uuid::now_v7().to_string(),
                &uuid::Uuid::now_v7().to_string(),
                &plan,
            )
            .unwrap();
        let store = Memory::default();
        store.save(None, &record).unwrap();
        let journal = Journal::default();
        scanner
            .apply_profile_transition(&mut record, &store, &journal)
            .unwrap();
        assert_eq!(
            store.load().unwrap().unwrap().record.phase,
            TransitionPhase::FilesReady
        );
        assert!(
            scanner
                .transition_snapshot(&snapshot("b").identity)
                .unwrap()
                == snapshot("b")
        );
        scanner
            .restore_profile_transition(&mut record, &store, &journal)
            .unwrap();
        assert!(
            scanner
                .transition_snapshot(&snapshot("a").identity)
                .unwrap()
                == snapshot("a")
        );
        assert_eq!(
            store.load().unwrap().unwrap().record.phase,
            TransitionPhase::Restored
        );
        assert!(
            std::fs::read_to_string(temp.path().join("settings.json"))
                .unwrap()
                .contains("\"unmanaged\":42")
        );
    }
    #[test]
    fn lost_step_acknowledgment_reopens_for_rollback_without_overwriting_unmanaged_edits() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("settings.json"),
            r#"{"model":"a","unmanaged":42}"#,
        )
        .unwrap();
        let scanner = scanner(temp.path());
        let a = managed(snapshot("local"), snapshot("a"));
        let b = managed(snapshot("local"), snapshot("b"));
        let plan = scanner.plan_profile_transition(Some(&a), Some(&b)).unwrap();
        let mut record = scanner
            .transition_record(
                &uuid::Uuid::now_v7().to_string(),
                &uuid::Uuid::now_v7().to_string(),
                &plan,
            )
            .unwrap();
        let store = Memory::default();
        store.fail_at.store(4, Ordering::SeqCst);
        store.save(None, &record).unwrap();
        let journal = Journal::default();
        assert_eq!(
            scanner.apply_profile_transition(&mut record, &store, &journal),
            Err(ConfigPortError::Storage)
        );
        let mut reopened = store.load().unwrap().unwrap().record;
        assert!(!reopened.steps[0].applied);
        assert!(reopened.steps[0].receipt.is_some());
        assert!(reopened.steps[1].receipt.is_none());
        std::fs::write(
            temp.path().join("settings.json"),
            r#"{"model":"local","unmanaged":99}"#,
        )
        .unwrap();
        scanner
            .restore_profile_transition(&mut reopened, &store, &journal)
            .unwrap();
        assert!(
            scanner
                .transition_snapshot(&snapshot("a").identity)
                .unwrap()
                == snapshot("a")
        );
        assert!(
            std::fs::read_to_string(temp.path().join("settings.json"))
                .unwrap()
                .contains("\"unmanaged\":99")
        );
    }
}
