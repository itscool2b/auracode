use super::*;

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
