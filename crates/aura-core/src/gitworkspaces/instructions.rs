//! Git facts for instruction files, and committing one new instruction file on request.
//! Reads never refresh or write the index; the commit stages and commits exactly one path.

use std::{collections::HashMap, ffi::OsString, path::Path};

use aura_config::instructions::{GitFacts, GitState};

use super::{GitError, GitWorkspaces, Result, git};

/// Parses `git status --porcelain=v1 -z` entries for paths under `prefix` (repository relative).
fn parse_status(output: &[u8], prefix: &str) -> HashMap<String, GitState> {
    let mut states = HashMap::new();
    let mut entries = output.split(|byte| *byte == 0).peekable();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2];
        let path = String::from_utf8_lossy(&entry[3..]).into_owned();
        // A rename or copy carries its source path in the next entry.
        if matches!(code[0], b'R' | b'C') {
            entries.next();
        }
        let Some(relative) = path.strip_prefix(prefix) else {
            continue;
        };
        let state = match code {
            b"??" => GitState::Untracked,
            b"!!" => GitState::Ignored,
            _ => GitState::Modified,
        };
        states.insert(relative.to_owned(), state);
    }
    states
}

impl GitWorkspaces {
    /// Tracked, modified, untracked or ignored, for each of `paths` that exists in `folder`.
    /// A folder outside any repository gives the default facts.
    pub async fn instruction_facts(&self, folder: &Path, paths: &[&str]) -> Result<GitFacts> {
        let git = self.git().await?;
        let prefix = git
            .output(folder, git::args(&["rev-parse", "--show-prefix"]), 4096)
            .await?;
        if prefix.exit.as_ref().and_then(|exit| exit.code) != Some(0) {
            return Ok(GitFacts::default());
        }
        let prefix = git::text(&prefix.stdout)?;
        let mut args: Vec<OsString> = git::args(&[
            "status",
            "--porcelain=v1",
            "-z",
            "--ignored=matching",
            "--untracked-files=all",
            "--no-renames",
            "--",
        ]);
        args.extend(paths.iter().map(OsString::from));
        let status = git.run(folder, args, 1024 * 1024).await?;
        let mut files = parse_status(&status, &prefix);
        for path in paths {
            if !files.contains_key(*path) && folder.join(path).is_file() {
                files.insert((*path).to_owned(), GitState::Tracked);
            }
        }
        let inspection = super::inspect::inspect(&git, folder).await.ok();
        let worktree_branch = inspection
            .filter(|inspection| inspection.view.is_linked_worktree)
            .and_then(|inspection| inspection.view.branch);
        Ok(GitFacts {
            repository: true,
            files,
            worktree_branch,
        })
    }

    /// Stages and commits exactly one untracked instruction file. Other staged changes stay
    /// staged and out of the commit; a failed commit unstages the file again.
    pub async fn commit_instruction_file(&self, folder: &Path, path: &str) -> Result<String> {
        if !aura_config::instructions::project_paths().contains(&path) {
            return Err(GitError::Message(
                "Only an instruction file can be committed here.".into(),
            ));
        }
        let _gate = self.gate.lock().await;
        let git = self.git().await?;
        let facts = self.instruction_facts(folder, &[path]).await?;
        if facts.files.get(path) != Some(&GitState::Untracked) {
            return Err(GitError::Message(format!(
                "{path} is not a new, untracked file, so auracode leaves committing it to you."
            )));
        }
        git.run(folder, git::args(&["add", "--", path]), 4096)
            .await?;
        let message = format!("Add {path}");
        let committed = git
            .run(
                folder,
                git::args(&["commit", "--only", "--quiet", "-m", &message, "--", path]),
                64 * 1024,
            )
            .await;
        if committed.is_err() {
            // Put the index back as it was: the file was untracked before.
            let _ = git
                .run(
                    folder,
                    git::args(&["rm", "--cached", "--quiet", "--", path]),
                    4096,
                )
                .await;
            return Err(GitError::Message(format!(
                "Git could not commit {path}. Its author settings or signing may need your terminal. Nothing else was changed."
            )));
        }
        let head = git
            .run(folder, git::args(&["rev-parse", "--short", "HEAD"]), 256)
            .await?;
        git::text(&head)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn names(rig: &super::super::tests::Rig, args: &[&str]) -> Vec<String> {
        let output = rig
            .git
            .run(&rig.work, git::args(args), 64 * 1024)
            .await
            .unwrap();
        String::from_utf8_lossy(&output)
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect()
    }

    #[tokio::test]
    async fn facts_are_read_only_and_a_commit_takes_exactly_one_new_file() {
        let rig = super::super::tests::rig().await;
        let paths = aura_config::instructions::project_paths();
        std::fs::write(rig.work.join("GEMINI.md"), b"Committed.\n").unwrap();
        rig.git
            .run(&rig.work, git::args(&["add", "--", "GEMINI.md"]), 4096)
            .await
            .unwrap();
        rig.git
            .run(
                &rig.work,
                git::args(&["commit", "-q", "-m", "gemini"]),
                4096,
            )
            .await
            .unwrap();
        std::fs::write(rig.work.join("GEMINI.md"), b"Changed.\n").unwrap();
        std::fs::write(rig.work.join(".gitignore"), b"CLAUDE.md\n").unwrap();
        std::fs::write(rig.work.join("CLAUDE.md"), b"Personal.\n").unwrap();
        std::fs::write(rig.work.join("AGENTS.md"), b"Shared.\n").unwrap();
        // Unrelated work the person staged must stay staged and out of the commit.
        std::fs::write(rig.work.join("other.txt"), b"Staged work.\n").unwrap();
        rig.git
            .run(&rig.work, git::args(&["add", "--", "other.txt"]), 4096)
            .await
            .unwrap();
        let facts = rig
            .service
            .instruction_facts(&rig.work, &paths)
            .await
            .unwrap();
        assert!(facts.repository);
        assert_eq!(facts.files.get("AGENTS.md"), Some(&GitState::Untracked));
        assert_eq!(facts.files.get("CLAUDE.md"), Some(&GitState::Ignored));
        assert_eq!(facts.files.get("GEMINI.md"), Some(&GitState::Modified));
        assert_eq!(facts.worktree_branch, None);
        assert!(
            rig.service
                .commit_instruction_file(&rig.work, "CLAUDE.md")
                .await
                .is_err()
        );
        assert!(
            rig.service
                .commit_instruction_file(&rig.work, "GEMINI.md")
                .await
                .is_err()
        );
        assert!(
            rig.service
                .commit_instruction_file(&rig.work, "other.txt")
                .await
                .is_err()
        );
        let head = rig
            .service
            .commit_instruction_file(&rig.work, "AGENTS.md")
            .await
            .unwrap();
        assert!(!head.is_empty());
        assert_eq!(
            names(&rig, &["show", "--name-only", "--format=", "HEAD"]).await,
            vec!["AGENTS.md"]
        );
        assert_eq!(
            names(&rig, &["diff", "--cached", "--name-only"]).await,
            vec!["other.txt"]
        );
        let after = rig
            .service
            .instruction_facts(&rig.work, &paths)
            .await
            .unwrap();
        assert_eq!(after.files.get("AGENTS.md"), Some(&GitState::Tracked));
        assert_eq!(after.files.get("GEMINI.md"), Some(&GitState::Modified));
    }

    #[tokio::test]
    async fn a_folder_outside_any_repository_has_no_git_facts() {
        let rig = super::super::tests::rig().await;
        let plain = tempfile::tempdir().unwrap();
        std::fs::write(plain.path().join("AGENTS.md"), b"x").unwrap();
        let facts = rig
            .service
            .instruction_facts(plain.path(), &aura_config::instructions::project_paths())
            .await
            .unwrap();
        assert_eq!(facts, GitFacts::default());
    }

    #[test]
    fn status_entries_map_to_instruction_states_under_the_folder() {
        let output = b"?? app/AGENTS.md\0!! app/CLAUDE.md\0 M app/GEMINI.md\0?? other/AGENTS.md\0R  app/new.md\0app/old.md\0";
        let states = parse_status(output, "app/");
        assert_eq!(states.get("AGENTS.md"), Some(&GitState::Untracked));
        assert_eq!(states.get("CLAUDE.md"), Some(&GitState::Ignored));
        assert_eq!(states.get("GEMINI.md"), Some(&GitState::Modified));
        assert!(!states.contains_key("other/AGENTS.md"));
        assert!(!states.contains_key("old.md"));
        assert_eq!(parse_status(b"", "").len(), 0);
    }
}
