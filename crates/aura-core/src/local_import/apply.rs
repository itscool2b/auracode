use super::*;
use crate::{
    chatstore::{compact::CompactLimits, files::Attachments, recover},
    store::Store,
    sync::SyncContext,
};
use aura_protocol::{
    AuraEvent, PromptPart, ToolContent, Truncation, local_import::LocalImportResult,
};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use rusqlite::{OptionalExtension, TransactionBehavior};
use std::{collections::BTreeSet, io::Read};
use zeroize::Zeroizing;

pub(crate) enum Command {
    Preview(Profile),
    Apply {
        source: Profile,
        selected: Vec<LocalImportSelection>,
    },
}
pub enum Reply {
    Preview(LocalImportPreview),
    Applied(LocalImportResult),
}

pub(crate) fn execute(
    store: &mut Store,
    context: &SyncContext,
    files: &Attachments,
    device: &str,
    command: Command,
) -> Result<Reply> {
    if !store.is_encrypted() || !matches!(files, Attachments::Encrypted(_)) {
        return Err(ImportError::AccountRequired);
    }
    match command {
        Command::Preview(profile) => {
            let mut review = preview(&profile, device)?;
            for project in &mut review.projects {
                project.already_imported = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM local_imports WHERE project_id=?1 AND source_profile=?2)",params![project.project_id,profile.meta.id],|row|row.get(0))?;
            }
            Ok(Reply::Preview(review))
        }
        Command::Apply {
            source: profile,
            selected,
        } => {
            selection(&selected)?;
            let source = source(&profile)?;
            let tx = store
                .conn_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let mut result = LocalImportResult::default();
            for selected in selected {
                let imported:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_imports WHERE project_id=?1 AND source_profile=?2)",params![selected.project_id,profile.meta.id],|row|row.get(0))?;
                if imported {
                    continue;
                }
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
                    [&selected.project_id],
                    |row| row.get(0),
                )?;
                if exists {
                    return Err(ImportError::Conflict);
                }
                let current = describe(&source.conn, device, &selected.project_id, String::new())?;
                if current.revision != selected.revision {
                    return Err(ImportError::Changed);
                }
                let mut hashes = BTreeSet::new();
                let mut chats = Vec::new();
                for table in TABLES {
                    let count = table.columns.split(',').count();
                    let parameters = std::iter::repeat_n("?", count)
                        .collect::<Vec<_>>()
                        .join(",");
                    let mut statement = tx.prepare(&format!(
                        "INSERT INTO {}({}) VALUES({parameters})",
                        table.name, table.columns
                    ))?;
                    visit(&source.conn, device, &selected.project_id, table, |row| {
                        if table.name == "chats"
                            && let Value::Text(id) = &row[0]
                        {
                            chats.push(id.clone());
                        }
                        references(table.name, row, &mut hashes)?;
                        statement
                            .execute(rusqlite::params_from_iter(row))
                            .map_err(|error| {
                                if error.sqlite_error_code()
                                    == Some(rusqlite::ErrorCode::ConstraintViolation)
                                {
                                    ImportError::Conflict
                                } else {
                                    ImportError::Storage
                                }
                            })?;
                        Ok(())
                    })?;
                }
                for hash in hashes {
                    if !copy_attachment(&source.conn, &tx, &profile, files, &hash)? {
                        result.missing_attachments += 1;
                    }
                }
                for chat in chats {
                    // Reuse crash recovery to retain partial answers and close old approvals.
                    // This never sends a response to a vendor process.
                    recover::recover_chat(
                        &tx,
                        &chat,
                        device,
                        &CompactLimits::STANDARD,
                        crate::time::now_millis(),
                    )?;
                }
                tx.execute("INSERT INTO local_imports(project_id,source_profile,source_revision,imported_at) VALUES(?1,?2,?3,?4)",params![selected.project_id,profile.meta.id,selected.revision,crate::time::now_millis()])?;
                result.project_ids.push(selected.project_id);
                result.chats = result
                    .chats
                    .checked_add(current.chats)
                    .ok_or(ImportError::Invalid)?;
                result.turns = result
                    .turns
                    .checked_add(current.turns)
                    .ok_or(ImportError::Invalid)?;
            }
            crate::sync::capture::finish(&tx, context, crate::time::now_millis())?;
            tx.commit()?;
            Ok(Reply::Applied(result))
        }
    }
}

fn references(table: &str, values: &[Value], hashes: &mut BTreeSet<String>) -> Result<()> {
    fn parts(json: &Value, hashes: &mut BTreeSet<String>) -> Result<()> {
        if let Value::Text(json) = json {
            let parts: Vec<PromptPart> =
                serde_json::from_str(json).map_err(|_| ImportError::Invalid)?;
            for part in parts {
                if let PromptPart::Image { blob, .. } = part {
                    hashes.insert(blob);
                }
            }
        }
        Ok(())
    }
    fn truncated(value: &Option<Truncation>, hashes: &mut BTreeSet<String>) {
        if let Some(hash) = value.as_ref().and_then(|value| value.blob.as_ref()) {
            hashes.insert(hash.clone());
        }
    }
    fn content(values: &[ToolContent], hashes: &mut BTreeSet<String>) {
        for value in values {
            match value {
                ToolContent::Text {
                    truncated: value, ..
                }
                | ToolContent::Diff {
                    truncated: value, ..
                }
                | ToolContent::Terminal {
                    truncated: value, ..
                } => truncated(value, hashes),
            }
        }
    }
    match table {
        "turns" => parts(&values[11], hashes)?,
        "steering_inputs" => parts(&values[4], hashes)?,
        "composer_attachments" => {
            if let Value::Text(hash) = &values[2] {
                hashes.insert(hash.clone());
            }
        }
        "events" => {
            if let Value::Text(json) = &values[5] {
                match serde_json::from_str::<AuraEvent>(json) {
                    Ok(AuraEvent::ToolCall(value)) => {
                        truncated(&value.truncated, hashes);
                        content(&value.content, hashes);
                    }
                    Ok(AuraEvent::ToolUpdate(value)) => {
                        truncated(&value.truncated, hashes);
                        if let Some(value) = value.content {
                            content(&value, hashes);
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    if hashes.len() > 65_536
        || hashes
            .iter()
            .any(|hash| !crate::chatstore::blobs::is_sha256(hash))
    {
        return Err(ImportError::Invalid);
    }
    Ok(())
}

fn copy_attachment(
    source: &Connection,
    target: &Connection,
    profile: &Profile,
    files: &Attachments,
    hash: &str,
) -> Result<bool> {
    let metadata: Option<(String, i64, i64)> = source
        .query_row(
            "SELECT mime,size,created_at FROM attachments WHERE sha256=?1",
            [hash],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let directory =
        cap_std::fs::Dir::open_ambient_dir(profile.attachments_dir(), cap_std::ambient_authority())
            .map_err(|_| ImportError::Storage)?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let file = match directory.open_with(hash, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(ImportError::Storage),
    };
    let meta = file.metadata().map_err(|_| ImportError::Storage)?;
    if !meta.is_file() || meta.len() > crate::chatstore::blobs::MAX_BLOB_BYTES as u64 {
        return Err(ImportError::Invalid);
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(meta.len() as usize));
    file.take(crate::chatstore::blobs::MAX_BLOB_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ImportError::Storage)?;
    if bytes.len() > crate::chatstore::blobs::MAX_BLOB_BYTES
        || format!("{:x}", Sha256::digest(&bytes)) != hash
    {
        return Err(ImportError::Changed);
    }
    files
        .write(hash, &bytes)
        .map_err(|_| ImportError::Storage)?;
    let (mime, size, created) = metadata.unwrap_or_else(|| {
        (
            "application/octet-stream".into(),
            bytes.len() as i64,
            crate::time::now_millis(),
        )
    });
    if size != bytes.len() as i64 {
        return Err(ImportError::Changed);
    }
    target.execute("INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(sha256) DO NOTHING",params![hash,mime,size,created])?;
    Ok(true)
}
