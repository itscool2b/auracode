//! The auracode executable. Everything lives in the library (`auracode_desktop`), where tests and
//! the bindings export can reach it.

// No console window behind the app in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The session-scoped memory helper uses stdio without creating a window or taking the
    // profile's writer lock. It talks to the already-running app through a scoped grant.
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--aura-memory-helper")
    {
        aura_core::memory_service::run_helper();
        return;
    }
    // `auracode --uninstall-cleanup` deletes auracode's data and exits; nothing else starts.
    if let Some(code) = auracode_desktop::uninstall::run_from_args() {
        std::process::exit(code);
    }
    auracode_desktop::run();
}
