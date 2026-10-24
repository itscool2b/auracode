//! The auracode desktop shell: the Tauri window, the plugins, and typed commands and channels over
//! aura-core and aura-drivers. Everything that is not UI stays in Rust; this crate is the thin layer
//! that exposes it to the React UI in `apps/desktop/src`.
//!
//! Startup ([`run`]): logging, launch switches from the environment, the plugins (single-instance
//! first), then `setup` runs aura-core's startup sequence (failures become an error screen, never a
//! crash), picks the window glass for this OS, creates the main window hidden, and arms the
//! fallback that shows it if the page never reports its first paint. If no window can be created
//! at all, `setup` logs why and the app exits with [`STARTUP_FAILED`].

pub mod bindings;
pub mod boot;
pub mod commands;
pub mod demo;
pub mod error;
pub mod glass;
pub mod launch;
pub mod os;
pub mod reveal;
pub mod smoke;
pub mod state;
mod sync;
pub mod window;

#[cfg(test)]
mod config_checks;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::{Manager, RunEvent};

use crate::glass::{GlassEffect, GlassPlan};
use crate::launch::LaunchOptions;
use crate::state::AppState;

/// Log filter when `RUST_LOG` is unset.
const DEFAULT_LOG_FILTER: &str = "info";

/// The exit code when auracode cannot start: Tauri failed to initialize, or no window could be
/// created.
pub const STARTUP_FAILED: i32 = 1;

/// Runs auracode until it exits. If the app cannot start at all (Tauri fails to initialize, or no
/// window can be created), the error is logged and the process exits with [`STARTUP_FAILED`].
pub fn run() {
    init_tracing();
    let launch = LaunchOptions::from_env();

    #[cfg(debug_assertions)]
    match bindings::export() {
        Ok(true) => tracing::info!(
            path = bindings::BINDINGS_PATH,
            "regenerated the TypeScript bindings"
        ),
        Ok(false) => {}
        Err(error) => tracing::warn!(%error, "could not regenerate the TypeScript bindings"),
    }

    let commands = bindings::builder();
    let mut builder = tauri::Builder::default();
    // First, so a second launch hands over to the running instance before anything else starts.
    // Smoke runs skip it: an automated check has to run even while someone has auracode open.
    if !launch.smoke {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::focus_main(app);
        }));
    }
    let app = builder
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window::restored_state())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(commands.invoke_handler())
        .setup(move |app| {
            setup(app, launch);
            // Never an error: see `setup`.
            Ok(())
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(on_event),
        Err(error) => {
            tracing::error!(%error, "auracode could not start");
            std::process::exit(STARTUP_FAILED);
        }
    }
}

/// Runs once Tauri's event loop has started. Returns nothing on purpose: Tauri calls the setup hook
/// from inside its event loop and panics on an error (`Failed to setup app`), so the error would
/// never reach our log, the panic would unwind through the platform's event loop, and the exit
/// hooks would never run. So every failure is handled here: startup problems become the error
/// screen (`boot`), and a window that cannot be created at all is logged and ends the app with
/// [`STARTUP_FAILED`].
fn setup(app: &mut tauri::App, launch: LaunchOptions) {
    let root = boot::choose_root(boot::data_dir_overridden(), app.path().app_data_dir().ok());
    let booted = boot::boot(root);

    let os = os::OsInfo::detect();
    let plan = glass::plan(os.os, os.version, launch.no_glass);
    let glass = match create_window(app, &plan) {
        Ok(glass) => glass,
        Err(error) => {
            tracing::error!(%error, "auracode could not create its window");
            if launch.smoke {
                smoke::print(&smoke::finalize(smoke::no_window(&error.to_string())));
            }
            // Queued for the event loop, which handles it right after this hook returns; the exit
            // hooks run as for any other exit.
            app.handle().exit(STARTUP_FAILED);
            return;
        }
    };
    tracing::info!(os = os.os, version = %os.display, ?glass, "main window created");

    let smoke = launch.smoke;
    let smoke_exit = launch.smoke_exit;
    let version = app.package_info().version.to_string();
    let state = AppState::new(booted, &os, glass, launch, version);
    let shown = Arc::clone(&state.window_shown);
    let reported = Arc::clone(&state.smoke_reported);
    app.manage(state);

    let handle = app.handle().clone();
    tauri::async_runtime::spawn(window::show_after(
        window::READY_FALLBACK,
        shown,
        move || {
            tracing::warn!(
                "the page did not report its first paint in time; showing the window anyway"
            );
            window::show_and_focus(&handle)
        },
    ));

    if smoke {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(smoke::WATCHDOG).await;
            if !reported.swap(true, Ordering::AcqRel) {
                let report = smoke::finalize(smoke::timed_out(smoke::WATCHDOG));
                smoke::print(&report);
                if smoke_exit {
                    handle.exit(smoke::exit_code(&report));
                }
            }
        });
    }
}

/// Creates the main window with `plan`'s glass. If the platform refuses it, retries with an opaque
/// window when that could work ([`GlassPlan::opaque_fallback`]) rather than failing to start.
/// Returns the glass actually applied.
fn create_window(
    app: &tauri::App,
    plan: &GlassPlan,
) -> Result<GlassEffect, Box<dyn std::error::Error>> {
    let error = match window::create_main(app, plan) {
        Ok(_) => return Ok(plan.effect),
        Err(error) => error,
    };
    let webview_runtime = tauri::webview_version();
    match plan.opaque_fallback(webview_runtime.is_ok()) {
        Some(opaque) => {
            tracing::error!(%error, "could not create the window with glass; retrying opaque");
            window::create_main(app, &opaque)?;
            Ok(opaque.effect)
        }
        None => {
            if let Err(missing) = webview_runtime {
                tracing::error!(error = %missing, "no webview runtime is available");
            }
            Err(error)
        }
    }
}

fn on_event(app: &tauri::AppHandle, event: RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(state) = app.try_state::<AppState>()
    {
        state.demos.cancel_all();
        state.close_store();
    }
}

/// Logs to stderr, filtered by `RUST_LOG` (default `info`). Records from crates that use `log`
/// (Tauri, tao, wry) are bridged in by tracing-subscriber's `tracing-log` feature.
fn init_tracing() {
    use std::io::IsTerminal as _;
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(DEFAULT_LOG_FILTER));
    let installed = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_ansi(std::io::stderr().is_terminal())
        .try_init();
    if let Err(error) = installed {
        eprintln!("auracode: logging is unavailable: {error}");
    }
}
