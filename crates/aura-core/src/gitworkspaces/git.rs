//! Owned, bounded Git helpers. Read-only commands do not refresh the user's index.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aura_process::{
    EnvKey, EnvResolver, HelperEnv, HelperOutput, HelperSpec, LeftoverRegistry, ResolvedEnv,
    find_exe, run_helper,
};

use super::{GitError, Result};

pub(super) struct Git {
    pub(super) program: PathBuf,
    env: Arc<ResolvedEnv>,
    registry: Arc<LeftoverRegistry>,
    hooks: PathBuf,
}

impl Git {
    pub(super) async fn new(
        env: &EnvResolver,
        registry: Arc<LeftoverRegistry>,
        hooks: PathBuf,
    ) -> Result<Self> {
        let mut env = (*env.get().await).clone();
        // An inherited alternate index, worktree, configuration injection or trace destination
        // must never redirect an operation away from the folder the user reviewed.
        env.vars.retain(|key, _| {
            !key.as_os_str()
                .to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("GIT_")
        });
        env.vars.remove(&EnvKey::from("SSH_ASKPASS"));
        let program = find_exe("git", &env.vars).ok_or_else(|| {
            GitError::Message(
                "Install Git and refresh the environment before managing worktrees.".into(),
            )
        })?;
        Ok(Self {
            program,
            env: Arc::new(env),
            registry,
            hooks,
        })
    }

    pub(super) async fn output(
        &self,
        cwd: &Path,
        args: Vec<OsString>,
        maximum: usize,
    ) -> Result<HelperOutput> {
        let mut command = vec![
            "--no-pager".into(),
            "--literal-pathspecs".into(),
            "-c".into(),
            format!("core.hooksPath={}", self.hooks.display()).into(),
            "-c".into(),
            "core.fsmonitor=false".into(),
            "-c".into(),
            "core.quotePath=false".into(),
            "-c".into(),
            "core.fsync=all".into(),
            "-c".into(),
            "diff.autoRefreshIndex=false".into(),
        ];
        command.extend(args);
        let output = run_helper(
            &self.registry,
            HelperSpec {
                program: self.program.clone(),
                args: command,
                cwd: cwd.into(),
                env: HelperEnv::Resolved(Arc::clone(&self.env)),
                set: vec![
                    ("GIT_OPTIONAL_LOCKS".into(), "0".into()),
                    ("GIT_TERMINAL_PROMPT".into(), "0".into()),
                    ("GIT_ASKPASS".into(), OsString::new()),
                    ("GCM_INTERACTIVE".into(), "never".into()),
                ],
                new_session: true,
                timeout: Duration::from_secs(30),
                max_stdout: maximum,
            },
        )
        .await
        .map_err(|_| GitError::Message("The owned Git helper could not start.".into()))?;
        if output.timed_out {
            return Err(GitError::Message(
                "Git timed out. Review the worktree state before trying again.".into(),
            ));
        }
        if output.stdout_truncated {
            return Err(GitError::Message(
                "This repository exceeds the bounded Git operation limit.".into(),
            ));
        }
        Ok(output)
    }

    pub(super) async fn run(
        &self,
        cwd: &Path,
        args: Vec<OsString>,
        maximum: usize,
    ) -> Result<Vec<u8>> {
        let output = self.output(cwd, args, maximum).await?;
        if output.exit.as_ref().and_then(|exit| exit.code) != Some(0) {
            #[cfg(test)]
            eprintln!("Owned Git fixture error: {}", output.stderr_tail);
            // Git may echo repository data or remote credentials. Never expose its raw stderr.
            return Err(GitError::Message("Git could not complete this operation. The recorded workspace is retained for review.".into()));
        }
        Ok(output.stdout)
    }
}

pub(super) fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

pub(super) fn text(bytes: &[u8]) -> Result<String> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        GitError::Message("Git returned text that cannot be represented by this app.".into())
    })?;
    Ok(text.trim_end_matches(['\r', '\n']).to_owned())
}

pub(super) fn oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Git for Windows treats extended-length path arguments as UNC paths. The app bounds worktree
/// paths separately, so regular drive/UNC spellings preserve the same canonical location.
pub(super) fn path_argument(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let mut parts = path.components();
        let base = match parts.next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::VerbatimDisk(drive) => {
                    Some(PathBuf::from(format!("{}:\\", char::from(drive))))
                }
                Prefix::VerbatimUNC(server, share) => {
                    let mut base = OsString::from("\\\\");
                    base.push(server);
                    base.push("\\");
                    base.push(share);
                    Some(PathBuf::from(base))
                }
                _ => None,
            },
            _ => None,
        };
        if let Some(mut base) = base {
            for part in parts {
                if !matches!(part, Component::RootDir) {
                    base.push(part.as_os_str());
                }
            }
            return base;
        }
    }
    path.to_path_buf()
}
