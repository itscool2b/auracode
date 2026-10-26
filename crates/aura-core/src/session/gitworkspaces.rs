//! Actor and folder reservations around explicitly confirmed filesystem mutations.

use aura_protocol::git::{
    GitWorkspace, IsolationInput, IsolationPreview, IsolationResult, ManagedWorktree,
    WorktreeAction, WorktreeActionPreview, WorktreeActionResult, WorktreeRecoveryAction,
    WorktreeRecoveryPreview,
};

use super::*;

pub(super) struct Reservations {
    shared: Arc<Shared>,
    folders: Vec<PathBuf>,
    actors: Vec<(mpsc::UnboundedSender<ChatMsg>, String)>,
}

impl Drop for Reservations {
    fn drop(&mut self) {
        for (mailbox, id) in &self.actors {
            let _ = mailbox.send(ChatMsg::ReleaseGit { id: id.clone() });
        }
        for folder in &self.folders {
            self.shared.live.release_folder(folder);
        }
    }
}

fn invalid(message: impl Into<String>) -> SessionError {
    SessionError::Organization(message.into())
}

impl SessionManager {
    fn worktrees(&self) -> Result<Arc<crate::gitworkspaces::GitWorkspaces>, SessionError> {
        self.deps()
            .worktrees
            .clone()
            .ok_or_else(|| invalid("Git worktrees are unavailable in this runtime."))
    }

    async fn git_chat(&self, chat_id: &str) -> Result<ChatRecord, SessionError> {
        let (chat, _) = self
            .deps()
            .store
            .checkpoint_context(chat_id, None)
            .await
            .map_err(|error| storage_error(&error))?;
        if chat.agent_host != aura_protocol::agents::AgentHost::Native {
            return Err(invalid(
                "Git worktrees are supported only on this device's native host.",
            ));
        }
        Ok(chat)
    }

    pub async fn git_workspace(&self, chat_id: &str) -> Result<GitWorkspace, SessionError> {
        let chat = self.git_chat(chat_id).await?;
        self.worktrees()?
            .inspect(&chat.folder)
            .await
            .map_err(|error| invalid(error.to_string()))
    }

    pub async fn managed_worktrees(
        &self,
        chat_id: &str,
    ) -> Result<Vec<ManagedWorktree>, SessionError> {
        self.git_chat(chat_id).await?;
        self.worktrees()?
            .list(chat_id)
            .await
            .map_err(|error| invalid(error.to_string()))
    }

    pub async fn isolation_preview(
        &self,
        chat_id: &str,
        input: IsolationInput,
    ) -> Result<IsolationPreview, SessionError> {
        let chat = self.git_chat(chat_id).await?;
        self.worktrees()?
            .isolation_preview(chat_id, &chat.folder, input)
            .await
            .map_err(|error| invalid(error.to_string()))
    }

    pub async fn isolation_apply(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<IsolationResult, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let token = token.to_owned();
        self.deps()
            .rt
            .spawn(async move {
                let _organization = manager.shared().organization.lock().await;
                let chat = manager.git_chat(&chat_id).await?;
                let _reservations = manager.reserve_git_folders(vec![chat.folder]).await?;
                manager
                    .worktrees()?
                    .isolation_apply(&chat_id, &token)
                    .await
                    .map_err(|error| invalid(error.to_string()))
            })
            .await
            .map_err(|_| {
                invalid("The worktree task ended unexpectedly. Review the saved worktree state.")
            })?
    }

    pub async fn worktree_action_preview(
        &self,
        chat_id: &str,
        worktree_id: &str,
        action: WorktreeAction,
    ) -> Result<WorktreeActionPreview, SessionError> {
        self.git_chat(chat_id).await?;
        self.worktrees()?
            .action_preview(chat_id, worktree_id, action)
            .await
            .map_err(|error| invalid(error.to_string()))
    }

    pub async fn worktree_action_apply(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<WorktreeActionResult, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let token = token.to_owned();
        // A dropped IPC reply does not release reservations while the owned Git command runs.
        // The task finishes journaling success or recovery before releasing actors and folders.
        self.deps().rt.spawn(async move {
            let _organization=manager.shared().organization.lock().await;
            manager.git_chat(&chat_id).await?;
            let service=manager.worktrees()?;
            let records=service.list(&chat_id).await.map_err(|error|invalid(error.to_string()))?;
            let mut folders=Vec::new();
            // Conservatively reserve every active worktree owned by this chat as well as sources.
            // The service still binds the token to one exact record before mutation.
            for record in records.into_iter().filter(|record|record.state==aura_protocol::git::WorktreeState::Ready) {
                folders.push(PathBuf::from(record.source));folders.push(PathBuf::from(record.path));
            }
            let _reservations=manager.reserve_git_folders(folders).await?;
            service.action_apply(&chat_id,&token).await.map_err(|error|invalid(error.to_string()))
        }).await.map_err(|_|invalid("The Git task ended unexpectedly. Review its recovery record before trying again."))?
    }

    pub(super) async fn reserve_git_folders(
        &self,
        folders: Vec<PathBuf>,
    ) -> Result<Reservations, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        if self.deps().store.is_paused() {
            return Err(SessionError::StorageUnavailable(
                "Wait for saving to resume before Git actions.".into(),
            ));
        }
        let chats = self
            .deps()
            .store
            .chats()
            .await
            .map_err(|error| storage_error(&error))?;
        let (folders, chats) = self
            .deps()
            .rt
            .spawn_blocking(move || {
                let mut folders = folders
                    .into_iter()
                    .map(live::normalize_path)
                    .collect::<Vec<_>>();
                folders.sort();
                folders.dedup();
                let chats = chats
                    .into_iter()
                    .filter(|chat| folders.contains(&live::normalize_path(chat.folder.clone())))
                    .map(|chat| chat.id)
                    .collect::<Vec<_>>();
                (folders, chats)
            })
            .await
            .map_err(|_| invalid("Could not resolve Git folder ownership."))?;
        let mut reservations = Reservations {
            shared: Arc::clone(self.shared()),
            folders: Vec::new(),
            actors: Vec::new(),
        };
        for folder in folders {
            if !self.shared().live.reserve_folder(&folder) {
                return Err(invalid(
                    "Stop all chats using these folders, including startup and shutdown, before Git actions.",
                ));
            }
            reservations.folders.push(folder);
        }
        for chat in chats {
            let id = crate::ids::new_id();
            let mailbox = self.actor(&chat);
            let (reply, answer) = oneshot::channel();
            mailbox
                .send(ChatMsg::ReserveGit {
                    id: id.clone(),
                    reply,
                })
                .map_err(|_| stopped())?;
            // Register the release before awaiting, so cancellation cannot leave an actor locked.
            reservations.actors.push((mailbox, id));
            answer.await.map_err(|_| stopped())??;
        }
        Ok(reservations)
    }

    pub async fn worktree_recovery_preview(
        &self,
        chat_id: &str,
        worktree_id: &str,
        action: WorktreeRecoveryAction,
    ) -> Result<WorktreeRecoveryPreview, SessionError> {
        self.git_chat(chat_id).await?;
        self.worktrees()?
            .recovery_preview(chat_id, worktree_id, action)
            .await
            .map_err(|error| invalid(error.to_string()))
    }

    pub async fn worktree_recovery_apply(
        &self,
        chat_id: &str,
        worktree_id: &str,
        token: &str,
    ) -> Result<WorktreeActionResult, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let worktree_id = worktree_id.to_owned();
        let token = token.to_owned();
        self.deps().rt.spawn(async move {
            let _organization = manager.shared().organization.lock().await;
            manager.git_chat(&chat_id).await?;
            let service = manager.worktrees()?;
            let folders = service.recovery_folders(&chat_id, &worktree_id).await
                .map_err(|error| invalid(error.to_string()))?;
            let _reservations = manager.reserve_git_folders(folders).await?;
            service.recovery_apply(&chat_id, &worktree_id, &token).await
                .map_err(|error| invalid(error.to_string()))
        }).await.map_err(|_| invalid("The recovery task ended unexpectedly. Its saved state and files remain available for review."))?
    }
}
