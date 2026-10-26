use super::*;
use crate::sync::exchange::{Command, Reply};

impl SessionManager {
    /// Called after an Account exchange while the desktop retains its current profile lease.
    /// Busy/native-running chats keep their staged data until a later admitted cycle.
    pub async fn reconcile_synced_history(&self) -> Result<u32, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let reply = self
            .deps()
            .store
            .sync_exchange(Command::ReadyChats)
            .await
            .map_err(|error| SessionError::StorageUnavailable(error.to_string()))?;
        let Reply::ReadyChats(chats) = reply else {
            return Err(SessionError::Internal(
                "The remote history list was invalid.".into(),
            ));
        };
        let mut imported = 0;
        for chat in chats.into_iter().take(4) {
            match self.ask(&chat, |reply| ChatMsg::ImportSync { reply }).await {
                Ok(true) => imported += 1,
                Ok(false) | Err(SessionError::SessionNotReady) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(imported)
    }
}
