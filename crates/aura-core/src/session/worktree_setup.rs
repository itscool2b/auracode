use super::*;
use aura_protocol::worktree_setup::{
    WorktreeSetup, WorktreeSetupAttempt, WorktreeSetupInput, WorktreeSetupState,
};

pub struct WorktreeSetupLaunch {
    pub spec: aura_process::SpawnSpec,
    pub guard: Box<dyn Send + Sync>,
    pub completion: Option<oneshot::Sender<Result<(), String>>>,
}

impl SessionManager {
    pub(super) async fn set_setup_attempt(
        &self,
        chat_id: &str,
        expected_generation: Option<u32>,
        state: WorktreeSetupState,
        detail: Option<String>,
    ) -> Result<Option<WorktreeSetupAttempt>, SessionError> {
        let detail = detail.map(|text| {
            self.deps()
                .redactor
                .redact_text(&text)
                .chars()
                .take(2048)
                .collect()
        });
        let attempt = self
            .deps()
            .store
            .setup_attempt(crate::chatstore::setup_attempt::Command {
                chat_id: chat_id.into(),
                expected_generation,
                state,
                detail,
            })
            .await
            .map_err(|error| storage_error(&error))?;
        if let Some(attempt) = &attempt
            && let Some(mailbox) = self.existing_actor(chat_id)
        {
            let _ = mailbox.send(ChatMsg::SetupChanged(attempt.clone()));
        }
        Ok(attempt)
    }
    pub async fn worktree_setup_preview(
        &self,
        chat_id: &str,
        worktree_id: &str,
    ) -> Result<aura_protocol::worktree_setup::WorktreeSetupPreview, SessionError> {
        self.setup_preview_with_files(chat_id, worktree_id, true)
            .await
    }

    /// Explicit command reruns do not recopy or overwrite files already present in the worktree.
    pub async fn worktree_setup_command_preview(
        &self,
        chat_id: &str,
        worktree_id: &str,
    ) -> Result<aura_protocol::worktree_setup::WorktreeSetupPreview, SessionError> {
        self.setup_preview_with_files(chat_id, worktree_id, false)
            .await
    }

    async fn setup_preview_with_files(
        &self,
        chat_id: &str,
        worktree_id: &str,
        copy_files: bool,
    ) -> Result<aura_protocol::worktree_setup::WorktreeSetupPreview, SessionError> {
        let mut settings = self.worktree_setup(chat_id).await?;
        if !copy_files {
            settings.input.files.clear();
        }
        let preview = self
            .worktrees()?
            .setup_preview(chat_id, worktree_id, settings.input)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        if Path::new(&preview.source).canonicalize().ok()
            != Path::new(&settings.source).canonicalize().ok()
        {
            return Err(SessionError::Organization(
                "This worktree uses another setup source. Review its original folder first.".into(),
            ));
        }
        Ok(preview)
    }

    pub async fn worktree_setup_apply(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<aura_protocol::worktree_setup::WorktreeSetupResult, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let token = token.to_owned();
        self.deps().rt.spawn(async move {
            manager.apply_worktree_setup_owned(&chat_id, &token).await
        }).await.map_err(|_| SessionError::Organization("Setup stopped unexpectedly. Inspect copied files before reviewing setup again.".into()))?
    }

    async fn apply_worktree_setup_owned(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<aura_protocol::worktree_setup::WorktreeSetupResult, SessionError> {
        let _organization = self.shared().organization.lock().await;
        self.git_chat(chat_id).await?;
        let service = self.worktrees()?;
        let folders = service
            .setup_folders(chat_id, token)
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        let _reservations = self.reserve_setup_folders(folders, chat_id).await?;
        let current = self
            .deps()
            .store
            .read_setup_attempt(chat_id)
            .await
            .map_err(|error| storage_error(&error))?;
        let attempt = if current.is_some() {
            Some(
                self.set_setup_attempt(chat_id, None, WorktreeSetupState::Awaiting, None)
                    .await?
                    .ok_or_else(|| {
                        SessionError::Organization(
                            "Setup is already running. Wait for it to finish.".into(),
                        )
                    })?,
            )
        } else {
            None
        };
        let result = service
            .setup_apply(chat_id, token)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()));
        if let Some(attempt) = attempt {
            if let Ok(value) = &result
                && let Some(token) = &value.command_token
            {
                service
                    .bind_setup_generation(chat_id, token, attempt.generation)
                    .map_err(|error| SessionError::Organization(error.to_string()))?;
            }
            match &result {
                Ok(value) if value.warning.is_some() || value.command_token.is_none() => {
                    let state = if value.warning.is_some() {
                        WorktreeSetupState::Failed
                    } else {
                        WorktreeSetupState::Succeeded
                    };
                    self.set_setup_attempt(
                        chat_id,
                        Some(attempt.generation),
                        state,
                        value.warning.clone(),
                    )
                    .await?;
                }
                Err(error) => {
                    self.set_setup_attempt(
                        chat_id,
                        Some(attempt.generation),
                        WorktreeSetupState::Failed,
                        Some(error.to_string()),
                    )
                    .await?;
                }
                _ => {}
            }
        }
        result
    }

    pub async fn prepare_worktree_setup_terminal(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<WorktreeSetupLaunch, SessionError> {
        let _organization = self.shared().organization.lock().await;
        self.git_chat(chat_id).await?;
        let service = self.worktrees()?;
        let folders = service
            .setup_folders(chat_id, token)
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        let reservations = self.reserve_setup_folders(folders, chat_id).await?;
        let attempt = self
            .deps()
            .store
            .read_setup_attempt(chat_id)
            .await
            .map_err(|error| storage_error(&error))?;
        let completion = if let Some(attempt) = attempt {
            if service
                .setup_generation(chat_id, token)
                .map_err(|error| SessionError::Organization(error.to_string()))?
                != Some(attempt.generation)
            {
                return Err(SessionError::Organization(
                    "This command belongs to an older setup attempt. Review setup again.".into(),
                ));
            }
            let running = self
                .set_setup_attempt(
                    chat_id,
                    Some(attempt.generation),
                    WorktreeSetupState::Running,
                    None,
                )
                .await?
                .ok_or_else(|| {
                    SessionError::Organization(
                        "Review setup before starting this attempt again.".into(),
                    )
                })?;
            let (completion, finished) = oneshot::channel::<Result<(), String>>();
            let manager = self.clone();
            let chat_id = chat_id.to_owned();
            self.deps().rt.spawn(async move {
                let result = finished.await.unwrap_or_else(|_| Err("Setup could not start or its terminal closed before completion. Retry setup.".into()));
                let succeeded = result.is_ok();
                let detail = result.err();
                let saved = manager.set_setup_attempt(&chat_id,Some(running.generation),if succeeded {WorktreeSetupState::Succeeded}else{WorktreeSetupState::Failed},detail).await;
                if succeeded && matches!(saved,Ok(Some(_))) && manager.existing_actor(&chat_id).is_none() {
                    let _ = manager.start(&chat_id,false).await;
                }
            });
            Some(completion)
        } else {
            None
        };
        let spec = service
            .setup_command(chat_id, token)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        Ok(WorktreeSetupLaunch {
            spec,
            guard: Box::new(reservations),
            completion,
        })
    }
    pub async fn worktree_setup(&self, chat_id: &str) -> Result<WorktreeSetup, SessionError> {
        self.setup_settings(chat_id, None).await
    }
    pub async fn worktree_setup_save(
        &self,
        chat_id: &str,
        input: WorktreeSetupInput,
    ) -> Result<WorktreeSetup, SessionError> {
        crate::gitworkspaces::setup::validate(&input)
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        self.setup_settings(chat_id, Some(input)).await
    }
    async fn setup_settings(
        &self,
        chat_id: &str,
        save: Option<WorktreeSetupInput>,
    ) -> Result<WorktreeSetup, SessionError> {
        let _organization = self.shared().organization.lock().await;
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let chat = self.git_chat(chat_id).await?;
        let source = self
            .worktrees()?
            .setup_source(chat_id, &chat.folder)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()))?;
        // Legacy chats may have a normal Windows path while Git reports a verbatim canonical
        // path. Resolve the saved mapping outside the database writer and keep its exact spelling.
        let source = if chat.folder.canonicalize().ok().as_ref() == Some(&source) {
            chat.folder.to_string_lossy().into_owned()
        } else {
            let organization = self
                .deps()
                .store
                .organize(
                    crate::chatstore::organization::OrganizationCommand::Snapshot(
                        aura_protocol::workspace::WorkspaceFilter {
                            include_archived: true,
                            project_id: None,
                        },
                    ),
                )
                .await
                .map_err(|error| storage_error(&error))?;
            let paths = organization
                .projects
                .into_iter()
                .find(|project| {
                    project
                        .folders
                        .iter()
                        .any(|folder| Some(&folder.id) == chat.folder_id.as_ref())
                })
                .map(|project| {
                    project
                        .folders
                        .into_iter()
                        .filter_map(|folder| folder.path)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            tokio::task::spawn_blocking(move || {
                paths
                    .into_iter()
                    .find(|path| Path::new(path).canonicalize().ok().as_ref() == Some(&source))
            })
            .await
            .map_err(|_| SessionError::Organization("Could not resolve this setup source.".into()))?
            .ok_or_else(|| {
                SessionError::Organization(
                    "The original setup folder no longer belongs to this project.".into(),
                )
            })?
        };
        self.deps()
            .store
            .worktree_setup(crate::chatstore::worktree_setup::Command {
                chat_id: chat_id.into(),
                source,
                save,
                folder_id: None,
                folder_save: false,
            })
            .await
            .map_err(|error| storage_error(&error))
    }
}
