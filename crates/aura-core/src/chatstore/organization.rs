//! Project organization on the existing writer connection. File moves are never performed here.

use std::path::PathBuf;

use aura_protocol::Millis;
use aura_protocol::session::FolderState;
use aura_protocol::workspace::{
    FolderKind, ProjectFolder, ProjectInput, ProjectSummary, WorkspaceFilter,
};
use rusqlite::{Connection, OptionalExtension, params};

use super::{ChatRecord, rows};
use crate::ids::new_id;

#[derive(Debug, Clone)]
pub(crate) enum OrganizationCommand {
    Snapshot(WorkspaceFilter),
    CreateProject {
        id: String,
        input: ProjectInput,
        folder: PathBuf,
    },
    UpdateProject {
        id: String,
        input: ProjectInput,
    },
    AddFolder {
        project_id: String,
        folder: PathBuf,
    },
    RenameChat {
        id: String,
        title: String,
    },
    PinChat {
        id: String,
        pinned: bool,
    },
    ArchiveChat {
        id: String,
        archived: bool,
    },
    MoveChat {
        id: String,
        project_id: String,
        folder_id: Option<String>,
        preserves_folder: bool,
    },
    CreateChat {
        id: String,
        folder_id: String,
        agent_id: String,
    },
}

impl OrganizationCommand {
    pub(crate) fn is_read(&self) -> bool {
        matches!(self, Self::Snapshot(_))
    }

    pub(crate) fn bytes(&self) -> usize {
        let input_bytes = |input: &ProjectInput| {
            input.name.len()
                + input.color.as_ref().map_or(0, String::len)
                + input.default_agent.as_ref().map_or(0, String::len)
                + input.default_model.as_ref().map_or(0, String::len)
        };
        256 + match self {
            Self::Snapshot(filter) => filter.project_id.as_ref().map_or(0, String::len),
            Self::CreateProject { id, input, folder } => {
                id.len() + input_bytes(input) + folder.as_os_str().len()
            }
            Self::UpdateProject { id, input } => id.len() + input_bytes(input),
            Self::AddFolder { project_id, folder } => project_id.len() + folder.as_os_str().len(),
            Self::RenameChat { id, title } => id.len() + title.len(),
            Self::PinChat { id, .. } | Self::ArchiveChat { id, .. } => id.len(),
            Self::MoveChat {
                id,
                project_id,
                folder_id,
                ..
            } => id.len() + project_id.len() + folder_id.as_ref().map_or(0, String::len),
            Self::CreateChat {
                id,
                folder_id,
                agent_id,
            } => id.len() + folder_id.len() + agent_id.len(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct OrganizedChat {
    pub(crate) chat: ChatRecord,
    pub(crate) project_id: String,
    pub(crate) folder_id: Option<String>,
    pub(crate) pinned: bool,
    pub(crate) archived: bool,
}

#[derive(Debug)]
pub(crate) struct Organization {
    pub(crate) projects: Vec<ProjectSummary>,
    pub(crate) chats: Vec<OrganizedChat>,
    pub(crate) affected_id: Option<String>,
}

pub(crate) fn execute(
    conn: &Connection,
    device: &str,
    now: Millis,
    command: OrganizationCommand,
) -> rusqlite::Result<Organization> {
    let affected_id = match command {
        OrganizationCommand::Snapshot(filter) => return snapshot(conn, device, &filter),
        OrganizationCommand::CreateProject { id, input, folder } => {
            conn.execute("INSERT INTO projects (id,name,color,default_agent,default_model,created_at,updated_at,device_id) VALUES (?1,?2,?3,?4,?5,?6,?6,?7)", params![id,input.name,input.color,input.default_agent,input.default_model,now,device])?;
            add_folder(conn, device, now, &id, &folder)?;
            id
        }
        OrganizationCommand::UpdateProject { id, input } => {
            changed(conn.execute("UPDATE projects SET name=?2,color=?3,default_agent=?4,default_model=?5,updated_at=?6,device_id=?7 WHERE id=?1 AND deleted=0", params![id,input.name,input.color,input.default_agent,input.default_model,now,device])?)?;
            id
        }
        OrganizationCommand::AddFolder { project_id, folder } => {
            project_exists(conn, &project_id)?;
            add_folder(conn, device, now, &project_id, &folder)?
        }
        OrganizationCommand::RenameChat { id, title } => {
            changed(conn.execute("UPDATE chats SET title=?2,title_source='manual',updated_at=?3,device_id=?4 WHERE id=?1 AND deleted=0", params![id,title,now,device])?)?;
            id
        }
        OrganizationCommand::PinChat { id, pinned } => {
            changed(conn.execute(
                "UPDATE chats SET pinned=?2,updated_at=?3,device_id=?4 WHERE id=?1 AND deleted=0",
                params![id, pinned, now, device],
            )?)?;
            id
        }
        OrganizationCommand::ArchiveChat { id, archived } => {
            changed(conn.execute(
                "UPDATE chats SET archived=?2,updated_at=?3,device_id=?4 WHERE id=?1 AND deleted=0",
                params![id, archived, now, device],
            )?)?;
            id
        }
        OrganizationCommand::MoveChat {
            id,
            project_id,
            folder_id,
            preserves_folder,
        } => {
            project_exists(conn, &project_id)?;
            let current =
                rows::chat(conn, device, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let folder_id = match folder_id {
                Some(folder_id) => {
                    let actual: String = conn.query_row(
                        "SELECT project_id FROM project_folders WHERE id=?1 AND deleted=0",
                        [&folder_id],
                        |row| row.get(0),
                    )?;
                    if actual != project_id {
                        return Err(rusqlite::Error::InvalidParameterName(
                            "The folder does not belong to the destination project.".into(),
                        ));
                    }
                    let _: String = conn.query_row(
                        "SELECT path FROM folder_locations WHERE folder_id=?1 AND device_id=?2",
                        params![folder_id, device],
                        |row| row.get(0),
                    )?;
                    let has_session: bool = conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE chat_id=?1)",
                        [&id],
                        |row| row.get(0),
                    )?;
                    if has_session && !preserves_folder {
                        return Err(rusqlite::Error::InvalidParameterName(
                            "This chat has agent history in its current folder. Create a new chat in the destination folder until visible handoff is available.".into(),
                        ));
                    }
                    folder_id
                }
                None => {
                    if current.folder.as_os_str().is_empty() {
                        return Err(rusqlite::Error::InvalidParameterName(
                            "Locate the chat folder on this device before moving the chat.".into(),
                        ));
                    }
                    add_folder(conn, device, now, &project_id, &current.folder)?
                }
            };
            changed(conn.execute("UPDATE chats SET project_id=?2,folder_id=?3,updated_at=?4,device_id=?5 WHERE id=?1 AND deleted=0", params![id,project_id,folder_id,now,device])?)?;
            id
        }
        OrganizationCommand::CreateChat {
            id,
            folder_id,
            agent_id,
        } => {
            let project_id: String = conn.query_row("SELECT pf.project_id FROM project_folders pf JOIN projects p ON p.id=pf.project_id JOIN folder_locations fl ON fl.folder_id=pf.id AND fl.device_id=?2 WHERE pf.id=?1 AND pf.deleted=0 AND p.deleted=0", params![folder_id,device], |row| row.get(0))?;
            conn.execute("INSERT INTO chats (id,project_id,folder_id,active_agent,created_at,updated_at,device_id,agent_host) VALUES (?1,?2,?3,?4,?5,?5,?6,'{\"type\":\"native\"}')", params![id,project_id,folder_id,agent_id,now,device])?;
            id
        }
    };
    let mut result = snapshot(
        conn,
        device,
        &WorkspaceFilter {
            include_archived: true,
            project_id: None,
        },
    )?;
    result.affected_id = Some(affected_id);
    Ok(result)
}

fn changed(count: usize) -> rusqlite::Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(rusqlite::Error::QueryReturnedNoRows)
    }
}

fn project_exists(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.query_row(
        "SELECT 1 FROM projects WHERE id=?1 AND deleted=0",
        [id],
        |_| Ok(()),
    )
}

pub(super) fn add_folder(
    conn: &Connection,
    device: &str,
    now: Millis,
    project: &str,
    path: &std::path::Path,
) -> rusqlite::Result<String> {
    let shown = path.to_string_lossy();
    let existing = conn.query_row("SELECT pf.id FROM project_folders pf JOIN folder_locations fl ON fl.folder_id=pf.id AND fl.device_id=?2 WHERE pf.project_id=?1 AND pf.deleted=0 AND fl.path=?3 LIMIT 1", params![project,device,shown], |row| row.get::<_,String>(0)).optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = new_id();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| shown.clone());
    conn.execute("INSERT INTO project_folders (id,project_id,display_name,kind,origin_device_id,created_at,updated_at,device_id) VALUES (?1,?2,?3,'local',?4,?5,?5,?4)", params![id,project,name,device,now])?;
    conn.execute(
        "INSERT INTO folder_locations (folder_id,device_id,path,last_seen_at) VALUES (?1,?2,?3,?4)",
        params![id, device, shown, now],
    )?;
    conn.execute(
        "UPDATE projects SET updated_at=?2,device_id=?3 WHERE id=?1",
        params![project, now, device],
    )?;
    Ok(id)
}

fn snapshot(
    conn: &Connection,
    device: &str,
    filter: &WorkspaceFilter,
) -> rusqlite::Result<Organization> {
    let mut statement = conn.prepare("SELECT id,name,color,default_agent,default_model,created_at,updated_at FROM projects WHERE deleted=0 ORDER BY sort_key,name,id")?;
    let mut projects = statement
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                default_agent: row.get(3)?,
                default_model: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                folders: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare("SELECT pf.id,pf.project_id,pf.display_name,fl.path,pf.kind,pf.git_remote_url,pf.git_default_branch FROM project_folders pf LEFT JOIN folder_locations fl ON fl.folder_id=pf.id AND fl.device_id=?1 WHERE pf.deleted=0 ORDER BY pf.sort_key,pf.created_at,pf.id")?;
    let folders = statement
        .query_map([device], |row| {
            let path: Option<String> = row.get(3)?;
            let absent = path.is_none();
            Ok(ProjectFolder {
                id: row.get(0)?,
                project_id: row.get(1)?,
                display_name: row.get(2)?,
                path,
                folder_state: if absent {
                    FolderState::Missing
                } else {
                    FolderState::Ok
                },
                unavailable_reason: absent.then(|| "Locate this folder on this device.".into()),
                kind: if row.get::<_, String>(4)? == "git" {
                    FolderKind::Git
                } else {
                    FolderKind::Local
                },
                git_remote_url: row.get(5)?,
                git_default_branch: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for folder in folders {
        if let Some(project) = projects
            .iter_mut()
            .find(|project| project.id == folder.project_id)
        {
            project.folders.push(folder);
        }
    }
    let mut statement = conn.prepare("SELECT c.id,c.project_id,c.folder_id,c.pinned,c.archived FROM chats c JOIN projects p ON p.id=c.project_id WHERE c.deleted=0 AND p.deleted=0 AND (?1 OR c.archived=0) AND (?2 IS NULL OR c.project_id=?2) ORDER BY c.pinned DESC,c.updated_at DESC,c.id DESC")?;
    let metadata = statement
        .query_map(params![filter.include_archived, filter.project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut chats = Vec::with_capacity(metadata.len());
    for (id, project_id, folder_id, pinned, archived) in metadata {
        let chat = rows::chat(conn, device, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        chats.push(OrganizedChat {
            chat,
            project_id,
            folder_id,
            pinned,
            archived,
        });
    }
    Ok(Organization {
        projects,
        chats,
        affected_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chatstore::test_support::TestDb;

    #[test]
    fn foreign_device_paths_are_never_used_for_local_chats_or_folders() {
        let db = TestDb::new();
        let id = db.chat("/another-device/private-work");
        let view = execute(
            db.conn(),
            "different-device",
            2,
            OrganizationCommand::Snapshot(WorkspaceFilter::default()),
        )
        .expect("snapshot");
        assert_eq!(view.chats[0].chat.id, id);
        assert!(view.chats[0].chat.folder.as_os_str().is_empty());
        let folder = &view.projects[0].folders[0];
        assert!(folder.path.is_none());
        assert_eq!(folder.folder_state, FolderState::Missing);
        assert!(folder.unavailable_reason.is_some());
        assert!(
            rows::chat(db.conn(), "different-device", &id)
                .expect("chat")
                .expect("record")
                .folder
                .as_os_str()
                .is_empty()
        );
    }

    #[test]
    fn stored_manual_title_rejects_late_queued_automatic_write() {
        let db = TestDb::new();
        let id = db.chat("/work");
        execute(
            db.conn(),
            "dev",
            2,
            OrganizationCommand::RenameChat {
                id: id.clone(),
                title: "Chosen title".into(),
            },
        )
        .expect("rename");
        rows::set_title(
            db.conn(),
            &id,
            "Late title",
            super::super::TitleSource::Agent,
        )
        .expect("late write");
        let saved = rows::chat(db.conn(), "dev", &id)
            .expect("chat")
            .expect("saved");
        assert_eq!(saved.title.as_deref(), Some("Chosen title"));
        assert_eq!(saved.title_source, Some(super::super::TitleSource::Manual));
    }

    #[test]
    fn project_filter_keeps_destinations_and_archived_listing_is_explicit() {
        let db = TestDb::new();
        let first = db.chat("/one");
        let second = db.chat("/two");
        execute(
            db.conn(),
            "dev",
            2,
            OrganizationCommand::ArchiveChat {
                id: first,
                archived: true,
            },
        )
        .expect("archive");
        let active = execute(
            db.conn(),
            "dev",
            3,
            OrganizationCommand::Snapshot(WorkspaceFilter::default()),
        )
        .expect("active");
        assert_eq!(active.projects.len(), 2);
        assert_eq!(active.chats.len(), 1);
        assert_eq!(active.chats[0].chat.id, second);
        let project_id = active.chats[0].project_id.clone();
        let filtered = execute(
            db.conn(),
            "dev",
            3,
            OrganizationCommand::Snapshot(WorkspaceFilter {
                include_archived: true,
                project_id: Some(project_id),
            }),
        )
        .expect("filtered");
        assert_eq!(filtered.projects.len(), 2);
        assert_eq!(filtered.chats.len(), 1);
    }
}
