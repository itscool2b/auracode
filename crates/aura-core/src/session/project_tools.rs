//! Explicit project utilities share the native profile and folder admission rules.
use super::*;
use aura_protocol::git::{GitInitializePreview, GitWorkspace};

impl SessionManager {
    pub async fn git_initialize_preview(
        &self,
        chat_id: &str,
        initial_branch: &str,
    ) -> Result<GitInitializePreview, SessionError> {
        let chat = self.git_chat(chat_id).await?;
        self.worktrees()?
            .initialize_preview(chat_id, &chat.folder, initial_branch)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()))
    }

    pub async fn git_initialize_apply(
        &self,
        chat_id: &str,
        token: &str,
        admission: Box<dyn Send + Sync>,
    ) -> Result<GitWorkspace, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let token = token.to_owned();
        self.deps()
            .rt
            .spawn(async move {
                let _admission = admission;
                let _organization = manager.shared().organization.lock().await;
                let chat = manager.git_chat(&chat_id).await?;
                let _reservation = manager
                    .reserve_git_folders(vec![chat.folder.clone()])
                    .await?;
                manager
                    .worktrees()?
                    .initialize_apply(&chat_id, &chat.folder, &token)
                    .await
                    .map_err(|error| SessionError::Organization(error.to_string()))
            })
            .await
            .map_err(|_| {
                SessionError::Organization(
                    "Initialization stopped unexpectedly. Inspect the folder before retrying."
                        .into(),
                )
            })?
    }
}
