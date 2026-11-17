//! Explicit project utilities share the native profile and folder admission rules.
use super::editors::{self, Detected, Platform, Roots, Target};
use super::*;
use aura_process::{LaunchSpec, ProcessCwd, ResolvedEnv, SpawnSpec};
use aura_protocol::git::{GitInitializePreview, GitWorkspace};
use aura_protocol::project_tools::{
    ProjectEditor, ProjectShell, ProjectShellChoice, ProjectToolsReview,
};
use same_file::Handle;
use std::{ffi::OsString, time::Instant};

pub(super) struct PreparedTools {
    chat_id: String,
    folder: PathBuf,
    identity: Handle,
    env: Arc<ResolvedEnv>,
    shells: Vec<Shell>,
    editors: Vec<PreparedEditor>,
    expires: Instant,
}
/// A detected editor bound by the identity of its launcher, as shells are.
struct PreparedEditor {
    detected: Detected,
    identity: Handle,
}

/// How the desktop opens a reviewed folder, or a chat's file, in the chosen editor. No `Debug`:
/// the launch carries the resolved environment, whose values can hold keys.
pub enum EditorOpen {
    /// Hand the folder or file to the editor's registered URL handler.
    Url { path: String, target: UrlTarget },
    /// Run the detected launcher with the folder or file as its last argument.
    Launch(EditorLaunch),
}

/// What a URL handler is given: a folder, or a file at its line and column when known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlTarget {
    Folder,
    File {
        line: Option<u32>,
        column: Option<u32>,
    },
}

/// A detected editor's launcher. The editor belongs to the person: auracode starts it detached,
/// with the reviewed environment and no inherited handles, and never waits for or stops it.
pub struct EditorLaunch {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    env: Vec<(OsString, OsString)>,
    /// Only `/usr/bin/open`, whose status is Launch Services' receipt, is waited for.
    wait: bool,
}

impl EditorLaunch {
    pub(super) fn new(command: editors::Command, env: &ResolvedEnv) -> EditorLaunch {
        EditorLaunch {
            program: command.program,
            args: command.args,
            env: env
                .vars
                .iter()
                .map(|(key, value)| (key.as_os_str().to_owned(), value.clone()))
                .collect(),
            wait: command.wait,
        }
    }

    /// Starts the launcher. `open` returns once Launch Services has the request, and its status
    /// is the receipt; otherwise a started process is the receipt. Blocking.
    pub fn spawn(&self) -> std::io::Result<()> {
        let mut command = std::process::Command::new(&self.program);
        command
            .args(&self.args)
            .env_clear()
            .envs(self.env.iter().map(|(key, value)| (key, value)))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: no console, and no shared Ctrl+C.
            command.creation_flags(0x0000_0008 | 0x0000_0200);
        }
        #[cfg(unix)]
        if !self.wait {
            use std::os::unix::process::CommandExt;
            // Its own process group, so the editor never shares auracode's signals.
            command.process_group(0);
        }
        let mut child = aura_process::spawn_command(&mut command)?;
        if self.wait {
            let status = child.wait()?;
            if !status.success() {
                return Err(std::io::Error::other(format!(
                    "Launch Services refused the request ({status})."
                )));
            }
        } else if cfg!(unix) {
            // Reaped whenever it exits, so a launcher that hands off never lingers as a zombie.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Ok(())
    }
}
struct Shell {
    choice: ProjectShellChoice,
    program: PathBuf,
    identity: Handle,
}

pub struct ProjectTerminalPlan {
    pub spec: SpawnSpec,
    pub guard: Box<dyn Send + Sync>,
}
struct FolderUse {
    shared: Arc<Shared>,
    folder: PathBuf,
    _identity: Handle,
}
impl Drop for FolderUse {
    fn drop(&mut self) {
        self.shared.live.end_folder_use(&self.folder);
    }
}

fn invalid(message: impl Into<String>) -> SessionError {
    SessionError::Organization(message.into())
}
pub(super) fn display_path(path: &std::path::Path) -> Result<String, SessionError> {
    let value = path.to_str().ok_or_else(|| {
        invalid("This folder's name cannot be represented by the editor or terminal interface.")
    })?;
    #[cfg(windows)]
    let value = value
        .strip_prefix(r"\\?\UNC\")
        .map(|tail| format!(r"\\{tail}"))
        .unwrap_or_else(|| value.strip_prefix(r"\\?\").unwrap_or(value).to_owned());
    Ok(value.to_owned())
}

/// Whether two spellings name one folder (their canonical forms are equal).
fn same_folder(left: &std::path::Path, right: &std::path::Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn shell(env: &ResolvedEnv) -> Vec<Shell> {
    let mut choices = Vec::<(ProjectShell, &str, PathBuf, Vec<&str>)>::new();
    #[cfg(windows)]
    if let Some(root) = env
        .vars
        .get(&"SystemRoot".into())
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
    {
        choices.push((
            ProjectShell::PowerShell,
            "PowerShell",
            root.join("System32/WindowsPowerShell/v1.0/powershell.exe"),
            vec!["-NoLogo", "-NoProfile"],
        ));
        choices.push((
            ProjectShell::CommandPrompt,
            "Command Prompt",
            root.join("System32/cmd.exe"),
            vec!["/D"],
        ));
    }
    #[cfg(target_os = "macos")]
    {
        let _ = env;
        choices.push((
            ProjectShell::Zsh,
            "Zsh",
            PathBuf::from("/bin/zsh"),
            vec!["-f", "-i"],
        ));
        choices.push((
            ProjectShell::Bash,
            "Bash",
            PathBuf::from("/bin/bash"),
            vec!["--noprofile", "--norc", "-i"],
        ));
    }
    // Linux: Bash first, as most distributions set it, then Zsh when installed. Both start
    // without startup files, as on macOS: the reviewed environment already carries the login PATH.
    #[cfg(target_os = "linux")]
    {
        let _ = env;
        for (id, label, places, args) in [
            (
                ProjectShell::Bash,
                "Bash",
                ["/usr/bin/bash", "/bin/bash"],
                vec!["--noprofile", "--norc", "-i"],
            ),
            (
                ProjectShell::Zsh,
                "Zsh",
                ["/usr/bin/zsh", "/bin/zsh"],
                vec!["-f", "-i"],
            ),
        ] {
            if let Some(path) = places
                .into_iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
            {
                choices.push((id, label, path, args));
            }
        }
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = env;
    choices
        .into_iter()
        .filter_map(|(id, label, path, args)| {
            let program = path.canonicalize().ok()?;
            if !program.is_file() {
                return None;
            }
            let identity = Handle::from_path(&program).ok()?;
            Some(Shell {
                choice: ProjectShellChoice {
                    id,
                    label: label.into(),
                    program: display_path(&program).ok()?,
                    args: args.into_iter().map(String::from).collect(),
                },
                program,
                identity,
            })
        })
        .collect()
}

// Metadata-only detection of standard native application locations (editors.rs). Custom installs
// may still be opened manually. A detected application is not a claim that it can dispatch.
pub(super) fn detected(env: &ResolvedEnv) -> Vec<Detected> {
    let Some(platform) = Platform::current() else {
        return Vec::new();
    };
    editors::detect(platform, &Roots::from_env(platform, env))
}

fn editors(env: &ResolvedEnv) -> Vec<PreparedEditor> {
    detected(env)
        .into_iter()
        .filter_map(|detected| {
            let identity = Handle::from_path(&detected.file).ok()?;
            Some(PreparedEditor { detected, identity })
        })
        .collect()
}

impl SessionManager {
    /// `AURACODE_PORT` (and `PORT` for Run) when `folder` is the chat's ready worktree; nothing
    /// otherwise, or when no port block is free.
    pub(super) async fn worktree_port_env(
        &self,
        chat_id: &str,
        folder: &std::path::Path,
        run: bool,
    ) -> Vec<(OsString, OsString)> {
        let Ok(service) = self.worktrees() else {
            return Vec::new();
        };
        match service.worktree_port(chat_id).await {
            Ok((record, port)) if same_folder(std::path::Path::new(&record.path), folder) => {
                crate::gitworkspaces::run::port_env(port, run)
            }
            _ => Vec::new(),
        }
    }

    /// Holds `folder` as a project terminal does, so worktree changes wait until the process ends.
    pub(super) fn hold_folder(
        &self,
        folder: &std::path::Path,
    ) -> Result<Box<dyn Send + Sync>, SessionError> {
        let identity = Handle::from_path(folder)
            .map_err(|_| invalid("The project folder could not be inspected."))?;
        let folder_key = live::normalize_path(folder.to_path_buf());
        if !self.shared().live.begin_folder_use(folder_key.clone()) {
            return Err(invalid(
                "A folder operation or application transition is in progress. Finish it before starting Run.",
            ));
        }
        Ok(Box::new(FolderUse {
            shared: self.shared().clone(),
            folder: folder_key,
            _identity: identity,
        }))
    }

    pub async fn project_tools_review(
        &self,
        chat_id: &str,
    ) -> Result<ProjectToolsReview, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let chat = self.git_chat(chat_id).await?;
        let folder = chat
            .folder
            .canonicalize()
            .map_err(|_| invalid("Locate this chat's folder before opening project tools."))?;
        if !folder.is_dir() {
            return Err(invalid("This chat's folder is unavailable."));
        }
        let identity = Handle::from_path(&folder)
            .map_err(|_| invalid("The project folder could not be inspected."))?;
        let env = self.deps().env.get().await;
        let shells = shell(&env);
        let editors = editors(&env);
        let token = crate::ids::new_id();
        let review = ProjectToolsReview {
            token: token.clone(),
            folder: display_path(&folder)?,
            shells: shells.iter().map(|item| item.choice.clone()).collect(),
            editors: editors.iter().map(|item| item.detected.editor).collect(),
            expires_at: crate::time::now_millis() + 600_000,
        };
        let mut prepared = lock(&self.shared().project_tools);
        prepared.retain(|_, item| item.expires > Instant::now());
        if prepared.len() >= 32 {
            return Err(invalid(
                "Too many project tool reviews are open. Wait for an earlier review to expire.",
            ));
        }
        prepared.insert(
            token,
            PreparedTools {
                chat_id: chat_id.into(),
                folder,
                identity,
                env,
                shells,
                editors,
                expires: Instant::now() + Duration::from_secs(600),
            },
        );
        Ok(review)
    }

    async fn consume_project_tools(
        &self,
        chat_id: &str,
        token: &str,
    ) -> Result<PreparedTools, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let prepared = lock(&self.shared().project_tools)
            .remove(token)
            .ok_or_else(|| {
                invalid("This project tool review expired or was used. Review the folder again.")
            })?;
        let chat = self.git_chat(chat_id).await?;
        if prepared.chat_id != chat_id
            || prepared.expires <= Instant::now()
            || chat.folder.canonicalize().ok().as_ref() != Some(&prepared.folder)
            || Handle::from_path(&prepared.folder).ok().as_ref() != Some(&prepared.identity)
        {
            return Err(invalid(
                "The chat or folder changed after review. Review project tools again.",
            ));
        }
        Ok(prepared)
    }

    pub async fn prepare_project_terminal(
        &self,
        chat_id: &str,
        token: &str,
        shell: ProjectShell,
    ) -> Result<ProjectTerminalPlan, SessionError> {
        // Behind changes to this chat's folder only; consuming the review checks the folder again.
        let (_organization, _) = self.hold_chat_folder(chat_id, &[]).await?;
        let prepared = self.consume_project_tools(chat_id, token).await?;
        let shell = prepared
            .shells
            .into_iter()
            .find(|item| item.choice.id == shell)
            .ok_or_else(|| invalid("This shell was not available in the review."))?;
        if Handle::from_path(&shell.program).ok().as_ref() != Some(&shell.identity) {
            return Err(invalid(
                "The shell changed after review. Review project tools again.",
            ));
        }
        // A worktree chat's shell knows the worktree's first port, as its setup and Run do.
        let set_env = self
            .worktree_port_env(chat_id, &prepared.folder, false)
            .await;
        let folder_key = live::normalize_path(prepared.folder.clone());
        if !self.shared().live.begin_folder_use(folder_key.clone()) {
            return Err(invalid(
                "A folder operation or application transition is in progress. Finish it before opening the terminal.",
            ));
        }
        let guard = FolderUse {
            shared: self.shared().clone(),
            folder: folder_key,
            _identity: prepared.identity,
        };
        // The review holds canonical paths, which Windows spells verbatim (`\\?\C:\...`). Shells
        // are started with the plain spelling: Windows PowerShell cannot start from a verbatim
        // program path (its .NET configuration fails to load), and cmd.exe treats a verbatim
        // working folder as UNC and falls back to the Windows folder.
        let spec = SpawnSpec {
            launch: LaunchSpec {
                label: format!("Project {}", shell.choice.label),
                program: crate::fsutil::plain_path(&shell.program),
                args: shell.choice.args.into_iter().map(Into::into).collect(),
                cwd: ProcessCwd::Fixed(crate::fsutil::plain_path(&prepared.folder)),
                set_env,
                daemons: Vec::new(),
                startup_timeout: Duration::from_secs(15),
            },
            folder: prepared.folder,
            env: prepared.env,
            max_line_bytes: aura_process::MAX_LINE_BYTES,
        };
        Ok(ProjectTerminalPlan {
            spec,
            guard: Box::new(guard),
        })
    }

    /// Consumes the review and says how to open its folder in `editor`: the editor must still be
    /// detected at the same location with the same launcher file it had at review.
    pub async fn project_editor_open(
        &self,
        chat_id: &str,
        token: &str,
        editor: ProjectEditor,
    ) -> Result<EditorOpen, SessionError> {
        // Opening an editor changes nothing, so it waits for no other change.
        let prepared = self.consume_project_tools(chat_id, token).await?;
        let gone = || {
            invalid("This editor is no longer detected. Install it or open the folder manually.")
        };
        let reviewed = prepared
            .editors
            .iter()
            .find(|item| item.detected.editor == editor)
            .ok_or_else(gone)?;
        let current = editors(&prepared.env)
            .into_iter()
            .find(|item| item.detected.editor == editor)
            .ok_or_else(gone)?;
        if current.detected != reviewed.detected || current.identity != reviewed.identity {
            return Err(invalid(
                "This editor changed after review. Review the folder again.",
            ));
        }
        let folder = display_path(&prepared.folder)?;
        Ok(
            match editors::command(&reviewed.detected, Target::Folder(&folder)) {
                None => EditorOpen::Url {
                    path: folder,
                    target: UrlTarget::Folder,
                },
                Some(command) => EditorOpen::Launch(EditorLaunch::new(command, &prepared.env)),
            },
        )
    }

    pub async fn git_initialize_preview(
        &self,
        chat_id: &str,
        initial_branch: &str,
    ) -> Result<GitInitializePreview, SessionError> {
        let chat = self.git_chat(chat_id).await?;
        self.worktrees()?
            .initialize_preview(chat_id, &chat.folder, initial_branch)
            .await
            .map_err(|error| SessionError::Organization(error.to_string()))
    }

    pub async fn git_initialize_apply(
        &self,
        chat_id: &str,
        token: &str,
        admission: Box<dyn Send + Sync>,
    ) -> Result<GitWorkspace, SessionError> {
        let manager = self.clone();
        let chat_id = chat_id.to_owned();
        let token = token.to_owned();
        self.deps()
            .rt
            .spawn(async move {
                let _admission = admission;
                let (_organization, _) = manager.hold_chat_folder(&chat_id, &[]).await?;
                let chat = manager.git_chat(&chat_id).await?;
                let _reservation = manager
                    .hold_exclusive(vec![chat.folder.clone()], None, None)
                    .await?;
                manager
                    .worktrees()?
                    .initialize_apply(&chat_id, &chat.folder, &token)
                    .await
                    .map_err(|error| SessionError::Organization(error.to_string()))
            })
            .await
            .map_err(|_| {
                SessionError::Organization(
                    "Initialization stopped unexpectedly. Inspect the folder before retrying."
                        .into(),
                )
            })?
    }
}
