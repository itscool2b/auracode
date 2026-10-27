//! Reviewed copies from an inactive Local profile. Source connections are always read-only;
//! destination writes use the active Account writer and its encrypted attachment store.
use std::{collections::BTreeSet, time::Duration};

use aura_protocol::local_import::{LocalImportPreview, LocalImportProject, LocalImportSelection};
use rusqlite::{Connection, OpenFlags, params, types::Value};
use sha2::{Digest, Sha256};

use crate::{
    owner::ProfileOwner,
    profile::{Profile, ProfileKind},
};

pub(crate) mod apply;
pub(crate) use apply::Command;
pub use apply::Reply;
pub(crate) use apply::execute;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("Open an unlocked Account profile before importing Local projects.")]
    AccountRequired,
    #[error("Local is still open in another window or process. Close it before importing.")]
    InUse,
    #[error("Open the Local profile once with this version of auracode before importing it.")]
    Schema,
    #[error("The Local project changed after review. Review it again before importing.")]
    Changed,
    #[error(
        "This Account already contains a different project or chat with the same identity. Nothing was overwritten."
    )]
    Conflict,
    #[error("The Local import selection is invalid or exceeds its supported size.")]
    Invalid,
    #[error("Local data could not be read or saved. The original profile is unchanged.")]
    Storage,
}
impl From<rusqlite::Error> for ImportError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}
type Result<T> = std::result::Result<T, ImportError>;

struct Source {
    conn: Connection,
    _owner: ProfileOwner,
}
fn source(profile: &Profile) -> Result<Source> {
    if profile.meta.kind != ProfileKind::Local {
        return Err(ImportError::Invalid);
    }
    let metadata =
        std::fs::symlink_metadata(profile.db_path()).map_err(|_| ImportError::Storage)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(ImportError::Invalid);
    }
    let owner = ProfileOwner::acquire(profile).map_err(|_| ImportError::InUse)?;
    let conn = Connection::open_with_flags(
        profile.db_path(),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN DEFERRED")?;
    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if !(12..=crate::store::SCHEMA_VERSION).contains(&version) {
        return Err(ImportError::Schema);
    }
    Ok(Source {
        conn,
        _owner: owner,
    })
}

/// Reads app-owned Local data only. The caller fixes this profile from its DataRoot, never a UI path.
pub fn preview(profile: &Profile, device: &str) -> Result<LocalImportPreview> {
    let source = source(profile)?;
    let projects: Vec<(String, String)> = source
        .conn
        .prepare("SELECT id,name FROM projects WHERE deleted=0 ORDER BY sort_key,id LIMIT 1025")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    if projects.len() > 1024 {
        return Err(ImportError::Invalid);
    }
    let projects = projects
        .into_iter()
        .map(|(id, name)| describe(&source.conn, device, &id, name))
        .collect::<Result<_>>()?;
    Ok(LocalImportPreview {projects, notices: vec![
        "Selected projects and their chats are copied into this Account. The Local profile is kept unchanged.".into(),
        "Working files stay in place. Native agent sessions, checkpoint history, queued prompts and protocol logs stay in Local. Saved drafts and chat attachments are copied.".into(),
        "Imported chats use their project folders. Managed worktree ownership stays with Local.".into(),
        "Imported chats use a reviewed Continue here handoff before their next agent prompt. Unfinished turns are retained as interrupted.".into(),
    ]})
}

pub(crate) fn describe(
    conn: &Connection,
    device: &str,
    project: &str,
    name: String,
) -> Result<LocalImportProject> {
    let mut digest = Sha256::new();
    digest.update(b"auracode-local-project-import-v1");
    let mut counts = [0; 3];
    for table in TABLES {
        let count = visit(conn, device, project, table, |row| {
            digest.update(table.name.as_bytes());
            for value in row {
                hash_value(&mut digest, value);
            }
            Ok(())
        })?;
        match table.name {
            "project_folders" => counts[0] = count,
            "chats" => counts[1] = count,
            "turns" => counts[2] = count,
            _ => {}
        }
    }
    Ok(LocalImportProject {
        project_id: project.into(),
        name,
        folders: counts[0],
        chats: counts[1],
        turns: counts[2],
        revision: format!("{:x}", digest.finalize()),
        already_imported: false,
    })
}
fn hash_value(digest: &mut Sha256, value: &Value) {
    match value {
        Value::Null => digest.update([0]),
        Value::Integer(value) => {
            digest.update([1]);
            digest.update(value.to_be_bytes());
        }
        Value::Real(value) => {
            digest.update([2]);
            digest.update(value.to_bits().to_be_bytes());
        }
        Value::Text(value) => {
            digest.update([3]);
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
        Value::Blob(value) => {
            digest.update([4]);
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value);
        }
    }
}
pub(crate) fn selection(values: &[LocalImportSelection]) -> Result<()> {
    let mut unique = BTreeSet::new();
    if values.is_empty() || values.len() > 64 {
        return Err(ImportError::Invalid);
    }
    for value in values {
        if !uuid::Uuid::parse_str(&value.project_id)
            .is_ok_and(|id| id.to_string() == value.project_id)
            || !crate::chatstore::blobs::is_sha256(&value.revision)
            || !unique.insert(&value.project_id)
        {
            return Err(ImportError::Invalid);
        }
    }
    Ok(())
}
pub(crate) struct Table {
    pub(crate) name: &'static str,
    pub(crate) columns: &'static str,
    query: &'static str,
}
pub(crate) const TABLES: &[Table] = &[
    Table {
        name: "projects",
        columns: "id,name,color,icon,default_agent,default_model,sort_key,created_at,updated_at,device_id,deleted",
        query: "SELECT id,name,color,icon,default_agent,default_model,sort_key,created_at,updated_at,device_id,deleted FROM projects WHERE id=?1 AND deleted=0 AND ?2 IS NOT NULL ORDER BY id",
    },
    Table {
        name: "project_folders",
        columns: "id,project_id,display_name,kind,git_remote_url,git_default_branch,origin_device_id,sort_key,created_at,updated_at,device_id,deleted",
        query: "SELECT id,project_id,display_name,kind,git_remote_url,git_default_branch,origin_device_id,sort_key,created_at,updated_at,device_id,deleted FROM project_folders WHERE project_id=?1 AND ?2 IS NOT NULL ORDER BY id",
    },
    Table {
        name: "folder_locations",
        columns: "folder_id,device_id,path,last_seen_at",
        query: "SELECT l.folder_id,l.device_id,l.path,l.last_seen_at FROM folder_locations l JOIN project_folders f ON f.id=l.folder_id WHERE f.project_id=?1 AND l.device_id=?2 ORDER BY l.folder_id,l.device_id",
    },
    Table {
        name: "chats",
        columns: "id,project_id,folder_id,title,title_source,active_agent,pinned,archived,isolation,worktree_branch,created_at,updated_at,device_id,deleted,agent_host",
        query: "SELECT id,project_id,folder_id,title,title_source,active_agent,pinned,archived,'direct',NULL,created_at,updated_at,device_id,deleted,agent_host FROM chats WHERE project_id=?1 AND deleted=0 AND ?2 IS NOT NULL ORDER BY id",
    },
    Table {
        name: "turns",
        columns: "id,chat_id,seq,status,stop_reason,started_at,ended_at,device_id,prompt_id,first_event_seq,last_event_seq,prompt_parts_json,continuation_prefix,parent_turn_id,source_agent",
        query: "SELECT t.id,t.chat_id,t.seq,t.status,t.stop_reason,t.started_at,t.ended_at,t.device_id,t.prompt_id,t.first_event_seq,t.last_event_seq,t.prompt_parts_json,t.continuation_prefix,t.parent_turn_id,COALESCE(t.source_agent,s.agent_id,c.active_agent,'unknown') FROM turns t JOIN chats c ON c.id=t.chat_id LEFT JOIN agent_sessions s ON s.id=t.agent_session_id WHERE c.project_id=?1 AND c.deleted=0 AND ?2 IS NOT NULL ORDER BY t.chat_id,t.seq",
    },
    Table {
        name: "events",
        columns: "id,chat_id,turn_id,seq,kind,payload,created_at,device_id",
        query: "SELECT e.id,e.chat_id,e.turn_id,e.seq,e.kind,e.payload,e.created_at,e.device_id FROM events e JOIN chats c ON c.id=e.chat_id WHERE c.project_id=?1 AND c.deleted=0 AND ?2 IS NOT NULL ORDER BY e.chat_id,e.seq",
    },
    Table {
        name: "steering_inputs",
        columns: "message_id,chat_id,turn_id,seq,parts_json,state,detail,created_at,updated_at",
        query: "SELECT s.message_id,s.chat_id,s.turn_id,s.seq,s.parts_json,s.state,s.detail,s.created_at,s.updated_at FROM steering_inputs s JOIN chats c ON c.id=s.chat_id WHERE c.project_id=?1 AND c.deleted=0 AND ?2 IS NOT NULL ORDER BY s.chat_id,s.seq,s.message_id",
    },
    Table {
        name: "composer_attachments",
        columns: "id,chat_id,sha256,display_name,mime,byte_length,created_at",
        query: "SELECT a.id,a.chat_id,a.sha256,a.display_name,a.mime,a.byte_length,a.created_at FROM composer_attachments a JOIN chats c ON c.id=a.chat_id WHERE c.project_id=?1 AND c.deleted=0 AND ?2 IS NOT NULL ORDER BY a.id",
    },
    Table {
        name: "composer_drafts",
        columns: "chat_id,input_json,updated_at",
        query: "SELECT d.chat_id,d.input_json,d.updated_at FROM composer_drafts d JOIN chats c ON c.id=d.chat_id WHERE c.project_id=?1 AND c.deleted=0 AND ?2 IS NOT NULL ORDER BY d.chat_id",
    },
];
pub(crate) fn visit(
    conn: &Connection,
    device: &str,
    project: &str,
    table: &Table,
    mut visitor: impl FnMut(&[Value]) -> Result<()>,
) -> Result<u32> {
    let mut statement = conn.prepare(table.query)?;
    let columns = statement.column_count();
    let mut rows = statement.query(params![project, device])?;
    let mut count = 0u32;
    while let Some(row) = rows.next()? {
        let values = (0..columns)
            .map(|index| row.get::<_, Value>(index))
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let bytes: usize = values
            .iter()
            .map(|value| match value {
                Value::Text(value) => value.len(),
                Value::Blob(value) => value.len(),
                _ => 8,
            })
            .sum();
        if bytes > 16 * 1024 * 1024 || count >= 1_000_000 {
            return Err(ImportError::Invalid);
        }
        visitor(&values)?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests;
