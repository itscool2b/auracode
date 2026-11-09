//! What the panel asks of the browser. Pages never reach these: they are auracode's own window's
//! commands, and a guest page has no Tauri IPC at all.

use std::sync::Arc;

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use super::{
    Browser, BrowserError, BrowserRect, BrowserStatus, BrowserTab, ChatBrowser, ClearData,
    GoAction, HistoryEntry, PickedElement, address,
};
use crate::error::AppError;

type Service<'a> = State<'a, Arc<Browser>>;

#[tauri::command]
#[specta::specta]
pub async fn browser_status(browser: Service<'_>) -> Result<BrowserStatus, AppError> {
    Ok(browser.status())
}

#[tauri::command]
#[specta::specta]
pub async fn browser_chat(browser: Service<'_>, chat_id: String) -> Result<ChatBrowser, AppError> {
    Ok(browser.chat(&chat_id))
}

/// Opens a tab in a chat: `input` (an address, a host or words to search for) loads in it, or the
/// start page shows when there is none.
#[tauri::command]
#[specta::specta]
pub async fn browser_open(
    browser: Service<'_>,
    chat_id: String,
    input: Option<String>,
    activate: bool,
) -> Result<BrowserTab, AppError> {
    let url = match input.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => Some(address::resolve(text).ok_or_else(|| {
            BrowserError::Invalid("That is not an address the browser can open.".into())
        })?),
        None => None,
    };
    Ok(browser.open_tab(&chat_id, url, activate)?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_close(browser: Service<'_>, tab_id: String) -> Result<(), AppError> {
    Ok(browser.close_tab(&tab_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_activate(
    browser: Service<'_>,
    chat_id: String,
    tab_id: String,
) -> Result<(), AppError> {
    Ok(browser.activate(&chat_id, &tab_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_move(browser: Service<'_>, tab_id: String, index: u32) -> Result<(), AppError> {
    Ok(browser.move_tab(&tab_id, index as usize)?)
}

/// Loads what was typed in the address bar; answers the address it became.
#[tauri::command]
#[specta::specta]
pub async fn browser_navigate(
    browser: Service<'_>,
    tab_id: String,
    input: String,
) -> Result<String, AppError> {
    Ok(browser.inner().navigate(&tab_id, &input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_go(browser: Service<'_>, tab_id: String, action: GoAction) -> Result<(), AppError> {
    Ok(browser.inner().go(&tab_id, action).await?)
}

/// Shows a tab's page over the panel's page area (`rect`, in the window's CSS pixels), or hides
/// whatever page shows (`tab_id` or `rect` absent, or `visible` false).
#[tauri::command]
#[specta::specta]
pub async fn browser_place(
    browser: Service<'_>,
    tab_id: Option<String>,
    rect: Option<BrowserRect>,
    visible: bool,
) -> Result<(), AppError> {
    Ok(browser.inner().place(tab_id, rect, visible).await?)
}

/// The page as shown, as a JPEG data URL, for the panel to stand in for the page while something
/// opens over it (`None` where the engine cannot take one).
#[tauri::command]
#[specta::specta]
pub async fn browser_capture(browser: Service<'_>, tab_id: String) -> Result<Option<String>, AppError> {
    Ok(browser.inner().capture(&tab_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_zoom(browser: Service<'_>, tab_id: String, zoom: f64) -> Result<f64, AppError> {
    Ok(browser.inner().set_zoom(&tab_id, zoom).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_devtools(browser: Service<'_>, tab_id: String) -> Result<(), AppError> {
    Ok(browser.inner().devtools(&tab_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn browser_focus(browser: Service<'_>, tab_id: String) -> Result<(), AppError> {
    Ok(browser.inner().focus(&tab_id).await?)
}

/// Turns Annotate's picker on or off in a tab; `accent` and `ink` (`#rrggbb` or `rgb()`) colour
/// its highlight. Answers whether it runs.
#[tauri::command]
#[specta::specta]
pub async fn browser_annotate(
    browser: Service<'_>,
    tab_id: String,
    on: bool,
    accent: String,
    ink: String,
) -> Result<bool, AppError> {
    Ok(browser.inner().annotate(&tab_id, on, &accent, &ink).await?)
}

/// The element at a point of the page (CSS pixels of its viewport).
#[tauri::command]
#[specta::specta]
pub async fn browser_pick_at(
    browser: Service<'_>,
    tab_id: String,
    x: f64,
    y: f64,
) -> Result<Option<PickedElement>, AppError> {
    Ok(browser.inner().pick_at(&tab_id, x, y).await?)
}

/// Pages from history for what is typed in the address bar, best first.
#[tauri::command]
#[specta::specta]
pub async fn browser_suggest(browser: Service<'_>, input: String) -> Result<Vec<HistoryEntry>, AppError> {
    Ok(browser.suggest(&input, 6))
}

/// History, newest first, matching `query`, visited before `before` (paging).
#[tauri::command]
#[specta::specta]
pub async fn browser_history(
    browser: Service<'_>,
    query: String,
    limit: u32,
    before: Option<f64>,
) -> Result<Vec<HistoryEntry>, AppError> {
    Ok(browser.history(&query, limit as usize, before))
}

#[tauri::command]
#[specta::specta]
pub async fn browser_history_remove(browser: Service<'_>, urls: Vec<String>) -> Result<u32, AppError> {
    let removed = browser.remove_history(&urls);
    browser.save();
    Ok(u32::try_from(removed).unwrap_or(u32::MAX))
}

#[tauri::command]
#[specta::specta]
pub async fn browser_clear(browser: Service<'_>, data: ClearData) -> Result<(), AppError> {
    Ok(browser.inner().clear(data).await?)
}

/// Opens an address outside auracode: a web page in the system's browser, or another program's
/// link a page asked for (`mailto:`, `vscode:`), after the person chose to.
#[tauri::command]
#[specta::specta]
pub async fn browser_open_outside(app: tauri::AppHandle, url: String) -> Result<(), AppError> {
    if !outside_allowed(&url) {
        return Err(BrowserError::Invalid("auracode does not open that kind of link.".into()).into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| BrowserError::Unavailable(format!("The link could not open: {error}")).into())
}

/// Link kinds that have been used to run programs or commands on Windows without a prompt, never
/// opened however a page asks.
const DANGEROUS: &[&str] = &[
    "ms-msdt",
    "search-ms",
    "search",
    "ms-officecmd",
    "ms-appinstaller",
    "ms-cxh",
    "ms-cxh-full",
    "ms-word",
    "ms-excel",
    "ms-powerpoint",
    "ms-access",
    "ms-visio",
    "ms-project",
    "ms-publisher",
    "ms-infopath",
    "ms-spd",
    "ms-settings",
    "shell",
    "hcp",
    "its",
    "mk",
    "res",
    "file",
    "javascript",
    "vbscript",
    "data",
    "jar",
];

fn outside_allowed(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return false;
    };
    if url.len() > address::MAX_ADDRESS || url.chars().any(char::is_control) {
        return false;
    }
    let scheme = parsed.scheme();
    match address::policy(url) {
        address::Policy::Open => matches!(scheme, "http" | "https"),
        address::Policy::Outside => !DANGEROUS.contains(&scheme),
        address::Policy::Refuse => false,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_safe_links_leave_auracode() {
        for url in [
            "https://example.com",
            "http://localhost:3000",
            "mailto:someone@example.com",
            "vscode://file/c:/x.ts",
            "slack://open",
        ] {
            assert!(super::outside_allowed(url), "{url}");
        }
        for url in [
            "ms-msdt:/id PCWDiagnostic",
            "search-ms:query=x",
            "ms-officecmd:{}",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "data:text/html,x",
            "not a url",
            "ms-settings:privacy",
        ] {
            assert!(!super::outside_allowed(url), "{url}");
        }
    }
}
