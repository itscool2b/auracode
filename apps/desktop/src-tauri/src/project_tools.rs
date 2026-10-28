//! Project utilities accept saved chat identities and reviewed choices, never arbitrary commands.
use crate::{
    error::{AppError, AppErrorCode},
    state::AppState,
};
use aura_core::session::EditorOpen;
use aura_core::terminal::TerminalError;
use aura_process::{Spawner, pty::PtySize};
use aura_protocol::git::{GitInitializePreview, GitWorkspace};
use aura_protocol::project_tools::{ProjectEditor, ProjectShell, ProjectToolsReview};
use tauri::{AppHandle, State, Url, Webview};
use tauri_plugin_opener::OpenerExt;

fn current(webview: &Webview, state: &AppState) -> Result<(), AppError> {
    if state.quit.is_quitting() || !state.pages.for_view(webview.label()).is_current() {
        return Err(AppError::new(
            AppErrorCode::ShuttingDown,
            "This page is closing.",
        ));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn project_tools_review(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<ProjectToolsReview, AppError> {
    current(&webview, &state)?;
    Ok(state.sessions()?.project_tools_review(&chat_id).await?)
}

/// Reserves a project shell for the docked panel or the reviewed sheet. A window may hold several;
/// the app holds at most eight. The shell itself starts only through `project_terminal_start`.
#[tauri::command]
#[specta::specta]
pub fn project_terminal_reserve(
    webview: Webview,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    current(&webview, &state)?;
    Ok(state.terminals.reserve_project(webview.label())?.pending())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn project_terminal_start(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
    shell: ProjectShell,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, AppError> {
    current(&webview, &state)?;
    let size = PtySize { rows, cols }
        .validate()
        .map_err(|_| TerminalError::Resize)?;
    let ticket = state.terminals.claim(webview.label(), &terminal_id)?;
    let admission = state.sessions()?;
    let plan = admission
        .prepare_project_terminal(&chat_id, &token, shell)
        .await?;
    current(&webview, &state)?;
    let chats = state.chats().ok_or(TerminalError::Closed)?;
    let spawner = Spawner::new(
        chats.registry.clone(),
        tauri::async_runtime::handle().inner().clone(),
    );
    Ok(ticket
        .start_project(spawner, plan.spec, size, Box::new((plan.guard, admission)))
        .await?)
}

fn editor_url(editor: ProjectEditor, folder: &str) -> Result<Url, AppError> {
    let scheme = match editor {
        ProjectEditor::Cursor => "cursor",
        ProjectEditor::VsCode => "vscode",
        ProjectEditor::VsCodeInsiders => "vscode-insiders",
        // These open through their detected launcher, never a URL.
        ProjectEditor::Zed
        | ProjectEditor::IntellijIdea
        | ProjectEditor::WebStorm
        | ProjectEditor::PyCharm
        | ProjectEditor::RustRover
        | ProjectEditor::GoLand
        | ProjectEditor::CLion => {
            return Err(AppError::new(
                AppErrorCode::InvalidArgument,
                "This editor opens through its own launcher.",
            ));
        }
    };
    let mut url = Url::parse(&format!("{scheme}://file/")).map_err(|_| {
        AppError::new(
            AppErrorCode::InvalidArgument,
            "This editor's link handler is unavailable.",
        )
    })?;
    // Preserve a native path as one URI path, never an authority, query, fragment or command.
    let path = if cfg!(windows) {
        folder.replace('\\', "/")
    } else {
        folder.into()
    };
    if path.is_empty() || path.contains('\0') {
        return Err(AppError::new(
            AppErrorCode::InvalidArgument,
            "This folder cannot be opened in an editor.",
        ));
    }
    let path = if path.starts_with('/') {
        path
    } else {
        format!("/{path}")
    };
    url.set_path(&format!(
        "{}/",
        path.trim_end_matches('/').replace('%', "%25")
    ));
    Ok(url)
}

#[tauri::command]
#[specta::specta]
pub async fn project_editor_open(
    app: AppHandle,
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
    editor: ProjectEditor,
) -> Result<(), AppError> {
    current(&webview, &state)?;
    let admission = state.sessions()?;
    let open = admission
        .project_editor_open(&chat_id, &token, editor)
        .await?;
    current(&webview, &state)?;
    match open {
        EditorOpen::Url { folder } => {
            let url = editor_url(editor, &folder)?;
            app.opener().open_url(url.as_str(),None::<&str>).map_err(|_|AppError::new(AppErrorCode::AgentUnavailable,"The operating system could not open this editor. Install or repair its URL handler, then review the folder again."))?;
        }
        // The detected launcher, detached: the editor is the person's, never an owned process.
        EditorOpen::Launch(launch) => tauri::async_runtime::spawn_blocking(move || launch.spawn())
            .await
            .map_err(|_| AppError::new(AppErrorCode::AgentUnavailable, "The editor launch stopped unexpectedly."))?
            .map_err(|_| AppError::new(AppErrorCode::AgentUnavailable, "The operating system could not start this editor. Check its installation, then review the folder again."))?,
    }
    // The profile lease stays alive through the OS dispatch receipt, not the editor's lifetime.
    drop(admission);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editor_uri_cannot_inject_commands_queries_or_fragments() {
        for editor in [
            ProjectEditor::Cursor,
            ProjectEditor::VsCode,
            ProjectEditor::VsCodeInsiders,
        ] {
            let url = editor_url(editor, "/project/a # ? % folder").unwrap();
            assert_eq!(url.host_str(), Some("file"));
            assert!(url.query().is_none());
            assert!(url.fragment().is_none());
            assert!(url.as_str().contains("%23"));
            assert!(url.as_str().contains("%3F"));
            assert!(url.as_str().contains("%25"));
        }
        assert!(
            editor_url(ProjectEditor::Cursor, "//server/share/a%2Fb")
                .unwrap()
                .as_str()
                .ends_with("//server/share/a%252Fb/")
        );
        // Zed and the JetBrains IDEs never open through a URL, only their detected launcher.
        for editor in [
            ProjectEditor::Zed,
            ProjectEditor::IntellijIdea,
            ProjectEditor::WebStorm,
            ProjectEditor::PyCharm,
            ProjectEditor::RustRover,
            ProjectEditor::GoLand,
            ProjectEditor::CLion,
        ] {
            assert!(editor_url(editor, "/project").is_err());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn git_initialize_preview(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    initial_branch: String,
) -> Result<GitInitializePreview, AppError> {
    current(&webview, &state)?;
    Ok(state
        .sessions()?
        .git_initialize_preview(&chat_id, &initial_branch)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn git_initialize_apply(
    webview: Webview,
    state: State<'_, AppState>,
    chat_id: String,
    token: String,
) -> Result<GitWorkspace, AppError> {
    current(&webview, &state)?;
    let admission = state.sessions()?;
    let manager = (*admission).clone();
    Ok(manager
        .git_initialize_apply(&chat_id, &token, Box::new(admission))
        .await?)
}
