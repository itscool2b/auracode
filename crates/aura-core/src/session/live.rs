//! Live-agent bookkeeping: the cap on live agents, and one live process per native session across
//! chats.
//!
//! A chat holds a slot from the moment its start begins (preparation included) until its driver
//! ended and the processes a force stop or a crash kills are gone, so a 13th start fails at once
//! instead of evicting anything. A native session is claimed for the resume id before spawning and
//! again for the id the agent returns at `Ready`, and stays claimed as long as the slot: two
//! processes on one session interleave one transcript (the Claude spike), so the second chat is
//! refused.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

/// The live agents of every chat.
#[derive(Debug)]
pub(crate) struct LiveAgents {
    max: usize,
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    slots: HashSet<String>,
    /// `(agent_id, native_session_id)` -> the chat holding it.
    sessions: HashMap<(String, String), String>,
}

impl LiveAgents {
    pub(crate) fn new(max: usize) -> LiveAgents {
        LiveAgents {
            max,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes a slot for `chat` (idempotent); false when every slot is taken.
    pub(crate) fn acquire(&self, chat: &str) -> bool {
        let mut inner = self.lock();
        if inner.slots.contains(chat) {
            return true;
        }
        if inner.slots.len() >= self.max {
            return false;
        }
        inner.slots.insert(chat.to_owned());
        true
    }

    /// Gives `chat`'s slot back, and every native session it held.
    pub(crate) fn release(&self, chat: &str) {
        let mut inner = self.lock();
        inner.slots.remove(chat);
        inner.sessions.retain(|_, holder| holder != chat);
    }

    /// Claims a native session for `chat`; false when another chat holds it.
    pub(crate) fn claim(&self, agent_id: &str, native_session_id: &str, chat: &str) -> bool {
        let mut inner = self.lock();
        let key = (agent_id.to_owned(), native_session_id.to_owned());
        match inner.sessions.get(&key) {
            Some(holder) if holder != chat => false,
            _ => {
                inner.sessions.insert(key, chat.to_owned());
                true
            }
        }
    }

    pub(crate) fn count(&self) -> usize {
        self.lock().slots.len()
    }

    pub(crate) fn max(&self) -> usize {
        self.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_are_capped_and_idempotent() {
        let live = LiveAgents::new(2);
        assert!(live.acquire("a"));
        assert!(live.acquire("a"), "the same chat again");
        assert!(live.acquire("b"));
        assert!(!live.acquire("c"), "nothing is evicted to make room");
        assert_eq!(live.count(), 2);
        live.release("a");
        assert!(live.acquire("c"));
    }

    #[test]
    fn a_native_session_belongs_to_one_chat() {
        let live = LiveAgents::new(12);
        assert!(live.claim("claude-acp", "s1", "a"));
        assert!(live.claim("claude-acp", "s1", "a"), "its own claim");
        assert!(!live.claim("claude-acp", "s1", "b"));
        assert!(
            live.claim("codex-acp", "s1", "b"),
            "another agent's id space"
        );
        live.release("a");
        assert!(live.claim("claude-acp", "s1", "b"));
    }
}
