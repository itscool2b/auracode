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
    keep_gpu_rendering_on_nvidia_wayland();
    auracode_desktop::run();
}

/// On NVIDIA's driver under Wayland the window closes as soon as it opens ("Error 71 (Protocol
/// error) dispatching to Wayland display"). The driver's EGL layer puts the window's surface under
/// explicit sync (`wp_linux_drm_syncobj_surface_v1`) once WebKitGTK's GPU renderer draws to it, and
/// GTK 3 then commits a frame of its own without an acquire point: "Missing acquire timeline"
/// (driver 615, WebKitGTK 2.50 and 2.54, Hyprland, 16 November 2026).
///
/// The driver's own switch, `__NV_DISABLE_EXPLICIT_SYNC=1`, avoids it and keeps the GPU renderer.
/// The other known way out, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, makes WebKitGTK paint on the CPU
/// and copy every frame: on a 4K screen at 2x a chat scrolled at 21 frames a second against 60,
/// and the stress view drew 12 to 25 against 60. So the app sets the driver's switch, unless the
/// person set either variable themselves.
///
/// The program runs itself again with the switch (same process, same arguments) rather than
/// changing its own env, which is unsafe once anything could read it. `AURACODE_LAUNCH_SET` names
/// the variable so agents do not inherit it (`aura_process::strip_launch_context`). When the
/// restart fails, the app goes on without the switch.
#[cfg(target_os = "linux")]
fn keep_gpu_rendering_on_nvidia_wayland() {
    use std::os::unix::process::CommandExt;
    const SWITCH: &str = "__NV_DISABLE_EXPLICIT_SYNC";
    if std::env::var_os(SWITCH).is_some()
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
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
    let error = command
        .args(args)
        .env(SWITCH, "1")
        .env(aura_process::LAUNCH_SET_ENV, SWITCH)
        .exec();
    eprintln!("auracode: could not restart with {SWITCH}=1: {error}");
}
