//! Capture portable row changes inside the writer transaction. TEMP triggers never affect another
//! connection or Local profiles. Their queue rolls back with the original change on any error.
use super::*;
use aura_sync::merge::FieldValue;
use rusqlite::types::ValueRef;
use serde_json::Value;

pub(crate) const BATCH: usize = 256;

pub(crate) fn install(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS aura_sync_dirty(entity TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(entity,id));")?;
    for (entity, table) in [
        ("project", "projects"),
        ("folder", "project_folders"),
        ("chat", "chats"),
    ] {
        for (operation, row) in [("INSERT", "NEW"), ("UPDATE", "NEW"), ("DELETE", "OLD")] {
            conn.execute_batch(&format!("CREATE TEMP TRIGGER IF NOT EXISTS aura_sync_{entity}_{operation} AFTER {operation} ON main.{table} BEGIN INSERT OR IGNORE INTO aura_sync_dirty(entity,id) VALUES('{entity}',{row}.id); END;"))?;
        }
        // IDs are random UUIDs. Folder rows share the projects collection under a typed prefix.
        let (collection, prefix) = if entity == "chat" {
            ("chats", "")
        } else if entity == "folder" {
            ("projects", "folder-")
        } else {
            ("projects", "")
        };
        conn.execute_batch(&format!("INSERT OR IGNORE INTO aura_sync_dirty SELECT '{entity}',id FROM {table} WHERE NOT EXISTS(SELECT 1 FROM sync_heads WHERE collection='{collection}' AND sync_heads.id='{prefix}' || {table}.id);"))?;
    }
    Ok(())
}

/// Drain all changes from one ordinary writer transaction. A transaction cannot acknowledge its
/// local data without acknowledging the corresponding sealed outbox entries.
pub(crate) fn finish(conn: &Connection, context: &SyncContext, now: i64) -> rusqlite::Result<()> {
    loop {
        match pending(conn, context, now.max(0) as u64) {
            Ok(count) if count == BATCH => {}
            Ok(_) => return Ok(()),
            Err(SyncError::Sqlite(code)) => {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(code),
                    None,
                ));
            }
            Err(error) => return Err(rusqlite::Error::InvalidParameterName(error.to_string())),
        }
    }
}

pub(crate) fn pending(conn: &Connection, context: &SyncContext, now: u64) -> Result<usize> {
    let dirty = conn.prepare("SELECT entity,id FROM aura_sync_dirty ORDER BY CASE entity WHEN 'project' THEN 0 WHEN 'folder' THEN 1 ELSE 2 END,id LIMIT 256")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut clock = load_clock(conn, &context.identity)?;
    for (entity, id) in &dirty {
        let collection = if entity == "chat" {
            "chats"
        } else {
            "projects"
        };
        let wire_id = if entity == "shared_mcp" {
            format!("mcp-{id}")
        } else if entity == "memory" {
            format!("memory-{id}")
        } else if entity == "folder" {
            format!("folder-{id}")
        } else {
            id.clone()
        };
        if deferred(conn, collection, &wire_id)? {
            return Err(SyncError::Deferred);
        }
        // A parent tombstone waiting for an active turn must not be implicitly undone by a
        // concurrent rename or folder edit against the still-visible old projection.
        if entity != "chat"
            && conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_projection WHERE collection=?1 AND id=?2)",
                params![collection, wire_id],
                |row| row.get::<_, bool>(0),
            )?
        {
            return Err(SyncError::Deferred);
        }
        let snapshot = snapshot(conn, entity, id)?;
        let previous = head(conn, collection, &wire_id)?;
        // Local edits remain possible after a wall-clock rollback. Push waits for a corrected clock
        // if necessary; remote clocks are still validated against actual wall time in accept_pull.
        let logical_now = now.max(clock.last().physical_ms());
        let before = previous
            .as_ref()
            .map(|record| open(&context.identity, &context.key, record, logical_now))
            .transpose()?;
        let before = match before {
            Some(DecodedMetadata::Known(metadata)) => Some(metadata),
            Some(DecodedMetadata::Future { .. }) => return Err(SyncError::Deferred),
            None => None,
        };
        if snapshot.is_none() && before.is_none() {
            clear(conn, entity, id)?;
            continue;
        }
        let (live, fields) = snapshot.unwrap_or((false, BTreeMap::new()));
        let unchanged = before.as_ref().is_some_and(|before| {
            before.live.value == live
                && fields.iter().all(|(name, value)| {
                    before
                        .fields
                        .get(name)
                        .is_some_and(|field| field.value == *value)
                })
        });
        if !unchanged {
            let next = clock.tick(logical_now)?;
            let mut metadata = before.unwrap_or_else(|| Metadata {
                schema_version: 1,
                live: Stamped {
                    clock: next.clone(),
                    value: live,
                },
                fields: BTreeMap::new(),
            });
            if metadata.live.value != live {
                metadata.live = Stamped {
                    clock: next.clone(),
                    value: live,
                };
            }
            for (name, value) in fields {
                if metadata
                    .fields
                    .get(&name)
                    .is_none_or(|field| field.value != value)
                {
                    metadata.fields.insert(
                        name,
                        Stamped {
                            clock: next.clone(),
                            value,
                        },
                    );
                }
            }
            metadata.validate_clocks(&next, logical_now)?;
            let record = seal(
                &context.identity,
                &context.key,
                collection,
                &wire_id,
                &next,
                &metadata,
            )?;
            save_head(conn, &record)?;
            enqueue(conn, &record)?;
        }
        clear(conn, entity, id)?;
    }
    save_clock(conn, &clock)?;
    Ok(dirty.len())
}

fn clear(conn: &Connection, entity: &str, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM aura_sync_dirty WHERE entity=?1 AND id=?2",
        params![entity, id],
    )?;
    Ok(())
}

type Snapshot = (bool, BTreeMap<String, FieldValue>);
fn snapshot(conn: &Connection, entity: &str, id: &str) -> Result<Option<Snapshot>> {
    if entity == "shared_mcp" {
        return super::shared_mcp::snapshot(conn, id);
    }
    if entity == "memory" {
        return super::memory::snapshot(conn, id);
    }
    let (table, fields): (&str, &[&str]) = match entity {
        "project" => (
            "projects",
            &[
                "name",
                "color",
                "icon",
                "default_agent",
                "default_model",
                "sort_key",
                "created_at",
                "updated_at",
            ],
        ),
        "folder" => (
            "project_folders",
            &[
                "project_id",
                "display_name",
                "kind",
                "git_remote_url",
                "git_default_branch",
                "origin_device_id",
                "sort_key",
                "created_at",
                "updated_at",
            ],
        ),
        "chat" => (
            "chats",
            &[
                "project_id",
                "folder_id",
                "title",
                "title_source",
                "active_agent",
                "pinned",
                "archived",
                "isolation",
                "worktree_branch",
                "created_at",
                "updated_at",
            ],
        ),
        _ => return Err(SyncError::Invalid),
    };
    // Names above are fixed source constants. Device locations, native sessions, queues, drafts,
    // setup recipes and agent configuration are deliberately absent from this projection.
    let sql = format!(
        "SELECT deleted,{} FROM {table} WHERE id=?1",
        fields.join(",")
    );
    let result = conn
        .query_row(&sql, [id], |row| {
            let mut values = BTreeMap::from([(
                "entity".into(),
                FieldValue::Present(Value::String(entity.into())),
            )]);
            for (offset, name) in fields.iter().enumerate() {
                let value = match row.get_ref(offset + 1)? {
                    ValueRef::Null => FieldValue::Deleted,
                    ValueRef::Integer(number) => FieldValue::Present(Value::Number(number.into())),
                    ValueRef::Text(text) => {
                        let text =
                            std::str::from_utf8(text).map_err(|_| rusqlite::Error::InvalidQuery)?;
                        if text.len() > 16 * 1024 {
                            return Err(rusqlite::Error::InvalidQuery);
                        }
                        if *name == "git_remote_url" && !safe_remote(text) {
                            FieldValue::Deleted
                        } else {
                            FieldValue::Present(Value::String(text.into()))
                        }
                    }
                    _ => return Err(rusqlite::Error::InvalidQuery),
                };
                values.insert((*name).into(), value);
            }
            Ok((!row.get::<_, bool>(0)?, values))
        })
        .optional()?;
    Ok(result)
}

// Never sync an embedded password/token or a local filesystem remote. Unqualified values stay on
// this device until the user gives the folder a credential-free portable remote.
pub(super) fn safe_remote(value: &str) -> bool {
    if value.chars().any(char::is_control) || value.contains(['?', '#']) {
        return false;
    }
    if let Some(rest) = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
    {
        return rest
            .split('/')
            .next()
            .is_some_and(|authority| !authority.is_empty() && !authority.contains('@'));
    }
    if let Some(rest) = value.strip_prefix("ssh://git@") {
        return !rest.is_empty() && !rest.contains('@');
    }
    value
        .strip_prefix("git@")
        .is_some_and(|rest| rest.contains(':') && !rest.contains('@'))
}

#[cfg(test)]
mod tests;
