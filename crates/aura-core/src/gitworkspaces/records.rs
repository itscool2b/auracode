use aura_protocol::git::{ManagedWorktree, WorktreeState};
use serde::{Deserialize, Serialize};

use super::*;

#[derive(Serialize, Deserialize)]
struct Records {
    version: u32,
    entries: Vec<ManagedWorktree>,
}

#[cfg(all(test, feature = "account-sync"))]
mod encrypted_tests {
    use super::*;
    use crate::profile::{Profile, ProfileKind, ProfileMeta};
    use aura_process::{EnvSource, ResolvedEnv};
    use aura_protocol::git::WorktreeRecovery;
    use aura_sync::crypto::AccountKey;
    #[test]
    fn encrypted_registry_preserves_recovery_states_and_never_creates_plain_registry() {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profile {
            meta: ProfileMeta {
                id: "profile".into(),
                kind: ProfileKind::Account,
                display_name: "Account".into(),
                created_at: 0,
            },
            dir: temp.path().to_path_buf(),
        };
        let env = EnvResolver::fixed(ResolvedEnv {
            vars: Default::default(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        });
        let locked = GitWorkspaces::new(&profile, env.clone(), LeftoverRegistry::disabled());
        assert!(locked.read_records().is_err());
        assert!(locked.write_records(Vec::new()).is_err());
        let key = Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        );
        let service = GitWorkspaces::new_account(
            &profile,
            env.clone(),
            LeftoverRegistry::disabled(),
            key.clone(),
        )
        .unwrap();
        let mut item = ManagedWorktree {
            id: "entry".into(),
            chat_id: "private-chat".into(),
            source: "private-source".into(),
            path: "private-worktree".into(),
            branch: "private-branch".into(),
            base_commit: "a".repeat(40),
            state: WorktreeState::Ready,
            detail: None,
            recovery: Some(WorktreeRecovery::Create),
            created_at: 1,
        };
        service.write_records(vec![item.clone()]).unwrap();
        item.state = WorktreeState::Retired;
        item.recovery = Some(WorktreeRecovery::Merge {
            branch: "merge-branch".into(),
            before_ref: "refs/private-before".into(),
            prepared_ref: "refs/private-after".into(),
            before_commit: "a".repeat(40),
            prepared_commit: "b".repeat(40),
        });
        service.write_records(vec![item.clone()]).unwrap();
        let reopened = GitWorkspaces::new_account(
            &profile,
            env.clone(),
            LeftoverRegistry::disabled(),
            key.clone(),
        )
        .unwrap();
        assert_eq!(reopened.read_records().unwrap(), vec![item]);
        assert!(!profile.dir.join("worktrees/registry.json").exists());
        for entry in std::fs::read_dir(profile.dir.join("metadata")).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(!bytes.windows(7).any(|part| part == b"private"));
        }
        if let Backend::Encrypted(file) = &service.records {
            file.write(br#"{"version":999,"entries":[]}"#).unwrap();
            assert!(service.read_records().is_err());
        } else {
            panic!("encrypted backend required");
        }
        std::fs::create_dir_all(profile.dir.join("worktrees")).unwrap();
        std::fs::write(profile.dir.join("worktrees/registry.json"), b"legacy").unwrap();
        assert!(
            GitWorkspaces::new_account(&profile, env, LeftoverRegistry::disabled(), key).is_err()
        );
        assert_eq!(
            std::fs::read(profile.dir.join("worktrees/registry.json")).unwrap(),
            b"legacy"
        );
    }
}

pub(super) enum Backend {
    Local,
    Locked,
    #[cfg(feature = "account-sync")]
    Encrypted(crate::profile_files::EncryptedRecord),
}

impl GitWorkspaces {
    /// The registry is scoped to this profile, including entries whose chat save rolled back.
    /// Listing does not require a live repository, so missing sources remain discoverable.
    pub async fn profile_records(&self) -> Result<Vec<ManagedWorktree>> {
        let _guard = self.gate.lock().await;
        let mut records = self.read_records()?;
        for record in &mut records {
            if record.state == WorktreeState::Ready && !Path::new(&record.path).exists() {
                record.state = WorktreeState::Missing;
                record.detail=Some("The retained folder is missing. Its branch and saved ownership remain available for review.".into());
            }
        }
        Ok(records)
    }
    pub async fn profile_record(&self, id: &str) -> Result<ManagedWorktree> {
        let _guard = self.gate.lock().await;
        self.read_records()?
            .into_iter()
            .find(|record| record.id == id)
            .ok_or_else(|| GitError::Message("This profile does not own that worktree.".into()))
    }
    pub async fn profile_record_folder(&self, id: &str) -> Result<PathBuf> {
        let record = self.profile_record(id).await?;
        self.recovery_paths(&record)?;
        // Canonicalize and check the owned parent before opening any renderer-selected ID.
        let path = Path::new(&record.path).canonicalize()?;
        let root = self.root.canonicalize()?;
        if !path.starts_with(root) || !path.is_dir() {
            return Err(GitError::Message(
                "This retained folder is outside the profile's owned worktrees.".into(),
            ));
        }
        Ok(crate::fsutil::plain_windows_path(&path.to_string_lossy())
            .map(PathBuf::from)
            .unwrap_or(path))
    }
    pub(super) fn read_records(&self) -> Result<Vec<ManagedWorktree>> {
        let bytes = match &self.records {
            Backend::Locked => {
                return Err(GitError::Message(
                    "Unlock this account's worktree storage first.".into(),
                ));
            }
            #[cfg(feature = "account-sync")]
            Backend::Encrypted(file) => match file.read()? {
                Some(bytes) => bytes,
                None => return Ok(Vec::new()),
            },
            Backend::Local => {
                let path = self.root.join("registry.json");
                match std::fs::symlink_metadata(&path) {
            Ok(meta) if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>8*1024*1024=>return Err(GitError::Message("The worktree registry has an unsupported layout or size. Its contents were retained.".into())),
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Vec::new()),
            Err(error)=>return Err(error.into()),
            _=>{},
        }
                std::fs::read(&path)?
            }
        };
        let records:Records=serde_json::from_slice(&bytes).map_err(|_|GitError::Message("The worktree registry is damaged. Its contents were retained; use Git to inspect existing worktrees.".into()))?;
        if !(1..=2).contains(&records.version)
            || records
                .entries
                .iter()
                .any(|entry| entry.state == WorktreeState::Unknown)
        {
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
        let record = Records {
            version: 2,
            entries,
        };
        match &self.records {
            Backend::Locked => {
                return Err(GitError::Message(
                    "Unlock this account's worktree storage first.".into(),
                ));
            }
            #[cfg(feature = "account-sync")]
            Backend::Encrypted(file) => {
                let bytes = serde_json::to_vec(&record)
                    .map_err(|_| GitError::Message("Could not encode worktree metadata.".into()))?;
                file.write(&bytes)?;
            }
            Backend::Local => {
                crate::fsutil::write_json_atomic(&self.root.join("registry.json"), &record)?
            }
        }
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
