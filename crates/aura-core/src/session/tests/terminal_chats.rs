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
    // A chat that did not move here from another agent has nothing to type first.
    assert_eq!(opened.first_input, None);
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
    let again = reopened(&rig, &chat.id).await;
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

/// The chat's user messages and answers, in order, from its saved history.
async fn conversation(rig: &Rig, chat: &str) -> Vec<String> {
    let page = rig.manager.history(chat, u32::MAX, None).await.unwrap();
    page.items
        .iter()
        .filter_map(|item| match &item.event {
            AuraEvent::UserMessageDelta { text, .. } => Some(format!("you: {text}")),
            AuraEvent::MessageDelta { text, .. } => Some(format!("agent: {text}")),
            _ => None,
        })
        .collect()
}

/// Waits until the chat can open its terminal again: the last one has finished ending.
async fn reopened(rig: &Rig, chat: &str) -> TerminalOpened {
    for _ in 0..200 {
        if let Ok(opened) = rig.manager.open_terminal(chat).await {
            return opened;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("the terminal never finished ending");
}

#[tokio::test]
async fn a_terminals_conversation_is_recorded_once_it_ends_and_only_what_it_added() {
    let home = tempfile::tempdir().unwrap();
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    RIG_ENV.with(|extra| {
        extra.replace(vec![(
            variable.into(),
            home.path().to_string_lossy().into_owned(),
        )])
    });
    let rig = claude_rig();
    RIG_ENV.with(|extra| extra.replace(Vec::new()));
    let chat = rig
        .manager
        .create_chat("claude", &rig.folder)
        .await
        .unwrap();
    let opened = rig.manager.open_terminal(&chat.id).await.unwrap();
    let session = argv(&opened)
        .iter()
        .find_map(|a| a.strip_prefix("--session-id=").map(str::to_owned))
        .unwrap();
    // Claude Code writes its session file as the person works in the terminal.
    let project = home
        .path()
        .join(".claude")
        .join("projects")
        .join("C--work-app");
    std::fs::create_dir_all(&project).unwrap();
    let file = project.join(format!("{session}.jsonl"));
    let line = |kind: &str, content: &str| {
        let body = if kind == "user" {
            serde_json::json!({"type":"user","message":{"role":"user","content":content},"timestamp":"2026-11-06T08:00:00.000Z"})
        } else {
            serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":content}]},"timestamp":"2026-11-06T08:00:05.000Z"})
        };
        body.to_string()
            + "
"
    };
    std::fs::write(
        &file,
        line("user", "Fix the header") + &line("assistant", "Fixed."),
    )
    .unwrap();
    rig.manager.terminal_ended(&chat.id, opened.generation);
    // The next terminal opens only once the turn is recorded, and continues the same session.
    let again = reopened(&rig, &chat.id).await;
    assert!(argv(&again).contains(&format!("--resume={session}")));
    assert_eq!(
        conversation(&rig, &chat.id).await,
        ["you: Fix the header", "agent: Fixed."]
    );
    // The second terminal adds a turn; the first is not recorded twice.
    let mut text = std::fs::read_to_string(&file).unwrap();
    text.push_str(&(line("user", "Now the footer") + &line("assistant", "Done.")));
    std::fs::write(&file, text).unwrap();
    rig.manager.terminal_ended(&chat.id, again.generation);
    let _third = reopened(&rig, &chat.id).await;
    assert_eq!(
        conversation(&rig, &chat.id).await,
        [
            "you: Fix the header",
            "agent: Fixed.",
            "you: Now the footer",
            "agent: Done."
        ]
    );
}
