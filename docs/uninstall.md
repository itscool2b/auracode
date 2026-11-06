# Uninstalling auracode and deleting its data

Uninstalling auracode deletes its local files and reviewed, exclusively owned account keys.
Shared keys and entries that cannot be verified are retained and reported. Your coding agents, their settings and your repositories are not
touched. Settings has the same deletion without uninstalling, on Windows, macOS and Linux (macOS
and Linux have no uninstaller of auracode's own).

One piece of Rust decides what goes everywhere: aura-core's `uninstall` module, run by the app
binary's `--uninstall-cleanup` mode (`apps/desktop/src-tauri/src/uninstall.rs`). The Windows
uninstaller, Settings and a person in a terminal all run that mode.

## What is removed

### Windows

- `%LOCALAPPDATA%\si.auracode.desktop`, the data folder. It holds:
  - the device identity;
  - every profile, with its chats, attachments, checkpoints, logs, backups and account files;
  - auracode's worktrees (see [Worktrees](#worktrees));
  - the ACP adapters auracode downloaded for itself;
  - Instructions backups and the passphrase vault;
  - clone recovery journals, including those in a custom data root;
  - the WebView2 profile (`EBWebView`).
- `%APPDATA%\si.auracode.desktop`: the window position.
- In `%TEMP%`: the updater's downloads (`auracode-<version>-updater-*`) and the CLI's probe
  folders (`aura-cli-*`).
- In Windows Credential Manager, the reviewed entries under `auracode.sync.v1:` that belong
  exclusively to deleted data roots. Credential Manager lists names for that prefix only; other
  apps' credentials are never read. See [Secure-store scope](#secure-store-scope).
- The uninstaller's own records:
  - the shortcuts, the jump list and the uninstall entry;
  - the `auracode://` link registration, when it points at this install;
  - `HKCU\Software\auracode\auracode`;
  - Windows' notification settings for auracode
    (`HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\si.auracode.desktop`).
- A data folder chosen with `AURACODE_DATA_DIR`, when the variable is set for the uninstaller.
  Only what auracode made in it goes (see [Edge cases](#edge-cases)).

### macOS

- `~/Library/Application Support/si.auracode.desktop`: the data folder and the window position.
- These folders and files:
  - `~/Library/Caches/si.auracode.desktop`;
  - `~/Library/WebKit/si.auracode.desktop`;
  - `~/Library/HTTPStorages/si.auracode.desktop` and its `.binarycookies` file;
  - `~/Library/Saved Application State/si.auracode.desktop.savedState`;
  - `~/Library/Logs/si.auracode.desktop`;
  - `~/Library/Preferences/si.auracode.desktop.plist`;
  - a leftover single-instance socket, `/tmp/si_auracode_desktop_si.sock`.
- In `$TMPDIR`: the updater's downloads and the CLI's probe folders.
- Reviewed, exclusively owned keychain items with the service `auracode.sync.v1`. The keychain
  is searched for that service only, using the same scope rules as Windows.
- With "Also move auracode to the Trash": the app bundle. Launch Services then forgets the
  `auracode://` link.

### Linux

- `~/.local/share/si.auracode.desktop`: the data folder, which also holds WebKitGTK's storage and
  cache.
- `~/.config/si.auracode.desktop`: the window position.
- `~/.cache/si.auracode.desktop`.
- In `/tmp` (or `$TMPDIR`): the CLI's probe folders.
- Reviewed, exclusively owned Secret Service items with the service `auracode.sync.v1`, found by
  that attribute only, using the same scope rules as Windows.

Removing the package (`sudo apt remove auracode`, `sudo dnf remove auracode`, or deleting the
AppImage) removes the app and leaves all of this, so delete the data from Settings first.

auracode adds no login item, Run key, launch agent or autostart entry, so there is none to remove.

## What stays, and why

- **Your agents.** Claude Code, Codex, Pi, OpenCode and the others stay installed, including any
  installed through auracode's one-click install. Those are global npm installs, such as
  `@anthropic-ai/claude-code`, `@openai/codex`, `@earendil-works/pi-coding-agent` and
  `opencode-ai`, and they work without auracode. Remove one with `npm uninstall -g <package>`.
- **Your agents' homes.** The cleanup never reads or changes `~/.claude`, `~/.claude.json`,
  `~/.codex`, `~/.pi`, `~/.agents` or OpenCode's folders.
  - Their logins stay, since auracode never stored them.
  - Files auracode wrote there at your request stay, because they are valid files of yours:
    instruction files, Plugin library items, MCP servers and synced settings. The agents keep
    using them.
  - Sessions you ran through auracode stay in each agent's own history, so `claude --resume` and
    `codex resume` still find them.
- **Plugin library undo folders.** `.auracode-library` sits inside agent folders, in `~` (for
  Claude MCP copies) and in projects. It keeps the files a Library copy replaced, so it may be the
  only copy of your earlier version. It is in your folders, so it stays. Delete it by hand once you
  no longer need to undo a copy.
- **Your repositories.** Their files, index, commits and remotes are never touched, and that
  includes a remote added by Publish to GitHub. auracode's `aura/...` branches stay with the
  commits on them; delete one with `git branch -d aura/<name>`.
- **Worktrees with unsaved work.** They stay unless you choose otherwise (see
  [Worktrees](#worktrees)).
- **Your account.** The account and its end-to-end encrypted data stay on auracode.si. This
  computer stays listed under Devices until you remove it there or from another device. After a
  fresh install, sign in and use your recovery key.
- **Shared system components.** The WebView2 runtime, Git, Node.js and npm stay, because other
  apps use them.
- **Developer files.** A development build's data folder (`si.auracode.desktop.dev` next to the
  data folder) and `host-upgrade`'s snapshots and log (`%LOCALAPPDATA%\auracode-upgrades`) were
  made by tools for working on auracode, not by the installed app. Delete them by hand; see
  [developing-in-aura.md](developing-in-aura.md).

## Secure-store scope

Cleanup reads complete, validated account indexes and account bundles. An opaque target hash
cannot identify a payload's kind or service origin. Indexes for other data roots stay, including
empty indexes. Their account references, including pending removal receipts, protect keys for
both production and preview. Unknown, malformed, unsupported or unreadable values retain all
account keys and the deleted roots' indexes for retry.

Only canonical indexes of deleted roots and their exclusive account keys are removed. Shared
account retention alone does not retain the deleted root's index. Orphan account bundles can be
removed only when the canonical default root is among the deleted targets, never during a
custom-only cleanup. Account keys are deleted before their indexes. If an account deletion fails,
its owning index stays so a later cleanup can retry, even when the root is already missing.
Missing roots are resolved from the nearest canonical existing ancestor; ambiguous paths retain
keys instead of guessing.

Settings and `--dry-run` list opaque targets, kind, remove/retain decisions and reasons, with no
account IDs or secrets. Execution immediately replans and can only narrow the approved set.
New references, changed payloads and newly discovered unknown entries retain affected keys.

Every native store holds a shared lifetime lease. Cleanup takes an exclusive lease after target
apps exit, before reading or deleting keys, and never waits for a root lock while holding it.
Another running copy, a locked store or any lease failure preserves keys with a busy explanation.
Close all older auracode binaries before the first cleanup with this version: older binaries do
not participate in this lease.

The permanent empty file `si.auracode.sync.v1.lock` in the platform's local application data
folder is kept after uninstall. It contains no credentials or user data. Do not delete or replace
it: keeping one inode prevents another process from bypassing an existing lock. The file is
opened without following links or truncating it, checked as a regular file, and created with
mode 0600 on Unix. Ownership locks are nonblocking and explicitly unlocked when their owner ends.

## Worktrees

auracode creates its worktrees inside its data folder and registers them with your repository,
locked by auracode. Before deleting anything, the cleanup asks Git about each one. A worktree has
unsaved work when:

- it has uncommitted changes, untracked files included (ignored files do not count); or
- its HEAD has commits that no other branch, tag or remote has.

A worktree with nothing unsaved is deleted, and Git drops its registration (`git worktree prune`).
Its branch stays.

A worktree with unsaved work is listed by branch, repository and what deleting it would lose, for
example "3 uncommitted files, 1 commit only on aura/fix-login". It is kept unless you choose to
delete it:

- Kept, its folder stays where it is, still registered with its repository, and auracode's lock is
  lifted. `git worktree list` in the repository shows it, and `git worktree remove <path>` deletes
  it later.
- Deleted, its uncommitted files are lost. Commits on its branch stay with the branch; commits on a
  detached HEAD are lost.

A worktree Git cannot check (Git is missing, or the repository is gone) counts as unsaved. A quiet
uninstall never deletes unsaved work.

## How it runs

### The Windows uninstaller

Open Settings, then Apps, find auracode and choose Uninstall. The confirm page has one checkbox,
"Keep my auracode data", which is unticked by default, so uninstalling deletes the data.

Before any file is removed, the uninstaller's hook (`apps/desktop/src-tauri/windows/hooks.nsh`)
runs `auracode.exe --uninstall-cleanup --interactive`:

1. If auracode is running, it is asked to quit. It stops only its own agents and terminals and
   asks no further question.
2. If it has not quit after 45 seconds, Tauri's own check offers to close it. The cleanup then
   runs once the app's files are removed, from a copy of the program.
3. A dialog lists the worktrees with unsaved work. Yes keeps them; No deletes them.
4. If something could not be deleted, a second dialog lists it.

Quiet uninstalls show no dialogs:

- `uninstall.exe /S` and `/P` delete the data and keep worktrees with unsaved work.
- Adding `/KEEPDATA` keeps everything.

Updates (`/UPDATE`) keep everything. So does the uninstall a newer installer runs before installing
("Uninstall before installing"): that installer runs the uninstaller in place, and the hook treats
it as an upgrade.

The bundle builds the NSIS installer only. An MSI would uninstall without the cleanup.

### Settings, on Windows, macOS and Linux

In Settings, open About, then Delete all auracode data under This device. The review lists:

- every folder and file that would go, with its size;
- each reviewed secure-store entry, whether it goes or stays, and why;
- warnings when references or secure storage cannot be verified;
- the worktrees with unsaved work, which are kept unless you tick to delete them too;
- what stays.

On macOS it also offers "Also move auracode to the Trash".

After you type DELETE, auracode starts the cleanup and quits, without a second question about
running agents. The cleanup waits up to two minutes for auracode to exit, then deletes. Its only
dialog says what could not be deleted, if anything. If auracode does not exit, nothing is deleted
and the cleanup says so. The next launch is a fresh install.

A copy started with its own `AURACODE_DATA_DIR` reviews and deletes only that folder, and leaves
the installed app's data alone.

### A terminal

The same cleanup runs from a terminal:

```sh
# macOS
/Applications/auracode.app/Contents/MacOS/auracode --uninstall-cleanup --dry-run
# Windows (the default per-user install folder)
"%LOCALAPPDATA%\auracode\auracode.exe" --uninstall-cleanup --dry-run
# Linux (the deb or rpm package; an AppImage takes the same options)
auracode --uninstall-cleanup --dry-run
```

| Option | Effect |
|---|---|
| `--dry-run` | Prints decisions and warnings; never requests quit, waits for exit, deletes files or keys, creates a lock file, or moves the app to Trash |
| `--interactive` | Asks about worktrees with unsaved work, and says what could not be deleted |
| `--report-failures` | Only says what could not be deleted |
| `--remove-unsaved-worktrees` | Deletes worktrees with unsaved work too |
| `--remove-worktree <folder>` | Deletes this worktree with unsaved work too; repeat as needed |
| `--keep-unsaved-worktrees` | The default |
| `--data-dir <folder>` | Only this `AURACODE_DATA_DIR` folder, nothing of the installed app's |
| `--after-pid <pid>` | Waits for that process to exit first |
| `--trash-app <auracode.app>` | macOS: moves the bundle to the Trash afterwards |

Exit codes:

- 0: everything was deleted; kept worktrees do not count as a failure.
- 2: an argument was not understood, and nothing was deleted.
- 3: auracode is still running, and nothing was deleted.
- 4: something could not be deleted, and it was listed.

## Manual steps

Use these steps when the app is already gone.

1. **Save the worktrees you want.** In each repository you used with auracode, run
   `git worktree list`. Commit or copy anything in a worktree under the data folder. Then run
   `git worktree remove --force <path>` (after `git worktree unlock <path>`) for each one you are
   done with.
2. **Delete the folders.**
   - **Windows:** quit auracode, then delete the folders listed above:
     ```powershell
     Remove-Item -Recurse -Force "$env:LOCALAPPDATA\si.auracode.desktop", "$env:APPDATA\si.auracode.desktop"
     ```
   - **macOS:** quit auracode, then delete the paths listed above:
     ```sh
     rm -rf ~/Library/Application\ Support/si.auracode.desktop ~/Library/Caches/si.auracode.desktop ~/Library/WebKit/si.auracode.desktop ~/Library/HTTPStorages/si.auracode.desktop* ~/Library/Saved\ Application\ State/si.auracode.desktop.savedState ~/Library/Logs/si.auracode.desktop
     defaults delete si.auracode.desktop
     ```
   - **Linux:** quit auracode, then delete the folders listed above:
     ```sh
     rm -rf ~/.local/share/si.auracode.desktop ~/.config/si.auracode.desktop ~/.cache/si.auracode.desktop
     ```
3. **Review the keys with a current auracode binary.** Run the scoped cleanup even if its data
   folder was already removed. Do not blanket-delete every `auracode.sync.v1` credential or
   repeatedly run `security delete-generic-password -s auracode.sync.v1`: another custom data
   root or preview install may still depend on those account keys. If cleanup cannot establish
   their ownership, leave them in place until the affected roots can be reviewed.

## Edge cases

| Case | What happens |
|---|---|
| auracode is running | It is asked to quit and stops only its own agents and terminals. If it is still running, nothing is deleted (exit 3). The Windows uninstaller then offers to close it and runs the cleanup after removing the app, from a copy of the program. |
| A file is in use (a webview helper, an editor) | Retried for about ten seconds, then listed. Everything else goes. Running the cleanup again finishes once the file is free. |
| The secure store is locked or unavailable | The files go, the keys are reported as not removed, and a later run removes them. |
| Git is missing, or a repository is gone | Its worktrees count as unsaved and stay unless chosen. A registration Git could not prune is reported, with the command to run. |
| A link or junction inside the data folder | Removed as a link; what it points to is never touched. |
| Read-only files (Git objects in checkpoints) | The read-only attribute is cleared, then the file is removed. |
| A data folder from `AURACODE_DATA_DIR` | Only what auracode made there goes, and the folder goes only if it ends up empty. Its canonical index and exclusive accounts go; shared accounts, orphans and uncertain entries stay. |
| A second run | Retries retained keys using missing-root identity; a completed cleanup removes nothing further. |
| An upgrade through the installer | Keeps everything (see the Windows uninstaller). |
| macOS app run from a disk image or a translocated copy | "Move to the Trash" is not offered; drag the app to the Trash yourself. |
| The cleanup cannot start (in Settings) | auracode stays open, says why, and asks for a fresh review. |

Covered by tests:

- `cargo test -p aura-core --features account-sync --lib uninstall`, with a temporary data folder,
  real Git and a fake secure store;
- `cargo test -p aura-sync --lib vault`;
- `cargo test -p auracode-desktop --lib`;
- `apps/desktop/scripts/uninstaller-hooks.test.mjs`, which checks the hooks against the pinned
  Tauri CLI's embedded installer template;
- the dialog's Vitest suite;
- `apps/desktop/scripts/check-delete-data.mjs`, in Chromium and WebKit.

Covered only by hand, on real machines: the uninstaller itself, the macOS Trash move and the
native secure-store integration. Automated cleanup tests use only fake stores and temporary lock files.
