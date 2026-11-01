//! Added agent accounts in the session manager: what a start on one passes to Claude Code, and how
//! a chat stopped by a usage limit continues on another account.

mod support;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aura_core::agent_accounts::{AgentAccountsStore, TokenVault};
use aura_drivers::driver::{DriverError, DriverEvent, DriverExit, LoggedCommand};
use aura_drivers::testing::{CommandMatch, ScriptedDriver, Step};
use aura_process::EnvKey;
use aura_protocol::{
    ErrorKind, HoldCause, QueueWait, SessionStatus, StopReason, UsageLimit,
};
use support::*;

const TOKEN: &str = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-AA";
const API_KEY: &str = "sk-ant-api03-the-person-s-own-key-for-other-tools";

#[derive(Default)]
struct Vault(Mutex<HashMap<String, String>>);

impl TokenVault for Vault {
    fn load(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn save(&self, account: &str, token: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), token.into());
        Ok(())
    }
    fn remove(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

fn claude() -> aura_agents::FixedAgent {
    let spec = aura_agents::get("claude").expect("Claude Code").clone();
    aura_agents::FixedAgent::new(spec, ready(), Some(launch()))
}

fn variable(setup: &aura_drivers::driver::SessionSetup, name: &str) -> Option<String> {
    let key = EnvKey::from(name);
    setup
        .launch
        .set_env
        .iter()
        .rev()
        .find(|(set, _)| EnvKey::from(set.as_os_str()) == key)
        .map(|(_, value)| value.to_string_lossy().into_owned())
        .or_else(|| {
            setup
                .env
                .vars
                .get(&key)
                .map(|value| value.to_string_lossy().into_owned())
        })
}

fn limit() -> UsageLimit {
    UsageLimit {
        message: "You've hit your 5-hour limit · resets 5:30pm (America/New_York)".into(),
        resets_at: Some(1_793_572_200_000),
    }
}

/// The limit holds the failed prompt and keeps the process; Continue with another account starts
/// the agent again on that account's token, resuming the same session, and sends the prompt.
#[tokio::test(start_paused = true)]
async fn a_limited_chat_continues_on_another_account_where_it_stopped() {
    let (first, first_handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::Emit(DriverEvent::UsageLimit(limit())),
        Step::EndTurn {
            stop_reason: StopReason::Error,
            usage: None,
            error: Some(DriverError {
                kind: ErrorKind::UsageLimit,
                message: limit().message,
                detail: None,
            }),
        },
        Step::Expect(CommandMatch::Shutdown),
        Step::Exit(DriverExit::Closed),
    ]);
    let (second, second_handle) = ScriptedDriver::new(vec![
        Step::Spawn(launch()),
        ready_step("n1"),
        Step::Expect(CommandMatch::Prompt),
        Step::EndTurn {
            stop_reason: StopReason::EndTurn,
            usage: None,
            error: None,
        },
    ]);
    let mut options = Options {
        agents: vec![claude()],
        ..Options::default()
    };
    options
        .env
        .insert(EnvKey::from("ANTHROPIC_API_KEY"), API_KEY.into());
    let h = Harness::with(vec![first, second], options);
    let vault: Arc<dyn TokenVault> = Arc::new(Vault::default());
    h.manager
        .set_agent_accounts(Some(Arc::new(AgentAccountsStore::open(
            &h.profile.dir,
            Ok(vault),
        ))));
    let work = h
        .manager
        .add_agent_account("claude", "Work".into(), TOKEN.into())
        .await
        .expect("add")
        .accounts[0]
        .id
        .clone();

    let chat = h.chat_with("claude").await;
    h.status(&chat.id, SessionStatus::Ready).await;
    let ack = h.manager.send(&chat.id, "hello".into()).await.expect("send");
    let snapshot = loop {
        let attach = h
            .manager
            .attach(&chat.id, Sink::new("main"))
            .await
            .expect("attach");
        if attach.snapshot.queue.iter().any(|row| row.held) {
            break attach.snapshot;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    };
    // The agent's own sign-in ran first, with the person's environment as it is.
    let started = &h.factory.setups()[0];
    assert_eq!(variable(started, "CLAUDE_CODE_OAUTH_TOKEN"), None);
    assert_eq!(variable(started, "ANTHROPIC_API_KEY").as_deref(), Some(API_KEY));
    assert_eq!(snapshot.session.usage_limit, Some(limit()));
    assert_eq!(snapshot.session.account_id, None);
    assert_eq!(
        snapshot.session.queue_wait,
        Some(QueueWait::Held {
            after: HoldCause::UsageLimit
        })
    );
    assert_eq!(snapshot.queue[0].prompt_id, ack.prompt_id, "the same prompt");
    assert_eq!(snapshot.session.status, SessionStatus::Ready, "the process stays");
    assert!(
        !first_handle
            .commands()
            .iter()
            .any(|command| matches!(command, LoggedCommand::Shutdown))
    );

    let accounts = h
        .manager
        .switch_chat_account(&chat.id, "claude", Some(work.clone()))
        .await
        .expect("switch");
    assert_eq!(accounts.active.as_deref(), Some(work.as_str()));
    let resent = command(&second_handle, CommandMatch::Prompt).await;
    assert!(
        matches!(&resent, LoggedCommand::Prompt { parts, .. } if format!("{parts:?}").contains("hello")),
        "{resent:?}"
    );
    let resumed = &h.factory.setups()[1];
    assert_eq!(resumed.resume.as_deref(), Some("n1"), "the same session");
    assert_eq!(variable(resumed, "CLAUDE_CODE_OAUTH_TOKEN").as_deref(), Some(TOKEN));
    assert_eq!(
        variable(resumed, "ANTHROPIC_API_KEY"),
        None,
        "a key Claude Code prefers over the account's token is left out"
    );
    assert!(
        !h.redactor.redact_text(&format!("token {TOKEN}")).contains(TOKEN),
        "logs never keep the token"
    );
    h.status(&chat.id, SessionStatus::Ready).await;
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("after"))
        .await
        .expect("attach");
    assert_eq!(attach.snapshot.session.account_id.as_deref(), Some(work.as_str()));
    assert_eq!(attach.snapshot.session.usage_limit, None);
    assert!(attach.snapshot.queue.is_empty());
}

/// A chosen account whose token is gone fails the start with a sentence saying so; it never runs
/// on the agent's own sign-in instead.
#[tokio::test(start_paused = true)]
async fn a_chosen_account_without_its_token_never_starts_on_another() {
    let (driver, _) = ScriptedDriver::new(vec![Step::Spawn(launch()), ready_step("n1")]);
    let h = Harness::with(
        vec![driver],
        Options {
            agents: vec![claude()],
            ..Options::default()
        },
    );
    let vault = Arc::new(Vault::default());
    let shared: Arc<dyn TokenVault> = vault.clone();
    h.manager
        .set_agent_accounts(Some(Arc::new(AgentAccountsStore::open(
            &h.profile.dir,
            Ok(shared),
        ))));
    let work = h
        .manager
        .add_agent_account("claude", "Work".into(), TOKEN.into())
        .await
        .expect("add")
        .accounts[0]
        .id
        .clone();
    h.manager
        .use_agent_account("claude", Some(work))
        .await
        .expect("use");
    vault.0.lock().unwrap().clear();
    let chat = h.chat_with("claude").await;
    h.status(&chat.id, SessionStatus::Failed).await;
    assert!(h.factory.setups().is_empty(), "no process started");
    let attach = h
        .manager
        .attach(&chat.id, Sink::new("main"))
        .await
        .expect("attach");
    let error = attach.snapshot.last_error.expect("the start failed");
    assert!(error.message.contains("Work"), "{}", error.message);
    // Other agents never read accounts.
    let accounts = h.manager.agent_accounts("mock").await.expect("list");
    assert!(accounts.unavailable.is_some());
}
