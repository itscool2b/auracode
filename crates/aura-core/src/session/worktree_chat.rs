//! One-step "new chat in its own worktree". The preview names everything that will happen; the
//! apply creates the worktree, saves the chat in it and runs the reviewed setup. A chat that cannot
//! be saved rolls back only the branch and folder this operation created.

use aura_protocol::git::{
    ChatFolderMode, ManagedWorktree, WorktreeChatChip, WorktreeChatInput, WorktreeChatPreview,
    WorktreeChatResult,
};
use aura_protocol::worktree_setup::{WorktreeSetupInput, WorktreeSetupResult};

use super::workspace::{bounded, checked_folder, missing, usable};
use super::*;
use crate::chatstore::organization::{Organization, OrganizationCommand};
use crate::gitworkspaces::{NewChatPlan, NewChatRequest};

pub(super) struct Prepared {
    chat_id: String,
    folder_id: String,
    source: PathBuf,
    agent_id: String,
    title: Option<String>,
    bring_changes: bool,
    setup: Option<WorktreeSetupInput>,
    expires: Instant,
}

fn invalid(message: impl Into<String>) -> SessionError {
    SessionError::Organization(message.into())
}

fn present(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

impl SessionManager {
    /// Reviews a new chat whose folder will be a new worktree of a project folder. Nothing is
    /// created. A folder that is not a repository root returns the direct fallback instead.
    pub async fn worktree_chat_preview(
        &self,
        input: WorktreeChatInput,
    ) -> Result<WorktreeChatPreview, SessionError> {
        bounded(&input.agent_id, "Agent ID", 128)?;
        if self.deps().detector.spec(&input.agent_id).is_none() {
            return Err(SessionError::UnknownAgent(input.agent_id));
        }
        let title = present(&input.title);
        if let Some(title) = title {
            bounded(title, "Chat title", 512)?;
        }
        for (value, label) in [
            (present(&input.start_branch), "Starting branch"),
            (present(&input.branch), "Branch name"),
        ] {
            if let Some(value) = value {
                bounded(value, label, 256)?;
            }
        }
        let preview = self.chat_create_preview(&input.folder_id).await?;
        let path = usable(&preview.folder)?.to_owned();
        let source = checked_folder(&path).await?;
        let chat_id = crate::ids::new_id();
        let outcome = self
            .worktrees()?
            .new_chat_preview(NewChatRequest {
                chat_id: &chat_id,
                folder: &source,
                start_branch: present(&input.start_branch),
                branch: present(&input.branch),
                title,
                bring_changes: input.bring_changes,
            })
            .await
            .map_err(|error| invalid(error.to_string()))?;
        let mut plan = match outcome {
            NewChatPlan::Direct(message) => {
                return Ok(WorktreeChatPreview::NotGitRepository {
                    folder: path,
                    message,
                    chip: WorktreeChatChip {
                        mode: ChatFolderMode::Direct,
                        starting_branch: None,
                        branch: None,
                        label: format!("Direct in {}", preview.folder.display_name),
                    },
                });
            }
            NewChatPlan::Worktree(plan) => *plan,
        };
        let recipe = self
            .deps()
            .store
            .worktree_setup(crate::chatstore::worktree_setup::Command {
                chat_id: String::new(),
                source: path,
                save: None,
                folder_id: Some(input.folder_id.clone()),
                folder_save: false,
            })
            .await
            .map_err(|error| storage_error(&error))?
            .input;
        let saved = !recipe.files.is_empty() || recipe.command.is_some();
        let setup = (input.run_setup && saved).then_some(recipe);
        if let Some(setup) = &setup {
            if !setup.files.is_empty() {
                plan.warnings.push(format!(
                    "After creation, saved setup copies {} listed file(s) from the source folder. Existing files are never overwritten. Environment files may contain application secrets; their contents are not shown, logged or stored.",
                    setup.files.len()
                ));
            }
            if let Some(command) = &setup.command {
                plan.warnings.push(format!(
                    "Then the saved setup command ({} {}) is ready to run in an owned terminal in the new worktree, before the agent starts. It can modify the worktree and uses your normal command environment.",
                    command.program,
                    command.args.join(" ")
                ));
            }
        } else if saved {
            plan.warnings.push(
                "The saved worktree setup is skipped for this chat. It can be reviewed later from the chat's Git panel."
                    .into(),
            );
        }
        plan.setup = setup.clone();
        let mut prepared = lock(&self.shared().worktree_chats);
        prepared.retain(|_, entry| entry.expires > Instant::now());
        if prepared.len() >= 32 {
            return Err(invalid(
                "Too many new worktree chat previews are open. Wait for one to expire.",
            ));
        }
        prepared.insert(
            plan.token.clone(),
            Prepared {
                chat_id,
                folder_id: input.folder_id,
                source,
                agent_id: input.agent_id,
                title: title.map(str::to_owned),
                bring_changes: input.bring_changes,
                setup,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        Ok(WorktreeChatPreview::Worktree {
            plan: Box::new(plan),
        })
    }

    /// Applies a reviewed worktree chat preview. The worktree is created first, then the chat is
    /// saved with the worktree as its folder. If the chat cannot be saved, the new branch and folder
    /// are removed while they are unchanged; otherwise they stay as a RecoveryRequired record.
    pub async fn worktree_chat_apply(
        &self,
        token: &str,
    ) -> Result<WorktreeChatResult, SessionError> {
        let manager = self.clone();
        let token = token.to_owned();
        // A dropped IPC reply does not interrupt the owned Git command or the rollback journal.
        self.deps()
            .rt
            .spawn(async move { manager.apply_worktree_chat(&token).await })
            .await
            .map_err(|_| {
                invalid(
                    "The new chat task ended unexpectedly. Review the project's chats and worktrees before trying again.",
                )
            })?
    }

    async fn apply_worktree_chat(&self, token: &str) -> Result<WorktreeChatResult, SessionError> {
        let _organization = self.shared().organization.lock().await;
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        if self.deps().store.is_paused() {
            return Err(SessionError::StorageUnavailable(
                "Wait for saving to resume before creating a chat.".into(),
            ));
        }
        let prepared = lock(&self.shared().worktree_chats)
            .remove(token)
            .filter(|prepared| prepared.expires > Instant::now())
            .ok_or_else(|| {
                invalid("This worktree chat preview expired or was already used. Review it again.")
            })?;
        if self.deps().detector.spec(&prepared.agent_id).is_none() {
            return Err(SessionError::UnknownAgent(prepared.agent_id));
        }
        let folder = self.chat_create_preview(&prepared.folder_id).await?;
        if checked_folder(usable(&folder.folder)?).await? != prepared.source {
            return Err(invalid(
                "The project folder changed after the preview. Review it again.",
            ));
        }
        let service = self.worktrees()?;
        // Copying working files reads the source, so its chats and terminals must be idle. Without a
        // copy, Git only adds a branch and a worktree registration; the source is not touched.
        let source = if prepared.bring_changes {
            Some(
                self.reserve_git_folders(vec![prepared.source.clone()])
                    .await?,
            )
        } else {
            None
        };
        let worktree = service
            .new_chat_apply(&prepared.chat_id, token)
            .await
            .map_err(|error| invalid(error.to_string()))?;
        let organization = match self.save_worktree_chat(&prepared, &worktree).await {
            Ok(organization) => organization,
            Err(error) => {
                let rollback = service
                    .new_chat_rollback(&prepared.chat_id, &worktree.id, prepared.bring_changes)
                    .await;
                return Err(match rollback {
                    Ok(()) => invalid(format!(
                        "The chat could not be saved: {error}. The new worktree and branch were removed; the source folder was not changed."
                    )),
                    Err(kept) => invalid(format!(
                        "The chat could not be saved: {error}. The worktree was kept for review at {} on branch {}: {kept}",
                        worktree.path, worktree.branch
                    )),
                });
            }
        };
        drop(source);
        let mut warnings = Vec::new();
        let mut setup = None;
        if let Some(input) = prepared.setup.clone() {
            match self
                .new_worktree_setup(&prepared.chat_id, &worktree, input)
                .await
            {
                Ok(result) => {
                    warnings.extend(result.warning.clone());
                    setup = Some(result);
                }
                Err(error) => warnings.push(format!(
                    "The chat and worktree are ready, but setup did not run: {error}. Review setup from the chat's Git panel."
                )),
            }
        }
        // A pending setup command runs first in its owned terminal; the agent then starts explicitly.
        let started = setup
            .as_ref()
            .is_none_or(|result| result.command_token.is_none());
        if started {
            let _ = self
                .ask(&prepared.chat_id, |reply| ChatMsg::Start {
                    fresh: false,
                    explicit: false,
                    reply,
                })
                .await;
        }
        let chat = self
            .workspace_view(organization)
            .await
            .chats
            .into_iter()
            .find(|chat| chat.chat.id == prepared.chat_id)
            .ok_or_else(missing)?;
        Ok(WorktreeChatResult {
            chat,
            worktree,
            setup,
            started,
            warnings,
        })
    }

    async fn save_worktree_chat(
        &self,
        prepared: &Prepared,
        worktree: &ManagedWorktree,
    ) -> Result<Organization, SessionError> {
        #[cfg(test)]
        if self
            .shared()
            .fail_worktree_chat_save
            .swap(false, Ordering::SeqCst)
        {
            return Err(SessionError::StorageUnavailable(
                "injected save failure".into(),
            ));
        }
        self.organization(OrganizationCommand::CreateWorktreeChat {
            id: prepared.chat_id.clone(),
            source_folder_id: prepared.folder_id.clone(),
            path: PathBuf::from(&worktree.path),
            agent_id: prepared.agent_id.clone(),
            title: prepared.title.clone(),
        })
        .await
    }

    /// Copies the reviewed setup files and prepares the command token, as the explicit setup flow
    /// does. Only the new worktree is reserved: its chat has not started and the source is read.
    async fn new_worktree_setup(
        &self,
        chat_id: &str,
        worktree: &ManagedWorktree,
        input: WorktreeSetupInput,
    ) -> Result<WorktreeSetupResult, SessionError> {
        let service = self.worktrees()?;
        let _reservations = self
            .reserve_git_folders(vec![PathBuf::from(&worktree.path)])
            .await?;
        let preview = service
            .setup_preview(chat_id, &worktree.id, input)
            .await
            .map_err(|error| invalid(error.to_string()))?;
        service
            .setup_apply(chat_id, &preview.token)
            .await
            .map_err(|error| invalid(error.to_string()))
    }
}
