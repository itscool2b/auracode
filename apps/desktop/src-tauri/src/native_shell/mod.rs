//! Native long-run shell. Session status feeds it even when no webview is attached.

mod model;
#[cfg(any(windows, target_os = "macos"))]
mod power;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use aura_core::session::{SinkGone, StatusSink};
use aura_protocol::session::ChatStatusUpdate;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, watch};

use crate::state::AppState;
use crate::sync::lock;
use model::{Activity, Counts, Notice};

const OWNER: &str = "auracode-native-shell";
const TRAY: &str = "auracode-main";
const OPEN: &str = "auracode-open";
const QUIT: &str = "auracode-quit";
pub const OPEN_CHAT_EVENT: &str = "auracode-open-chat";

pub struct NativeShell {
    activity: Mutex<Activity>,
    counts: watch::Sender<Counts>,
    notices: mpsc::Sender<(String, Notice)>,
    stopped: watch::Sender<bool>,
    tray_ready: AtomicBool,
    pending_chat: Mutex<Option<String>>,
    notification_id: AtomicU32,
    #[cfg(any(windows, target_os = "macos"))]
    power: Mutex<Option<power::Power>>,
}

impl NativeShell {
    pub fn active_work_count(&self) -> usize {
        lock(&self.activity).work_count()
    }

    pub fn shutdown(&self) {
        self.stopped.send_replace(true);
        #[cfg(any(windows, target_os = "macos"))]
        if let Some(mut power) = lock(&self.power).take() {
            power.stop();
        }
    }

    fn open_chat(&self, app: &tauri::AppHandle, chat: &str) {
        // IDs originate in our own notification payload, never a path or an executable command.
        if chat.is_empty() || chat.len() > 256 || chat.chars().any(char::is_control) {
            return;
        }
        *lock(&self.pending_chat) = Some(chat.to_owned());
        crate::window::focus_main(app);
        let _ = app.emit(OPEN_CHAT_EVENT, ());
    }
}

impl StatusSink for NativeShell {
    fn send(&self, update: &ChatStatusUpdate) -> Result<(), SinkGone> {
        if *self.stopped.borrow() {
            return Err(SinkGone);
        }
        let (counts, notice) = lock(&self.activity).update(update);
        self.counts.send_if_modified(|current| {
            if *current == counts {
                false
            } else {
                *current = counts;
                true
            }
        });
        if let Some(notice) = notice {
            // Never stall an agent's actor for an OS notification. The current attention badge
            // remains authoritative even if an extreme burst fills the notification queue.
            if self
                .notices
                .try_send((update.chat_id.clone(), notice))
                .is_err()
            {
                tracing::debug!("native notification queue is full; retaining the attention badge");
            }
        }
        Ok(())
    }
    fn owner(&self) -> &str {
        OWNER
    }
}

/// Called after AppState is managed and before a webview can start a chat. Smoke launches leave
/// real tray, power and notification services disabled.
pub fn setup(app: &tauri::AppHandle) {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let state = app.state::<AppState>();
        let Some(chats) = state.chats().filter(|_| !state.launch.is_smoke()) else {
            return;
        };
        let (counts, mut changes) = watch::channel(Counts::default());
        let (notices, mut notifications) = mpsc::channel(64);
        let (stopped, mut stopping) = watch::channel(false);
        let shell = Arc::new(NativeShell {
            activity: Mutex::new(Activity::default()),
            counts,
            notices,
            stopped,
            tray_ready: AtomicBool::new(false),
            pending_chat: Mutex::new(None),
            notification_id: AtomicU32::new(0),
            power: Mutex::new(Some(power::Power::start())),
        });
        chats.manager.status_subscribe(shell.clone());
        app.manage(Arc::clone(&shell));
        match install_tray(app) {
            Ok(()) => shell.tray_ready.store(true, Ordering::Release),
            Err(error) => {
                tracing::warn!(%error, "the tray is unavailable; closing the window will quit safely")
            }
        }
        install_notification_actions(app);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut was_active = false;
            loop {
                tokio::select! {
                    biased;
                    _ = async { let _ = stopping.wait_for(|stop| *stop).await; } => break,
                    changed = changes.changed() => {
                        if changed.is_err() { break; }
                        let counts = *changes.borrow_and_update();
                        let active = counts.active > 0;
                        if active != was_active {
                            if let Some(power) = lock(&shell.power).as_ref() { power.set(active); }
                            was_active = active;
                        }
                        update_tray(&app, counts);
                    }
                    notice = notifications.recv() => match notice {
                        Some((chat, notice)) => show_notification(&app, &chat, notice),
                        None => break,
                    }
                }
            }
            shell.shutdown();
        });
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = app;
}

/// True only after the tray was successfully installed. Without a visible way back, the window
/// uses the ordinary quit path instead of hiding an unreachable application.
pub fn close_to_tray(app: &tauri::AppHandle) -> bool {
    let Some(shell) = app.try_state::<Arc<NativeShell>>() else {
        return false;
    };
    if !shell.tray_ready.load(Ordering::Acquire) {
        return false;
    }
    if app
        .try_state::<AppState>()
        .is_some_and(|state| state.quit.is_quitting())
    {
        return false;
    }
    let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW) else {
        return false;
    };
    match window.hide() {
        Ok(()) => {
            crate::window::set_webview_visible(app, false);
            true
        }
        Err(error) => {
            tracing::warn!(%error, "could not hide the main window to the tray");
            false
        }
    }
}

/// Drain-on-read makes notification navigation survive a suspended or reloaded webview. The UI
/// calls this on startup, focus, and `auracode-open-chat` and selects the returned local chat ID.
#[tauri::command]
#[specta::specta]
pub fn shell_take_navigation(app: tauri::AppHandle) -> Option<String> {
    app.try_state::<Arc<NativeShell>>()
        .and_then(|shell| lock(&shell.pending_chat).take())
}

#[cfg(any(windows, target_os = "macos"))]
fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, OPEN, "Open auracode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit auracode", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("application tray icon".into()))?;
    let tray = TrayIconBuilder::with_id(TRAY)
        .icon(icon.clone())
        .menu(&menu)
        .tooltip("auracode")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => crate::window::focus_main(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                crate::window::focus_main(tray.app_handle());
            }
        });
    tray.build(app)?;
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
fn update_tray(app: &tauri::AppHandle, counts: Counts) {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_tooltip(Some(model::tooltip(counts)));
        let count = counts.attention.max(counts.active);
        let title = (count > 0).then(|| count.to_string());
        let _ = tray.set_title(title);
        if let Some(base) = app.default_window_icon() {
            let _ = tray.set_icon(Some(badged_icon(base, counts)));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW) {
        let count = counts.attention.max(counts.active);
        let _ = window.set_badge_count((count > 0).then_some(count as i64));
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn badged_icon(base: &tauri::image::Image<'_>, counts: Counts) -> tauri::image::Image<'static> {
    let (width, height) = (base.width(), base.height());
    let mut pixels = base.rgba().to_vec();
    if (counts.active > 0 || counts.attention > 0) && width >= 8 && height >= 8 {
        let radius = width.min(height) / 5;
        let (cx, cy) = (width - radius - 1, height - radius - 1);
        let color = if counts.attention > 0 {
            [244, 181, 77, 255]
        } else {
            [94, 169, 255, 255]
        };
        for y in cy.saturating_sub(radius)..=(cy + radius).min(height - 1) {
            for x in cx.saturating_sub(radius)..=(cx + radius).min(width - 1) {
                let (dx, dy) = (i64::from(x) - i64::from(cx), i64::from(y) - i64::from(cy));
                if dx * dx + dy * dy <= i64::from(radius).pow(2) {
                    let start = (u64::from(y) * u64::from(width) + u64::from(x)) * 4;
                    if let Ok(start) = usize::try_from(start)
                        && let Some(pixel) = pixels.get_mut(start..start.saturating_add(4))
                    {
                        pixel.copy_from_slice(&color);
                    }
                }
            }
        }
    }
    tauri::image::Image::new_owned(pixels, width, height)
}

#[cfg(any(windows, target_os = "macos"))]
fn install_notification_actions(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let handler_app = app.clone();
    if let Err(error) = app.notification().on_action(move |action| {
        if action.action_id() != "tap" {
            return;
        }
        let chat = action
            .notification()
            .and_then(|notice| notice.extra().get("chat_id"))
            .and_then(serde_json::Value::as_str);
        if let Some(chat) = chat
            && let Some(shell) = handler_app.try_state::<Arc<NativeShell>>()
        {
            shell.open_chat(&handler_app, chat);
        }
    }) {
        tracing::warn!(%error, "notification click navigation is unavailable");
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn show_notification(app: &tauri::AppHandle, chat: &str, notice: Notice) {
    use tauri_plugin_notification::NotificationExt;
    if app
        .try_state::<AppState>()
        .is_some_and(|state| state.quit.is_quitting())
    {
        return;
    }
    let foreground = app
        .get_webview_window(crate::window::MAIN_WINDOW)
        .is_some_and(|window| {
            window.is_visible().unwrap_or(true)
                && !window.is_minimized().unwrap_or(false)
                && window.is_focused().unwrap_or(true)
        });
    if foreground {
        return;
    }
    let Some(shell) = app.try_state::<Arc<NativeShell>>() else {
        return;
    };
    if !lock(&shell.activity).notice_is_current(chat, notice) {
        return;
    }
    let id = (shell.notification_id.fetch_add(1, Ordering::Relaxed) % i32::MAX as u32 + 1) as i32;
    if let Err(error) = app
        .notification()
        .builder()
        .id(id)
        .title(notice.title())
        .body("Open auracode to view the chat.")
        .extra("chat_id", chat)
        .show()
    {
        tracing::warn!(%error, "could not send a native notification");
    }
}
