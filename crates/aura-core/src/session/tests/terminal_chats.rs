//! Terminal chats: a chat opened in its agent's own interface, prepared as a start would be.
use super::*;

fn claude_rig() -> Rig {
    rig_with_spec(
        aura_drivers::testing::ScriptedDriverFactory::new(Vec::new()),
        WriterConfig::STANDARD,
        Knobs::STANDARD,
        aura_agents::get("claude").expect("claude").clone(),
    )
}

fn argv(opened: &TerminalOpened) -> Vec<String> {
    opened
        .spec
        .launch
        .args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

#[tokio::test]
async fn a_terminal_starts_a_claude_session_chat_continues_and_chat_waits_while_it_is_open() {
    let rig = claude_rig();
    let chat = rig
        .manager
        .create_chat("claude", &rig.folder)
        .await
        .unwrap();
    let opened = rig.manager.open_terminal(&chat.id).await.unwrap();
    let args = argv(&opened);
    // The agent's own interface: none of the protocol's arguments.
    assert!(
        !args.iter().any(|a| a == "-p" || a.contains("stream-json")),
        "{args:?}"
    );
    let session = args
        .iter()
        .find_map(|a| a.strip_prefix("--session-id="))
        .expect("a new session's ID")
        .to_owned();
    assert_eq!(opened.spec.folder, rig.folder);
    // Chat does not start while the terminal holds the session, and a second terminal waits too.
    let start = rig.manager.start(&chat.id, false).await;
    assert!(
        start
            .as_ref()
            .is_err_and(|e| e.to_string().contains("open in the terminal")),
        "{start:?}"
    );
    assert!(rig.manager.open_terminal(&chat.id).await.is_err());
    // Once it ends, the next terminal continues the same session.
    rig.manager.terminal_ended(&chat.id, opened.generation);
    let again = rig.manager.open_terminal(&chat.id).await.unwrap();
    assert!(
        argv(&again).contains(&format!("--resume={session}")),
        "{:?}",
        argv(&again)
    );
    // An ending reported for an older terminal changes nothing.
    rig.manager.terminal_ended(&chat.id, opened.generation);
    assert!(rig.manager.open_terminal(&chat.id).await.is_err());
    rig.manager.terminal_ended(&chat.id, again.generation);
}

#[tokio::test]
async fn only_claude_code_and_codex_chats_open_in_the_terminal() {
    let rig = rig(Vec::new(), WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    let refused = rig.manager.open_terminal(&chat.id).await;
    assert!(
        refused
            .as_ref()
            .is_err_and(|e| e.to_string().contains("Claude Code and Codex")),
        "{:?}",
        refused.err()
    );
}
