//! Byte-preserving checkpoints in a private shadow Git repository. User Git state is never written.

mod git;
mod revert;
mod scan;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aura_process::{EnvResolver, LeftoverRegistry};
use aura_protocol::changes::{
    ChangeDiff, ChangeKind, ChangedFile, ChangesSnapshot, CheckpointSummary,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::profile::Profile;
use scan::{Fingerprint, SavedFile};

pub type Result<T> = std::result::Result<T, CheckpointError>;

#[derive(Debug, thiserror::Error)]
pub enum CheckpointError {
    #[error("{0}")]
    Message(String),
    #[error("Checkpoint file operation failed: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Checkpoints {
    root: PathBuf,
    env: Arc<EnvResolver>,
    registry: Arc<LeftoverRegistry>,
    /// Git refs/index/manifest publication and revert previews serialize for this profile.
    gate: Mutex<()>,
    previews: std::sync::Mutex<std::collections::HashMap<String, revert::Prepared>>,
}

impl std::fmt::Debug for Checkpoints {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Checkpoints")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    chat_id: String,
    folder_id: String,
    root: PathBuf,
    commit: String,
    summary: CheckpointSummary,
    files: BTreeMap<String, SavedFile>,
}

struct Operation {
    scratch: tempfile::TempDir,
    git: git::Git,
    repo: PathBuf,
    index: PathBuf,
}

impl Checkpoints {
    #[cfg(test)]
    pub(crate) async fn hold_for_test(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.gate.lock().await
    }
    pub fn new(
        profile: &Profile,
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
    ) -> Arc<Self> {
        Arc::new(Self {
            root: profile.checkpoints_dir(),
            env,
            registry,
            gate: Mutex::new(()),
            previews: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    /// Saves exact bytes before the native prompt is sent. No user index, filters or hooks run.
    pub async fn capture(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        turn_id: &str,
    ) -> Result<CheckpointSummary> {
        valid_id(chat_id)?;
        valid_id(folder_id)?;
        valid_id(turn_id)?;
        let _guard = self.gate.lock().await;
        let root = std::fs::canonicalize(folder)?;
        if !root.is_dir() {
            return Err(CheckpointError::Message(
                "The checkpoint folder is unavailable.".into(),
            ));
        }
        let operation = self.operation(folder_id, &root, true).await?;
        let paths = self.paths(&operation, &root).await?;
        let copies = operation.scratch.path().join("blobs");
        std::fs::create_dir(&copies)?;
        let root_copy = root.clone();
        let scanned =
            tokio::task::spawn_blocking(move || scan::collect(&root_copy, &paths, Some(&copies)))
                .await
                .map_err(|_| CheckpointError::Message("Checkpoint scanning failed.".into()))??;
        let (files, tree) = Self::write_tree(&operation, &root, &scanned, None).await?;
        let commit = git::oid(
            &operation
                .git
                .run(
                    &operation.repo,
                    &root,
                    &operation.index,
                    vec![
                        "commit-tree".into(),
                        tree.into(),
                        "-m".into(),
                        "auracode before-turn checkpoint".into(),
                    ],
                    128,
                )
                .await?,
        )?;
        let summary = CheckpointSummary {
            id: crate::ids::new_id(),
            turn_id: turn_id.into(),
            created_at: crate::time::now_millis(),
            file_count: files.len() as u32,
            total_bytes: files.values().map(|file| file.fingerprint.bytes).sum(),
            warnings: scanned.warnings,
        };
        let reference = format!("refs/aura/{chat_id}/{}", summary.id);
        operation
            .git
            .run(
                &operation.repo,
                &root,
                &operation.index,
                vec!["update-ref".into(), reference.into(), commit.clone().into()],
                4096,
            )
            .await?;
        let manifest = Manifest {
            version: 1,
            chat_id: chat_id.into(),
            folder_id: folder_id.into(),
            root,
            commit,
            summary: summary.clone(),
            files,
        };
        let directory = operation.repo.join("auracode");
        std::fs::create_dir_all(&directory)?;
        crate::fsutil::write_json_atomic(
            &directory.join(format!("{}.json", summary.id)),
            &manifest,
        )
        .map_err(|error| CheckpointError::Message(error.to_string()))?;
        Ok(summary)
    }

    async fn write_tree(
        operation: &Operation,
        root: &Path,
        scanned: &scan::Scan,
        retained: Option<&BTreeMap<String, SavedFile>>,
    ) -> Result<(BTreeMap<String, SavedFile>, String)> {
        let mut files = retained.cloned().unwrap_or_default();
        // Batches keep Windows' command line below its limit. Paths with long names are allowed,
        // so index updates are chunked by their actual argument length below.
        for chunk in scanned.copies.chunks(64) {
            let mut args = vec![
                "hash-object".into(),
                "--no-filters".into(),
                "-w".into(),
                "--".into(),
            ];
            args.extend(chunk.iter().map(|(_, path)| path.as_os_str().to_owned()));
            let output = operation
                .git
                .run(&operation.repo, root, &operation.index, args, 64 * 42)
                .await?;
            let ids = output
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
                .map(git::oid)
                .collect::<Result<Vec<_>>>()?;
            if ids.len() != chunk.len() {
                return Err(CheckpointError::Message(
                    "Git did not save every checkpoint file.".into(),
                ));
            }
            for ((path, _), oid) in chunk.iter().zip(ids) {
                let fingerprint = scanned
                    .files
                    .get(path)
                    .ok_or_else(|| {
                        CheckpointError::Message("Checkpoint file metadata was lost.".into())
                    })?
                    .clone();
                files.insert(path.clone(), SavedFile { fingerprint, oid });
            }
        }
        let mut args = vec!["update-index".into(), "--add".into()];
        let mut arg_bytes = 0;
        for (path, file) in &files {
            let entry = format!("{:o},{},{}", file.fingerprint.mode, file.oid, path);
            if arg_bytes + entry.len() > 12_000 && args.len() > 2 {
                operation
                    .git
                    .run(
                        &operation.repo,
                        root,
                        &operation.index,
                        std::mem::replace(&mut args, vec!["update-index".into(), "--add".into()]),
                        4096,
                    )
                    .await?;
                arg_bytes = 0;
            }
            arg_bytes += entry.len() + 16;
            args.extend(["--cacheinfo".into(), entry.into()]);
        }
        if args.len() > 2 {
            operation
                .git
                .run(&operation.repo, root, &operation.index, args, 4096)
                .await?;
        }
        let tree = git::oid(
            &operation
                .git
                .run(
                    &operation.repo,
                    root,
                    &operation.index,
                    vec!["write-tree".into()],
                    128,
                )
                .await?,
        )?;
        Ok((files, tree))
    }

    /// Computes Git's real stat against the saved checkpoint using only private object trees.
    /// No user index, repository filters, external diff command or credential file is consulted.
    pub async fn diff_stat(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        checkpoint_id: &str,
    ) -> Result<String> {
        let _guard = self.gate.lock().await;
        let manifest = self.load(chat_id, folder_id, folder, checkpoint_id)?;
        let operation = self.operation(folder_id, &manifest.root, false).await?;
        let copies = operation.scratch.path().join("stat-blobs");
        std::fs::create_dir(&copies)?;
        let current = self
            .current_scan(&operation, &manifest, Some(copies))
            .await?;
        let retained = manifest
            .files
            .iter()
            .filter(|(path, _)| current.excluded.contains(*path))
            .map(|(path, file)| (path.clone(), file.clone()))
            .collect();
        let (_, tree) =
            Self::write_tree(&operation, &manifest.root, &current, Some(&retained)).await?;
        let bytes = operation
            .git
            .run(
                &operation.repo,
                &manifest.root,
                &operation.index,
                vec![
                    "diff-tree".into(),
                    "--stat".into(),
                    "--no-ext-diff".into(),
                    "--no-textconv".into(),
                    "--no-renames".into(),
                    "--no-commit-id".into(),
                    "-r".into(),
                    manifest.commit.into(),
                    tree.into(),
                ],
                16 * 1024,
            )
            .await?;
        Ok(String::from_utf8_lossy(&bytes).trim().to_owned())
    }

    pub async fn changes(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        checkpoint_id: &str,
    ) -> Result<ChangesSnapshot> {
        let _guard = self.gate.lock().await;
        let manifest = self.load(chat_id, folder_id, folder, checkpoint_id)?;
        let operation = self.operation(folder_id, &manifest.root, false).await?;
        let current = self.current(&operation, &manifest).await?;
        let files = changes(&manifest.files, &current.files)
            .into_iter()
            .filter(|file| !current.excluded.contains(&file.path))
            .collect();
        let mut summary = manifest.summary;
        summary.warnings.extend(current.warnings);
        Ok(ChangesSnapshot {
            checkpoint: Some(summary),
            files,
            unavailable_reason: None,
        })
    }

    pub async fn diff(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        checkpoint_id: &str,
        path: &str,
    ) -> Result<ChangeDiff> {
        scan::validate(path)?;
        let _guard = self.gate.lock().await;
        let manifest = self.load(chat_id, folder_id, folder, checkpoint_id)?;
        let operation = self.operation(folder_id, &manifest.root, false).await?;
        let current = self.current(&operation, &manifest).await?;
        if current.excluded.contains(path)
            || (!manifest.files.contains_key(path) && !current.files.contains_key(path))
        {
            return Err(CheckpointError::Message(
                "This file is outside the checkpoint's reviewable files.".into(),
            ));
        }
        let before = match manifest.files.get(path) {
            Some(file) => Some(self.blob(&operation, &manifest.root, file).await?),
            None => None,
        };
        let root = manifest.root.clone();
        let relative = path.to_owned();
        let after = tokio::task::spawn_blocking(move || scan::read(&root, &relative))
            .await
            .map_err(|_| CheckpointError::Message("Reading the changed file failed.".into()))??
            .map(|(_, bytes)| bytes);
        let binary = before
            .as_ref()
            .into_iter()
            .chain(after.as_ref())
            .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err());
        let truncated = before
            .as_ref()
            .into_iter()
            .chain(after.as_ref())
            .any(|bytes| bytes.len() > 128 * 1024);
        let text = |bytes: Option<Vec<u8>>| -> Option<String> {
            if binary {
                return None;
            }
            bytes.map(|bytes| {
                let mut value = String::from_utf8_lossy(&bytes).into_owned();
                let mut end = value.len().min(128 * 1024);
                while !value.is_char_boundary(end) {
                    end -= 1;
                }
                value.truncate(end);
                value
            })
        };
        Ok(ChangeDiff {
            path: path.into(),
            before: text(before),
            after: text(after),
            binary,
            truncated,
        })
    }

    async fn operation(&self, folder_id: &str, folder: &Path, create: bool) -> Result<Operation> {
        valid_id(folder_id)?;
        std::fs::create_dir_all(&self.root)?;
        let scratch = tempfile::Builder::new()
            .prefix("operation-")
            .tempdir_in(&self.root)?;
        let git = git::Git::new(&self.env, Arc::clone(&self.registry), scratch.path()).await?;
        let repo = self.root.join(format!("{folder_id}.git"));
        if !repo.exists() {
            if !create {
                return Err(CheckpointError::Message(
                    "This checkpoint repository is missing.".into(),
                ));
            }
            git.init(&repo, folder).await?;
        }
        let index = scratch.path().join("index");
        Ok(Operation {
            scratch,
            git,
            repo,
            index,
        })
    }

    async fn paths(&self, operation: &Operation, root: &Path) -> Result<Vec<String>> {
        let mut args = vec![
            "ls-files".into(),
            "--others".into(),
            "--exclude-standard".into(),
            "--exclude=.auracode-revert-*".into(),
            "--exclude=.claude".into(),
            "--exclude=.codex".into(),
            "--exclude=.pi".into(),
            "--exclude=.omp".into(),
            "--exclude=.grok".into(),
            "--exclude=.hermes".into(),
            "--exclude=.ssh".into(),
            "--exclude=.gnupg".into(),
            "--exclude=.aws".into(),
            "--exclude=.azure".into(),
            "--exclude=keychains".into(),
            "--exclude=credentials".into(),
            "--exclude=credentials.json".into(),
            "--exclude=auth.json".into(),
            "--exclude=auth.toml".into(),
            "--exclude=.npmrc".into(),
            "--exclude=.netrc".into(),
            "--exclude=id_rsa".into(),
            "--exclude=id_ed25519".into(),
            "--exclude=.env".into(),
            "--exclude=.env.*".into(),
            "--exclude=*.key".into(),
            "--exclude=*.pem".into(),
            "--exclude=*.p12".into(),
            "--exclude=*.keychain-db".into(),
            "-z".into(),
        ];
        for protected in self.protected_paths(operation, root)? {
            if let Ok(relative) = protected.strip_prefix(root) {
                let relative = relative.to_string_lossy().replace('\\', "/");
                // Git exclude patterns quote metacharacters from the actual directory name.
                let escaped = relative
                    .replace('\\', "\\\\")
                    .replace('*', "\\*")
                    .replace('?', "\\?")
                    .replace('[', "\\[");
                args.push(format!("--exclude=/{escaped}").into());
            }
        }
        let bytes = operation
            .git
            .run(
                &operation.repo,
                root,
                &operation.index,
                args,
                8 * 1024 * 1024,
            )
            .await?;
        scan::paths(&bytes)
    }

    fn protected_paths(&self, operation: &Operation, root: &Path) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();
        for protected in operation
            .git
            .protected
            .iter()
            .map(PathBuf::as_path)
            .chain(self.root.parent())
        {
            let protected = if protected.is_absolute() {
                protected.to_path_buf()
            } else {
                root.join(protected)
            };
            let protected = std::fs::canonicalize(&protected).unwrap_or(protected);
            if root.starts_with(&protected) {
                return Err(CheckpointError::Message("Agent configuration and auracode profile folders cannot be checkpoint workspaces.".into()));
            }
            paths.push(protected);
        }
        Ok(paths)
    }

    async fn current(&self, operation: &Operation, manifest: &Manifest) -> Result<scan::Scan> {
        self.current_scan(operation, manifest, None).await
    }

    async fn current_scan(
        &self,
        operation: &Operation,
        manifest: &Manifest,
        copies: Option<PathBuf>,
    ) -> Result<scan::Scan> {
        let mut paths = self.paths(operation, &manifest.root).await?;
        // A newly added ignore rule must not make a previously saved file appear deleted.
        paths.extend(manifest.files.keys().cloned());
        paths.sort();
        paths.dedup();
        let protected = self.protected_paths(operation, &manifest.root)?;
        let mut excluded = std::collections::BTreeSet::new();
        paths.retain(|path| {
            if protected
                .iter()
                .any(|prefix| manifest.root.join(path).starts_with(prefix))
            {
                excluded.insert(path.clone());
                false
            } else {
                true
            }
        });
        let root = manifest.root.clone();
        tokio::task::spawn_blocking(move || {
            let mut current = scan::collect(&root, &paths, copies.as_deref())?;
            current.excluded.extend(excluded);
            Ok(current)
        })
        .await
        .map_err(|_| CheckpointError::Message("Reading changed files failed.".into()))?
    }

    fn load(
        &self,
        chat_id: &str,
        folder_id: &str,
        folder: &Path,
        checkpoint_id: &str,
    ) -> Result<Manifest> {
        valid_id(chat_id)?;
        valid_id(folder_id)?;
        valid_id(checkpoint_id)?;
        let path = self
            .root
            .join(format!("{folder_id}.git/auracode/{checkpoint_id}.json"));
        let file = std::fs::File::open(path)?;
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(CheckpointError::Message(
                "Checkpoint metadata exceeds its limit.".into(),
            ));
        }
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| {
            CheckpointError::Message("This checkpoint metadata is damaged or unsupported.".into())
        })?;
        if manifest.version != 1
            || manifest.chat_id != chat_id
            || manifest.folder_id != folder_id
            || manifest.summary.id != checkpoint_id
            || manifest.root != std::fs::canonicalize(folder)?
        {
            return Err(CheckpointError::Message(
                "This checkpoint belongs to a different chat or folder.".into(),
            ));
        }
        for (path, file) in &manifest.files {
            scan::validate(path)?;
            git::oid(file.oid.as_bytes())?;
        }
        Ok(manifest)
    }

    async fn blob(&self, operation: &Operation, root: &Path, file: &SavedFile) -> Result<Vec<u8>> {
        let bytes = operation
            .git
            .run(
                &operation.repo,
                root,
                &operation.index,
                vec!["cat-file".into(), "blob".into(), file.oid.clone().into()],
                scan::FILE_LIMIT,
            )
            .await?;
        use sha2::{Digest, Sha256};
        if bytes.len() != file.fingerprint.bytes as usize
            || crate::chatstore::rows::hex(&Sha256::digest(&bytes)) != file.fingerprint.sha256
        {
            return Err(CheckpointError::Message(
                "The checkpoint file failed its integrity check.".into(),
            ));
        }
        Ok(bytes)
    }
}

fn valid_id(id: &str) -> Result<()> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(CheckpointError::Message(
            "Invalid checkpoint identity.".into(),
        ));
    }
    Ok(())
}

fn changes(
    before: &BTreeMap<String, SavedFile>,
    after: &BTreeMap<String, Fingerprint>,
) -> Vec<ChangedFile> {
    let mut paths: Vec<_> = before.keys().chain(after.keys()).collect();
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .filter_map(|path| {
            let old = before.get(path).map(|file| &file.fingerprint);
            let new = after.get(path);
            if old == new {
                return None;
            }
            Some(ChangedFile {
                path: path.clone(),
                kind: match (old, new) {
                    (None, _) => ChangeKind::Added,
                    (_, None) => ChangeKind::Deleted,
                    _ => ChangeKind::Modified,
                },
                before_bytes: old.map(|file| file.bytes),
                after_bytes: new.map(|file| file.bytes),
                binary: old.into_iter().chain(new).any(|file| file.binary),
            })
        })
        .collect()
}
