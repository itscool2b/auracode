use super::*;
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
use crate::session::EditorOpen;
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
use aura_protocol::project_tools::ProjectEditor;

fn enable_git(rig: &mut Rig) {
    let env = EnvResolver::fixed(ResolvedEnv {
        vars: aura_process::process_env(),
        source: EnvSource::Fallback {
            reason: "owned project utility fixture".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let service = crate::gitworkspaces::GitWorkspaces::new(
        &rig.profile,
        env,
        aura_process::LeftoverRegistry::disabled(),
    );
    let inner = Arc::get_mut(&mut rig.manager.inner).expect("one fixture owner");
    Arc::get_mut(&mut inner.shared)
        .expect("no actor yet")
        .deps
        .worktrees = Some(service);
}

struct Admission(Arc<AtomicBool>);
impl Drop for Admission {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

#[tokio::test]
async fn terminal_review_is_one_use_and_folder_ownership_allows_live_agents() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("native-terminal"),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let inner = Arc::get_mut(&mut rig.manager.inner).unwrap();
    Arc::get_mut(&mut inner.shared).unwrap().deps.env = EnvResolver::fixed(ResolvedEnv {
        vars: aura_process::process_env(),
        source: EnvSource::Fallback {
            reason: "metadata-only terminal fixture".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let review = rig.manager.project_tools_review(&chat.id).await.unwrap();
    assert!(!review.shells.is_empty());
    let shell = review.shells[0].id;
    let plan = rig
        .manager
        .prepare_project_terminal(&chat.id, &review.token, shell)
        .await
        .unwrap();
    assert_eq!(plan.spec.folder, rig.folder.canonicalize().unwrap());
    // Shells start from plain paths: Windows PowerShell fails to start from a verbatim
    // (`\\?\C:\...`) program path, and cmd.exe falls back to the Windows folder from a verbatim
    // working folder.
    let launch = &plan.spec.launch;
    assert!(!launch.program.to_string_lossy().starts_with(r"\\?\"));
    let aura_process::ProcessCwd::Fixed(cwd) = &launch.cwd else {
        panic!("a terminal starts in its reviewed folder");
    };
    assert!(!cwd.to_string_lossy().starts_with(r"\\?\"), "{cwd:?}");
    assert_eq!(
        same_file::Handle::from_path(cwd).unwrap(),
        same_file::Handle::from_path(&plan.spec.folder).unwrap()
    );
    assert!(rig.manager.shared().live.contains(&chat.id));
    assert_eq!(rig.manager.project_terminal_count(), 1);
    assert_eq!(rig.manager.shared().live.owned_work_count(), 0);
    assert!(
        rig.manager
            .prepare_project_terminal(&chat.id, &review.token, shell)
            .await
            .is_err()
    );
    rig.manager.stop(&chat.id).await.unwrap();
    eventually("retired", || !rig.manager.shared().live.contains(&chat.id)).await;
    let key = live::normalize_path(rig.folder.clone());
    assert!(!rig.manager.shared().live.reserve_folder(&key));
    drop(plan);
    assert!(rig.manager.shared().live.reserve_folder(&key));
    let second = rig.manager.project_tools_review(&chat.id).await.unwrap();
    assert!(
        rig.manager
            .prepare_project_terminal(&chat.id, &second.token, shell)
            .await
            .is_err()
    );
    rig.manager.shared().live.release_folder(&key);
    let stale = rig.manager.project_tools_review(&chat.id).await.unwrap();
    let moved = rig.folder.with_extension("moved");
    std::fs::rename(&rig.folder, &moved).unwrap();
    std::fs::create_dir(&rig.folder).unwrap();
    assert!(
        rig.manager
            .prepare_project_terminal(&chat.id, &stale.token, shell)
            .await
            .is_err()
    );
    let _ = rig.manager.shutdown_all(Duration::from_secs(5)).await;
    assert!(rig.store.shutdown(Duration::from_secs(5)).await);
}

/// The docked panel opens several shells in one chat's folder. Each holds its own folder use, so
/// the quit question counts every shell and the folder stays protected until the last one ends.
#[tokio::test]
async fn several_project_terminals_in_one_folder_each_count_until_they_end() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("native-panel"),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let inner = Arc::get_mut(&mut rig.manager.inner).unwrap();
    Arc::get_mut(&mut inner.shared).unwrap().deps.env = EnvResolver::fixed(ResolvedEnv {
        vars: aura_process::process_env(),
        source: EnvSource::Fallback {
            reason: "metadata-only terminal panel fixture".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let mut plans = Vec::new();
    for _ in 0..3 {
        let review = rig.manager.project_tools_review(&chat.id).await.unwrap();
        let shell = review.shells[0].id;
        plans.push(
            rig.manager
                .prepare_project_terminal(&chat.id, &review.token, shell)
                .await
                .unwrap(),
        );
    }
    assert_eq!(rig.manager.project_terminal_count(), 3);
    let key = live::normalize_path(rig.folder.clone());
    plans.pop();
    assert_eq!(rig.manager.project_terminal_count(), 2);
    assert!(
        !rig.manager
            .wait_project_terminals(Duration::from_millis(50))
            .await
    );
    plans.clear();
    assert_eq!(rig.manager.project_terminal_count(), 0);
    assert!(
        rig.manager
            .wait_project_terminals(Duration::from_millis(50))
            .await
    );
    rig.manager.stop(&chat.id).await.unwrap();
    eventually("retired", || !rig.manager.shared().live.contains(&chat.id)).await;
    assert!(rig.manager.shared().live.reserve_folder(&key));
    rig.manager.shared().live.release_folder(&key);
    let _ = rig.manager.shutdown_all(Duration::from_secs(5)).await;
    assert!(rig.store.shutdown(Duration::from_secs(5)).await);
}

/// A synthetic Zed install is offered, opens through its own launcher with the folder as its one
/// argument, and a launcher replaced after review is refused rather than started.
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn a_detected_launcher_editor_opens_the_reviewed_folder_and_refuses_a_replaced_one() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("native-editor"),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let install = tempfile::tempdir().unwrap();
    let mut vars = aura_process::process_env();
    let launcher = if cfg!(windows) {
        vars.insert("LOCALAPPDATA".into(), install.path().into());
        install.path().join("Programs/Zed/Zed.exe")
    } else if cfg!(target_os = "linux") {
        vars.insert("HOME".into(), install.path().into());
        install.path().join(".local/zed.app/bin/zed")
    } else {
        vars.insert("HOME".into(), install.path().into());
        install
            .path()
            .join("Applications/Zed.app/Contents/MacOS/zed")
    };
    std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
    std::fs::write(&launcher, b"first").unwrap();
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let inner = Arc::get_mut(&mut rig.manager.inner).unwrap();
    Arc::get_mut(&mut inner.shared).unwrap().deps.env = EnvResolver::fixed(ResolvedEnv {
        vars,
        source: EnvSource::Fallback {
            reason: "synthetic editor install".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let review = rig.manager.project_tools_review(&chat.id).await.unwrap();
    assert!(review.editors.contains(&ProjectEditor::Zed));
    let open = rig
        .manager
        .project_editor_open(&chat.id, &review.token, ProjectEditor::Zed)
        .await
        .unwrap();
    let EditorOpen::Launch(launch) = open else {
        panic!("Zed opens through its launcher");
    };
    if cfg!(any(windows, target_os = "linux")) {
        assert_eq!(launch.program, launcher);
        assert_eq!(
            launch.args,
            [std::ffi::OsString::from(review.folder.clone())]
        );
    } else {
        assert_eq!(launch.program, PathBuf::from("/usr/bin/open"));
        assert_eq!(launch.args.last(), Some(&review.folder.clone().into()));
    }
    // The review is used up, and a launcher replaced since review is refused.
    assert!(
        rig.manager
            .project_editor_open(&chat.id, &review.token, ProjectEditor::Zed)
            .await
            .is_err()
    );
    let second = rig.manager.project_tools_review(&chat.id).await.unwrap();
    std::fs::remove_file(&launcher).unwrap();
    std::fs::write(&launcher, b"second").unwrap();
    let refused = rig
        .manager
        .project_editor_open(&chat.id, &second.token, ProjectEditor::Zed)
        .await
        .err()
        .expect("a replaced launcher is refused");
    assert!(refused.to_string().contains("changed after review"));
    // An editor the review did not offer is refused.
    let third = rig.manager.project_tools_review(&chat.id).await.unwrap();
    assert!(!third.editors.contains(&ProjectEditor::CLion));
    assert!(
        rig.manager
            .project_editor_open(&chat.id, &third.token, ProjectEditor::CLion)
            .await
            .is_err()
    );
    let _ = rig.manager.shutdown_all(Duration::from_secs(5)).await;
    assert!(rig.store.shutdown(Duration::from_secs(5)).await);
}

#[tokio::test]
async fn initialization_waits_for_live_folder_ownership_and_keeps_admission_through_completion() {
    let (driver, _) = ScriptedDriver::new(vec![
        ready_step("native-init"),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let mut rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    enable_git(&mut rig);
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    let preview = rig
        .manager
        .git_initialize_preview(&chat.id, "main")
        .await
        .expect("read-only review");
    let released = Arc::new(AtomicBool::new(false));
    let error = rig
        .manager
        .git_initialize_apply(
            &chat.id,
            &preview.token,
            Box::new(Admission(released.clone())),
        )
        .await
        .expect_err("live folder stays protected");
    assert!(error.to_string().contains("Stop all chats"));
    assert!(released.load(Ordering::Acquire));
    assert!(!rig.folder.join(".git").exists());
    rig.manager.stop(&chat.id).await.expect("stop");
    eventually("retired", || !rig.manager.shared().live.contains(&chat.id)).await;
    let released = Arc::new(AtomicBool::new(false));
    let result = rig
        .manager
        .git_initialize_apply(
            &chat.id,
            &preview.token,
            Box::new(Admission(released.clone())),
        )
        .await
        .expect("explicit initialization after stop");
    assert!(result.head.is_none());
    assert!(released.load(Ordering::Acquire));
    assert!(!rig.folder.join(".git/index").exists());
    let _ = rig.manager.shutdown_all(Duration::from_secs(5)).await;
    assert!(rig.store.shutdown(Duration::from_secs(5)).await);
}
