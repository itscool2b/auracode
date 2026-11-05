//! Explicit local worktree lifecycle. No operation calls an agent or infers user confirmation.

mod actions;
mod commit;
mod create;
mod git;
mod identity;
mod initialize;
mod inspect;
mod instructions;
mod new_chat;
pub(crate) use new_chat::{NewChatPlan, NewChatRequest};
#[cfg(test)]
mod new_chat_tests;
mod publication;
mod publish;
mod records;
mod recovery;
mod recreate;
#[cfg(test)]
mod recreate_tests;
pub(crate) mod setup;
pub(crate) use identity::FolderIdentity;
mod setup_files;
#[cfg(test)]
mod tests;
mod transfer;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use aura_process::{EnvResolver, LeftoverRegistry};
use aura_protocol::git::GitWorkspace;

pub type Result<T> = std::result::Result<T, GitError>;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{0}")]
    Message(String),
    #[error("The workspace metadata could not be read or saved: {0}")]
    Io(#[from] std::io::Error),
    #[error("The workspace record could not be read or saved: {0}")]
    Core(#[from] crate::error::CoreError),
}

pub struct GitWorkspaces {
    env: Arc<EnvResolver>,
    registry: Arc<LeftoverRegistry>,
    root: PathBuf,
    records: records::Backend,
    publication_records: records::Backend,
    gate: tokio::sync::Mutex<()>,
    prepared: std::sync::Mutex<HashMap<String, create::Prepared>>,
    actions: std::sync::Mutex<HashMap<String, actions::PreparedAction>>,
    recoveries: std::sync::Mutex<HashMap<String, recovery::PreparedRecovery>>,
    new_chats: std::sync::Mutex<HashMap<String, new_chat::Prepared>>,
    recreations: std::sync::Mutex<HashMap<String, recreate::Prepared>>,
    pull_requests: std::sync::Mutex<HashMap<String, publish::PreparedPullRequest>>,
    setups: std::sync::Mutex<HashMap<String, setup::Prepared>>,
    initializations: std::sync::Mutex<HashMap<String, initialize::Prepared>>,
    publications: std::sync::Mutex<HashMap<String, publication::Prepared>>,
    commits: std::sync::Mutex<HashMap<String, commit::PreparedCommit>>,
    pushes: std::sync::Mutex<HashMap<String, commit::PreparedPush>>,
}

impl GitWorkspaces {
    pub fn new(
        profile: &crate::profile::Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
    ) -> Arc<Self> {
        let backend = if profile.meta.kind == crate::profile::ProfileKind::Account {
            records::Backend::Locked
        } else {
            records::Backend::Local
        };
        let publications = if profile.meta.kind == crate::profile::ProfileKind::Account {
            records::Backend::Locked
        } else {
            records::Backend::Local
        };
        Self::with_records(profile, env, registry, backend, publications)
    }

    #[cfg(feature = "account-sync")]
    pub fn new_account(
        profile: &crate::profile::Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
        key: Arc<aura_sync::crypto::files::ProfileFileKey>,
    ) -> Result<Arc<Self>> {
        if profile.meta.kind != crate::profile::ProfileKind::Account {
            return Err(GitError::Message(
                "An account worktree key requires an Account profile.".into(),
            ));
        }
        for name in ["registry.json", "publications.json"] {
            let legacy = profile.worktrees_dir().join(name);
            match std::fs::symlink_metadata(&legacy) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => return Err(error.into()),
                Ok(_) => return Err(GitError::Message(
                    "Existing worktree metadata needs an explicit encrypted import. It was left unchanged.".into()
                )),
            }
        }
        let file = crate::profile_files::EncryptedRecord::open(
            &profile.dir.join("metadata"),
            "worktree-registry",
            8 * 1024 * 1024,
            key.clone(),
        )?;
        let publications = crate::profile_files::EncryptedRecord::open(
            &profile.dir.join("metadata"),
            "repository-publications",
            1024 * 1024,
            key,
        )?;
        Ok(Self::with_records(
            profile,
            env,
            registry,
            records::Backend::Encrypted(file),
            records::Backend::Encrypted(publications),
        ))
    }

    fn with_records(
        profile: &crate::profile::Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
        records: records::Backend,
        publication_records: records::Backend,
    ) -> Arc<Self> {
        Arc::new(Self {
            env,
            registry,
            root: profile.worktrees_dir(),
            records,
            publication_records,
            gate: tokio::sync::Mutex::new(()),
            prepared: std::sync::Mutex::new(HashMap::new()),
            actions: std::sync::Mutex::new(HashMap::new()),
            recoveries: std::sync::Mutex::new(HashMap::new()),
            new_chats: std::sync::Mutex::new(HashMap::new()),
            recreations: std::sync::Mutex::new(HashMap::new()),
            pull_requests: std::sync::Mutex::new(HashMap::new()),
            setups: std::sync::Mutex::new(HashMap::new()),
            initializations: std::sync::Mutex::new(HashMap::new()),
            publications: std::sync::Mutex::new(HashMap::new()),
            commits: std::sync::Mutex::new(HashMap::new()),
            pushes: std::sync::Mutex::new(HashMap::new()),
        })
    }

    async fn git(&self) -> Result<git::Git> {
        if matches!(self.records, records::Backend::Locked) {
            return Err(GitError::Message(
                "Unlock this account's worktree storage first.".into(),
            ));
        }
        crate::fsutil::ensure_private_dir(&self.root)?;
        let hooks = self.root.join("empty-hooks");
        crate::fsutil::ensure_private_dir(&hooks)?;
        if std::fs::read_dir(&hooks)?.next().is_some() {
            return Err(GitError::Message("The app's empty Git hook directory contains unexpected files. Worktree operations are unavailable until it is reviewed.".into()));
        }
        git::Git::new(&self.env, Arc::clone(&self.registry), hooks).await
    }

    pub async fn inspect(&self, folder: &Path) -> Result<GitWorkspace> {
        Ok(inspect::inspect(&self.git().await?, folder).await?.view)
    }
}
