//! Stopping several chats at once: the person's "Stop these chats" and "Stop idle agents", and an
//! update or a profile switch, which stop the work themselves before they close admission.
//!
//! Each stop asks the chat's actor, then waits for what really frees room: the agent's slot, given
//! back only once its processes are gone (one process per native session holds throughout).
//! Neither sets the manager shutting down, so a chat started afterwards starts as usual.

use super::*;

/// Which chats a stop asks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopScope {
    /// Every chat with a live agent, or a start waiting for one.
    All,
    /// These chats, where they have a live agent or a start waiting for one.
    Chats(Vec<String>),
    /// The chats whose agent works in one of these folders or inside one.
    Folders(Vec<PathBuf>),
}

/// What a stop of several chats did, by chat id, each list sorted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StopReport {
    /// Stopped: their agents' processes are gone and their slots are free.
    pub stopped: Vec<String>,
    /// Left running because they were not idle: working, waiting for an answer, or open in a
    /// terminal (`stop_idle` only).
    pub kept: Vec<String>,
    /// Asked to stop, but still stopping when the time ran out.
    pub stopping: Vec<String>,
}

/// `stop_idle` waits this long for the idle agents it stopped; a stop is forced well before.
const IDLE_STOP_WAIT: Duration = Duration::from_secs(30);

impl SessionManager {
    /// The chats `scope` names that have a live agent or a start waiting for one.
    async fn stop_targets(&self, scope: StopScope) -> Vec<String> {
        let live = &self.shared().live;
        match scope {
            StopScope::All => live.live_chats(),
            StopScope::Chats(ids) => {
                let running = live.live_chats();
                let mut chats: Vec<String> =
                    ids.into_iter().filter(|id| running.contains(id)).collect();
                chats.sort();
                chats.dedup();
                chats
            }
            StopScope::Folders(folders) => {
                // Agents register their folders as given and as resolved; match both spellings.
                let given = folders.clone();
                let resolved = tokio::task::spawn_blocking(move || {
                    folders
                        .into_iter()
                        .map(live::normalize_path)
                        .collect::<Vec<_>>()
                })
                .await
                .unwrap_or_default();
                live.holders(&given.into_iter().chain(resolved).collect::<Vec<_>>())
            }
        }
    }

    /// Stops the idle agents in `scope`, by the idle rule (ready, unwatched, nothing open or
    /// queued, no background work), and answers once their slots are free. Working, waiting and
    /// terminal chats are left as they are and listed as kept.
    pub async fn stop_idle(&self, scope: StopScope) -> StopReport {
        self.stop_idle_with(scope, false).await
    }

    /// Stops the agents in `scope` that are not working, ones with a view open included: a
    /// change that rewrites their folder does this first.
    pub(super) async fn stop_unless_working(&self, scope: StopScope) -> StopReport {
        self.stop_idle_with(scope, true).await
    }

    async fn stop_idle_with(&self, scope: StopScope, even_shown: bool) -> StopReport {
        let mut asked = Vec::new();
        let mut kept = Vec::new();
        for chat in self.stop_targets(scope).await {
            let Some(mailbox) = self.existing_actor(&chat) else {
                continue;
            };
            let (reply, answer) = oneshot::channel();
            if mailbox
                .send(ChatMsg::StopIfIdle { even_shown, reply })
                .is_err()
            {
                continue;
            }
            match answer.await {
                Ok(Ok(true)) => asked.push(chat),
                Ok(Ok(false)) => kept.push(chat),
                _ => {}
            }
        }
        let (stopped, stopping) = self.wait_released(asked, IDLE_STOP_WAIT).await;
        StopReport {
            stopped,
            kept,
            stopping,
        }
    }

    /// Stops every chat in `scope`, a turn in progress included (as Stop does), and answers once
    /// their slots are free or `deadline` passed. Admission stays open.
    pub async fn stop_all(&self, scope: StopScope, deadline: Duration) -> StopReport {
        let mut asked = Vec::new();
        for chat in self.stop_targets(scope).await {
            if self.stop(&chat).await.is_ok() {
                asked.push(chat);
            }
        }
        let (stopped, stopping) = self.wait_released(asked, deadline).await;
        StopReport {
            stopped,
            kept: Vec::new(),
            stopping,
        }
    }

    /// Waits until none of `chats` holds a slot or waits for one, or `deadline` passed: the
    /// released ones, then the ones still stopping, each sorted.
    async fn wait_released(
        &self,
        chats: Vec<String>,
        deadline: Duration,
    ) -> (Vec<String>, Vec<String>) {
        let live = &self.shared().live;
        let mut released = live.released();
        let holds = |chat: &String| live.contains(chat) || live.is_waiting(chat);
        let _ = tokio::time::timeout(deadline, async {
            while chats.iter().any(holds) {
                let _ = released.changed().await;
            }
        })
        .await;
        let (mut stopping, mut stopped): (Vec<String>, Vec<String>) =
            chats.into_iter().partition(holds);
        stopped.sort();
        stopping.sort();
        (stopped, stopping)
    }
}
