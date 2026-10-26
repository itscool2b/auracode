use super::*;

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
