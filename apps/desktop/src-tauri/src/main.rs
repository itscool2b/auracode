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
    // The browser's MCP helper (the Browser plugin's tools), started by an agent the same way.
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--aura-browser-helper")
    {
        aura_core::browser_service::run_helper();
        return;
    }
    // `auracode --uninstall-cleanup` deletes auracode's data and exits; nothing else starts.
    if let Some(code) = auracode_desktop::uninstall::run_from_args() {
        std::process::exit(code);
    }
    #[cfg(target_os = "linux")]
    avoid_dmabuf_on_nvidia_wayland();
    auracode_desktop::run();
}

/// WebKitGTK's DMA-BUF renderer ends the app at once on NVIDIA's driver under Wayland: the window
/// opens, then "Error 71 (Protocol error) dispatching to Wayland display" (WebKitGTK 2.54, driver
/// 615, Hyprland). Builds that link the system's WebKitGTK (development builds, deb and rpm) hit
/// it; turning the renderer off is WebKitGTK's own switch. A value the person set is kept.
///
/// The program runs itself again with the switch set (same process, same arguments) rather than
/// changing its own env, which is unsafe once anything could read it. When that fails, it goes on
/// without the switch.
#[cfg(target_os = "linux")]
fn avoid_dmabuf_on_nvidia_wayland() {
    use std::os::unix::process::CommandExt;
    const SWITCH: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(SWITCH).is_some()
        || std::env::var_os("WAYLAND_DISPLAY").is_none()
        || !std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut args = std::env::args_os();
    let mut command = std::process::Command::new(exe);
    if let Some(arg0) = args.next() {
        command.arg0(arg0);
    }
    let error = command.args(args).env(SWITCH, "1").exec();
    eprintln!("auracode: could not restart with {SWITCH}=1: {error}");
}
