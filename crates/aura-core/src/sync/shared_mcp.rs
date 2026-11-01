//! Immutable shared definition revisions use the existing encrypted projects collection.
//! Concurrent definitions are retained for explicit review. Credential values stay device local.
use super::*;
use crate::mcp::Revision;
use aura_sync::merge::FieldValue;
use serde_json::Value;
pub(crate) fn install(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TEMP TRIGGER IF NOT EXISTS aura_sync_shared_mcp_INSERT AFTER INSERT ON main.shared_mcp_revisions BEGIN INSERT OR IGNORE INTO aura_sync_dirty(entity,id) VALUES('shared_mcp',NEW.id); END; INSERT OR IGNORE INTO aura_sync_dirty SELECT 'shared_mcp',id FROM shared_mcp_revisions WHERE NOT EXISTS(SELECT 1 FROM sync_heads WHERE collection='projects' AND sync_heads.id='mcp-' || shared_mcp_revisions.id);")?;
    Ok(())
}
pub(crate) fn snapshot(
    conn: &Connection,
    id: &str,
) -> Result<Option<(bool, BTreeMap<String, FieldValue>)>> {
    let row=conn.query_row("SELECT id,parent,scope,server_id,definition_json,resolved_json FROM shared_mcp_revisions WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,String>(5)?))).optional()?;
    row.map(|(id, parent, scope, server_id, definition, resolved)| {
        let row = Revision {
            id,
            parent,
            scope,
            server_id,
            definition: definition
                .map(|s| serde_json::from_str(&s).map_err(|_| SyncError::Invalid))
                .transpose()?,
            resolved: serde_json::from_str(&resolved).map_err(|_| SyncError::Invalid)?,
        };
        Ok((
            true,
            BTreeMap::from([
                (
                    "entity".into(),
                    FieldValue::Present(Value::String("shared_mcp".into())),
                ),
                (
                    "revision".into(),
                    FieldValue::Present(serde_json::to_value(row).map_err(|_| SyncError::Invalid)?),
                ),
            ]),
        ))
    })
    .transpose()
}
pub(crate) fn decode(record: &EncryptedRecord, metadata: &Metadata) -> Result<Revision> {
    let FieldValue::Present(value) = &metadata
        .fields
        .get("revision")
        .ok_or(SyncError::Invalid)?
        .value
    else {
        return Err(SyncError::Invalid);
    };
    let row: Revision = serde_json::from_value(value.clone()).map_err(|_| SyncError::Invalid)?;
    let uuid = |s: &str| uuid::Uuid::parse_str(s).is_ok_and(|v| v.to_string() == s);
    if record.collection != "projects"
        || record.id != format!("mcp-{}", row.id)
        || metadata.deleted()
        || !uuid(&row.id)
        || !uuid(&row.server_id)
        || row.parent.as_ref().is_some_and(|id| !uuid(id))
        || (!row.scope.is_empty() && !uuid(&row.scope))
        || row.resolved.len() > 128
        || row.resolved.iter().any(|id| !uuid(id))
    {
        return Err(SyncError::Invalid);
    }
    if let Some(def) = &row.definition {
        crate::mcp::validate(def).map_err(|_| SyncError::Invalid)?;
        if def.id != row.server_id || def.project_id.as_deref().unwrap_or("") != row.scope {
            return Err(SyncError::Invalid);
        }
    }
    Ok(row)
}
pub(crate) fn project(
    conn: &Connection,
    record: &EncryptedRecord,
    metadata: &Metadata,
) -> Result<bool> {
    let row = decode(record, metadata)?;
    if !row.scope.is_empty()
        && !conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1 AND deleted=0)",
            [&row.scope],
            |r| r.get::<_, bool>(0),
        )?
    {
        return Ok(false);
    }
    if let Some((_, fields)) = snapshot(conn, &row.id)? {
        if fields.get("revision") != metadata.fields.get("revision").map(|v| &v.value) {
            return Err(SyncError::Invalid);
        }
        return Ok(true);
    }
    for ancestor in row.parent.iter().chain(&row.resolved) {
        let identity: Option<(String, String)> = conn
            .query_row(
                "SELECT scope,server_id FROM shared_mcp_revisions WHERE id=?1",
                [ancestor],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((scope, server)) = identity else {
            return Ok(false);
        };
        if scope != row.scope || server != row.server_id {
            return Err(SyncError::Invalid);
        }
    }
    let current: Option<String> = conn
        .query_row(
            "SELECT head FROM shared_mcp_heads WHERE scope=?1 AND server_id=?2",
            params![row.scope, row.server_id],
            |r| r.get(0),
        )
        .optional()?;
    let conflict =
        current != row.parent && current.as_ref().is_none_or(|id| !row.resolved.contains(id));
    conn.execute("INSERT INTO shared_mcp_revisions(id,parent,scope,server_id,definition_json,conflict,resolved_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![row.id,row.parent,row.scope,row.server_id,row.definition.as_ref().map(serde_json::to_string).transpose().map_err(|_|SyncError::Invalid)?,conflict,serde_json::to_string(&row.resolved).map_err(|_|SyncError::Invalid)?])?;
    if !conflict {
        if let Some(def) = &row.definition {
            crate::mcp::apply_definition(conn, def).map_err(|_| SyncError::Invalid)?;
        } else {
            conn.execute(
                "DELETE FROM shared_mcp WHERE scope=?1 AND server_id=?2",
                params![row.scope, row.server_id],
            )?;
        }
        conn.execute("INSERT INTO shared_mcp_heads(scope,server_id,head) VALUES(?1,?2,?3) ON CONFLICT(scope,server_id) DO UPDATE SET head=excluded.head",params![row.scope,row.server_id,row.id])?;
        if !row.resolved.is_empty() {
            for resolved in row.parent.iter().chain(&row.resolved) {
                crate::mcp::clear_conflicts(conn, resolved)?;
            }
        }
    }
    conn.execute(
        "UPDATE shared_mcp_settings SET revision=revision+1 WHERE id=1",
        [],
    )?;
    conn.execute(
        "DELETE FROM aura_sync_dirty WHERE entity='shared_mcp' AND id=?1",
        [row.id],
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        mcp::{Command, Reply},
        paths::DataRoot,
        profile::{ProfileKind, Profiles},
    };
    use std::sync::Arc;
    fn fixture(key: Arc<AccountKey>, device: &str) -> (tempfile::TempDir, Store, SyncContext) {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profiles::new(DataRoot::at(temp.path()))
            .create(ProfileKind::Account, "MCP account")
            .unwrap();
        let (mut store, _) = Store::open_encrypted(
            &profile,
            Arc::new(key.database_key("account", &profile.meta.id).unwrap()),
        )
        .unwrap();
        let context = SyncContext {
            identity: SyncIdentity {
                account: "account".into(),
                device: device.into(),
                key_version: 1,
            },
            key,
        };
        context.initialize(&mut store).unwrap();
        (temp, store, context)
    }
    fn save(
        store: &mut Store,
        context: &SyncContext,
        expected: u32,
        name: &str,
        now: u64,
    ) -> String {
        let mut definition = crate::mcp::tests::definition();
        definition.name = name.into();
        definition.env_keys = vec!["TOKEN".into()];
        let tx = store.conn_mut().transaction().unwrap();
        crate::mcp::execute(
            &tx,
            Command::Save {
                expected,
                definition,
            },
        )
        .unwrap();
        capture::finish(&tx, context, now as i64).unwrap();
        let id = tx
            .query_row("SELECT head FROM shared_mcp_heads", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap();
        tx.commit().unwrap();
        id
    }
    fn record(store: &Store, id: &str) -> EncryptedRecord {
        head(store.conn(), "projects", &format!("mcp-{id}"))
            .unwrap()
            .unwrap()
    }
    fn pull(
        store: &mut Store,
        context: &SyncContext,
        records: Vec<EncryptedRecord>,
        start: u64,
        now: u64,
    ) {
        let changes = records
            .into_iter()
            .enumerate()
            .map(|(i, record)| Change {
                device_id: record.hlc.parse::<Hlc>().unwrap().device().into(),
                record,
                server_seq: start + i as u64,
            })
            .collect::<Vec<_>>();
        let cursor = changes.last().unwrap().server_seq;
        SyncLedger::new(store, context.identity.clone(), &context.key)
            .unwrap()
            .accept_workspace_pull(
                &Pull {
                    records: changes,
                    next_cursor: cursor,
                    has_more: false,
                },
                now,
            )
            .unwrap();
    }
    #[test]
    fn encrypted_mcp_definition_sync_excludes_credentials_and_preserves_concurrent_edits_until_review()
     {
        let key = Arc::new(AccountKey::generate().unwrap());
        let (_a, mut a, ca) = fixture(key.clone(), "source");
        let (_b, mut b, cb) = fixture(key, "target");
        let now = crate::time::now_millis() as u64;
        let first = save(&mut a, &ca, 0, "first", now);
        let tx = a.conn_mut().transaction().unwrap();
        crate::mcp::execute(
            &tx,
            Command::Credentials {
                expected: 1,
                id: crate::mcp::tests::definition().id,
                project_id: None,
                credentials: aura_protocol::mcp::McpCredentials {
                    env: BTreeMap::from([(
                        "TOKEN".into(),
                        "private-device-only-credential".into(),
                    )]),
                    headers: BTreeMap::new(),
                },
            },
        )
        .unwrap();
        capture::finish(&tx, &ca, now as i64).unwrap();
        tx.commit().unwrap();
        let first_record = record(&a, &first);
        assert!(
            !serde_json::to_string(&first_record)
                .unwrap()
                .contains("first")
        );
        let DecodedMetadata::Known(metadata) =
            open(&ca.identity, &ca.key, &first_record, now).unwrap()
        else {
            panic!()
        };
        assert!(
            !serde_json::to_string(&metadata)
                .unwrap()
                .contains("private-device")
        );
        let mut alias = metadata.clone();
        let FieldValue::Present(revision) = &mut alias.fields.get_mut("revision").unwrap().value
        else {
            panic!()
        };
        revision["definition"]["name"] = Value::String("aura-project-memory".into());
        assert!(
            decode(&first_record, &alias).is_err(),
            "sync cannot introduce a reserved normalized internal name"
        );
        pull(&mut b, &cb, vec![first_record], 1, now + 1);
        let Reply::Snapshot(snapshot) = crate::mcp::execute(b.conn(), Command::Snapshot).unwrap()
        else {
            panic!()
        };
        assert_eq!(snapshot.servers[0].missing_credentials, ["env/TOKEN"]);
        let source = save(&mut a, &ca, 2, "source_edit", now + 2);
        let target = save(&mut b, &cb, 1, "target_edit", now + 2);
        pull(&mut b, &cb, vec![record(&a, &source)], 2, now + 3);
        let Reply::Snapshot(snapshot) = crate::mcp::execute(b.conn(), Command::Snapshot).unwrap()
        else {
            panic!()
        };
        assert_eq!(snapshot.servers[0].definition.name, "target_edit");
        assert_eq!(snapshot.conflicts.len(), 1);
        let tx = b.conn_mut().transaction().unwrap();
        crate::mcp::execute(
            &tx,
            Command::ResolveConflict {
                expected: snapshot.revision,
                revision: source,
                accept: false,
            },
        )
        .unwrap();
        capture::finish(&tx, &cb, now as i64 + 4).unwrap();
        let resolution = tx
            .query_row("SELECT head FROM shared_mcp_heads", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap();
        tx.commit().unwrap();
        pull(
            &mut a,
            &ca,
            vec![record(&b, &target), record(&b, &resolution)],
            1,
            now + 5,
        );
        let Reply::Snapshot(snapshot) = crate::mcp::execute(a.conn(), Command::Snapshot).unwrap()
        else {
            panic!()
        };
        assert_eq!(snapshot.servers[0].definition.name, "target_edit");
        assert!(snapshot.conflicts.is_empty());
        let db = std::fs::read(a.path()).unwrap_or_default();
        assert!(
            !db.windows("private-device-only-credential".len())
                .any(|w| w == b"private-device-only-credential")
        );
    }
}
