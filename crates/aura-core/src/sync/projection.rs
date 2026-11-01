//! Portable metadata projection. Dependency gaps stay durable; device paths and native sessions
//! are never populated from the network. All work runs in the cursor/head transaction.
use super::*;
use aura_sync::merge::FieldValue;
use rusqlite::types::Value;

const PROJECT: &[&str] = &[
    "name",
    "color",
    "icon",
    "default_agent",
    "default_model",
    "sort_key",
    "created_at",
    "updated_at",
];
const FOLDER: &[&str] = &[
    "project_id",
    "display_name",
    "kind",
    "git_remote_url",
    "git_default_branch",
    "origin_device_id",
    "sort_key",
    "created_at",
    "updated_at",
];
const CHAT: &[&str] = &[
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
];

struct Row {
    entity: &'static str,
    table: &'static str,
    id: String,
    names: &'static [&'static str],
    values: Vec<Value>,
}

pub(crate) fn queue(
    conn: &Transaction<'_>,
    record: &EncryptedRecord,
    metadata: &Metadata,
) -> Result<()> {
    // Reject malformed known payloads before recording cursor progress, even if a parent is absent.
    if record.id.starts_with("mcp-") {
        super::shared_mcp::decode(record, metadata)?;
    } else if record.id.starts_with("memory-") {
        super::memory::decode(record, metadata)?;
    } else {
        decode(record, metadata)?;
    }
    conn.execute("INSERT INTO sync_projection(collection,id) VALUES(?1,?2) ON CONFLICT(collection,id) DO UPDATE SET attempt=0", params![record.collection, record.id])?;
    Ok(())
}

pub(crate) fn drain(
    conn: &Connection,
    identity: &SyncIdentity,
    key: &AccountKey,
    now: u64,
) -> Result<()> {
    let pending = conn.prepare("SELECT p.collection,p.id,h.record_json FROM sync_projection p JOIN sync_heads h USING(collection,id) ORDER BY p.attempt,CASE WHEN p.collection='chats' THEN 2 WHEN p.id LIKE 'folder-%' THEN 1 ELSE 0 END,p.id LIMIT 256")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let attempt: i64 = conn.query_row(
        "SELECT COALESCE(MAX(attempt),0)+1 FROM sync_projection",
        [],
        |row| row.get(0),
    )?;
    for (collection, id, json) in pending {
        if deferred(conn, &collection, &id)? {
            conn.execute(
                "UPDATE sync_projection SET attempt=?3 WHERE collection=?1 AND id=?2",
                params![collection, id, attempt],
            )?;
            continue;
        }
        let record = decode_record(&json)?;
        let DecodedMetadata::Known(metadata) = open(identity, key, &record, now)? else {
            continue;
        };
        if record.id.starts_with("memory-") {
            if super::memory::project(conn, &record, &metadata)? {
                conn.execute(
                    "DELETE FROM sync_projection WHERE collection=?1 AND id=?2",
                    params![collection, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE sync_projection SET attempt=?3 WHERE collection=?1 AND id=?2",
                    params![collection, id, attempt],
                )?;
            }
            continue;
        }
        if record.id.starts_with("mcp-") {
            if super::shared_mcp::project(conn, &record, &metadata)? {
                conn.execute(
                    "DELETE FROM sync_projection WHERE collection=?1 AND id=?2",
                    params![collection, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE sync_projection SET attempt=?3 WHERE collection=?1 AND id=?2",
                    params![collection, id, attempt],
                )?;
            }
            continue;
        }
        let row = decode(&record, &metadata)?;
        if (metadata.deleted() || matches!(row.table, "chats" | "project_folders"))
            && removal_busy(conn, &row)?
        {
            conn.execute(
                "UPDATE sync_projection SET attempt=?3 WHERE collection=?1 AND id=?2",
                params![collection, id, attempt],
            )?;
            continue;
        }
        if !dependencies(conn, &row)? {
            conn.execute(
                "UPDATE sync_projection SET attempt=?3 WHERE collection=?1 AND id=?2",
                params![collection, id, attempt],
            )?;
            continue;
        }
        let mut values = vec![Value::Text(row.id.clone())];
        values.extend(row.values);
        values.push(Value::Text(record.hlc.parse::<Hlc>()?.device().into()));
        values.push(Value::Integer(i64::from(metadata.deleted())));
        let columns = row.names.join(",");
        let assignments = row
            .names
            .iter()
            .map(|name| format!("{name}=excluded.{name}"))
            .collect::<Vec<_>>()
            .join(",");
        let placeholders = std::iter::repeat_n("?", values.len())
            .collect::<Vec<_>>()
            .join(",");
        conn.execute(&format!("INSERT INTO {}(id,{columns},device_id,deleted) VALUES({placeholders}) ON CONFLICT(id) DO UPDATE SET {assignments},device_id=excluded.device_id,deleted=excluded.deleted", row.table), rusqlite::params_from_iter(values))?;
        // Remote projection must not be restamped as a local edit by the writer's capture triggers.
        if conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_temp_schema WHERE name='aura_sync_dirty')",
            [],
            |row| row.get::<_, bool>(0),
        )? {
            conn.execute(
                "DELETE FROM aura_sync_dirty WHERE entity=?1 AND id=?2",
                params![row.entity, row.id],
            )?;
        }
        conn.execute(
            "DELETE FROM sync_projection WHERE collection=?1 AND id=?2",
            params![collection, id],
        )?;
    }
    Ok(())
}

fn removal_busy(conn: &Connection, row: &Row) -> Result<bool> {
    let predicate = match row.table {
        "projects" => "c.project_id=?1",
        "project_folders" => "c.folder_id=?1",
        "chats" => "c.id=?1",
        _ => return Ok(false),
    };
    let active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_temp_schema WHERE name='aura_workspace_active')",
        [],
        |r| r.get(0),
    )?;
    let memory = if active {
        " OR EXISTS(SELECT 1 FROM aura_workspace_active a WHERE a.chat_id=c.id)"
    } else {
        ""
    };
    Ok(conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM chats c WHERE {predicate} AND (EXISTS(SELECT 1 FROM turns t WHERE t.chat_id=c.id AND t.status='running') OR EXISTS(SELECT 1 FROM steering_inputs i WHERE i.chat_id=c.id AND i.state='pending'){memory}))"),[&row.id],|r|r.get(0))?)
}

fn dependencies(conn: &Connection, row: &Row) -> Result<bool> {
    let text = |name: &str| {
        row.names
            .iter()
            .position(|field| *field == name)
            .and_then(|index| match &row.values[index] {
                Value::Text(text) => Some(text.as_str()),
                _ => None,
            })
    };
    let Some(project) = text("project_id") else {
        return Ok(true);
    };
    if !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
        [project],
        |r| r.get::<_, bool>(0),
    )? {
        return Ok(false);
    }
    if let Some(folder) = text("folder_id") {
        return Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM project_folders WHERE id=?1 AND project_id=?2)",
            params![folder, project],
            |r| r.get(0),
        )?);
    }
    Ok(true)
}

fn decode(record: &EncryptedRecord, metadata: &Metadata) -> Result<Row> {
    let field = |name: &str| match metadata.fields.get(name).map(|value| &value.value) {
        Some(FieldValue::Present(value)) => Some(value),
        _ => None,
    };
    let entity = field("entity")
        .and_then(serde_json::Value::as_str)
        .ok_or(SyncError::Invalid)?;
    let (entity, table, names, id) = match (record.collection.as_str(), entity) {
        ("projects", "project") => ("project", "projects", PROJECT, record.id.as_str()),
        ("projects", "folder") => (
            "folder",
            "project_folders",
            FOLDER,
            record
                .id
                .strip_prefix("folder-")
                .ok_or(SyncError::Invalid)?,
        ),
        ("chats", "chat") => ("chat", "chats", CHAT, record.id.as_str()),
        _ => return Err(SyncError::Invalid),
    };
    valid_uuid(id)?;
    let mut values = Vec::new();
    for name in names {
        let value = match field(name) {
            Some(serde_json::Value::String(value))
                if value.len() <= 16 * 1024 && !value.contains('\0') =>
            {
                Value::Text(value.clone())
            }
            Some(serde_json::Value::Number(value)) if value.as_i64().is_some() => {
                Value::Integer(value.as_i64().ok_or(SyncError::Invalid)?)
            }
            None => Value::Null,
            _ => return Err(SyncError::Invalid),
        };
        let required = matches!(
            *name,
            "name"
                | "display_name"
                | "project_id"
                | "kind"
                | "sort_key"
                | "created_at"
                | "updated_at"
                | "pinned"
                | "archived"
                | "isolation"
        );
        if required && value == Value::Null {
            return Err(SyncError::Invalid);
        }
        match *name {
            "created_at" | "updated_at" => {
                if !matches!(value, Value::Integer(n) if n >= 0) {
                    return Err(SyncError::Invalid);
                }
            }
            "pinned" | "archived" => {
                if !matches!(value, Value::Integer(0 | 1)) {
                    return Err(SyncError::Invalid);
                }
            }
            _ => {
                if !matches!(value, Value::Text(_) | Value::Null) {
                    return Err(SyncError::Invalid);
                }
            }
        }
        if let Value::Text(text) = &value {
            if matches!(*name, "project_id" | "folder_id") {
                valid_uuid(text)?;
            }
            if *name == "kind" && !matches!(text.as_str(), "git" | "local")
                || *name == "isolation" && !matches!(text.as_str(), "direct" | "isolated")
            {
                return Err(SyncError::Invalid);
            }
            if *name == "git_remote_url" && !capture::safe_remote(text) {
                return Err(SyncError::Invalid);
            }
        }
        values.push(value);
    }
    Ok(Row {
        entity,
        table,
        id: id.into(),
        names,
        values,
    })
}
fn valid_uuid(id: &str) -> Result<()> {
    if uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        Ok(())
    } else {
        Err(SyncError::Invalid)
    }
}

#[cfg(test)]
mod tests;
