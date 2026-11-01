//! Project memory on the sole profile writer. Revisions are immutable; every write compares a base.
use aura_protocol::memory::*;
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) const MAX_MARKDOWN: usize = 16 * 1024;
pub(crate) enum Command {
    ReadChat(String),
    Read(String),
    History(String),
    Proposals(String),
    Export(String),
    Save(SaveProjectMemory),
    Propose(ProposeProjectMemory),
    Accept(AcceptMemoryProposal),
    Reject {
        project_id: String,
        proposal_id: String,
    },
    Import(ImportProjectMemory),
    Snapshot {
        chat_id: String,
        prompt_id: String,
        previous: Option<String>,
        embedded_context: Option<String>,
    },
}
pub(crate) enum Reply {
    Memory(ProjectMemory),
    History(Vec<MemoryRevision>),
    Proposals(Vec<MemoryProposal>),
    Proposal(MemoryProposal),
    Bundle(ProjectMemoryBundle),
    Snapshot(Option<Snapshot>),
}
#[derive(Debug, Clone)]
pub(crate) struct Snapshot {
    pub revision: Option<String>,
    pub visible_text: String,
    pub already_attached: bool,
}
impl Command {
    pub(crate) fn read_only(&self) -> bool {
        matches!(
            self,
            Self::ReadChat(_)
                | Self::Read(_)
                | Self::History(_)
                | Self::Proposals(_)
                | Self::Export(_)
        )
    }
    pub(crate) fn bytes(&self) -> usize {
        1024 + match self {
            Self::Snapshot {
                embedded_context, ..
            } => embedded_context.as_ref().map_or(0, String::len),
            Self::Save(v) => v.markdown.len(),
            Self::Propose(v) => v.markdown.len(),
            Self::Import(v) => serde_json::to_vec(v).map_or(MAX_MARKDOWN, |v| v.len()),
            _ => 0,
        }
    }
}
fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}
fn check_markdown(markdown: &str, reason: &str) -> rusqlite::Result<()> {
    if markdown.len() > MAX_MARKDOWN
        || markdown
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        || reason.trim().is_empty()
        || reason.len() > 2048
    {
        return Err(invalid(
            "Memory must be at most 16 KiB and include a reason of at most 2 KiB.",
        ));
    }
    Ok(())
}
fn project(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    if !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1 AND deleted=0)",
        [id],
        |r| r.get::<_, bool>(0),
    )? {
        return Err(invalid("This project is unavailable."));
    }
    Ok(())
}
pub(crate) fn read(conn: &Connection, id: &str) -> rusqlite::Result<ProjectMemory> {
    project(conn, id)?;
    Ok(conn
        .query_row(
            "SELECT revision,markdown,updated_at FROM project_memory WHERE project_id=?1",
            [id],
            |r| {
                Ok(ProjectMemory {
                    project_id: id.into(),
                    revision: Some(r.get(0)?),
                    markdown: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            },
        )
        .optional()?
        .unwrap_or(ProjectMemory {
            project_id: id.into(),
            revision: None,
            markdown: String::new(),
            updated_at: 0,
        }))
}
fn revision(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRevision> {
    Ok(MemoryRevision {
        revision: row.get(0)?,
        project_id: row.get(1)?,
        parent_revision: row.get(2)?,
        markdown: row.get(3)?,
        reason: row.get(4)?,
        source: row.get(5)?,
        created_at: row.get(6)?,
    })
}
fn proposal(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryProposal> {
    Ok(MemoryProposal {
        id: row.get(0)?,
        project_id: row.get(1)?,
        base_revision: row.get(2)?,
        markdown: row.get(3)?,
        reason: row.get(4)?,
        chat_id: row.get(5)?,
        idempotency_key: row.get(6)?,
        state: row.get(7)?,
        created_at: row.get(8)?,
    })
}
fn history(conn: &Connection, id: &str) -> rusqlite::Result<Vec<MemoryRevision>> {
    conn.prepare("SELECT revision,project_id,parent_revision,markdown,reason,source,created_at FROM project_memory_revisions WHERE project_id=?1 ORDER BY created_at DESC,revision DESC")?.query_map([id],revision)?.collect()
}
fn proposals(conn: &Connection, id: &str) -> rusqlite::Result<Vec<MemoryProposal>> {
    conn.prepare("SELECT id,project_id,base_revision,markdown,reason,chat_id,idempotency_key,state,created_at FROM project_memory_proposals WHERE project_id=?1 ORDER BY created_at DESC,id DESC")?.query_map([id],proposal)?.collect()
}
fn save(
    conn: &Connection,
    input: SaveProjectMemory,
    now: i64,
    source: &str,
) -> rusqlite::Result<ProjectMemory> {
    check_markdown(&input.markdown, &input.reason)?;
    let current = read(conn, &input.project_id)?;
    if current.revision != input.expected_revision {
        return Err(invalid(
            "Project memory changed. Review the current revision before saving.",
        ));
    }
    let revision = crate::ids::new_id();
    conn.execute("INSERT INTO project_memory_revisions(revision,project_id,parent_revision,markdown,reason,source,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![revision,input.project_id,current.revision,input.markdown,input.reason,source,now])?;
    conn.execute("INSERT INTO project_memory(project_id,revision,markdown,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,markdown=excluded.markdown,updated_at=excluded.updated_at",params![input.project_id,revision,input.markdown,now])?;
    read(conn, &input.project_id)
}
fn propose(
    conn: &Connection,
    input: ProposeProjectMemory,
    now: i64,
) -> rusqlite::Result<MemoryProposal> {
    project(conn, &input.project_id)?;
    check_markdown(&input.markdown, &input.reason)?;
    if input.idempotency_key.is_empty() || input.idempotency_key.len() > 128 {
        return Err(invalid(
            "A proposal requires an idempotency key of at most 128 characters.",
        ));
    }
    if let Some(chat) = &input.chat_id
        && !conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM chats WHERE id=?1 AND project_id=?2 AND deleted=0)",
            params![chat, input.project_id],
            |r| r.get::<_, bool>(0),
        )?
    {
        return Err(invalid(
            "This chat does not belong to the proposal's project.",
        ));
    }
    let old=conn.query_row("SELECT id,project_id,base_revision,markdown,reason,chat_id,idempotency_key,state,created_at FROM project_memory_proposals WHERE project_id=?1 AND idempotency_key=?2",params![input.project_id,input.idempotency_key],proposal).optional()?;
    if let Some(old) = old {
        if old.base_revision != input.base_revision
            || old.markdown != input.markdown
            || old.reason != input.reason
            || old.chat_id != input.chat_id
        {
            return Err(invalid(
                "That proposal key was already used for different content.",
            ));
        }
        return Ok(old);
    }
    let p = MemoryProposal {
        id: crate::ids::new_id(),
        project_id: input.project_id,
        base_revision: input.base_revision,
        markdown: input.markdown,
        reason: input.reason,
        chat_id: input.chat_id,
        idempotency_key: input.idempotency_key,
        state: "pending".into(),
        created_at: now,
    };
    conn.execute("INSERT INTO project_memory_proposals(id,project_id,base_revision,markdown,reason,chat_id,idempotency_key,state,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![p.id,p.project_id,p.base_revision,p.markdown,p.reason,p.chat_id,p.idempotency_key,p.state,p.created_at])?;
    Ok(p)
}
pub(crate) fn execute(conn: &Connection, command: Command, now: i64) -> rusqlite::Result<Reply> {
    match command {
        Command::ReadChat(chat_id) => {
            let id:String=conn.query_row("SELECT c.project_id FROM chats c JOIN projects p ON p.id=c.project_id WHERE c.id=?1 AND c.deleted=0 AND p.deleted=0 AND (c.folder_id IS NULL OR EXISTS(SELECT 1 FROM project_folders f WHERE f.id=c.folder_id AND f.deleted=0))",[chat_id],|r|r.get(0))?;
            Ok(Reply::Memory(read(conn, &id)?))
        }
        Command::Read(id) => Ok(Reply::Memory(read(conn, &id)?)),
        Command::History(id) => {
            project(conn, &id)?;
            Ok(Reply::History(history(conn, &id)?))
        }
        Command::Proposals(id) => {
            project(conn, &id)?;
            Ok(Reply::Proposals(proposals(conn, &id)?))
        }
        Command::Save(v) => Ok(Reply::Memory(save(conn, v, now, "user")?)),
        Command::Propose(v) => Ok(Reply::Proposal(propose(conn, v, now)?)),
        Command::Accept(v) => {
            let p=conn.query_row("SELECT id,project_id,base_revision,markdown,reason,chat_id,idempotency_key,state,created_at FROM project_memory_proposals WHERE id=?1 AND project_id=?2",params![v.proposal_id,v.project_id],proposal)?;
            if !matches!(p.state.as_str(), "pending" | "conflict")
                || p.base_revision != v.expected_revision
            {
                return Err(invalid(
                    "This proposal is stale. Review it against the current memory and save a new edit.",
                ));
            }
            let memory = save(
                conn,
                SaveProjectMemory {
                    project_id: v.project_id,
                    expected_revision: v.expected_revision,
                    markdown: p.markdown,
                    reason: p.reason,
                },
                now,
                "proposal",
            )?;
            conn.execute(
                "UPDATE project_memory_proposals SET state='accepted' WHERE id=?1",
                [p.id],
            )?;
            Ok(Reply::Memory(memory))
        }
        Command::Reject {
            project_id,
            proposal_id,
        } => {
            project(conn, &project_id)?;
            conn.execute("UPDATE project_memory_proposals SET state='rejected' WHERE id=?1 AND project_id=?2 AND state IN ('pending','conflict')",params![proposal_id,project_id])?;
            Ok(Reply::Proposals(proposals(conn, &project_id)?))
        }
        Command::Export(id) => Ok(Reply::Bundle(ProjectMemoryBundle {
            schema_version: 1,
            current: read(conn, &id)?,
            history: history(conn, &id)?,
            proposals: proposals(conn, &id)?,
            project_id: id,
        })),
        Command::Import(v) => {
            if v.bundle.schema_version != 1 || v.bundle.current.project_id != v.bundle.project_id {
                return Err(invalid("This memory export format is unsupported."));
            }
            Ok(Reply::Memory(save(
                conn,
                SaveProjectMemory {
                    project_id: v.bundle.project_id,
                    expected_revision: v.expected_revision,
                    markdown: v.bundle.current.markdown,
                    reason: "Imported reviewed Markdown".into(),
                },
                now,
                "import",
            )?))
        }
        Command::Snapshot {
            chat_id,
            prompt_id,
            previous,
            embedded_context,
        } => {
            let id: Option<String> = conn.query_row(
                "SELECT project_id FROM chats WHERE id=?1 AND deleted=0",
                [&chat_id],
                |r| r.get(0),
            )?;
            let Some(id) = id else {
                return Ok(Reply::Snapshot(None));
            };
            project(conn, &id)?;
            let saved = conn.query_row("SELECT revision,markdown,visible_text FROM project_memory_snapshots WHERE prompt_id=?1 AND chat_id=?2 AND project_id=?3",params![prompt_id,chat_id,id],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional()?;
            if let Some((revision, markdown, mut visible_text)) = saved {
                // A stopped preparation can retry in a fresh generation. Keep its exact revision,
                // but attach the saved text if the previous generation had already received it.
                if visible_text.is_empty() && revision != previous {
                    visible_text = visible_context(&ProjectMemory {
                        project_id: id,
                        revision: revision.clone(),
                        markdown,
                        updated_at: now,
                    });
                    conn.execute(
                        "UPDATE project_memory_snapshots SET visible_text=?2 WHERE prompt_id=?1",
                        params![prompt_id, visible_text],
                    )?;
                }
                let already_attached = embedded_context.as_ref() == Some(&visible_text);
                return Ok(Reply::Snapshot(Some(Snapshot {
                    revision,
                    visible_text,
                    already_attached,
                })));
            }
            // Reviewed Retry/Edit carries the original reference Text part. Recognize only exact
            // bytes recorded by this chat, so it is neither duplicated nor replaced by newer memory.
            if let Some(embedded) = embedded_context
                && let Some((revision,markdown))=conn.query_row("SELECT revision,markdown FROM project_memory_snapshots WHERE chat_id=?1 AND project_id=?2 AND visible_text=?3 AND visible_text<>'' LIMIT 1",params![chat_id,id,embedded],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,String>(1)?))).optional()? {
                    conn.execute("INSERT INTO project_memory_snapshots(prompt_id,chat_id,project_id,revision,markdown,visible_text,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![prompt_id,chat_id,id,revision,markdown,embedded,now])?;
                    return Ok(Reply::Snapshot(Some(Snapshot{revision,visible_text:embedded,already_attached:true})));
            }
            let memory = read(conn, &id)?;
            let visible_text = if memory.revision == previous {
                String::new()
            } else {
                visible_context(&memory)
            };
            conn.execute("INSERT INTO project_memory_snapshots(prompt_id,chat_id,project_id,revision,markdown,visible_text,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![prompt_id,chat_id,id,memory.revision,memory.markdown,visible_text,now])?;
            Ok(Reply::Snapshot(Some(Snapshot {
                revision: memory.revision,
                visible_text,
                already_attached: false,
            })))
        }
    }
}
pub(crate) fn visible_context(memory: &ProjectMemory) -> String {
    format!(
        "\n\nProject memory (Aura reference context, revision {})\nUse this as project background. The current request and instruction files take precedence. Native agent memory is unchanged. To suggest an update, use the Aura project-memory read/propose tools when available; proposals require user review. If the helper is absent or unreachable on this host, proposals are unavailable here; use Aura's Project memory editor.\n\n{}\n",
        memory.revision.as_deref().unwrap_or("empty"),
        if memory.markdown.is_empty() {
            "(Project memory is empty.)"
        } else {
            &memory.markdown
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chatstore::test_support::TestDb;
    fn fixture() -> (TestDb, String, String) {
        let db = TestDb::new();
        let chat = db.chat("/memory");
        let project = db
            .conn()
            .query_row("SELECT project_id FROM chats WHERE id=?1", [&chat], |r| {
                r.get::<_, String>(0)
            })
            .unwrap();
        (db, project, chat)
    }
    fn saved(conn: &Connection, id: &str, base: Option<String>, markdown: &str) -> ProjectMemory {
        let Reply::Memory(v) = execute(
            conn,
            Command::Save(SaveProjectMemory {
                project_id: id.into(),
                expected_revision: base,
                markdown: markdown.into(),
                reason: "reviewed change".into(),
            }),
            10,
        )
        .unwrap() else {
            panic!("memory reply")
        };
        v
    }
    #[test]
    fn revisions_compare_base_and_stale_proposals_never_overwrite_new_user_edits() {
        let (db, id, chat) = fixture();
        let first = saved(db.conn(), &id, None, "First");
        let input = ProposeProjectMemory {
            project_id: id.clone(),
            base_revision: first.revision.clone(),
            markdown: "Agent proposal".into(),
            reason: "Learned durable project fact".into(),
            chat_id: Some(chat),
            idempotency_key: "proposal-one".into(),
        };
        let Reply::Proposal(p) = execute(db.conn(), Command::Propose(input.clone()), 11).unwrap()
        else {
            panic!()
        };
        let Reply::Proposal(retried) =
            execute(db.conn(), Command::Propose(input.clone()), 12).unwrap()
        else {
            panic!()
        };
        assert_eq!(p.id, retried.id);
        let mut changed = input;
        changed.markdown = "Different content".into();
        assert!(execute(db.conn(), Command::Propose(changed), 12).is_err());
        let second = saved(db.conn(), &id, first.revision.clone(), "Second");
        assert!(
            execute(
                db.conn(),
                Command::Accept(AcceptMemoryProposal {
                    project_id: id.clone(),
                    proposal_id: p.id,
                    expected_revision: first.revision.clone()
                }),
                13
            )
            .is_err()
        );
        assert!(
            execute(
                db.conn(),
                Command::Save(SaveProjectMemory {
                    project_id: id.clone(),
                    expected_revision: first.revision,
                    markdown: "Lost write".into(),
                    reason: "stale".into()
                }),
                14
            )
            .is_err()
        );
        assert_eq!(read(db.conn(), &id).unwrap(), second);
        assert_eq!(history(db.conn(), &id).unwrap().len(), 2);
    }
    #[test]
    fn accepted_proposal_requires_exact_reviewed_base_and_retains_history() {
        let (db, id, _) = fixture();
        let first = saved(db.conn(), &id, None, "Before");
        let Reply::Proposal(p) = execute(
            db.conn(),
            Command::Propose(ProposeProjectMemory {
                project_id: id.clone(),
                base_revision: first.revision.clone(),
                markdown: "After".into(),
                reason: "new fact".into(),
                chat_id: None,
                idempotency_key: "x".into(),
            }),
            11,
        )
        .unwrap() else {
            panic!()
        };
        let Reply::Memory(accepted) = execute(
            db.conn(),
            Command::Accept(AcceptMemoryProposal {
                project_id: id.clone(),
                proposal_id: p.id.clone(),
                expected_revision: first.revision,
            }),
            12,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(accepted.markdown, "After");
        assert_eq!(proposals(db.conn(), &id).unwrap()[0].state, "accepted");
        assert!(
            execute(
                db.conn(),
                Command::Accept(AcceptMemoryProposal {
                    project_id: id,
                    proposal_id: p.id,
                    expected_revision: accepted.revision
                }),
                13
            )
            .is_err()
        );
    }
    #[test]
    fn snapshots_bind_exact_prompt_revision_across_retry_and_changed_queue() {
        let (db, id, chat) = fixture();
        let first = saved(db.conn(), &id, None, "First snapshot");
        let command = |prompt: &str, previous: Option<String>| Command::Snapshot {
            chat_id: chat.clone(),
            prompt_id: prompt.into(),
            previous,
            embedded_context: None,
        };
        let Reply::Snapshot(Some(snapshot)) = execute(db.conn(), command("one", None), 11).unwrap()
        else {
            panic!()
        };
        assert!(snapshot.visible_text.contains("First snapshot"));
        let second = saved(db.conn(), &id, first.revision.clone(), "Second snapshot");
        let Reply::Snapshot(Some(retry)) =
            execute(db.conn(), command("one", first.revision.clone()), 12).unwrap()
        else {
            panic!()
        };
        assert_eq!(snapshot.visible_text, retry.visible_text);
        let Reply::Snapshot(Some(next)) =
            execute(db.conn(), command("two", first.revision), 13).unwrap()
        else {
            panic!()
        };
        assert_eq!(next.revision, second.revision);
        assert!(next.visible_text.contains("Second snapshot"));
        let Reply::Snapshot(Some(unchanged)) =
            execute(db.conn(), command("three", second.revision), 14).unwrap()
        else {
            panic!()
        };
        assert!(unchanged.visible_text.is_empty());
    }
    #[test]
    fn project_and_profile_scope_are_enforced_and_removed_memory_is_unavailable() {
        let (db, id, _) = fixture();
        saved(db.conn(), &id, None, "Scoped content");
        let (other, other_id, chat) = fixture();
        assert!(read(other.conn(), &id).is_err());
        assert!(
            execute(
                other.conn(),
                Command::Propose(ProposeProjectMemory {
                    project_id: other_id,
                    base_revision: None,
                    markdown: "x".into(),
                    reason: "x".into(),
                    chat_id: Some("foreign-chat".into()),
                    idempotency_key: chat
                }),
                1
            )
            .is_err()
        );
        db.conn()
            .execute("UPDATE projects SET deleted=1 WHERE id=?1", [&id])
            .unwrap();
        assert!(read(db.conn(), &id).is_err());
    }
    #[test]
    fn markdown_limits_are_bytes_and_exports_roundtrip_via_reviewed_revision() {
        let (db, id, _) = fixture();
        assert!(check_markdown(&"é".repeat(MAX_MARKDOWN / 2 + 1), "reason").is_err());
        assert!(check_markdown("bad\u{1}", "reason").is_err());
        let first = saved(db.conn(), &id, None, "Portable Markdown");
        let Reply::Bundle(bundle) = execute(db.conn(), Command::Export(id.clone()), 11).unwrap()
        else {
            panic!()
        };
        let Reply::Memory(imported) = execute(
            db.conn(),
            Command::Import(ImportProjectMemory {
                bundle,
                expected_revision: first.revision,
            }),
            12,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(imported.markdown, "Portable Markdown");
        assert_eq!(history(db.conn(), &id).unwrap().len(), 2);
    }
    #[test]
    fn reviewed_retry_reuses_exact_saved_reference_without_duplicate_or_latest_replacement() {
        let (db, id, chat) = fixture();
        let first = saved(db.conn(), &id, None, "Original reference");
        let Reply::Snapshot(Some(original)) = execute(
            db.conn(),
            Command::Snapshot {
                chat_id: chat.clone(),
                prompt_id: "source".into(),
                previous: None,
                embedded_context: None,
            },
            11,
        )
        .unwrap() else {
            panic!()
        };
        let second = saved(
            db.conn(),
            &id,
            first.revision.clone(),
            "New reference after source turn",
        );
        let Reply::Snapshot(Some(retry)) = execute(
            db.conn(),
            Command::Snapshot {
                chat_id: chat.clone(),
                prompt_id: "retry".into(),
                previous: None,
                embedded_context: Some(original.visible_text.clone()),
            },
            12,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(retry.revision, first.revision);
        assert_eq!(retry.visible_text, original.visible_text);
        assert!(retry.already_attached);
        let Reply::Snapshot(Some(next)) = execute(
            db.conn(),
            Command::Snapshot {
                chat_id: chat.clone(),
                prompt_id: "next".into(),
                previous: first.revision,
                embedded_context: None,
            },
            13,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(next.revision, second.revision);
        assert!(!next.already_attached);
        // A snapshot suppressed in the old generation is reattached when that queued prompt moves
        // to a new generation, while preserving its originally selected revision.
        let Reply::Snapshot(Some(quiet)) = execute(
            db.conn(),
            Command::Snapshot {
                chat_id: chat.clone(),
                prompt_id: "quiet".into(),
                previous: second.revision.clone(),
                embedded_context: None,
            },
            14,
        )
        .unwrap() else {
            panic!()
        };
        assert!(quiet.visible_text.is_empty());
        let Reply::Snapshot(Some(restarted)) = execute(
            db.conn(),
            Command::Snapshot {
                chat_id: chat,
                prompt_id: "quiet".into(),
                previous: None,
                embedded_context: None,
            },
            15,
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(restarted.revision, second.revision);
        assert!(
            restarted
                .visible_text
                .contains("New reference after source turn")
        );
    }
}
