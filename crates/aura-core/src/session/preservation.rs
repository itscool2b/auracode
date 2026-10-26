use super::*;
use crate::account_preservation::{Command, PreservationError, Reply, Snapshot};
use aura_protocol::account_preservation::{KeepLocalPreview, KeepLocalResult};
use std::time::Instant;

pub(super) struct Prepared {
    snapshot: Snapshot,
    expires: Instant,
}
fn error(value: PreservationError) -> SessionError {
    SessionError::Organization(value.to_string())
}

impl SessionManager {
    pub async fn keep_local_preview(&self) -> Result<KeepLocalPreview, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let Reply::Preview(snapshot) = self
            .deps()
            .store
            .preserve_account(Command::Preview)
            .await
            .map_err(error)?
        else {
            return Err(error(PreservationError::Storage));
        };
        let token = crate::ids::new_id();
        let review = KeepLocalPreview { token: token.clone(), projects: snapshot.projects.len() as u32,
            chats: snapshot.chats, turns: snapshot.turns, notices: vec![
                "Create a separate, unencrypted Local profile on this computer. Anyone with access to these local files can read the copied workspace. Nothing is uploaded.".into(),
                "The original encrypted Account profile and its retained key remain intact. Your existing Local profile is unchanged.".into(),
                "Copy nondeleted projects, archived and active chats, saved drafts and available chat attachments. Deleted projects/chats, native agent sessions, credentials, configuration, queued prompts, pending handoffs, checkpoint history, worktree ownership and protocol logs are excluded.".into(),
                "Working files stay in place. Chats use project folders and a visible Continue here handoff before a new agent prompt. Unfinished replies are retained as interrupted.".into(),
                "Missing attachments remain visibly unavailable. Failed copies retain their unencrypted partial files in a separate profile folder and are never activated automatically.".into(),
                "One copy supports up to 4096 referenced attachments, 512 MiB of decrypted attachment data and 512 MiB of workspace rows. Larger copies stop and preserve the encrypted original.".into(),
            ] };
        let mut reviews = lock(&self.shared().preservation);
        reviews.retain(|_, value| value.expires > Instant::now());
        if reviews.len() >= 8 {
            reviews.clear();
        }
        reviews.insert(
            token,
            Prepared {
                snapshot,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        Ok(review)
    }
    pub async fn keep_local_apply(
        &self,
        root: crate::paths::DataRoot,
        token: String,
    ) -> Result<KeepLocalResult, SessionError> {
        let prepared = lock(&self.shared().preservation)
            .remove(&token)
            .filter(|value| value.expires > Instant::now())
            .ok_or_else(|| error(PreservationError::Changed))?;
        let manager = self.clone();
        self.deps().rt.spawn(async move {
            let _organization = manager.shared().organization.lock().await;
            let _idle = manager.try_quiesce_when_idle().ok_or_else(|| SessionError::Organization(
                "Stop agents and close project terminals before keeping this workspace as Local.".into()))?;
            match manager.deps().store.preserve_account(Command::Apply { root, snapshot: prepared.snapshot }).await.map_err(error)? {
                Reply::Applied(value) => Ok(value), _ => Err(error(PreservationError::Storage)),
            }
        }).await.map_err(|_| error(PreservationError::Storage))?
    }
}
