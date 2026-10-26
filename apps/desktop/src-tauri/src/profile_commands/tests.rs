use super::*;
use crate::{glass::GlassEffect, launch::LaunchOptions, os::OsInfo};
use aura_core::{chatstore::NewChat, owner::ProfileOwner};

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
        key: Some(("synthetic-account".into(), key.clone())),
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
        key: Some((
            "synthetic-account".into(),
            Arc::new(AccountKey::generate().unwrap()),
        )),
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
