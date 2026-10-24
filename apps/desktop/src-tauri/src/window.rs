//! The main window: created hidden with the chosen glass, shown once the UI has painted.
//!
//! The window is built in Rust (`"create": false` in tauri.conf.json) because its material and
//! transparency depend on the OS version, which config alone cannot express. It starts hidden so
//! the first thing on screen is a painted UI rather than an empty transparent frame; the page calls
//! `window_ready` after its first paint, and a fallback shows the window after
//! [`READY_FALLBACK`] anyway, so a broken frontend can never leave an invisible app running.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::window::Color;
use tauri::{AppHandle, Manager, Url, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

use crate::error::{AppError, AppErrorCode};
use crate::glass::GlassPlan;
use crate::state::AppState;

/// Label of the one window M0 has.
pub const MAIN_WINDOW: &str = "main";

/// How long the page gets to report its first paint before the window is shown regardless.
pub const READY_FALLBACK: Duration = Duration::from_secs(3);

/// `--aura-base` from tokens.css, behind opaque windows (and the webview before it paints).
pub const BASE_COLOR: Color = Color(7, 7, 10, 255);

/// What the window-state plugin restores: size, position, maximized, fullscreen. Never visibility
/// (that would show the window before first paint) and never decorations (code owns the chrome).
pub fn restored_state() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

/// Shows the window at most once: the first of "page ready" and "fallback timer" wins.
#[derive(Debug, Default)]
pub struct ShowOnce(AtomicBool);

impl ShowOnce {
    /// True for the first caller only.
    pub fn claim(&self) -> bool {
        !self.0.swap(true, Ordering::AcqRel)
    }

    /// Gives the claim back after showing failed, so a later attempt can retry.
    pub fn release(&self) {
        self.0.store(false, Ordering::Release);
    }

    pub fn is_claimed(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Builds the main window from its config entry with `plan`'s glass, hidden.
pub fn create_main(
    app: &tauri::App,
    plan: &GlassPlan,
) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
        .ok_or("tauri.conf.json has no window labelled \"main\"")?;

    // In development the page comes from the Vite dev server; in a build it is served by Tauri.
    let dev_url = if tauri::is_dev() {
        app.config().build.dev_url.clone()
    } else {
        None
    };
    let origin = AppOrigin::current(config.use_https_scheme);
    let handle = app.handle().clone();

    let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .visible(false)
        .transparent(plan.transparent)
        .on_navigation(move |url| {
            let allowed = is_app_url(url, origin, dev_url.as_ref());
            if !allowed {
                leave_for_browser(&handle, url);
            }
            allowed
        })
        .on_page_load(|window, payload| {
            // A reload or navigation starts a new page whose channels are not the old page's: stop
            // the old page's streams instead of streaming into nothing until they finish.
            if payload.event() == PageLoadEvent::Started
                && let Some(state) = window.try_state::<AppState>()
            {
                let stopped = state.demos.cancel_all();
                if stopped > 0 {
                    tracing::debug!(stopped, "page reloaded; cancelled its demo streams");
                }
            }
        });

    if plan.transparent {
        if !plan.effects.is_empty() {
            builder = builder.effects(tauri::utils::config::WindowEffectsConfig {
                effects: plan.effects.clone(),
                ..Default::default()
            });
        }
    } else {
        builder = builder.background_color(BASE_COLOR);
    }

    // Avoids the white flash a transparent window shows on Windows before its first paint.
    #[cfg(windows)]
    {
        builder = builder.no_redirection_bitmap(plan.transparent);
    }

    Ok(builder.build()?)
}

/// Shows and focuses the main window the first time it is called (later calls do nothing, so a
/// page reload does not steal focus again). Returns whether this call showed it.
pub fn show_main_once(app: &AppHandle, once: &ShowOnce) -> Result<bool, AppError> {
    if !once.claim() {
        return Ok(false);
    }
    match show_and_focus(app) {
        Ok(()) => Ok(true),
        Err(error) => {
            once.release();
            Err(error)
        }
    }
}

/// Brings the main window forward: a second launch of the app lands here.
pub fn focus_main(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.window_shown.claim();
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW)
        && window.is_minimized().unwrap_or(false)
        && let Err(error) = window.unminimize()
    {
        tracing::warn!(%error, "could not restore the minimized window");
    }
    if let Err(error) = show_and_focus(app) {
        tracing::warn!(%error, "could not focus the main window for a second launch");
    }
}

pub fn show_and_focus(app: &AppHandle) -> Result<(), AppError> {
    let window = app.get_webview_window(MAIN_WINDOW).ok_or_else(|| {
        AppError::new(
            AppErrorCode::WindowUnavailable,
            "The main window is not available.",
        )
    })?;
    let unavailable =
        |error: tauri::Error| AppError::new(AppErrorCode::WindowUnavailable, error.to_string());
    window.show().map_err(unavailable)?;
    window.set_focus().map_err(unavailable)?;
    Ok(())
}

/// Waits `delay`, then claims `once` and calls `show`, unless something else showed the window
/// first. Returns whether the window was shown here. Generic over `show` so the timing is testable
/// without a window.
pub async fn show_after(
    delay: Duration,
    once: Arc<ShowOnce>,
    show: impl FnOnce() -> Result<(), AppError> + Send + 'static,
) -> bool {
    tokio::time::sleep(delay).await;
    if !once.claim() {
        return false;
    }
    match show() {
        Ok(()) => true,
        Err(error) => {
            once.release();
            tracing::error!(%error, "could not show the main window");
            false
        }
    }
}

/// Where Tauri serves the app's own pages in a build, which differs by platform and is exactly
/// one origin per window: `tauri://localhost` on macOS and Linux; on Windows (where WebView2 needs
/// an http(s) host for custom protocols) `http://tauri.localhost`, or `https://tauri.localhost`
/// when the window sets `useHttpsScheme`. Tauri serves nothing at the other three, so a navigation
/// there goes to whatever the name resolves to (loopback, under Chromium and systemd-resolved), and
/// a local server could then replace the whole window with a lookalike page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppOrigin {
    scheme: &'static str,
    host: &'static str,
}

impl AppOrigin {
    /// The origin for a window on Windows (`windows`) or elsewhere, with its `useHttpsScheme`.
    pub const fn new(windows: bool, use_https_scheme: bool) -> AppOrigin {
        match (windows, use_https_scheme) {
            (false, _) => AppOrigin {
                scheme: "tauri",
                host: "localhost",
            },
            (true, false) => AppOrigin {
                scheme: "http",
                host: "tauri.localhost",
            },
            (true, true) => AppOrigin {
                scheme: "https",
                host: "tauri.localhost",
            },
        }
    }

    /// The origin on this platform for a window configured with `use_https_scheme`.
    pub const fn current(use_https_scheme: bool) -> AppOrigin {
        AppOrigin::new(cfg!(windows), use_https_scheme)
    }

    /// Same scheme and host, on the default port (Tauri never serves on another one).
    fn serves(&self, url: &Url) -> bool {
        url.scheme() == self.scheme && url.host_str() == Some(self.host) && url.port().is_none()
    }
}

/// Whether the main webview may navigate to `url`: only the app's own pages, served from `app` in a
/// build or from the Vite dev server (`dev_url`) in development.
pub fn is_app_url(url: &Url, app: AppOrigin, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "about" => url.as_str() == "about:blank",
        _ => app.serves(url) || dev_url.is_some_and(|dev| same_origin(url, dev)),
    }
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// A blocked navigation to the web opens in the browser instead; anything else (`file:`, custom
/// schemes) is only logged.
fn leave_for_browser(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        tracing::info!(%url, "opening an external link in the browser");
        if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
            tracing::warn!(%error, %url, "could not open the link in the browser");
        }
    } else {
        tracing::warn!(%url, "blocked navigation away from the app");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("url")
    }

    #[test]
    fn only_the_first_claim_wins() {
        let once = ShowOnce::default();
        assert!(!once.is_claimed());
        assert!(once.claim());
        assert!(!once.claim());
        assert!(once.is_claimed());
        once.release();
        assert!(once.claim(), "a released claim can be taken again");
    }

    #[tokio::test(start_paused = true)]
    async fn the_fallback_shows_a_window_the_page_never_reported() {
        let once = Arc::new(ShowOnce::default());
        let shown = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&shown);
        let started = tokio::time::Instant::now();
        let fired = show_after(READY_FALLBACK, Arc::clone(&once), move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await;
        assert!(fired);
        assert_eq!(shown.load(Ordering::SeqCst), 1);
        assert_eq!(started.elapsed(), READY_FALLBACK);
        assert!(once.is_claimed(), "a later window_ready is a no-op");
    }

    #[tokio::test(start_paused = true)]
    async fn the_fallback_stays_quiet_after_the_page_reported() {
        let once = Arc::new(ShowOnce::default());
        let fallback = tokio::spawn(show_after(READY_FALLBACK, Arc::clone(&once), || {
            panic!("the window was already shown");
        }));
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(once.claim(), "the page's window_ready claims first");
        assert!(!fallback.await.expect("join"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_fallback_releases_the_claim() {
        let once = Arc::new(ShowOnce::default());
        let fired = show_after(READY_FALLBACK, Arc::clone(&once), || {
            Err(AppError::new(AppErrorCode::WindowUnavailable, "gone"))
        })
        .await;
        assert!(!fired);
        assert!(!once.is_claimed(), "a later window_ready may still try");
    }

    /// The three origins Tauri can serve a window from, whatever platform the test runs on.
    const MACOS_LINUX: AppOrigin = AppOrigin::new(false, false);
    const WINDOWS: AppOrigin = AppOrigin::new(true, false);
    const WINDOWS_HTTPS: AppOrigin = AppOrigin::new(true, true);
    const ALL: [AppOrigin; 3] = [MACOS_LINUX, WINDOWS, WINDOWS_HTTPS];

    #[test]
    fn app_pages_are_allowed() {
        for (origin, page) in [
            (MACOS_LINUX, "tauri://localhost"),
            (MACOS_LINUX, "tauri://localhost/index.html"),
            (WINDOWS, "http://tauri.localhost/"),
            (WINDOWS, "http://tauri.localhost:80/assets/x.js"),
            (WINDOWS_HTTPS, "https://tauri.localhost/assets/x.js"),
        ] {
            assert!(is_app_url(&url(page), origin, None), "{page} on {origin:?}");
        }
        let dev = url("http://localhost:1420");
        for origin in ALL {
            assert!(is_app_url(
                &url("http://localhost:1420/?stress=1"),
                origin,
                Some(&dev)
            ));
            assert!(is_app_url(&url("about:blank"), origin, None));
        }
    }

    #[test]
    fn origins_tauri_does_not_serve_on_this_platform_are_blocked() {
        // One origin per platform and window: the others are not Tauri's, and a server listening
        // where they resolve could replace the whole window.
        for (origin, page) in [
            (MACOS_LINUX, "http://tauri.localhost/"),
            (MACOS_LINUX, "https://tauri.localhost/"),
            (MACOS_LINUX, "tauri://localhost:1/"),
            (WINDOWS, "https://tauri.localhost/"),
            (WINDOWS, "tauri://localhost/"),
            (WINDOWS, "http://tauri.localhost:8080/"),
            (WINDOWS_HTTPS, "http://tauri.localhost/"),
            (WINDOWS_HTTPS, "tauri://localhost/"),
            (WINDOWS_HTTPS, "https://tauri.localhost:8443/"),
        ] {
            assert!(
                !is_app_url(&url(page), origin, None),
                "{page} on {origin:?}"
            );
        }
    }

    #[test]
    fn this_platform_uses_its_own_origin() {
        let served = if cfg!(windows) {
            "http://tauri.localhost/"
        } else {
            "tauri://localhost/"
        };
        assert!(is_app_url(&url(served), AppOrigin::current(false), None));
        assert_eq!(AppOrigin::current(true) == WINDOWS_HTTPS, cfg!(windows));
    }

    #[test]
    fn everything_else_is_blocked() {
        let dev = url("http://localhost:1420");
        for blocked in [
            "https://auracode.si/docs",
            "http://localhost:1421/",
            "https://localhost:1420/",
            "http://evil.tauri.localhost.example/",
            "http://tauri.localhost.evil.example/",
            "tauri://evil/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "about:srcdoc",
            "mailto:someone@example.com",
        ] {
            for origin in ALL {
                assert!(
                    !is_app_url(&url(blocked), origin, Some(&dev)),
                    "{blocked} on {origin:?}"
                );
            }
        }
        // Without a dev server (a release build), localhost is not the app.
        for origin in ALL {
            assert!(!is_app_url(&url("http://localhost:1420/"), origin, None));
        }
    }

    #[test]
    fn the_restored_state_never_includes_visibility() {
        let flags = restored_state();
        assert!(!flags.contains(StateFlags::VISIBLE));
        assert!(!flags.contains(StateFlags::DECORATIONS));
        assert!(flags.contains(StateFlags::SIZE | StateFlags::POSITION));
    }
}
