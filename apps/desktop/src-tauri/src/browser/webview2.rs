//! What WebView2 adds on Windows: the engine's own word on back and forward, where a page is and
//! why a load failed, crashed pages, sign-in popups that close themselves, saved sign-ins,
//! clearing browsing data, and the DevTools protocol for screenshots and an agent's real input
//! (trusted clicks and keys, not events a page script makes up).
//!
//! WebView2 is COM: every call is `unsafe` by its bindings. Each is made on the thread that
//! created the page, on a live interface, with arguments that outlive the call.
#![allow(unsafe_code)]

use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use serde_json::{Value, json};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, ClearBrowsingDataCompletedHandler,
    HistoryChangedEventHandler, NavigationCompletedEventHandler, ProcessFailedEventHandler,
    SourceChangedEventHandler, WindowCloseRequestedEventHandler,
};
use windows::core::{BOOL, HSTRING, Interface, PCWSTR, PWSTR};
use wry::WebViewExtWindows;

use super::{Browser, BrowserError, ClearData, GoAction, Shot, host};
use crate::sync::lock;

fn take(text: PWSTR) -> String {
    webview2_com::take_pwstr(text)
}

/// Wires a new page's WebView2 events to its tab, and applies the saved-sign-ins switch.
pub(super) fn attach(webview: &wry::WebView, browser: &Weak<Browser>, tab_id: &str, passwords_on: bool) {
    let core = webview.webview();
    passwords(webview, passwords_on);
    let mut token = 0i64;

    let weak = browser.clone();
    let tab = tab_id.to_owned();
    let history = HistoryChangedEventHandler::create(Box::new(move |sender, _| {
        if let (Some(sender), Some(browser)) = (sender, weak.upgrade()) {
            let (back, forward) = can_go(&sender);
            browser.page_state(&tab, |tab| {
                tab.can_back = back;
                tab.can_forward = forward;
            });
        }
        Ok(())
    }));
    // SAFETY: `core` is this page's live WebView2, used on the thread that created it; the handler
    // owns everything it touches.
    let _ = unsafe { core.add_HistoryChanged(&history, &mut token) };

    let weak = browser.clone();
    let tab = tab_id.to_owned();
    let source = SourceChangedEventHandler::create(Box::new(move |sender, _| {
        if let (Some(sender), Some(browser)) = (sender, weak.upgrade()) {
            let mut uri = PWSTR::null();
            // SAFETY: as above; `uri` is freed by `take`.
            if unsafe { sender.Source(&mut uri) }.is_ok() {
                let url = take(uri);
                if super::address::policy(&url) == super::address::Policy::Open && url != "about:blank" {
                    browser.page_state(&tab, |tab| tab.url = Some(url));
                }
            }
        }
        Ok(())
    }));
    // SAFETY: as above.
    let _ = unsafe { core.add_SourceChanged(&source, &mut token) };

    let weak = browser.clone();
    let tab = tab_id.to_owned();
    let completed = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
        let (Some(args), Some(browser)) = (args, weak.upgrade()) else {
            return Ok(());
        };
        let mut success = BOOL::default();
        let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
        // SAFETY: as above.
        unsafe {
            let _ = args.IsSuccess(&mut success);
            let _ = args.WebErrorStatus(&mut status);
        }
        let error = if success.as_bool() || status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
            None
        } else {
            Some(load_error(status).to_owned())
        };
        browser.page_state(&tab, |tab| {
            tab.error = error;
            tab.loading = false;
        });
        Ok(())
    }));
    // SAFETY: as above.
    let _ = unsafe { core.add_NavigationCompleted(&completed, &mut token) };

    let weak = browser.clone();
    let tab = tab_id.to_owned();
    let failed = ProcessFailedEventHandler::create(Box::new(move |_, args| {
        let (Some(args), Some(browser)) = (args, weak.upgrade()) else {
            return Ok(());
        };
        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
        // SAFETY: as above.
        let _ = unsafe { args.ProcessFailedKind(&mut kind) };
        let whole = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
        let page = whole
            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
        if page {
            let tab = tab.clone();
            let app = browser.app.clone();
            // Never from inside the engine's own event: the page closes on the next turn.
            let _ = app.run_on_main_thread(move || host::crashed(&browser, &tab, whole));
        }
        Ok(())
    }));
    // SAFETY: as above.
    let _ = unsafe { core.add_ProcessFailed(&failed, &mut token) };

    let weak = browser.clone();
    let tab = tab_id.to_owned();
    let close = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
        if let Some(browser) = weak.upgrade() {
            let tab = tab.clone();
            let app = browser.app.clone();
            let _ = app.run_on_main_thread(move || host::close_requested(&browser, &tab));
        }
        Ok(())
    }));
    // SAFETY: as above.
    let _ = unsafe { core.add_WindowCloseRequested(&close, &mut token) };
}

fn can_go(core: &ICoreWebView2) -> (bool, bool) {
    let mut back = BOOL::default();
    let mut forward = BOOL::default();
    // SAFETY: a live WebView2 on its own thread.
    unsafe {
        let _ = core.CanGoBack(&mut back);
        let _ = core.CanGoForward(&mut forward);
    }
    (back.as_bool(), forward.as_bool())
}

/// Reads back and forward again (after a page script reported a move).
pub(super) fn refresh(browser: &Arc<Browser>, tab_id: &str, webview: &wry::WebView) {
    let (back, forward) = can_go(&webview.webview());
    browser.page_state(tab_id, |tab| {
        tab.can_back = back;
        tab.can_forward = forward;
    });
}

fn load_error(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> &'static str {
    match status {
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
        | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE => {
            "Nothing answered at this address. If it is a dev server, check that it is running."
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => "This site's name could not be found.",
        COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "The site took too long to answer.",
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
        | COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => "The connection was lost.",
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID
        | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED
        | COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS => {
            "This site's certificate is not valid, so the page did not open."
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE => {
            "The site answered with something that is not a page."
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => "The site redirected somewhere that failed.",
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED
        | COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED => {
            "The site needs a sign-in the browser could not give."
        }
        _ => "The page could not load.",
    }
}

/// Turns the engine's offer to save sign-ins on or off for a page.
pub(super) fn passwords(webview: &wry::WebView, enabled: bool) {
    // SAFETY: a live WebView2 on its own thread.
    unsafe {
        if let Ok(settings) = webview.webview().Settings()
            && let Ok(settings) = settings.cast::<ICoreWebView2Settings4>()
        {
            let _ = settings.SetIsPasswordAutosaveEnabled(enabled);
            let _ = settings.SetIsGeneralAutofillEnabled(true);
        }
    }
}

pub(super) fn go(webview: &wry::WebView, action: GoAction) {
    let core = webview.webview();
    // SAFETY: a live WebView2 on its own thread.
    unsafe {
        let _ = match action {
            GoAction::Back => core.GoBack(),
            GoAction::Forward => core.GoForward(),
            GoAction::Reload => core.Reload(),
            GoAction::Stop => core.Stop(),
        };
    }
}

pub(super) fn clear(webview: &wry::WebView, data: ClearData) {
    let mut kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(0);
    if data.cookies {
        kinds = kinds | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE;
    }
    if data.cache {
        kinds = kinds | COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
    }
    if data.passwords {
        kinds = kinds
            | COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE
            | COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL;
    }
    if data.history {
        kinds = kinds
            | COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY
            | COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY;
    }
    if kinds.0 == 0 {
        return;
    }
    // SAFETY: a live WebView2 on its own thread; the handler owns nothing.
    unsafe {
        if let Ok(profile) = webview
            .webview()
            .cast::<ICoreWebView2_13>()
            .and_then(|core| core.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
        {
            let _ = profile.ClearBrowsingData(
                kinds,
                &ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(()))),
            );
        }
    }
}

/// Calls a DevTools protocol method; the reply (JSON) or the failure goes to `sender`.
pub(super) fn call(
    webview: &wry::WebView,
    method: &str,
    params: &str,
    sender: tokio::sync::oneshot::Sender<Result<String, String>>,
) {
    let sender = Mutex::new(Some(sender));
    let method = HSTRING::from(method);
    let params = HSTRING::from(params);
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
        if let Some(sender) = lock(&sender).take() {
            let _ = sender.send(result.map(|()| json).map_err(|error| error.message()));
        }
        Ok(())
    }));
    // SAFETY: a live WebView2 on its own thread; the strings outlive the call.
    let started = unsafe {
        webview.webview().CallDevToolsProtocolMethod(
            PCWSTR(method.as_ptr()),
            PCWSTR(params.as_ptr()),
            &handler,
        )
    };
    if let Err(error) = started {
        tracing::debug!(%error, "a DevTools protocol call could not start");
    }
}

/// Runs a DevTools protocol method in a tab's page and answers its reply.
pub(super) async fn devtools(
    browser: &Arc<Browser>,
    tab_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, BrowserError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let tab = tab_id.to_owned();
    let method = method.to_owned();
    let params = params.to_string();
    browser
        .on_main(move |_| host::devtools_call(&tab, &method, &params, sender))
        .await??;
    let reply = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| BrowserError::Timeout)?
        .map_err(|_| BrowserError::Page("The page went away.".into()))?
        .map_err(BrowserError::Page)?;
    serde_json::from_str(&reply)
        .map_err(|_| BrowserError::Page("The engine answered with something unreadable.".into()))
}

/// A screenshot of a tab's page, base64 (JPEG for the viewport, PNG otherwise).
pub(super) async fn screenshot(browser: &Arc<Browser>, tab_id: &str, shot: Shot) -> Result<String, BrowserError> {
    let params = match shot {
        Shot::Viewport { quality } => json!({
            "format": "jpeg",
            "quality": quality.min(100),
            "fromSurface": true,
        }),
        Shot::FullPage => {
            let metrics = devtools(browser, tab_id, "Page.getLayoutMetrics", json!({})).await?;
            let size = &metrics["cssContentSize"];
            let width = size["width"].as_f64().unwrap_or(1280.0).clamp(1.0, 4096.0);
            let height = size["height"].as_f64().unwrap_or(800.0).clamp(1.0, 16_000.0);
            json!({
                "format": "png",
                "captureBeyondViewport": true,
                "fromSurface": true,
                "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": 1 },
            })
        }
        Shot::Clip { x, y, width, height } => {
            let metrics = devtools(browser, tab_id, "Page.getLayoutMetrics", json!({})).await?;
            let viewport = &metrics["cssVisualViewport"];
            let left = viewport["pageX"].as_f64().unwrap_or(0.0);
            let top = viewport["pageY"].as_f64().unwrap_or(0.0);
            json!({
                "format": "png",
                "fromSurface": true,
                "captureBeyondViewport": true,
                "clip": {
                    "x": (x + left).max(0.0),
                    "y": (y + top).max(0.0),
                    "width": width.clamp(1.0, 4096.0),
                    "height": height.clamp(1.0, 8192.0),
                    "scale": 1,
                },
            })
        }
    };
    let reply = devtools(browser, tab_id, "Page.captureScreenshot", params).await?;
    reply["data"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| BrowserError::Page("The engine took no screenshot.".into()))
}

/// The DevTools protocol's modifier bits.
pub(super) fn modifier_bits(modifiers: &[String]) -> u32 {
    modifiers.iter().fold(0, |bits, name| {
        bits | match name.as_str() {
            "Alt" => 1,
            "Control" => 2,
            "Meta" => 4,
            "Shift" => 8,
            _ => 0,
        }
    })
}

/// A real mouse click at a point of the viewport (CSS pixels).
pub(super) async fn click(
    browser: &Arc<Browser>,
    tab_id: &str,
    x: f64,
    y: f64,
    button: &str,
    count: u32,
    modifiers: u32,
) -> Result<(), BrowserError> {
    let point = |kind: &str, clicks: u32| {
        json!({
            "type": kind,
            "x": x,
            "y": y,
            "button": button,
            "buttons": if kind == "mousePressed" { 1 } else { 0 },
            "clickCount": clicks,
            "modifiers": modifiers,
        })
    };
    devtools(browser, tab_id, "Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y, "modifiers": modifiers })).await?;
    for clicks in 1..=count.clamp(1, 3) {
        devtools(browser, tab_id, "Input.dispatchMouseEvent", point("mousePressed", clicks)).await?;
        devtools(browser, tab_id, "Input.dispatchMouseEvent", point("mouseReleased", clicks)).await?;
    }
    Ok(())
}

pub(super) async fn hover(browser: &Arc<Browser>, tab_id: &str, x: f64, y: f64) -> Result<(), BrowserError> {
    devtools(browser, tab_id, "Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y })).await?;
    Ok(())
}

/// Types `text` where the page's focus is, as one insertion (what a paste or an input method does).
pub(super) async fn insert(browser: &Arc<Browser>, tab_id: &str, text: &str) -> Result<(), BrowserError> {
    devtools(browser, tab_id, "Input.insertText", json!({ "text": text })).await?;
    Ok(())
}

/// One key's DevTools description: its `code`, Windows virtual key and the text it types.
pub(super) fn key_definition(key: &str) -> Option<(String, String, u32, Option<String>)> {
    let named = |key: &str, code: &str, vk: u32, text: Option<&str>| {
        Some((key.to_owned(), code.to_owned(), vk, text.map(str::to_owned)))
    };
    match key {
        "Enter" => named("Enter", "Enter", 13, Some("\r")),
        "Tab" => named("Tab", "Tab", 9, None),
        "Escape" | "Esc" => named("Escape", "Escape", 27, None),
        "Backspace" => named("Backspace", "Backspace", 8, None),
        "Delete" => named("Delete", "Delete", 46, None),
        "Insert" => named("Insert", "Insert", 45, None),
        "ArrowUp" | "Up" => named("ArrowUp", "ArrowUp", 38, None),
        "ArrowDown" | "Down" => named("ArrowDown", "ArrowDown", 40, None),
        "ArrowLeft" | "Left" => named("ArrowLeft", "ArrowLeft", 37, None),
        "ArrowRight" | "Right" => named("ArrowRight", "ArrowRight", 39, None),
        "Home" => named("Home", "Home", 36, None),
        "End" => named("End", "End", 35, None),
        "PageUp" => named("PageUp", "PageUp", 33, None),
        "PageDown" => named("PageDown", "PageDown", 34, None),
        "Space" | " " => named(" ", "Space", 32, Some(" ")),
        "Control" | "Ctrl" => named("Control", "ControlLeft", 17, None),
        "Shift" => named("Shift", "ShiftLeft", 16, None),
        "Alt" => named("Alt", "AltLeft", 18, None),
        "Meta" | "Cmd" | "Command" => named("Meta", "MetaLeft", 91, None),
        _ => {
            if let Some(number) = key.strip_prefix('F')
                && let Ok(number) = number.parse::<u32>()
                && (1..=12).contains(&number)
            {
                return named(key, key, 111 + number, None);
            }
            let mut chars = key.chars();
            let (Some(ch), None) = (chars.next(), chars.next()) else {
                return None;
            };
            let text = Some(ch.to_string());
            if ch.is_ascii_alphabetic() {
                let upper = ch.to_ascii_uppercase();
                Some((key.to_owned(), format!("Key{upper}"), upper as u32, text))
            } else if ch.is_ascii_digit() {
                Some((key.to_owned(), format!("Digit{ch}"), ch as u32, text))
            } else {
                Some((key.to_owned(), String::new(), 0, text))
            }
        }
    }
}

/// Presses a key or a chord (`Enter`, `Control+a`, `Shift+Tab`) with real key events.
pub(super) async fn press(browser: &Arc<Browser>, tab_id: &str, chord: &str) -> Result<(), BrowserError> {
    let parts: Vec<String> = if let Some(head) = chord.strip_suffix("++") {
        head.split('+').map(str::to_owned).chain(["+".to_owned()]).collect()
    } else {
        chord.split('+').map(str::to_owned).collect()
    };
    let (main, held) = parts
        .split_last()
        .ok_or_else(|| BrowserError::Invalid("Name a key to press.".into()))?;
    let mut held_defs = Vec::new();
    for name in held {
        let definition = key_definition(name)
            .filter(|(key, ..)| matches!(key.as_str(), "Control" | "Shift" | "Alt" | "Meta"))
            .ok_or_else(|| BrowserError::Invalid(format!("{name} is not a modifier key.")))?;
        held_defs.push(definition);
    }
    let (key, code, vk, text) = key_definition(main)
        .ok_or_else(|| BrowserError::Invalid(format!("{main} is not a key auracode knows.")))?;
    let modifiers = modifier_bits(
        &held_defs
            .iter()
            .map(|(key, ..)| key.clone())
            .collect::<Vec<_>>(),
    );
    let mut bits = 0;
    for (key, code, vk, _) in &held_defs {
        bits |= modifier_bits(std::slice::from_ref(key));
        devtools(
            browser,
            tab_id,
            "Input.dispatchKeyEvent",
            json!({ "type": "rawKeyDown", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": bits }),
        )
        .await?;
    }
    // A chord with Control, Alt or Meta types nothing.
    let types = text.filter(|_| modifiers & 0b0111 == 0);
    let mut down = json!({
        "type": if types.is_some() { "keyDown" } else { "rawKeyDown" },
        "key": key,
        "code": code,
        "windowsVirtualKeyCode": vk,
        "nativeVirtualKeyCode": vk,
        "modifiers": modifiers,
    });
    if let Some(text) = &types {
        down["text"] = json!(text);
        down["unmodifiedText"] = json!(text);
    }
    devtools(browser, tab_id, "Input.dispatchKeyEvent", down).await?;
    devtools(
        browser,
        tab_id,
        "Input.dispatchKeyEvent",
        json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers }),
    )
    .await?;
    for (key, code, vk, _) in held_defs.iter().rev() {
        bits &= !modifier_bits(std::slice::from_ref(key));
        devtools(
            browser,
            tab_id,
            "Input.dispatchKeyEvent",
            json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": bits }),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_described_as_the_protocol_wants() {
        assert_eq!(
            key_definition("Enter"),
            Some(("Enter".into(), "Enter".into(), 13, Some("\r".into())))
        );
        assert_eq!(
            key_definition("a"),
            Some(("a".into(), "KeyA".into(), 65, Some("a".into())))
        );
        assert_eq!(
            key_definition("7"),
            Some(("7".into(), "Digit7".into(), 55, Some("7".into())))
        );
        assert_eq!(key_definition("F5").map(|(_, _, vk, _)| vk), Some(116));
        assert_eq!(key_definition("Esc").map(|(key, ..)| key), Some("Escape".into()));
        assert_eq!(key_definition("NotAKey"), None);
        assert_eq!(
            modifier_bits(&["Control".into(), "Shift".into()]),
            2 | 8
        );
    }
}
