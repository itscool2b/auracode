//! Shared-home configuration transition coordinator. It owns only explicit managed identities;
//! the caller keeps profile, terminal, session and Library admission closed through publication.
use crate::{
    account_config::AccountConfigServices,
    error::{AppError, AppErrorCode},
    sessions::ChatRuntime,
};
use aura_config::sync::{
    ConfigApplyStatus, ConfigScanner,
    managed::ManagedRead,
    profile_transition::{ConfigTransitionStore, TransitionPhase, TransitionRecord},
};
use aura_core::config_transition::{TransitionLease, TransitionLocator};
use std::{path::Path, sync::Arc};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigProfileRecoveryPhase {
    RestorePrevious,
    FinishSwitch,
    Unavailable,
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct ConfigProfileRecovery {
    pub transaction: Option<String>,
    pub owner_profile: Option<String>,
    pub from_profile: Option<String>,
    pub to_profile: Option<String>,
    pub phase: ConfigProfileRecoveryPhase,
    pub detail: String,
}
pub fn status(root: &Path, current: Option<&str>) -> Option<ConfigProfileRecovery> {
    match aura_core::config_transition::pending(root) {
        Ok(None) => None,
        Ok(Some(locator)) => {
            let saved = aura_core::config_transition::active_profile(root).ok();
            let current = current.filter(|id| Some(*id) == saved.as_deref());
            let (phase, detail) = if current == Some(locator.from_profile.as_str()) {
                (ConfigProfileRecoveryPhase::RestorePrevious, "A configuration switch was interrupted. Restore the previous profile's managed configuration before continuing.")
            } else if current == Some(locator.to_profile.as_str()) {
                (ConfigProfileRecoveryPhase::FinishSwitch, "The selected profile's configuration needs verification before the switch can finish.")
            } else {
                (ConfigProfileRecoveryPhase::Unavailable, "The saved profile does not match the pending configuration switch. Existing data is preserved; recovery cannot guess which profile to use.")
            };
            Some(ConfigProfileRecovery {
                transaction: Some(locator.transaction), owner_profile: Some(locator.owner_profile),
                from_profile: Some(locator.from_profile), to_profile: Some(locator.to_profile), phase, detail: detail.into(),
            })
        }
        Err(_) => Some(ConfigProfileRecovery {
            transaction: None, owner_profile: None, from_profile: None, to_profile: None,
            phase: ConfigProfileRecoveryPhase::Unavailable,
            detail: "The configuration recovery record could not be read. Existing configuration is preserved; repair the app data access or restore its recovery metadata before continuing.".into(),
        }),
    }
}
pub(crate) fn error() -> AppError {
    AppError::new(
        AppErrorCode::StorageUnavailable,
        "Configuration switching could not finish. Existing managed snapshots and recovery data were preserved. Resolve configuration recovery or conflicts before retrying.",
    )
}

pub(crate) struct Staged {
    lease: TransitionLease,
    locator: TransitionLocator,
    scanner: ConfigScanner,
    owner: Arc<AccountConfigServices>,
    record: TransitionRecord,
    journal: Arc<aura_core::sync::journal::AccountConfigJournal>,
}
impl Staged {
    pub fn rollback(mut self) -> Result<(), AppError> {
        // Reopen the acknowledged record. The in-memory step may be ahead of storage after a
        // failed completion write; its persisted dispatch receipt is the recovery authority.
        self.record = self
            .owner
            .transitions
            .load()
            .map_err(|_| error())?
            .ok_or_else(error)?
            .record;
        self.verify_binding()?;
        self.scanner
            .restore_profile_transition(
                &mut self.record,
                self.owner.transitions.as_ref(),
                self.journal.as_ref(),
            )
            .map_err(|_| error())?;
        self.lease.clear(&self.locator).map_err(|_| error())
    }
    pub fn finish(self) -> Result<(), AppError> {
        self.verify_binding()?;
        if self.record.phase != TransitionPhase::FilesReady {
            return Err(error());
        }
        self.scanner
            .verify_transition_side(&self.record, false)
            .map_err(|_| error())?;
        self.lease.clear(&self.locator).map_err(|_| error())
    }
    fn verify_binding(&self) -> Result<(), AppError> {
        if self.record.id != self.locator.transaction
            || self.record.from_profile != self.locator.from_profile
            || self.record.to_profile != self.locator.to_profile
            || self.lease.pending().map_err(|_| error())?.as_ref() != Some(&self.locator)
        {
            return Err(error());
        }
        Ok(())
    }
}

fn read(service: Option<&Arc<AccountConfigServices>>) -> Result<Option<ManagedRead>, AppError> {
    service
        .map(|service| service.managed.load())
        .transpose()
        .map_err(|_| error())
}
pub(crate) async fn prepare(
    root: &Path,
    from: &str,
    to: &str,
    old: Option<&Arc<ChatRuntime>>,
    next: &Arc<ChatRuntime>,
) -> Result<Option<Staged>, AppError> {
    if from == to {
        return Ok(None);
    }
    let outgoing = old.and_then(|old| old.account_config.clone());
    let incoming = next.account_config.clone();
    // Cross-Account switches must pass through a quiescent Local phase. One Account's key must
    // never decrypt the other Account's saved settings from a retained transition receipt.
    if outgoing.is_some() && incoming.is_some() {
        return Err(error());
    }
    let out = read(outgoing.as_ref())?;
    let into = read(incoming.as_ref())?;
    if out
        .iter()
        .chain(into.iter())
        .any(|read| read.document.has_pending())
    {
        return Err(error());
    }
    if !out
        .iter()
        .chain(into.iter())
        .any(|read| read.document.items.values().any(|item| item.committed))
    {
        return Ok(None);
    }
    let (scanner, _) = next.manager.config_sync_scanner().await?;
    if let Some(old) = old {
        let (previous, _) = old.manager.config_sync_scanner().await?;
        if !scanner.same_sources(&previous) {
            return Err(error());
        }
    }
    let root = root.to_path_buf();
    let from = from.to_owned();
    let to = to.to_owned();
    tokio::task::spawn_blocking(move || {
        let lease = TransitionLease::acquire(&root).map_err(|_| error())?;
        if lease.pending().map_err(|_| error())?.is_some() {
            return Err(error());
        }
        for service in outgoing.iter().chain(incoming.iter()) {
            if scanner
                .apply_history(service.journal.as_ref())
                .map_err(|_| error())?
                .iter()
                .any(|record| record.status == ConfigApplyStatus::RecoveryRequired)
            {
                return Err(error());
            }
        }
        let plan = scanner
            .plan_profile_transition(
                out.as_ref().map(|read| &read.document),
                into.as_ref().map(|read| &read.document),
            )
            .map_err(|_| error())?;
        if let (Some(outgoing), Some(out), Some(document)) = (&outgoing, &out, &plan.outgoing) {
            outgoing
                .managed
                .save(&out.revision, document)
                .map_err(|_| error())?;
        }
        if plan.actions.is_empty() {
            return Ok(None);
        }
        let owner_profile = if outgoing.is_some() {
            from.clone()
        } else {
            to.clone()
        };
        let owner = outgoing.or(incoming).ok_or_else(error)?;
        let record = scanner
            .transition_record(&from, &to, &plan)
            .map_err(|_| error())?;
        let previous = owner.transitions.load().map_err(|_| error())?;
        owner
            .transitions
            .save(
                previous.as_ref().map(|previous| previous.revision.as_str()),
                &record,
            )
            .map_err(|_| error())?;
        let journal = owner.transitions.journal(&record.id).map_err(|_| error())?;
        let locator = TransitionLocator {
            schema: 1,
            transaction: record.id.clone(),
            owner_profile,
            from_profile: from,
            to_profile: to,
        };
        lease.create(&locator).map_err(|_| error())?;
        let mut staged = Staged {
            lease,
            locator,
            scanner,
            owner,
            record,
            journal,
        };
        if staged
            .scanner
            .apply_profile_transition(
                &mut staged.record,
                staged.owner.transitions.as_ref(),
                staged.journal.as_ref(),
            )
            .is_err()
        {
            // Even a confirmed rollback leaves the original switch failed. A failed rollback keeps
            // the locator so startup and subsequent commands remain visibly blocked.
            let _ = staged.rollback();
            return Err(error());
        }
        Ok(Some(staged))
    })
    .await
    .map_err(|_| error())?
}

/// Called only from explicit native recovery after unlocking the owning Account and taking the
/// same admission gates as a profile switch. No configuration authority arrives from the renderer.
pub(crate) fn recover(
    root: &Path,
    current: &str,
    scanner: ConfigScanner,
    transitions: &aura_core::sync::config_transition::AccountConfigTransitions,
) -> Result<(), AppError> {
    let lease = TransitionLease::acquire(root).map_err(|_| error())?;
    if aura_core::config_transition::active_profile(root)
        .ok()
        .as_deref()
        != Some(current)
    {
        return Err(error());
    }
    let locator = lease.pending().map_err(|_| error())?.ok_or_else(error)?;
    let mut record = transitions
        .load()
        .map_err(|_| error())?
        .ok_or_else(error)?
        .record;
    if record.id != locator.transaction
        || record.from_profile != locator.from_profile
        || record.to_profile != locator.to_profile
    {
        return Err(error());
    }
    let journal = transitions.journal(&record.id).map_err(|_| error())?;
    if current == locator.from_profile {
        scanner
            .restore_profile_transition(&mut record, transitions, journal.as_ref())
            .map_err(|_| error())?;
    } else if current == locator.to_profile && record.phase == TransitionPhase::FilesReady {
        scanner
            .verify_transition_side(&record, false)
            .map_err(|_| error())?;
    } else {
        return Err(error());
    }
    lease.clear(&locator).map_err(|_| error())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_config::{
        Provider, Scope, Source,
        sync::{
            ConfigContent, ConfigFormat, ConfigIdentity, ConfigScope, ConfigSnapshot, ConfigSource,
            profile_transition::{TransitionAction, TransitionPlan},
        },
    };
    use aura_core::sync::config_transition::AccountConfigTransitions;
    use aura_sync::crypto::AccountKey;
    fn snapshot(model: &str) -> ConfigSnapshot {
        ConfigSnapshot {
            schema: 1,
            identity: ConfigIdentity {
                provider: Provider::Claude,
                scope: ConfigScope::Portable,
                format: ConfigFormat::Json,
                path: "settings.json".into(),
                keys: vec!["model".into()],
            },
            content: Some(ConfigContent::Value(model.into())),
            local_fields: vec![],
        }
    }
    fn scanner(path: &Path) -> ConfigScanner {
        ConfigScanner::new(
            vec![ConfigSource {
                source: Source {
                    id: "user:claude".into(),
                    provider: Provider::Claude,
                    scope: Scope::User,
                    root: path.into(),
                    claude_state_only: false,
                },
                installed: true,
                version: None,
                paused: false,
            }],
            path.into(),
            ConfigScope::Windows,
        )
        .unwrap()
    }
    struct Fixture {
        temp: tempfile::TempDir,
        vendor: std::path::PathBuf,
        locator: TransitionLocator,
        transitions: AccountConfigTransitions,
    }
    impl Fixture {
        fn applied() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let owner = uuid::Uuid::now_v7().to_string();
            let vendor = temp.path().join("fixture-vendor");
            std::fs::create_dir(&vendor).unwrap();
            std::fs::write(
                vendor.join("settings.json"),
                r#"{"model":"local","unmanaged":42}"#,
            )
            .unwrap();
            std::fs::write(
                temp.path().join("state.json"),
                r#"{"active_profile":"local"}"#,
            )
            .unwrap();
            let key = Arc::new(
                AccountKey::generate()
                    .unwrap()
                    .profile_file_key("fixture-account", &owner)
                    .unwrap(),
            );
            let transitions =
                AccountConfigTransitions::open(&temp.path().join("profiles").join(&owner), key)
                    .unwrap();
            let scanner = scanner(&vendor);
            let mut record = scanner
                .transition_record(
                    "local",
                    &owner,
                    &TransitionPlan {
                        outgoing: None,
                        actions: vec![TransitionAction {
                            expected: snapshot("local"),
                            desired: snapshot("account"),
                        }],
                    },
                )
                .unwrap();
            transitions.save(None, &record).unwrap();
            let locator = TransitionLocator {
                schema: 1,
                transaction: record.id.clone(),
                owner_profile: owner.clone(),
                from_profile: "local".into(),
                to_profile: owner,
            };
            let lease = TransitionLease::acquire(temp.path()).unwrap();
            lease.create(&locator).unwrap();
            let journal = transitions.journal(&record.id).unwrap();
            scanner
                .apply_profile_transition(&mut record, &transitions, journal.as_ref())
                .unwrap();
            Self {
                temp,
                vendor,
                locator,
                transitions,
            }
        }
    }
    #[test]
    fn failed_publication_recovers_original_values_without_reverting_unmanaged_edits() {
        let fixture = Fixture::applied();
        assert_eq!(
            status(fixture.temp.path(), Some("local")).unwrap().phase,
            ConfigProfileRecoveryPhase::RestorePrevious
        );
        std::fs::write(
            fixture.vendor.join("settings.json"),
            r#"{"model":"account","unmanaged":99}"#,
        )
        .unwrap();
        recover(
            fixture.temp.path(),
            "local",
            scanner(&fixture.vendor),
            &fixture.transitions,
        )
        .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(fixture.vendor.join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(value["model"], "local");
        assert_eq!(value["unmanaged"], 99);
        assert!(status(fixture.temp.path(), Some("local")).is_none());
    }
    #[test]
    fn published_side_requires_exact_managed_content_before_clearing_recovery() {
        let fixture = Fixture::applied();
        let owner = &fixture.locator.owner_profile;
        std::fs::write(
            fixture.temp.path().join("state.json"),
            serde_json::to_vec(&serde_json::json!({"active_profile": owner})).unwrap(),
        )
        .unwrap();
        assert_eq!(
            status(fixture.temp.path(), Some(owner)).unwrap().phase,
            ConfigProfileRecoveryPhase::FinishSwitch
        );
        std::fs::write(
            fixture.vendor.join("settings.json"),
            r#"{"model":"external","unmanaged":42}"#,
        )
        .unwrap();
        assert!(
            recover(
                fixture.temp.path(),
                owner,
                scanner(&fixture.vendor),
                &fixture.transitions
            )
            .is_err()
        );
        assert!(
            aura_core::config_transition::pending(fixture.temp.path())
                .unwrap()
                .is_some()
        );
        std::fs::write(
            fixture.vendor.join("settings.json"),
            r#"{"model":"account","unmanaged":42}"#,
        )
        .unwrap();
        recover(
            fixture.temp.path(),
            owner,
            scanner(&fixture.vendor),
            &fixture.transitions,
        )
        .unwrap();
        assert!(
            aura_core::config_transition::pending(fixture.temp.path())
                .unwrap()
                .is_none()
        );
    }
}
