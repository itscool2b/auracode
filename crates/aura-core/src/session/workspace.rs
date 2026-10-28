//! Project organization and device-local folder preflight. No operation moves files on disk.

use aura_protocol::workspace::{
    ChatCreatePreview, ChatMove, ProjectChatCreate, ProjectCreate, ProjectFolder, ProjectInput,
    ProjectSummary, WorkspaceChat, WorkspaceFilter, WorkspaceSnapshot,
};

use super::*;
use crate::chatstore::organization::{Organization, OrganizationCommand};

impl SessionManager {
    async fn portable_folder_identity(
        &self,
        folder: &std::path::Path,
    ) -> Option<crate::gitworkspaces::FolderIdentity> {
        self.deps()
            .worktrees
            .as_ref()?
            .folder_identity(folder)
            .await
            .ok()
    }

    pub async fn workspace_snapshot(
        &self,
        filter: WorkspaceFilter,
    ) -> Result<WorkspaceSnapshot, SessionError> {
        if let Some(id) = &filter.project_id {
            bounded(id, "Project ID", 128)?;
        }
        let organization = self
            .organization(OrganizationCommand::Snapshot(filter))
            .await?;
        Ok(self.workspace_view(organization).await)
    }

    pub async fn project_create(
        &self,
        request: ProjectCreate,
    ) -> Result<ProjectSummary, SessionError> {
        self.validate_project(&request.project)?;
        let folder = checked_folder(&request.folder).await?;
        let identity = self.portable_folder_identity(&folder).await;
        let organization = self
            .organization(OrganizationCommand::CreateProject {
                id: crate::ids::new_id(),
                input: request.project,
                folder,
                identity,
            })
            .await?;
        let id = organization.affected_id.clone();
        self.workspace_view(organization)
            .await
            .projects
            .into_iter()
            .find(|project| Some(&project.id) == id.as_ref())
            .ok_or_else(missing)
    }

    pub async fn project_update(
        &self,
        project_id: &str,
        input: ProjectInput,
    ) -> Result<ProjectSummary, SessionError> {
        bounded(project_id, "Project ID", 128)?;
        self.validate_project(&input)?;
        let organization = self
            .organization(OrganizationCommand::UpdateProject {
                id: project_id.into(),
                input,
            })
            .await?;
        self.workspace_view(organization)
            .await
            .projects
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or_else(missing)
    }

    pub async fn project_add_folder(
        &self,
        project_id: &str,
        path: &str,
    ) -> Result<ProjectFolder, SessionError> {
        bounded(project_id, "Project ID", 128)?;
        let folder = checked_folder(path).await?;
        let identity = self.portable_folder_identity(&folder).await;
        let organization = self
            .organization(OrganizationCommand::AddFolder {
                project_id: project_id.into(),
                folder,
                identity,
            })
            .await?;
        let id = organization.affected_id.clone();
        self.workspace_view(organization)
            .await
            .projects
            .into_iter()
            .flat_map(|project| project.folders)
            .find(|folder| Some(&folder.id) == id.as_ref())
            .ok_or_else(missing)
    }

    pub async fn chat_rename(
        &self,
        chat_id: &str,
        title: &str,
    ) -> Result<WorkspaceChat, SessionError> {
        bounded(title, "Chat title", 512)?;
        self.organize_chat(
            chat_id,
            OrganizationCommand::RenameChat {
                id: chat_id.into(),
                title: title.trim().into(),
            },
        )
        .await
    }

    pub async fn chat_pin(
        &self,
        chat_id: &str,
        pinned: bool,
    ) -> Result<WorkspaceChat, SessionError> {
        self.organize_chat(
            chat_id,
            OrganizationCommand::PinChat {
                id: chat_id.into(),
                pinned,
            },
        )
        .await
    }

    pub async fn chat_archive(
        &self,
        chat_id: &str,
        archived: bool,
    ) -> Result<WorkspaceChat, SessionError> {
        self.organize_chat(
            chat_id,
            OrganizationCommand::ArchiveChat {
                id: chat_id.into(),
                archived,
            },
        )
        .await
    }

    pub async fn chat_move(
        &self,
        chat_id: &str,
        request: ChatMove,
    ) -> Result<WorkspaceChat, SessionError> {
        bounded(&request.project_id, "Project ID", 128)?;
        let _guard = self.shared().organization.lock().await;
        let mut preserves_folder = true;
        if let Some(folder_id) = &request.folder_id {
            let preview = self.chat_create_preview(folder_id).await?;
            if preview.folder.project_id != request.project_id {
                return Err(invalid(
                    "The folder does not belong to the destination project.",
                ));
            }
            let destination = PathBuf::from(usable(&preview.folder)?);
            let current = self
                .deps()
                .store
                .chats()
                .await
                .map_err(|error| storage_error(&error))?
                .into_iter()
                .find(|chat| chat.id == chat_id)
                .map(|chat| chat.folder);
            // Archived chats are absent from the legacy list, so consult the complete workspace.
            let current = match current {
                Some(path) => path,
                None => self
                    .workspace_snapshot(WorkspaceFilter {
                        include_archived: true,
                        project_id: None,
                    })
                    .await?
                    .chats
                    .into_iter()
                    .find(|chat| chat.chat.id == chat_id)
                    .map(|chat| PathBuf::from(chat.chat.folder))
                    .ok_or_else(missing)?,
            };
            preserves_folder = tokio::task::spawn_blocking(move || {
                live::normalize_path(current) == live::normalize_path(destination)
            })
            .await
            .map_err(|_| SessionError::Internal("Checking the chat folder failed.".into()))?;
            if !request.allow_busy_folder
                && preview.busy_chats.iter().any(|chat| chat.id != chat_id)
            {
                return Err(invalid(
                    "This folder has an active chat. Review the busy-folder warning before continuing.",
                ));
            }
        }
        self.organize_chat(
            chat_id,
            OrganizationCommand::MoveChat {
                id: chat_id.into(),
                project_id: request.project_id,
                folder_id: request.folder_id,
                preserves_folder,
            },
        )
        .await
    }

    pub async fn chat_create_preview(
        &self,
        folder_id: &str,
    ) -> Result<ChatCreatePreview, SessionError> {
        bounded(folder_id, "Folder ID", 128)?;
        let workspace = self
            .workspace_snapshot(WorkspaceFilter {
                include_archived: true,
                project_id: None,
            })
            .await?;
        let folder = workspace
            .projects
            .into_iter()
            .flat_map(|project| project.folders)
            .find(|folder| folder.id == folder_id)
            .ok_or_else(missing)?;
        let candidates: Vec<_> = workspace
            .chats
            .into_iter()
            .map(|chat| chat.chat)
            .filter(|chat| self.shared().live.contains(&chat.id))
            .collect();
        let path = folder.path.clone();
        let busy_chats = tokio::task::spawn_blocking(move || {
            let Some(path) = path else {
                return Vec::new();
            };
            let key = live::normalize_path(PathBuf::from(path));
            candidates
                .into_iter()
                .filter(|chat| live::normalize_path(PathBuf::from(&chat.folder)) == key)
                .collect()
        })
        .await
        .map_err(|_| SessionError::Internal("Checking active folders failed.".into()))?;
        Ok(ChatCreatePreview { folder, busy_chats })
    }

    /// Persists a chat before starting its agent. A failed start remains a visible saved chat.
    pub async fn chat_project_create(
        &self,
        request: ProjectChatCreate,
    ) -> Result<WorkspaceChat, SessionError> {
        bounded(&request.agent_id, "Agent ID", 128)?;
        if self.deps().detector.spec(&request.agent_id).is_none() {
            return Err(SessionError::UnknownAgent(request.agent_id));
        }
        let _guard = self.shared().organization.lock().await;
        let preview = self.chat_create_preview(&request.folder_id).await?;
        let path = usable(&preview.folder)?;
        checked_folder(path).await?;
        if !request.allow_busy_folder && !preview.busy_chats.is_empty() {
            return Err(invalid(
                "This folder has an active chat. Review the busy-folder warning before continuing.",
            ));
        }
        let chat_id = crate::ids::new_id();
        let organization = self
            .organization(OrganizationCommand::CreateChat {
                id: chat_id.clone(),
                folder_id: request.folder_id,
                agent_id: request.agent_id,
            })
            .await?;
        let _ = self
            .ask(&chat_id, |reply| ChatMsg::Start {
                fresh: false,
                explicit: false,
                reply,
            })
            .await;
        self.workspace_view(organization)
            .await
            .chats
            .into_iter()
            .find(|chat| chat.chat.id == chat_id)
            .ok_or_else(missing)
    }

    fn validate_project(&self, input: &ProjectInput) -> Result<(), SessionError> {
        bounded(&input.name, "Project name", 256)?;
        if let Some(color) = &input.color
            && (color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(invalid("Project color must be a six-digit hex color."));
        }
        if let Some(agent) = &input.default_agent {
            bounded(agent, "Default agent", 128)?;
            if self.deps().detector.spec(agent).is_none() {
                return Err(SessionError::UnknownAgent(agent.clone()));
            }
        }
        if let Some(model) = &input.default_model {
            bounded(model, "Default model", 256)?;
        }
        Ok(())
    }

    pub(super) async fn organization(
        &self,
        command: OrganizationCommand,
    ) -> Result<Organization, SessionError> {
        if !command.is_read() && self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        self.deps()
            .store
            .organize(command)
            .await
            .map_err(|error| storage_error(&error))
    }

    async fn organize_chat(
        &self,
        chat_id: &str,
        command: OrganizationCommand,
    ) -> Result<WorkspaceChat, SessionError> {
        bounded(chat_id, "Chat ID", 128)?;
        let result = self
            .ask(chat_id, |reply| ChatMsg::Organize {
                command: command.clone(),
                reply,
            })
            .await?;
        self.workspace_view(result)
            .await
            .chats
            .into_iter()
            .find(|chat| chat.chat.id == chat_id)
            .ok_or_else(missing)
    }

    pub(super) async fn workspace_view(&self, mut organization: Organization) -> WorkspaceSnapshot {
        let paths = organization
            .projects
            .iter()
            .flat_map(|project| &project.folders)
            .filter_map(|folder| folder.path.as_ref().map(PathBuf::from))
            .collect();
        let checked = self.check_folders(paths).await;
        for project in &mut organization.projects {
            for folder in &mut project.folders {
                if let Some(path) = &folder.path {
                    folder.folder_state = checked
                        .get(&PathBuf::from(path))
                        .copied()
                        .unwrap_or(FolderState::Ok);
                    folder.unavailable_reason = match (checked.get(&PathBuf::from(path)), folder.folder_state) {
                        (None, _) => Some("The folder check has not finished. Try again shortly.".into()),
                        (_, FolderState::Ok) => None,
                        (_, FolderState::Missing) => Some("This folder is missing on this device. Locate it before starting a chat.".into()),
                        (_, FolderState::NotAllowed) => Some(FOLDER_NOT_ALLOWED.into()),
                    };
                }
            }
        }
        let chats = organization
            .chats
            .into_iter()
            .map(|record| {
                let state = self.shared().state(&record.chat.id);
                let found = checked.get(&record.chat.folder).copied().or_else(|| {
                    record
                        .chat
                        .folder
                        .as_os_str()
                        .is_empty()
                        .then_some(FolderState::Missing)
                });
                WorkspaceChat {
                    chat: self.summary(record.chat, state, found),
                    project_id: record.project_id,
                    folder_id: record.folder_id,
                    pinned: record.pinned,
                    archived: record.archived,
                }
            })
            .collect();
        WorkspaceSnapshot {
            projects: organization.projects,
            chats,
        }
    }
}

pub(super) fn bounded(value: &str, label: &str, max: usize) -> Result<(), SessionError> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(invalid(&format!(
            "{label} must contain 1 to {max} bytes without control characters."
        )));
    }
    Ok(())
}

pub(super) async fn checked_folder(path: &str) -> Result<PathBuf, SessionError> {
    bounded(path, "Folder path", 32_768)?;
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(invalid("Choose an absolute folder path."));
    }
    tokio::task::spawn_blocking(move || {
        check_new_folder(&path)?;
        // Windows canonical paths are verbatim (`\\?\C:\...`); store and show the plain spelling
        // whenever it names the same folder.
        std::fs::canonicalize(path)
            .map(|path| crate::fsutil::plain_path(&path))
            .map_err(|error| invalid(&format!("Cannot resolve this folder: {error}")))
    })
    .await
    .map_err(|_| SessionError::Internal("Checking the folder failed.".into()))?
}

pub(super) fn usable(folder: &ProjectFolder) -> Result<&str, SessionError> {
    if folder.folder_state != FolderState::Ok || folder.unavailable_reason.is_some() {
        return Err(invalid(
            folder
                .unavailable_reason
                .as_deref()
                .unwrap_or("This folder is unavailable."),
        ));
    }
    folder
        .path
        .as_deref()
        .ok_or_else(|| invalid("Locate this folder on this device."))
}

pub(super) fn missing() -> SessionError {
    invalid("The project, folder, or chat no longer exists.")
}
fn invalid(message: &str) -> SessionError {
    SessionError::Organization(message.into())
}
