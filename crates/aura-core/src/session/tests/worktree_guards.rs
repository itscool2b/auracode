use super::*;

async fn enable_worktree_fixture(rig: &mut Rig) {
    use aura_process::{
        HelperEnv, HelperSpec, LeftoverRegistry, find_exe, process_env, run_helper,
    };
    let vars = process_env();
    let git = find_exe("git", &vars).expect("Git is required for owned worktree tests");
    let resolved = Arc::new(ResolvedEnv {
        vars,
        source: EnvSource::Fallback {
            reason: "owned worktree test".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    });
    for command in [
        vec!["init", "-b", "main"],
        vec!["config", "core.autocrlf", "false"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ],
    ] {
        let output = run_helper(
            &LeftoverRegistry::disabled(),
            HelperSpec {
                program: git.clone(),
                args: command.into_iter().map(Into::into).collect(),
                cwd: rig.folder.clone(),
                env: HelperEnv::Resolved(Arc::clone(&resolved)),
                set: vec![],
                new_session: true,
                timeout: Duration::from_secs(15),
                max_stdout: 8192,
            },
        )
        .await
        .expect("owned Git fixture");
        assert_eq!(
            output.exit.and_then(|exit| exit.code),
            Some(0),
            "{}",
            output.stderr_tail
        );
    }
    let service = crate::gitworkspaces::GitWorkspaces::new(
        &rig.profile,
        EnvResolver::fixed((*resolved).clone()),
        LeftoverRegistry::disabled(),
    );
    let inner = Arc::get_mut(&mut rig.manager.inner).expect("only test owner");
    Arc::get_mut(&mut inner.shared)
        .expect("no actors")
        .deps
        .worktrees = Some(service);
}

fn relocation_driver(native: &str) -> (ScriptedDriver, aura_drivers::testing::ScriptHandle) {
    let mut ready = ready_step(native);
    if let Step::Emit(DriverEvent::Ready(info)) = &mut ready {
        info.capabilities.resume = true;
    }
    ScriptedDriver::new(vec![
        ready,
        Step::Expect(CommandMatch::Prompt),
        delta("saved reply"),
        Step::EmitInTurn(DriverEvent::Event {
            turn: None,
            event: AuraEvent::MessageCompleted {
                message_id: "m1".into(),
            },
        }),
        Step::EndTurn {
            stop_reason: StopReason::EndTurn,
            usage: None,
            error: None,
        },
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ])
}

#[tokio::test]
async fn relocation_preserves_history_and_sends_only_the_reviewed_handoff_on_the_next_prompt() {
    use aura_drivers::driver::LoggedCommand;
    use aura_protocol::{
        PromptPart,
        git::{IsolationInput, WorktreeDestination},
    };
    let (first, h1) = relocation_driver("original-folder-session");
    let (second, h2) = relocation_driver("isolated-folder-session");
    let mut rig = rig(vec![first, second], WriterConfig::STANDARD, Knobs::STANDARD);
    enable_worktree_fixture(&mut rig).await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager
        .send(&chat.id, "original visible prompt".into())
        .await
        .expect("send");
    h1.wait_for(CommandMatch::Prompt).await;
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager.stop(&chat.id).await.expect("stop");
    eventually("source retired", || {
        !rig.manager.shared().live.contains(&chat.id)
    })
    .await;
    let isolation = rig
        .manager
        .isolation_preview(
            &chat.id,
            IsolationInput {
                slug: "move".into(),
                bring_changes: false,
            },
        )
        .await
        .expect("isolation preview");
    let created = rig
        .manager
        .isolation_apply(&chat.id, &isolation.token)
        .await
        .expect("create worktree");
    let preview = rig
        .manager
        .worktree_relocation_preview(
            &chat.id,
            &created.worktree.id,
            WorktreeDestination::Isolated,
        )
        .await
        .expect("move preview");
    assert!(
        preview.handoff.contains("original visible prompt")
            && preview.handoff.contains("saved reply")
    );
    assert!(h2.commands().is_empty(), "preview sends nothing");
    let result = rig
        .manager
        .worktree_relocation_apply(&chat.id, &preview.token)
        .await
        .expect("move");
    assert!(result.prompt.is_none());
    assert!(h2.commands().is_empty(), "apply sends nothing");
    assert!(
        rig.manager
            .worktree_relocation_apply(&chat.id, &preview.token)
            .await
            .is_err()
    );
    let load = rig
        .store
        .load_chat(&chat.id)
        .await
        .expect("saved relocation");
    assert_eq!(
        load.chat.folder.canonicalize().expect("folder"),
        PathBuf::from(&preview.to).canonicalize().expect("target")
    );
    let pending = load.continuation.expect("durable handoff");
    assert_eq!(pending.handoff, preview.handoff);
    assert!(pending.force_fresh);
    assert_eq!(
        rig.manager
            .conversation_turns(&chat.id, None)
            .await
            .expect("history")
            .turns
            .len(),
        1
    );
    rig.manager
        .send(&chat.id, "continue here".into())
        .await
        .expect("next prompt");
    let LoggedCommand::Prompt { parts, .. } = h2.wait_for(CommandMatch::Prompt).await else {
        panic!("prompt");
    };
    assert!(matches!(&parts[0], PromptPart::Text { text } if text.starts_with(&preview.handoff)));
    assert_eq!(
        parts[1],
        PromptPart::Text {
            text: "continue here".into()
        }
    );
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert_eq!(
        rig.manager
            .conversation_turns(&chat.id, None)
            .await
            .expect("retained history")
            .turns
            .len(),
        2
    );
    rig.manager.stop(&chat.id).await.expect("stop isolated");
    eventually("isolated retired", || {
        !rig.manager.shared().live.contains(&chat.id)
    })
    .await;
    let direct = rig
        .manager
        .worktree_relocation_preview(&chat.id, &created.worktree.id, WorktreeDestination::Direct)
        .await
        .expect("return preview");
    rig.manager
        .worktree_relocation_apply(&chat.id, &direct.token)
        .await
        .expect("return");
    assert_eq!(
        rig.store
            .load_chat(&chat.id)
            .await
            .expect("return saved")
            .chat
            .folder
            .canonicalize()
            .expect("folder"),
        rig.folder.canonicalize().expect("source")
    );
    assert!(
        Path::new(&created.worktree.path).is_dir(),
        "return keeps isolated work"
    );
}

#[tokio::test]
async fn relocation_refuses_live_destinations_and_changed_conversations() {
    use aura_protocol::git::{IsolationInput, WorktreeDestination};
    let mut rig = rig(
        vec![idle_driver("source"), idle_driver("destination")],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    enable_worktree_fixture(&mut rig).await;
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    rig.manager.stop(&chat.id).await.expect("stop source");
    eventually("retired", || !rig.manager.shared().live.contains(&chat.id)).await;
    let isolation = rig
        .manager
        .isolation_preview(
            &chat.id,
            IsolationInput {
                slug: "busy".into(),
                bring_changes: false,
            },
        )
        .await
        .expect("preview");
    let worktree = rig
        .manager
        .isolation_apply(&chat.id, &isolation.token)
        .await
        .expect("create")
        .worktree;
    let preview = rig
        .manager
        .worktree_relocation_preview(&chat.id, &worktree.id, WorktreeDestination::Isolated)
        .await
        .expect("move");
    let other = rig
        .manager
        .create_chat("mock", Path::new(&worktree.path))
        .await
        .expect("destination chat");
    status(&rig, &other.id, SessionStatus::Ready).await;
    assert!(
        rig.manager
            .worktree_relocation_apply(&chat.id, &preview.token)
            .await
            .is_err()
    );
    assert_eq!(
        rig.store
            .load_chat(&chat.id)
            .await
            .expect("unchanged")
            .chat
            .folder
            .canonicalize()
            .expect("saved folder"),
        rig.folder.canonicalize().expect("source")
    );
    rig.manager.stop(&other.id).await.expect("stop destination");
    eventually("destination retired", || {
        !rig.manager.shared().live.contains(&other.id)
    })
    .await;
    let preview = rig
        .manager
        .worktree_relocation_preview(&chat.id, &worktree.id, WorktreeDestination::Isolated)
        .await
        .expect("review again");
    rig.manager
        .chat_rename(&chat.id, "changed after preview")
        .await
        .expect("rename");
    assert!(
        rig.manager
            .worktree_relocation_apply(&chat.id, &preview.token)
            .await
            .is_err()
    );
}

fn idle_driver(native: &str) -> ScriptedDriver {
    ScriptedDriver::new(vec![
        ready_step(native),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ])
    .0
}

#[tokio::test]
async fn git_folder_reservations_refuse_live_agents_and_block_starts_until_release() {
    let rig = rig(
        vec![idle_driver("first"), idle_driver("second")],
        WriterConfig::STANDARD,
        Knobs::STANDARD,
    );
    let chat = rig
        .manager
        .create_chat("mock", &rig.folder)
        .await
        .expect("chat");
    status(&rig, &chat.id, SessionStatus::Ready).await;
    assert!(
        rig.manager
            .reserve_git_folders(vec![rig.folder.clone()])
            .await
            .is_err()
    );
    rig.manager.stop(&chat.id).await.expect("stop");
    eventually("retired", || !rig.manager.shared().live.contains(&chat.id)).await;
    let reservation = rig
        .manager
        .reserve_git_folders(vec![rig.folder.clone()])
        .await
        .expect("reserve");
    assert!(
        rig.manager
            .send(&chat.id, "must remain unsent".into())
            .await
            .expect_err("send blocked")
            .to_string()
            .contains("change")
    );
    drop(reservation);
    rig.manager
        .start(&chat.id, false)
        .await
        .expect("start after release");
    status(&rig, &chat.id, SessionStatus::Ready).await;
}

#[tokio::test]
async fn a_saved_held_queue_blocks_git_without_becoming_an_agent_prompt() {
    let rig = rig(vec![], WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig
        .store
        .create_chat(crate::chatstore::NewChat {
            agent_id: "mock".into(),
            agent_host: Default::default(),
            folder: rig.folder.clone(),
            device_id: "device".into(),
            now: crate::time::now_millis(),
        })
        .await
        .expect("saved chat");
    let id = chat.id.clone();
    rig.store.with_store(move|store| {
        store.conn().execute("INSERT INTO queued_prompts (id,chat_id,text,held,created_at,device_id) VALUES ('held-fixture',?1,'preserved',1,1,'device')",[id]).expect("owned queued fixture");
    });
    let result = rig
        .manager
        .reserve_git_folders(vec![rig.folder.clone()])
        .await;
    assert!(result.is_err());
    let load = rig.store.load_chat(&chat.id).await.expect("load");
    assert_eq!(load.queue.len(), 1);
    assert_eq!(load.queue[0].text, "preserved");
    assert!(!rig.manager.shared().live.contains(&chat.id));
    assert!(
        rig.manager
            .shared()
            .live
            .reserve_folder(&live::normalize_path(rig.folder.clone())),
        "failed reservation released folder"
    );
    rig.manager
        .shared()
        .live
        .release_folder(&live::normalize_path(rig.folder.clone()));
}
