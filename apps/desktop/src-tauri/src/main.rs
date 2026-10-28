//! The auracode executable. Everything lives in the library (`auracode_desktop`), where tests and
//! the bindings export can reach it.

// No console window behind the app in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `auracode --uninstall-cleanup` deletes auracode's data and exits; nothing else starts.
    if let Some(code) = auracode_desktop::uninstall::run_from_args() {
        std::process::exit(code);
    }
    auracode_desktop::run();
}
