use super::*;
use crate::{
    chatstore::{NewChat, files::Attachments, rows},
    paths::DataRoot,
    profile::Profiles,
    store::Store,
    sync::{SyncContext, SyncIdentity},
};
use aura_protocol::{AuraEvent, PromptPart, StopReason};
use aura_sync::crypto::AccountKey;
use std::sync::Arc;

struct Fixture {
    _dir: tempfile::TempDir,
    local: Profile,
    source: Store,
    target: Store,
    context: SyncContext,
    files: Attachments,
}
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let profiles = Profiles::new(DataRoot::at(dir.path()));
    let local = profiles.create(ProfileKind::Local, "Local").unwrap();
    let account = profiles.create(ProfileKind::Account, "Account").unwrap();
    let (source, _) = Store::open(&local).unwrap();
    let key = Arc::new(AccountKey::generate().unwrap());
    let (mut target, _) = Store::open_encrypted(
        &account,
        Arc::new(key.database_key("account", &account.meta.id).unwrap()),
    )
    .unwrap();
    let files = Attachments::Encrypted(
        crate::profile_files::EncryptedFiles::open(
            &account.attachments_dir(),
            aura_sync::crypto::files::Purpose::Attachment,
            Arc::new(key.profile_file_key("account", &account.meta.id).unwrap()),
        )
        .unwrap(),
    );
    let context = SyncContext {
        identity: SyncIdentity {
            account: "account".into(),
            device: "sync-device".into(),
            key_version: 1,
        },
        key,
    };
    context.initialize(&mut target).unwrap();
    Fixture {
        _dir: dir,
        local,
        source,
        target,
        context,
        files,
    }
}
fn seed(f: &Fixture, running: bool) -> (String, String, String) {
    let chat = rows::create_chat(
        f.source.conn(),
        &NewChat {
            folder: format!("/explicit/{}", crate::ids::new_id()).into(),
            agent_id: "claude".into(),
            agent_host: aura_protocol::agents::AgentHost::Native,
            device_id: "device".into(),
            now: 1,
        },
    )
    .unwrap();
    let project: String = f
        .source
        .conn()
        .query_row(
            "SELECT project_id FROM chats WHERE id=?1",
            [&chat.id],
            |r| r.get(0),
        )
        .unwrap();
    let session = crate::ids::new_id();
    let turn = crate::ids::new_id();
    let bytes = b"explicit selected project attachment";
    let hash = format!("{:x}", Sha256::digest(bytes));
    std::fs::write(f.local.attachments_dir().join(&hash), bytes).unwrap();
    f.source.conn().execute("INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,'text/plain',?2,1) ON CONFLICT(sha256) DO NOTHING",params![hash,bytes.len() as i64]).unwrap();
    f.source.conn().execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES(?1,?2,?3,'notes.txt','text/plain',?4,1)",params![crate::ids::new_id(),chat.id,hash,bytes.len() as i64]).unwrap();
    f.source.conn().execute("INSERT INTO agent_sessions(id,chat_id,agent_id,native_session_id,cwd,created_at,updated_at,device_id) VALUES(?1,?2,'claude','do-not-copy-native','/private/native',1,1,'device')",params![session,chat.id]).unwrap();
    let parts = serde_json::to_string(&vec![PromptPart::Text {
        text: "Original visible prompt".into(),
    }])
    .unwrap();
    f.source.conn().execute("INSERT INTO turns(id,chat_id,agent_session_id,seq,status,started_at,ended_at,device_id,prompt_parts_json,first_event_seq) VALUES(?1,?2,?3,1,?4,1,2,'device',?5,0)",params![turn,chat.id,session,if running {"running"} else {"completed"},parts]).unwrap();
    let mut events = vec![
        AuraEvent::TurnStarted {
            turn_id: turn.clone(),
            prompt_id: None,
        },
        AuraEvent::UserMessageDelta {
            message_id: "user".into(),
            text: "Original visible prompt".into(),
        },
        AuraEvent::MessageDelta {
            message_id: "assistant".into(),
            text: "Saved response".into(),
        },
    ];
    if !running {
        events.extend([
            AuraEvent::MessageCompleted {
                message_id: "assistant".into(),
            },
            AuraEvent::TurnEnded {
                turn_id: turn.clone(),
                stop_reason: StopReason::EndTurn,
                usage: None,
                duration_ms: None,
                recovered: false,
            },
        ]);
    }
    for (seq, event) in events.into_iter().enumerate() {
        f.source.conn().execute("INSERT INTO events(id,chat_id,turn_id,seq,kind,payload,created_at,device_id) VALUES(?1,?2,?3,?4,?5,?6,1,'device')",params![crate::ids::new_id(),chat.id,turn,seq as i64,event.kind(),serde_json::to_string(&event).unwrap()]).unwrap();
    }
    f.source.conn().execute("INSERT INTO queued_prompts(id,chat_id,text,created_at,device_id) VALUES(?1,?2,'Never send this automatically',1,'device')",params![crate::ids::new_id(),chat.id]).unwrap();
    f.source
        .conn()
        .execute(
            "INSERT INTO composer_drafts(chat_id,input_json,updated_at) VALUES(?1,?2,1)",
            params![chat.id, r#"{"text":"Saved draft","attachment_ids":[]}"#],
        )
        .unwrap();
    (project, chat.id, hash)
}
fn reviewed(f: &Fixture) -> Vec<LocalImportSelection> {
    preview(&f.local, "device")
        .unwrap()
        .projects
        .into_iter()
        .map(|p| LocalImportSelection {
            project_id: p.project_id,
            revision: p.revision,
        })
        .collect()
}
fn apply(
    f: &mut Fixture,
    selected: Vec<LocalImportSelection>,
) -> Result<aura_protocol::local_import::LocalImportResult> {
    let Reply::Applied(result) = execute(
        &mut f.target,
        &f.context,
        &f.files,
        "device",
        Command::Apply {
            source: f.local.clone(),
            selected,
        },
    )?
    else {
        panic!("apply");
    };
    Ok(result)
}

#[test]
fn inline_agent_images_keep_chat_ownership_through_local_import() {
    let mut f = fixture();
    let (project, chat, _) = seed(&f, false);
    let (_, other, _) = seed(&f, false);
    let owned_bytes = b"owned image fixture";
    let foreign_bytes = b"private image fixture";
    let owned = format!("{:x}", Sha256::digest(owned_bytes));
    let foreign = format!("{:x}", Sha256::digest(foreign_bytes));
    for (owner, hash, bytes) in [
        (&chat, &owned, owned_bytes.as_slice()),
        (&other, &foreign, foreign_bytes.as_slice()),
    ] {
        std::fs::write(f.local.attachments_dir().join(hash), bytes).unwrap();
        f.source
            .conn()
            .execute(
                "INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,'image/png',?2,1)",
                params![hash, bytes.len()],
            )
            .unwrap();
        f.source.conn().execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES(?1,?2,?3,'Agent image','image/png',?4,1)",params![crate::ids::new_id(),owner,hash,bytes.len()]).unwrap();
    }
    let event = AuraEvent::MessageDelta {
        message_id: "assistant".into(),
        text: format!("![Owned](<aura-image:{owned}>) ![Guessed](<aura-image:{foreign}>)"),
    };
    f.source
        .conn()
        .execute(
            "UPDATE events SET payload=?2 WHERE chat_id=?1 AND kind='message_delta'",
            params![chat, serde_json::to_string(&event).unwrap()],
        )
        .unwrap();
    let selected = reviewed(&f)
        .into_iter()
        .filter(|item| item.project_id == project)
        .collect();
    assert_eq!(apply(&mut f, selected).unwrap().missing_attachments, 0);
    let (_, bytes) = f.files.sync_range(&owned, 0).unwrap();
    assert_eq!(bytes.as_slice(), owned_bytes);
    let count: usize = f
        .target
        .conn()
        .query_row(
            "SELECT count(*) FROM composer_attachments WHERE chat_id=?1 AND sha256=?2",
            params![chat, owned],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    let leaked: bool = f
        .target
        .conn()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM composer_attachments WHERE sha256=?1)",
            [&foreign],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!leaked);
    assert!(f.files.sync_range(&foreign, 0).is_err());
}

#[test]
fn selected_projects_copy_to_ciphertext_preserve_local_and_require_fresh_handoff() {
    let mut f = fixture();
    let (project, chat, hash) = seed(&f, true);
    let before = reviewed(&f);
    let result = apply(&mut f, before.clone()).unwrap();
    assert_eq!(result.project_ids, vec![project]);
    assert_eq!(
        (result.chats, result.turns, result.missing_attachments),
        (1, 1, 0)
    );
    assert_eq!(reviewed(&f), before, "source data is unchanged");
    let native: u32 = f
        .target
        .conn()
        .query_row("SELECT count(*) FROM agent_sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(native, 0);
    let queued: u32 = f
        .target
        .conn()
        .query_row("SELECT count(*) FROM queued_prompts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(queued, 0);
    let load = rows::load_chat(f.target.conn(), "device", &chat, 0)
        .unwrap()
        .unwrap();
    assert!(load.remote_history);
    assert_eq!(
        load.chat.folder.to_string_lossy(),
        f.source
            .conn()
            .query_row("SELECT path FROM folder_locations LIMIT 1", [], |r| r
                .get::<_, String>(0))
            .unwrap()
    );
    let state: String = f
        .target
        .conn()
        .query_row("SELECT status FROM turns WHERE chat_id=?1", [&chat], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(state, "interrupted");
    assert_eq!(
        f.files.sync_range(&hash, 0).unwrap().1.as_slice(),
        b"explicit selected project attachment"
    );
    let outbox: u32 = f
        .target
        .conn()
        .query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))
        .unwrap();
    assert!(outbox >= 3);
    let draft: String = f
        .target
        .conn()
        .query_row(
            "SELECT input_json FROM composer_drafts WHERE chat_id=?1",
            [&chat],
            |r| r.get(0),
        )
        .unwrap();
    assert!(draft.contains("Saved draft"));
}

#[test]
fn changed_second_project_rolls_back_the_whole_selection_and_repeats_never_overwrite() {
    let mut f = fixture();
    let (first, _, _) = seed(&f, false);
    let (second, _, _) = seed(&f, false);
    let selected = reviewed(&f);
    f.source
        .conn()
        .execute(
            "UPDATE projects SET name='Changed after review' WHERE id=?1",
            [&second],
        )
        .unwrap();
    assert!(matches!(apply(&mut f, selected), Err(ImportError::Changed)));
    assert_eq!(
        f.target
            .conn()
            .query_row("SELECT count(*) FROM projects", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
    let selected = reviewed(&f);
    apply(&mut f, selected.clone()).unwrap();
    f.target
        .conn()
        .execute(
            "UPDATE projects SET name='Account edit' WHERE id=?1",
            [&first],
        )
        .unwrap();
    assert!(apply(&mut f, selected).unwrap().project_ids.is_empty());
    assert_eq!(
        f.target
            .conn()
            .query_row("SELECT name FROM projects WHERE id=?1", [&first], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "Account edit"
    );
}

#[test]
fn occupied_local_and_newer_schema_are_refused_without_repair() {
    let f = fixture();
    seed(&f, false);
    let owner = ProfileOwner::acquire(&f.local).unwrap();
    assert!(matches!(
        preview(&f.local, "device"),
        Err(ImportError::InUse)
    ));
    drop(owner);
    f.source
        .conn()
        .pragma_update(None, "user_version", crate::store::SCHEMA_VERSION + 1)
        .unwrap();
    assert!(matches!(
        preview(&f.local, "device"),
        Err(ImportError::Schema)
    ));
    assert_eq!(
        f.source
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        crate::store::SCHEMA_VERSION + 1
    );
}

#[test]
fn missing_files_are_reported_but_changed_bytes_and_identity_collisions_roll_back() {
    let mut f = fixture();
    let (project, _, hash) = seed(&f, false);
    let selected = reviewed(&f);
    let attachment = f.local.attachments_dir().join(&hash);
    std::fs::write(&attachment, b"changed").unwrap();
    assert!(matches!(
        apply(&mut f, selected.clone()),
        Err(ImportError::Changed)
    ));
    assert_eq!(
        f.target
            .conn()
            .query_row("SELECT count(*) FROM local_imports", [], |r| r
                .get::<_, u32>(0))
            .unwrap(),
        0
    );
    std::fs::remove_file(&attachment).unwrap();
    assert_eq!(apply(&mut f, selected).unwrap().missing_attachments, 1);
    let Reply::Preview(review) = execute(
        &mut f.target,
        &f.context,
        &f.files,
        "device",
        Command::Preview(f.local.clone()),
    )
    .unwrap() else {
        panic!("preview");
    };
    assert!(review.projects[0].already_imported);
    f.target
        .conn()
        .execute("DELETE FROM local_imports WHERE project_id=?1", [&project])
        .unwrap();
    let selected = reviewed(&f);
    assert!(matches!(
        apply(&mut f, selected),
        Err(ImportError::Conflict)
    ));
}

#[test]
fn local_destination_is_never_a_plaintext_fallback() {
    let mut f = fixture();
    seed(&f, false);
    assert!(matches!(
        execute(
            &mut f.source,
            &f.context,
            &f.files,
            "device",
            Command::Preview(f.local.clone())
        ),
        Err(ImportError::AccountRequired)
    ));
}

#[test]
fn project_memory_history_proposals_and_exact_prompt_snapshots_survive_encrypted_local_import() {
    use crate::chatstore::memory::{Command as MemoryCommand, Reply as MemoryReply};
    use aura_protocol::memory::{ProposeProjectMemory, SaveProjectMemory};
    let mut f = fixture();
    let (project, chat, _) = seed(&f, false);
    let MemoryReply::Memory(memory) = crate::chatstore::memory::execute(
        f.source.conn(),
        MemoryCommand::Save(SaveProjectMemory {
            project_id: project.clone(),
            expected_revision: None,
            markdown: "Local project memory copied with account import".into(),
            reason: "Reviewed durable fact".into(),
        }),
        10,
    )
    .unwrap() else {
        panic!()
    };
    crate::chatstore::memory::execute(
        f.source.conn(),
        MemoryCommand::Propose(ProposeProjectMemory {
            project_id: project.clone(),
            base_revision: memory.revision.clone(),
            markdown: "Pending proposal".into(),
            reason: "Review after import".into(),
            chat_id: Some(chat.clone()),
            idempotency_key: "local-proposal".into(),
        }),
        11,
    )
    .unwrap();
    crate::chatstore::memory::execute(
        f.source.conn(),
        MemoryCommand::Snapshot {
            chat_id: chat,
            prompt_id: crate::ids::new_id(),
            previous: None,
            embedded_context: None,
        },
        12,
    )
    .unwrap();
    let selection = reviewed(&f);
    apply(&mut f, selection).unwrap();
    assert_eq!(
        crate::chatstore::memory::read(f.target.conn(), &project).unwrap(),
        memory
    );
    for table in [
        "project_memory_revisions",
        "project_memory_proposals",
        "project_memory_snapshots",
    ] {
        assert_eq!(
            f.target
                .conn()
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE project_id=?1"),
                    [&project],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }
    let encrypted = std::fs::read(f.target.path()).unwrap();
    assert!(
        !encrypted
            .windows(b"Local project memory".len())
            .any(|v| v == b"Local project memory")
    );
}
#[test]
fn agent_memory_revisions_keep_their_chat_through_local_import() {
    use crate::chatstore::memory::{Command as MemoryCommand, Reply as MemoryReply};
    use aura_protocol::memory::SaveProjectMemory;
    let mut f = fixture();
    let (project, chat, _) = seed(&f, false);
    let save = |command| {
        let MemoryReply::Memory(memory) =
            crate::chatstore::memory::execute(f.source.conn(), command, 10).unwrap()
        else {
            panic!()
        };
        memory
    };
    let owner = save(MemoryCommand::Save(SaveProjectMemory {
        project_id: project.clone(),
        expected_revision: None,
        markdown: "Owner notes".into(),
        reason: "Reviewed durable fact".into(),
    }));
    let agent = save(MemoryCommand::AgentSave {
        input: SaveProjectMemory {
            project_id: project.clone(),
            expected_revision: owner.revision,
            markdown: "Owner notes and the agent's addition".into(),
            reason: "Learned while working".into(),
        },
        chat_id: chat.clone(),
    });
    let selection = reviewed(&f);
    apply(&mut f, selection).unwrap();
    assert_eq!(
        crate::chatstore::memory::read(f.target.conn(), &project).unwrap(),
        agent
    );
    let sources = f
        .target
        .conn()
        .prepare("SELECT source FROM project_memory_revisions WHERE project_id=?1 ORDER BY created_at,source")
        .unwrap()
        .query_map([&project], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(sources, [format!("agent:{chat}"), "user".to_owned()]);
    // The chat it names came along, so the editor can show its title.
    assert!(
        f.target
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chats WHERE id=?1)",
                [&chat],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
}
#[test]
fn project_mcp_definitions_history_and_heads_import_without_global_settings_or_local_credentials() {
    use crate::mcp::{Command as McpCommand, Reply as McpReply};
    let mut f = fixture();
    let (project, _, _) = seed(&f, false);
    let mut definition = crate::mcp::tests::definition();
    definition.project_id = Some(project.clone());
    definition.env_keys = vec!["TOKEN".into()];
    crate::mcp::execute(
        f.source.conn(),
        McpCommand::Save {
            expected: 0,
            definition: definition.clone(),
        },
    )
    .unwrap();
    crate::mcp::execute(
        f.source.conn(),
        McpCommand::Credentials {
            expected: 1,
            id: definition.id.clone(),
            project_id: definition.project_id.clone(),
            credentials: aura_protocol::mcp::McpCredentials {
                env: std::collections::BTreeMap::from([(
                    "TOKEN".into(),
                    "source-profile-only-auth".into(),
                )]),
                headers: std::collections::BTreeMap::new(),
            },
        },
    )
    .unwrap();
    let mut global = crate::mcp::tests::definition();
    global.id = crate::ids::new_id();
    global.name = "global_not_imported".into();
    crate::mcp::execute(
        f.source.conn(),
        McpCommand::Save {
            expected: 2,
            definition: global,
        },
    )
    .unwrap();
    let selected = reviewed(&f);
    apply(&mut f, selected).unwrap();
    let McpReply::Snapshot(snapshot) =
        crate::mcp::execute(f.target.conn(), McpCommand::Snapshot).unwrap()
    else {
        panic!()
    };
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.servers.len(), 1);
    assert_eq!(snapshot.servers[0].definition, definition);
    assert_eq!(snapshot.servers[0].missing_credentials, ["env/TOKEN"]);
    for table in ["shared_mcp_revisions", "shared_mcp_heads"] {
        assert_eq!(
            f.target
                .conn()
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE scope=?1"),
                    [&project],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }
    let source_auth: String = f
        .source
        .conn()
        .query_row(
            "SELECT local_json FROM shared_mcp WHERE scope=?1",
            [project],
            |r| r.get(0),
        )
        .unwrap();
    assert!(source_auth.contains("source-profile-only-auth"));
    assert!(f.target.is_encrypted());
    let encrypted = std::fs::read(f.target.path()).unwrap();
    assert!(
        !encrypted
            .windows(b"source-profile-only-auth".len())
            .any(|v| v == b"source-profile-only-auth")
    );
    let outbox = f
        .target
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM sync_outbox WHERE id LIKE 'mcp-%'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(outbox, 1);
}
