use aura_protocol::git::{
    IsolationInput, IsolationPreview, IsolationResult, ManagedWorktree, WorktreeState,
};
use std::collections::HashSet;
use std::ffi::OsString;
use std::time::Duration;

use super::{
    git::{args, text},
    inspect::{Inspection, inspect},
    *,
};

pub(super) struct Prepared {
    source: Inspection,
    record: ManagedWorktree,
    expires: Instant,
}

fn invalid(message: &str) -> GitError {
    GitError::Message(message.into())
}

impl GitWorkspaces {
    pub async fn isolation_preview(
        &self,
        chat_id: &str,
        folder: &Path,
        input: IsolationInput,
    ) -> Result<IsolationPreview> {
        if chat_id.len() > 128 || chat_id.is_empty() {
            return Err(invalid("The chat identifier is invalid."));
        }
        let slug = slug(&input.slug)?;
        if input.bring_changes {
            return Err(invalid(
                "Bringing uncommitted files is not available in this build yet. The source folder is unchanged.",
            ));
        }
        let git = self.git().await?;
        let source = inspect(&git, folder).await?;
        if !source.view.blockers.is_empty() {
            return Err(GitError::Message(source.view.blockers.join(" ")));
        }
        // The stable app-data worktree lives outside the original repository and watcher tree.
        let storage = self.root.canonicalize()?;
        if storage.starts_with(&source.root) {
            return Err(invalid(
                "The application data directory is inside this repository. Choose an external app-data directory before isolation.",
            ));
        }
        let branches = git
            .run(
                &source.root,
                args(&[
                    "for-each-ref",
                    "--format=%(refname:short)",
                    "refs/heads/aura/",
                ]),
                1024 * 1024,
            )
            .await?;
        let names = text(&branches)?
            .lines()
            .map(|line| line.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let branch = unique_branch(&slug, &names)?;
        let id = crate::ids::new_id();
        let leaf = id
            .rsplit('-')
            .next()
            .ok_or_else(|| invalid("Could not allocate a worktree identifier."))?;
        let path = git::path_argument(&storage.join(leaf));
        if cfg!(windows) && path.to_string_lossy().encode_utf16().count() > 200 {
            return Err(invalid(
                "The application data path is too long for a safe Windows worktree. Choose a shorter data directory.",
            ));
        }
        if path.try_exists()? {
            return Err(invalid(
                "The proposed worktree directory is already occupied. Review a new preview.",
            ));
        }
        let mut warnings = Vec::new();
        if !source.view.files.is_empty() {
            warnings.push("Uncommitted changes stay in the source folder. This worktree starts from the reviewed commit.".into());
        }
        if source.view.has_submodules {
            warnings.push(
                "Submodules are not initialized automatically. Review setup in the new worktree."
                    .into(),
            );
        }
        warnings.push(
            "Repository setup commands and ignored files are not copied or executed automatically."
                .into(),
        );
        let now = crate::time::now_millis();
        let record = ManagedWorktree {
            id,
            chat_id: chat_id.into(),
            source: source.view.root.clone(),
            path: path.to_string_lossy().into_owned(),
            branch: branch.clone(),
            base_commit: source
                .view
                .head
                .clone()
                .ok_or_else(|| invalid("The source commit is unavailable."))?,
            state: WorktreeState::Creating,
            detail: Some(
                "Creation is recorded before Git starts. An interrupted operation requires review."
                    .into(),
            ),
            created_at: now,
        };
        let token = crate::ids::new_id();
        let preview = IsolationPreview {
            token: token.clone(),
            source: source.view.clone(),
            branch,
            path: record.path.clone(),
            bring_changes: false,
            warnings,
            expires_at: now + 600_000,
        };
        let mut prepared = self
            .prepared
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        prepared.retain(|_, entry| entry.expires > Instant::now());
        if prepared.len() >= 32 {
            return Err(invalid(
                "Too many isolation previews are open. Close one before trying again.",
            ));
        }
        prepared.insert(
            token,
            Prepared {
                source,
                record,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        Ok(preview)
    }

    /// Call only for the user's explicit confirmation of the displayed preview. An uncertain Git
    /// outcome is retained as RecoveryRequired, with no force removal or branch rollback.
    pub async fn isolation_apply(&self, chat_id: &str, token: &str) -> Result<IsolationResult> {
        let _guard = self.gate.lock().await;
        let prepared = self
            .prepared
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token)
            .ok_or_else(|| {
                invalid("This isolation preview expired or was already used. Review it again.")
            })?;
        if prepared.record.chat_id != chat_id || prepared.expires <= Instant::now() {
            return Err(invalid(
                "This isolation preview no longer belongs to the selected chat.",
            ));
        }
        let git = self.git().await?;
        let current = inspect(&git, &prepared.source.root).await?;
        if current.fingerprint != prepared.source.fingerprint
            || current.common != prepared.source.common
            || !current.view.blockers.is_empty()
        {
            return Err(invalid(
                "The repository changed after the preview. Review a new preview before creating isolation.",
            ));
        }
        let mut record = prepared.record;
        if Path::new(&record.path)
            .parent()
            .map(std::fs::canonicalize)
            .transpose()?
            != Some(self.root.canonicalize()?)
        {
            return Err(invalid(
                "The application worktree directory changed after preview. Review a new preview.",
            ));
        }
        if Path::new(&record.path).try_exists()? {
            return Err(invalid(
                "The worktree path is now occupied. Review a new preview.",
            ));
        }
        let branch_check = git
            .output(
                &current.root,
                vec![
                    "show-ref".into(),
                    "--verify".into(),
                    "--quiet".into(),
                    format!("refs/heads/{}", record.branch).into(),
                ],
                4096,
            )
            .await?;
        if branch_check.exit.as_ref().and_then(|exit| exit.code) != Some(1) {
            return Err(invalid(
                "The proposed branch already exists or could not be checked. Review a new preview.",
            ));
        }
        let mut records = self.read_records()?;
        if records.len() >= 5000 {
            return Err(invalid(
                "This profile has too many managed worktree records.",
            ));
        }
        records.push(record.clone());
        self.write_records(records.clone())?;
        let command: Vec<OsString> = vec![
            "worktree".into(),
            "add".into(),
            "--lock".into(),
            "--reason".into(),
            format!("auracode {}", record.id).into(),
            "-b".into(),
            record.branch.clone().into(),
            "--".into(),
            record.path.clone().into(),
            record.base_commit.clone().into(),
        ];
        let created = git.run(&current.root, command, 64 * 1024).await;
        let verified = match created {
            Ok(_) => inspect(&git, Path::new(&record.path))
                .await
                .and_then(|new| {
                    if new.common == current.common
                        && new.view.branch.as_deref() == Some(&record.branch)
                        && new.view.head.as_deref() == Some(&record.base_commit)
                        && new.view.files.is_empty()
                    {
                        Ok(())
                    } else {
                        Err(invalid(
                            "The created worktree does not match the reviewed branch and commit.",
                        ))
                    }
                }),
            Err(error) => Err(error),
        };
        match verified {
            Ok(()) => {
                record.state = WorktreeState::Ready;
                record.detail = None;
            }
            Err(error) => {
                record.state = WorktreeState::RecoveryRequired;
                record.detail = Some(error.to_string());
            }
        }
        if let Some(saved) = records.iter_mut().find(|saved| saved.id == record.id) {
            *saved = record.clone();
        }
        self.write_records(records)?;
        let warning=(record.state!=WorktreeState::Ready).then(||"Creation did not complete cleanly. The recorded path and branch were preserved for recovery.".into());
        Ok(IsolationResult {
            worktree: record,
            warning,
        })
    }
}

fn slug(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 36
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || value.starts_with('-')
        || value.ends_with('-')
    {
        return Err(invalid(
            "Use 1 to 36 letters, numbers or internal hyphens for the branch name.",
        ));
    }
    Ok(value)
}

fn unique_branch(slug: &str, names: &HashSet<String>) -> Result<String> {
    for suffix in 1..=1000 {
        let branch = if suffix == 1 {
            format!("aura/{slug}")
        } else {
            format!("aura/{slug}-{suffix}")
        };
        if !names.contains(&branch.to_ascii_lowercase()) {
            return Ok(branch);
        }
    }
    Err(invalid(
        "Too many branches use this name. Choose another name.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branch_names_cannot_be_refs_options_or_windows_path_traversal() {
        for value in ["../main", "-force", "a/b", "x.lock", "x..y", "a\\b", ""] {
            assert!(slug(value).is_err(), "{value}");
        }
        assert_eq!(slug(" Hello-world ").expect("slug"), "hello-world");
        assert_eq!(
            unique_branch(
                "name",
                &HashSet::from(["aura/name".into(), "aura/name-2".into()])
            )
            .expect("suffix"),
            "aura/name-3"
        );
    }
}
