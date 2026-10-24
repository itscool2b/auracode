# Spike: the Windows titlebar

M0 spike 4. There is no spike code: the outcome is window configuration for the Tauri shell.

**Status:** pending Windows verification. The decision below was drawn on 2026-10-24 from the
sources of the locked crates and is implemented in the shell, but nothing has run on Windows yet:
every item in [Verification](#verification) is still open.

## Versions checked

The cited behaviour was read in the sources of the versions Cargo.lock locks: tauri 2.12.5,
tauri-utils 2.10.2, tauri-runtime-wry 2.12.3, tao 0.37.2, wry 0.57.1, window-vibrancy 0.8.1 and
windows-version 0.1.7. The first draft of this doc was checked against the previous patch release
of tauri, tao and wry; every claim was re-read in the locked sources, and the patch releases change
none of them:

- tao 0.37.2 changes two things on Windows: how undecorated windows size their client area
  (`WM_NCCALCSIZE`, both forms; this window is decorated), and that a hidden window whose
  maximized state changes no longer gets `ShowWindow(SW_RESTORE)`, which used to make it appear.
  The second one helps here, since the window starts hidden while the window-state plugin
  restores its size and maximized state. The dark caption code
  (`platform_impl/windows/dark_mode.rs`) is unchanged.
- wry 0.57.1 moves to Rust edition 2024, logs `eval` errors and fixes Android, macOS and Linux
  issues. `IsNonClientRegionSupportEnabled` and the windowed controller are where they were
  (`src/webview2/mod.rs`).
- tauri 2.12.5 only rewords the Linux resource directory docs; tauri-runtime-wry 2.12.3 only
  touches Linux resizing of undecorated windows.

## Decision

| Platform | Title bar | Material |
|---|---|---|
| Windows 11 (build 22000+) | native decorations: the system title bar and caption buttons | Mica (`micaDark`) on a transparent window |
| Windows 10 | native decorations | none: an opaque near-black window |
| macOS | `titleBarStyle: "Overlay"`, `hiddenTitle: true`, `trafficLightPosition` | Liquid Glass with a vibrancy fallback (plan) |
| Linux | native decorations from the window manager | none from Tauri; CSS translucency (plan) |

## Windows: keep the native caption buttons

- Snap Layouts (the flyout when hovering maximize on Windows 11) appear only when the window
  answers `WM_NCHITTEST` with `HTMAXBUTTON` over the maximize button. With native decorations the
  system does that, plus Aero Snap, the system menu, double-click to maximize, caption tooltips,
  and UI Automation names, with no code from us.
- With `decorations: false` the buttons become HTML inside WebView2's child window. That window
  receives the mouse, the top-level window procedure is never asked, and nothing in HTML, CSS or
  Tauri's config can produce `HTMAXBUTTON` (tauri-apps/tauri#4531, labelled as an upstream
  limitation). Snap Layouts disappear without any error.
- Cost: a native caption strip (about 30 px at 100% scaling) runs across the top, and the page
  starts below it. With Mica the strip and the page share one material, so they read as one
  surface. Keep the window title set: it shows in the taskbar and in Alt+Tab.
- `theme: "Dark"` makes the caption and its buttons dark: tao sets the immersive dark mode window
  attribute (`DWMWA_USE_IMMERSIVE_DARK_MODE`: attribute 19 up to build 18985, 20 after it) on
  Windows 10 1809 (build 17763) and later.

## Windows: Mica, and the Windows 10 fallback

- Use `micaDark` on a `transparent: true` window, with the page leaving its background
  transparent wherever the material should show. `micaDark` (window-vibrancy's
  `apply_mica(Some(true))`) sets the immersive dark mode attribute before applying the backdrop,
  which should keep the caption and the Mica tint dark even when the system theme is light (a
  verification item below); plain `mica` follows the system theme.
- Mica needs Windows 11. window-vibrancy uses `DWMWA_SYSTEMBACKDROP_TYPE` from build 22523 and the
  undocumented `DWMWA_MICA_EFFECT` on builds 22000 to 22522; below 22000 it returns
  `UnsupportedPlatformVersion`, and Tauri's Windows `apply_effects` (`src/vibrancy/windows.rs`)
  discards that error. A config-only Mica window on Windows 10 is therefore a transparent window
  with nothing behind the page.
- So the main window is built in Rust, not from config alone, and this is how the shell does it:
  - `tauri.conf.json` declares the window with `"create": false`, `decorations: true`,
    `theme: "Dark"` and `visible: false`.
  - `os::OsInfo::detect` reads the real build number with `windows_version::OsVersion::current()`
    (no compatibility shim can make it lie), and `glass::plan` picks the material: Mica
    (`Effect::MicaDark`) from build 22000 (`MICA_WINDOWS_BUILD`), otherwise none and an opaque
    window. `AURACODE_NO_GLASS=1` forces the opaque window for the power spike.
  - `window::create_main` starts from the config entry (`WebviewWindowBuilder::from_config`) and
    sets transparency and effects from the plan. An opaque window gets the near-black base colour
    (`BASE_COLOR`) behind the page, and on Windows a transparent window gets
    `no_redirection_bitmap`, which avoids the white flash it would show before the first paint.
  - The window starts hidden and is shown after the page's first paint (or a 3 s fallback).
- The shell reports what it applied in `app_info().glass`, and the UI paints its own opaque base
  when the material is missing. All values (`GlassEffect`): `liquid_glass`, `vibrancy`, `mica`, `none`.
  On Windows it is `mica` on Windows 11 and `none` on Windows 10, which is the plan's edge case
  "Windows 10 (no Mica: fallback theme)".
- Never `acrylic` or `blur`: tauri-utils documents poor resize and drag performance for acrylic
  (Windows 10 1903+ and Windows 11 build 22000) and for blur (Windows 11 build 22621), and the plan
  already rules them out.

## macOS

- `titleBarStyle: "Overlay"` lets the page extend under a transparent title bar, and
  `hiddenTitle: true` hides the title text. `trafficLightPosition` (logical pixels from the
  top-left; requires `decorations: true`) moves the buttons into our layout; `tauri.conf.json`
  currently uses `{ "x": 18, "y": 24 }`. Final numbers come from the Design Lab.
- The top strip needs `data-tauri-drag-region` so the window can be dragged. Known limit: an overlay
  drag region cannot drag an inactive window (tauri-apps/tauri#4316).
- Material: one Liquid Glass style plus one visual-effect material in the same `effects` list;
  Tauri uses the second on macOS 15 and older (`src/vibrancy/macos.rs`). `macOSPrivateApi` does
  nothing in the locked Tauri (tauri-utils documents it as a no-op from the 2.12.1 release on), so
  transparency needs no extra flag.

## What a custom Windows titlebar would need

Only worth building if the design truly needs content in the caption row.

1. Remove the system caption: `decorations: false`, or keep the frame and extend the client area
   into it (`DwmExtendFrameIntoClientArea` plus a `WM_NCCALCSIZE` handler), which keeps DWM's
   shadow and resize borders.
2. Drag regions: `data-tauri-drag-region`, or CSS `app-region: drag`. The CSS route works because
   wry 0.57.1 enables WebView2's `IsNonClientRegionSupportEnabled`, so drag regions also
   double-click to maximize and right-click for the system menu.
3. Snap Layouts: a native child window placed exactly over the HTML maximize button, whose window
   procedure returns `HTMAXBUTTON` from `WM_NCHITTEST`, maximizes on click, forwards hover and
   press state to the page (the page no longer gets `:hover` or `click` there), and follows
   resizes and DPI changes. Window styles reported to work: `WS_CHILD | WS_VISIBLE |
   WS_CLIPSIBLINGS` with no `WS_EX_LAYERED` or `WS_EX_TRANSPARENT`, both of which break the hit
   test. `tauri-plugin-frame` packages this for Windows 11. Subclassing the webview instead does
   not work: the mouse goes to Chromium's internal windows, and replacing their window procedures
   breaks rendering.
   WebView2 does define Minimize, Maximize and Close non-client regions
   (`CoreWebView2NonClientRegionKind`), but reports them through the composition (visual hosting)
   controller, where the host does its own hit testing. wry hosts WebView2 in windowed mode
   (`CreateCoreWebView2Controller`), so using them means changing wry.
4. Rebuild what the system gave for free: caption button hover and press visuals in light, dark and
   high contrast; tooltips; UI Automation names and roles; keyboard access to the system menu
   (Alt+Space).
5. Windows 10 has no Snap Layouts, so there the buttons are plain HTML.
6. A large minimum window width keeps the window out of narrow snap zones, with native decorations
   too; the plan already asks for a small minimum size.

## Verification

On the user's Windows PC, with the Windows installer from the Build workflow's artifact
(`auracode-<commit>-windows-x64`, `auracode_0.1.0_x64-setup.exe`; SmartScreen needs "More info >
Run anyway", and the per-user install needs no administrator). No Windows build exists yet: the
workflows have not run (see step 1 of the
[render and power spike's Windows half](render-power.md#windows-webview2-half-still-to-run)).
Write pass or fail into each row, with the Windows build number; a fail sends the decision back
for review.

| Check | Pass when | Result |
|---|---|---|
| Snap Layouts (Windows 11) | hovering maximize shows the flyout, and choosing a zone snaps the window | pending |
| Dark caption on a light system theme (Windows 11) | with Settings > Personalization > Colors set to Light, the caption and its buttons stay dark | pending |
| Mica tint (Windows 11) | dragging the window over a colourful wallpaper tints the background, and the info card's Glass row reads Mica | pending |
| Opaque fallback (Windows 10, if one is available) | an opaque dark window with a dark caption and no transparency artifacts; the Glass row reads None (opaque) | n/a until a Windows 10 machine is available |
| Native caption behaviour | double-click on the caption maximizes, Alt+Space opens the system menu, Aero Snap to the screen edges works | pending |
