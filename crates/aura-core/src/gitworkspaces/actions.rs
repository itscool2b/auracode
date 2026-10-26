//! Confirmed merge and recoverable retirement of app-owned worktrees only.

use std::fs::OpenOptions;
use std::time::Duration;

use aura_protocol::git::{
    ManagedWorktree, WorktreeAction, WorktreeActionPreview, WorktreeActionResult, WorktreeState,
};

use super::{
    git::{args, oid, path_argument, text},
    inspect::{Inspection, inspect},
    *,
};

pub(super) struct PreparedAction {
    record: ManagedWorktree,
    action: WorktreeAction,
    work: Inspection,
    target: Option<Inspection>,
    tree: Option<String>,
    conflicts: Vec<String>,
    expires: Instant,
}

fn invalid(message: &str) -> GitError {
    GitError::Message(message.into())
}

impl GitWorkspaces {
    pub async fn action_preview(
        &self,
        chat_id: &str,
        id: &str,
        action: WorktreeAction,
    ) -> Result<WorktreeActionPreview> {
        let _guard = self.gate.lock().await;
        let record = self.owned_record(chat_id, id)?;
        let git = self.git().await?;
        let work = inspect(&git, Path::new(&record.path)).await?;
        if work.view.branch.as_deref() != Some(&record.branch) || !work.view.blockers.is_empty() {
            return Err(invalid(
                "This worktree changed branch or has a Git operation in progress. Resolve it before continuing.",
            ));
        }
        let (target,tree,conflicts,changes,warnings)=match &action {
            WorktreeAction::Merge {message}=>{
                if message.trim().is_empty()||message.len()>4096||message.contains('\0') {return Err(invalid("Enter a merge message under 4 KiB."));}
                if !work.view.files.is_empty() {return Err(invalid("Commit the isolated worktree's changes before merging. The app will not stage or stash them."));}
                let target=inspect(&git,Path::new(&record.source)).await?;
                if target.common!=work.common||target.root==work.root {return Err(invalid("The source and worktree no longer belong to the expected repository."));}
                if !target.view.files.is_empty()||!target.view.blockers.is_empty() {return Err(invalid("The target folder must have a clean index and working tree before merge."));}
                let target_head=target.view.head.as_deref().ok_or_else(||invalid("The target commit is unavailable."))?;
                let work_head=work.view.head.as_deref().ok_or_else(||invalid("The worktree commit is unavailable."))?;
                let output=git.output(&target.root,args(&["merge-tree","--write-tree","--name-only","-z",target_head,work_head]),1024*1024).await?;
                let code=output.exit.as_ref().and_then(|exit|exit.code);
                if !matches!(code,Some(0|1)) {return Err(invalid("Git could not prepare this merge. Git 2.38 or newer with merge-tree support is required."));}
                let (tree,conflicts)=merge_output(&output.stdout,code==Some(1))?;
                let changes=text(&git.run(&target.root,args(&["diff","--stat","--no-ext-diff","--no-textconv",target_head,&tree,"--"]),64*1024).await?)?;
                let mut warnings=vec!["Merge updates the reviewed target branch and files. The isolated branch remains available.".into()];
                if !conflicts.is_empty() {warnings.push("Conflicts were detected without modifying either working tree. Resolve them on the isolated branch before merging.".into());}
                (Some(target),Some(tree),conflicts,changes,warnings)
            },
            WorktreeAction::Discard=>(None,None,Vec::new(),format!("{} changed or untracked paths remain in the retained directory.",work.view.files.len()),vec!["Discard retires this owned worktree to a recoverable app-data directory. Its branch, ignored files and uncommitted work are retained.".into()]),
        };
        let token = crate::ids::new_id();
        let expires = Instant::now() + Duration::from_secs(600);
        let preview = WorktreeActionPreview {
            token: token.clone(),
            worktree: record.clone(),
            action: action.clone(),
            target: target.as_ref().map(|target| target.view.clone()),
            changes,
            conflicts: conflicts.clone(),
            warnings,
            expires_at: crate::time::now_millis() + 600_000,
        };
        let mut actions = self
            .actions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        actions.retain(|_, prepared| prepared.expires > Instant::now());
        if actions.len() >= 32 {
            return Err(invalid("Too many worktree action previews are open."));
        }
        actions.insert(
            token,
            PreparedAction {
                record,
                action,
                work,
                target,
                tree,
                conflicts,
                expires,
            },
        );
        Ok(preview)
    }

    /// The session manager must hold both folder reservations for the duration of this operation,
    /// including paused, queued, starting and retiring agents. This method is not direct UI IPC.
    pub async fn action_apply(&self, chat_id: &str, token: &str) -> Result<WorktreeActionResult> {
        let _guard = self.gate.lock().await;
        let prepared = self
            .actions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .ok_or_else(|| invalid("This action preview expired or was already used."))?;
        if prepared.expires <= Instant::now() || prepared.record.chat_id != chat_id {
            return Err(invalid(
                "This action preview no longer belongs to this chat.",
            ));
        }
        if !prepared.conflicts.is_empty() {
            return Err(invalid(
                "Resolve the previewed conflicts before merging. Neither working tree was changed.",
            ));
        }
        let current = self.owned_record(chat_id, &prepared.record.id)?;
        if current != prepared.record {
            return Err(invalid(
                "The saved worktree changed after preview. Review it again.",
            ));
        }
        let git = self.git().await?;
        let work = inspect(&git, Path::new(&current.path)).await?;
        if work.fingerprint != prepared.work.fingerprint
            || work.common != prepared.work.common
            || !work.view.blockers.is_empty()
        {
            return Err(invalid(
                "The isolated worktree changed after preview. Review it again.",
            ));
        }
        if let Some(target) = &prepared.target {
            let current_target = inspect(&git, &target.root).await?;
            if current_target.fingerprint != target.fingerprint
                || current_target.common != target.common
                || !current_target.view.blockers.is_empty()
            {
                return Err(invalid(
                    "The merge target changed after preview. Review it again.",
                ));
            }
        }
        match prepared.action {
            WorktreeAction::Merge { message } => {
                self.merge(
                    &git,
                    prepared.record,
                    work,
                    prepared
                        .target
                        .ok_or_else(|| invalid("The merge target is missing."))?,
                    prepared
                        .tree
                        .ok_or_else(|| invalid("The merge tree is missing."))?,
                    message,
                )
                .await
            }
            WorktreeAction::Discard => self.retire(&git, prepared.record).await,
        }
    }

    fn owned_record(&self, chat_id: &str, id: &str) -> Result<ManagedWorktree> {
        let record = self
            .read_records()?
            .into_iter()
            .find(|record| record.id == id && record.chat_id == chat_id)
            .ok_or_else(|| invalid("This chat does not own that worktree."))?;
        if record.state != WorktreeState::Ready {
            return Err(invalid(
                "This worktree requires recovery before another action.",
            ));
        }
        let identifier = uuid::Uuid::parse_str(&record.id)
            .map_err(|_| invalid("The owned worktree identifier is invalid."))?
            .to_string();
        let leaf = identifier
            .rsplit('-')
            .next()
            .ok_or_else(|| invalid("The worktree identifier is invalid."))?;
        let expected = self.root.canonicalize()?.join(leaf);
        let path = Path::new(&record.path);
        let metadata = std::fs::symlink_metadata(path)?;
        #[cfg(windows)]
        let linked = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let linked = metadata.file_type().is_symlink();
        if linked || !metadata.is_dir() || path.canonicalize()? != expected {
            return Err(invalid(
                "The worktree path no longer matches its app-owned directory. No action was taken.",
            ));
        }
        Ok(record)
    }

    fn save_record(&self, record: &ManagedWorktree) -> Result<()> {
        let mut entries = self.read_records()?;
        let existing = entries
            .iter_mut()
            .find(|entry| entry.id == record.id)
            .ok_or_else(|| invalid("The worktree ownership record is missing."))?;
        *existing = record.clone();
        self.write_records(entries)
    }

    async fn retire(
        &self,
        git: &git::Git,
        mut record: ManagedWorktree,
    ) -> Result<WorktreeActionResult> {
        let retired = self.root.join("retired");
        crate::fsutil::ensure_private_dir(&retired)?;
        let retired = retired.canonicalize()?;
        if retired.parent() != Some(self.root.canonicalize()?.as_path()) {
            return Err(invalid("The recovery directory is outside app ownership."));
        }
        let destination = path_argument(&retired.join(&record.id));
        if destination.try_exists()? {
            return Err(invalid(
                "The recovery path is already occupied. No files were moved.",
            ));
        }
        record.state = WorktreeState::Retiring;
        record.detail = Some(format!(
            "Recoverable retirement to {} is in progress.",
            destination.display()
        ));
        self.save_record(&record)?;
        let source = Path::new(&record.source);
        let outcome = async {
            git.run(
                source,
                vec![
                    "worktree".into(),
                    "unlock".into(),
                    record.path.clone().into(),
                ],
                8192,
            )
            .await?;
            git.run(
                source,
                vec![
                    "worktree".into(),
                    "move".into(),
                    "--".into(),
                    record.path.clone().into(),
                    destination.as_os_str().to_owned(),
                ],
                8192,
            )
            .await?;
            git.run(
                source,
                vec![
                    "worktree".into(),
                    "lock".into(),
                    "--reason".into(),
                    format!("auracode retired {}", record.id).into(),
                    "--".into(),
                    destination.as_os_str().to_owned(),
                ],
                8192,
            )
            .await?;
            Ok::<_, GitError>(())
        }
        .await;
        let error = outcome.err().map(|error| error.to_string());
        if error.is_none() {
            record.path = destination.to_string_lossy().into_owned();
            record.state = WorktreeState::Retired;
            record.detail =
                Some("Retired with all files and the branch retained for recovery.".into());
        } else {
            record.state = WorktreeState::RecoveryRequired;
            record.detail = error.clone();
        }
        self.save_record(&record)?;
        Ok(WorktreeActionResult {
            worktree: record,
            recovery: destination.to_string_lossy().into_owned(),
            commit: None,
            error,
        })
    }

    async fn merge(
        &self,
        git: &git::Git,
        mut record: ManagedWorktree,
        work: Inspection,
        target: Inspection,
        tree: String,
        message: String,
    ) -> Result<WorktreeActionResult> {
        let old = target
            .view
            .head
            .as_deref()
            .ok_or_else(|| invalid("The target commit is missing."))?;
        let branch = target
            .view
            .branch
            .as_deref()
            .ok_or_else(|| invalid("The target branch is missing."))?;
        let incoming = work
            .view
            .head
            .as_deref()
            .ok_or_else(|| invalid("The worktree commit is missing."))?;
        let commit = text(
            &git.run(
                &target.root,
                vec![
                    "commit-tree".into(),
                    tree.into(),
                    "-p".into(),
                    old.into(),
                    "-p".into(),
                    incoming.into(),
                    "-m".into(),
                    message.into(),
                ],
                128,
            )
            .await?,
        )?;
        if !oid(&commit) {
            return Err(invalid("Git returned an invalid merge commit."));
        }
        let recovery_root = format!("refs/aura/recovery/{}", crate::ids::new_id());
        let recovery = format!("{recovery_root}/before");
        let prepared_ref = format!("{recovery_root}/prepared");
        git.run(
            &target.root,
            vec![
                "update-ref".into(),
                recovery.clone().into(),
                old.into(),
                "".into(),
            ],
            8192,
        )
        .await?;
        git.run(
            &target.root,
            vec![
                "update-ref".into(),
                prepared_ref.clone().into(),
                commit.clone().into(),
                "".into(),
            ],
            8192,
        )
        .await?;
        record.state = WorktreeState::Merging;
        record.detail = Some(format!(
            "Merge to {branch} is in progress. Previous target: {recovery}. Prepared commit: {prepared_ref}."
        ));
        self.save_record(&record)?;
        // A held HEAD lock blocks normal branch switching while read-tree updates the clean
        // target. The index's own lock and read-tree's two-tree safety checks protect edits.
        let head_lock = target.git_dir.join("HEAD.lock");
        let outcome = async {
            let guard = HeadLock::acquire(head_lock)?;
            let current = inspect(git, &target.root).await?;
            if current.fingerprint != target.fingerprint {
                return Err(invalid(
                    "The merge target changed before its lock was acquired.",
                ));
            }
            // The read-only preview deliberately left cached index stat data untouched. An
            // explicit merge may refresh it; Git refuses dirty entries without discarding them.
            git.run(&target.root, args(&["update-index", "--refresh"]), 8192)
                .await?;
            git.run(
                &target.root,
                args(&["read-tree", "-u", "-m", old, &commit]),
                8192,
            )
            .await?;
            // Git's ref transaction also locks HEAD when this branch is checked out. Release
            // our checkout guard only after files are applied, then use an expected-old ref
            // update. A concurrent ref change fails and leaves the recovery commit recorded.
            drop(guard);
            git.run(
                &target.root,
                vec![
                    "update-ref".into(),
                    format!("refs/heads/{branch}").into(),
                    commit.clone().into(),
                    old.into(),
                ],
                8192,
            )
            .await?;
            Ok::<_, GitError>(())
        }
        .await;
        let error = outcome.err().map(|error| error.to_string());
        if error.is_none() {
            record.state = WorktreeState::Ready;
            record.detail = Some(format!(
                "Merged into {branch}. Recovery reference: {recovery}."
            ));
        } else {
            record.state = WorktreeState::RecoveryRequired;
            record.detail = Some(format!(
                "Merge requires review. Previous target: {recovery}. Prepared commit: {prepared_ref}."
            ));
        }
        self.save_record(&record)?;
        Ok(WorktreeActionResult {
            worktree: record,
            recovery,
            commit: Some(commit),
            error,
        })
    }
}

struct HeadLock {
    path: PathBuf,
    _file: std::fs::File,
}
impl HeadLock {
    fn acquire(path: PathBuf) -> Result<Self> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| {
                invalid("Another Git operation holds the branch lock. Wait for it to finish.")
            })?;
        Ok(Self { path, _file: file })
    }
}
impl Drop for HeadLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn merge_output(bytes: &[u8], conflicted: bool) -> Result<(String, Vec<String>)> {
    let mut fields = bytes.split(|byte| *byte == 0);
    let tree = std::str::from_utf8(
        fields
            .next()
            .ok_or_else(|| invalid("Git returned no merge tree."))?,
    )
    .map_err(|_| invalid("Git returned an invalid merge tree."))?
    .trim()
    .to_owned();
    if !oid(&tree) {
        return Err(invalid("Git returned an invalid merge tree."));
    }
    let mut conflicts = Vec::new();
    if conflicted {
        for path in fields.take_while(|path| !path.is_empty()) {
            let path = std::str::from_utf8(path)
                .map_err(|_| invalid("A conflict path is not valid UTF-8."))?;
            if path.chars().any(char::is_control) || path.len() > 4096 {
                return Err(invalid("A conflict path cannot be represented safely."));
            }
            conflicts.push(path.into());
            if conflicts.len() > 20_000 {
                return Err(invalid("The merge exceeds the conflict-path limit."));
            }
        }
        if conflicts.is_empty() {
            return Err(invalid(
                "Git reported conflicts without usable paths. Neither working tree was changed.",
            ));
        }
    }
    Ok((tree, conflicts))
}
