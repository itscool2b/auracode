//! Bounded Git plumbing against an application-owned repository and index only.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aura_process::{
    EnvResolver, HelperEnv, HelperSpec, LeftoverRegistry, ResolvedEnv, find_exe, run_helper,
};

use super::{CheckpointError, Result};

pub(super) struct Git {
    pub(super) program: PathBuf,
    env: Arc<ResolvedEnv>,
    registry: Arc<LeftoverRegistry>,
    empty: PathBuf,
    hooks: PathBuf,
    pub(super) protected: Vec<PathBuf>,
}

impl Git {
    pub(super) async fn new(
        env: &EnvResolver,
        registry: Arc<LeftoverRegistry>,
        scratch: &Path,
    ) -> Result<Self> {
        let mut env = (*env.get().await).clone();
        let value = |name: &str| {
            env.vars
                .get(&aura_process::EnvKey::from(name))
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        let home = value("USERPROFILE").or_else(|| value("HOME"));
        let mut protected = Vec::new();
        for (variable, default) in [("CLAUDE_CONFIG_DIR", ".claude"), ("CODEX_HOME", ".codex")] {
            if let Some(path) =
                value(variable).or_else(|| home.as_ref().map(|home| home.join(default)))
            {
                protected.push(path);
            }
        }
        if let Some(home) = home {
            for suffix in [
                ".claude.json",
                ".pi",
                ".omp",
                ".grok",
                ".config",
                ".local/share",
            ] {
                protected.push(home.join(suffix));
            }
        }
        // Do not inherit alternate object directories, worktrees, indexes, config injections,
        // tracing paths, external diffs, or a credential askpass from auracode's launch context.
        env.vars.retain(|key, _| {
            !key.as_os_str()
                .to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("GIT_")
        });
        let program = find_exe("git", &env.vars).ok_or_else(|| {
            CheckpointError::Message(
                "Git is required to save checkpoints. Install Git and refresh the environment."
                    .into(),
            )
        })?;
        let empty = scratch.join("empty-config");
        std::fs::write(&empty, [])?;
        let hooks = scratch.join("empty-template");
        std::fs::create_dir(&hooks)?;
        Ok(Self {
            program,
            env: Arc::new(env),
            registry,
            empty,
            hooks,
            protected,
        })
    }

    pub(super) async fn init(&self, repo: &Path, cwd: &Path) -> Result<()> {
        self.run(
            repo,
            cwd,
            &repo.join("unused-index"),
            vec![
                "init".into(),
                "--bare".into(),
                format!("--template={}", self.hooks.display()).into(),
                "--".into(),
                repo.as_os_str().to_owned(),
            ],
            4096,
        )
        .await?;
        Ok(())
    }

    pub(super) async fn run(
        &self,
        repo: &Path,
        cwd: &Path,
        index: &Path,
        args: Vec<OsString>,
        max_stdout: usize,
    ) -> Result<Vec<u8>> {
        let operation = args
            .first()
            .map(|arg| arg.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut command = vec![
            "--no-pager".into(),
            "--literal-pathspecs".into(),
            "-c".into(),
            format!("core.hooksPath={}", self.hooks.display()).into(),
            "-c".into(),
            "core.fsmonitor=false".into(),
            "-c".into(),
            "core.autocrlf=false".into(),
            "-c".into(),
            "core.safecrlf=false".into(),
            "-c".into(),
            // Profile paths plus checkpoint refs can exceed Windows' legacy path limit.
            "core.longpaths=true".into(),
            "-c".into(),
            "core.fsync=all".into(),
            "-c".into(),
            "core.quotePath=false".into(),
            "-c".into(),
            format!("core.excludesFile={}", self.empty.display()).into(),
            "-c".into(),
            format!("core.attributesFile={}", self.empty.display()).into(),
        ];
        command.extend(args);
        let mut set = vec![
            ("GIT_DIR".into(), repo.as_os_str().to_owned()),
            ("GIT_INDEX_FILE".into(), index.as_os_str().to_owned()),
            (
                "GIT_CONFIG_GLOBAL".into(),
                self.empty.as_os_str().to_owned(),
            ),
            (
                "GIT_CONFIG_SYSTEM".into(),
                self.empty.as_os_str().to_owned(),
            ),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("GIT_ATTR_NOSYSTEM".into(), "1".into()),
            ("GIT_TERMINAL_PROMPT".into(), "0".into()),
            ("GIT_OPTIONAL_LOCKS".into(), "0".into()),
            ("GIT_AUTHOR_NAME".into(), "auracode checkpoint".into()),
            ("GIT_AUTHOR_EMAIL".into(), "checkpoint@localhost".into()),
            ("GIT_COMMITTER_NAME".into(), "auracode checkpoint".into()),
            ("GIT_COMMITTER_EMAIL".into(), "checkpoint@localhost".into()),
        ];
        if operation != "init" {
            set.push(("GIT_WORK_TREE".into(), cwd.as_os_str().to_owned()));
        }
        let output = run_helper(
            &self.registry,
            HelperSpec {
                program: self.program.clone(),
                args: command,
                cwd: cwd.to_path_buf(),
                env: HelperEnv::Resolved(Arc::clone(&self.env)),
                set,
                new_session: true,
                timeout: Duration::from_secs(20),
                max_stdout,
            },
        )
        .await
        .map_err(|error| {
            CheckpointError::Message(format!("Checkpoint Git helper could not start: {error}"))
        })?;
        if output.timed_out {
            return Err(CheckpointError::Message(
                "Checkpoint Git helper timed out.".into(),
            ));
        }
        if output.stdout_truncated {
            return Err(CheckpointError::Message(
                "Checkpoint output exceeded its safety limit.".into(),
            ));
        }
        if output.exit.as_ref().and_then(|exit| exit.code) != Some(0) {
            #[cfg(test)]
            eprintln!("fixture Git {operation}: {}", output.stderr_tail);
            // Git can echo arbitrary repository content. Do not put its unredacted stderr in UI.
            return Err(CheckpointError::Message(format!(
                "Checkpoint Git {operation} failed. The working folder and user index were left unchanged."
            )));
        }
        Ok(output.stdout)
    }
}

pub(super) fn oid(bytes: &[u8]) -> Result<String> {
    let value = std::str::from_utf8(bytes).unwrap_or("").trim();
    if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CheckpointError::Message(
            "Git returned an invalid checkpoint object ID.".into(),
        ));
    }
    Ok(value.to_owned())
}
