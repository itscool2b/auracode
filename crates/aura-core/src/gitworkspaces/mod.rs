//! Explicit local worktree lifecycle. No operation calls an agent or infers user confirmation.

mod create;
mod git;
mod inspect;
mod records;
#[cfg(test)]
mod tests;

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
    gate: tokio::sync::Mutex<()>,
    prepared: std::sync::Mutex<HashMap<String, create::Prepared>>,
}

impl GitWorkspaces {
    pub fn new(
        profile: &crate::profile::Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
    ) -> Arc<Self> {
        Arc::new(Self {
            env,
            registry,
            root: profile.dir.join("worktrees"),
            gate: tokio::sync::Mutex::new(()),
            prepared: std::sync::Mutex::new(HashMap::new()),
        })
    }

    async fn git(&self) -> Result<git::Git> {
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
