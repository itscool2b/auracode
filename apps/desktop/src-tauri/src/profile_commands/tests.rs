use super::*;
use crate::{glass::GlassEffect, launch::LaunchOptions, os::OsInfo};
use aura_core::{chatstore::NewChat, owner::ProfileOwner};
use aura_sync::crypto::AccountKey;

fn sync_context(key: Arc<AccountKey>) -> SyncContext {
    SyncContext {
        identity: SyncIdentity {
            account: "synthetic-account".into(),
            device: "synthetic-device".into(),
            key_version: 1,
        },
        key,
    }
}

fn state(root: &DataRoot) -> AppState {
    let mut booted = boot::boot(Ok(root.clone()));
    let chats = sessions::testing::start(&mut booted);
    AppState::new(
        booted,
        chats,
        &OsInfo {
            os: "windows",
            version: None,
            display: "test".into(),
        },
        GlassEffect::None,
        LaunchOptions::from_lookup(|_| None),
        "0.1.0".into(),
    )
}
fn local(profile: Profile) -> Resolved {
    Resolved { profile, key: None }
}
async fn add_chat(state: &AppState, folder: &std::path::Path) -> String {
    state
        .chats()
        .unwrap()
        .store
        .create_chat(NewChat {
            agent_id: "mock".into(),
            agent_host: Default::default(),
            folder: folder.into(),
            device_id: state.app_info().device.unwrap().device_id,
            now: 1,
        })
        .await
        .unwrap()
        .id
}
async fn close(state: &AppState) {
    if let Some(chats) = state.chats() {
        discard(&chats).await;
    }
}

#[tokio::test]
async fn failed_second_account_phase_publishes_local_and_keeps_account_data_separate() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let profiles = Profiles::new(root.clone());
    let a = profiles.create(ProfileKind::Account, "Account A").unwrap();
    let b = profiles.create(ProfileKind::Account, "Account B").unwrap();
    let key_a = Arc::new(AccountKey::generate().unwrap());
    let key_b = Arc::new(AccountKey::generate().unwrap());
    activate(
        &state,
        Resolved {
            profile: b.clone(),
            key: Some(sync_context(key_b)),
        },
        sessions::testing::outside,
    )
    .await
    .unwrap();
    activate(
        &state,
        Resolved {
            profile: a.clone(),
            key: Some(sync_context(key_a)),
        },
        sessions::testing::outside,
    )
    .await
    .unwrap();
    let preserved = std::fs::read(b.db_path()).unwrap();
    assert!(
        activate(
            &state,
            Resolved {
                profile: b.clone(),
                key: Some(sync_context(Arc::new(AccountKey::generate().unwrap())))
            },
            sessions::testing::outside
        )
        .await
        .is_err()
    );
    assert_eq!(state.app_info().profile.unwrap().id, "local");
    assert_eq!(profiles.open_active().unwrap().meta.id, "local");
    assert!(
        state
            .app_info()
            .notices
            .iter()
            .any(|notice| notice.contains("Local is now selected"))
    );
    assert_eq!(std::fs::read(b.db_path()).unwrap(), preserved);
    assert!(state.sessions().is_ok());
    close(&state).await;
}

#[tokio::test]
async fn pending_configuration_recovery_blocks_desktop_and_direct_native_agent_admission() {
    use aura_core::config_transition::{TransitionLease, TransitionLocator};
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let chat = add_chat(&state, temp.path()).await;
    let owner = uuid::Uuid::now_v7().to_string();
    let locator = TransitionLocator {
        schema: 1,
        transaction: uuid::Uuid::now_v7().to_string(),
        owner_profile: owner.clone(),
        from_profile: "local".into(),
        to_profile: owner,
    };
    let lease = TransitionLease::acquire(root.root()).unwrap();
    lease.create(&locator).unwrap();
    assert!(state.app_info().config_profile_recovery.is_some());
    assert!(state.sessions().is_err());
    assert!(state.onboarding().is_err());
    let result = state.chats().unwrap().manager.start(&chat, false).await;
    assert!(result.is_err_and(|error| error.to_string().contains("Recover the interrupted")));
    lease.clear(&locator).unwrap();
    assert!(state.sessions().is_ok());
    close(&state).await;
}

#[tokio::test]
async fn pending_transition_never_repairs_an_ambiguous_profile_pointer_to_local() {
    use aura_core::config_transition::{TransitionLease, TransitionLocator};
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let owner = uuid::Uuid::now_v7().to_string();
    let locator = TransitionLocator {
        schema: 1,
        transaction: uuid::Uuid::now_v7().to_string(),
        owner_profile: owner.clone(),
        from_profile: "local".into(),
        to_profile: owner,
    };
    TransitionLease::acquire(root.root())
        .unwrap()
        .create(&locator)
        .unwrap();
    std::fs::write(root.root().join("state.json"), b"{interrupted").unwrap();
    let booted = boot::boot(Ok(root.clone()));
    assert!(booted.profile.is_none());
    assert!(booted.fatal.is_none());
    assert_eq!(
        std::fs::read(root.root().join("state.json")).unwrap(),
        b"{interrupted"
    );
    assert_eq!(
        crate::profile_config::status(root.root(), None)
            .unwrap()
            .phase,
        crate::profile_config::ConfigProfileRecoveryPhase::Unavailable
    );
    close(&state).await;
}

#[tokio::test]
async fn switching_keeps_datasets_separate_flushes_and_invalidates_old_channels() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let profiles = Profiles::new(root.clone());
    let first = profiles.open_active().unwrap();
    let chat = add_chat(&state, temp.path()).await;
    let generation = state.sessions().unwrap().generation();
    let page = state.pages.for_status("main");
    let next = profiles
        .create(ProfileKind::Local, "Another local dataset")
        .unwrap();
    let info = activate(&state, local(next.clone()), |_, _, _, _| {
        panic!("reuse services")
    })
    .await
    .unwrap();
    assert_eq!(info.profile.unwrap().id, next.meta.id);
    assert!(!info.profile_switching);
    assert!(!page.is_current());
    assert!(!generation.is_current());
    assert!(!state.pages.for_view("main").is_current());
    assert_eq!(profiles.open_active().unwrap().meta.id, next.meta.id);
    assert!(
        state
            .chats()
            .unwrap()
            .store
            .chats()
            .await
            .unwrap()
            .is_empty()
    );
    activate(&state, local(first), sessions::testing::outside)
        .await
        .unwrap();
    assert_eq!(
        state.chats().unwrap().store.chats().await.unwrap()[0].id,
        chat
    );
    close(&state).await;
}

#[tokio::test]
async fn admitted_command_drains_before_switch_and_new_commands_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let next = Profiles::new(root.clone())
        .create(ProfileKind::Local, "Next")
        .unwrap();
    let lease = state.sessions().unwrap();
    let switching = activate(&state, local(next), sessions::testing::outside);
    tokio::pin!(switching);
    tokio::select! {
        result = &mut switching => panic!("must wait for admitted command: {result:?}"),
        _ = tokio::time::sleep(Duration::from_millis(20)) => {}
    }
    assert!(state.sessions().is_err());
    assert!(state.onboarding().is_err());
    drop(lease);
    switching.await.unwrap();
    assert!(state.sessions().is_ok());
    close(&state).await;
}

#[tokio::test]
async fn a_library_command_paused_after_lease_acquisition_cannot_register_during_profile_drain() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let next = Profiles::new(root)
        .create(ProfileKind::Local, "Next")
        .unwrap();
    let lease = state.sessions().unwrap();
    let generation = lease.generation();
    let mut switching = Box::pin(activate(&state, local(next), sessions::testing::outside));
    // Poll exactly to the held command lease. No timer or scheduling guess releases the command.
    std::future::poll_fn(|cx| {
        assert!(std::future::Future::poll(switching.as_mut(), cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert!(state.sessions().is_err());
    assert!(
        generation.is_current(),
        "the old profile token remains current until publication"
    );
    assert!(
        lease
            .plugin_library_progressive(true, true, Vec::new(), |_| {
                panic!("late registration must be rejected before inventory or helper work")
            })
            .await
            .is_err()
    );
    drop(lease);
    switching.await.unwrap();
    assert!(!generation.is_current());
    assert!(
        state
            .sessions()
            .unwrap()
            .plugin_library_progressive(false, true, Vec::new(), |_| false)
            .await
            .is_ok()
    );
    close(&state).await;
}

#[tokio::test]
async fn abandoned_or_failed_profile_drains_reopen_library_admission_on_the_current_profile() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let next = Profiles::new(root)
        .create(ProfileKind::Local, "Next")
        .unwrap();
    let lease = state.sessions().unwrap();
    let generation = lease.generation();
    let mut switching = Box::pin(activate(
        &state,
        local(next.clone()),
        sessions::testing::outside,
    ));
    std::future::poll_fn(|cx| {
        assert!(std::future::Future::poll(switching.as_mut(), cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert!(
        lease
            .plugin_library_progressive(false, false, Vec::new(), |_| false)
            .await
            .is_err()
    );
    drop(switching);
    assert!(generation.is_current());
    assert!(!state.app_info().profile_switching);
    assert!(
        lease
            .plugin_library_progressive(false, false, Vec::new(), |_| false)
            .await
            .is_ok(),
        "dropping the switch future reopens the same admitted manager"
    );
    drop(lease);
    let terminal = state.terminals.reserve("main").unwrap();
    assert!(
        activate(&state, local(next), sessions::testing::outside)
            .await
            .is_err()
    );
    assert!(generation.is_current());
    assert!(
        state
            .sessions()
            .unwrap()
            .plugin_library_progressive(false, false, Vec::new(), |_| false)
            .await
            .is_ok(),
        "a failed switch reopens the selected profile"
    );
    drop(terminal);
    close(&state).await;
}

#[tokio::test]
async fn reserved_terminal_and_target_owner_failure_preserve_current_profile() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let profiles = Profiles::new(root);
    let first = profiles.open_active().unwrap();
    let next = profiles.create(ProfileKind::Local, "Next").unwrap();
    let ticket = state.terminals.reserve("main").unwrap();
    assert!(
        activate(&state, local(next.clone()), sessions::testing::outside)
            .await
            .is_err()
    );
    assert!(!next.db_path().exists());
    drop(ticket);
    let owner = ProfileOwner::acquire(&next).unwrap();
    assert!(
        activate(&state, local(next), sessions::testing::outside)
            .await
            .is_err()
    );
    assert_eq!(profiles.open_active().unwrap().meta.id, first.meta.id);
    assert_eq!(state.app_info().profile.unwrap().id, first.meta.id);
    assert!(!state.app_info().profile_switching);
    add_chat(&state, temp.path()).await;
    close(&state).await;
    drop(owner);
}

#[tokio::test]
async fn account_activation_is_keyed_and_wrong_key_never_replaces_current_dataset() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    let profiles = Profiles::new(root);
    let first = profiles.open_active().unwrap();
    let account = profiles.create(ProfileKind::Account, "Account").unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let resolved = || Resolved {
        profile: account.clone(),
        key: Some(sync_context(key.clone())),
    };
    activate(&state, resolved(), sessions::testing::outside)
        .await
        .unwrap();
    assert!(account.db_path().exists());
    assert!(!account.dir.join("aura.db").exists());
    assert!(!state.app_info().profile_locked);
    let chat = add_chat(&state, temp.path()).await;
    activate(&state, local(first.clone()), sessions::testing::outside)
        .await
        .unwrap();
    assert!(
        !std::fs::read(account.db_path())
            .unwrap()
            .starts_with(b"SQLite format 3")
    );
    let before = std::fs::read(account.db_path()).unwrap();
    let wrong = Resolved {
        profile: account.clone(),
        key: Some(sync_context(Arc::new(AccountKey::generate().unwrap()))),
    };
    assert!(
        activate(&state, wrong, sessions::testing::outside)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(account.db_path()).unwrap(), before);
    assert_eq!(profiles.open_active().unwrap().meta.id, first.meta.id);
    activate(&state, resolved(), sessions::testing::outside)
        .await
        .unwrap();
    assert_eq!(
        state.chats().unwrap().store.chats().await.unwrap()[0].id,
        chat
    );
    close(&state).await;
}

#[tokio::test]
async fn selected_account_starts_locked_without_touching_its_database() {
    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let profiles = Profiles::new(root.clone());
    let account = profiles.create(ProfileKind::Account, "Account").unwrap();
    profiles.set_active(&account.meta.id).unwrap();
    let state = state(&root);
    assert!(state.app_info().profile_locked);
    assert!(state.app_info().fatal.is_none());
    assert!(state.chats().is_none());
    assert!(!account.db_path().exists());
    assert!(!account.dir.join("aura.db").exists());
    let _owner = ProfileOwner::acquire(&account).unwrap();
}

#[tokio::test]
async fn account_config_services_are_keyed_persistent_and_invalidated_on_switch() {
    use aura_config::sync::{ConfigPortError, ConfigScope, ConfigSnapshotMetadata};

    let temp = tempfile::tempdir().unwrap();
    let root = DataRoot::at(temp.path().join("data"));
    let state = state(&root);
    assert!(state.account_config().is_err());
    let profiles = Profiles::new(root);
    let local_profile = profiles.open_active().unwrap();
    let account = profiles.create(ProfileKind::Account, "Account").unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let resolved = || Resolved {
        profile: account.clone(),
        key: Some(sync_context(key.clone())),
    };
    activate(&state, resolved(), sessions::testing::outside)
        .await
        .unwrap();

    let lease = state.account_config().unwrap();
    let generation = lease.generation();
    let retained = Arc::clone(&lease);
    let id = aura_core::ids::new_id();
    let content = b"synthetic private apply receipt";
    lease.journal.create(&id, content.to_vec().into()).unwrap();
    let item = "ab".repeat(32);
    let head = lease
        .port
        .publish_snapshot(
            &item,
            None,
            b"private config".to_vec().into(),
            ConfigSnapshotMetadata {
                schema: 1,
                scope: ConfigScope::Portable,
                deleted: false,
            },
        )
        .await
        .unwrap();
    drop(lease);

    let broken = profiles
        .create(ProfileKind::Account, "Broken journal")
        .unwrap();
    std::fs::create_dir(broken.dir.join("config-apply")).unwrap();
    std::fs::write(
        broken.dir.join("config-apply").join("legacy.txt"),
        b"preserved",
    )
    .unwrap();
    assert!(
        activate(
            &state,
            Resolved {
                profile: broken,
                key: Some(sync_context(key.clone()))
            },
            sessions::testing::outside
        )
        .await
        .is_err()
    );
    // A cross-Account request completes the separately encrypted A -> Local phase before opening
    // B. A failure authenticating B therefore leaves Local selected and invalidates A's handles.
    assert!(!generation.is_current());
    assert_eq!(state.app_info().profile.unwrap().id, "local");
    assert!(matches!(
        retained.journal.read(&id),
        Err(ConfigPortError::Unavailable)
    ));

    activate(&state, local(local_profile), sessions::testing::outside)
        .await
        .unwrap();
    assert!(!generation.is_current());
    assert!(state.account_config().is_err());
    assert_eq!(retained.journal.list(), Err(ConfigPortError::Unavailable));
    assert_eq!(
        retained.port.list_heads().await,
        Err(ConfigPortError::Unavailable)
    );
    activate(&state, resolved(), sessions::testing::outside)
        .await
        .unwrap();
    let lease = state.account_config().unwrap();
    assert_eq!(lease.journal.read(&id).unwrap().as_slice(), content);
    assert_eq!(lease.port.read_head(&item).await.unwrap(), Some(head));
    drop(lease);
    close(&state).await;
}
