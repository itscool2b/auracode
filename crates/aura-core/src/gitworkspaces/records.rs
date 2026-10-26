use aura_protocol::git::{ManagedWorktree, WorktreeState};
use serde::{Deserialize, Serialize};

use super::*;

#[derive(Serialize, Deserialize)]
struct Records {
    version: u32,
    entries: Vec<ManagedWorktree>,
}

impl GitWorkspaces {
    pub(super) fn read_records(&self) -> Result<Vec<ManagedWorktree>> {
        let path = self.root.join("registry.json");
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>8*1024*1024=>return Err(GitError::Message("The worktree registry has an unsupported layout or size. Its contents were retained.".into())),
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Vec::new()),
            Err(error)=>return Err(error.into()),
            _=>{},
        }
        let bytes = std::fs::read(&path)?;
        let records:Records=serde_json::from_slice(&bytes).map_err(|_|GitError::Message("The worktree registry is damaged. Its contents were retained; use Git to inspect existing worktrees.".into()))?;
        if records.version != 1 {
            return Err(GitError::Message(
                "This worktree registry belongs to a newer app version.".into(),
            ));
        }
        if records.entries.len() > 5000 {
            return Err(GitError::Message(
                "This profile exceeds the worktree registry limit.".into(),
            ));
        }
        Ok(records.entries)
    }

    pub(super) fn write_records(&self, entries: Vec<ManagedWorktree>) -> Result<()> {
        crate::fsutil::write_json_atomic(
            &self.root.join("registry.json"),
            &Records {
                version: 1,
                entries,
            },
        )?;
        Ok(())
    }

    pub async fn list(&self, chat_id: &str) -> Result<Vec<ManagedWorktree>> {
        let _guard = self.gate.lock().await;
        let mut records = self.read_records()?;
        records.retain(|record| record.chat_id == chat_id);
        for record in &mut records {
            if record.state == WorktreeState::Ready && !Path::new(&record.path).try_exists()? {
                record.state = WorktreeState::Missing;
                record.detail=Some("This worktree was removed outside the app. Its branch and conversation remain available.".into());
            }
        }
        Ok(records)
    }
}
