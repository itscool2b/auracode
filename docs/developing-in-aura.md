# Developing auracode inside auracode

Chats in auracode often change auracode itself. The installed app runs those chats, its data folder
holds them and the worktrees being edited, and every agent process runs inside the app's Windows
job object. So anything that stops, replaces, migrates or uninstalls the installed app ends the
session doing the work. This page covers what the code guarantees, how to build and test a change
next to the running app, how to get the change into the installed app, and how to recover when
the new build is broken.

## What a development build cannot do

A development build is one with debug assertions: `cargo run`, `cargo test`, `pnpm dev`
(`tauri dev`) and `tauri build --debug`. Release builds (`pnpm bundle`, `cargo build --release`)
behave exactly like the installed app.

- **Its data folder is its own.** Without `AURACODE_DATA_DIR` it opens `si.auracode.desktop.dev`
  next to the installed app's `si.auracode.desktop` (`DEVELOPMENT_FOLDER` in
  `crates/aura-core/src/paths.rs`). The installed app's chats are never migrated to a newer
  schema, which the installed app would then refuse, and never cleaned up. The CLI follows the same
  rule. `AURACODE_DATA_DIR` still points a development build anywhere, the installed app's folder
  included, so using real data is a deliberate choice.
- **It is always its own instance** (`LaunchOptions::single_instance` in
  `apps/desktop/src-tauri/src/launch.rs`). It never hands over to the installed app or receives
  its sign-in links. Its WebView2 profile is inside its data folder, and it does not share the
  window position.
- **Its cleanup stays in its folder.** Settings' "Delete all auracode data" and
  `--uninstall-cleanup` clean only the development build's own data folder. They never take the
  machine scope, which would delete the installed app's folder and ask the installed app to quit.
- **It cannot update.** An update installs over the installed app and closes it first.
- **Its window is titled `auracode dev`,** so neither a person nor automation that finds windows
  by title mistakes it for the installed app.

Every smoke run, in any build, needs `AURACODE_DATA_DIR`. Without it the run reports a failure and
opens nothing, because a smoke run skips the single-instance hand-over and would otherwise open the
default folder next to a running app.

## Building on Windows with Smart App Control

When Smart App Control is on, Windows checks every new unsigned executable, including the build
scripts and procedural-macro DLLs cargo compiles. It blocks some of them ("An Application Control
policy has blocked this file", os error 4551) and remembers the verdict for that file, so retrying
the same build fails the same way. The location makes no difference, and a copied file loses its
verdict and is checked again. A cold target folder is therefore a lottery that can get stuck.

What works is building against a warm target folder whose build scripts and macros have already
run, such as the main checkout's: set `CARGO_TARGET_DIR` to it. Cargo names workspace artifacts by
their path inside the workspace, so a worktree reuses them, and only the final executable and the
test binaries are new.

Sharing has one cost. Cargo decides freshness by comparing source modification times, so after a
worktree build the shared folder's workspace crates hold the worktree's code while the main
checkout's older sources look unchanged. When done, delete the workspace crates' compile
fingerprints, keeping the build scripts' own, so the next main build compiles its own sources:

```powershell
$target = "<main checkout>\target"
$names = (cargo metadata --no-deps --format-version 1 | ConvertFrom-Json).packages.name
Get-ChildItem $target -Recurse -Depth 2 -Directory -Filter .fingerprint |
  Get-ChildItem -Directory | Where-Object { $names -contains ($_.Name -replace '-[0-9a-f]{16}$', '') } |
  Get-ChildItem -File | Where-Object { $_.Name -match '^(dep-|output-)?(lib|bin|test|run-build-script)-' } |
  Remove-Item
```

`tauri build` calls bare `pnpm`. Where pnpm only runs through corepack, put a `pnpm.cmd` that runs
`corepack pnpm %*` first on `PATH`. The vendored OpenSSL needs a native Windows Perl, not Git's,
named by `OPENSSL_SRC_PERL`.

## Testing a change next to the running app

- **The UI:** the browser fixtures first (`check:*` scripts, `?preview=` modes). They need no
  native window and touch no data.
- **The native app:** `tauri build --debug --no-bundle`, then `target\debug\auracode.exe`. It
  opens the development folder. For a throwaway first launch, set `AURACODE_DATA_DIR` to a new
  folder. `pnpm dev` works too, but its Vite port (1420) is fixed, so only one worktree can run it
  at a time.
- **Stop what you started by its process id.** Never stop `auracode.exe` by name: the installed
  app has the same name.
- **Drive windows by process id or handle,** and check the window is in the foreground before
  sending input. Otherwise keystrokes land in the installed app's composer.
- **Launch from a clean environment.** An agent's shell carries `CLAUDECODE` and the installed
  app's `AURA_MCP_*` values, which include the project-memory helper's address and token. The app
  gives its agents a resolved environment anyway, but nothing it starts needs those values.
- **Smoke checks:** `.github/scripts/run-smoke.sh` (bash and jq), with a data folder of its own
  per run. `chat-reopen` covers what an upgrade does to running chats: the second launch finds the
  stored history, the interrupted turn and Resume.

## Getting a change into the installed app

On Windows, `apps/desktop/scripts/host-upgrade.mjs` replaces the installed app with a local build
and keeps the previous one. It runs from the repository root as
`pnpm --filter @auracode/desktop host-upgrade <command>`.

1. Build the installer with `pnpm bundle`. It lands in
   `target\<target triple>\release\bundle\nsis\` or `target\release\bundle\nsis\`.
2. Commit and push the branch, so nothing depends on the worktree surviving.
3. Arm the install from the chat: `host-upgrade install --after-exit --installer <setup.exe>`.
   It returns at once. The waiter runs outside the app's job (started through WMI), from copies of
   the script and the installer in `%LOCALAPPDATA%\auracode-upgrades`. It waits up to 30 minutes
   (`--wait`) for auracode to quit.
4. Quit auracode. The waiter copies `%LOCALAPPDATA%\auracode` to a snapshot and runs the
   installer in update mode (`/P /UPDATE`, as the updater does), which keeps the data folder
   (`src-tauri/windows/hooks.nsh`). Then it starts auracode again. If the new build is not running
   20 seconds later, the waiter restores the snapshot and starts that.
5. In the reopened app, chats that were running show their interrupted turn and Resume. An agent
   that keeps its own sessions, such as Claude Code, continues the same conversation, because its
   driver resumes by session id. Then check whatever only the installed app can show, such as the
   project-memory helper, worktree creation and the instruction files a new chat copies.

`host-upgrade status` shows the installed build, whether it runs, any armed install, the snapshots
and the last log lines. `host-upgrade cancel` disarms. The waiter keeps the three newest snapshots
(`--keep`). Without an agent, quit auracode and run `host-upgrade install --installer <setup.exe>`
from a terminal.

## When the new build is broken

- **It does not start, or exits at once:** the waiter has already restored the snapshot.
- **It starts but misbehaves:** quit it and run `host-upgrade rollback` from a terminal outside
  auracode. That restores the newest snapshot, or the one `--snapshot <name>` names.
- **The restored app says the database is from a newer auracode:** the new build migrated it. Run
  `host-upgrade rollback --restore-database`. aura-core backs a database up before every migration
  (`profiles\<id>\backups\aura.db.v<from>-<millis>.bak`). This puts back each database as it was
  before its first migration since the snapshot, and keeps the migrated one next to the backups as
  `<database>.rolled-back-<millis>`. Chats changed after the upgrade are only in that kept copy.
- **No working auracode at all:** run Claude Code or Codex in a terminal in the main checkout, fix
  forward, build an installer, and run `host-upgrade install` from that terminal.

The snapshots and the log (`%LOCALAPPDATA%\auracode-upgrades\upgrade.log`) are outside both the
install and the data folder. Neither an upgrade nor an uninstall removes them, and a later session
can read the log to see what happened.

## macOS

A development build's folder is `~/Library/Application Support/si.auracode.desktop.dev`, by the
same rule. WebKit keeps one website-data store per bundle identifier, so a development build shares
it with the installed app (`LaunchOptions::webview_data_dir` has no effect there). The app keeps
nothing in web storage except the stress view's frame log, so this is harmless today. Anything
that starts keeping state in web storage changes that. `host-upgrade` is Windows-only. On macOS,
copy `/Applications/auracode.app` aside before replacing it.

## Verification

Run on 2026-11-01 on Windows 11 with Smart App Control on, from a chat inside the installed app.
The development build was built from this branch against the main checkout's warm target.

| Check | Result |
|---|---|
| A development build launched beside the running installed app stays up as its own instance, opens `si.auracode.desktop.dev` with its WebView2 profile inside, is titled `auracode dev`, and leaves the installed app's processes alone | pass |
| A smoke run without `AURACODE_DATA_DIR` prints a failing result naming the reason, exits 1 and opens no store | pass |
| `--uninstall-cleanup --dry-run` from a development build plans only the development folder and keeps the installed app's account keys | pass |
| Smoke checks with the development build in scratch folders: stream, chat (30 of 30), chat-reopen (8 of 8) | pass |
| An agent's own processes are in the app's job; a process started through WMI is not (its parent is `WmiPrvSE.exe`) | pass |
| `host-upgrade` against the real install while it runs: `status` reports it, `install` refuses, `rollback` finds no snapshot, nothing changes | pass |
| `host-upgrade install --after-exit` against a stand-in install: the WMI waiter polls, proceeds when the stand-in quits, snapshots it, runs the installer, restores the snapshot when the installer fails, starts the app and removes its record; `cancel` stops an armed waiter | pass |
| Running a real installer over the installed app and reopening it | pending: needs the owner to quit auracode |
