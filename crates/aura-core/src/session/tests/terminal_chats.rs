//! Terminal chats: a chat opened in its agent's own interface, prepared as a start would be.
use super::*;

fn claude_rig() -> Rig {
    claude_rig_with(Vec::new())
}

fn claude_rig_with(drivers: Vec<ScriptedDriver>) -> Rig {
    rig_with_spec(
        aura_drivers::testing::ScriptedDriverFactory::new(drivers),
        WriterConfig::STANDARD,
        Knobs::STANDARD,
        aura_agents::get("claude").expect("claude").clone(),
    )
}

/// A home folder for the next rig built on this thread, where Claude Code's files go.
fn with_home(build: impl FnOnce() -> Rig) -> (tempfile::TempDir, Rig) {
    let home = tempfile::tempdir().unwrap();
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    RIG_ENV.with(|extra| {
        extra.replace(vec![(
            variable.into(),
            home.path().to_string_lossy().into_owned(),
        )])
    });
    let rig = build();
    RIG_ENV.with(|extra| extra.replace(Vec::new()));
    (home, rig)
}

/// Claude Code's session file for `session` under `home`, as it writes one once a message is sent.
fn claude_file(home: &std::path::Path, session: &str) -> std::path::PathBuf {
    let project = home.join(".claude").join("projects").join("C--work-app");
    std::fs::create_dir_all(&project).unwrap();
    project.join(format!("{session}.jsonl"))
}

fn session_arg<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter().find_map(|a| a.strip_prefix(flag))
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
    let (home, rig) = with_home(claude_rig);
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
    // Once it ends, the next terminal continues the same session, which Claude Code wrote down.
    std::fs::write(claude_file(home.path(), &session), "").unwrap();
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

/// Waits until the chat's own start has made its agent's driver (it has not said Ready yet).
async fn driver_made(factory: &aura_drivers::testing::ScriptedDriverFactory) {
    for _ in 0..500 {
        if !factory.kinds().is_empty() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("the chat's own start never reached its agent: {factory:?}");
}

/// A new chat starts its agent as it is made, so a terminal chosen in New chat opens while that
/// agent is still starting. The terminal waits for it to stop and then opens; it used to wait
/// forever.
#[tokio::test]
async fn a_terminal_opened_while_the_new_chats_agent_starts_opens_once_that_agent_stops() {
    let (driver, handle) = ScriptedDriver::new(vec![
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let factory = aura_drivers::testing::ScriptedDriverFactory::new(vec![driver]);
    let rig = rig_with_spec(
        factory.clone(),
        WriterConfig::STANDARD,
        Knobs::STANDARD,
        aura_agents::get("claude").expect("claude").clone(),
    );
    let chat = rig
        .manager
        .create_chat("claude", &rig.folder)
        .await
        .unwrap();
    driver_made(&factory).await;
    assert_eq!(rig.statuses.status(&chat.id), Some(SessionStatus::Starting));
    let opened = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        rig.manager.open_terminal(&chat.id),
    )
    .await
    .expect("the terminal opens instead of waiting forever")
    .unwrap();
    assert!(
        handle
            .commands()
            .iter()
            .any(|command| matches!(command, aura_drivers::driver::LoggedCommand::Shutdown)),
        "the starting agent was asked to stop first"
    );
    assert!(session_arg(&argv(&opened), "--session-id=").is_some());
    rig.manager.terminal_ended(&chat.id, opened.generation);
}

/// The session a new chat starts for Chat has no file until its first message, and Claude Code
/// cannot resume it: the terminal starts a session of its own instead.
#[tokio::test]
async fn a_session_claude_code_never_wrote_down_is_not_resumed_in_the_terminal() {
    let unwritten = "01a1b21f-0000-7000-8000-000000000001";
    let (driver, _handle) = ScriptedDriver::new(vec![
        ready_step(unwritten),
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let (_home, rig) = with_home(|| claude_rig_with(vec![driver]));
    let chat = rig
        .manager
        .create_chat("claude", &rig.folder)
        .await
        .unwrap();
    for _ in 0..500 {
        if rig.statuses.status(&chat.id) == Some(SessionStatus::Ready) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(rig.statuses.status(&chat.id), Some(SessionStatus::Ready));
    let opened = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        rig.manager.open_terminal(&chat.id),
    )
    .await
    .expect("the terminal opens")
    .unwrap();
    let args = argv(&opened);
    assert_eq!(session_arg(&args, "--resume="), None, "{args:?}");
    let session = session_arg(&args, "--session-id=").expect("a session of its own");
    assert_ne!(session, unwritten);
    rig.manager.terminal_ended(&chat.id, opened.generation);
}

#[tokio::test]
async fn a_chat_whose_agent_has_no_interface_of_its_own_stays_in_chat() {
    let rig = rig(Vec::new(), WriterConfig::STANDARD, Knobs::STANDARD);
    let chat = rig.manager.create_chat("mock", &rig.folder).await.unwrap();
    let refused = rig.manager.open_terminal(&chat.id).await;
    assert!(
        refused
            .as_ref()
            .is_err_and(|e| e.to_string().contains("no interface of its own")),
        "{:?}",
        refused.err()
    );
}

#[tokio::test]
async fn a_grok_terminal_names_its_session_brings_its_turns_back_and_resumes_it_next_time() {
    let (home, rig) = with_home(|| {
        rig_with_spec(
            aura_drivers::testing::ScriptedDriverFactory::new(Vec::new()),
            WriterConfig::STANDARD,
            Knobs::STANDARD,
            aura_agents::get("grok").expect("grok").clone(),
        )
    });
    let chat = rig.manager.create_chat("grok", &rig.folder).await.unwrap();
    let opened = rig.manager.open_terminal(&chat.id).await.unwrap();
    let args = argv(&opened);
    // Grok Build's own interface: none of the ACP server's arguments.
    assert!(
        !args.iter().any(|a| a == "agent" || a == "stdio"),
        "{args:?}"
    );
    assert_eq!(opened.exit_input, "");
    let at = args
        .iter()
        .position(|a| a == "--session-id")
        .expect("a new session's ID");
    let session = args[at + 1].clone();
    assert!(uuid::Uuid::parse_str(&session).is_ok(), "{session}");
    // Grok Build writes its history as the person works in the terminal.
    let folder = home
        .path()
        .join(".grok")
        .join("sessions")
        .join("C%3A%5Cwork%5Capp")
        .join(&session);
    std::fs::create_dir_all(&folder).unwrap();
    let history = [
        serde_json::json!({"type":"system","content":"You are Grok Build"}),
        serde_json::json!({"type":"user","content":[{"type":"text","text":"<rules>"}],"synthetic_reason":"rules"}),
        serde_json::json!({"type":"user","content":[{"type":"text","text":"Tidy the README"}],"prompt_index":0}),
        serde_json::json!({"type":"assistant","content":"Tidied."}),
    ]
    .iter()
    .map(|line| line.to_string() + "
")
    .collect::<String>();
    std::fs::write(folder.join("chat_history.jsonl"), history).unwrap();
    rig.manager.terminal_ended(&chat.id, opened.generation);
    let again = reopened(&rig, &chat.id).await;
    let args = argv(&again);
    assert!(
        args.windows(2)
            .any(|w| w[0] == "--resume" && w[1] == session),
        "{args:?}"
    );
    assert_eq!(
        conversation(&rig, &chat.id).await,
        ["you: Tidy the README", "agent: Tidied."]
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
    let (home, rig) = with_home(claude_rig);
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
    let file = claude_file(home.path(), &session);
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

#[test]
fn the_agent_list_offers_the_terminal_for_exactly_the_agents_it_can_launch() {
    for spec in aura_agents::catalog() {
        assert_eq!(
            aura_agents::has_terminal(spec.id),
            aura_drivers::terminal::TerminalAgent::of(spec.agent).is_some(),
            "{}",
            spec.id
        );
    }
}
