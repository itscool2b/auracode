# Uninstalling auracode and deleting its data

Uninstalling auracode deletes everything auracode keeps for itself, so a later install starts as
if it had never been installed. Your coding agents, their settings and your repositories are not
touched. Settings has the same deletion without uninstalling, on Windows and macOS (macOS has no
uninstaller).

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
  - the WebView2 profile (`EBWebView`).
- `%APPDATA%\si.auracode.desktop`: the window position.
- In `%TEMP%`: the updater's downloads (`auracode-<version>-updater-*`) and the CLI's probe
  folders (`aura-cli-*`).
- In Windows Credential Manager, every generic credential whose target starts with
  `auracode.sync.v1:`. These are the sign-in session, the device and account keys, and the
  account index of each data folder. Credential Manager is asked for that prefix only, so no other
  app's credential is read.
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
- Keychain items with the service `auracode.sync.v1`. The keychain is searched for that service
  only.
- With "Also move auracode to the Trash": the app bundle. Launch Services then forgets the
  `auracode://` link.

auracode adds no login item, Run key or launch agent, so there is none to remove.

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

### Settings, on Windows and macOS

In Settings, open About, then Delete all auracode data under This device. The review lists:

- every folder and file that would go, with its size;
- where the keys are;
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
```

| Option | Effect |
|---|---|
| `--dry-run` | Prints what would go and changes nothing |
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
3. **Delete the keys.**
   - **Windows:** `cmdkey /list` shows auracode's entries as `auracode.sync.v1:...`. Delete each
     one with `cmdkey /delete:<target>`, or delete them in Credential Manager, under Windows
     Credentials.
   - **macOS:** run `security delete-generic-password -s auracode.sync.v1` until it reports that
     no item was found, or delete the items in Keychain Access.

## Edge cases

| Case | What happens |
|---|---|
| auracode is running | It is asked to quit and stops only its own agents and terminals. If it is still running, nothing is deleted (exit 3). The Windows uninstaller then offers to close it and runs the cleanup after removing the app, from a copy of the program. |
| A file is in use (a webview helper, an editor) | Retried for about ten seconds, then listed. Everything else goes. Running the cleanup again finishes once the file is free. |
| The secure store is locked or unavailable | The files go, the keys are reported as not removed, and a later run removes them. |
| Git is missing, or a repository is gone | Its worktrees count as unsaved and stay unless chosen. A registration Git could not prune is reported, with the command to run. |
| A link or junction inside the data folder | Removed as a link; what it points to is never touched. |
| Read-only files (Git objects in checkpoints) | The read-only attribute is cleared, then the file is removed. |
| A data folder from `AURACODE_DATA_DIR` | Only what auracode made there goes, and the folder goes only if it ends up empty. Account keys stay, since the installed app may use them; that folder's own index entry goes. |
| A second run | Finds nothing and changes nothing. |
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
keychain sweep.
