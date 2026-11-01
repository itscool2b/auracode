//! Immutable revision sync. Parallel edits become proposals, preserving both texts for review.
use super::*;
use aura_protocol::memory::{MemoryRevision, ProposeProjectMemory};
use aura_sync::merge::FieldValue;
use serde_json::Value;

pub(crate) fn install(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TEMP TRIGGER IF NOT EXISTS aura_sync_memory_INSERT AFTER INSERT ON main.project_memory_revisions BEGIN INSERT OR IGNORE INTO aura_sync_dirty(entity,id) VALUES('memory',NEW.revision); END; INSERT OR IGNORE INTO aura_sync_dirty SELECT 'memory',revision FROM project_memory_revisions WHERE NOT EXISTS(SELECT 1 FROM sync_heads WHERE collection='projects' AND sync_heads.id='memory-' || project_memory_revisions.revision);")?;
    Ok(())
}
pub(crate) fn snapshot(
    conn: &Connection,
    id: &str,
) -> Result<Option<(bool, BTreeMap<String, FieldValue>)>> {
    let row=conn.query_row("SELECT revision,project_id,parent_revision,markdown,reason,source,created_at FROM project_memory_revisions WHERE revision=?1",[id],|r|Ok(MemoryRevision{revision:r.get(0)?,project_id:r.get(1)?,parent_revision:r.get(2)?,markdown:r.get(3)?,reason:r.get(4)?,source:r.get(5)?,created_at:r.get(6)?})).optional()?;
    row.map(|row| {
        Ok((
            true,
            BTreeMap::from([
                (
                    "entity".into(),
                    FieldValue::Present(Value::String("memory".into())),
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
pub(crate) fn decode(record: &EncryptedRecord, metadata: &Metadata) -> Result<MemoryRevision> {
    let revision = metadata.fields.get("revision").ok_or(SyncError::Invalid)?;
    let FieldValue::Present(value) = &revision.value else {
        return Err(SyncError::Invalid);
    };
    let revision: MemoryRevision =
        serde_json::from_value(value.clone()).map_err(|_| SyncError::Invalid)?;
    if record.collection != "projects"
        || record.id != format!("memory-{}", revision.revision)
        || metadata.deleted()
        || !transcript_uuid(&revision.revision)
        || !transcript_uuid(&revision.project_id)
        || revision
            .parent_revision
            .as_ref()
            .is_some_and(|id| !transcript_uuid(id))
        || revision.markdown.len() > crate::chatstore::memory::MAX_MARKDOWN
        || revision.reason.len() > 2048
        || revision.source.len() > crate::chatstore::memory::MAX_SOURCE
        || revision.created_at < 0
    {
        return Err(SyncError::Invalid);
    }
    Ok(revision)
}
fn transcript_uuid(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
}
pub(crate) fn project(
    conn: &Connection,
    record: &EncryptedRecord,
    metadata: &Metadata,
) -> Result<bool> {
    let row = decode(record, metadata)?;
    if !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1 AND deleted=0)",
        [&row.project_id],
        |r| r.get::<_, bool>(0),
    )? {
        return Ok(false);
    }
    if let Some(parent) = &row.parent_revision
        && !conn.query_row("SELECT EXISTS(SELECT 1 FROM project_memory_revisions WHERE revision=?1 AND project_id=?2)",params![parent,row.project_id],|r|r.get::<_,bool>(0))? { return Ok(false); }
    let already: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_memory_revisions WHERE revision=?1)",
        [&row.revision],
        |r| r.get(0),
    )?;
    if already && !conn.query_row("SELECT project_id=?2 AND parent_revision IS ?3 AND markdown=?4 AND reason=?5 AND source=?6 AND created_at=?7 FROM project_memory_revisions WHERE revision=?1",params![row.revision,row.project_id,row.parent_revision,row.markdown,row.reason,row.source,row.created_at],|r|r.get::<_,bool>(0))? { return Err(SyncError::Invalid); }
    if !already {
        conn.execute("INSERT INTO project_memory_revisions(revision,project_id,parent_revision,markdown,reason,source,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![row.revision,row.project_id,row.parent_revision,row.markdown,row.reason,row.source,row.created_at])?;
        let current = crate::chatstore::memory::read(conn, &row.project_id)?;
        if current.revision == row.parent_revision {
            conn.execute("INSERT INTO project_memory(project_id,revision,markdown,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,markdown=excluded.markdown,updated_at=excluded.updated_at",params![row.project_id,row.revision,row.markdown,row.created_at])?;
        } else {
            let command = crate::chatstore::memory::Command::Propose(ProposeProjectMemory {
                project_id: row.project_id.clone(),
                base_revision: row.parent_revision.clone(),
                markdown: row.markdown.clone(),
                reason: format!(
                    "Sync conflict: {}",
                    crate::conversation::cut(&row.reason, 1900)
                ),
                chat_id: None,
                idempotency_key: format!("sync:{}", row.revision),
            });
            crate::chatstore::memory::execute(conn, command, row.created_at)?;
            conn.execute("UPDATE project_memory_proposals SET state='conflict' WHERE project_id=?1 AND idempotency_key=?2",params![row.project_id,format!("sync:{}",row.revision)])?;
        }
    }
    conn.execute(
        "DELETE FROM aura_sync_dirty WHERE entity='memory' AND id=?1",
        [row.revision],
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        chatstore::memory::{Command as MemoryCommand, Reply as MemoryReply},
        paths::DataRoot,
        profile::{ProfileKind, Profiles},
    };
    use aura_protocol::memory::SaveProjectMemory;
    use std::sync::Arc;
    fn fixture(key: Arc<AccountKey>, device: &str) -> (tempfile::TempDir, Store, SyncContext) {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profiles::new(DataRoot::at(temp.path()))
            .create(ProfileKind::Account, "Memory account")
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
    fn change(record: EncryptedRecord, seq: u64) -> Change {
        Change {
            device_id: record.hlc.parse::<Hlc>().unwrap().device().into(),
            record,
            server_seq: seq,
        }
    }
    fn pull(
        store: &mut Store,
        context: &SyncContext,
        records: Vec<Change>,
        now: u64,
    ) -> Result<()> {
        let cursor = records.last().unwrap().server_seq;
        SyncLedger::new(store, context.identity.clone(), &context.key)?.accept_workspace_pull(
            &Pull {
                records,
                next_cursor: cursor,
                has_more: false,
            },
            now,
        )
    }
    fn save(
        store: &mut Store,
        context: &SyncContext,
        id: &str,
        expected: Option<String>,
        text: &str,
        now: u64,
    ) -> String {
        let tx = store.conn_mut().transaction().unwrap();
        let MemoryReply::Memory(memory) = crate::chatstore::memory::execute(
            &tx,
            MemoryCommand::Save(SaveProjectMemory {
                project_id: id.into(),
                expected_revision: expected,
                markdown: text.into(),
                reason: "User reviewed project memory".into(),
            }),
            now as i64,
        )
        .unwrap() else {
            panic!()
        };
        capture::finish(&tx, context, now as i64).unwrap();
        tx.commit().unwrap();
        memory.revision.unwrap()
    }
    fn memory_head(store: &Store, id: &str) -> EncryptedRecord {
        head(store.conn(), "projects", &format!("memory-{id}"))
            .unwrap()
            .unwrap()
    }
    #[test]
    fn encrypted_capture_and_projection_preserve_parallel_memory_revisions_without_ghost_projects()
    {
        let key = Arc::new(AccountKey::generate().unwrap());
        let (_a, mut source, source_context) = fixture(key.clone(), "source");
        let (_b, mut target, target_context) = fixture(key, "target");
        let now = crate::time::now_millis() as u64;
        let id = crate::ids::new_id();
        {
            let tx = source.conn_mut().transaction().unwrap();
            tx.execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES(?1,'Memory project',1,1,'source')",[&id]).unwrap();
            capture::finish(&tx, &source_context, now as i64).unwrap();
            tx.commit().unwrap();
        }
        let first = save(
            &mut source,
            &source_context,
            &id,
            None,
            "Confidential durable project note",
            now + 1,
        );
        let memory_record = memory_head(&source, &first);
        assert!(
            !serde_json::to_string(&memory_record)
                .unwrap()
                .contains("Confidential")
        );
        let project_record = head(source.conn(), "projects", &id).unwrap().unwrap();
        // Child-first transfer is staged until its actual project arrives, never a fake project row.
        pull(
            &mut target,
            &target_context,
            vec![change(memory_record, 1)],
            now + 2,
        )
        .unwrap();
        assert_eq!(
            target
                .conn()
                .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        pull(
            &mut target,
            &target_context,
            vec![change(project_record, 2)],
            now + 3,
        )
        .unwrap();
        assert_eq!(
            crate::chatstore::memory::read(target.conn(), &id)
                .unwrap()
                .markdown,
            "Confidential durable project note"
        );
        assert_eq!(
            target
                .conn()
                .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let source_next = save(
            &mut source,
            &source_context,
            &id,
            Some(first.clone()),
            "Source parallel edit",
            now + 4,
        );
        let target_next = save(
            &mut target,
            &target_context,
            &id,
            Some(first),
            "Target parallel edit",
            now + 5,
        );
        pull(
            &mut target,
            &target_context,
            vec![change(memory_head(&source, &source_next), 3)],
            now + 6,
        )
        .unwrap();
        assert_eq!(
            crate::chatstore::memory::read(target.conn(), &id)
                .unwrap()
                .revision,
            Some(target_next.clone())
        );
        let MemoryReply::Proposals(conflicts) = crate::chatstore::memory::execute(
            target.conn(),
            MemoryCommand::Proposals(id.clone()),
            now as i64,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].state, "conflict");
        assert_eq!(conflicts[0].markdown, "Source parallel edit");
        assert_eq!(
            target
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM project_memory_revisions WHERE project_id=?1",
                    [&id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            3
        );
        // A replay cannot duplicate a proposal or replace the accepted head.
        pull(
            &mut target,
            &target_context,
            vec![change(memory_head(&source, &source_next), 4)],
            now + 7,
        )
        .unwrap();
        assert_eq!(
            target
                .conn()
                .query_row("SELECT COUNT(*) FROM project_memory_proposals", [], |r| r
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            1
        );
        target
            .conn()
            .execute("UPDATE projects SET deleted=1 WHERE id=?1", [&id])
            .unwrap();
        assert!(crate::chatstore::memory::read(target.conn(), &id).is_err());
        target
            .conn()
            .execute("DELETE FROM projects WHERE id=?1", [&id])
            .unwrap();
        assert_eq!(
            target
                .conn()
                .query_row("SELECT COUNT(*) FROM project_memory_revisions", [], |r| r
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
    }
    #[test]
    fn agent_revisions_sync_naming_the_chat_that_wrote_them() {
        let key = Arc::new(AccountKey::generate().unwrap());
        let (_a, mut source, source_context) = fixture(key.clone(), "source");
        let (_b, mut target, target_context) = fixture(key, "target");
        let now = crate::time::now_millis() as u64;
        let (project, chat) = {
            let tx = source.conn_mut().transaction().unwrap();
            let chat = crate::chatstore::rows::create_chat(
                &tx,
                &crate::chatstore::NewChat {
                    folder: "/synced-agent-memory".into(),
                    agent_id: "mock".into(),
                    agent_host: Default::default(),
                    device_id: "source".into(),
                    now: 1,
                },
            )
            .unwrap()
            .id;
            let project: String = tx
                .query_row("SELECT project_id FROM chats WHERE id=?1", [&chat], |r| {
                    r.get(0)
                })
                .unwrap();
            capture::finish(&tx, &source_context, now as i64).unwrap();
            tx.commit().unwrap();
            (project, chat)
        };
        let revision = {
            let tx = source.conn_mut().transaction().unwrap();
            let MemoryReply::Memory(memory) = crate::chatstore::memory::execute(
                &tx,
                MemoryCommand::AgentSave {
                    input: SaveProjectMemory {
                        project_id: project.clone(),
                        expected_revision: None,
                        markdown: "Agent-written durable fact".into(),
                        reason: "Learned while working".into(),
                    },
                    chat_id: chat.clone(),
                },
                now as i64 + 1,
            )
            .unwrap() else {
                panic!()
            };
            capture::finish(&tx, &source_context, now as i64 + 1).unwrap();
            tx.commit().unwrap();
            memory.revision.unwrap()
        };
        let record = memory_head(&source, &revision);
        let DecodedMetadata::Known(metadata) =
            open(&source_context.identity, &source_context.key, &record, now).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            decode(&record, &metadata).unwrap().source,
            format!("agent:{chat}")
        );
        let project_record = head(source.conn(), "projects", &project).unwrap().unwrap();
        pull(
            &mut target,
            &target_context,
            vec![change(project_record, 1), change(record, 2)],
            now + 2,
        )
        .unwrap();
        assert_eq!(
            target
                .conn()
                .query_row(
                    "SELECT source FROM project_memory_revisions WHERE revision=?1",
                    [&revision],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            format!("agent:{chat}")
        );
        assert_eq!(
            crate::chatstore::memory::read(target.conn(), &project)
                .unwrap()
                .markdown,
            "Agent-written durable fact"
        );
    }
    #[test]
    fn maximum_memory_and_escaped_reason_fit_encrypted_record_budget() {
        let key = Arc::new(AccountKey::generate().unwrap());
        let (_temp, mut store, context) = fixture(key, "source");
        let id = crate::ids::new_id();
        store.conn().execute("INSERT INTO projects(id,name,created_at,updated_at,device_id) VALUES(?1,'Limit',1,1,'source')",[&id]).unwrap();
        let now = crate::time::now_millis() as u64;
        let revision = save(
            &mut store,
            &context,
            &id,
            None,
            &"\n".repeat(crate::chatstore::memory::MAX_MARKDOWN),
            now,
        );
        let record = memory_head(&store, &revision);
        let DecodedMetadata::Known(metadata) =
            open(&context.identity, &context.key, &record, now).unwrap()
        else {
            panic!()
        };
        assert!(
            serde_json::to_vec(&metadata).unwrap().len() < aura_sync::crypto::MAX_RECORD_PLAINTEXT
        );
        decode(&record, &metadata).unwrap();
    }
}
