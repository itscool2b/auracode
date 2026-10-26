//! Copies only reviewed workspace rows from the active keyed writer. Source data is never changed.
use aura_protocol::account_preservation::KeepLocalResult;
use rusqlite::{Connection, OptionalExtension, params, types::Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

use crate::{
    chatstore::{compact::CompactLimits, files::Attachments, recover},
    local_import::{self, TABLES, visit},
    paths::DataRoot,
    store::Store,
};

mod staging;
#[cfg(test)]
mod tests;

#[derive(Debug, thiserror::Error)]
pub enum PreservationError {
    #[error("Open the retained, unlocked Account workspace before keeping it as Local.")]
    AccountRequired,
    #[error("The workspace changed or this review expired. Review Keep as Local again.")]
    Changed,
    #[error("The workspace exceeds the supported copy limit. The encrypted original is unchanged.")]
    Limit,
    #[error("The workspace could not be copied. The encrypted original is unchanged.")]
    Storage,
    #[error(
        "The copy did not finish. Its unencrypted partial files remain in the Local profile folder {0}. The encrypted original is unchanged. Review again to create a new copy."
    )]
    Partial(String),
    #[error(
        "The copy exceeded its limit of 4096 attachments or 512 MiB of attachment data, or 512 MiB of workspace rows. Unencrypted partial files remain in Local profile folder {0}. The encrypted original is unchanged."
    )]
    PartialLimit(String),
}
impl From<rusqlite::Error> for PreservationError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}
impl From<local_import::ImportError> for PreservationError {
    fn from(error: local_import::ImportError) -> Self {
        match error {
            local_import::ImportError::Invalid => Self::Limit,
            _ => Self::Storage,
        }
    }
}
pub type Result<T> = std::result::Result<T, PreservationError>;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Snapshot {
    pub projects: Vec<aura_protocol::local_import::LocalImportProject>,
    pub chats: u32,
    pub turns: u32,
}
pub(crate) enum Command {
    Preview,
    Apply { root: DataRoot, snapshot: Snapshot },
}
pub(crate) enum Reply {
    Preview(Snapshot),
    Applied(KeepLocalResult),
}

fn snapshot(conn: &Connection, device: &str) -> Result<Snapshot> {
    let rows = conn
        .prepare("SELECT id,name FROM projects WHERE deleted=0 ORDER BY sort_key,id LIMIT 1025")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() > 1024 {
        return Err(PreservationError::Limit);
    }
    let mut result = Snapshot {
        projects: Vec::new(),
        chats: 0,
        turns: 0,
    };
    for (id, name) in rows {
        let project = local_import::describe(conn, device, &id, name)?;
        result.chats = result
            .chats
            .checked_add(project.chats)
            .ok_or(PreservationError::Limit)?;
        result.turns = result
            .turns
            .checked_add(project.turns)
            .ok_or(PreservationError::Limit)?;
        result.projects.push(project);
    }
    Ok(result)
}

pub(crate) fn execute(
    store: &Store,
    files: &Attachments,
    device: &str,
    command: Command,
) -> Result<Reply> {
    execute_bounded(store, files, device, command, AttachmentLimits::STANDARD)
}

#[derive(Clone, Copy)]
struct AttachmentLimits {
    objects: usize,
    bytes: u64,
}
impl AttachmentLimits {
    const STANDARD: Self = Self {
        objects: 4096,
        bytes: 512 * 1024 * 1024,
    };
}
fn execute_bounded(
    store: &Store,
    files: &Attachments,
    device: &str,
    command: Command,
    limits: AttachmentLimits,
) -> Result<Reply> {
    let Attachments::Encrypted(files) = files else {
        return Err(PreservationError::AccountRequired);
    };
    if !store.is_encrypted() {
        return Err(PreservationError::AccountRequired);
    }
    // The writer serializes all mutations. This transaction pins one snapshot for every query.
    let source = store.conn().unchecked_transaction()?;
    let current = snapshot(&source, device)?;
    let Command::Apply {
        root,
        snapshot: reviewed,
    } = command
    else {
        return Ok(Reply::Preview(current));
    };
    if reviewed != current {
        return Err(PreservationError::Changed);
    }
    let mut stage = staging::Stage::new(root)?;
    let id = stage.profile.meta.id.clone();
    let result = (|| {
        let (mut target, _) =
            Store::open(&stage.profile).map_err(|_| PreservationError::Storage)?;
        let tx = target.conn_mut().transaction()?;
        let mut hashes = BTreeSet::new();
        let mut chats = Vec::new();
        let mut bytes = 0usize;
        for project in &current.projects {
            for table in TABLES {
                let parameters = std::iter::repeat_n("?", table.columns.split(',').count())
                    .collect::<Vec<_>>()
                    .join(",");
                let mut statement = tx.prepare(&format!(
                    "INSERT INTO {}({}) VALUES({parameters})",
                    table.name, table.columns
                ))?;
                visit(&source, device, &project.project_id, table, |row| {
                    bytes = bytes.saturating_add(
                        row.iter()
                            .map(|value| match value {
                                Value::Text(value) => value.len(),
                                Value::Blob(value) => value.len(),
                                _ => 8,
                            })
                            .sum::<usize>(),
                    );
                    if bytes > 512 * 1024 * 1024 {
                        return Err(local_import::ImportError::Invalid);
                    }
                    if table.name == "chats"
                        && let Value::Text(id) = &row[0]
                    {
                        chats.push(id.clone());
                    }
                    local_import::apply::references(table.name, row, &mut hashes)?;
                    statement.execute(rusqlite::params_from_iter(row))?;
                    Ok(())
                })?;
            }
        }
        if hashes.len() > limits.objects {
            return Err(PreservationError::Limit);
        }
        let mut remaining = limits.bytes;
        let mut missing = 0;
        for hash in hashes {
            if !copy_attachment(&source, &tx, files, &stage, &hash, &mut remaining)? {
                missing += 1;
            }
        }
        for chat in chats {
            recover::recover_chat(
                &tx,
                &chat,
                device,
                &CompactLimits::STANDARD,
                crate::time::now_millis(),
            )?;
        }
        tx.commit()?;
        target
            .conn()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        drop(target);
        stage.publish()?;
        Ok(KeepLocalResult {
            profile_id: id.clone(),
            display_name: stage.profile.meta.display_name.clone(),
            projects: current.projects.len() as u32,
            chats: current.chats,
            turns: current.turns,
            missing_attachments: missing,
        })
    })();
    result.map(Reply::Applied).map_err(|error| match error {
        PreservationError::Limit => PreservationError::PartialLimit(id),
        _ => PreservationError::Partial(id),
    })
}

fn copy_attachment(
    source: &Connection,
    target: &Connection,
    files: &crate::profile_files::EncryptedFiles,
    stage: &staging::Stage,
    hash: &str,
    remaining: &mut u64,
) -> Result<bool> {
    let metadata: Option<(String, i64, i64)> = source
        .query_row(
            "SELECT mime,size,created_at FROM attachments WHERE sha256=?1",
            [hash],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let mut reader = match files.reader(hash) {
        Ok(reader) => reader,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(PreservationError::Storage),
    };
    let length = reader.total();
    if length > crate::chatstore::blobs::MAX_BLOB_BYTES as u64 || length > *remaining {
        return Err(PreservationError::Limit);
    }
    *remaining -= length;
    let bytes = reader.read_all().map_err(|_| PreservationError::Storage)?;
    if format!("{:x}", Sha256::digest(&bytes)) != hash {
        return Err(PreservationError::Changed);
    }
    let (mime, size, created) = metadata.unwrap_or_else(|| {
        (
            "application/octet-stream".into(),
            bytes.len() as i64,
            crate::time::now_millis(),
        )
    });
    if size != bytes.len() as i64 {
        return Err(PreservationError::Changed);
    }
    stage.write_attachment(hash, &bytes)?;
    target.execute(
        "INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,?2,?3,?4)",
        params![hash, mime, size, created],
    )?;
    Ok(true)
}
