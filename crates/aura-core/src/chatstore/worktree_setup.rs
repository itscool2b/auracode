//! Device-local recipes. Source folders must belong to the chat's project on this device.
use aura_protocol::worktree_setup::{WorktreeSetup, WorktreeSetupInput};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) struct Command {
    pub chat_id: String,
    pub source: String,
    pub save: Option<WorktreeSetupInput>,
    /// Reads the recipe of this project folder directly, for a chat that does not exist yet.
    /// `source` must still be this device's path of the folder. Saving is not allowed this way.
    pub folder_id: Option<String>,
}

impl Command {
    pub fn bytes(&self) -> usize {
        self.save.as_ref().map_or(1024, |input| {
            serde_json::to_vec(input).map_or(65536, |bytes| bytes.len()) + 1024
        })
    }
}

pub(crate) fn execute(
    conn: &Connection,
    device: &str,
    now: i64,
    command: Command,
) -> rusqlite::Result<WorktreeSetup> {
    let invalid = || {
        rusqlite::Error::InvalidParameterName(
            "The setup source no longer belongs to this chat's project on this device.".into(),
        )
    };
    let folder: String = match &command.folder_id {
        Some(_) if command.save.is_some() => return Err(invalid()),
        Some(folder_id) => conn.query_row(
            "SELECT pf.id FROM project_folders pf JOIN projects p ON p.id=pf.project_id JOIN folder_locations fl ON fl.folder_id=pf.id WHERE pf.id=?1 AND pf.deleted=0 AND p.deleted=0 AND fl.device_id=?2 AND fl.path=?3",
            params![folder_id, device, super::stored_path_text(&command.source)], |row| row.get(0)
        ).optional()?,
        None => conn.query_row(
            "SELECT pf.id FROM project_folders pf JOIN folder_locations fl ON fl.folder_id=pf.id JOIN chats c ON c.project_id=pf.project_id WHERE c.id=?1 AND c.deleted=0 AND pf.deleted=0 AND fl.device_id=?2 AND fl.path=?3 ORDER BY pf.id LIMIT 1",
            params![command.chat_id, device, super::stored_path_text(&command.source)], |row| row.get(0)
        ).optional()?,
    }.ok_or_else(invalid)?;
    let input = if let Some(input) = command.save {
        crate::gitworkspaces::setup::validate(&input).map_err(|_| {
            rusqlite::Error::InvalidParameterName("The setup recipe is invalid.".into())
        })?;
        let json = serde_json::to_string(&input).map_err(|_| invalid())?;
        conn.execute("INSERT INTO worktree_setup(folder_id,device_id,input_json,updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(folder_id,device_id) DO UPDATE SET input_json=excluded.input_json,updated_at=excluded.updated_at", params![folder,device,json,now])?;
        input
    } else {
        let json: Option<String> = conn
            .query_row(
                "SELECT input_json FROM worktree_setup WHERE folder_id=?1 AND device_id=?2",
                params![folder, device],
                |row| row.get(0),
            )
            .optional()?;
        match json {
            Some(json) => serde_json::from_str(&json).map_err(|_| invalid())?,
            None => WorktreeSetupInput::default(),
        }
    };
    crate::gitworkspaces::setup::validate(&input).map_err(|_| invalid())?;
    Ok(WorktreeSetup {
        source: command.source,
        input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn setup_settings_are_shared_by_folder_but_isolated_by_device_and_project() {
        let db = super::super::test_support::TestDb::new();
        let chat = db.chat("/workspace");
        let other = db.chat("/other");
        let input = WorktreeSetupInput {
            files: vec![".env".into()],
            command: Some(aura_protocol::worktree_setup::SetupCommand {
                program: "node".into(),
                args: vec!["install.js".into()],
            }),
        };
        let request = |chat_id: &str, source: &str, save| Command {
            chat_id: chat_id.into(),
            source: source.into(),
            save,
            folder_id: None,
        };
        execute(
            db.conn(),
            "dev",
            1,
            request(&chat, "/workspace", Some(input.clone())),
        )
        .unwrap();
        let second = db.chat("/workspace");
        assert_eq!(
            execute(db.conn(), "dev", 2, request(&second, "/workspace", None))
                .unwrap()
                .input,
            input
        );
        assert!(execute(db.conn(), "dev", 2, request(&other, "/workspace", None)).is_err());
        let folder: String = db
            .conn()
            .query_row("SELECT folder_id FROM chats WHERE id=?1", [&chat], |row| {
                row.get(0)
            })
            .unwrap();
        // A chat that does not exist yet reads its source folder's recipe by folder ID only.
        let by_folder = |source: &str, save| Command {
            chat_id: String::new(),
            source: source.into(),
            save,
            folder_id: Some(folder.clone()),
        };
        assert_eq!(
            execute(db.conn(), "dev", 2, by_folder("/workspace", None))
                .unwrap()
                .input,
            input
        );
        assert!(execute(db.conn(), "dev", 2, by_folder("/other", None)).is_err());
        assert!(
            execute(
                db.conn(),
                "dev",
                2,
                by_folder("/workspace", Some(WorktreeSetupInput::default()))
            )
            .is_err()
        );
        db.conn().execute("INSERT INTO folder_locations(folder_id,device_id,path) VALUES (?1,'second','/workspace')",[folder]).unwrap();
        assert_eq!(
            execute(db.conn(), "second", 2, request(&chat, "/workspace", None))
                .unwrap()
                .input,
            WorktreeSetupInput::default()
        );
        assert_eq!(
            db.conn()
                .query_row("SELECT count(*) FROM worktree_setup", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
