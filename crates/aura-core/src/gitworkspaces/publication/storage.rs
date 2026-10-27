use super::*;
use crate::gitworkspaces::records::Backend;
#[derive(Serialize, Deserialize)]
struct Journal {
    version: u32,
    records: Vec<Record>,
}

#[cfg(all(test, feature = "account-sync"))]
mod tests {
    use super::*;
    use crate::profile::{Profile, ProfileKind, ProfileMeta};
    use aura_process::{EnvResolver, EnvSource, LeftoverRegistry, ResolvedEnv};
    use std::sync::Arc;
    #[test]
    fn account_publication_recovery_is_encrypted_and_legacy_plaintext_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profile {
            meta: ProfileMeta {
                id: "account-profile".into(),
                kind: ProfileKind::Account,
                display_name: "Account".into(),
                created_at: 0,
            },
            dir: temp.path().into(),
        };
        let env = EnvResolver::fixed(ResolvedEnv {
            vars: Default::default(),
            source: EnvSource::Fallback {
                reason: "fixture".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        });
        let key = Arc::new(
            aura_sync::crypto::AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "account-profile")
                .unwrap(),
        );
        let service = GitWorkspaces::new_account(
            &profile,
            env.clone(),
            LeftoverRegistry::disabled(),
            key.clone(),
        )
        .unwrap();
        let record = Record {
            id: crate::ids::new_id(),
            folder_id: "private-folder".into(),
            path: temp
                .path()
                .join("private-work")
                .to_string_lossy()
                .into_owned(),
            common: temp
                .path()
                .join("private-work/.git")
                .to_string_lossy()
                .into_owned(),
            repository: "fixture/private-project".into(),
            branch: "main".into(),
            head: "a".repeat(40),
            repository_id: Some(17),
            phase: Phase::Pushing,
        };
        service.save_publication(&mut Vec::new(), &record).unwrap();
        let reopened = GitWorkspaces::new_account(
            &profile,
            env.clone(),
            LeftoverRegistry::disabled(),
            key.clone(),
        )
        .unwrap();
        assert_eq!(reopened.read_publications().unwrap(), vec![record]);
        assert!(!profile.dir.join("worktrees/publications.json").exists());
        for item in std::fs::read_dir(profile.dir.join("metadata")).unwrap() {
            let bytes = std::fs::read(item.unwrap().path()).unwrap();
            assert!(!bytes.windows(7).any(|part| part == b"private"));
        }
        std::fs::create_dir_all(profile.dir.join("worktrees")).unwrap();
        std::fs::write(profile.dir.join("worktrees/publications.json"), b"retained").unwrap();
        assert!(
            GitWorkspaces::new_account(&profile, env, LeftoverRegistry::disabled(), key).is_err()
        );
        assert_eq!(
            std::fs::read(profile.dir.join("worktrees/publications.json")).unwrap(),
            b"retained"
        );
    }
}
impl GitWorkspaces {
    pub(super) fn read_publications(&self) -> Result<Vec<Record>> {
        let bytes = match &self.publication_records {
            Backend::Locked => {
                return Err(invalid(
                    "Unlock this profile before reading publication recovery.",
                ));
            }
            #[cfg(feature = "account-sync")]
            Backend::Encrypted(file) => file.read()?,
            Backend::Local => {
                let path = self.root.join("publications.json");
                match std::fs::symlink_metadata(&path) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => return Err(error.into()),
                    Ok(meta)
                        if !meta.is_file()
                            || meta.file_type().is_symlink()
                            || meta.len() > 1024 * 1024 =>
                    {
                        return Err(invalid(
                            "Publication recovery has an unsupported format. Existing records were preserved.",
                        ));
                    }
                    Ok(_) => Some(std::fs::read(path)?),
                }
            }
        };
        let Some(bytes) = bytes else {
            return Ok(Vec::new());
        };
        let journal:Journal=serde_json::from_slice(&bytes).map_err(|_|invalid("Publication recovery is unreadable or belongs to a newer app. Existing records were preserved."))?;
        if journal.version != 1 || journal.records.len() > 256 {
            return Err(invalid(
                "Publication recovery has an unsupported version or size.",
            ));
        }
        let mut folders = std::collections::HashSet::new();
        for record in &journal.records {
            let (owner, name) = record
                .repository
                .split_once('/')
                .ok_or_else(|| invalid("A saved publication target is invalid."))?;
            validate_owner(owner)?;
            validate_name(name, 100)?;
            if !folders.insert(&record.folder_id)
                || uuid::Uuid::parse_str(&record.id).is_err()
                || !oid(&record.head)
                || record.folder_id.is_empty()
                || record.folder_id.len() > 128
                || record.path.len() > 32768
                || !Path::new(&record.path).is_absolute()
                || record.branch.is_empty()
                || record.branch.len() > 1024
                || record.branch.chars().any(char::is_control)
            {
                return Err(invalid("A saved publication identity is invalid."));
            }
        }
        Ok(journal.records)
    }
    pub(super) fn save_publication(
        &self,
        records: &mut Vec<Record>,
        record: &Record,
    ) -> Result<()> {
        if let Some(previous) = records
            .iter_mut()
            .find(|entry| entry.folder_id == record.folder_id)
        {
            *previous = record.clone();
        } else {
            records.push(record.clone());
        }
        let journal = Journal {
            version: 1,
            records: records.clone(),
        };
        let bytes = serde_json::to_vec(&journal)
            .map_err(|_| invalid("Publication recovery could not be encoded."))?;
        if bytes.len() > 1024 * 1024 || records.len() > 256 {
            return Err(invalid("Publication recovery exceeds its limit."));
        }
        match &self.publication_records {
            Backend::Locked => return Err(invalid("Unlock this profile before publication.")),
            #[cfg(feature = "account-sync")]
            Backend::Encrypted(file) => file.write(&bytes)?,
            Backend::Local => {
                crate::fsutil::write_json_atomic(&self.root.join("publications.json"), &journal)?
            }
        }
        Ok(())
    }
}
