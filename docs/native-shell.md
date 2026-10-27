# Native shell

Windows and macOS own these services in Rust independently of the webview. Linux and WSL are
deferred. Smoke launches do not create tray icons, power assertions or notifications.

## Window and long runs

The application and main window explicitly request dark appearance. Windows 11 uses dark Mica;
macOS materials inherit the dark window appearance. There is no native theme switch.

Closing the window hides it after tray installation succeeds. Open, a left tray click, a second
launch, macOS Dock reopen and notification clicks restore and focus it. If tray installation fails,
closing follows the normal guarded quit path instead of leaving an unreachable hidden application.
The tray shows a blue activity badge or amber attention badge and a count in its tooltip. macOS also
gets a menu-bar count and Dock badge. The application icon remains colored on either system theme.

Quit asks once when an agent is starting, working, stopping or awaiting an unresolved response.
The existing unsaved-storage warning shares that confirmation. Cancel restores the window and leaves
sessions and storage intact. Confirm uses the existing bounded owned-process shutdown and store flush.

The keep-awake assertion prevents idle system sleep while work is active, without keeping the screen
on or blocking explicit user sleep. It releases after the last active chat settles, on service
shutdown, or on service drop. Creation and destruction use the same dedicated thread because the
Windows execution-state API is thread-local. OS failure is logged and does not stop agent work.

On Windows, minimize and restore events synchronize the WebView2 visibility flag; hiding to tray
also hides the webview. A failed visibility operation remains retryable. Rust sessions and persistence
continue independently. This enables WebView2's own hidden-content behavior rather than promising
that every JavaScript timer is stopped. Smoke runs retain their existing rendering behavior.

## Notifications and navigation

Background attention requests, completed turns and failures produce generic notifications without
prompt text, chat titles, tool arguments or output. Foreground notifications are suppressed. Repeated
attention updates in one episode are coalesced; resolved requests and notices superseded by new work
are discarded before delivery. A bounded notification queue never blocks session actors.

Clicking a notification queues its local chat ID in Rust, restores the window and emits
`auracode-open-chat` with a unit payload. The UI calls `shell_take_navigation` on startup, window
focus and that event. It returns `string | null`, consuming the latest pending chat ID. The UI checks
the returned ID against its current chats before selecting it (`navigationTarget` in
`apps/desktop/src/lib/nativeNavigation.ts`): it waits until the chat list and the workspace have
loaded, opens an archived chat with the archived view, and ignores an unknown ID (a deleted chat or
another profile's notification), leaving the current selection as it was. This survives webview
suspension and reload within the running app. Delivery, installed-app attribution and behavior
after the process has exited remain subject to the OS notification service.

## Evidence and remaining checks

Windows Rust checks cover concurrent chat activity, attention transitions, cancellation, stale
notification suppression, same-thread power assertion release, failed visibility retries and both
cancelled and confirmed quit with active work. Desktop all-target Clippy passes. No native agent,
login, credential or real power/notification test is involved in these checks.

Installed Windows and macOS checks remain required for tray interaction, notification permission and
click routing, actual idle-sleep behavior, hide/minimize rendering measurements, and dark materials.
The frontend navigation consumer validates the chat ID in the UI (covered by Vitest); the native
click routing above still needs the installed-app checks. This checkpoint does not claim those
acceptance checks passed.

Sources: [Tauri notifications](https://v2.tauri.app/plugin/notification/),
[keepawake 0.6.1](https://docs.rs/keepawake/0.6.1/keepawake/), and
[WebView2 controller visibility](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller).
