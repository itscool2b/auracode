use super::*;
use aura_drivers::driver::{LoggedCommand, SteerResult};
use aura_drivers::testing::ScriptHandle;
use aura_protocol::{
    PromptPart,
    composer::{ComposerInput, SteeringState},
};

fn driver(supported: bool) -> (ScriptedDriver, ScriptHandle) {
    let Step::Emit(DriverEvent::Ready(mut ready)) = ready_step("steering-native") else {
        unreachable!()
    };
    ready.capabilities.steer = supported;
    ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        Step::Emit(DriverEvent::Ready(ready)),
    ])
}

async fn open(rig: &Rig, handle: &ScriptHandle) -> (String, String) {
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    status(rig, &chat.id, SessionStatus::Ready).await;
    rig.manager
        .send(&chat.id, "Original prompt".into())
        .await
        .unwrap();
    let LoggedCommand::Prompt { turn_id, .. } = handle.wait_for(CommandMatch::Prompt).await else {
        panic!("prompt")
    };
    (chat.id, turn_id)
}

fn input(text: &str) -> ComposerInput {
    ComposerInput {
        text: text.into(),
        ..Default::default()
    }
}

#[tokio::test]
async fn steering_saves_exact_input_before_delivery_and_preserves_accepted_context() {
    let (driver, handle) = driver(true);
    handle.set_steer_reply(SteerResult::Accepted);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let (chat, turn) = open(&rig, &handle).await;
    let ack = rig
        .manager
        .composer_steer(&chat, turn.clone(), input("Focus on tests"))
        .await
        .unwrap();
    assert_eq!(ack.state, SteeringState::Accepted);
    let LoggedCommand::Steer {
        message_id,
        turn_id,
        parts,
    } = handle.wait_for(CommandMatch::Steer).await
    else {
        panic!("steer")
    };
    assert_eq!(turn_id, turn);
    assert_eq!(message_id, ack.message_id);
    assert_eq!(
        parts,
        vec![PromptPart::Text {
            text: "Focus on tests".into()
        }]
    );
    rig.store.with_store(move |store| {
        let (state,json): (String,String) = store.conn().query_row("SELECT state,parts_json FROM steering_inputs WHERE message_id=?1",[&ack.message_id],|row| Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(state,"accepted");
        assert_eq!(serde_json::from_str::<Vec<PromptPart>>(&json).unwrap(),parts);
        let pending: bool = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM events WHERE kind='steering_status' AND json_extract(payload,'$.message_id')=?1 AND json_extract(payload,'$.state')='pending')",[&ack.message_id],|row| row.get(0)).unwrap();
        assert!(pending);
    });
    let context = rig
        .store
        .conversation(
            crate::chatstore::conversation::ConversationCommand::Snapshot {
                chat_id: chat.clone(),
                selected: Some(turn.clone()),
                target_agent: None,
                include_selected: true,
            },
        )
        .await
        .unwrap();
    let crate::chatstore::conversation::ConversationReply::Snapshot(context) = context else {
        panic!("snapshot")
    };
    assert_eq!(
        context.selected.as_ref().unwrap().prompt,
        "Original prompt\n\nFocus on tests"
    );
    assert_eq!(context.selected.as_ref().unwrap().parts.len(), 2);
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}

#[tokio::test]
async fn steering_rejection_stays_visible_but_never_enters_retry_context() {
    let (driver, handle) = driver(true);
    handle.set_steer_reply(SteerResult::Rejected {
        message: "Native review cannot be steered.".into(),
    });
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let (chat, turn) = open(&rig, &handle).await;
    assert!(
        rig.manager
            .composer_steer(&chat, "stale-turn".into(), input("stale"))
            .await
            .is_err()
    );
    let ack = rig
        .manager
        .composer_steer(&chat, turn.clone(), input("Undelivered text"))
        .await
        .unwrap();
    assert_eq!(ack.state, SteeringState::Rejected);
    let context = rig
        .store
        .conversation(
            crate::chatstore::conversation::ConversationCommand::Snapshot {
                chat_id: chat.clone(),
                selected: Some(turn),
                target_agent: None,
                include_selected: true,
            },
        )
        .await
        .unwrap();
    let crate::chatstore::conversation::ConversationReply::Snapshot(context) = context else {
        panic!("snapshot")
    };
    assert_eq!(context.selected.as_ref().unwrap().prompt, "Original prompt");
    assert_eq!(context.selected.as_ref().unwrap().parts.len(), 1);
    assert_eq!(
        handle
            .commands()
            .iter()
            .filter(|cmd| matches!(cmd, LoggedCommand::Steer { .. }))
            .count(),
        1
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}

#[tokio::test]
async fn unsupported_steering_never_becomes_a_queued_prompt() {
    let (driver, handle) = driver(false);
    let rig = rig(vec![driver], WriterConfig::STANDARD, Knobs::STANDARD);
    let (chat, turn) = open(&rig, &handle).await;
    assert!(
        rig.manager
            .composer_steer(&chat, turn, input("Do not queue"))
            .await
            .is_err()
    );
    assert_eq!(
        handle
            .commands()
            .iter()
            .filter(|cmd| matches!(cmd, LoggedCommand::Prompt { .. }))
            .count(),
        1
    );
    assert!(
        !handle
            .commands()
            .iter()
            .any(|cmd| matches!(cmd, LoggedCommand::Steer { .. }))
    );
    rig.manager.shutdown_all(Duration::from_secs(5)).await;
}
