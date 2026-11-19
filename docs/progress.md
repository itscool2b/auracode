# Auracode implementation progress

## 2026-11-16: auracode accounts removed

The owner decided the app is local-only, because Claude Code and Codex sync plugins natively. The
account system is gone from the code: sign-in and account profiles in the desktop app, plugin and
configuration sync between devices, `crates/aura-sync`, the SQLCipher store and aura-core's
`account-sync` feature, the account API (`apps/api`) with its D1 migrations, and the website's
sign-in, sign-up, device verification and account pages. Entries below that describe them are
history and are left as written; the documents they point to (`cloud-api-v1.md`,
`sync-crypto-v1.md`, `desktop-account-client.md`, `account-*.md`, `config-apply.md`,
`config-profile-transitions.md`) were deleted with the code.

What stayed: agents' own accounts, remote access, local profiles, the Plugin library on this
device, shared MCP, project memory, chat export, the updater and the release catalog. A profile
folder an account left in a data folder is never opened, listed or deleted; when it was the
last-used profile, Local opens instead. The profile database's migrations were not changed, so the
tables sync used remain, unused. The Cloudflare resources the account system used were not
touched and are listed in `infra/README.md` for the owner to remove.

## 2026-10-29: Native clone folder admission

The native onboarding clone path reserved the selected parent and then rejected its own child
destination as an overlapping mutation. Shared Git admission now checks and reserves the complete
folder batch under one lock. Existing chat, terminal and mutation owners still block overlapping
paths. Both parent and child retain their actor reservations and release with the operation guard.

The regression failed through `SessionManager::clone_check` and `clone_start` before the fix.
Seven focused session tests now pass using a temporary home, isolated Git settings and a real
local repository reached through the normal HTTPS form. They cover clone success and restart
recovery, external owners, real Git failure and cancellation, both requested chat actors, actor
refusal and cancellation during actor admission. A separate batch test checks atomic failure and
independent retention of nested requested paths. The broad core run passed 640 unit tests and
failed the unchanged folder-list timing test; its isolated rerun passed. All 102 integration
tests passed separately. Core account-sync Clippy with warnings denied, changed-file rustfmt,
instruction parity and diff checks pass. Independent review and rebuilt native acceptance remain
pending.

## 2026-10-29: Canonical Sending messages and the prompt header

Local branch `codex/chat-sending` preserves held-message FIFO. A new message waits behind
older held messages until they are released. While Rust saves the checkpoint, `SessionInfo.sending`
carries the persisted prompt ID, complete text, attachment parts and creation time. React uses
that ID to reconcile queue removal and the canonical user turn, including when the command
acknowledgment arrives after the event. No truncated-prefix matching or eight-message cache
remains. Attachment-only prompts remain visible while sending and after reattachment.

The prompt header has its own reserved space above the transcript scrollport. Changing its
height preserves the reading position, and clicking it returns to the actual prompt. The chat
browser check now asserts that the header does not cover transcript content.

Focused verification: desktop chat-store and screen tests 77 passed; Rust checkpoint tests
6 passed, queue-wait tests 13 passed and session-turn tests 29 passed. Chromium and WebKit
`check-chat.mjs` passed, each with 32 accessibility scans, queue reasons, reading anchors,
prompt navigation and bounded history/tool rendering. Changed frontend sources pass Biome;
style and local instruction checks pass.

Independent review found a prompt could leave Sending while background work still delayed
dispatch. The chat now refreshes the durable queue whenever Sending clears without its matching
start or lifecycle event, including unheld returns. The attachment-only regression failed before
the fix; chat-store, transcript and queue-wait tests now pass 73 tests. Scoped review remains
pending alongside the publication gates below.

Pending before publication: independent review, native walkthrough and integrated gates.
Windows Application Control blocks the pinned pnpm executable, so frozen install has not run.
The desktop and workspace binding exporters stop in dependencies with E0463; regenerated
bindings and the resulting TypeScript check remain pending. Installed-dependency tests above
do not establish those unavailable gates.
## 2026-10-29: Clone recovery admission review

Recovery actions and normal clone admission are now mutually exclusive. A delayed completed-clone
check cannot replace a newly running clone's ownership record or prevent cancellation on close.
Both deferred-response regressions failed before the fix. All 21 focused frontend tests,
TypeScript checks and Chromium/WebKit setup-action checks pass. The Rust lifecycle test also
replaces only `.git`, verifies project addition is refused, and preserves both directories when
the notice is dismissed. All 14 clone tests pass on the integrated sources. Independent re-review,
native command compilation and main desktop binding generation remain publication gates.

## 2026-10-29: Interrupted clone recovery

Local branch `codex/clone-recovery` records clone lifecycle phases in app data before destination
creation, after creation, after a successful Git exit, and on settlement. Records contain the
validated address, path and directory identities, with no command output or environment. Recovery
preserves destination files, including missing, replaced or linked paths and malformed records.
The onboarding clone form and New project dialog list previous clones with Open folder, Retry in
another folder, Add existing project for a completed clone, and record-only Dismiss notice. Adding
an existing clone revalidates its directory and Git identities before the normal project form.

Verified on Windows with temporary folders and isolated Git configuration: core cloning tests
14 passed, including a real clone from a local bare repository; core account-sync Clippy passed
with warnings denied; setup-action bindings regenerated from Rust; desktop typecheck passed;
focused clone frontend tests 19 passed. Chromium and WebKit setup-action checks passed with
recovery actions, accessibility and a dialog overflow assertion. Formatting and local instruction
checks passed. The initial Rust compile found a Drop-constructor move and the narrow Windows
identity wrapper needed an explicit unsafe-code allowance; both were fixed before passing checks.

Native command compilation, the full desktop bindings exporter, native walkthrough and independent
review remain pending. Windows directory-entry power-loss durability and Unix execution have not
been verified. Test linking retains the existing OpenSSL missing-PDB warning. The pinned package
manager remains blocked, so frontend results used installed dependencies.

## 2026-10-28: Instruction files, one file for every agent or a file per agent

Branch `instructions` (from `origin/main`, with `origin/main` 6c383b5 merged in). Details,
the per-agent table with each vendor's sources, and every edge case with its test are in
`docs/instructions.md`.

- **What it does:** Settings gains an Instructions page for your user files, a project folder
  or a chat's own folder (its worktree), opened from Settings, a folder's Instructions button in
  project settings, and the palette. It shows which file each agent reads (directly, through an
  `@AGENTS.md` import, a link or a managed copy), lets the text be edited, and switches between
  one file every agent reads and a file per agent. In a project the shared file is `AGENTS.md`:
  agents that read it natively need nothing (Claude Code too, 2.1.277+, when no CLAUDE file is
  in the folder or above), Claude Code otherwise gets `CLAUDE.md` with `@AGENTS.md`, and managed
  byte-identical copies are used only where neither works (user scope: Pi, oh-my-pi, OpenCode,
  Antigravity, Grok Build). No symlinks are created; existing ones are respected.
- **Safety:** every write is a review of exact files and diffs that Rust prepared; Apply rechecks
  every reviewed byte, backs replaced text up in `<data>/instructions/backups`, publishes with
  no-overwrite hard links and puts every file back if one fails. Different texts are chosen or
  combined first, overrides go only when ticked, a hand-edited copy is restored or adopted by
  choice. Links are classified by the OS's own resolution against the canonical folder (a
  security review finding: text resolution of `..` disagrees with the OS through linked folders);
  outside and dangling links are never followed or written. Writes share the configuration gate
  with Library copies and config sync and run in the maintenance owner.
- **Git and worktrees:** read-only Git status flags untracked, ignored and modified files; an
  untracked file can be added to the folder's worktree setup (the store now saves by folder only
  with an explicit flag) or committed alone (one path staged and committed; other staged work
  stays; a failed commit unstages it).
- **Library:** the Library's user-level instruction copy is superseded by this page; the Rust
  logic does not depend on the Library interface.
- **Interface:** Vercel's settings cards: scope and mode rows, the text card with who reads it in
  its footer and the one primary, then agents with status circles (owner decision: circles, volt
  only for an edited copy, an override in the way, nothing to read, or a size limit). Previews:
  `?preview=instructions`, `-per-agent`, `-conflict`, `-drift`, `-large`, `-review`.

Verified locally on Windows: `pnpm lint` (28 warnings, all pre-existing), `pnpm typecheck`,
`pnpm test` (root scripts 22, ui 278, desktop 5 node and 464 with 19 skipped, 8 of them new,
design lab 352, web 4); `cargo test -p aura-config` 141 (39 new), `cargo test -p aura-core
--lib` 473 (3 new, and the folder-save case in the setup store test), `cargo test -p
auracode-desktop --lib` 210 (with `export_bindings`); Clippy with `-D warnings` on aura-config,
aura-core and auracode-desktop; `cargo fmt --check`. `check-instructions.mjs` in Chromium and
WebKit (9 axe scans each, 0 violations) and `check-layout.mjs`, 308 of 308 views clean across
both engines and both sizes (eight new Instructions views). Sheets beside the Vercel New Project
card and Transfer dialog and Grok's settings, at 1440x900 and 1024x700, are the ignored
`target/design-research/sheets/app-instructions-*.png`. Symlink file cases skip here (creating
file symlinks needs Developer Mode); the classifier unit test and a Windows junction test cover
them. Not run: a real agent reading the files, the built app (the owner's debug app was
running), automatic recovery after a crash mid-apply (deferred), macOS, the hand walkthrough
and CI.

## 2026-10-28: M3 setup, clone and agents

Branch `m3-onboarding` (from `app-integrated`).

- **Setup:** the account step says it plainly ("Accounts are optional." / "And invite-only for
  now."): auracode needs no account and no network, everything stays on this computer, and an
  account with an invitation only adds sync. Welcome says the same in one line. Every step stays
  skippable, the step is saved on every move, motion stays out of the steps and the intro (the
  dither field forming the seal and turtle) keeps its skip rules.
- **Clone a repository** (Rust, `aura-core::cloning`, replacing the isolated GitHub-only clone):
  the form is read by Rust on every change (typing waits 200ms) and answers with the first
  problem beside its field or the exact `git clone --progress -- <address> <folder>`. Only
  https:// and SSH addresses are accepted; everything else is refused with its reason. Git runs
  with the person's own configuration, credential helpers and SSH setup (only variables that
  point Git at another repository are removed, and `GIT_TERMINAL_PROMPT=0` since no terminal is
  attached); auracode never reads or stores credentials. Start creates the destination
  atomically; Cancel, a failure, closing the form or quitting stops Git's process tree and then
  removes only that folder, while it is still the one created. Progress streams from Git's own
  lines through a long poll (`clone_status` with `after`). Setup opens the clone in place on the
  first-project step (X Money's one question per screen) and a finished clone becomes the first
  project; New project offers the same clone in a dialog beside Choose folder. The journal
  folders beside clones and the history view are gone. Decision: the owner's brief (the
  person's own Git and helpers, Cancel removes the partial folder) replaces the earlier isolated
  design; an app crash mid-clone leaves the unfinished folder, and the next clone with that name
  says it exists.
- **Agents:** a reviewed one-click install for Grok Build (`@xai-official/grok@1.0.70`, xAI's
  documented npm distribution, published and signed by xAI's npm account). Sign in now runs the
  vendor's own login for Cursor (`cursor-agent login`), Grok Build (`grok login`), OpenCode
  (`opencode auth login`) and Hermes (`hermes auth`), beside Claude Code and Codex. Cursor,
  Hermes, oh-my-pi, OpenCode 2 and Antigravity keep their guides, each with its reason in
  `docs/setup-actions.md`; Pi, oh-my-pi and Antigravity sign in inside their own interface.
- **Fixtures and checks:** `?preview=clone`, `clone-running`, `clone-error`, `new-project` and
  `agents-installing`; `check-layout.mjs` probes them and the clone dialog; `check-setup.mjs`
  adds a keyboard clone into a first project and the account copy; `check-setup-actions.mjs`
  covers the clone dialog (command before start, refused address, cancel, finish, failure and
  retry, taken name). The install review's rows now sit on the 4px grid.

Verified locally on Windows: `pnpm lint` (37 warnings, all pre-existing CSS specificity),
`pnpm typecheck`, `pnpm test` (root scripts 22, ui 276, desktop 5 node and 441 with 19 skipped,
design lab 352, web 4; 15 new desktop tests for the clone controller and its markup). Rust in
the shared target after cleaning the workspace crates: `aura-core` cloning 11 passed (real Git:
a clone from a local bare repository through a file URL, a failed clone, a cancel against a
server that never answers, removal of read-only pack files), `aura-agents` lib 51 passed,
`aura-protocol` 23 plus its export tests; the desktop `export_bindings` (no change from the
committed bindings); Clippy with `-D warnings` on aura-protocol, aura-core and aura-agents (all
targets) and auracode-desktop (lib and tests); `cargo fmt --check`. Chromium and WebKit:
`check-setup`, `check-setup-actions`, `check-folder-resolution`, `check-agent-installations` and
`check-layout`, 280 of 280 views clean. One real install, as the brief allows for an agent not
already on this PC: the reviewed argv (`node npm-cli.js install --global
@xai-official/grok@1.0.70`) installed Grok Build into npm's user prefix, and `grok --version`
reports 1.0.70; it stays installed. No login was started and Claude Code, Codex, Pi and OpenCode
were not touched. Sheets beside their references, at 1440x900 and 1024x700 (ignored):
`target/design-research/sheets/app-m3-*.png`. Not run: a real remote clone or sign-in through the
built app, the WebDriver smoke, macOS, the hand walkthrough and CI. Hermes cannot start on this PC
(Application Control blocks its bundled `_sqlite3`), so its `hermes auth` was checked in its
source, not run.

## 2026-10-27: M4 parallel work: terminal panel, merge conflicts, more editors, missing folders

Branch `m4-panel` (from `m4-worktree-ui`).

- **Docked terminal panel:** each chat has a bottom panel of project shells under the composer,
  toggled by Ctrl+` (Cmd+` on macOS), Ctrl+Shift+` for another, the chat menu (Show or Hide
  terminal, with keycaps) and the palette (also New terminal). A new tab asks Rust to review the
  chat's folder (the worktree for a worktree chat) and starts the first shell Rust offers, or the
  one chosen in the shell menu; the folder shows in mono at the right. Tabs are the right panel's
  quiet pills (arrows, F2 to rename in 40 characters, Delete or the trash button to close); the top
  edge resizes on the 4px grid (280 by default, 120 to 800, keeping 240px for the conversation).
  `TerminalPanels` (`lib/terminalPanel.ts`) lives with the chat screen, and each tab's xterm element
  moves between the panel and a detached host, so shells keep running while the panel is hidden or
  another chat is open; closing a tab, reloading or quitting stops them. Focus moves into a shell
  only on the person's request, and inside a shell every key but Ctrl+` belongs to it (on Windows,
  Ctrl+C with a selection copies and Ctrl+V pastes). The sheet and the panel share `openXterm`.
  Decision: the panel's New terminal is itself the explicit start (the reviewed folder and shell
  are shown in the panel), where the modal sheet keeps its separate Start; nothing runs a command.
  Rust: project shells get their own pool (`reserve_project`, several per window, eight in the
  app), apart from the one-per-window, four-per-app vendor terminals, and `start_project` refuses a
  vendor reservation. The quit question already counted shells by folder use; tests now cover
  several shells in one folder, cleanup one by one and confirmed quit. The menu's "Terminal and
  editor" row is now "Open in editor" (the same Project tools dialog).
- **Merge conflicts:** a conflicted merge review in the Git workspace dialog shows, for a chat that
  works in that worktree, the exact message its agent would receive (both branches, the folder and
  every path, thirty listed) with "Ask <agent> to resolve", which sends it through the ordinary send
  path as the person's own visible message (only when the composer could send) and closes the
  dialog, and "Open in <editor>" for each detected editor. Merge stays disabled until a new review
  is clean; a chat outside the worktree gets one line saying where the work happens.
- **Editors:** Zed, IntelliJ IDEA, WebStorm, PyCharm, RustRover, GoLand and CLion join Cursor and
  the VS Code builds (`session/editors.rs`, metadata only). Windows: Zed and Toolbox installs under
  `%LOCALAPPDATA%\Programs`, Zed and standalone JetBrains installs under Program Files (versioned
  `JetBrains\<IDE> <version>` folders, newest first, lookalikes ignored), and an older Toolbox's
  `.cmd` script read (8 KiB at most) only for the absolute IDE executable it names, never run.
  macOS: bundles in `/Applications` and `~/Applications`. They open through the detected launcher
  with the folder as one argument (the executable on Windows, detached with the reviewed
  environment; `/usr/bin/open -a <bundle>` on macOS); a review binds the launcher by file identity.
- **Missing worktree folder:** when the newest start failure is a missing folder and the folder is
  the chat's own missing worktree, the error card leads with Recreate folder (Retry steps back to
  soft) and opens the Git dialog's reviewed confirmation; afterwards a dock line says the folder is
  back and Retry is the way on. Nothing starts by itself.
- **Fixtures and checks:** `?preview=terminal-panel` (`&tabs`, `&height`, `&refuse`),
  `git-conflict` and `missing-worktree`; new `check-terminal-panel.mjs`; `check-git-review.mjs`
  adds the conflict and start-error flows; `check-project-tools.mjs` the new editors;
  `check-layout.mjs` seven new views. The palette's result list now snaps its cap to the grid.

Verified locally on Windows: `pnpm lint` (37 warnings, all pre-existing CSS specificity), `pnpm
typecheck`, `pnpm test` (root scripts 22, ui 276, desktop 5 node and 399 with 19 skipped, design
lab 352, web 4); `cargo test -p aura-core --lib` 439 passed (10 new); `export_bindings` and the
desktop editor URL test; Clippy with `-D warnings` on aura-core, aura-protocol and
auracode-desktop; `cargo fmt --check`. Chromium and WebKit: `check-terminal-panel` (7 axe scans
each), `check-git-review`, `check-project-tools`, `check-chat`, `check-settings`,
`check-new-chat-worktree` and `check-layout`. Some freshly built build scripts were refused by
Application Control (4551) in both target folders; a later ordinary rebuild was accepted, nothing
was bypassed. Chromium's emulated 2x scale draws xterm's WebGL glyphs at twice their cell size
(its DOM renderer and WebKit's 2x are correct); real high-DPI WebView2 was not checked. Sheets
(ignored): `target/design-research/sheets/app-m4-panel-terminal.png`, `-conflicts.png`,
`-editors.png`. Not run: a real shell, editor or agent through the built app, the WebDriver smoke,
macOS, the hand walkthrough and CI.

## 2026-10-27: M4 worktree chats in New chat, and recreating deleted folders (interface)

Branch `m4-worktree-ui` (from `app-redesign` with `m4-worktree-backend` merged) builds the interface
for the entry below, after the Codex app's per-thread Local or Worktree mode.

- **New chat:** once a project folder and an agent are known, `WorktreeChoice`
  (`lib/chat/worktreeChoice.ts`) reviews it with `worktree_chat_preview`. A Git folder shows one
  chip row under the card ("Worktree from main on aura/7f3a9c2e"); its popover, in the picker's
  shell, switches to Local, starts from another local branch, names the branch (Apply or Enter,
  never submitting New chat), brings uncommitted changes (only from the current branch) and skips
  the saved setup. Defaults need no click: Create applies the reviewed plan. Changes are reviewed
  after 200ms (a typed name at once); answers for an older folder, agent or option are dropped; a
  refused change goes back to the last reviewed options with Rust's reason beside its control, and
  Create stops and reopens the popover rather than apply other options. Reviews are cached by their
  options until 30 seconds before expiry, so switching back and forth does not pile up open previews
  (Rust allows 32), and the first generated name is kept so the chip does not change name with
  each review. A plan near expiry is reviewed again before Create, and a refused apply (stale or
  expired token) is reviewed again for the next Create. A plain folder shows nothing extra and
  works directly; a folder that cannot have a worktree (no commit yet, detached HEAD) falls back to
  Local with the reason under the chip. The busy-folder consent shows only for Local.
- **Setup:** a saved setup command waits in the shared terminal sheet with the reviewed folder,
  copied files and command as rows; Start stays explicit, as the setup panel already decided. A
  clean exit starts the agent at once (`chat_start`); closing early or a failed exit starts it too
  and shows the note, with Create becoming Open chat.
- **Picked folders:** a folder chosen with Choose folder now joins the workspace as its own project
  at once (it was created at Create before), so its Git state is reviewed before Create, as a
  project is added before a thread in the Codex app. A failure leaves it to Create, which then
  shows a first worktree review instead of creating one unseen.
- **Recreate:** a missing worktree in the Git workspace dialog offers Recreate folder beside Review
  recovery. The confirmation follows Vercel's transfer dialog: the question, Rust's sentence that
  uncommitted files in the deleted folder are gone and committed work is kept, the branch, commit
  and folder as rows, Rust's other notes, then Cancel and Recreate folder. A refused or expired
  review is fetched again for the next try. Only the Git dialog lists missing worktrees today; a
  chat whose folder is missing still shows its start error without a link there.
- **Fixtures and checks:** `?preview=new-worktree`, `new-setup`, `new-unavailable`, `new-plain`
  and `git-missing` (`dev/newChatWorktreeFixture.ts` imitates Rust's review); `check-layout.mjs`
  probes them plus the popover, Local, a refused name, the setup terminal and the recreate dialog;
  `check-new-chat-worktree.mjs` drives the flows; `check-git-review.mjs` now ends with recreation.
  `.new-chat` fills the pane below the drag band so the popover has the window's room under the
  card. Visual language 6.13 and 6.19 describe the chip, its popover and the dialog.

Verified locally on Windows: `pnpm lint` (no new warnings), `pnpm typecheck` and `pnpm test` (root
scripts 22, ui 276, desktop 5 node and 376 with 19 skipped, design lab 352, web 4; 25 new desktop
tests for the choice store, the chip, the setup status and the recreate sentence). In Chromium and
WebKit: `check-new-chat-worktree` (8 axe scans each, all clean), `check-chat`, `check-settings`
(which runs `check-git-review` with recreation and `check-worktree-setup`) and `check-layout`, 188
of 188 views clean. Sheets beside the Grok composer and Vercel transfer dialog references, at
1440x900 and 1024x700 with 2x details, are the ignored
`target/design-research/sheets/app-m4-*.png`. Not run: the bindings export (the merge took the
backend's `bindings.ts` without conflict), the WebDriver smoke against a real build, a real Git
repository through the built app, the hand walkthrough and CI.

## 2026-10-27: M4 one-step worktree chats and recreating deleted worktrees

Backend only; the redesigned interface is built separately.

A new chat can now start in its own app-owned worktree in one reviewed step, modeled on the
Codex app's Worktree mode. `worktree_chat_preview` takes a project folder, agent, optional local
starting branch (default: the source's current branch), optional branch name, title,
bring-changes and run-setup. Generated names are unique `aura/<slug>` names from the title or a
short ID, with a numeric suffix on collision. Typed names must pass `git check-ref-format --branch`
and a portable character set, and may not reuse or overlap an existing branch, ignoring case. The
preview returns the source, starting commit, branch, destination, recent local branches, the saved
setup recipe that will run, warnings and a compact chip (mode, starting branch, branch, label).
A plain folder, or a folder inside another repository that is not its root, returns
`not_git_repository` so the UI can fall back to Direct. `worktree_chat_apply` reuses the isolation
create path (now shared helpers in `create.rs`), saves the chat in the source's project with the
worktree registered as its folder exactly as relocation does, so Merge/PR/Discard, handoff and
folder context work unchanged. It then copies the reviewed setup files and returns the setup command
token for the existing owned-terminal start. The agent starts right away only when no setup command
is pending. Without bring-changes the source folder is not reserved: Git only adds a branch and a
worktree registration, so a busy source chat does not block a parallel one. Bringing changes is
allowed only from the source's current commit and reserves the source like isolation does.

Failure behavior: a stale token, a moved starting branch or a branch created after preview is
refused before Git runs. If creation fails or the chat cannot be saved, the new folder is removed
with `git worktree remove` and the branch with `update-ref -d <branch> <starting commit>`, only while
both are exactly as created (no new commits, no unexpected edits, our lock). Otherwise the record
stays RecoveryRequired with the reason and the error names the retained path and branch. The
user's index, HEAD and other branches are never changed. Limits: a record whose chat was never
saved is not yet surfaced in the UI, and the existing setup command start still reserves the
source folder, so it waits for chats there to stop.

`worktree_recreate_preview`/`worktree_recreate_apply` recreate an active worktree whose folder was
deleted by hand, separately from recovery review. Preview requires both owned paths to be missing,
the source to inspect, `refs/heads/<branch>` to exist and the branch not to be checked out in any
other registration. Apply journals Creating, runs `git worktree add -f -f --lock --reason
"auracode <id>"`, rechecks the lock, branch and commit, and records Ready. A real-Git test verifies
that a single `-f` cannot replace the locked missing registration and double force does. Only the
two owned paths are reserved. The preview warns that uncommitted files from the deleted folder are
gone and everything committed on the branch is kept.

Verification on Windows: `cargo test -p aura-core --lib` passed (429), including eight new real-Git
worktree chat tests, three recreate tests, five session tests and the folder-scoped setup read.
`cargo clippy -p aura-core -p aura-protocol -p auracode-desktop --all-targets -- -D warnings`,
`cargo fmt --check`, `export_bindings` and `pnpm typecheck` passed. One freshly built proc-macro DLL
was refused by Smart App Control (Code Integrity 3077/3033); a normal clean rebuild of that crate
was accepted. The vendored OpenSSL build used the existing local Strawberry Perl via
`OPENSSL_SRC_PERL`. Account-sync feature tests, macOS and the UI were not run.

## 2026-10-26: profile configuration transaction engine

Added a read-only managed-profile transition planner and a bounded transactional apply/restore
engine. It records each receipt ID before dispatch, verifies final selected content and preserves
unmanaged concurrent changes during inverse application. Five synthetic transaction regressions and
aura-config all-target Clippy pass. Encrypted transition storage, the root locator, startup admission
and actual profile publication/recovery integration are still pending. No real configuration or
agent process was accessed.

## 2026-10-26: managed configuration claim foundation

Added an encrypted, content-bound Account ownership store and explicit prepare/commit/cancel claim
functions. They preserve the first device baseline, retain unresolved acknowledgments and distinguish
committed management from ordinary sync heads. Account prepare/close now creates and invalidates the
dedicated store. Three pure claim regressions and aura-config all-target Clippy pass. The new encrypted
store test awaits native account-feature execution in the integrated environment. Profile filesystem
switching and typed crash recovery are still pending, as described in `docs/config-profile-transitions.md`.

## 2026-10-26: explicit vendor integration reviews

Added personal Claude plugin/marketplace, Codex plugin/marketplace and Pi package command planning,
an explicit Library form and an owned terminal flow. Starts consume a ten-minute page/profile token
and recheck executable bytes, config realm and selected public declarations. The terminal retains
profile, mutation and quit/update maintenance guards through confirmed cleanup. Unsupported vendor
commands and private/ambiguous targets remain explicit errors. See `docs/vendor-integrations.md`.
Three synthetic planner tests, agent all-target Clippy, generated protocol DTO export and three
frontend tests passed. Chromium and WebKit fixtures verified separate review and explicit Start,
terminal cancellation and accessible dark forms. Full native compilation/test execution remains
pending where Application Control blocks dependency build scripts. Existing steering-event frontend
type errors are outside this checkpoint. No real integrations, credentials, vendor prompts,
remote CI or deployment ran.

Updated 2026-10-26. Scope: the accepted Rust-first, Cloudflare-hosted plan, M1b through M9.

## Active integrated-product continuation

Integration update: `737013f` brings the coherent M1e native agent catalog and Rust project
organization into the UI branch. `6e58695` adds native shell behavior. Thin workspace commands,
project create/edit/add-folder, chat rename/pin/archive/restore/move and busy-folder preflight are
now wired locally. Stored default-model editing is withheld until its startup behavior is implemented.
The next binding export was blocked while rustc loaded `tauri_macros` by Windows Code Integrity
events 3077/3033 at 05:00 local time. No policy changes or relocation workaround was attempted.
Generated workspace command bindings and their dependent TypeScript checks remain pending the
planned Windows/macOS integration gate. This is a saved implementation checkpoint, not acceptance.

- Owner corrections are authoritative: Windows/macOS only; batch implementation and CI; use the
  actual original Mobbin references; dark appearance only across desktop, onboarding and website.
- Inspected Grok, SpaceXAI, Harvey, Aside and X Money screens and the selected Orbit lab. Evidence
  and UI mapping are in `docs/design/reference-audit.md`. Replaced the old frame with compact
  navigation, live Needs you, project folds, agent dock, title header and a unified composer.
- Session options and controls remain real but move into disclosures. Pending permissions replace
  the composer without destroying the draft. The product no longer follows OS appearance.
- Local `de4010f` preserves sticky prompt context, focused output, command output folding and the
  native smoke helper's ability to find virtualized tools. Its final native rerun is pending.
- Structural UI checkpoint: desktop TypeScript check passes; production preview visually inspected
  in dark; changed-file Biome has no errors (three CSS ordering warnings). The full functional,
  accessibility, responsive and native suite is reserved for integrated acceptance and is not done.
- Rust project organization APIs, native shell and PTY work are implemented in parallel branches.
  Integrating those implementations and completing their product surfaces is the next work.
- No CI was dispatched for these local checkpoints. Full product completion remains pending.

## M6/M7 Rust cloud API checkpoint

- Implemented Rust Worker auth, bounded email-code challenges, Turnstile verification, hash-only
  sessions, browser Origin/CSRF checks, desktop-bound device registration and approval/recovery.
- Added SQLite-compatible D1 migration, opaque encrypted record/chunk push/pull with monotonic cursors,
  private R2 blob CAS with quota reservations, and retryable account/orphan cleanup. Cloud account
  keys never enter this service. Contracts and deployment prerequisites are in docs/cloud-api-v1.md
  and apps/api/README.md; the independent client owns E2E key handling and merge/application behavior.
- Native Rust tests pass 27 cases, including actual shared SQL atomicity/authorization, quota rollback,
  device bootstrap/approval expiry, recovery binding, revoked writes and blob CAS. Native all-target
  and wasm32 Clippy pass. worker-build 0.8.7 produced the release Wasm and generated runtime shim.
- Five local compiled-Worker runtime tests passed against isolated Miniflare D1/R2: concurrent code
  consumption, browser CSRF/Origin, sync booleans/cursors, private blob CAS and retained-device proof. External network
  requests are blocked by the harness. Pinned Wrangler's production-config dry run passed without
  deploying. Migrated obsolete pnpm build approvals to allowBuilds and approved the pinned workerd
  tool required for these local tests; no host security policy was changed.
- No cloud application, migration, email, account or CI run was deployed/executed. Preview runtime
  tests, production Email Service onboarding, Turnstile/secrets, client integration and installed
  acceptance remain pending. M5 signed release publication is separate.

- Retained desktop device keys can now rebind a fresh sign-in through a five-minute, one-use
  X25519/HKDF/XChaCha20-Poly1305 possession challenge. Its context binds account, device, challenge
  and both public keys. Atomic consumption rechecks expiry, revocation and fresh-session identity;
  replay, wrong-session, expiry and revocation regressions pass. No account key enters this proof.

- Account summary, session-wide sign-out, verified email changes and bounded streaming encrypted
  exports are implemented in Rust. Eight actual compiled-Worker tests pass, including email proof
  isolation/replay, preservation of account identity and export completion without session secrets.
  Native and wasm Clippy pass. The new native SQL unit rerun is blocked by Windows Application
  Control (4551); its compiled-Wasm runtime path passes. No policy or executable was changed.

- M6 website checkpoint: dark-only landing, download, email-code auth, account, privacy, terms and
  changelog routes prerender to static HTML. Account views call the Rust API; browser code handles
  presentation/transport only. The hero uses the actual dark desktop fixture. Build/typecheck,
  static/CSP checks, an assets-only Wrangler production dry run, Chromium and WebKit UI flows,
  and home/account Axe checks pass. Tests block
  external requests and use synthetic responses. Real Turnstile/email/preview integration, macOS
  browser acceptance, installer publication and legal review remain pending. No deploy or CI ran.

Current owner correction: Windows and macOS are the supported targets. Linux and WSL work and
acceptance are deferred. Implementation checkpoints are committed locally with focused checks;
the root task will run CI at major integration and final verification points.

M2b backend work is isolated on `codex/m2b-core`, based on the integrated catalog. The initial
`aura_protocol::workspace` types define project metadata, device-local folder mappings, archived
listing filters, pinned chat metadata, explicit moves, and a busy-folder creation preview. Existing
`ChatSummary` and transcript frames retain their shape. These types are exported in the generated
desktop bindings. Rust now implements project creation/update/folder addition, rename, pin,
archive/restore, organization moves, and project chat creation through the existing SQLite writer.
Busy-folder preflight resolves aliases and includes preparing and retiring sessions; concurrent
project chat creations serialize the final check. Moves require a stopped chat with no queued
prompts, never move files, and cannot change a native session's cwd until the visible handoff path
is implemented. Mutations acknowledge their actual transaction, and actor dispatch waits for a
pending move. Manual titles reject late automatic writes. Saved workspace reads still work when
saving pauses, and another device's folder mapping is never used for local launch.
All 268 core unit tests and all-target core Clippy pass, including nine new organization and
actor regressions. The binding export test passes locally. Tauri wiring, Git folder identities,
checkpoints/Changes/revert, edit/retry/fork and visible agent handoff remain pending. No CI push
or real agent invocation was performed.

The standalone Rust checkpoint service now captures exact file bytes in per-folder shadow Git
repositories using temporary indexes and `refs/aura` refs. Its owned Git helpers disable inherited
Git overrides, global/system configuration, hooks, filters and line-ending conversion. Gitignore
rules, 10 MiB file and 100 MiB total limits, submodule/link exclusions and protected agent/profile
directories have explicit behavior. Changes preserves excluded files as exclusions, never as
deletions. Revert requires a one-use content-bound preview and validates the full selection before
writing. Directory-relative capability handles keep reads and restores inside the selected folder;
replaced/removed files remain in a visible recovery directory if a later step fails. Partial failure
is an explicit result. Eight focused tests cover exact CRLF bytes, unchanged user index/HEAD, ignore
changes, exclusions, restore, stale previews and a concurrent edit between validation and rename.
Core Clippy and desktop binding export pass locally. The Changes DTO is generated.

Production desktop and CLI turns now save the checkpoint before forwarding their original typed
prompt parts. Capture failure holds the queued prompt with a visible reason; interrupt cancels a
pending capture. Native background activity still prevents dispatch until authoritative idle.
The checkpoint reference is saved in the existing turn column, with no new migration. Changes
waits for earlier actor writes before selecting the saved turn. Revert reserves the canonical
folder until file writes finish, including when an RPC is abandoned, and refuses active, preparing
or retiring agents. A later start cannot race that reservation. Diff reads only scanner-approved
files and opens each component without following links. The same image capability guard used by
the composer rejects unsupported images before enqueue without dropping typed parts.
All 281 core unit tests and all-target core/CLI Clippy pass on Windows. The 12 focused checkpoint
tests pass after the history barrier. CLI checks passed 44 unit, 4 demo, 6 headless and 3 scripted
native smoke tests. The binary unit-test executable was blocked by Application Control (4551),
so the full CLI integration command could not finish. The scripted fixture now uses its store's
actual device ID instead of a mismatched literal, preserving device-local folder isolation. Tauri command wiring,
macOS execution, edit/retry/fork and visible handoff remain pending. No CI push was made.

The continuation DTO now defines paged turn summaries, editable free text with retained context,
switch/retry/edit/fork actions, and an exact visible preview with a one-use expiring token.
Retry/edit previews show their complete prompt; switch/fork wait for the next user message.
Source transcript preservation and native-resume status are explicit. TypeScript export passes;
continuation persistence and execution are still being implemented.

The final local M1e follow-up resolves Windows Pi, OMP and Grok npm shims through the reviewed
package's bounded `package.json` bin entry, using `node.exe` or a packaged executable. It never
interprets shim content. Package name, relative entry containment and canonical target are checked;
unknown shims and project-local packages stay unavailable. Channel metadata and update validation
refer to the actual package entry. Fake Windows package/launch/update checks, bounded manifest
tests and all-target aura-agents Clippy pass. No vendor binary was invoked for these tests.

## M1e combined agent checkpoint (2026-10-26)

The catalog branch now includes native Codex, native Pi, the qualified ACP catalog and restricted
text fallbacks, including M1d's notification attachment regression. Pi's readiness assertion uses
the shared optional native identity contract. Catalog assertions derive from the registered data.
The supervisor includes reviewed environment overlays, same-connection inspection and launch, and
an explicit binding from the launched executable to the prepared executable set. WSL launch stays
unavailable until the owned bridge and deployment are qualified.

Local workspace/all-target compilation, full workspace Clippy with all features, generated bindings,
rustfmt, spike documentation checks, and pnpm check pass. The combined agents, CLI, core and driver
test targets pass. All 17 focused supervisor tests pass after correcting the redaction expectation.
The broader process integration targets remain unverified locally because Windows Application
Control blocked the synthetic process helper and one supervisor test executable with error 4551;
no policy bypass was attempted. Fresh combined Linux and Windows CI is pending. Native smoke
acceptance gaps, WSL discovery and launch, Windows vendor-daemon breakaway, and the explicit vendor
sign-in terminal remain pending. No paid prompts, real vendor login, credentials or agent config
were accessed during this checkpoint.

## M2b native shell checkpoint

- Added Rust tray, generic background notifications with retained chat navigation, active-work quit
  confirmation, and same-thread idle-sleep assertions on Windows/macOS. Native appearance is dark
  regardless of the system theme. Windows minimize/restore and tray hide update WebView2 visibility.
- Regenerated the `shellTakeNavigation(): Promise<string | null>` binding. Frontend event/focus
  integration remains with the application integration branch; details are in `docs/native-shell.md`.
- Windows desktop all-target Clippy passed. The desktop library run passed 163 tests with one stale
  catalog assertion excluded; that assertion is already corrected by the later M1d integration.
  New checks cover concurrency, stale notifications, power release, visibility retry and guarded quit.
- Installed Windows/macOS tray, notification routing, real sleep behavior, dark material and rendering
  acceptance remain pending. Linux/WSL and CI pushes are deferred by owner direction. No credentials,
  native agent prompts, login flows or vendor process changes were used.

## Completed before this continuation

- M0 and M1a are merged. Main at `3b35c66` passes CI and installer builds on all three platforms.

## Current work: project rules and infrastructure

- Created the US-jurisdiction `auracode` D1 database and the two auracode R2 buckets.
- Added mirrored project instructions and their CI check, including mismatch/missing-file tests.
- Updated architecture documentation for Rust, Cloudflare and Orbit. No cloud application is deployed.
- Verified the new buckets have no public r2.dev access or custom domains; verified the old bucket is absent.
- Local checks passed: pnpm check (4 instruction tests, 805 frontend tests, 19 pre-existing skips),
  pnpm build, cargo fmt, 33 documentation tests, and the full locked Rust workspace test suite.
  Foundation PR #4 CI passed lint, Clippy, Linux and Windows application smoke checks.
- A separate review found no blocking code issues; corrected its two documentation inconsistencies.

## Remaining, in order

M1c is being implemented independently on `m1c-codex-native`, rebased onto M1b checkpoint `cfb67db`.
The native Codex driver uses an owned stdio app-server, initializes once, persists the native thread
ID, separates turn completion from idle, and handles approvals, grouped questions, model/effort
settings and account quota updates. Initial verification covers 31 native unit tests, seven synthetic
and three recorded native replay fixtures, and conformance to the installed Codex 0.162.1 generated schema. Existing ACP
and Claude fixtures remain unchanged. Initial work used no real prompts, credential/config inspection
or vendor update. Later prompted verification is recorded below. This is not milestone acceptance.

The driver now detects a closed asynchronous stdin writer after a send was accepted and stops the
owned process without waiting for its request timeout. Regression tests also verify outstanding
callbacks are cancelled and withdrawn before a turn completes. This incorporates the shared process
writer-closure seam from M1b commit `447fe72`.
Known process exit is distinguished from an input failure so buffered final output still drains,
including when the event receiver is backpressured. A 1,000-delta regression verifies this path.

Independent review identified four M1c defects, now fixed with targeted regression tests: raw
reasoning block boundaries, lost tool output when a final snapshot omits it, missing file-approval
diff context, and inherited automatic approval reviewers. The driver explicitly requests user review
at thread open and every turn, and fails startup if the effective reviewer remains automatic.
Review fixes have passed the native tests and all frozen replay/schema checks; a separate verification
of these fixes is still pending. Malformed completion/input metadata fails safely and quota state is
bounded across repeated updates. The final M1b startup/identity/rewind contracts are integrated;
Codex rejects unsupported startup overrides before spawning and returns an explicit error for rewind.
Post-integration native tests, all 91 replay fixtures, schema conformance, generated bindings and
targeted Clippy pass.

The native Codex free probe passed on Windows with installed 0.162.1: 20 checks passed, none failed,
and six were explicitly skipped. It verified initialization ordering, authoritative thread ID,
native model discovery, staged next-turn settings, idle interrupt, owned shutdown, interrupted
startup and restart. Three protocol logs prove no prompt or steer was sent. Resume and actual
turn-setting application remain unverified by this free probe. Full workspace Rust tests and Clippy,
rustfmt, pinned pnpm 12.15.0 checks (813 frontend tests, 19 existing skips), and both frontend builds
pass. The generated vendor schema is excluded from formatting to preserve its recorded hash.
The three free-probe recordings have curated fixture/golden pairs, with account usage and plan,
installation identity, configured MCP names and incidental stderr sanitized. All 84 fixtures replay.
Replay preserves the recorded Codex client version without weakening full payload comparison, and
recognizes explicit startup cancellation without requiring a Ready event. The running vendor version
also recognizes the installed binary's `Codex Desktop/0.162.1` user-agent spelling.
Ask uses a read-only native sandbox with untrusted-command approvals and user review, so it does
not pregrant workspace writes. Auto-edit keeps workspace write access; Full auto requests full access
with no driver auto-answering of vendor callbacks. The tightened Ask mapping passes schema and replay
tests.

The first minimal native smoke used explicit GPT-6-Luna and low effort. Basic text and native turn
usage passed. The permission scenario displayed both callbacks; denial worked, but allow-once failed
inside the native Windows execution helper before the command started. Ten checks passed and one
failed; interrupt, continuation, full auto and resume were not attempted. The smoke stopped after
three visible prompts, with no paid retries. A free direct `command/exec` running only `Get-Location`
in the same owned temp repository reproduced `helper_unknown_error: setup refresh had errors` under
the same read-only sandbox. `windowsSandbox/readiness` reported `ready`, so no setup mutation or
sandbox weakening was justified. No credential/config files were inspected or edited.

The real callback also exposed a narrower `availableDecisions` menu than the stable schema. The
driver now bounds both displayed options and outgoing answers to advertised supported choices.
Persistent policy amendments remain unsupported. Two native regressions and a synthetic replay
exercise this restriction, and the real basic turn has a curated recording and golden. Targeted
Clippy and instruction checks pass; Windows Application Control refused the new native and schema
test executables with error 4551 before any test ran. The new replay golden is a reviewed expected
result derived from its prior passing fixture and still requires CI execution. Live acceptance
remains pending the native helper issue and the remaining four smoke scenarios.

Read-only follow-up found no removed or overridden variables in either owned smoke spawn log.
The environment resolver preserves Windows runtime variables, and a direct child inheriting the
shell environment reproduced the same error. There is no evidence that auracode's scrub caused it.
The [official 0.162.1 setup helper source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning.rs)
uses this generic error after accumulated runtime or filesystem ACL failures; the exact local
failure remains unknown. The [readiness implementation](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/windows_sandbox_processor.rs)
checks setup state, not whether a fresh sandboxed command succeeds.
The official latest stable CLI release is 0.164.0 as checked on 2026-10-26, and the installed CLI
offers `codex update`, but its help exposes no check-only switch. The desktop updater reports the
installed 26.1021.31345 production release is up to date. No CLI update, setup mutation, policy
change or doctor run was performed; no claim is made that an upgrade fixes this helper failure.

The subsequently authorized targeted diagnostic read used only `.sandbox/setup_error.json` and
the 2026-10-26 daily sandbox log block for the owned free probe at 06:06:28 UTC. The fatal array
contains one error: runtime read/execute ACL validation of Codex's `cua_node/.../bin/node_repl.exe`
failed to open the ACL target for a root-only update because the file was in use, Windows error 32.
It processed zero write roots. The user-profile read-attributes warning was nonfatal. No unrelated
log history, credentials or configuration was read. No vendor process was stopped or ACL changed.
The [pinned runtime validation source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning/setup_runtime_bin.rs)
walks the app runtime tree independently of the requested command. The installed `command/exec`
schema has no runtime selector, so selecting another shell does not address that failure. An offline
driver regression preserves the failed tool and its error text even when the provider completes the
turn normally. Paid allow-once and the remaining smoke scenarios stay pending an external fix.

The later helper-failure regression initially expected plain text instead of terminal content. CI
caught the incorrect test expectation; the corrected test requires the exact native terminal error
and exit code -1. All 34 Codex unit tests pass locally after that test-only correction.

Checkpoint `e2416e7` passed [Linux and Windows CI](https://github.com/itscool2b/auracode/actions/runs/40278206764),
including the native approval regressions, all replay fixtures, generated schema checks, bindings,
frontend checks and both app smoke runs. macOS was skipped by branch policy. The subsequently added
helper-failure lifecycle regression compiles and passes Clippy; its execution is part of the next CI
checkpoint. The restricted-menu expected golden is now verified on both CI platforms.

M1c requirements still pending: opt-in prompted verification, generated
schema verification for the historical 0.164.0 baseline, independent verification of review fixes,
and final combined verification. Steer, fork, image attachments,
additional directories, rewind and secret input are explicitly unavailable until their complete
core/UI and attachment paths exist. Unsupported MCP elicitation is cancelled with a visible notice.
Native thread listing has no user-facing library seam yet. No M1c PR has been opened.

M1b is implemented and verified on `m1b-claude-native`. Native discovery, driver dispatch, transcript mapping,
permissions, multi-question UI, run-idle gating and shared native-session ownership are implemented.
Native live verification, recorded fixture curation, review fixes and local workspace gates are
complete. Final Linux/Windows CI and milestone installer builds passed. The completed PR awaits
owner review and merge authorization.
Foundation PR #4 has not been merged.

M1b acceptance checklist (unchecked items remain required):

- [x] Dedicated native envelope parser and standalone subscription redaction.
- [x] Recorded text/tool fixtures without duplicate committed output; split cache accounting.
- [x] Native catalog alongside ACP, minimum version checks and executable safety.
- [x] Separate prompt completion and native run idle; preserve ACP/mock behavior.
- [x] Native/ACP ownership aliases scoped by local host and effective configuration directory.
- [x] Multiple questions, multi-select/free text, preserved native input, generated UI bindings.
- [x] Driver control/cancellation/shutdown tests and integrated protocol replay goldens.
- [x] Coalesced usage/context refresh, advertised model metadata, structured auth-required handling.
- [x] Typed fork/resume-at startup and native rewind control with accurate capability reporting.
- [x] Startup failure matrix, oversized frames, timeout/late-response reconciliation.
- [x] Verify compatible installed native CLI with free controls before the minimal paid smoke.
- [x] Full workspace checks, frontend/build tests, CI and independent final review.

Observed checks during integration: core suite passed 327 Rust tests plus one doctest; the Questions
UI passed 286 frontend tests (19 existing skips) and typecheck. New native tests reproduced and fixed
the actual `state` field on idle frames, cancellation of a held prompt, and pause of EOF drain time
during backpressure. Native regression coverage is now 41 tests, and 74 replay fixtures pass.
The real Windows Claude 2.1.310 free probe passed 20 checks with no prompts sent; five checks were
explicitly skipped (including resume without a persisted transcript). Its first run found an unset
effort choice bug, now fixed with an explicit Default/reset choice and regression coverage.
Full workspace Clippy, frontend check (813 tests, 19 existing skips), and both frontend builds pass.
Workspace test reruns corrected stale catalog assertions; final combined verification is pending.
Independent review found fresh starts reused the chat UUID as the native session ID. Fresh starts
now allocate a UUIDv7 for each spawn. Typed native startup options validate fresh/fork IDs and
resume-at message IDs before spawning, preserve ordinary resume sources, and enable SDK file
checkpointing only when explicitly requested. Replay supplies a separate deterministic session seed.
The actor still supplies default startup options; fork/resume-at UI belongs to M2b,
and fork/rewind capabilities remain unadvertised. This startup step passed 304 driver unit tests, four
conformance tests, all 74 replay fixtures, targeted driver/core Clippy, and the mirrored instructions
check. These initial checks made no paid calls. Subsequent live acceptance is recorded below.
The completed M1b PR is opened after the final verification below.

Further review fixes and verification:

- Windows ownership keys now resolve existing directory aliases through metadata and fold path casing.
  All eight local ownership tests pass, including differently cased paths with an uncreated config root
  and equivalent UUID spellings.
- The smoke runner tracks accepted queued prompts until native idle and removes its own queued work on
  failure. Five CLI smoke integration tests and CLI Clippy pass.
- Native file rewind now has a typed driver command and result. It requires explicit startup opt-in,
  validates checkpoint IDs, waits for idle with no pending requests, and preserves link-safety skips.
  Any failed real rewind or timeout closes the process before held prompts can run, since partial file
  changes are possible. Six rewind
  regression tests pass. The future M2b checkpoint UI remains required.
- CI for checkpoint `08c19b1` passed Linux and Windows Rust checks, bindings, frontend lint, app streams
  and chat smoke tests. macOS was skipped by the branch workflow. Newer review fixes still need CI.
- One combined local workspace rerun was blocked by Windows Application Control refusing synthetic
  test executables (error 4551). No policy bypass was attempted; the checkpoint's CI suite passed.
- M1c native Codex implementation is progressing in its own `m1c-codex-native` worktree. It is not
  complete or merged into this branch.

Live Claude acceptance on Windows, with the installed native 2.1.310 CLI:

- The final free probe passed 20 checks with five explicit skips. Its three spawn logs contain no
  model prompts.
- The minimal Haiku/low smoke passed all 20 checks across six scenarios and seven visible prompts:
  streaming, deny then allow-once tool permissions, interrupted partial text, continuation after
  interruption, full auto, and resumed conversation. Each turn was stored once.
- Free `/usage` checks verified resume after changing cwd, native fork and reopening that fork,
  and resume-at into a new fork followed by reopening. These establish native identity and lifecycle,
  not a semantic memory-truncation claim. An initial resume check used a mistyped ID and failed;
  the corrected observed session ID passed.
- One Sonnet/medium thinking turn cost $0.1097759 and returned 302 thinking tokens. Claude supplied
  empty thinking text, so the initial text-byte acceptance check failed. The driver now preserves
  that activity and its duration without inventing reasoning or exposing signatures. Offline replay
  of that same recording verifies the fix; no second paid call was sent. The acceptance harness
  now checks completed thinking blocks and reports text bytes and token evidence separately.
- Seven curated recordings cover the six smoke scenarios plus withheld thinking text. Curation
  removes native identities and reconstructs split tool JSON before redacting paths. Original
  records remain in order; replacement chunk boundaries are documented as synthetic.
- Native init metadata now updates the effective model and permission mode. A resolved path-resume
  identity must acquire ownership and be durably saved before queued work can run. The new checked
  transaction acknowledgment reports real write success, including missing/rejected rows. Its gate
  survives stop/restart and waits through stalled writes rather than timing out before a late commit.
  Four core identity tests verify lock contention, rejected writes, conflicting ownership and restart.
- Eleven native failure tests cover startup failures, mandatory oversized frames, stdin failure,
  late replies and bounded shutdown. Content-only oversized frames retain the valid remainder.
  Transport failures drain valid buffered content and the final result; identity failures discard
  subsequent content from the rejected session. A known child exit cannot be misclassified as EPIPE.
- Final local checks pass: full locked Rust workspace with all features, all-target workspace Clippy,
  rustfmt, TypeScript bindings, pnpm check (813 frontend tests, 19 existing skips), both frontend builds,
  and spike documentation checks. The driver suite includes 340 unit tests, four conformance tests
  and 81 fixture replays. The six opt-in acceptance-harness unit tests also pass. The buffered-exit
  regression passed 12 repeated runs after its race fix. Linux/Windows CI and installer builds for
  the final checkpoint remain pending; macOS has not been run locally on this Windows host.

CI follow-up: Linux run `40276798121` exposed a smoke-start race. A delayed attach snapshot could
overwrite a newer live Ready header, causing the first prompt wait to time out. The CLI watcher now
keeps a live header at or beyond the attach boundary; regressions cover both delayed snapshots and
fresh snapshots replacing older events. The rebuilt Windows test executable was blocked by
Application Control (4551). No policy bypass was attempted. Final CI run `40278038126` for `374dbf5`
passed Linux and Windows Rust tests, Clippy, generated bindings, app streams and chat smoke tests,
frontend lint and PowerShell checks. Independent review of the final watcher patch found no issues.
Build run `40276797966` produced Windows and Linux installers from `cfb67db`; the subsequent watcher
patch changes only the developer CLI, not the bundled app. macOS remains untested on this Windows
host and was skipped by the milestone branch workflow. This does not claim macOS native acceptance.

1. M1b: native Claude driver, protocol replay, session readiness, permissions/questions, smoke tests.
2. M1c: native Codex app-server driver and generated-schema compatibility.
3. M1d: native Pi and remaining ACP integrations.
4. M1e: catalog, updates, WSL, Windows daemon protection.
5. M2a: Orbit design system and live transcript.
6. M2b: projects, checkpoints, handoffs, native shell integration.
7. M2c: attachments, mentions, composer, palette, settings.
8. M3: boot, onboarding, agent management.
9. M4: worktrees, parallel chats, terminals.
10. M5: installers, signed updates, releases.
11. M6: website and Rust accounts/API on Cloudflare.
12. M7: encrypted workspace sync and recovery.
13. M8: Config Library.
14. M9: three-way config sync.

## M1d Pi implementation checkpoint (2026-10-26, pending verification)

- Isolated branch `m1d-pi-agents` starts from checked backend commit `cfb67db`. The native Pi
  catalog entry and Rust driver are implemented against the installed 1.0.2 protocol and official
  pinned source. Only `pi --version` was executed; no prompts, sign-in or configuration reads.
- Added explicit prompt acceptance versus `agent_settled` handling, `clear_queue` before `abort`,
  bounded process shutdown/drain, authoritative settings refresh, usage/context reduction and
  extension select/confirm/input mapping. Unsupported editor prefills cancel visibly. Full auto
  is the only advertised autonomy; dialogs are never auto-answered. Product steer/fork/rewind
  capabilities remain false, with typed native fork startup available for later UI work.
- Added pure tests, fake-process lifecycle/failure tests, a protocol-derived replay fixture and
  native Pi correlation/redaction support. Rustfmt parsing and instruction-file synchronization
  pass. Two ordinary local Cargo attempts were blocked before driver compilation by Windows
  Application Control, error 4551 on dependency build scripts. No policy changes or alternate
  execution paths were attempted. Linux CI for `f316b59` passed all 19 Pi tests, workspace Clippy
  and binding regeneration. Full test failures identified five stale catalog assertions and the
  base branch's CLI readiness race. Follow-up CI, expanded replay evidence and authorized
  real-agent acceptance remain required.
- Remaining M1d ACP dialect integrations are separate work and are not implemented by this checkpoint.
- Follow-up review confirms Pi's model/thinking RPC setters are session-local unless the SDK caller
  explicitly requests persistence. Removed the auto-compaction toggle because its setter always
  persists user settings. The Pi free probe uses native read-only state checks and leaves settings
  unchanged. New regressions cover resource bounds, exhausted retries, dropped setting receivers
  and buffered process output under event backpressure. Final Windows and follow-up CI are pending.
- CI run `40280216757` passed every applicable gate for `fa41b80` on Linux and Windows, including
  workspace tests, Clippy, generated bindings, replay and desktop smoke tests. Lint and PowerShell
  checks also passed. The next source audit found the synthetic settlement fixture incorrectly
  included an `aborted` field: official Pi 1.0.2 emits `agent_settled` without fields. Corrected
  the adapter and fixture, deriving cancellation from owned interrupts or assistant stop reasons.
  Added manual-compaction idle handling, automatic-compaction continuation coverage and a bound
  for oversized committed block arrays. These follow-up changes require their own CI run. No
  real prompts have been sent, and M1d acceptance remains pending.
- Pi startup now retains newer lifecycle events when the initial `get_state` reply is delayed,
  preventing an old idle snapshot from releasing queued work and an old busy snapshot from leaving
  the chat stuck. Paused-clock regressions cover both orders. A dialog timeout of zero now matches
  native Pi's no-timeout semantics, with an end-to-end answer regression. These final source-audit
  fixes still need CI verification. The preceding settlement/compaction checkpoint `a87ef36` has
  passed Linux CI and Windows tests; Windows frontend smoke is still running.
- The smoke runner now explicitly skips its permission scenario when the agent cannot enforce Ask,
  before changing autonomy or sending prompts. This makes the capability limitation visible for
  Pi and the remaining Full-auto-only integrations. A scripted regression verifies zero mode
  changes and zero prompts for that skip; the existing permission tests now declare their actual
  permissions/Ask support. Verification is pending in the next combined M1d CI run.

## Decisions and constraints

Owner correction on 2026-10-26: finish the full product, prioritize a usable integrated build,
target Windows and macOS only, and defer Linux/WSL. Routine edits and checkpoint pushes must not
launch CI. The workflows now require deliberate dispatch; the planned remaining gates are at most
two major integration runs and a final full run, with focused reruns to repair failures.
AGENTS.md and CLAUDE.md record the same policy. The visual baseline must come from the original
handoff's actual references and chosen Orbit Lab, not the partially restyled M1a shell.
The original reference image/catalog bundle is not in this machine's Downloads folder. Mobbin
inspection has now confirmed Grok conversation layouts, Aside's browser frame, Harvey's product
presentation, SpaceXAI's Grok Bot page and X Money's iOS account/send screens. Exact observations
and links will guide the implementation; unrelated search results are excluded.

CI `40290191800` for `5f10309` passed all 30 native chat checks on Windows and Linux, and the
frontend/browser gates. Both reopen runs passed five checks, then the smoke reader tried to use
an unmounted older tool. The local fix walks the actual scroll surface before interacting with
that tool. A review also found focused controls could disappear when tool groups formed or
finished; local changes preserve focused rows and explicit group expansion. The latest local
frontend check and production build passed, and Chromium passed the expanded browser cases;
WebKit was interrupted when the owner paused work. These changes are not yet fully verified.

Parallel M2a work is on `m2a-orbit`. Orbit geometry, its SVG renderer and mark styles now live in
`@auracode/ui/orbit`, with the Design Lab consuming that same implementation. All 352 Design Lab
tests, UI/Lab typechecks and the Lab build pass after extraction. The live mark now shares one
animation clock, keeps bounded state history without losing orbital phase, and stops scheduling
frames when settled, hidden, offscreen or under reduced motion. Tool completion ripples finish
before idle; reduced-motion success expires with one timer. All 183 UI tests and its typecheck pass.
The desktop now consumes the shared light/dark tokens, follows system appearance and uses SVG
marks for live protocol activity, thought/tool rows, bylines and the empty state. It no longer
probes WebGL at startup; retained diagnostics and other Lab directions keep their existing shader
dependencies. Streamed prose stays stationary, completed tools collapse and failures open, and the
transcript distinguishes native work that continues after a response from an idle session.

The development-only `?preview=` harness renders both synthetic UI cases and curated real Claude
thinking/tool recordings through the real chat store. It has no native transport and is removed
from production builds. Chromium and WebKit each passed 14 state/theme accessibility scans with
zero automated WCAG A/AA violations, keyboard tool disclosure and send, reduced-motion/offscreen/
hidden-document frame checks, zero canvases, and the 960x640 minimum window. Screenshots and JSON
reports are in ignored `target/orbit-browser/`. `pnpm --filter @auracode/desktop check:orbit` runs the
suite with its own local server. This automated evidence does not replace native platform checks.
Full M2a review, long-history rendering and the remaining transcript refinements are pending.
The current frontend gate passes 827 tests with 19 existing skips and both production builds.
The preview and frame instrumentation are absent from the production output. All 11 native window
material tests, desktop all-target Clippy, rustfmt and 33 documentation checks pass after switching
Mica to system appearance; no host security settings changed. CI now runs the browser suite and
retains its screenshots and accessibility reports for seven days.

The next M2a checkpoint virtualizes stable transcript items, including tool-heavy single turns.
The scroll controller distinguishes layout corrections from reader gestures, and a keyboard-accessible
Latest control returns to the current output. Loading older pages preserves a visible text fragment,
including pages cut inside a turn or the same message. Repeated paragraphs are anchored from the end
so an identical paragraph in the newly loaded prefix cannot take over the reading position.
Unanswered forms and focused rows stay mounted; manual thought/tool disclosure choices live at chat
scope and survive row recycling. An independent review caught the draft-loss and partial-turn cases
before completion. Browser fixtures now cover 500 turns, a 1,000-tool turn, append and prepend while
reading, partial-message pages, draft retention, disclosure retention, keyboard focus and Latest.
Both Chromium and WebKit pass that expanded suite, including repeated paragraphs in one message.
The frontend gate passes 828 tests with 19 existing skips, and both production builds pass.
M2a still needs its remaining transcript refinements and final milestone review. CI run `40282377517`
passed Linux/Windows checks and the browser suite for the preceding `e1f3c67` checkpoint; macOS was
skipped. The new virtualization checkpoint needs its own CI run.

CI run `40286596525` for `95d73c8` found two regressions: the native chat smoke reader still
expected a whole turn in one mounted element, and partial-page restoration could apply the same
height correction twice. The smoke reader now walks the real scroll surface, opens tool groups,
and assembles the rendered pieces by stable identity. Fragment restoration suppresses duplicate
virtual row compensation until measurements settle, with immediate cancellation on reader input.
A separate history revision prevents live frames from prematurely finishing a pending page load.
Both Chromium and WebKit pass partial-turn and partial-message anchors, including repeated text.

The next transcript checkpoint adds copy controls with truthful success/failure feedback, long-prompt
folding, persistent grouped tool disclosures, and inline diffs with relative line numbers, change
markers, totals, folding and explicit truncation. Response and receipt copying use only reported
data; cumulative cost is labeled as session cost. Malformed full-diff payloads fall back to the
retained preview. The smoke reader itself is exercised against the browser fixture.
Local verification passes 832 frontend tests with 19 existing skips, both production builds,
and 16 accessibility scans per browser plus clipboard, folding, diff and long-history checks.
The attempted native rebuild was blocked by Windows Application Control (4551) at a Tauri build
script; no bypass was attempted. Native chat/reopen verification remains pending on this checkpoint's
CI run. Remaining M2a presentation work and final milestone review are still pending.

- M1e process supervision now has an explicit host boundary: native execution delegates unchanged,
  while WSL and unknown hosts return `HostUnavailable` before starting a process. A Windows job
  around `wsl.exe` does not establish ownership of its Linux descendants. The Linux supervisor and
  its deployment/qualification remain pending, so discovered WSL installations are not launchable
  yet. Two fake-spawner regressions cover the boundary; local execution is blocked by Application
  Control build-script checks and awaits CI. No blocked binaries or host policy were altered.
- M1e process review found shutdown could erase recovery records even when owned descendants
  remained. Unix cleanup now retains exact escaped identities after incomplete cleanup, including
  a clean application close. Failed process-table reads no longer count as an empty group. Two
  registry regressions cover retention and later successful cleanup; Linux execution awaits CI.
- Explicit supervisor launch overrides now preserve driver flags and native executable paths.
  Inspection uses the same scrub-then-override order, while the Linux login environment stays local.
  Overrides are bounded, Debug/error output omits values, and secret literals are registered before
  spawning. All-target process Clippy passes; the focused regression executable compiled but Windows
  Application Control blocked execution (4551). Linux inspection/launch consistency remains a CI
  requirement. The bridge and deployment are still gated.
- Supervisor protocol v2 now binds inspection and launch on one leased connection with a
  preparation token. Final driver overrides are accepted only when canonical cwd, provider roots
  and executable paths remain identical; stale tokens, changed realms and unreadable config roots
  fail before process spawn. Seventeen focused Windows tests and all-target Clippy pass after an
  ordinary Cargo retry. The Linux same-connection integration regression awaits CI; no WSL host
  capability is enabled by this server-only checkpoint.
- Independent preparation review added binding of the actual launch program to the inspected
  executable set. Stable and resolved paths are accepted only for that set, and adapters must
  include Node explicitly. Pure mismatch coverage passes in the 17-test supervisor suite; Linux
  integration also attempts an uninspected program and requires rejection before spawning.
- The Rust Linux supervisor endpoint now handles bounded control frames, raw agent lines, parent
  leases, EOF/signals, malformed input, queued-prompt disposal and redacted exit diagnostics through
  the existing process services. Read-only inspection supplies executable paths, canonical cwd and
  known provider configuration roots without exporting environment values. Eleven focused tests
  and all-target process Clippy pass on Windows. The earlier full process run passed 176 unit and
  nine helper tests before Application Control blocked a remaining integration executable. Linux
  ownership tests are added but await CI. WSL deployment/bridge and Windows daemon breakaway remain
  gated and pending; see [the host contract](host-supervision.md).
- Independent review tightened cleanup confirmation further: unreadable escaped identities and
  incomplete group enumeration remain unknown and retain recovery metadata. They never authorize
  a signal; only matching pid/start identities do. Injected permission/parsing failures and pid
  replacement regressions compile, and Windows all-target Clippy passes. Application Control
  blocked their test executable and the macOS cross-check build scripts; execution awaits CI.

M1e is progressing in the isolated `m1e-agent-catalog` worktree. Its first checkpoint adds typed
native/WSL host identity, bounded WSL distribution decoding, installation channel classification from
resolved paths, provider alias identity, and exact-version verification metadata. Detection and UI
integration are still pending; no host capability is advertised by these standalone types. The 31
agent tests, protocol host regression, all-target agent/protocol Clippy, and bindings export pass on
Windows. No real agent configuration or credentials were read or changed.

The next M1e checkpoint integrates the shared ACP catalog and optional native identity, preserving
Codex's authoritative ID. Successful version probes now populate installation metadata and the New
chat screen shows channel ownership and exact verification scope. Windows appends known install
directories after the resolved PATH; npm prefix input is bounded to 64 KiB. Agent detection tests
(20), agent unit tests (31), combined driver unit tests (362), environment tests (66), desktop tests
(287 with 19 existing skips), typecheck, bindings export and targeted all-target Clippy pass locally.
WSL launch/cleanup, update/auth helpers, remote version caching and milestone acceptance remain open.

Explicit `agent-auth <id>` and `agent-update <id>` commands now use the user's detected vendor binary
and reviewed channel-specific argument vectors. Claude/Codex auth responses are reduced to local
credentials-present, sign-in-required or unknown; account details are discarded. Updates reject
bundled/unknown installs and local npm dependencies, serialize provider aliases, invalidate cached
metadata and verify the resulting binary. Login command plans await the terminal sheet. Two fake
maintenance integration tests, nine CLI parser tests and all-target agent/CLI Clippy pass locally.
Windows Application Control blocked the newly linked agent unit-test executable (4551); those new
pure cases require CI. No real auth, login, update or paid prompt was run for this checkpoint.
The auth contracts are from [Claude's CLI reference](https://code.claude.com/docs/en/cli-reference),
installed CLI help, and [Codex 0.162.1 login source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/cli/src/login.rs).
Corrected M1c head `887ad12` passed full [Linux/Windows CI](https://github.com/itscool2b/auracode/actions/runs/40281970244).

M1e now checks reviewed public npm, GitHub and Homebrew release endpoints in the background on real
desktop startup, refreshing successful checks after six hours. Bounded HTTPS responses, ETags and
auracode's own disk cache retain a clearly stale version when offline. Bundled installs continue to
defer updates to their owning application; release metadata never controls readiness or runs an
installer. The protocol and generated bindings expose latest-release metadata for the catalog UI.
The 37 agent unit tests, two maintenance integration tests, release cache cases, binding export,
desktop typecheck and 287 desktop tests pass locally. The update test also verifies that completed
alias probes cannot survive a vendor update. Remote catalog CI still needs the inherited M1d catalog
assertion and spike-documentation fixes; WSL supervision, host persistence and milestone acceptance
remain pending. No real authentication flow, update or paid prompt was run.

Host persistence now uses schema migration 0003, with the existing pre-migration backup and rollback
path. Earlier chats and agent sessions remain native. A typed host is saved independently of the
provider and transport; unknown host data is unavailable rather than silently native. The legacy
`create_chat` API remains native, and `create_chat_on_host` plus generated `chatCreateOnHost` and
`ChatSummary.agent_host` form the explicit UI seam for M2b. Restored WSL/unknown chats fail before
native detection or spawning while the qualified Linux bridge is unavailable. Resuming a saved ID
from another host is refused; starting fresh is explicit. Native launches now pass through
`HostSpawner`. The 258 core unit tests and 27 lifecycle tests passed before the final two targeted
host regressions, which also pass, as do bindings export, targeted all-target Clippy, desktop
typecheck and 287 desktop tests. Linux cwd translation and canonical configuration realms await the
supervisor inspection contract; no WSL launch capability is claimed yet.

The catalog now exposes reviewed maintenance capabilities, coarse vendor sign-in checks and explicit
channel-owned updates through typed desktop IPC and the selected installation's controls. Selecting
an agent only checks which actions are available; auth checks and updates require their own user
action. Bundled/unsupported updates show their reason. Delayed responses cannot replace another
agent's status, and release metadata continues to refresh in an already-open window. The provider
update lock now includes verification and atomic cache publication, preventing a second updater from
replacing the binary during the first verification. Four fake maintenance integration tests, bindings
export, targeted all-target Clippy, desktop typecheck and 289 desktop tests pass. No real updater or
authentication command ran. Interactive vendor login remains pending a qualified terminal sheet.

Public release metadata now includes the [official ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)
for Antigravity ACP, Cursor, Grok and distinct OpenCode V1/V2 entries. Only reviewed IDs and version
fields are consumed; distribution commands and download URLs are not executed. Cache keys retain
the selector so two agents in one registry document cannot overwrite each other's versions.
Reviewed npm package owners now cover Pi, OMP and Grok, while local dependencies and Bun global
layouts are still refused by the npm updater. The package names are supported by the registry,
[OMP's pinned package manifest](https://github.com/can1357/oh-my-pi/blob/v18.12.6/packages/coding-agent/package.json)
and [Pi's pinned CLI documentation](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md).
The 39 agent unit tests and all-target agent Clippy pass. No package or agent was installed or updated.

- M1d ACP subtask: deferred Cursor questions/plan approval and OMP form elicitation are implemented
  with fake-pipe and pure conversion regressions. OMP advertises form support to prevent its
  no-form plan auto-approval path and exposes only its enforceable Full auto autonomy. See
  [the contract baseline](spikes/m1d-acp.md). A normal Cargo retry now runs after an initial
  Application Control build-script rejection. The 354 driver unit tests and six identity tests
  pass; no real-agent runs were performed.
- Driver readiness now permits an absent native ID until a vendor creates a transcript on the
  first visible prompt. Core stores no fabricated resume target and claims the confirmed ID only
  when reported, holding queued work until its checked database write succeeds. Existing drivers
  retain their known IDs. Regressions cover two initially anonymous sessions, failed first prompts,
  restart without a resume target and the durable save barrier for an initially absent ID.
- M1d catalog adds Antigravity, Cursor, Grok, oh-my-pi and separate OpenCode major lines, plus
  restricted agy/Grok text fallbacks. Version-qualified discovery never probes generic `agent`.
  ACP/fallback ownership aliases are shared. Agent tests (24 unit, 20 discovery, six installation)
  and 357 driver unit tests, four schema checks and three fixture replay integration tests pass.
  Install/authentication and real vendor acceptance remain pending; no paid prompts were run.
- ACP refinements preserve OMP choice labels/descriptions separately from native values, show
  Cursor's separate tasks/phases before plan approval, merge bounded Cursor todo notifications
  and retain task/image context through ordinary tool events. Grok's prompt-wide usage ledger
  uses disjoint cache buckets and turn scope. The current plan table now matches the documented
  agy stdin protocol and leaves Cursor restart-based model switching unqualified.
  The complete core suite passed after optional readiness; final branch CI remains pending.
  The last executed driver run passed 362 tests. Application Control subsequently blocked the
  newly linked test executables; the two newest callback regressions and doc-check compile but
  await branch CI execution. No binaries or security policy were changed to bypass the block.
- The first ACP branch CI exposed omitted qualified-binary match arms in CLI probes and repository
  inspection, plus the new spike report's required status/table format. Those integration fixes
  are applied; catalog assertions now derive expected IDs from the shared catalog so combined Pi
  integration does not retain a stale agent list. CLI all-target Clippy and its unknown-agent
  regression pass. Desktop test compilation remains blocked by Application Control build scripts;
  final combined CI remains pending.

## Decisions and constraints

M1d integration checkpoint: Pi and the deferred ACP callbacks, qualified catalog recipes and
restricted text fallbacks now coexist on `m1d-pi-agents`. Pi `5146ee5` passed complete Linux and
Windows CI in run `40282637352`. Catalog merge resolution preserves all 14 entries and updates
cross-package catalog assertions through the shared catalog. The free probe explicitly limits
text fallbacks to executable detection and starts no chat or prompt, with a real fake-process
version-check regression. The permission smoke scenario explicitly skips unsupported Ask modes.
Combined verification and real-agent acceptance are still pending; no new paid calls were made.
Grok text smoke expects native per-turn usage; the text fallbacks' logs are listed without claiming
the ACP replay path supports them. Text fallback replay remains an explicit acceptance limitation.
Agy text usage now keeps a baseline per owned process: the first sample retains session scope,
subsequent totals become turn differences, and a restarted process begins a new baseline. A fake
process regression covers two cumulative results and a resumed process. Combined CI found a
missing field in the new no-prompt probe test constructor; that compile defect is corrected.
The usage regression and corrected combined checkpoint still await CI execution.
Pi's synthetic replay evidence now includes thinking with a tool round trip and an interrupted
extension confirmation. The semantic checks require deduplicated text and reasoning, one native
tool lifecycle with final output, turn token totals and dialog withdrawal before the cancelled
turn. These fixtures derive from the pinned public wire types; they are not real-agent recordings.
Combined Windows CI `40285702748` passed Clippy, all new Pi/Headless/CLI behavior regressions,
bindings and desktop smokes. Its full test step exposed two stale catalog assumptions: the CLI
missing-agent count and Grok's single-probe count despite ACP/fallback aliases. Those assertions
now derive the catalog size and verify every observed invocation is a version check. Final combined
CI, the expanded replay fixtures and real-agent qualification remain pending.
Combined checkpoint `d7055a6` passed the complete Linux CI job and all 398 driver tests on both
platforms, including the expanded Pi replay fixtures. Windows exposed one scheduling race in a
CLI smoke assertion: force stop reaches `Stopped` before the retired driver's join releases its
live slot. The smoke regression now waits within its existing stop deadline for that release,
before any shutdown fallback, and still verifies that the removed prompt never runs. The corrected
Windows gate remains pending; native-agent acceptance and macOS verification remain outstanding.
A subsequent Pi dialog review found that core's fixed display limits could shorten native
confirmation text or select labels before an answer. Pi now cancels unsupported oversized dialogs
with a notice, as ACP callbacks already do. Pure regressions cover escaped text, Unicode character
limits and aggregate size; a fake-wire regression requires cancellation without a partial question
and verifies the next supported dialog remains answerable. Execution awaits branch CI because
ordinary local Cargo is still blocked by Application Control.
Combined CI `40288849525` passed all 401 driver tests on Linux, including Pi's dialog fidelity
regressions. The Linux test step found an existing notification-test subscription race: its
script emitted before the recording sink attached, so the event could already belong to initial
history. The test now injects its notification after attachment, preserving its actual notification
and autonomy assertions. Final combined CI and real-agent qualification remain pending.

- M1d ACP subtask: deferred Cursor questions/plan approval and OMP form elicitation are implemented
  with fake-pipe and pure conversion regressions. OMP advertises form support to prevent its
  no-form plan auto-approval path and exposes only its enforceable Full auto autonomy. See
  [the contract baseline](spikes/m1d-acp.md). Local Rust validation is pending because Windows
  Application Control blocked clean dependency build scripts; no real-agent runs were performed.

- Rust owns backend logic. TypeScript remains for React and necessary platform/build glue.
- D1 and Cloudflare Email Service replace Neon/Postgres, Neon Auth, Hyperdrive, and Resend.
- Reuse the existing targeted environment scrub, not the handoff's older blanket prefix scrub.
- Native Claude must distinguish a completed turn from an idle run before dispatching queued work.
- Native and ACP aliases must share native-session ownership checks.
- Updated the local signed native Claude executable from 2.1.296 to 2.1.310 using its official
  `claude update` command. No credential/config files were inspected or edited. Version checks remain
  at the recorded baseline. Free probes and fixture coverage precede any paid verification.
- One finished PR per milestone, no automatic merges. This foundation branch precedes M1b.
- Added LF text checkout attributes after Windows CRLF conversion caused baseline formatter failures.
  Normalization changes no existing tracked source content; binary files remain binary.

## M1e terminal foundation

The native process layer now exposes a raw binary transport using the existing environment scrub,
registry, direct-child exit observation and owned-tree shutdown. Its bounded stdin queue preserves
whole packets when an async enqueue is cancelled; close interrupts blocked output and discards
queued transport bytes. Terminal payloads never enter protocol logs or the retained stderr tail.
Windows validation passed 183 process unit tests, three raw transport regressions, 31 existing
spawn/helper/shutdown tests and all-target Clippy. The tests verify binary fidelity, concurrent pipe
draining, owned descendants ending on last-control drop and an unrelated sibling remaining alive.
The PTY platform layer, explicit sign-in sheet, Unix execution evidence and vendor acceptance remain
pending. No vendor login or model prompt was run.

The PTY layer now uses Windows ConPTY with suspended native process creation, Job assignment before
resume and kill-on-close containment. Explicit standard-handle initialization prevents redirected
parent output from escaping the terminal. The macOS path opens a controlling PTY in an owned session,
with close-on-exec descriptors and asynchronous nonblocking IO. Output is bounded to 256 KiB, never
logged, and drained independently of the viewer with a post-exit deadline. The implementation uses
native bindings instead of portable-pty because its Windows launcher resumes before a Job could be
assigned, leaving a descendant ownership race. No breakaway flags or shell command interpolation are
used. Four harmless Windows PTY tests pass for terminal IO, quoting, Unicode, resize, descendant
cleanup, unrelated-process preservation and stalled output. Three raw transport regressions and
all-target process Clippy also pass. macOS execution and the sign-in sheet remain pending.

Explicit sign-in now has a reusable dark Orbit terminal sheet and typed IPC. A reserved, window-owned
ID exists before the vendor command starts, so Close can cancel a delayed launch. The Rust service
allows one terminal per window and four total, rejects cross-window IDs and concurrent reads, and
closes pending/running terminals on page reload or exit. It launches only the detected installation's
reviewed Claude/Codex login argv after executable identity validation. No arbitrary command or vendor
credential/config file is accepted. Output stays ephemeral; xterm logging and OSC clipboard writes
are disabled. Rendering completion gates the next bounded read, input is ordered and bounded, and
resize requests coalesce. The explicit Start button avoids mount-triggered sign-in and StrictMode
duplication. A completed command does not assert that authentication succeeded.

Local Windows checks pass: four core ownership/cancellation tests plus the harmless PTY child helper,
five frontend flow-control/presentation tests, generated bindings, TypeScript, Biome, and core/desktop
all-target Clippy. An actual owned test process exercises terminal input and cancellation without any
vendor login. The existing frontend suite also passed 293 tests with 19 existing skips while checking
the new dependencies. Root UI integration, interactive browser review and macOS execution remain
pending. No real login, paid prompt, CI dispatch or push was performed for these changes. Native
transport and xterm reference sources: Microsoft ConPTY session creation documentation and the
official xterm.js flow-control/security guides. M4 can reuse the same Rust ownership and streaming
seam; arbitrary shell launch and a general terminal panel are not exposed by this checkpoint.

## Composer context checkpoint

Typed prompt parts now persist through the queue and begun turns. Explicit file picker, drag/drop,
and pasted-image UI feed a Rust import service with bounded image decoding, metadata-free PNG
normalization, bounded UTF-8 text, private content-addressed storage and chat-scoped attachment IDs.
File discovery reads names only, excludes private credential paths and dependencies, and validates
mentions inside the active project folder. Transcript text includes the text-file context sent to
the agent. Images and mentions now map to native Claude, Codex, Pi and capability-checked ACP input.
The dark composer exposes removable context chips and keyboard file selection, retains input after
send failure, and avoids clearing text typed while a send was pending.

The core and driver crates pass all-target compilation and Clippy. Import/path/integrity and wire
regressions are written for the integration test batch. Generated desktop bindings, native picker,
paste/drop, queue restart and browser acceptance remain pending. Windows Application Control still
blocks this root checkout's Tauri macro DLL, so binding generation belongs to the planned remote
Windows/macOS integration checkpoint. No policy changes, paid-agent calls, CI dispatch or push were
made. Durable unsent drafts and the remaining M2c controls are still being implemented.

Wire references: [ACP content](https://agentclientprotocol.com/protocol/v1/content),
[Pi RPC commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md),
and the checked-in Codex 0.162.1 app-server schema. Image decoding uses the bounded
[image crate API](https://docs.rs/image/0.25.10/image/).

The local draft backend now stores text, selected attachment IDs and mentions in migration0005,
using the existing backed-up migration path and bounded writer. Restore resolves attachment metadata
within the chat. Core compilation passes after checkpoint integration; a profile-reopen regression
is staged for the integration test batch. UI draft lifetime/write ordering is being wired separately.

Draft UI now reuses the same editor state across chat views and serializes persistence so a slow save
cannot overwrite newer input. Successful sends consume only their own text/context and preserve
edits made while sending. Load/save failures keep the draft in place with retry. Native quit now
requests an acknowledged draft flush before stopping agents or closing SQLite, and offers to keep
the app open if that flush fails. Required Tauri event permissions also enable existing notification
navigation and native file-drop listeners. Ordering/failure/quit regressions are staged for the final
integration batch; Biome and rustfmt pass. Native compilation/binding generation remain pending the
planned platform check. This checkpoint does not mark M2c or the product complete.

## Checkpoint Changes interface

The dark Changes panel now connects the Rust checkpoint service to current-file comparisons,
per-file diffs, checkpoint selection, explicit multi-file revert previews and partial-failure recovery
paths. Active sessions must stop before a revert. The panel resizes with a pointer or keyboard,
closes with Escape without interrupting an agent, and restores focus. Snapshot failures disable
revert until a successful refresh. The autonomy disclosure now describes the implemented checkpoint
behavior. Preview fixtures exercise attachment/mention controls and selected-file revert without
accessing any real project files.

A focused Chromium accessibility scan of the panel passed with no violations, and keyboard focus
restoration passed. Biome and rustfmt pass apart from existing CSS ordering warnings. The combined
browser regression is prepared for the integration batch. Native command bindings, real checkpoint
UI acceptance on Windows/macOS, and broader milestone checks remain pending. No remote CI or push.

## Local search and command palette

Rust now exposes bounded project/chat metadata search and literal-prefix FTS over completed messages,
with accent folding, archived opt-in, deleted-row filtering and plain-text snippets. Reads use the
profile writer and its saved-data path when saving is paused. The dark command palette opens from
Search or Cmd/Ctrl+K, supports keyboard selection and scope filters, and adds project-file mentions
to the existing draft. Available workspace commands use the same real actions as the main UI.

Core all-target compilation passes after reconciling the combined Cargo lockfile. The search regression
and integrated browser checks are queued for the verification batch. A focused Chromium interaction
found no browser errors; its one near-threshold contrast finding was corrected. Production bindings
and full platform acceptance remain pending. No CI dispatch or push.

## Conversation continuation backend checkpoint

Migration 0006 saves explicit continuation state, links forks to their source, and persists actual
native capabilities. The bounded preview lists the exact handoff and retained prompt before apply;
it never sends a model prompt. Retry/edit retain the original transcript. Switch-back resumes the
selected agent's saved session when its recorded capability, host and cwd permit it, with only the
missing turns in the visible handoff. Latest-turn Claude and Pi forks use the supported native fork
startup and a distinct session ID. Other forks use a new chat and visible context. Earlier-turn native
truncate/fork mappings and native Codex fork remain unavailable until qualified end to end.

Confirmed handoffs survive actor reconstruction and are consumed atomically with the begun turn.
Image references copy only source-chat metadata selected from a saved turn; a missing image aborts
the transaction. Preview tokens expire, are single use, and reject intervening conversation changes.
Continuations require stopped agents and no queued prompts. Ambiguous legacy attachment-only prompts
cannot be edited safely and show a reason; unchanged retry remains available. File context includes a
bounded real Git diff stat computed from the private checkpoint trees, without accessing the user's
index. Checkpoint exclusions now also reject known credential and private-key paths before reads.

All 294 core unit tests pass locally on Windows, including continuation recovery, exact context,
attachment rollback, native fork identity, checkpoint/index protection and migration salvage. Core
and CLI all-target Clippy and the desktop binding export pass. No real-agent prompt, vendor login,
push or CI dispatch ran. UI integration, macOS execution, project default-model application, portable
Git folder identity, missing-native-transcript fallback and M4 Git lifecycle remain pending.

## Visible history continuations

Message Edit, Retry and Fork actions and the paged conversation history now use content-bound Rust
previews. The dialog shows exact handoff/prompt text and native resume/fork behavior, requires a
stopped session and no queued prompts, and refreshes its preview after stopping changes the history.
Confirmed mutations cannot be retried merely because a later UI refresh failed. The agent picker
now lists real detected agents beside separate model and effort controls; changing agents opens the
same review flow. No hidden model call summarizes the conversation.

A pending handoff has a read-only Rust API and remains visibly inspectable above the composer after
reopening a chat. Sending waits until its saved handoff can be read; a failure has an explicit retry.
Core all-target compilation passes. A focused Chromium flow passed fork preview/confirmation, the
persistent visible handoff and selected-file revert, with zero browser errors and zero accessibility
violations in the continuation dialog. The complete browser/native verification and new bindings
remain pending. No remote CI, push or paid-agent call.

Cloudflare Email Sending now owns the auracode.si sender domain and reports its automatically
provisioned SPF, DKIM, DMARC and return-path DNS as ready. No email was sent; delivery and Workers
plan eligibility still need qualification. Continuation preview refreshes now discard superseded
async responses when the dialog changes intent or closes. The synthetic preview session status is
explicitly typed for transitions after stopping. Both changes join the combined verification batch.
### M3 setup persistence foundation, 2026-10-26

- Added a profile-owned Rust setup store for step, motion, first project and completion. Atomic
  writes precede acknowledgments; revisions reject stale views, and failed writes keep memory
  unchanged. Damaged preferences are preserved; future-version preferences are not overwritten.
- Desktop commands lazily load the store only while this process owns the profile. No agent
  commands, account requests or credential reads are part of this path. Bindings are generated.
- Four focused persistence tests and desktop binding export pass on Windows. Core and desktop
  library Clippy pass. M3 interface and native platform acceptance remain in progress.

### M3 dark setup and Agents interface, 2026-10-26

- Connected the real desktop to the Rust setup store, a skippable cold/warm intro, keyboard-driven
  mission checklist, passive native detection, motion preferences, existing project/folder commands,
  and an Agents screen with the existing explicit update/sign-in terminal controls. Notification
  navigation and smoke/stress launches bypass setup. Missing agents link to checked official guides.
- Shared the actual Orbit globe between product and design reference; removed the lab onboarding's
  appearance selector and simulated account-success claim. Inspected the original Grok Console flow
  and rendered Chromium/WebKit screenshots. Narrow panes omit clipped globe labels.
- Chromium and WebKit checks pass for progression, stored motion/step, skip/restart, intro bypass and
  warm start, passive detection, no-agent demo, accessibility, and a failed setup write after project
  creation without duplicate creation on retry. Workspace typechecks, desktop build, shared UI 184
  tests, and Orbit 52 tests pass. Native core setup tests and desktop binding export passed earlier.
- Broader desktop Vitest reports five pre-existing old-base failures: TerminalSheet's SSR document
  assumption and four stale screen assertions. These untouched root-owned tests remain pending.
  M3 remains pending reviewed new-agent installation, native window/drop/terminal acceptance, final
  globe-to-dock polish and enabled account/clone flows. Details and sources: docs/onboarding.md.
## M7 client foundation

The isolated `aura-sync` crate now implements versioned XChaCha20-Poly1305 record/blob encryption,
X25519 + HKDF-SHA256 device key wrapping, independent recovery encryption/authentication derivation,
and a public-key-bound approval code. The exact byte conventions are in `docs/sync-crypto-v1.md`.
Record AAD includes routing identity, merge clock and deletion state; key envelopes bind account,
device, version and both public keys. Secrets use zeroizing containers and redacted Debug output.
Six focused local tests and all-target Clippy pass, including a synthetic deterministic wire vector,
cross-account/device/record substitution, malformed lengths, non-contributory keys and tampering.
This is the crypto foundation only. API transport, secure local key persistence, account profiles,
SQLCipher migration, sync scheduling/merging, approved config adapters, device UI and cross-platform
acceptance remain pending. No cloud mutation, account login, credential inspection or real config
read/write was performed.
# M7 desktop account transport foundation (2026-10-26)

- Added the Rust `/api/v1` client against cloud contract `7a95e6b`, with HTTPS origins, no redirects
  or hidden retries, sensitive bearer headers, bounded response bodies, static error messages,
  cooldowns, and strict sync cursor/device-clock checks. Server-provided private error text is never
  surfaced. Auth expiry is a distinct result so the sync coordinator can halt without deleting data.
- Eleven focused crypto and local fake-HTTP tests pass, including authoritative stale-write heads,
  global sequence gaps, duplicate writes, malformed tombstones, redirects and token expiry.
- Secure storage, durable sync state, encrypted account profiles, account UI and config adapters are
  still pending. No real auth, credential access, cloud mutation, deployment or paid call was run.

# M7 local secure-store foundation (2026-10-26)

- Added app-only native secret storage for Windows Credential Manager and macOS login Keychain,
  scoped by HTTPS service origin and account. Windows persistence is explicitly local. There is no
  credential enumeration, automatic plaintext fallback, or raw provider error output.
- Added an explicit passphrase store using Argon2id and XChaCha20-Poly1305, bounded files, exclusive
  locking, atomic replacement, and account-bound authenticated context. Wrong passphrases and damaged
  files preserve the existing ciphertext. Session and local key bundles can be replaced atomically.
- Fourteen focused crypto, local HTTP and vault tests pass; all-target Clippy passes. Native calls are
  tested through an in-memory provider and the fallback uses temporary files. No real keychain entry
  was read or changed. Native macOS execution, account state/IPC, SQLCipher profile integration and
  durable sync/config adapters remain pending.

# M7 account state and device trust foundation (2026-10-26)

- Added the Rust account owner with persisted private-key/session bundles, session verification,
  retained-device proof, explicit registration/recovery/approval, and a Ready-only sync gate. Expiry,
  revocation and sign-out halt live sync while retaining local keys. Cancelled queued vault writes
  cannot overwrite newer session removal, and replacement owners invalidate older network access.
- Found and fixed an active-service key-substitution gap: the recipient code alone cannot authenticate
  the origin of a sealed account key. New remote approvals require explicit full-fingerprint
  comparison with the trusted device. Initialization/recovery and later reconnects pin known keys.
- Twenty-five focused tests now cover crypto/server vectors, local HTTP, vaults, key substitution,
  lost registration replies, recovery, first-device setup, stale owners, sign-out storage failure,
  cancellation, expiry and revocation. All-target Clippy passes. One fake-server test bug on Windows
  was corrected by resetting accepted sockets to blocking mode; production HTTP code was unaffected.
- `docs/desktop-account-client.md` defines the root UI/actor seam and remaining integration gates.
  SQLCipher profiles, account IPC/UI, durable sync/merge/config adapters and macOS execution remain
  pending. No real sign-in, credential access, cloud mutation, deployment or paid prompt was run.

# M7 deterministic sync merge foundation (2026-10-26)

- Added fixed-width HLC parsing, monotonic local/received clocks, restart restoration, bounded future
  skew and overflow handling. API and encryption context validation share the same parser.
- Added per-field metadata LWW with independent object tombstones and explicit restoration. Identical
  clocks containing different edits fail visibly instead of discarding either value. Future schemas
  are reported as opaque records to retain, and payload clocks cannot outrun the encrypted envelope.
- Added the pure config Base/Local/Remote decision table, explicit tombstones, first-link union-only
  previews, and unavailable/skipped observations that never become uninstall requests. Text merging,
  append-only chat chunk union, actual adapters, previews/applies and rollback remain pending.
- Thirty-four focused aura-sync tests and all-target Clippy pass. Durable outbox/cursor transactions,
  SQLCipher account profiles and desktop integration are the next required work; no real config,
  credential store, cloud state or existing database was read or modified.

# M7 SQLCipher storage primitive (2026-10-26)

- Added an optional SQLCipher feature with a profile-specific derived key, byte-only key installation,
  disabled cipher logging, memory protection and schema validation. Wrong keys report a static error
  without repairing, replacing or converting the original database. The shared default rusqlite
  declaration remains unchanged, and unkeyed Local databases remain ordinary SQLite.
- All 37 focused aura-sync tests pass on Windows, including encrypted reopen, wrong-key preservation,
  plaintext preservation and keyed online backups retaining data and schema version. Feature-enabled
  all-target Clippy passes. Windows compilation used checksum-verified official portable Perl inside
  the ignored build directory for vendored OpenSSL, with no global installation or policy bypass.
- Core profile opening, backup/recovery key propagation, durable sync transactions and macOS runtime
  qualification remain pending. No existing profile or database was opened or changed by these tests.

# M7 encrypted profile opening (2026-10-26)

- Added the explicit `aura-core/account-sync` keyed Store open, retaining the profile key for integrity
  reads and encrypted pre-migration backups. Unkeyed Account opens fail before file access, while
  Local profiles keep their existing plaintext behavior. A bounded durable encryption marker also
  protects explicit path opens and builds without SQLCipher from plaintext corruption recovery.
- Wrong keys, damaged encrypted headers, unknown marker formats, missing initialized databases and
  newer schemas leave the original data untouched. Failed migrations roll back after an encrypted
  backup. Encrypted damage reports a recovery-required error; plaintext salvage is never attempted.
- Six focused Windows encrypted-store tests pass, including interrupted initial creation, WAL/data
  confidentiality, backup contents/version, wrong-key preservation and failed upgrade rollback.
  All 162 selected storage/chatstore regression tests pass with SQLCipher enabled. Feature-enabled
  and default all-target Clippy pass. No lint allowances were added to production code.
  Account session activation, attachment/checkpoint storage, backup restore UI, durable sync state and
  macOS runtime qualification remain pending. No existing profile was opened or modified.

## M4 worktree creation foundation

A separate Rust GitWorkspaces service now inspects repository state and prepares single-use isolation
previews. Apply verifies the source HEAD/index and repository identity again, journals Creating before
spawning Git, and creates a locked worktree on a new collision-safe aura branch outside the source.
Failures retain a RecoveryRequired record and the possibly created branch/path. The service does not
remove uncertain work or silently roll back. Non-repositories, detached HEAD, unborn branches, active
merge/rebase/cherry-pick/bisect and index locks return concrete reasons. Bounded NUL-delimited Git
status parsing preserves paths with spaces and rename sources. Read helpers disable optional index
locks and inherited Git redirects; explicit worktree operations disable hooks.

Six focused Windows tests and all-target core Clippy pass, using only owned temporary repositories.
The real Git creation test preserves staged index bytes, HEAD, unstaged CRLF bytes and untracked files.
The Git-for-Windows extended-path argument incompatibility was reproduced and fixed with regular
drive/UNC argument spelling while canonical identity checks remain in place. Bindings are generated
from the new DTOs. This service is not yet exposed to chat UI: relocation/native handoff, bringing
uncommitted changes, setup copies/commands, merge/PR/discard/recovery and macOS execution remain pending.
No agent prompt, login, real-repository mutation, push or CI dispatch ran. Protocol references are the
official [Git worktree](https://git-scm.com/docs/git-worktree) and
[Git status porcelain v2](https://git-scm.com/docs/git-status) documentation.

## Picker and integrated UI verification

The model/effort picker now uses the chosen Grok row treatment, native agent-supplied descriptions,
selection marks, effort ticks, and three keyboard-navigable columns. Cmd/Ctrl+. opens it, arrow keys
move between rows and columns, and numeric shortcuts choose available effort levels. Choice changes
retain the existing acknowledged/pending protocol. The synthetic fixture now exercises real option
transitions. Mobbin screens 5df7b658-498f-4145-b78d-0fe9d6460441 and
3025b711-877d-4927-8e9b-21076781be06 were inspected; light reference material does not introduce a
product theme. Dark remains the only product mode.

The combined desktop Vitest batch passed 304 tests and exposed five old-layout/server-render
failures. Those were fixed, and affected files pass their focused reruns. Chromium exercised picker
keyboard changes and found a visible-label mismatch; spacing and accessible names now agree, and
its focused accessibility rerun reports zero violations. The full browser run reached the picker
before that correction; remaining combined checks continue in the planned integration run. Core
all-target compilation passes with integrated onboarding, encrypted-profile seams and M4 service.
Windows/macOS generated bindings and native checks remain pending. No paid-agent prompt ran.

### Deliberate binding bootstrap and native CI coverage, 2026-10-26

- Added an explicit, default-off `refresh_bindings` workflow input. macOS generates exact bindings
  before frontend checks; Windows exports independently and a parity job compares the bytes.
  Normal and final runs still enforce committed binding drift. No binding types are handwritten.
- Enabled the existing mock-agent native stream/chat/reopen smoke on macOS as well as Windows,
  retained native smoke evidence, and enabled safe Claude spike unit tests on both current targets.
  Setup browser fixtures now run beside the Orbit fixtures. No workflow was dispatched.
- Seven isolated exporter-script cases, the actual Windows exporter in normal mode, Bash syntax,
  workflow pin/runner checks and instruction parity pass locally. Hosted macOS/Windows workflow
  execution and ShellCheck remain for the planned integration run. See docs/verification.md.

## Read-only context panel and first hosted integration

The resizable right panel now has Changes, Files, Plan and Session tabs and Cmd/Ctrl+J. Files shows
bounded project search and paths from loaded tool history, opens a read-only preview, and can add a
file mention to the durable composer without sending it. Rust refuses credential/Git-internal paths,
traversal, links at every relative component and special files. Reads are capped at 128 KiB with
nonblocking open; the UI displays at most 2,000 lines. Binary/encoding and missing-file outcomes are
explicit. The preview does not persist content. Plan and Session show agent-reported data and label
unreported usage instead of inventing values.

The focused file-boundary/text/binary regression passes on Windows. All three context tabs and the
file-to-draft interaction pass focused Chromium accessibility checks with zero violations. Dark
Files and Session screenshots were inspected. Bindings for the new file-preview command remain
pending generation. The combined browser script now includes these paths.

The first planned hosted Windows/macOS run is 40311937683 at 28554a1. A cache input expression was
rejected before jobs started and corrected. macOS then found a controlling-terminal ioctl argument
type mismatch, fixed locally in b05d45e with Apple's required unsigned-long conversion. That failure
blocked bootstrap binding generation and downstream frontend gates. Windows passed Clippy and is
still running tests. There has been one started integration run; fixes are being batched.
# M7 durable sync ledger (2026-10-26)

- Added migration0007 after the integrated continuation schema6. The encrypted account ledger pins
  its account/device/key identity and saves the HLC, outgoing records and application projection in
  one transaction. Pull pages authenticate before their projections and cursor commit together;
  failed pages, callback failures and invalid future clocks preserve prior durable state.
- Authoritative push heads merge against the latest local edit, so a delayed acknowledgement cannot
  erase newer offline changes. Per-field merges queue a new combined head. Unsupported authenticated
  revisions are retained before cursor advancement and prevent an older client overwriting that item.
- Seven focused ledger tests pass on Windows for rollback, restart, clock validation, in-flight edits,
  concurrent fields, identity substitution, explicit tombstones and future-schema retention.
  Encrypted v6 migration coverage and Clippy are checked with the commit. Project/chat writer
  integration, scheduling, chat/config codecs, encrypted external files, account UI and macOS
  qualification remain pending; this does not mark M7 complete.

Account databases now use `aura.encrypted.db` so a pre-M7 binary's old `aura.db` corruption recovery
cannot quarantine ciphertext. Local paths are unchanged. Legacy or multiple candidate account files
cause an explicit import/restore error before any account database is opened. Focused Windows tests
preserve both paths byte-for-byte in this case; no existing user profile was read or migrated.

## Windows npm maintenance path identity

The first integrated hosted Windows run exposed a mismatch between a PATH shim's lexical parent
and the package entry's canonical directory. Maintenance now canonicalizes the launch parent before
comparing the global npm prefix, covering Windows short directory names and other path aliases.
The deterministic temporary-directory regression also confirms that a project-local node_modules/.bin
still cannot become a global npm update. This changes path metadata checks only; no actual npm update,
agent prompt, credential access or CI dispatch is part of the fix.

## M4 guarded merge and retirement checkpoint

The worktree service now prepares merges with Git merge-tree and reports conflict paths without
changing either working tree. Apply requires clean source and target state and retains both previous
and prepared commits under recovery refs before changing files. A HEAD lock protects the two-tree
checkout; the branch update compares its expected old commit. A failed checkout or ref update keeps
the prepared commit and an explicit RecoveryRequired journal entry instead of resetting user work.
Git helpers request fsync for durable objects and refs. Discard moves only a validated app-owned,
non-link worktree into the profile's retained directory through Git worktree move. All ignored and
uncommitted bytes, and the branch, remain recoverable; it never recursively deletes the folder.

SessionManager wrappers reserve canonical source/worktree folders and affected chat actors. Live,
starting, retiring, paused-saving and held-queue states refuse mutation. An owned task retains those
reservations after an IPC caller disconnects and releases them only after the operation has finished
journaling. Production receives the optional GitWorkspaces dependency; isolated protocol fixtures
leave it disabled. The native updater's idle admission must also count these folder reservations.

All 305 core unit tests pass on Windows. The nine owned-repository tests also passed after recovery
ref durability was added, and two actor tests cover held queues, live agents and release of the start
guard. Core/CLI all-target Clippy passes. Generated desktop bindings cover action/result DTOs. Root UI
integration and independent merge-race review remain pending, as do relocation, native cwd handoff,
bringing uncommitted files, explicit setup, PR creation, recovery controls and macOS execution. This
is a backend checkpoint, not M4 completion. No real-repository mutation, paid prompt, push or CI ran.
### M5 installer targets and build-path privacy, 2026-10-26

- The manual unsigned Build workflow now names universal macOS DMG and Windows x64/arm64 NSIS
  targets, installs their Rust targets, checks committed bindings first, and labels artifacts as
  unsigned acceptance builds. It neither publishes a release nor changes platform security policy.
- The bundle wrapper remaps checkout, home, Cargo and toolchain paths using encoded Rust arguments.
  Three focused build-environment tests cover Windows spaces, existing flags and malformed roots;
  they pass alongside Biome, workflow pin checks and instruction parity.
- Cross-platform bundling, native installer acceptance, signing, update service and release
  publication remain pending. No build or CI dispatch was started. See docs/releases.md.

### Update admission barriers, 2026-10-26

- Added reversible core admission guards for an idle session manager and empty terminal service.
  Live or starting agents and owned folder mutations prevent quiescence; once admitted, new agent
  starts, folder mutations and terminal reservations are refused until the guard drops. Draft
  persistence remains available for the final flush. Permanent terminal shutdown stays permanent.
- Three focused tests cover folder/agent exclusion, a concurrent start race, terminal reservations
  and permanent shutdown; core library Clippy passes. The updater will use these guards before
  invoking any installer. No installer, credentials or real agent ran.

### M5 explicit signed update service, 2026-10-26

- Added Rust-only check/download/install commands using pinned Tauri updater 2.14.0. Metadata and
  package reads are bounded and restricted to the release HTTPS origin without redirects; package
  signatures must bind the advertised newer version. Unsigned builds remain visibly disabled.
- Installation uses reversible idle barriers, refuses failed draft/storage saves, and confirms
  cleanup before Windows can exit through NSIS or macOS can restart. Vendor updater tasks now hold
  admission through completion, including when their IPC caller disappears. No active work is
  canceled to install an application update.
- Five updater tests, a signed-version/IPC-permission regression, the vendor-maintenance admission
  regression, exact binding export and core/desktop Clippy pass on Windows. An earlier `cargo check`
  build-script hash was blocked by Application Control; normal test and Clippy builds subsequently
  passed without a workaround or policy change. No actual update, sign-in or network probe ran.
- Added explicit signed-updater build configuration that requires supplied signing material. Keys,
  platform signing, release publication, native upgrade/signature acceptance and interface wiring
  remain pending. The bootstrap run is still not final verification.

### Optional encrypted-storage integration gates, 2026-10-26

- Added an explicit `encrypted_storage` workflow input for Windows/macOS SQLCipher client tests,
  encrypted core store and sync ledger tests, plus feature-enabled Clippy. Commands and prerequisites
  were coordinated with the M7 owner. Final verification must enable this gate.
- Windows selects only an installed native Perl for vendored OpenSSL and fails if unavailable.
  No tool installation, credentials, keychain reads or CI dispatch were performed here. Workflow
  pin/runner checks and instruction parity pass; hosted feature-matrix execution remains pending.
- Matched root's workflow correction by removing `save-if` from the Rust cache action. GitHub does
  not permit the earlier status function in that action input. The cancellation safeguard remains.
The local external-file codec now provides bounded chunked authenticated encryption, purpose/object
binding, opaque keyed filenames, authenticated lengths and range reads without plaintext temporary
files. Five focused tests cover chunk boundaries, empty files, nonce carry, substitution, truncation
and reordered chunks. Core file publication, attachment/dead-letter wiring and encrypted checkpoint
storage are still being connected; the codec alone does not enable account sessions.

The core encrypted object backend now uses capability-relative non-following reads, a bounded key-
and purpose-bound marker, owner-private temporary ciphertext, and atomic non-replacing publication.
Three focused Windows tests verify ciphertext-only files, reopening, duplicate validation, legacy/
wrong-key preservation, failed publication cleanup and corrupt-object rejection. Confirmed account
keys can be shared with the Rust writer without exposing them through IPC; nine account lifecycle
tests still pass, including no key handle before fingerprint confirmation and offline access after
sign-out. Caller wiring and macOS filesystem qualification remain pending.

## First integration findings and Git review interface, 2026-10-26

Hosted run 40311937683 completed at 28554a1. Windows passed Clippy, binding export, the process
spike and stream smoke. Its full test run exposed the Windows npm-prefix alias mismatch, outdated
native image capability expectations and demo checkpoint admission fixtures/behavior. The chat
smoke reached its first explicit permission before its old transcript-only selector timed out.
The dock now retains the request's segment identity and the DOM reader finds its actual controls.
macOS failed at the ioctl type mismatch already fixed locally. Remaining native paths still need
the batched rerun; neither platform's overall gate is complete.

The complete Orbit Chromium and WebKit browser suites now pass, including the docked-request
association, Files/Plan/Session, picker choices, accessibility, large history and long single-turn
virtualization, focus, disclosure retention and dark-only rendering under both OS color schemes.
The agent dock's accessible name includes its visible initials. Context-panel launch explicitly
focuses its button so WebKit can restore focus after closing. Programmatic test scrolls issue the
same reader-intent wheel event as a real upward gesture before changing virtualized scroll offset.

The dark Git dialog presents repository branch/commit/files, isolation and merge previews, conflict
paths, retirement and recovery/restoration reviews. Apply consumes the displayed Rust token and
refreshes state even after a rejected or uncertain reply. Chromium/WebKit fixture tests passed
stopped-session gating, no mutation before confirmation, merge conflict refusal, stale-review
failure and retained-worktree restoration. Screenshots and Axe checks passed. Production isolation
remains hidden until chat relocation is connected; backend command integration and exact generated
bindings are still pending. This is a local implementation checkpoint, not M4 completion.

## Dark settings and explicit update controls, 2026-10-26

The settings control and Cmd/Ctrl+, now open a dark settings surface using the Orbit layout and
Grok's list treatment. General exposes the existing Rust motion preference with revision-checked
saves and failure recovery, setup replay and the guarded local-data-folder action. Shortcuts lists
the actual implemented keys. About shows the running version and Rust updater status, download,
release notes and an explicit install confirmation. Opening settings performs no update request.
The UI reports unsigned builds and waits for active work instead of suggesting an update installed.

The chat stays mounted while settings is open, preserving its selection and draft. Hidden chat
keyboard handlers are disabled. Chromium and WebKit checks passed preference-save failure,
keyboard focus, no automatic update calls, the separate install confirmation, idle refusal and
unsigned-build behavior. Axe reported no violations on General, Shortcuts and About. Real
screenshots were inspected. Typechecking still awaits exact integrated binding generation; its
remaining errors name pre-existing missing generated commands/types. No CI dispatch was added.


The merge review found that current Git's read-tree overwrites ignored collisions. Merge application
now uses native fast-forward merge with no-overwrite-ignore against the already prepared two-parent
commit. Native checkout protects ignored files, Git compares the old ref, and automatic stashing is
disabled. The app no longer creates its own HEAD.lock. It verifies symbolic branch identity, HEAD,
index and working-tree state afterward, then checks for changes during final verification. A changed
target follows RecoveryRequired with both durable refs retained. All eleven focused Windows Git tests
pass, including ignored/untracked collisions, branch switching and newly staged changes. An earlier
test launch was blocked by Application Control; a normal rebuild after the fix allowed execution.
No security controls were changed. Source evidence is Git 2.54
[read-tree](https://github.com/git/git/blob/v2.54.0/builtin/read-tree.c) and
[native merge](https://github.com/git/git/blob/v2.54.0/builtin/merge.c), plus the
[no-overwrite-ignore contract](https://git-scm.com/docs/git-merge).
Native drivers now accept an authoritative bounded attachment reader in session setup. Claude,
Codex, ACP and Pi retain their existing text payloads and resolve imported images in memory; reader
failures never fall back to plaintext disk files. Three focused payload tests and driver/core/CLI
all-target Clippy pass, including the account feature. The encrypted reader is ready for the
account writer, which is the next integration step. No real agent was invoked.

The first integrated Windows run exposed stale image-capability expectations from before composer
imports were implemented. The Codex handshake assertion and 25 Claude/Codex replay goldens now
expect the supported image payload path. Reviewed golden changes are only `images: false` to
`images: true`; the focused handshake and all three replay gates pass locally without updating
goldens during verification. Recorded wire inputs and ACP goldens are unchanged.

Account writer file routing now covers composer imports, native attachment reads, tool output pages
and streamed encrypted recovery journals. The ordinary writer entry rejects Account profiles, and
account agent spawns disable raw protocol logs while retaining their unique spawn identity. Eleven
focused Windows tests pass for reopening, ciphertext-only storage, Unicode range boundaries,
corrupt-page rejection, poisoned writes, partial journals and owned spawn logging. Default and
account-feature core all-target Clippy pass. No real profile or credential store was accessed.
Encrypted checkpoints, recovery UI, ledger projection/scheduling and account readiness remain
pending; production account sessions must wait for that remaining wiring.


## Hosted demo-agent regression fixes

The first combined Windows run exposed an outdated empty-PATH desktop fixture after checkpoints
became mandatory. It now keeps agent detection on an empty PATH and gives only the checkpoint helper
a fixed Git directory with a fixture HOME. The prompt acknowledgment correctly describes its wait
for checkpoint capture. A separate core defect treated a legacy driver's background permission as
authoritative busy state when a checkpoint finished. Settlement now follows the same opt-in run-state
rules as normal dispatch; native background work still waits for idle. Five focused checkpoint tests
and all three real-startup desktop demo tests pass locally on Windows. The background test allows its
late event to arrive between turns or inside the next turn, while still proving untagged persistence
after the originating turn and permission survival. No real agent or login was invoked.

## M4 reviewed recovery controls

Managed worktrees now carry a typed operation journal in version 2 local metadata. Interrupted
creation, retirement and restore can be reconciled only after checking the owned path, repository,
branch and native worktree registration. Interrupted merge reconciliation additionally requires a
clean target at exactly its retained before or prepared commit and unchanged recovery refs. Restore
moves a retained directory back to its original owned location, preserving ignored files and its
branch. Missing, ambiguous, redirected, foreign-locked or newer-version records remain unchanged with
a reason. No broad prune, lock deletion, automatic reset or recursive deletion is used.

The eight Git workspace Tauri commands are registered and generated bindings are committed. Recovery
tokens bind the chat, worktree, operation and reviewed state; the manager retains canonical folder and
actor reservations through an owned task even if IPC disconnects. Git diff verification now disables
automatic index refresh and examines a bounded patch, preserving index bytes even after stat-only file
changes. Fourteen Git tests, five checkpoint lifecycle tests and all three desktop demo integration
tests pass on Windows. Core, CLI and desktop all-target Clippy and binding export pass. macOS execution,
chat relocation, optional bring-changes/setup, PR creation and missing-directory recreation remain
pending. No remote CI, push, real-agent prompt or login ran for this checkpoint.
Encrypted checkpoints now capture and reopen exact file bytes and manifests without plaintext Git
objects or scratch copies. Empty temporary Git repositories retain the existing path/ignore policy;
account handoffs use an explicitly labeled byte summary. Explicit user-workspace reverts retain
their existing atomic recovery behavior. Fourteen focused checkpoint/session tests pass on Windows,
including encrypted capture/diff/reopen/revert, plain-constructor refusal, legacy preservation and
the existing user-index/race/interrupt gates. Default and account-feature core all-target Clippy
pass. The profile-wide audit identified M4's worktree registry as another content-bearing file that
needs encryption before Account activation. The sync writer projection, scheduler and account UI
are still pending.


## M8 bounded configuration inventory

The new Rust aura-config crate inventories approved Claude/Codex/Pi roots and one shared skills
source. It selects only instruction, skill, MCP and plugin/package declarations. Credential files,
vendor synced content, caches, sessions and trust/account sections stay outside the inventory.
Capability-relative no-follow reads bound file size, tree depth, file count and aggregate size;
skill revisions include companion files. Malformed content reports a sanitized error without a
parser excerpt. MCP entries with authentication, unknown options or incompatible transport remain
visible with values hidden and an explicit copy restriction. Plugin declarations expose no userConfig.

This is the first M8 checkpoint, with source evidence and remaining work in docs/config-library.md.
Copy/apply/rollback and the desktop Library are still being implemented. Development uses only
temporary synthetic configuration fixtures, with no real credential/config reads, agent processes,
pushes or CI dispatches.

The next M8 checkpoint adds instruction/skill copy previews, durable per-operation journals and
restart-safe rollback. Both source and destination revisions are checked, directory handles remain
bound through apply, and hard-link publication refuses a concurrent new target. Independent original
snapshots remain available even if an editor retains an old file handle. Rollback refuses later edits
and deletions while recognizing interrupted publication. Complete skill bundles preserve binary
assets and execution bits; unrelated target files remain untouched. Fourteen Windows fixture tests
and aura-config all-target Clippy pass. macOS execution, scoped MCP/plugin mutation and Library UI
remain pending. All copies and recovery checks used temporary synthetic files only.

## M4 visible chat relocation

Moving a stopped chat into its managed worktree, or back to its source folder, now has a bounded
preview of the exact folder change and visible conversation handoff. Apply consumes a one-use token,
rechecks worktree ownership and conversation state, and reserves both canonical folders plus other
affected chat actors. The chat folder and pending handoff are saved in one transaction. Earlier
messages and native sessions remain intact. Applying the move sends no prompt; the next user prompt
starts a fresh native session with the reviewed handoff. Returning keeps the isolated directory and
its files. Cross-folder native resume remains unqualified and is not advertised.

All 313 core tests pass on Windows. The new actor regressions cover preserved history, exact deferred
handoff, fresh-session enforcement even when resume is supported, return to source, one-use tokens,
live destinations and changed conversations. Core, CLI and desktop all-target Clippy and binding
export pass. No migration is needed. The relocation Tauri commands and generated DTOs are included
for frontend integration. Optional bring-changes/setup, PR creation, missing
worktree recreation and macOS execution remain pending. No remote CI, push, agent prompt or login ran.
The integrated M4 ownership/recovery registry and setup preferences now have explicit encrypted
Account backends. Mutable records authenticate existing ciphertext before atomic replacement, retain
corrupt/future versions and refuse plaintext fallback. Twenty-four focused Windows tests pass,
including M4 create/retire/merge/recovery behavior, keyed registry reopening and setup revision/error
behavior. Default and account-feature core all-target Clippy pass. The activation audit is recorded
in `docs/account-storage-audit.md`; production profile switching, sync scheduling and IPC remain next.

## Integrated folder movement interface

The Git dialog now exposes separate workspace creation and chat relocation. Each move shows the
exact current folder, destination and visible handoff before a one-use confirmation. Returning to
the project folder preserves the isolated worktree. The interface refreshes chat state after an
uncertain IPC outcome and prevents dismissal during an owned operation. Chromium and WebKit
review-flow checks pass, including stopping a live session, both move directions, stale reviews,
merge conflicts, retirement/restoration and accessibility. Exact integrated binding regeneration
and native macOS/Windows execution are part of the second combined checkpoint, still pending.

## Native quit waits for owned file and vendor work

Normal quit acquires an admission guard before waiting for owned Git/configuration mutations and
vendor updates. It blocks new starts and mutations while existing owners finish, retains the guard
through session/store closure and reopens admission on a cancelled quit. If owned work has not
finished within five seconds, the window and database stay open with a visible message. The user
can retry after the operation ends. There is no forced-discard shortcut for this preflight.
Application update cleanup delegates the same guard. Forced OS termination relies on the durable
operation journal. Eight desktop quit tests, the core admission/drain regression and core/desktop
Clippy pass on Windows. No real vendor maintenance or native prompts ran.

## Cloud acceptance preparation

The compiled Rust Worker passes twelve isolated runtime cases. New cases exercise Turnstile
hostname/action/replay rejection, provider outage, failed email delivery and cooldown, secure cookie
issuance, immediate account revocation and scheduled cleanup including a late ciphertext upload.
Provider non-success HTTP status now fails before accepting its JSON. All network responses and
email failure are synthetic; actual delivery acceptance remains pending.

An isolated US-jurisdiction `auracode-preview` D1 and private `auracode-preview-blobs` R2 bucket are
provisioned. The R2 public managed domain is disabled and no custom domains exist. Preview Wrangler
configuration points only at those resources. Backup/migrations, secrets, widget, deployment and
public account acceptance remain pending. Local Wrangler is unauthenticated. The production build
dry run succeeds, but neither environment has been deployed. The combined CI workflow now includes
the compiled Worker runtime and site build, and its encrypted gate covers the full core library.


## M4 bring uncommitted changes

Isolation can now bring reviewed working-file contents, deletions, renames and nonignored untracked
files into the new checkout as unstaged changes. The source files, HEAD and exact index bytes remain
unchanged, including mixed staged and unstaged edits. Previews hash bounded file contents in addition
to Git status, so an edit that keeps the same status label still invalidates Apply. Protected agent
configuration, credentials, links, special files and files over 10 MiB are excluded with bounded
warnings. The total copy is limited to 100 MiB and 5,000 paths. Ignored setup files remain separate.

File publication shares the checkpoint no-follow and recovery-preserving implementation. A changed
destination fails before copying; a publication failure retains original and replacement files in
the new checkout and records RecoveryRequired. Successful cleanup removes only this operation's exact
temporary files. A Windows directory-handle cleanup failure was reproduced and fixed by closing the
owned handle before removal. Git state is checked again afterward. Seventeen Git tests and thirteen
checkpoint tests pass on Windows, including exact CRLF/binary bytes, staged rename/deletion, protected
exclusions and concurrent source/destination edits. The final copy checks and core/CLI/desktop
all-target Clippy pass. DTOs are unchanged. Setup, PR creation and remaining M4 acceptance stay pending;
no remote CI, push or real-agent work ran.

A follow-up review added configured provider-root and app-profile exclusions to bringing changes.
Custom CLAUDE_CONFIG_DIR, CODEX_HOME and PI_CODING_AGENT_DIR locations are resolved and bound into the
source snapshot before file contents are read, even when their filenames look ordinary. Known home
configuration locations are protected too. An owned temporary fixture verifies exclusion and rejects
using a protected root itself as a source. The focused regression and current Git suite pass on
Windows after a normal rebuild; the earlier test executable had been blocked by Application Control.
Core, CLI and desktop all-target Clippy pass. No policy or security setting was changed.

The PR helper foundation now accepts at most 1 MiB of stdin and closes it after writing, keeping
reviewed bodies out of process arguments and temporary files. It preserves owned-tree cleanup,
concurrent bounded output draining and timeout/cancellation behavior. Successful pipe delivery does
not prove the helper consumed the bytes; the caller still validates its result. All eleven Windows
helper tests and process all-target Clippy pass, including complete multiline input, blocked input,
size rejection and existing descendant cleanup. No real GitHub or repository mutation ran.

### M8 owned Library command layer, 2026-10-26

- Added approved environment/project root resolution, serialized one-use copy commands and durable
  recovery history. Changes retain core maintenance ownership through journal completion even if
  the webview caller disappears. At most four preparations retain source bytes and directory handles.
- Sixteen pure configuration tests and the root-resolution fixture pass, with core/config all-target
  Clippy. The independent Specta DTO export is deterministic and requires no desktop runtime.
- Full desktop compilation/export remains pending because Application Control blocked an existing
  Tauri plugin build script. No bypass, real agent configuration read, native prompt or CI run occurred.
  Library presentation and broader MCP/config conversion acceptance remain in progress.

### M8 Library presentation checkpoint, 2026-10-26

- Added the dark standalone Library screen with project/source and agent filters, literal item
  previews, before/after copy review, explicit apply, and retained-copy recovery. No route edits
  overlap root's App/Settings work. Its seven-command transport uses generated Rust DTOs.
- Chromium and WebKit synthetic checks pass for no mutation on mount, HTML escaping, review/cancel,
  explicit copy and restore, stale apply rejection and cancellation of late abandoned preparations.
  Both inspection and review pass axe; the actual screenshots were inspected against the current
  dark Orbit frame and visual-language rules. The exact Harvey URL redirected to signup, so no new
  reference login was attempted; connected Mobbin returned related Harvey imagery instead.
- Focused Library TypeScript and Biome checks pass. Full app typechecking remains pending the
  planned native binding refresh for preexisting conversation/search DTO changes. MCP/plugin apply
  and broader Library acceptance continue; M8 is not complete.
The account coordinator and fifteen typed desktop commands now cover explicit email proof, device
registration/approval/revocation, recovery setup, local fingerprint confirmation and sign-out. No
bearer or private key reaches IPC. A separate bounded app-owned vault index binds opaque Account
profiles to the canonical data root and origin, with an exclusive empty operational lock. Local
restoration requires no network, and profile preparation leaves the active pointer unchanged. The
service origin is compile-time restricted to production or preview; `account_config` pairs the
Turnstile frame with that environment. Eight core coordinator tests, the device-list/revocation
regression, and core/desktop all-target Clippy pass on Windows. Desktop binding generation is blocked by Windows
Application Control on the `selectors` build script, without a workaround. Guarded profile runtime
activation, writer projection and sync scheduling remain pending. No real sign-in or credential
access was used during development.

## Second integration corrections

The second deliberate CI batch passed the compiled Worker checks, frontend checks, both browser
engines and the complete macOS native chat smoke. Its two encrypted Windows/macOS core failures were
stale future-schema fixtures that still used the now-current schema number. Those fixtures now use
the current version plus one and preserve their refusal/no-quarantine assertions. Tokio's Unix PTY
registration now explicitly states and satisfies descriptor ownership for its replacement API.
Historical Linux spike results remain historical, while current runner documentation names the
actual Windows spike job. CI helper contracts now require manual dispatch, and ShellCheck installation
also runs after another independent check fails. All 33 spike-document checks and workflow lint pass
locally; the full shell suite needs jq, which this local shell does not have. Native Perl selection
is shared by encrypted, ordinary desktop and installer builds now that account storage is enabled.
The exact second-batch binding artifact is recorded; subsequent Library/account commands still need
the final combined native export. Remaining native/platform gates are not marked complete.
The pure aura-protocol Account DTO exporter now passes and generated TypeScript is committed for
the Account UI's thin invoke transport. It retains the Rust serde names and bounds timestamps to
JSON numbers. This does not change or substitute for the blocked full Tauri command export gate.

## M4 reviewed pull request publication

The worktree PR preview now shows the repository, committed head, base, diff summary, exact title/body
and whether the branch will be published. Apply consumes that review once and rechecks local state,
origin and remote branch/base state while holding folder/actor reservations in an owned task. A new
remote branch uses an explicitly empty expected ref lease, which only creates a missing branch.
An existing remote branch must already equal the reviewed commit. No local files are committed, no
existing remote history is replaced, and an existing matching open PR is reused without editing it.

GitHub CLI receives an explicit repository/head/base and the body through bounded stdin. The explicit
head disables implicit pushing/forking; the created PR is normal, with maintainer edits disabled.
Missing CLI, sign-in/access failures and uncertain network outcomes have actionable errors; an
unconfirmed final head after creation returns the PR URL with a warning. GitHub.com origin remotes
are supported initially. Five focused publication tests pass on Windows with a fake GitHub service
and a real owned temporary bare Git repository. The full current Git suite has 23 passing tests;
core/CLI/desktop all-target Clippy and exact binding export pass. Native GitHub publishing, macOS
execution, setup and remaining M4 acceptance are pending. No real remote mutation or agent call ran.
The native behavior follows the official [GitHub PR create](https://cli.github.com/manual/gh_pr_create)
and [Git push lease](https://git-scm.com/docs/git-push) contracts.

## Account setup and remaining dark surfaces

Settings now includes the real Rust account command transport, email/code flow, recovery-key
acknowledgment, device approval and revocation, fingerprint comparison and sign-out. Transient proofs,
codes and recovery text are never persisted by the frontend. Account activation and sync scheduling
remain separate pending work, with inactive state shown explicitly. Library navigation and project
folder selection are connected. Git isolation exposes reviewed uncommitted-file copying after the
configured credential-root exclusion fix. Diagnostics and startup errors now use Orbit typography,
solid dark surfaces and marks; obsolete milestone copy and placeholder navigation are removed.
The dark-only rule is also explicit in both byte-identical root instruction files.

The production verification page and desktop frame enforce exact origins, source windows and a
fresh attempt nonce. The website keeps hashed script CSP and permits framing only on that route.
The native page gains only exact verification-frame sources, with no remote command capabilities.
Pinned Wry's macOS navigation handler covers child frames, so its narrow verification-document
allowlist now covers the hosted page and Cloudflare challenge documents without making them trusted
app origins. Native/live-widget acceptance remains pending: the local test build was blocked by
Application Control on Specta's build script. No bypass was attempted.

Chromium and WebKit checks pass for invalid sign-in codes, recovery-key acknowledgment, fingerprint
confirmation, mismatched recipient codes, revocation, sign-out, verification origin/window/nonce
rejection, empty browser storage and accessibility. The combined Settings/Git/verification/account
browser batch, desktop typecheck, website static checks and Biome pass locally. The second hosted
integration also passed Windows native chat smoke and cross-platform generated binding parity.
The newer account/Library command set still needs the final combined native binding export.

### M8 per-entry MCP copy and recovery, 2026-10-26

- Added scoped JSON/TOML MCP edits with reviewed stdio/HTTP conversion, required Claude transport
  type, duplicate-key rejection and refusal of selected credential/unknown fields. Other servers,
  project trust and private settings never enter a preview or lasting recovery receipt.
- Full-document private transaction files remain in the original config realm only while the
  publication is unfinished. Checked publication retains uncertain originals; successful operations
  remove temporary documents. Persistent receipts keep only safe before/after entry values. Restore
  applies the inverse entry change to current configuration, preserving unrelated later edits.
- All 22 pure configuration tests and all-target Clippy pass. Added interruption coverage before
  moving the original, between move/publication and after publication, plus private-value exclusion,
  unrelated-edit preservation, stale rejection and Claude state-file tests. A first test executable
  was blocked by Application Control; the normal rebuild after substantive recovery edits passed
  without renaming, relocating or changing policy. No actual agent configuration was read or written.
- Chromium/WebKit tests now also cover MCP review and protected-entry rejection; focused TypeScript
  and Biome pass. Native desktop compilation, plugin installation/conversion and remaining Library
  acceptance stay pending. The Library back action is neutral for Settings integration.

## Reviewed GitHub publication interface

The Git dialog now prepares title, description and optional base, then displays the exact repository,
head commit, remote-branch action and diff summary before publication. Confirmation uses the Rust
one-use review; the resulting link is opened only by a separate user click. Chromium and WebKit pass
the complete create/move/recover/publish presentation path and accessibility checks with synthetic
commands, and desktop typechecking passes. No actual remote repository was changed by these tests.
The integrated native publisher has also received independent source review with no blocking finding.
MCP per-entry configuration copy/rollback passed a separate independent review before integration.
Production Orbit tokens are unconditionally dark; historical light values are scoped to the archived
Design Lab alone and cannot select a light appearance for the desktop or website.

## Encrypted configuration sync boundary

Schema 0009 adds the Account config merge-base store and encrypted blob transfer/reference queues.
Local profiles leave these tables empty. The fresh-schema and indexed-foreign-key regressions pass;
the config port implementation follows as a separate checkpoint. Setup remains device-local in
schema 0008, and schema 0010 is reserved for accepted steering-input persistence.

Added the Rust configuration port for account-bound encrypted snapshots, revision-checked publication,
explicit tombstones and per-device merge bases. Logical IDs and snapshot metadata must be encrypted by
the account runtime; no account key, token or vault handle enters the configuration crate. Oversized
items remain explicitly skipped, and partial applies retain their previous merge base. Migration 0009
is reserved for the account port's encrypted configuration storage. `cargo check -p aura-config` passes.
The merge, apply and desktop integration remain in progress.

### M3 explicit native installation checkpoint (2026-10-26)

- Added Rust-reviewed, version-pinned npm installation for missing native Claude, Codex and Pi.
  The review resolves Node and a validated npm package entry without reading or interpreting shell
  shims, vendor configuration or credentials. Start rechecks availability and the exact reviewed
  paths, argv and executable bytes. See `docs/setup-actions.md` for official sources and limits.
- Agents/onboarding now expose a separate review and Start installation action in the owned dark
  terminal. Mount/review cannot launch a process. Closing or page cancellation stops its process;
  Rust enforces a ten-minute lifetime even with no renderer polling. Installation and sign-in stay
  separate. A partial npm package is preserved for the vendor's next explicit attempt.
- Generated setup DTOs through the pure aura-protocol Specta exporter. Full native command binding
  refresh remains assigned to the final integrated Windows/macOS verification.
- Passed: installer recipe/replacement regression; setup DTO export; all-target aura-agents Clippy;
  complete desktop TypeScript; four existing terminal transport tests; Chromium and WebKit review,
  explicit-start, close cancellation, stale-review rejection and accessibility checks. Inspected
  the actual dark screenshots, including correcting terminal dialog centering.
- Native core tests and Clippy could not reach our code: Application Control blocked io-lifetimes'
  build-script-build with Windows error 4551 in this worktree. No bypass or binary relocation was
  attempted. A harmless local-process no-polling deadline regression is included for integration.
  No real installer, sign-in, model prompt, credentials, push or CI dispatch was run. Clone remains
  the next authorized implementation step, not complete.

### M9 snapshot and merge foundation

Configuration snapshots now carry validated provider-relative identities and explicit tombstones.
The pure merge preserves first-link additions, merges independent setting keys and text edits with
`diffy`, and leaves overlaps or edit/delete races unresolved for user review. It never writes conflict
markers. Missing heads and unavailable items wait. File, tree, field, scope and payload validation
reject unsafe paths, trust/credential fields and future schemas. Canonical encoding binds content to
its exact item. Thirteen focused Rust regressions pass; scanner, reviewed apply and UI are pending.
Guarded Account activation now prepares the keyed database, files, metadata and services before
publishing the active profile. It drains admitted commands, flushes pending writes and refuses
live agents, owned folder work or terminals. Failure preserves the current dataset and active
pointer. Startup can show a locked Account profile while restoring only auracode's local key;
Local stays available explicitly. Profile publication invalidates channels, native notification
generations and cached Library previews. A bounded no-follow audit preserves and refuses known
legacy plaintext locations. Unknown ACP fallback strings now log lengths only.

Seven focused native profile/generation tests, eleven existing desktop state tests, the core audit
regression and the writer flush regression pass on Windows. Core and desktop all-target Clippy pass.
An ordinary native build now permits the full command exporter, which passed and regenerated the
committed TypeScript without a policy workaround. Sync projection/scheduling, encrypted recovery
browsing and macOS runtime qualification remain pending; no real account login was performed.


### Profile switching interface

Settings now lists Local and remembered Account profiles and exposes explicit activation after device
approval. Switching freezes interaction, saves drafts, waits for native preparation and reloads the
whole webview after publication so old stores, promises and channels cannot leak into the new dataset.
Unsaved drafts and native refusal preserve the current page. Locked startup presents account unlock
and Local selection. Three frontend transition tests, complete TypeScript, and Chromium/WebKit picker,
unsaved-draft, active-work refusal, locked recovery and accessibility checks pass. Full native two-profile
interaction and real account-key restoration remain final qualification gates.

### M9 bounded discovery checkpoint

Added explicit user-root discovery for Claude, Codex, Pi and shared skills, with independent settings
key paths, binary skill dependencies, home-path normalization and platform scopes. Known credential
and trust fields are excluded. Protected MCP entries currently wait rather than exporting their secret
fields. Missing agents, malformed or duplicate-key documents, incomplete/protected bundles and read
failures cannot establish deletion. Empty settings containers never create overlapping parent items.
Aggregate discovery and each snapshot are bounded. All nine discovery and thirteen merge regressions
pass using temporary synthetic files. No real agent configuration was inspected or changed. Reviewed
application, secret-free MCP extraction and desktop orchestration remain pending.
### Owned cleanup confirmation retry (2026-10-26)

- Independent clone review identified that ProcessControl::shutdown deliberately shares its first
  report forever, including an unconfirmed result. Added retry_unconfirmed_shutdown as an explicit
  recovery seam: it joins pending or confirmed chains and replaces only a completed unconfirmed
  chain. Ordinary shutdown retains its original idempotent behavior.
- Passed all three focused control tests, including real Shared-future pending/unknown/leftover/
  confirmed states, plus all-target aura-process Clippy. No native or vendor processes were run.

### M3 owned GitHub clone checkpoint (2026-10-26)

- Implemented separate Rust clone review, start, cancellation, status and recovery history, plus the
  first-project dialog. Only bounded GitHub HTTPS/SSH repository URLs are accepted. The user picks
  a parent and a new portable name; atomic directory creation refuses every existing destination.
- Git runs with isolated configuration, no hooks/templates/custom filters/submodules or credential
  prompts, and strict SSH host verification. Public HTTPS and already-configured private SSH are
  explicit UI choices through the pasted URL. No GitHub CLI sign-in is attempted. Raw helper output
  is bounded, unlogged and classified without exposing it. Startup is limited to 15 seconds and
  cloning to ten minutes. Stop reaches owned processes only, retains folder reservations through
  confirmed cleanup, and uses the separately tested explicit shutdown-retry seam.
- Started/outcome records are flushed beside the selected destination, outside profile metadata.
  Interrupted and canceled partial files remain for inspection. No clone recovery action deletes
  files or reuses an existing target. A started receipt alone never proves target ownership: a
  collision before create can leave a receipt for an independently created path. Outcome is not
  exposed as Ready until its recovery record is durable.
- Added six focused Rust cases for strict URL/name validation, one-use/page ownership and canceled
  admission, existing-target refusal, interrupted/canceled recovery and bounded error redaction.
  These await integrated native execution because the existing io-lifetimes build script is blocked
  by Application Control 4551. The expanded pure protocol source compiled, but Application Control
  also blocked the rebuilt existing setup DTO exporter executable. No executable was relocated or
  changed to bypass policy, and bindings were not handwritten. Exact clone DTO generation and full
  TypeScript/native verification remain pending the authorized integrated export environment.
- Passed Biome plus Chromium and WebKit clone review/no-start, cancellation, ready-folder selection,
  existing-target refusal and accessibility checks. Existing onboarding persistence/demo/storage-
  retry browser checks passed on both engines. Inspected the actual dark clone review screenshot.
  Independent read-only review found the cached-shutdown report issue, fixed in 8567390, and no
  confirmed overwrite blocker. No real remote clone, installer, auth command, model prompt, push or
  CI dispatch was run. Clone source is reviewable; native/binding acceptance is still pending.
The Account writer now implements `ConfigSyncPort` for bounded encrypted snapshots and local
merge bases. Wire item IDs are derived with the account key; logical IDs, scope, content hashes
and revisions stay in authenticated payloads. Snapshot reads bind the exact item/head and verify
the content hash. Publication checks the current head and queues its encrypted blob atomically;
the head is ineligible for upload until the blob is acknowledged. Device-state writes check both
the previous base and an independent local revision, so concurrent skipped/device-only changes
cannot erase each other. Fifteen focused sync tests and core/sync all-target Clippy pass. Network
blob transfer, remote projection, the active desktop service and encrypted apply journal follow;
this storage checkpoint does not claim a completed sync session.

The Account writer can now bind its confirmed account/device key and seal project, portable folder
and chat metadata in the same transaction as each local edit. Per-field clocks retain untouched
values; tombstones remain explicit and local clock rollback does not discard edits. Folder paths,
setup recipes, native sessions, prompt queues and drafts are excluded. Embedded credentials and
local paths in Git remotes are not projected. Outbox SQL failures retain their SQLite error class
so disk-full and busy errors keep the writer's existing retry behavior.

All twelve focused sync/Account-writer tests and Account-feature all-target Clippy pass, including
transaction rollback, reopen durability, field clocks, privacy exclusion and Local refusal. This
is a storage checkpoint: desktop attachment, remote row projection, transcript chunks and network
scheduling remain pending. No network or agent call was made by these tests.
## M4 setup schema checkpoint, 2026-10-26

Schema 8 adds device-local worktree setup recipes keyed by folder and device in the profile database. Account profiles use the existing SQLCipher connection; the table is outside sync projection. It stores paths and explicit command arguments only, never copied file contents, terminal output or execution grants. Existing database migration backup behavior remains in use. The separate reviewed copy and terminal service is still being verified and is not a completed M4 acceptance claim.

## M4 reviewed worktree setup service, 2026-10-26

Setup settings now expose typed read/save, preview/apply and guarded terminal-start commands. Saved recipes remain inert. A review displays exact source and destination paths, file sizes and resolved executable arguments. It expires after ten minutes and can be consumed once. Apply checks app-owned worktree identity and Git repository ownership, refuses changed source bytes and existing destinations, and reports copied paths if publication stops partway through. Explicitly selected application environment files are supported; agent configuration, credential paths, keys, links and configured provider/profile roots remain excluded. Copies are limited to 32 files, 1 MiB each and 16 MiB total. Contents stay out of settings, previews and protocol logs.

Command start is a separate explicit action. The owned PTY keeps folder and actor reservations through shutdown, even if IPC or the window disappears. A ten-minute command deadline stops only the owned tree. Unconfirmed cleanup retains reservations and returns a recovery error. Command-only previews support rerunning installation without recopying existing files. Windows requires a native executable or an explicitly selected interpreter with arguments; shell shims are never silently expanded. No actual vendor, installation, network clone or paid agent command was executed during development.

Verification: six focused setup and terminal regressions passed on Windows. The storage run passed 73 tests; its one stale foreign-key-count assertion was updated for the new table and then passed separately. Core and desktop all-target Clippy passed with warnings denied, rustfmt and mirrored-instruction checks passed. The desktop TypeScript exporter compiled but Windows Application Control blocked its test executable with OS error 4551 before execution. Generated bindings remain unchanged pending the final integration export. macOS setup execution and the complete M4 product acceptance remain pending.

### Integrated setup and profile admission

The ordinary Windows native build and exact desktop command export now pass with the combined
installer, clone, worktree setup and Account profile commands. The pure setup DTO export also passes.
An integration review found and closed a clone-start gap: its native profile admission now stays owned
through asynchronous reservation, execution and cleanup. Profile publication cancels stale clone
reviews; worktree startup retains admission through terminal ownership. Boot subscribes to profile
publication before reading initial state, avoiding a lost startup-unlock event. Integrated Clippy is
pending because Windows Application Control blocked darling_macro loading with error 4551. No policy
change, artifact rename or alternate execution was attempted.

### Worktree setup interface

Owned worktrees now expose per-device setup recipes, explicit copy/command review, create-only file
application and the owned terminal's separate Start setup action. Saving or reviewing never runs the
command. Stale review failures retain source data, and partial copy results list completed files while
withholding the command grant. Chromium and WebKit pass review, no implicit launch, explicit start,
close cancellation, stale/partial recovery and accessibility checks. Screenshots were inspected. Full
TypeScript and eight profile/terminal frontend tests pass. Native source tests, macOS behavior and the
final combined CI remain pending.

### M9 encrypted apply journal contract

Added the profile-bound ConfigApplyJournal port with durable create, authenticated reads, compare-and-swap replacement, a bounded encrypted UUID index, and an 8 MiB receipt limit. Filesystem application and recovery remain in progress. The 44 existing aura-config tests pass against temporary synthetic files; no real configuration was read or changed.


### M9 reviewed orchestration

Added a paged read-only sync inventory and item-bound review of local, base, remote and merged content.
Explicit conflict choices and device-only flags retain per-device state with revision checks. Missing
blobs wait rather than becoming deletion or publication. Completion re-observes the local target and
refuses to advance its base after a failed or partial apply. Interrupted applications keep the prior
base and become explicitly skipped. Five orchestration regressions, pure sync DTO export and all-target
configuration Clippy passed. The final skipped-state helper and sixth regression compile, but Windows
Application Control blocked the updated test executable with 4551 before execution. No workaround was
attempted. Native service, recovery UI and automatic network attachment remain in progress.
### M9 reviewed filesystem apply and recovery

Implemented consuming, expiring configuration reviews, root identity and complete-content checks,
format-preserving JSON/TOML edits, home expansion, explicit per-device/vendor skips, and bounded
encrypted before/after receipts. No-clobber publication retains uncertain originals; temporary
publication files stay inside the original config realm and have verified crash cleanup. Restart
rollback preserves later unrelated settings, refuses selected user edits and has its own inverse
receipt. Tree deletes remove only empty directories. The full 64-test aura-config suite and all-target
Clippy pass on Windows, including 16 new apply/recovery regressions and four document-edit tests.
No real configuration was read or changed. macOS execution, the encrypted profile sink, desktop
orchestration and secret-free MCP projection remain integration work. See `docs/config-apply.md` for
the transient publication-file constraint and required host mutation guards.


### Account-bound configuration services

Account activation now verifies its sync ledger before publishing the profile and exposes a Rust-only
configuration service through the profile admission lease. Its port and encrypted apply journal are
bound to that writer/key. Local and locked profiles cannot obtain them; a failed target preparation
keeps the old service usable, and successful switching invalidates retained old handles. The journal
uses encrypted receipt objects and an encrypted UUID index, exact-byte retry after partial publication,
SHA-256 compare-and-swap replacement, fixed size/count limits, and fail-closed missing-index recovery.
No receipt or config content is persisted in plaintext.

Six focused native profile tests and three initial journal regressions passed on Windows. Core and
desktop all-target Clippy passed. The fourth missing-index regression compiled, but Windows Application
Control blocked the refreshed core test executable (4551); it remains pending execution in the final
qualified test batch. No policy workaround, credential access, network call or real config edit was
performed. Remote projection, blob transfer, transcript sync and scheduling remain in progress.
Follow-up checks also reject case-colliding remote filenames before review and verify that a file
created after durable receipt publication is never overwritten. All 18 apply integration tests and
all-target Clippy pass on Windows.


### M9 native review and recovery admission

- Added Account-profile-only inventory, expiring one-use reviews, apply, device-only controls and encrypted receipt history/rollback commands. Owned blocking work retains profile admission and the shared Library mutation guard through durable completion.
- Applications re-resolve trusted sources and provider availability; changed bindings are refused before a receipt or file mutation. Failed application retains the old merge base and a skipped marker, and unresolved recovery prevents another apply.
- Native Windows binding export passed. Focused configuration verification passed: 19 filesystem apply/recovery tests, 6 orchestration tests and exact DTO export. The broader product and platform acceptance remain pending; network delivery is still separate from local Account publication.
### M9 MCP public projection and local requirements

Added default-empty, bounded MCP `local_fields` metadata containing requirement names only. Discovery
exports supported public settings while leaving environment/header values and bearer-variable
references local. Merge preserves the union of existing requirements. Apply skips missing setup,
unknown fields and credential redirection, retains exact private JSON/TOML spans, and keeps later
local value rotations during rollback. Protected tombstones wait for explicit native removal.
Source evidence and the closed supported subset are documented in `docs/config-apply.md`.
All 75 aura-config tests and all-target Clippy pass on Windows, including five added MCP apply cases
and four metadata/merge regressions. No real configuration, environment secrets or vendor credential
stores were inspected. macOS and desktop/profile integration remain pending.

## Native steering driver checkpoint, 2026-10-26

The driver contract now distinguishes accepted, rejected and unconfirmed steering. Codex uses the committed 0.162.1 schema's native `expectedTurnId` precondition and correlates acknowledgements even after the selected turn settles. Stale local turns are rejected without sending, vendor restrictions remain effective, and malformed acknowledgements or timeouts stop the owned session with an unconfirmed outcome. Four focused fake-process regressions and driver all-target Clippy passed on Windows. The capability remains disabled until the durable actor and composer path is integrated. No paid prompt or live agent call was made.

Pi steering remains unsupported: pinned Pi 1.0.2 awaits asynchronous input handlers before adding steering to a queue and has no exact-turn precondition. Clearing that queue after settlement would also remove unrelated extension inputs. A local busy check therefore cannot meet the product's no-later-turn delivery guarantee. Other drivers explicitly reject the new command.

## Durable steering service checkpoint, 2026-10-26

Schema 10 retains explicit user steering parts and delivery outcomes in the profile database. `composer_steer` reuses validated composer attachments and requires the exact active turn. The actor saves a visible pending entry and typed parts before sending native control, then records accepted, rejected or unconfirmed delivery. Stop, turn settlement and IPC cancellation cannot redirect input into another turn. New prompts, restart, relocation and profile shutdown wait for the outstanding attempt. Sequence admission reserves enough space for split user text and its final status. Crash recovery never retries an uncertain message. Only accepted steering joins retry and visible handoff context; rejected or uncertain text remains visible in the source transcript.

Codex now advertises steering through this path. Pi and all other drivers keep the capability disabled. Six focused core regressions, 25 native Codex tests, two schema checks, 23 protocol tests, fresh-schema and foreign-key checks, and the committed replay suite passed locally on Windows. The new synthetic replay covers accepted and vendor-rejected steering. Core, driver and desktop all-target Clippy passed. Ordinary desktop compilation and exact TypeScript binding export passed. No paid prompts or vendor configuration access occurred. Frontend integration is still owned by the root worktree: its reducers and composer control must handle `steering_status` before product acceptance. This branch's pinned-pnpm typecheck reports those two pending exhaustive cases and older clone type reexports already fixed upstream. macOS and full milestone acceptance remain pending.

## Project default model startup, 2026-10-26

A fresh chat now loads its project's default model into the driver's existing desired startup options when the project default agent matches, or when no default agent is selected. An established agent session keeps its saved settings even after project defaults change. The same initialization is used when an explicitly confirmed continuation selects a fresh agent. No fake native identity or extra migration is created. Two regressions cover startup delivery, saved-setting precedence and provider separation. They compile, but Windows Application Control blocked the test executable with OS error 4551 before execution; that execution gate remains pending. Core all-target Clippy, rustfmt and mirrored-instruction checks passed. No paid or live vendor call was made.

### Authenticated remote metadata projection

Schema 11 adds a durable bounded-work projection queue for authenticated records whose project or
folder has not arrived yet. Cursor advancement and queued dependencies commit together. Portable
project/folder/chat fields merge into existing rows without manufacturing paths, native sessions or
queued inputs; remote deletes remain tombstones and retain local folder locations. Projection clears
its capture triggers so incoming changes are not echoed as fresh local edits. Config heads now accept
newer authenticated snapshots, retain newer unsent local revisions, and leave missing blobs unavailable
until transfer verifies them. Future config schemas remain retained rather than overwritten.

All 24 focused sync tests passed, including the previously blocked missing-index journal regression,
child-before-parent pages, per-field merge, tombstones, malformed-page rollback and config clock
collisions. Core all-target Clippy and the schema foreign-key/index check passed. This remains a storage
checkpoint: the network scheduler, blob transfer and transcript chunk import are not attached yet.

### Configuration sync interface and MCP integration

- Settings now includes Account-only configuration inventory, paginated items, device-only controls, explicit per-item merge choices, four-version review, confirmed removals and encrypted receipt recovery. Expired/stale one-use reviews require a new review; partial results show recovery instead of success.
- Both Chromium and WebKit pass the actual production component with synthetic responses: Local profile gating, no automatic apply, manual conflict choice, pagination, stale review, partial apply, explicit rollback, removal confirmation and accessibility. The dark Orbit review screenshot was inspected. Source formatting passes.
- MCP manual choices retain all present devices' local setup requirement names. Codex plugin and marketplace declarations require a native vendor workflow. Two added integration regressions compile, but Windows Application Control blocked this new executable with error 4551 before execution; these tests remain pending for qualified execution. No policy workaround was attempted.
### Bounded encrypted blob exchange

The Account writer now exposes typed transfer work independently of HTTP. It releases config heads
only after acknowledgement of the exact uploaded ciphertext, authenticates downloaded blobs against
the requested item/head/content hash, and saves blob availability transactionally. Transfer snapshots
bound uploads to one blob and downloads to four; queued requests have byte/batch limits. Replayed
acknowledgements are idempotent, and a mismatched or truncated download leaves the snapshot unavailable.
Both focused exchange regressions and core all-target Clippy pass on Windows. Network attachment and
compacted transcript transfer remain in progress; this checkpoint made no network requests.
## Steering interface checkpoint, 2026-10-26

The composer now offers an explicit Steer action only when the advertised capability, running status and exact open turn are available. Send retains its existing queue behavior. The chat store rejects stale or unsupported turns without a fallback send, permits one outstanding steering attempt, and keeps Stop available. Transcript messages retain pending, accepted, rejected or unconfirmed delivery outcomes across text deltas and late acknowledgements. An unresolved message in an ended or recovered turn displays delivery unconfirmed. Only an accepted acknowledgement clears a still-matching submitted draft; newer text or context is preserved. Rejected, uncertain and failed attempts are never retried automatically.

The transcript's repeated virtual rows now use named groups instead of duplicate Turn landmarks, correcting the accessibility failure exposed by multiple user messages in one turn. Eighty-three focused reducer, chat store and draft tests passed, along with desktop typecheck, Biome, instruction parity and diff checks. The new browser-only steering fixture passed Chromium and WebKit checks for unsupported and idle controls, exact turn targeting, delivery outcomes, preserved drafts, Stop and late acceptance, plus an axe accessibility scan. No agent or native command ran. Full integrated Windows/macOS acceptance and the earlier Application Control-blocked default-model test execution remain pending.

### Active Account sync worker

Account profiles now attach one Rust worker after successful publication. It coalesces initial,
turn-completion and requested focus triggers, polls every 60 seconds, transfers bounded encrypted
metadata/config batches and blobs, and respects offline/rate-limit backoff. Explicit account actions
suspend its owned in-flight request before changing authentication; revoked or expired authorization
pauses automatic requests. Profile replacement and quit stop the worker without discarding its outbox.
A profile-tagged public-status event and the existing AccountStatus.sync field expose its progress.
The native focus forwarding hook is available for root integration.

Core, sync and desktop all-target Clippy pass. Two keyed profiles exchanged config through a fake
network and the real writer; owned in-flight suspension/stop passed. A loopback HTTP regression passed
for a lost upload acknowledgement and rejection of substituted ciphertext. Two paused-clock tests
found a startup wake issue; the coalesced wake/priority fix and corrected timer-wheel boundary compile,
but Windows Application Control blocked the refreshed executable (4551), so their corrected runs remain
pending. No policy workaround or real account request was performed. Transcript chunks, concurrent
continuation markers, explicit Local import and remote-folder resolution remain pending M7 work.

### Preview deployment and live API checks

The preview D1 export was downloaded and verified before all three migrations were applied. The real Rust WASM Worker is deployed with preview-only data bindings, separate secret-store credentials and managed Turnstile widget, no workers.dev access, the same-origin API route and cleanup cron. Live health/configuration, missing-session and foreign-Origin checks passed. Production resources remain untouched. The website build is ready, but JWT-authenticated static asset upload returned Unauthorized after session registration; publication remains pending an authenticated supported upload path. Real email, browser challenge and signed-in multi-device acceptance are still pending. See infra/README.md for exact resource evidence.

### Sync status and focus integration

The main window now requests a coalesced native sync on focus. Profile-tagged status events refresh Account status and completed-cycle workspace, chat-list and configuration inventories; events from older profiles are ignored and listeners are released even when registration completes after navigation. Three focused listener ownership tests, integrated TypeScript and Biome pass. No account credentials reach the UI listener. Integrated native export and final platform checks remain pending the combined source batch.
## Portable project folder identity checkpoint, 2026-10-26

Creating a project or explicitly adding its folder now inspects bounded local Git metadata through the owned helper. Repository roots with a qualified credential-free origin retain portable remote identity and the locally recorded origin default branch. A feature branch is never guessed to be the default. Subfolders, non-Git folders, private agent roots and unqualified remotes remain local; unavailable inspection preserves existing identity. The helper does not fetch, authenticate or change the index. Re-adding a folder updates its existing ID, and moving a chat between projects while preserving its folder carries the portable metadata. Device paths remain exclusively in folder_locations. Existing folders can be qualified by explicitly adding them again; automatic cross-device location resolution is still pending in the sync milestone.

Four focused identity regressions passed on Windows, covering URL qualification, local-only fallbacks, unchanged Git index, stable folder IDs, project moves and missing foreign-device paths. Core all-target Clippy, rustfmt and instruction parity passed. Only owned temporary repositories were used. The two previously blocked project-default-model tests also executed successfully in an ordinary Cargo run, clearing that local execution gate. No vendor prompt, credentials access, network Git operation or CI dispatch occurred.

### Combined native command export

The ordinary Windows native build now compiles the integrated Account worker, steering, configuration reviews and vendor terminals. Exact Tauri binding export passes. Added the desktop's explicit UUID dependency for one-use vendor tokens and fixed the reported configuration Clippy style finding. Full milestone verification remains reserved for the final combined source batch.
## Reviewed fresh-session recovery checkpoint, 2026-10-26

Start fresh in the production header and error card now opens a visible continuation review. The new FreshSession action builds bounded context from the current agent's complete saved conversation, preserving the existing accepted-steering filter. Confirmation saves the exact handoff, retains source turns and archive state, and starts no agent or prompt. The next explicit message starts without the missing native ID and includes the reviewed context. Existing resume/retry controls keep their meaning, and no vendor stderr is guessed to trigger an automatic fallback.

All seven core continuation tests passed, including a failed native resume followed by reviewed recovery, archive preservation, same-chat history retention and exact next-message context. Fifty-one focused frontend tests, TypeScript checking, exact Windows binding export, Biome, instruction parity and diff checks passed. Chromium and WebKit verified both Start fresh entry points, cancellation, visible context, confirmation without a send, retained source text and the saved handoff, with an axe scan. Core-only all-target Clippy passed; the dependency-inclusive run exposed an inherited collapsible_if warning in aura-config/src/sync/review.rs, reported to its owner. Native live-agent and full Windows/macOS integrated acceptance remain pending. No paid prompt or real native session was used.

### Managed configuration automation and acknowledgment recovery
- Integrated encrypted ownership claims into every reviewed configuration application. A fresh
  explicit review can reconcile an uncertain claim while preserving its original device baseline.
- Successful Account exchanges process at most eight previously selected items per batch, under
  profile admission and the Library mutation lock. First-link, open reviews, device-only/skipped
  items, vendor declarations, conflicts and unfinished receipts remain manual. Unchanged bases
  do not generate writes. History restoration pauses automatic sync before changing files.
- Twenty-seven focused aura-config library/review tests pass, including the previously pending
  manual MCP requirements and Codex plugin regressions, automatic selection/base preservation,
  conflict exclusions and failed-acknowledgment recovery. Desktop TypeScript checking passes.
- Native all-target Clippy reached the changed configuration crate but Windows Application Control
  blocked darling_macro-b433f63937ec6736.dll with error 4551. No policy changes or bypass attempted;
  combined native qualification remains pending the final permitted Windows/macOS verification.

### Late steering and immutable history

Turn compaction now waits for an outstanding steering result, then includes its final saved visible
status before the turn can become immutable sync history. Compaction also advances the saved last
event sequence through that late outcome. A controlled driver regression ends its turn before replying
to steering and verifies both the incomplete and sealed states. That regression and core all-target
Clippy passed locally on Windows. No vendor call was performed.

### Bounded encrypted transcript transport

Schema 12 records each turn's parent and source agent without copying native session identities.
Completed, compacted turns are captured incrementally through the profile writer as one immutable
`chat_chunks` head pointing to a reverse chain of encrypted pieces, each at most 3 MiB. Raw event JSON,
typed prompt/steering parts and authenticated attachment ranges survive capture. Heavily escaped rows
use bounded fragments; progress and ciphertext commit together. An already missing attachment remains
explicitly unavailable. A head cannot leave the outbox until every referenced piece is uploaded.
Incoming pieces authenticate the account, turn and ordinal, reject head rewrites and ciphertext
substitution, and remain staged until session admission can safely publish them to visible history.

All 34 focused sync tests passed on Windows, including bounded restartable capture, unknown events,
image bytes, accepted steering, fragmentation, upload ordering and two-device encrypted transport.
This run also passed both scheduler clock/revocation tests previously blocked by Application Control.
The schema/index regression and core all-target Clippy passed. No policy workaround, vendor prompt or
real account request was used. Remote turn publication, open-view reconciliation, concurrent fork
markers, explicit Local import, folder resolution and Continue-here integration remain pending M7 work.

### Nested Library skills and duplicate provenance
Pi and shared portable skill collections now use bounded recursive discovery. Nested logical keys
remain distinct, duplicate previews explain the other sources and vendor-specific precedence, and
copying a nested skill reviews its normal direct target with the existing recovery journal. Fifteen
focused inventory/copy tests passed, including private-subtree exclusion, depth failure, duplicate
provenance and nested-copy rollback. Tests used temporary synthetic files only. No native vendor
configuration, credentials, network requests or CI jobs were involved in this verification.
## Windows/macOS release preparation and acceptance audit, 2026-10-26

The new Rust `aura-release` tool prepares a fresh local stage from four explicitly named artifact roles. It streams bounded files, verifies Tauri prehashed signatures and the signed app version, and emits deterministic updater metadata, website download data and SHA-256 checksums for the same copied bytes. It rejects incomplete target sets, unsafe filenames, input links, incorrect signatures, changed staged metadata and reused output directories. Failed stages remain marked incomplete. It never signs, uploads, deletes old stages, reads credentials or claims platform signing or architecture qualification. Its only committed key/signature material is a synthetic test fixture.

The desktop now has a compile-time stable/staging update channel. The endpoint and accepted package prefix are fixed for each channel, with crossing rejected. Staging builds identify themselves in Settings and startup version diagnostics; unknown channel values fail the build. The normal website catalog remains empty and unpublished. An explicit `AURACODE_RELEASE_STAGE` selects a locally verified stage at build time. Download links, architecture labels, version, notes and checksums are prerendered, including a visible staging label. Catalog types and desktop bindings were generated from Rust.

Nine release-tool tests passed on Windows, together with all six native updater tests, exact desktop binding export, release-tool and desktop Clippy, desktop/site typechecks, five build-environment tests and two static website tests. Chromium and WebKit passed a synthetic released-catalog build with JavaScript disabled, all three architecture links, checksums, escaped release notes, mobile overflow checks and rejection of a tampered stage. The rendered dark download page was inspected. The existing settings browser gate now includes explicit steering and reviewed missing-transcript recovery; both engines passed the complete gate, including staging labeling and accessibility. No hosted CI, push, paid prompt, signing operation, real installer, credential access or publication occurred.

`docs/releases.md` records exact final source checks, native smoke commands, target-specific bundle commands, the staged upgrade procedure and the required evidence. Signing identities, protected updater-key backup, the dedicated release route, actual architecture-specific installation and visible-desktop power/privacy checks remain external acceptance prerequisites. General project terminal/editor controls, reviewed non-Git initialization and extra-folder forwarding are tracked as remaining source work, not owner blockers. Native signed-release qualification and M2-M5 product acceptance remain pending.

### Device-local additional project folder context
Native Claude sessions now receive available additional project folders through their supported
add-dir arguments. Unsupported drivers receive only the primary folder, with an explicit notice.
A read-only command and chat-details view show the exact context passed to the live generation,
or the next-start preflight; paths never enter SessionUpdated events or encrypted transcript sync.
The live folder set stays fixed until restart. Missing device mappings, unavailable paths and bounded
scope limits remain visible. Isolated sessions exclude the original checkout, overlapping paths and
its Git repository family. All passed folders participate in mutation admission until owned cleanup.
ACP no longer advertises an additional-directories extension that its request adapter does not send.

Three focused core regressions passed, including actual setup forwarding through a synthetic driver,
current-generation stability, unsupported behavior and real temporary Git isolation. Two UI rendering
checks and desktop TypeScript checking passed. The ordinary combined Windows native command build and
exact binding export also passed. Source-only CSS specificity warnings remain unchanged; final full
Windows/macOS checks, native visuals and packaging acceptance remain pending. No real agent prompt or
user repository operation occurred.
# Account transition storage checkpoint

Added the strict nonsecret transaction locator with exclusive same-data-root lease and complete-file
publication, plus a dedicated encrypted transition store and per-transaction bounded apply journals.
Account close invalidates the stores and journal handles. Five pure transition regressions pass after
tightening phase validation. Native locator/store tests are added but could not run: Application
Control blocked num-traits and libsqlite3-sys build scripts with error 4551. Desktop switch and typed
startup recovery wiring remain pending; no real configuration, credentials or agents were accessed.

### Independent release verification trust
Release verification now requires the updater public key from trusted release configuration, instead
of accepting the mutable staged plan as its own trust anchor. The CLI and website build fail without
that independent pin. Artifact handles also refuse leaf links atomically during open. All ten release
regressions and all-target Clippy passed. Chromium and WebKit verified the synthetic download stage,
including all architecture links without JavaScript and rejection of changed staged bytes. No real
signing key, installer, publication or hosted CI job was involved.
Normal quit now also takes the existing profile-transition mutex before draining owned work, and
LiveAgents refuses a drain while an idle barrier is held. This prevents closing storage during a
profile switch or update preparation. The existing quiesce regression now asserts drain refusal;
native execution remains blocked by the dependency build-script policy failure described above.

The native profile coordinator now captures outgoing managed settings, restores baselines and
applies incoming settings before pointer publication. A to B switches pass through a quiescent
Local phase, keeping each transaction encrypted only by its owning Account. Failure in phase two
publishes the actual Local selection and an explanatory notice. Typed startup recovery blocks both
desktop commands and direct native agent starts. Explicit recovery verifies the strict locator and
encrypted transaction before rollback or finish verification. Ambiguous pointers are preserved,
not silently repaired to Local. Five additional native regression cases are present but not yet
executed under the local build-script policy block. Exact Tauri bindings and recovery UI integration
remain pending; the M9 transition feature is not claimed complete.

The separate dark ConfigurationRecovery screen is ready for App integration. Two component tests,
Biome and Chromium/WebKit browser checks pass, including axe, explicit action only, retained errors,
locked-account disablement and unavailable-record refusal. Its rendered screenshot was checked
against the current Orbit frame. Integrated Windows native build/export passed. The first focused
profile run passed 12/13; the stale A-to-B failure assertion is corrected to require Local fallback
and invalidation while preserving A's encrypted receipt/head for reopen. Parent will rerun the native
case and wire the screen before the final combined gate. No real configuration or account was used.

### Admitted remote history and Continue here

Staged encrypted turns now publish through the chat actor after earlier writes finish and only when
no native session, queued prompt, steering or chat mutation is active. Publication validates the full
piece chain, remaps event sequences, imports authenticated attachments into encrypted storage, and
commits visible rows atomically. Missing ancestors defer publication. Offline sibling continuations
retain both branches and add a visible fork notice. Fair selection keeps busy chats from starving
other incoming history. Existing attached views receive a sequence gap and reattach to durable history.

New remote history invalidates earlier handoff reviews. Continue here previews a bounded visible
handoff, preserves the saved native session, and starts a fresh session only with the next user prompt.
Neither applying a review nor importing a turn sends an agent prompt. The actor rejects ordinary
start/send until that handoff has been reviewed. Unknown event JSON and accepted steering remain in
the imported transcript; device folder mappings and native session IDs are never copied.

Seven focused transcript tests and the Account actor handoff regression passed on Windows, including
authenticated malformed-data rollback, missing-parent deferral, branch union, encrypted image transfer,
busy-session deferral, view reconciliation and stale-review rejection. Account-feature all-target
Clippy, default core compilation and ordinary native TypeScript export passed. Only the generated
conversation declarations were retained because this isolated branch lacks newer installer/clone/setup
commands already exported by the integrated branch. Pinned pnpm typecheck still reports its existing
AppInfo fixture and steering reducer gaps; it reports no new conversation errors. Root integration owns
the scheduler admission hook and Continue here UI. Explicit Local import, folder resolution, macOS and
complete M7 acceptance remain pending. No real account request or vendor prompt was used.
## Reviewed Git initialization checkpoint, 2026-10-26

The Git workspace dialog now offers explicit initialization for a non-Git folder. Review shows the canonical folder and initial branch with a one-use, expiring token. Confirmation rechecks the folder identity and refuses existing metadata, ancestor repositories, private agent roots and live folder ownership. Git generates metadata only in an owned temporary directory; publication creates a fresh `.git` through pinned no-follow directory handles. Working files remain unchanged, no index or first commit is created, and interrupted publication retains its incomplete marker for review. Profile admission and the folder reservation survive canceled IPC until the owned operation finishes.

Five owned-temporary-directory service regressions and the live-folder admission regression passed on Windows. Core and desktop all-target Clippy, exact native binding export, TypeScript, Biome and instruction parity passed. Chromium and WebKit verified stop-before-review, cancellation, explicit confirmation, first-commit isolation refusal and a consumed stale review. The existing Git, relocation, recovery and pull request browser flows remain passing. The action error now survives a failed inspection refresh. No user repository was initialized, and no remote CI or paid agent was used. General project terminal/editor controls and native Windows/macOS acceptance remain pending.

### Remote history desktop integration
Successful Account exchanges now reconcile staged turns under current-profile admission before
announcing completion, preserving the existing managed-configuration hook. Actual imported batches
schedule another coalesced cycle; busy chats return without spinning. Import failures remain staged
and produce a fixed visible error in both event and polled status without hiding network/revocation
states. A later successful reconciliation clears that error.

Chats with new remote history show Continue here, block composing until a visible handoff is reviewed,
and keep that handoff visible until the next user message. Existing fresh-session recovery stays
available. Both browser engines passed cancellation and confirmation without any native start or
prompt, verified the resulting usable composer and passed accessibility. The rendered dark screen
was inspected. The integrated Windows native build, all 13 focused profile tests, import-status
regression and exact binding export passed. Local import, folder resolution, the final platform gates
and complete M7 acceptance remain pending.
Account actions now retain profile-transition admission through owned completion, including vault
initialization, and profile selection resolves its key under the same lock. Recovery allows only
explicit existing-account access restoration; management actions remain refused and sync cannot
resume with a pending locator or another profile's account. Added two native regressions for that
policy and renderer-cancellation ownership, pending integrated execution. Recovery-only AccountPanel
suppresses management calls and controls and requires the matching profile before unlock activation.
Chromium and WebKit checks pass for correct/wrong account, existing-key recovery, first-key refusal
and zero management calls, alongside the prior configuration recovery coverage. No native auth ran.

### Recovery shell integration
The app now renders configuration recovery before locked-profile, setup or chat controls. Its access
panel targets the transaction's owning Account and restores only the selected profile or the pending
transaction. A Local workspace can restore the inactive owner's access without switching into it.
Ambiguous recovery offers no account or profile action. Native notices and startup errors remain
visible; failed actions do not reload away their explanation. The recovery-only fixture now satisfies
the full typed Account API without an unsafe partial cast.

Desktop TypeScript, Biome, all three native account-admission tests and both recovery browser engines
passed. The dark recovery screen was visually inspected. Earlier integrated profile checks passed all
13 cases. Final combined tests, native platform acceptance and real account recovery remain pending.

### Lost-key reset server checkpoint

The Rust API now has a reviewed reset for a freshly email-verified pending desktop device. Its
one-use receipt binds the session, device and previous key generation. Atomic confirmation increments
the generation, installs new opaque envelopes, revokes other access and removes prior cloud sync
references. R2 ciphertext remains tracked for existing garbage collection. Exact lost-response retries
cannot repeat deletion after the new generation has received data. This is destructive reset, not
recovery of plaintext whose key is lost; existing encrypted device profiles remain untouched.

Native and Wasm library checks and Clippy passed. Exact checked-in SQL executed successfully in
temporary Node SQLite databases for reset, other-account and R2 tracking preservation, stale admission,
retry safety and rollback. Five Rust regressions were added but their run was blocked by host Application
Control 4551 on the libsqlite3-sys build script. The compiled Worker runtime regression is added and
syntax-checked; it still needs execution with the next coherent Worker build. No service or migration
was deployed. Desktop reset UI, durable retry, passphrase vault selection and device-local removal
remain in progress; this does not complete account lifecycle acceptance.

### Explicit desktop passphrase storage checkpoint

Account settings now expose explicit creation and unlock of a bounded encrypted passphrase store.
The existing authenticated vault format stores the profile index and account bundles independently;
there is no OS credential enumeration or automatic migration. Its private app directory records the
selection, so startup with a locked or incomplete selection cannot silently fall back to native
credentials. Creation while native account services are already open reports that quitting and
reopening is required. Unlock and create retain transition admission through owned Rust completion.

Two temporary-directory vault regressions and aura-sync all-target Clippy passed, as did generated
Account DTOs, desktop TypeScript and Biome. Chromium and WebKit verify zero writes before explicit
confirmation, cancellation, wrong-passphrase preservation, unlock and the honest restart state;
accessibility passed and the dark screen was inspected. Native service tests for restart/unlock and
incomplete-choice admission are added, awaiting integrated native execution because this worktree's
SQLite build script remains blocked by Application Control. Full native command export is also
pending. Restoring bindings to existing encrypted profiles after keychain/index loss, durable client
reset and device-local removal remain in progress. No real secure store was opened by these checks.

### Review pending work before sign-out
Desktop sign-out now opens an explicit review with the last reported pending-change count, or an
honest unknown-count explanation. It states that encrypted local data stays and sync pauses. Cancel
keeps the account open; confirmation alone invokes sign-out, and failure stays visible in the review.
Chromium and WebKit passed unknown and nonzero-count review, cancellation, confirmation and
accessibility alongside the existing account/device flows. TypeScript and Biome passed. No account
request or credential operation ran during these synthetic checks.

### Readable export core checkpoint
The Rust profile writer can now produce a bounded Markdown snapshot of one saved conversation.
It joins message deltas within their original turns, preserves unsupported saved events in fenced
blocks, excludes other chats and labels attachment/blob and unsaved-draft limits explicitly. Source
and output limits fail without returning a partial export. Two focused Windows regressions passed
with Account encryption enabled. Native save-file publication and the visible export action are
still being implemented; the website's desktop export promise is not yet fully satisfied.


## Reviewed project terminal and editor controls, 2026-10-26

The chat header now opens Project tools for its saved native folder. A short-lived one-use review binds the chat, canonical folder identity, qualified shell executable and exact argv. Windows offers installed system PowerShell and Command Prompt with profile/autorun scripts disabled; macOS offers its standard Zsh and Bash without user startup files. The explicit Start button opens an owned PTY. General shells can run alongside agents; their nonexclusive folder-use guards block overlapping Git mutations and application/profile idle barriers until cleanup is confirmed. The page and ProfileLease remain owned through startup and cleanup, and output is ephemeral and bounded.

Detected standard installations of Cursor, Visual Studio Code and Insiders can receive a fixed, escaped folder URI. Detection reads only executable metadata. Cursor's installed application distribution declares its protocol and native file opener; no vendor configuration or credentials were inspected. The UI reports only an OS dispatch receipt, handles missing link handlers explicitly, and requires a fresh review after success or failure. Custom installations and unsupported folder paths remain manual. No editor was actually launched during development.

Quit now preserves project terminals until explicit confirmation. Cancel leaves them open; confirmation closes their owned processes and waits for the folder guards to release before storage closes. Unconfirmed cleanup keeps storage open and the folder protected with a specific message. Protected setup/vendor work retains the prior drain behavior. The ordinary quit host no longer tries to reacquire the transition mutex already held by its caller. Eleven focused core tests passed, including a real owned PTY child, shared agent/folder ownership, stale identity, page cleanup and quit preflight. Eight native quit-flow tests passed, including cancellation, cleanup failure and real-store closure under the held outer transition mutex. The native editor URI escaping test, exact generated bindings, core/desktop all-target Clippy, TypeScript, seven terminal/folder frontend tests, Biome and instruction parity passed. Chromium and WebKit passed review/cancel/start/close, stale review, missing editor-handler recovery, no automatic retry, accessibility and mobile overflow checks; rendered dark dialogs were inspected. Native macOS execution and final Windows/macOS visual/release acceptance remain pending. No real shell command, agent prompt, login, user repository mutation, remote push or CI dispatch occurred.

### Updater cleanup admission correction

Updater installation already retains the profile-transition, session-idle and terminal-idle barriers across cleanup and installation. Its quit wrapper now reuses those barriers instead of asking for ordinary drain admission, which correctly refuses an already-quiesced manager. The protected-work wait, refusal to discard drafts, storage flush and installer handoff remain unchanged. Both updater cleanup tests now model refused ordinary admission and pass; combined native Clippy passes. This fixes a source-level always-refused install path, not the still-pending signed-package upgrade acceptance.

### Explicit Local project import

An unlocked Account can now review selected Local projects and copy their chats, saved drafts and
attachments into encrypted storage. The inactive Local database is opened read-only under its owner
lock. A content revision binds the review to the copied rows; a changed source or identity collision
rolls back the whole selection. Schema 13 stores device-local import receipts, so repeating an import
does not overwrite subsequent Account edits. Portable metadata and its sealed outbox commit together.
The original Local database, vendor sessions and files remain intact.

Imported turns preserve source agents but no native-session identity or checkpoint reference. Existing
recovery closes unresolved approvals and retains unfinished responses as interrupted. Continue here is
required before a new prompt. Managed worktree ownership, queued prompts and protocol logs remain in
Local, with those boundaries stated in the review. Attachment reads reject links and changed hashes;
already missing files are counted explicitly. Source schema mismatches fail without migration/repair.
Owned apply tasks retain both profile and session admission through the actual writer result.

The new LocalImportPanel reads Local only after its review button, lets the user select projects and
shows repeat/missing-file outcomes. It uses dark Orbit controls and generated command DTOs. Account
screen wiring and browser acceptance remain with the integrated application. Five focused core tests,
the schema foreign-key check, ordinary native bindings export, desktop TypeScript and Biome checks
passed on Windows. Core and desktop all-target Clippy passed after a minimal existing profile-command
lint correction agreed with its owner. No real Local profile, vendor login, network request or paid
prompt was used. Remote folder resolution, macOS and complete M7 acceptance remain pending.

### Readable chat export and Local import entry points

Chat details now offers an explicit readable Markdown export. The review explains plaintext disclosure, saved-message scope, incomplete running turns and excluded attachment payloads. Rust reads a bounded writer-ordered snapshot and opens the native save dialog; the renderer never receives the conversation payload or supplies a filesystem path. A profile lease survives canceled IPC through final publication. Saving stages a synced temporary file beside the selected destination and publishes without replacing existing files. Canceling creates no export; failed publication removes temporary plaintext.

The unlocked active Account settings now mounts the Local project review keyed by profile ID. An explicit import refreshes both the workspace and chat list, with failures shown without automatically retrying the import. Focused native save/no-overwrite/cleanup tests, exact generated bindings, TypeScript and core/desktop all-target Clippy passed on Windows. Chromium and WebKit passed review, cancellation, selection, already-imported refusal, stale-review recovery, empty Local state, export success/cancel/error, accessibility and narrow viewport checks. The rendered dark dialogs were inspected. Both flows join the existing settings browser gate. Native macOS and complete release acceptance remain pending; no real user chat, profile or account was exported or imported.
### Deleted account detection checkpoint

Deletion now records short-lived receipts only for sessions that remain valid inside the guarded deletion transaction. Exact unexpired tokens retain client-kind and browser request checks before receiving `account_deleted`; unknown, expired and previously revoked tokens remain unauthorized. Cleanup removes expired receipts, and the privacy notice documents their minimal contents and maximum 30-day retention. The desktop client preserves its confirmed decryption key and a versioned durable Deleted state while clearing the session. No owner account or authentication service was contacted.

Three SQL deletion regressions and three client state/bundle/error regressions passed on Windows. The reviewed Keep as Local copy, UI wiring, generated bindings and integrated platform gates remain in progress.

### Compiled account deletion and website recovery

The current Rust Worker passes thirteen local D1/R2 runtime cases, including the lost-key reset and typed account-deletion paths. Deletion receipts identify only an exact still-valid session at deletion: unknown, previously revoked, expired and wrong-client tokens remain unauthorized. Browser mutations still require Origin and CSRF, the minimal receipt survives session cleanup, and its expiry removes the deletion signal. The deletion fixture now advances both receipt timestamps consistently with the database constraint.

The website now clears account controls and any open confirmation when the account is deleted, explains retained local work, and offers Open auracode, Download and fresh account creation. Chromium and WebKit passed the new deletion presentation and existing account flows with accessibility checks. A WebKit focus assertion now waits for the existing code-entry focus effect instead of observing between render and effect. Public installer signing is explicitly deferred by the owner; continue source, unsigned build and update-tooling work without treating missing signing identities as a current blocker. Live cloud website upload authorization and native acceptance remain separate pending work.

### Integrated passphrase storage verification

The integrated native Windows account service passes all five focused admission and vault tests, including explicit passphrase creation, reopening locked, wrong-password rejection and interrupted setup refusing OS-storage fallback. Full desktop and lightweight account DTO exports pass with both the new vault states and Deleted state retained; desktop TypeScript passes. The final manual CI gate now includes the isolated vault browser checks. README and release instructions reflect dark-only Windows/macOS scope, deliberate CI batches, the preview API's actual deployment state and the owner's signing deferral. No full final batch or release publication has run yet.
### Reviewed folder resolution on another device

Git folders can now search explicitly selected code roots for the same normalized origin. Roots live
only in the current device's keyed settings. Search visits at most three levels, 4096 directory entries
and 128 repositories within 20 seconds, skips hidden/linked directories and reports incomplete checks.
It never fetches, changes the index or reads vendor configuration. Locate reviews a chosen root, checks
the origin again after admission, and commits only this device's folder location with identity CAS.
Local-only copies require explicit review because their contents have no portable Git identity.

Owned mutations retain profile admission, stop new agent starts, reserve affected parked actors including
archived chats, and refresh their working directories from the committed writer response before release.
A different location with native history on this device is refused rather than silently reusing that
session in a new cwd. FolderResolver reuses the reviewed GitHub clone dialog with a fixed origin and
requires a separate mapping confirmation after clone completion. Other hosts remain available through
Locate. The integrated app still needs to mount the standalone component and refresh workspace context.

Four focused core tests passed with default and Account features on Windows. They cover device isolation,
stale mapping CAS, native-history refusal, parked actor refresh, bounded discovery and an origin swap with
an unchanged Git index. Ordinary native bindings export, core/desktop all-target Clippy, pinned pnpm
typecheck and Biome passed. Chromium and WebKit passed synthetic review, retry, saved-result refresh-error
and locked clone-origin checks. No real user folder, account request, vendor prompt or remote mutation
was used. Publish to GitHub for local-only folders, native macOS qualification and complete M7 acceptance
remain pending.

### Folder resolution in project settings

Project folder rows now offer Find on this device or Change location. The resolver is keyed by active profile and folder, uses the native picker, and refreshes committed workspace and chat summaries after mapping. Its review opens separately from the project form so Clone cannot submit project edits. Selected code roots, matching origin search, Locate and the existing reviewed Clone flow are available from that screen. The component has compact dark dialog spacing and wraps paths and actions on narrow windows.

Chromium and WebKit passed the integrated modal fixture's mapping, stale review, post-save refresh failure and fixed clone origin flows, plus accessibility and narrow-dialog overflow checks. Rendered narrow screenshots were inspected. TypeScript, Biome, workflow lint and instruction parity pass. This adds the resolver browser gate and screenshots to final manual CI; native platform and final combined acceptance are still pending. No user folder was remapped and no remote was cloned.

### Passphrase file-open hardening

Passphrase ciphertext and lock opens now request no-follow semantics atomically through directory handles, then validate the opened regular file. The ciphertext length is checked on that handle and its read remains bounded. This closes the former metadata-check/path-open race without reading any OS credential store. Five focused vault tests, the Windows regular-file refusal regression and aura-sync all-target Clippy passed. The additional symbolic-link assertions are Unix-only and remain for the final macOS gate.
### Reviewed Keep as Local preservation

A deleted Account with its matching workspace unlocked can now review and explicitly create a separate unencrypted Local copy. The one-use ten-minute review binds saved project/chat rows; changed reviews refuse before creating a destination. The owned writer operation retains profile, transition, terminal and session admission until it finishes. Existing Local and encrypted Account data remain intact. The allowlisted projection preserves archived chats, available referenced attachments and drafts, resets managed-worktree context, excludes native sessions/credentials/configuration/queued controls/checkpoints/logs, and recovers unfinished turns only in the destination. A later Open Local copy is separate from copying.

New profiles remain unpublished until copied data is synced and profile metadata is atomically linked without replacement. Pinned no-follow attachment/publication writes and verified Windows private access protect the destination. Missing attachments are counted; malformed data and copy limits preserve an explicitly identified partial plaintext folder without adding it to the profile list. Limits are visible in review: 1024 projects, 512 MiB of workspace rows, 4096 attachments and 512 MiB of decrypted attachment data. A cumulative regression proves the next blob is refused before writing when its size exceeds the remaining budget.

Seven focused encrypted-profile copy/recovery/publication tests passed on Windows, including the strengthened no-replace metadata test. Exact native binding export, core/desktop all-target Clippy, desktop TypeScript and Biome passed. Chromium and WebKit passed explicit consent, cancellation, stale/partial failures, no automatic retry, separate open failure, accessibility and mobile review checks; rendered dark dialogs were inspected. The deletion Worker wasm check passed. A later broader aura-sync run was blocked before execution by Windows Application Control4551; its three earlier focused deleted-state/bundle/error tests passed. No bypass or retry was attempted. Root owns the production AccountPanel mount and compiled Worker runtime verification; final Windows/macOS integration and real-account acceptance remain pending. No owner data, actual authentication, network mutation, paid prompt, remote push or CI dispatch occurred.

### Integrated Keep as Local gate

The combined native command export and desktop TypeScript pass with preservation, folder resolution, passphrase storage and readable export together. Chromium and WebKit pass the preservation fixture's explicit consent, cancellation, stale review, partial-copy reporting and separate Open Local copy recovery. The existing settings browser gate now includes those checks and screenshots using its owned development server. The account lifecycle coordinator is integrating the production Deleted-account entry point; that mount is not complete yet.
### Durable reset client checkpoint

The client now saves the exact reset request and unconfirmed new key in its encrypted version-3
bundle before dispatch. Versions 1 and 2 remain readable. Restart, request failure and fresh sign-in
retain that material; all key wrapping and recovery proofs use the reviewed next generation. A narrow
same-account cancellation endpoint arbitrates against commit before the client may discard an
unconfirmed key. A committed or ambiguous matching generation retains it for verification.

Core reset completion saves a detached old-profile binding before acknowledging the durable reset.
Existing encrypted profile files remain intact and cannot be reopened with the new generation's key.
Seventeen focused account tests pass, including four new restart/retry, cancellation, vault-failure and
fresh-sign-in regressions. Client all-target and Worker Wasm Clippy pass; the exact cancellation SQL
also passed temporary Node SQLite arbitration tests. Generated Account DTOs include Deleted and
reset types. Core fault-injection coverage for binding and acknowledgement failures is added, awaiting
integrated native execution with the blocked SQLite build noted above. Reset presentation, restored
profile binding after vault loss and device-local removal remain in progress; no live reset occurred.

### Agent discovery on focus

Returning to an unlocked app refreshes installed-agent discovery at most once per minute. Startup,
focus bursts and an in-flight refresh are coalesced, while running sessions retain their original
launch specifications. The native Windows cooldown/concurrency regression and rustfmt pass. This
also fixes the integrated reset-confirmation closure ownership required for native compilation.
Watching binary directories and selecting shadowed installations remain pending.

The owner requested Cloudflare MCP deployment. Its documented request interface can manage resources
and upload the Rust Worker, but cannot supply the separate bearer token required by Static Assets
uploads. The official direct-upload documentation confirms that requirement. Website publication
remains pending; no alternate authentication, new login request or live resource mutation was made.

### Account reset and Deleted preservation controls

- Added an explicit reset review that shows the affected encrypted record/blob/device counts, requires saving the new recovery key and typing `RESET SYNC`, and never begins a reset on mount.
- Saved uncertain reset requests expose exact retry and server-arbitrated cancellation. Confirmed server resets with unfinished local binding cleanup remain visible after restart.
- Deleted accounts now show retained workspace guidance and mount Keep as Local only for the matching active unlocked Account. Opening the panel does not copy data.
- Chromium and WebKit synthetic browser checks pass for review cancellation, confirmation failure, exact retry, pending cancellation, committed local completion and Deleted activation/mount boundaries. TypeScript, Biome and instruction parity pass. No live account, key, configuration or cloud data was used.
- Explicit existing-profile key rebinding and reviewed removal from this device remain in progress.

### Reviewed debug bundle

The chat menu can prepare an editable debug preview before an explicit clipboard copy. Native Rust
reads only that saved chat's newest owned protocol log, bounds discovery and the last MiB, refuses
linked log directories/files, omits partial or invalid records and redacts complete records again.
The preview discloses that messages, code and paths can remain. Nothing is uploaded or copied on mount.
It includes app/platform versions and preserves existing logs without accessing vendor configuration.

Focused redaction, path-scope and bounded-tail tests pass. Native command export, desktop TypeScript,
process/desktop all-target Clippy and both browser engines pass. Browser checks cover cancel, editable
copy, read/clipboard failure, accessibility and narrow layout; the rendered dialog was inspected.
The broad process test command passed the new tests but later hit Application Control4551 launching
an unrelated supervisor test binary with zero matching tests. It was not bypassed or retried. The
focused library run passed after adding the bounded-tail assertion. Final platform acceptance remains
pending. Integrated reset command bindings were also regenerated in this checkpoint.
### Explicit private repository publication

Mapped local-only folders now expose reviewed Publish to GitHub. Rust requires a regular Git root with
an existing commit, resolves the chosen user or organization through the user's GitHub CLI, and shows
the exact repository, private visibility, branch and commit before any remote mutation. Non-Git and
unborn repositories point to explicit initialization/commit work. No staging, automatic commits or
vendor credential reads are added. The implementation follows the official
[gh API command contract](https://cli.github.com/manual/gh_api) and
[GitHub repository endpoints](https://docs.github.com/en/rest/repos/repos).

Creation and push intent are saved before execution in a bounded recovery journal, encrypted for Account
profiles. Unknown create/push outcomes stop for a new review. Recovery checks the pinned repository ID,
private visibility and branch commit; a missing response never causes an automatic create retry or
branch overwrite. Git pushes only the reviewed commit with an absent-branch lease, verifies its effective
destination, and adds origin only after confirmation. The index and uncommitted files remain unchanged.
Portable folder identity updates use the reviewed folder ID and device path rather than creating a new
folder. Recovery drafts survive restart; no sign-in or GitHub read occurs merely by mounting the UI.

Focused Windows tests passed for HTTP status handling, uncertain creation/push recovery, identity and
visibility changes, native origin preservation, mixed index/worktree state, empty-repository guidance,
device mapping CAS and encrypted recovery with plaintext-layout refusal. The production push path was
also exercised against a disposable local bare repository: its absent-branch lease rejected a second
commit while preserving the first. Eleven matching Account-feature tests plus the added no-commit test,
ordinary native bindings export, core/desktop all-target Clippy, TypeScript and Biome passed. Chromium
and WebKit passed explicit review, private confirmation, uncertain-result retry, reopened journal and
post-publication refresh failure checks. No GitHub repository, remote branch, real login or paid agent
call was created during development. Integrated UI placement, native macOS qualification and complete
M7 acceptance remain pending.

### Integrated publishing and preview API update

The publication control is available through Change location for mapped Local folders. It now uses
the dark project dialog layout, including wrapping paths/commits and compact confirmation controls.
Native combined command export and TypeScript pass. Both browser engines pass publication recovery,
accessibility and narrow-dialog checks; screenshots were inspected. The accessibility run caught a
skipped heading level, which was corrected. Reset and publication checks join the final manual CI gate.

The compiled Worker passes all thirteen runtime cases, now including cross-account cancellation
isolation, cancellation winning before reset, cancellation after committed reset, and preserving newly
uploaded records on retry. Using the owner's requested Cloudflare connector, a fresh preview database
backup was downloaded and verified, migrations 0004/0005 were applied, and the tested Rust Worker was
deployed with platform secrets preserved. The migration ledger, zero-user count and foreign keys were
checked. Live preview health/configuration return 200/no-store, missing authentication returns 401 and
foreign Origin returns 403. Exact deployment and backup hashes are recorded in infra/README.md.
Website static upload and signed-in multi-device acceptance remain pending. No real sign-in, email,
account deletion/reset, GitHub publication or production data mutation occurred.
### Existing Account workspace binding recovery

- Added explicit selection of an existing Account profile after recovering its account key into a new secure store. Matching account, key generation and fingerprint are verified against the existing encrypted database before its binding is saved; missing/empty/wrong-key profiles are preserved and refused.
- Changed device registrations reissue queued envelopes with new sender clocks while retaining field clocks and ciphertext payload contents. Config records receive a matching encrypted header and fresh blob; old immutable blobs remain available to existing reviews and merge bases.
- Strict profile ownership, no-follow file opens, retained file identities and the native transition gate prevent restoring an open or mismatched recovery profile. Secure-store save failures remain retryable without discarding queued edits or cursors.
- Ten core Account tests and the config header/blob regression pass with SQLCipher, including reset binding failure recovery. Chromium and WebKit cover explicit workspace selection, wrong-key failure and retry. The native full command binding export remains an integrated gate.

## Reviewed project and folder removal checkpoint

- Added explicit one-use removal and restore reviews in Project settings and the removed-items list. Parent metadata tombstones hide affected chats without deleting files, Git worktrees, messages, drafts, attachments, native history or device folder mappings. Restoring retains archived chat states and independently removed child folders. The bounded list shows up to 1,000 projects and 1,000 folders, revealing older entries as items are restored.
- Apply retains the native profile lease in an owned task, takes organization/maintenance admission, reserves affected actors and canonical folders, flushes actor writes, and rechecks the reviewed membership and timestamps in the writer transaction. Active agents, queued prompts, pending steering and open project terminals prevent removal. Restore preserves held queues.
- Account parent tombstones use existing encrypted metadata capture. Shared dispatch/writer admission defers incoming removals across startup, active turns, background work and pending steering. Once committed, a workspace change notification holds queued prompts and stops idle harnesses; cached actors cannot send, restart, continue or dispatch until restoration. Deferred metadata is retried by ordinary sync work, without requiring a new remote edit.
- Core all-target check and Clippy with account-sync, rustfmt, instruction parity, and Chromium/WebKit review/cancel/stale-token/restore/parent-before-child/accessibility/narrow-layout fixtures passed locally. These fixtures test presentation with an injected API, not a native end-to-end removal. SQL/session/projection regressions compile, but Windows Application Control4551 blocked the core test executable before any tests ran. Native binding export was separately blocked before desktop source compilation by denied Tauri updater/dialog build scripts. Desktop typecheck currently reports missing generated removal bindings and their derived type errors. No security settings were changed, no real user item was removed, and no remote CI or native-agent invocation ran.
- Integration gates pending: generate exact desktop bindings, rerun desktop typecheck, execute the core workspace_removal and parent_tombstone tests, include the new check-workspace-removal.mjs fixture in final browser gates, and exercise actual native removal/restore on an owned disposable profile on Windows/macOS. Public signing and packaged release qualification remain separate pending acceptance.

### Rust client against the compiled cloud runtime

A new isolated contract test runs the actual Rust HTTPS client in its test-only loopback mode against
the compiled Rust Worker with disposable D1 and private R2 bindings. It registers synthetic Windows
and macOS devices, initializes a real account key/recovery envelope, requires approval for the second
device, unwraps that device's key, sends and decrypts records/blobs, checks retry/cursor/tombstone
behavior and confirms immediate revocation. The server never receives the plaintext record or blob.
The test performs no real sign-in, email, vendor credential access or deployed-cloud mutation.

All fourteen compiled Worker runtime cases pass, including the new Rust-client contract. The client
unit is ignored in ordinary Cargo runs and invoked explicitly by the existing Worker runtime gate,
which supplies only its own 127.0.0.1 endpoint and deterministic disposable session fixtures. This
adds cross-component evidence without changing the production client's HTTPS-only rule.
### Device-local executable selection

The Agents screen now lists discovered executable entries in environment-override and PATH order,
including broken entries and shadowed alternatives. Opening the picker explicitly probes versions;
mounting the screen never selects a binary. The user can pin a ready executable or restore the
environment default. Native transports retain their executable-only Windows policy; reviewed npm
packages still resolve through their package bin without interpreting shell shims.

Selections are provider-wide across alternate transports and saved atomically in auracode's local
`agent-executables.json`, separate from portable Account data and vendor configuration. A missing or
broken pinned executable refuses new starts. Corrupt preference data also fails closed. Changing a
choice invalidates stale probe generations but never changes an already prepared launch or owned
session. A file lock prevents lost updates between app processes. Refresh rechecks the exact chosen
entry, and the desktop observes bin-directory/file metadata and symlink/package-bin targets every
30 seconds; unchanged metadata does not launch probes. Existing throttled focus refresh remains.

Discovery is bounded to eight executable entries and 256 PATH directories, with visible truncation
and an additional saved choice when needed. Candidate version helpers retain their existing owned
process timeout/output limits, with at most four candidate probes in flight per picker. Metadata
polling can take up to one interval to notice changes; same-size replacements preserving all metadata
are still checked by explicit/focus refresh. No executable contents, credential stores or vendor
configuration files are scanned.

Focused Windows tests cover ordered discovery, override rules, bounds, metadata additions/removals,
in-place changes, durable selections, provider aliases, broken-first behavior, missing-selection
refusal, default reset, corrupt preferences and selection during an older in-flight probe. Existing
vendor maintenance regressions still pass. Exact native binding export, agents all-target Clippy,
desktop library Clippy, desktop TypeScript and Chromium/WebKit selection/retry/reset/accessibility
checks passed. The combined core all-target check exposed unrelated private key-restore calls in
the existing Account fixtures; the lifecycle owner supplied their separate correction. Native macOS qualification and
final integrated acceptance remain pending. No real agent, login, paid prompt, remote mutation,
push or CI dispatch was performed.

### Combined native and browser verification

The combined native command export and desktop TypeScript pass with executable selection, workspace
removal and recovered Account binding together. The removal fixture now returns the native command's
actual null result. Chromium and WebKit pass all three screens' review/retry/cancel/accessibility
checks. Their standalone gates and screenshots are included in the final manual CI batch.

The integrated SQLCipher core library suite executed all 492 tests: 490 passed, and two recovery
fixtures still assumed an old schema version/page layout. The unknown-version fixture now always uses
the current schema plus one, and damaged-schema checks include every table from current migrations.
All 25 focused salvage tests pass after those fixture corrections. Production salvage behavior was
unchanged. This broad run also exercised the new removal and Account rebind tests successfully; the
reviewed held-prompt acknowledgement follow-up and remaining lifecycle work still require integration.
### Removal dispatch acknowledgement follow-up

Independent review found a race where incoming removal could win after send admission but before dispatch. The prompt was safely saved as held, but its acknowledgement incorrectly claimed immediate delivery when checkpoints were disabled. Dispatch now reports its actual queued outcome and emits the normal queued lifecycle for this path. A deterministic test hook removes workspace admission at that exact boundary and checks the held queue, queued acknowledgement/lifecycle and absence of a driver prompt. Core all-target account-sync Clippy and instruction parity pass; native test execution remains pending after the earlier Application Control denial.
### Reviewed removal from this device

- Removal requires an explicit switch to Local with configuration recovery complete, then a one-use review, a data-loss acknowledgement and literal `REMOVE`. It erases only the selected mapped Account profile and auracode's account/device bundle. The review reports unknown pending sync changes honestly, counts other mapped profiles, and explains that other isolated data roots retain files but lose access to the shared bundle. Cloud data and other running sessions are not revoked.
- An encrypted secure-store receipt is saved before staging the app profile. Pinned no-follow directories, strict profile ownership and rechecks protect publication and bounded deletion. Interrupted file, key or index acknowledgements retain a resumable receipt; cancellation is accepted only while original files remain unstaged. The owned native operation holds profile, transition, session and terminal admission through completion.
- Fifteen core Account tests and the maximum-vault-size regression pass on Windows, including staged-content changes, active profile locks, receipt-save refusal and failures after staging/key erasure. Workspace rebind now refuses a future database schema before writing. Desktop all-target Clippy and exact native binding export pass. Chromium and WebKit pass explicit Local admission, no mount actions, destructive review, cancellation, failed removal and completion, with accessibility checks; rendered dark dialogs were inspected. No real profile, credential store, cloud record or vendor configuration was modified. Final combined Windows/macOS checks remain pending.

### Codex startup model recovery

Codex can reject a saved or project-selected model before opening a thread. An absent catalog entry is not proof of removal because configured provider aliases can be valid. After an explicit open RPC error and a complete model list with exactly one advertised default, auracode now shows the actual error and an always-ask choice to retry opening once with that default. Successful custom aliases are preserved. Authentication errors and incomplete, empty or ambiguous catalogs do not trigger the choice. This follows the pinned Codex 0.162.1 thread processor's explicit model override behavior: https://raw.githubusercontent.com/openai/codex/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs .

Cancel retains the original selection and thread. Acceptance retries only thread/start or the same thread/resume, leaves visible prompts queued, resets incompatible effort, and persists the effective selection only after successful Ready. It never retries a prompt or asserts that a generic error proves a removed model. The choice remains interactive under Full auto and does not expire while the user is deciding; Stop withdraws it.

Added owned fake-protocol regressions for fresh/resumed startup, paginated metadata, no automatic action, custom aliases, cancellation, failed retry, authentication/catalog failures, stale/duplicate answers and Stop. Core regressions cover always-ask behavior, successful model persistence, and retaining the project model plus queued text after failure. Core all-target account-sync Clippy and formatting pass. Windows Application Control4551 blocked serde_core, serde_json and num-traits test build scripts before driver tests ran; the earlier core test executable denial also remains an execution gate. No policy change, paid prompt, user configuration read, remote CI or public protocol/binding change occurred. Final integration must execute these focused tests and verify the existing native pre-Ready question UI on an owned profile.
### Preserve config edit ordering through device recovery

Independent review found that reissuing an old queued config edit with the recovered device's sender clock could make it appear newer than a later edit from another device. Rebinding now preserves the encrypted content revision and immutable blob while resealing only the outer sender envelope. Config acceptance compares content revisions, and reissues the winning content under the current sender when an authoritative stale-content head has a later transport clock. Existing merge bases and pending reviews retain their exact revision and blob identity.

All 42 core sync tests and account-sync all-target Clippy pass on Windows. New regressions cover a later remote edit after rebind, reverse convergence against stale content with a later transport clock, current-device sender validation and acknowledgement queue drain. No server schema, API DTO, actual account or credential store changed. This supersedes the earlier rebind checkpoint's fresh-config-blob behavior.
### Active workspace identity and cached sync status

The main sidebar now names the active Local or Account profile instead of always claiming Local.
Account profiles show their native cached sync state and pending count; Local profiles do not call
the account service or register sync listeners. The new getter reads only the published runtime,
without opening a vault, authenticating or triggering network work. Settings remains the existing
entry point for profile and sync controls. Subscription cleanup, profile IDs and live-event precedence
prevent a delayed cache response or retired profile event from changing the current workspace label.

Ten focused frontend tests, exact native binding export, desktop library Clippy, TypeScript, Biome
and instruction parity passed. Chromium and WebKit passed Local/Account/paused states, settings
navigation, delayed-response/profile-switch cases, accessibility and narrow layout; dark screenshots
were inspected. Exact export also includes the previously integrated rebind/removal commands and the
removal fixture's existing null-result correction. No real account, credential store, agent or network
service was accessed. Native platform acceptance remains part of the final combined gate.

### Chat sign-in recovery

An authentication-required chat now offers the existing vendor terminal sheet when the detected
installation advertises a reviewed login command. Opening the card or sheet does not start a process;
the sheet retains its separate Start sign-in action. Driver-supplied commands remain display/copy
only, while Rust independently selects and rechecks the installed executable. A completed or failed
login leaves Retry explicit so held prompts are not sent automatically. Unsupported installations
and failed metadata lookups retain manual command instructions and Retry. Retired metadata responses
cannot enable sign-in for a different agent.

Twenty-four focused card/terminal tests, desktop TypeScript, Biome and instruction parity passed.
Chromium and WebKit passed explicit launch, cancellation, success/failure, Retry, unsupported/manual
fallback and stale lookup cases with synthetic terminal IO. Accessibility checks and inspected dark
desktop/narrow screenshots passed. No vendor login, credential store, account service or paid prompt
was used. Native sign-in acceptance remains in the final platform gate.

### Pending questions remain beside the composer

Unanswered, actionable UI questions now share the permission dock while the session has a process, including pre-Ready startup recovery. Each request shows whether it belongs to a turn or the session; turn requests include a bounded prompt label. The transcript keeps the resolved history and informational notifications, but does not duplicate a docked question. The existing response path owns pending, failure and withdrawal state. A hidden composer keeps its draft while the user answers.

Chromium and WebKit fixtures passed keyboard selection/submission, no automatic answer in Full auto, pre-Ready questions, pending/error/retry, agent withdrawal, reattachment, mixed permission/question requests, notification-only behavior, preserved drafts, accessibility and the 390px layout. Screenshots were inspected. Forty-nine related frontend tests, TypeScript, targeted Biome and instruction parity pass. The question fixture joins the existing final settings browser gate. These are production-component fixtures with an owned synthetic transport, not paid-agent or packaged native acceptance.

### Codex recovery answer lifecycle

- Corrected Codex startup-model recovery so a submitted answer does not also emit a withdrawal. Core already resolves the answer; the extra withdrawal produced a false notice that the answer did not reach the agent.
- The real driver regression covers accepting the offered default and cancelling the recovery without withdrawal. Stop still withdraws its unanswered card, closes the owned process, and preserves queued user work through the existing core contract.
- Validation: six focused native Codex recovery driver tests and both core startup recovery tests passed; aura-drivers all-target Clippy with replay/testing passed. No real agent or paid prompt ran.
### Informational notifications do not request attention

Chat activity now excludes Notify prompts from waiting status, matching the actionable request dock. Notifications remain in the transcript without an answer or resolution. A regression covers a notification beside running tool output, an actionable question taking attention, and the answered question restoring tool activity while the notification stays unresolved. All seven activity tests, desktop TypeScript, targeted Biome and instruction parity pass. No native agent call or CI run was performed.

### Website links and Account onboarding

The packaged Windows/macOS app now receives `auracode://signin` links through Tauri's native
deep-link and single-instance plugins. Rust accepts only bounded Account navigation with an optional
email hint. It rejects other actions, extra query keys, credentials, ports and fragments. A latest
pending request survives webview reload until the matching acknowledgement; old acknowledgements
cannot erase a newer request. Development does not register or replace OS URL associations.

The UI defers navigation through loading, locked profiles, configuration recovery, profile switching
and open dialogs. Links open Account without authenticating, sending a code or changing the selected
account. Repeated links preserve an inline code challenge, recovery key and unsent email. Onboarding
now offers the real Account screen and returns to its saved setup step. Ordinary settings shortcuts
still return to chats. Independent review caught and corrected early consumption across recovery
reloads and unwanted Account remounts before this checkpoint.

The integrated desktop native library passed all 201 tests, including URL rejection, stale
acknowledgements, packaged configuration and exact command binding export. All-target desktop Clippy,
TypeScript and 348 frontend tests pass (19 existing cases skipped). Chromium and WebKit passed the
combined settings/account/configuration/continuation/question flows, including preservation across
repeated Account navigation, and the onboarding return path. An earlier compiled native test binary
was blocked by Application Control4551; ordinary verification after subsequent source integration
ran successfully. No policy, binary relocation or security bypass was used. Actual installed OS URL
activation remains in packaged acceptance.

Cloudflare MCP also confirmed Universal SSL enabled and an active Let's Encrypt certificate covering
`auracode.si` and `*.auracode.si`, expiring 2027-01-22 with Cloudflare-managed renewal. The owner does
not need to purchase an SSL certificate from the domain registrar.
### Rust website code-deployment checkpoint

- Added `apps/web-worker`, a separate Rust Worker that embeds the existing prerendered public website at build time. It uses ordinary Worker code modules without an Assets binding or upload, API/database access, secrets or outbound subrequests. The website rendering pipeline and assets-only alternative remain intact.
- The response path preserves generated CSP/header policies, including the Tauri verification-page framing exception, auth no-store on every route alias, correct MIME, immutable Vite assets, revalidated stable files, HEAD and conditional ETags. Missing pages/assets and API paths never become a homepage fallback. Internal build files, unsupported paths/types, symlinks and encoded traversal are excluded or refused.
- Validation: eight Rust unit tests, native all-target and Wasm Clippy, five compiled Miniflare cases checking every public byte and all nine page aliases, both existing static website tests, Biome and instruction parity pass. The compiled deployment modules measured 20,473 bytes JavaScript plus 985,588 bytes Wasm on this source. Root must rebuild from the final integrated website, then verify live route precedence/TLS/headers before publication.
- No cloud mutation, denied upload retry, credential access or actual account/auth operation occurred. Live email/Turnstile, cross-device acceptance, landing performance and production publication remain pending. CI integration is coordinated separately with its owner.
### External Windows WebDriver gate source

A separate W3C WebDriver harness now drives the actual embedded desktop binary through pinned tauri-driver 2.1.0 and a qualified Microsoft EdgeDriver. It uses a fresh disposable profile, home, WebView data and project. Only initial project creation uses native IPC to avoid the system folder picker. External window selection, ordinary onboarding skip, mock chat creation, key entry, visible echo output, interruption, explicit session stop and retained history after webview reload are independently checked. No embedded smoke verdict is used. Version matching, bounded requests/evidence, a watchdog and the driver's owned Windows Job Object constrain the run. Workflow provisioning is a separate coordinated change.

Eight synthetic harness tests pass, including real loopback W3C request handling, malformed/error responses, polling expiry, runtime mismatch, profile/configuration isolation, optional window-resize capability and the external scenario's command boundary. Targeted Biome and instruction parity pass. These tests do not establish a native WebDriver pass. Local native execution was deliberately not attempted because Application Control already blocks the executable; the actual Windows gate remains pending in the planned final integration batch. No paid agent, authentication, CI dispatch or owner configuration mutation occurred.
### Final acceptance workflow audit

The final CI now runs the previously unwired installer/clone, active-profile status and chat sign-in
browser checks, with their screenshots retained. Onboarding was already covered; the settings
aggregator already runs account/profile/configuration, Git/setup, steering, questions and continuation
checks. Browser steps have explicit deadlines. A local regression checks every desktop acceptance
script is reachable from the workflow, the existing SQLCipher feature chain, and unsigned Build's
exact Rust-binding check and absence of signing-secret requirements. Existing suite flags and the
explicit final encrypted-storage input are preserved.

Windows external WebDriver acceptance is wired into the existing native job after app compilation.
Provisioning pins tauri-driver 2.1.0, reads documented WebView2 runtime version metadata, downloads
the exact matching Microsoft driver, validates its signature/version and retains version/hash evidence.
It never updates the installed runtime or substitutes the Edge browser version. New pure provisioning
tests cover ambiguous/malformed versions, compatible patch versions, exact bounded archive extraction
and overwrite refusal without downloading or executing native tools. The final runtime batch also
includes the new Rust static website Worker beside the existing API Worker.

Five local workflow regressions, pure PowerShell provisioning checks, existing binding-export gate
regressions, pinned-action workflow lint, Biome and instruction parity pass. The newly wired installer
and clone review gate passed Chromium and WebKit with synthetic IO and accessibility checks. Actual
external Windows WebDriver, package compilation and native device acceptance are still pending the
final qualified run. No CI dispatch, push, runtime installation, paid agent or real sign-in occurred.

### Onboarding map label bounds

- Kept the existing dark Orbit map and satellite positions; label plates now stay inside the panel and use the nearest vertical space clear of other labels and satellites. This prevents the native catalog order from clipping Claude or overlapping OpenCode V1 and Pi.
- Aligned the browser setup fixture with the native primary catalog order and OpenCode V1 name. The existing setup browser check now checks label bounds/separation and captures both 1440x900 and 1024x768 map layouts.
- Visually inspected the updated Chromium and WebKit screenshots. Both complete setup browser checks, shared UI typecheck, Biome and instruction parity passed. No native commands, CI or vendor actions ran.

### Live preview and native Windows inspection

The tested Rust website Worker is now deployed through Cloudflare MCP at
`https://preview.auracode.si`, with a catch-all route below the existing API-specific route. All 48
public files matched their tested local bytes over live TLS. Nine page HEAD responses, auth cache
rules, CSP, a missing asset and API precedence passed. Artifact hashes, deployment and route IDs
are recorded in `infra/README.md`. The Static Assets endpoint was not retried.

The integrated Windows desktop built successfully with embedded frontend assets. An isolated fresh
profile opened the actual native onboarding and chat workspace, detected the existing agent
installations and displayed Local correctly. No vendor session, login or paid prompt was started.
Visual inspection found the map label defect fixed in the preceding checkpoint. The disposable
review instance was closed and its owned background process stopped; this inspection is not a
substitute for the external WebDriver conversation gate or installed-package acceptance.

### Native smoke checkpoint path correction

The final native Codex smoke found that a long custom profile path could exceed Windows' legacy
Git path limit while writing an app-owned checkpoint reference. Auracode correctly held the prompt;
protocol evidence confirms no turn request reached the vendor. An isolated reproduction reported
`Filename too long`. Checkpoint Git commands now set `core.longpaths=true` for that command only,
without modifying user Git configuration or the working index. Independent review found no blocker.

A new Windows regression captures and reads a checkpoint whose reference exceeds 260 UTF-16 units.
It compiled, but Windows Application Control4551 blocked the unit-test executable before execution.
No policy change or binary workaround was attempted. Core all-target Clippy and rustfmt pass.
The ordinary application CLI rebuilt after the fix and the real installed Codex basic smoke passed
all seven checks from an equally long isolated profile: GPT-6-Luna, low effort, one `ok` response,
streaming, normal completion and turn-scoped usage. The earlier held prompt was cancelled by the
smoke cleanup and never retried automatically. Final CI and unsigned bundles must include this fix.

### Production Cloudflare API preparation

- Disabled and verified email-content previews on the existing Auracode sending domain. Downloaded/checksummed the empty production D1 export before applying migrations 0001 through 0005 with the preview-compatible tracker; all 35 statements succeeded, foreign keys are clean and user/session/device counts remain zero.
- Created a separate production Turnstile widget and wrote its new secret plus a fresh 32-byte authentication HMAC directly into the production Worker secret bindings without returning or logging values. Uploaded the exact previously tested Rust API module bytes, verified production resource/origin/sender bindings, private R2, disabled development/preview endpoints and the five-minute cleanup schedule.
- Production public API routing remains inactive pending root's source-gate confirmation. Root owns apex DNS and website activation. No emails, account authentication, user data, credential reads or billing changes were involved. Live auth/device acceptance and operator/legal/retention review remain unverified; details and nonsecret identifiers are in infra/README.md.

### Final CI macOS runner availability

Final run `40380825667` at `4b9a91c` completed Windows PowerShell and encrypted-storage tests and
Clippy successfully. Its three macOS jobs were cancelled before acquiring a runner, with GitHub
reporting hosted arm64 capacity constraints. This supplies no macOS acceptance evidence and is not
a product-source failure. The standard Windows job is still running as this checkpoint is written.

CI now explicitly selects the supported `macos-26-intel` pool for macOS checks, including frontend
browsers, Rust, encrypted storage and binding parity. GitHub's
[macOS 26 general-availability announcement](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)
and [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
identify this as the standard x64 runner. All gates, features and deadlines remain unchanged. The
unsigned Build workflow retains its existing host and universal macOS target. Intel CI execution
does not replace Apple Silicon device acceptance. Local workflow regressions, workflow lint, Biome
and instruction parity pass; no workflow was dispatched, cancelled or rerun for this change.

### Public website and HTTPS

The tested dark website is live at `https://auracode.si` through its independent Rust Worker.
All 48 public files match the local build; nine HEAD routes, CSP/cache headers and missing-asset
handling pass. HTTP redirects to HTTPS preserve paths and queries. The production API remains
unrouted and returns 404; no account or installer availability is claimed. Resource and deployment
IDs are recorded in `infra/README.md`. The live landing, preview download and preview sign-in screens
were visually inspected. Preview Turnstile loaded without submitting an email or completing a
manual challenge; its third-party console diagnostics are not evidence of delivery acceptance.

The real installed Claude Code basic smoke also passed seven checks using Haiku at low effort and
one `ok` response. Hermes rejected the historical `nous/welcome` choice before any prompt because
its current catalog no longer offers it; its catalog also exposes no effort option. With the
advertised `openai-codex:gpt-6-luna` choice and no unsupported effort override, its single-response
smoke passed all six checks, including streamed `ok`, normal completion and session-scoped usage.
Only those three minimal real responses were sent. Final package and CI results remain pending.

### Invite-only cloud access and open-source preparation

The owner changed hosted accounts and transfer/sync to an invite-only private preview, with the
allowed addresses held in Cloudflare secret configuration. The local desktop stays free and works
without an account. Payment and subscription implementation are explicitly deferred. Rust API
enforcement and corresponding website/desktop states are being implemented; no frontend-only
allowlist or hardcoded invitation address is acceptable.

The owner also requested an open-source repository, with a license discussion before publication.
The repository remains private and its existing license is unchanged. Root AGENTS.md and CLAUDE.md
are now untracked and ignored while retained locally with identical bytes. The parity gate accepts
a checkout containing neither file, but still rejects a missing counterpart or any byte drift.
All six checker tests pass. A separate tracked-history and publication audit is underway because
ignoring a file does not remove it from past commits. No remote history or repository visibility
was changed.

### Invitation enforcement and publication review

The Rust API now enforces a bounded secret-backed invitation list for cloud access. Unknown excluded
addresses cannot start account creation, and verification rechecks membership. Device, key, reset,
record and blob routes check current eligibility even for an existing approved-device token. Missing
or malformed configuration fails closed. Removed invitees retain authenticated account inspection,
encrypted export, logout and freshly verified deletion. Verification cannot recreate a deleted,
excluded account through a race. A real local email binding exposed a missing Message-ID; composed
messages now include a random Message-ID and Date, and local invited delivery succeeds.

Desktop and website explain the private preview without adding billing or publishing membership.
The Rust client retains the session and local encryption key on invitation denial and pauses sync
until an explicit refresh. It now also recognizes the API's bounded account-deleted response.
Generated bindings are updated. Focused API, client, scheduler, browser and accessibility checks
passed in the implementation worktrees; integrated deployment and final CI remain pending.

The owner explicitly deferred license selection for further discussion. A bounded publication audit
of reachable history found credential-shaped matches only in synthetic fixtures or a UI false
positive, but this is not an exhaustive secret guarantee. Private instructions and planning notes
remain in history, and the raw plan contains personal contact details. The recommended publication
path is a reviewed sanitized snapshot with fresh public history after a license decision, preserving
this repository privately. No export, history rewrite, repository visibility or project license
change has been authorized or performed. Third-party font and dependency notices are being prepared
separately from the project's own license.

### Website performance and injected analytics

The initial live PageSpeed laboratory report measured mobile performance 95, accessibility 100,
best practices 92 and SEO 100, with LCP 2.551s on the emulated slow 4G profile. Desktop performance 100
had LCP 0.562s, with the same other category scores. This is laboratory evidence, not field data or
native desktop performance acceptance. The [baseline report](https://pagespeed.web.dev/analysis/https-auracode-si/hnq3mjyvfp?form_factor=desktop)
predates the responsive WebP sources and must be remeasured after the integrated website deployment.

The best-practices issue was Cloudflare-injected analytics blocked by the site's strict CSP. A
host-scoped Cloudflare configuration rule now disables that injection on the apex and preview only;
an HTML fetch confirms the beacon is absent. The CSP was not weakened. Responsive product screenshot
variants are now wired into the website, reducing the small-screen image from 70,006 to 6,662 bytes at
480px while preserving larger variants for larger displays. No CI run was dispatched for these edits.

### Claude Code handoff checkpoint

The owner requested a handoff to Claude Code before final acceptance. Private continuation details
are saved locally in ignored `HANDOFF.private.md`, referenced by the identical local instruction
files. Use this integrated worktree and branch, not the older main checkout. No project license,
publication visibility, PR, merge or signing decision was made.

Root rebuilt the invitation API and all 23 compiled runtime tests passed. Both API environments now
contain those exact modules and the private membership secret. Live preview denies an excluded
address before creating any challenge; its user/session/challenge counts remain zero. Production
API is staged but still unrouted. Both live websites still predate the newest invitation UI/assets.
Deployment identifiers and hashes are recorded in infra/README.md. No real sign-in email was sent.

Independent review found and fixed mounted desktop invitation recovery and website management
during a device-service outage. The focused desktop/web typechecks and Chromium/WebKit suites,
including accessibility checks, pass. Those reviewed fixes are integrated locally. The three real
agent smoke runs' recorded owned process IDs are no longer running.

Old-head CI 40380825667 completed with Windows test and Edge Driver preparation failures; macOS
jobs were cancelled before runner acquisition. Concrete replay-golden and driver-banner fixes are
integrated as 0039870 after focused replay/provisioning checks passed. The identity-save regression's
second Ready wait after restart remains unresolved. Its tentative timing-only diff is preserved in
the separate Windows-fix worktree and was not integrated; the owned test process was stopped. This
is not a completed final verification. Old-head unsigned Build
40380831571 passed universal macOS and Windows ARM64; Windows x64 was still running at handoff.

Third-party notice work is checkpointed separately as 60b3413 on codex/third-party-notices, with a
clean worktree, four focused tests and inventory integrity checks passing. It is not integrated
into this branch yet. The conservative source inventory and Vite hooks still require full builds,
discoverable notices UI and artifact/native redistribution review. The project license remains
unchanged. All parallel agents have stopped at the owner's handoff request.

### Claude Code continuation: notices, identity regression and Worker tests

The third-party notices checkpoint is integrated. Its input hashes were refreshed after the
invitation commits changed `apps/api/package.json`; the 414 runtime records and license texts were
unchanged. The website footer now links `/third-party-notices`, served as a prerendered directory
index that the Rust website Worker accepts, with the same `frame-ancestors 'none'` policy as other
public pages. Desktop Settings, About, Third-party notices opens the same text in a dialog. It loads
a lazy `virtual:third-party-notices` chunk because the desktop CSP permits no same-origin fetch.
Chromium and WebKit checks cover the dialog with Axe, keyboard scrolling and Escape. The root test
script now runs the notice tests, so a dependency change without a reviewed refresh fails.
Installer and deployed-artifact inspection and WebView2Loader redistribution review remain open.

The stalled identity regression was stale test ordering, not a dispatch bypass. Restart prepares
project folders with a FIFO read through the chat store writer. That read waits behind the identity
write while SQLite's busy wait runs, so the new generation cannot become Ready until the write
resolves. The test waited for Ready while still holding the lock and hung until its patience limit.
It now asserts that, inside the busy wait, the restart neither becomes Ready nor dispatches and the
stored identity is unchanged; after release the identity commits, the restart resumes the native
session and the prompt is sent. It passed three consecutive local Windows runs. The tentative timing
edit in the separate Windows-fix worktree is superseded and was not integrated.

The website Worker runtime test predated the WebP screenshot variants and failed on their MIME type.
It now covers WebP, the notice text file and the notices page. Local full `pnpm check`, the rebuilt
website Worker's five runtime tests, eight native unit tests and native/Wasm Clippy pass. The new
website Worker modules are 20,473 bytes JS (unchanged glue, SHA-256 `7fea5f5a…`) and 1,107,745 bytes
Wasm (SHA-256 `e926c1c6…`). They are not deployed: this session's Cloudflare connector is authorized
for a different account and has no upload operation. Both live websites still serve the earlier build.
API source is unchanged since the staged invitation build, so its recorded artifacts remain current.

The long-checkpoint regression ran for the first time in this session (Application Control had
blocked its binary before) and failed. Git rejects a `GIT_DIR` longer than `PATH_MAX - 40` bytes,
220 on Windows, regardless of `core.longpaths`; the fixture's repository path itself crossed that.
Checkpoints now refuse such a repository before running Git, with a message pointing to
`AURACODE_DATA_DIR`, and leave the working folder untouched. The regression measures the deepest
profile Git accepts and still proves refs beyond 260 characters work. Default data folders are far
below the limit. The local full Rust run otherwise passed fmt, all-target Clippy and 1,843 tests;
Application Control blocked the `setup_bindings`, `auracode_api` and `demo_agent` test binaries, so
those rely on CI.

Security review of the pushed invitation gate found that sign-in initiation answered
`invite_required` before its per-IP limit and Turnstile verification, so invitation or account
membership could be probed without a bot check or throttle. Membership is now answered only after
the keyed per-IP limit and a verified single-use Turnstile token; email change follows the same
order. Excluded addresses still create no challenge, user, session, delivery or per-address row,
only the HMAC-keyed IP counter. Both clients already reset verification after `invite_required`.
The rebuilt API passes all 23 runtime tests and native/Wasm Clippy (JS unchanged, Wasm 1,087,289
bytes, SHA-256 `9d545e66…`). The live preview API and staged production API still run the earlier
order and need this build uploaded once Cloudflare access to the auracode account is available.

### Final CI batch 40394617240 and fixes

Unsigned Build 40394621310 passed universal macOS, Windows ARM64 and Windows x64. CI failed:

- Lint: a corepack download of pnpm and the Playwright browser download both timed out. The
  website Worker build now uses the installed pnpm; the browser download was transient.
- macOS (first macOS execution of this branch, Intel runners): file locks were released only by
  closing. A child forked by another thread shares the lock's open file description until its
  exec, so a just-closed store, profile owner or other lock could still look held. That made two
  encrypted migrations refuse to upgrade and the local import see its source still owned. Every
  advisory lock now uses `aura_process::locked_file::LockedFile`, which unlocks on drop, with
  regression tests that duplicate the descriptor as fork does.
- macOS terminal cleanup timed out. `openpty` descriptors were marked close-on-exec only after
  creation, so a concurrently spawned shell could keep another terminal's slave open. PTY creation
  now holds the write side of a process-wide guard whose read side every spawn holds. This Unix
  path could not be compiled locally because Application Control blocks the needed build scripts.
- The 10,000-turn history check now budgets the median page under 50 ms and the worst under 1 s;
  one 161 ms page on a shared runner was scheduling noise.
- Windows external WebDriver ran natively for the first time. The app window opened but session
  creation timed out with matching 155.0.4283.62 driver and runtime. The cause is not yet known;
  the gate now records a runner desktop capture and a direct verbose native-driver attempt.

Rust fmt and Clippy pass for default and all-features configurations. Focused lock, store,
checkpoint and process tests pass locally; macOS and WebDriver outcomes await the next CI run.

CI 40411019758 (193a78a): lint and all Windows non-WebDriver jobs passed, and the lock fix holds
on macOS (521 tests). The macOS terminal diagnosis showed a killed child with a shutdown report of
no exit and no steps: the Unix chain read the exit once at its start, so a process ending right
after left nothing to signal and nothing re-read the exit, and terminal cleanup stayed
unconfirmed. The chain now takes the recorded exit at the end (07a6774). Removing the WebView2
profile override did not fix the Windows WebDriver session; the gate now records WebView2 process
switches and DevTools port file locations while the direct attempt is still pending.

CI 40415942110 (bc5fe0d): both macOS jobs passed for the first time, confirming the lock and
shutdown fixes; Windows encrypted storage and PowerShell passed. A WebKit focus assertion in the
settings check raced the next-frame focus move and now waits for it. WebDriver process evidence was
decisive: the WebView2 browser ran in Edge WebDriver's profile but only with wry's default
switches, never the driver's remote-debugging ones, because WebView2 ignores
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` when an app passes its own and wry always does. Debug
builds launched with `TAURI_WEBVIEW_AUTOMATION=true` now keep wry's switches and append the
driver's; release builds never read the variable.

### Session pause

The owner paused before final verification. CI 40424725320 on 10a045c was cancelled before
results, so the WebKit focus fix and the WebDriver automation fix are verified locally only (the
WebDriver fix not at all). Build 40424751752 was left running. One final CI run, the production API
route, live invited sign-in and device acceptance remain. No PR is open.

### Website round 2: seals and turtles, no rules, rebuilt middle

Owner feedback on the Graphite website: keep the hero, add seals and turtles to the moving pixel
field, remove the split lines, replace the generic middle sections with treatments taken from the
references, and lock the type.

- `DitherField` gained opt-in sprites (small luminance grids with up to four frames, drawn into the
  field's luminance before the Bayer threshold), `edges`, a `ceiling` and lists of clearings. All
  are off by default and leave existing frames unchanged; 273 `@auracode/ui` tests pass, including
  new sprite, edge, ceiling and multi-clearing tests. `renderDitherFrame` takes a painted sprite
  overlay, so the fallback images show the creatures in their first frame.
- A sea turtle (from above) and a harbour seal (from the side) swim through the hero stage and the
  closing band; phones get two seals in open water. Reduced motion freezes them in place.
- The hero keeps its layout, copy and motion. Its field gathers toward the sides, stays calm
  behind the copy and along the product frame's top edge, and fades out before the stage ends. The
  seam rule, crosshairs and column guides are gone; the frame keeps one hairline ring and starts
  its dissolve further along (phones show the screenshot at once). All nine rotating names keep
  slot, word and underline widths equal and the headline never reflows, in Chromium and WebKit at
  1440 and 390px.
- Between the frame and the FAQ: Harvey's grain triptych, an x.ai film card replaying one turn
  with a keyboard Play/Pause, X Money's staggered tiles with a checkpoint toggle, one Vercel strip
  for running several chats, and Geist Pixel numerals 9, 2 and 0 condensing out of their fields.
  Every claim was checked against README, plan and progress; unverified shortcuts were dropped.
- Sections are separated by space only; the remaining lines are the strip's frame, the numerals'
  rule, spec rows and list rows. One heading size and two-tone pattern across the site.
  `@fontsource/geist-pixel` 5.3.0 (OFL-1.1) is self-hosted; the notice catalogue changed only by
  that record and two input digests.

Verified locally: all workspace typechecks, Biome clean for `apps/web` and `packages/ui`, website
static, browser (Chromium and WebKit, axe zero) and release tests, notices tests, Worker build and
runtime tests. Not run: CI, deploys, the owner's hand walkthrough. The `apps/desktop` format error
Biome reported at the time is fixed in the integration below.

### Graphite redesign: integration and local verification

On 2026-10-26 the owner rejected the Orbit look of the website and the app and asked for a full
restyle from their Mobbin and live-site references (SpaceXAI, X Money, Harvey, Aside, Vercel, with
the AI in Design Report 2026 as the bar for uniqueness). Graphite replaces Orbit: dark only, pure
black, Geist and Geist Mono at integer weights, one volt lime accent, a live ordered-dither field as
the signature, no space imagery and no eyebrow labels. `docs/design/visual-language.md` is the spec;
`@auracode/ui/graphite` holds the tokens, `DitherField`, `AgentMark`, `PixelMark` and the shared
controls. The Orbit module stays only for the Design Lab.

- **Chat shell.** Sidebar, header, transcript, composer, cards, right panel, palette and pickers are
  restyled; every `OrbitMark` is an `AgentMark`. Measured in Chromium with 4x CPU throttling
  (`target/shell-perf/` in the shell worktree): thinking went from 83% to 7% main-thread busy and 60
  to 0 layouts per second; streaming from about 9 to 47 frames per second, median frame 100 to 16.7
  ms, long tasks 56 (4.4 s) to 0; scrolling 500 turns, p95 frame 33 to 17 ms. The causes were
  OrbitMark re-rendering its SVG every frame and the agent picker re-rendering on every streamed
  chunk; the Markdown fade-in is gone.
- **Secondary screens.** Onboarding replaces the globe with a dither intro that forms the pixel mark
  and an agent roster pane; settings, account and profile panels, Library, dialogs, error, recovery
  and Diagnostics are Graphite. The app icon is the white pixel "a" with one volt pixel, regenerated
  with the Tauri CLI; `icon.ico` uses a full-bleed source so it reads at 16 px.
- **Integration fixes.**
  - Two notice input digests had been recorded from CRLF copies; they are the LF digests again.
  - The dither lens now keeps a clearing dark, so text over the hero stays legible under the
    pointer.
  - `graphite.css` brings Geist and Geist Mono itself; neither app ships Instrument Serif. The
    `orbit-theme` scope and Orbit imports are gone from the desktop.
  - A ghost agent mark's code is fg-3, since it is text and must meet AA.
  - The website's product images are a fresh capture of the Graphite desktop preview, which now
    passes a Local profile.
  - The virtual transcript no longer throws a reader back to the end. WebKit can deliver a scroll
    event a frame after the write; if a row grew in that gap, the virtualizer retried a clamped
    correction from its stale bottom offset. Writes now wait while a reader's scroll gesture is in
    flight. Its gesture listeners moved to the document, because the old ones were attached before
    the scroller existed and never fired on first mount. This was `check-orbit`'s WebKit failure
    (about four runs in five on Windows), present before the redesign.
  - Test fixes, none weakening an assertion: the synthetic Turnstile button uses the Graphite pill;
    the website browser test and the chat sign-in check, like the other desktop checks, audit only
    once finite animations and transitions end; `check-orbit` waits up to 3 s for an old row to
    unmount; `check-settings.mjs` is formatted.
  - Small polish: the agent dock keeps room above the profile row, and the transcript's waiting row
    keeps its volt mark with quiet text.

Verified locally on the integrated branch: `pnpm lint` (instruction check and Biome, warnings only),
`pnpm typecheck`, `pnpm test` (ui 273, desktop 348 with 19 skipped, design lab 352, web 4), website
browser tests in Chromium and WebKit, website release tests, Worker build and 5 runtime tests,
`cargo fmt --check` and Clippy for `auracode-desktop` with warnings denied, and every desktop
browser check CI runs (Orbit, settings with its sub-checks, Library, configuration recovery, account
vault, setup actions, profile status, chat sign-in, setup) plus account reset, workspace removal,
agent installations, folder resolution and repository publication, in Chromium and WebKit. Not
verified yet: CI, the native Tauri window, real Safari and macOS WebKit, and the owner's
walkthrough. Playwright WebKit on Windows draws Geist lighter than macOS does.

### Graphite walkthrough before the PR

The owner asked for a hands-on pass over the site and the app before the PR. Website: the
production build served locally with its CSP, driven in Chromium at 1440 and 390 with every
request outside localhost blocked, Turnstile replaced by a synthetic widget and `/api/*` answered
by fixtures, so nothing reached a real API and no email was sent. Checked: the hero (rotating name,
creatures, lens), the product frame reveal, the film card (Play/Pause by keyboard), the checkpoint
toggle, the FAQ, the closing band and footer, every route at both widths without overflow, the skip
link and focus ring order, reduced motion, no JavaScript (the film card shows its settled turn),
the phone menu, invited sign-in with an invite-only answer, and the signed-out account page.
Desktop: the existing debug build against the Graphite frontend in the real WebView2 window,
driven through accessibility and screenshots: onboarding through Motion, the main window, the
command palette, Settings, the Library and a 960x680 window at 150% scaling. No agent prompt was
sent.

Fixed from the walkthrough: the phone menu now covers the page below the bar, and a failed account
load shows its error and reload link without a "Loading" line that never ends (production shows
this while its API route is closed). Noted, not changed: the sidebar agent dock shows every
harness, so native and ACP variants of one agent share a two-letter code (two CC, two CX); their
popovers name them. The styled 404 is reached only through in-app navigation, since the Worker
answers unknown paths with plain text.

### Final CI for M2a and Graphite

All runs used `encrypted_storage=true`. Each failure was a test that depended on timing, and each
was fixed in the test without weakening what it asserts.

- 40478605432 (8dd383f): the Windows WebDriver session started for the first time, confirming the
  WebView2 switch fix, and the smoke drove the real app through a typed echo turn. Failures: the
  smoke sent `/slow` before the session reported idle, so it was queued and then held;
  `check-settings` saw the clicked "Shortcuts" button as focused before Settings moved focus to its
  heading; `check-account-vault` ran axe mid colour transition.
- 40483238023 (b8ec361): Windows Rust, including the full WebDriver smoke of the real app, passed.
  Failures: two more axe samples mid transition on macOS (so every desktop check now audits once
  finite animations end), and the folder-check test's 200 ms window on a busy macOS runner (now
  500 ms).
- 40487517832 (c17711c): lint, both Rust jobs and Windows encrypted storage passed. macOS encrypted
  storage failed the 10,000-turn history ratio because the newest pages were timed during a busy
  stretch; the test now interleaves the two ends and keeps each page's best time.
- 40491964588 (1ea4d35): everything passed except one Windows selection test, which met Access is
  denied deleting a fake executable a probe had just run; the delete now retries briefly.
- 40495382743 (3e6821b): GitHub started no job: account payments failed or the Actions spending
  limit was reached. The selection fix passes locally with Clippy.

The owner chose to skip a further CI run to save Actions spend, and the PR opened without one. The
only change after 40491964588 that CI has not run is the selection test's delete retry (test code
only) plus this record. Rerun CI on the PR head before merging if the owner wants that gate closed.

### M2a merged and the website deploys on push (2026-10-27)

#6 merged into `main` as `64f5529` (a merge commit, so #4 shows merged). #5 was closed because
every commit on it is already in `main`. The merge also removed the old `main` workflow triggers
(CI on every push and pull request, and the nightly Build schedule), so GitHub Actions now runs only
when dispatched by hand. Pushes now deploy the website through Workers Builds: `main` goes to
`auracode.si` and to preview, and other branches go to preview. Settings and the first verified
build are in `infra/README.md`.

### Seal and turtle logo (2026-10-27)

The owner's seal and turtle replaces the pixel "a" everywhere it appeared. The source raster is
kept at `docs/design/brand/logo-source.png`. It was traced with potrace (run from a scratch folder,
not a dependency) into one even-odd path, `LOGO_PATH`, in `packages/ui/src/graphite/logoPaths.ts`.
`LOGO_SMALL_PATH` is a second trace with wider gaps and larger eyes for 24px and below. `Logo`
replaces `PixelMark`, and `Wordmark` now sets the logo a quarter taller than its type.
`PIXEL_MARK_GRID` and `pixelMarkSvg` are gone. DitherField gained a `path` target, so the
first-launch intro now condenses into the logo.

Where it landed:
- **Desktop:** the onboarding header, the intro, the New chat welcome, the error screen and
  Settings, plus every app icon.
  - `scripts/app-icons.mjs` (`pnpm --filter @auracode/desktop icons`) writes the macOS and Windows
    SVG sources and rasterizes them with the Tauri CLI.
  - The tray now uses its own icon (`tray.png` on Windows, a `tray-template.png` template image on
    macOS, embedded with `tauri::include_image!`), and its badges use volt for "needs you" and
    fg-1 for "working".
- **Website:** the nav and footer wordmarks, plus generated images.
  - `favicon.svg`, `favicon.png` and `apple-touch-icon.png`, rasterized at build time by a small
    even-odd rasterizer in `scripts/site-images.ts`, so no image library is needed.
  - A 1200x630 `og.png` social card (the logo in a still dither field) with Open Graph and Twitter
    tags.
- **Deferred:** the chat sidebar logo moves to the sidebar redesign, because macOS's traffic
  lights own that corner. The giant footer art moves to the website declutter.

Verified locally:
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (ui 276, desktop 348 with 19 skipped, design lab
  352), the website static tests, the notices and instructions script tests, and desktop Clippy.
- Screenshots of the site header, the New chat welcome, the onboarding header and the intro
  frames.

### Website landing redesign (2026-10-27, branch `site-landing`)

The home page was rebuilt from a study of the five reference landing pages (visual language 5.12):
five sections instead of eight, each copied from a named reference section.
- Hero and product: x.ai's hero. One action (Download); the second button is cut.
- Film card: x.ai's "The SpaceXAI team runs on Grok Bot".
- Six staggered tiles: X Money's "One app". They absorb the triptych's agents and handoff tiles and
  the strip's parallel chats; the plan and keyboard tiles are cut. Still at rest; hover plays one
  loop and dims the others.
- FAQ: X Money's, six rows.
- Closing panel: Aside's, with a turtle and a seal.
- Footer: x.ai's, the brand drawn as the giant seal and turtle logo that the field forms on scroll.

Cut: the triptych, the strip and the giant numerals, with their CSS and the Geist Pixel font. The
stylesheet went from 3,406 to 2,604 lines. Header: wordmark, Changelog, Sign in, Download.
One stepped type scale and a 160px section rhythm; padded boxes sit on the 4px grid at 1440.
Inner pages lost their redundant parts: the sign-in panel's second heading and extra link, the
download page's platform guess, repeated note and changelog link, and the changelog's New chip.

Open: the generated third-party notices page has no site chrome; restyling it needs a change in
`.github/scripts/third-party-notices.mjs`.

### App restyle step 2a: one system (2026-10-27)

Branch `app-one-system` makes the desktop app one system at the stylesheet level. No screen was
redesigned; visuals changed only where consistency required it.

- **Base:** Tailwind (two devDependencies, the Vite plugin, the import) and the legacy Aura tokens,
  `AuraField` and `brandCssVariables` are gone from the desktop app. `styles.css` is now a plain
  reset and document layer in cascade layers under every unlayered stylesheet. The stress view's
  ambient field is Graphite's dither. `packages/ui`'s legacy modules stay for the Design Lab.
- **Tokens:** stylesheets read `--g-*` directly. `ui-tokens.css` keeps only the window's own layout
  values (sidebar and rail, titlebar band, pane inset, transcript gutter, window tint).
- **Buttons:** `.ui-button` (118 uses), `.chat-icon-button` (12) and the dead `.btn` classes are
  gone. Every button is `.g-button`; icon buttons are `.g-button-icon` at radius 6, and Graphite
  gained a 24px size and a ghost that stays unfilled when disabled.
- **Fields:** `.g-input`, `.g-select` and `.g-textarea` share one Graphite rule; the chat's
  `.ui-input` family (24 uses), the Library's select chevron and two hand-made fields are gone.
- **Dialogs:** one shell on `.g-dialog` in three widths (sm 440, md 560, lg 760) with one 16px
  viewport margin, `.g-dialog-header` and `.g-dialog-actions`. The terminal sheet and the clone
  dialog use the same classes and close button. Widths 480, 590, 600, 640, 660, 900 and 1040 are
  gone, as are duplicated selectors across screens.
- **Scales:** every margin, padding and gap is a `--g-space-*` token; about 160 values off the scale
  moved onto it, radii of 1, 2 and 10 became pill and 12, raw line heights and sizes became type
  tokens, and the last raw durations became motion tokens.
- **Inline styles:** static ones moved into CSS (project swatches now read four
  `--g-project-*` tones; Markdown depth and alignment are data attributes). Only computed ones stay.
- **Naming:** `check-orbit.mjs` is `check-chat.mjs` (`pnpm check:chat`, evidence in
  `target/chat-browser`), checks read `CHECK_URL`, and CI, the release checklist and live docs
  follow.
- **Guard:** `.github/scripts/check-styles.mjs` (in `pnpm lint`, its test in `pnpm test`) fails on
  raw hex, untokenised spacing or radii, raw type, weights other than 400, 500 and 600, and raw
  durations in `apps/desktop/src/**/*.css`, with a five-entry commented allowlist.

Verified locally on Windows: `pnpm lint`, `pnpm typecheck` and `pnpm test` (root scripts 22, ui
276, desktop 5 node and 348 with 19 skipped, design lab 352, web 4), and every desktop browser
check in Chromium and WebKit with no axe violations (`check-settings` needs the website built
first for its verification fixture). Before and after sheets of every preview mode, fixture and
main dialog are in the ignored `target/design-research/sheets/app-2a-*.png`.

### App restyle step 2b: the Grok chat shell (2026-10-27)

Branch `app-chat-shell` (from `app-one-system`) rebuilds the chat shell after Grok's web app.

- **Sidebar:** the seal and turtle logo at the top left (x 84 on macOS, clear of the traffic
  lights, through `data-os`), the collapse toggle (now also ⌘\), Search and New chat with their
  keys under the hand only, a foldable Projects section without counts, and Archived chats as a
  quiet last line. Rows share one style and sit 4px apart.
- **Agent dock:** one tile per usable product (native before the ACP adapter; the demo only when
  nothing else is usable); missing and alternate variants wait behind "+N", whose rows start a
  chat or open the Agents screen. Detecting, found, sign-in or update, working and needs-you each
  have a look and one small motion; reduced motion holds still.
- **Account row:** round initials, the name and its storage or sync state, and a kebab menu
  (Settings, Agents, Diagnostics) after Vercel's user row.
- **Header:** title and project, the status with its live mark only while it says something, and
  two controls (Changes and the chat menu). Git workspace, Terminal and editor, history, export,
  debug bundle, log and the session lifecycle live in the menu and, by name, in the palette.
- **Transcript:** no byline; Grok's action row (copy, retry, fork, receipt icons and the time) in
  place of the receipt; an even-radius prompt block with icon actions; a 24px gutter.
- **Composer and picker:** one pill with attach, the agent chip (agent, model, autonomy ticks) and
  one send control (Stop recedes once a message is typed; Steer and Queue share one pill). The
  agent, model, effort and autonomy choices are one popover after Grok's voice popover.
- **Calm treatment:** permission input as key and value rows, Graphite radios in questions, the
  queue as one segment, quiet panel tabs and palette scopes, no palette key legend.
- **Layout probe:** `apps/desktop/scripts/check-layout.mjs` walks every `?preview=` mode plus the
  shell's floating layers in Chromium and WebKit at 1440x900 and 1024x700, and fails on
  overflow, padded containers off the 4px grid, overlapping controls, focus without a visible
  change, and text under 4.5:1. The chat surfaces are clean (100 of 100 views); findings remain in
  New chat, settings, account, setup, Agents, Git, project tools, worktree setup, config sync,
  data transfer and keep-local, which the parallel 2b branches own.

Verified locally on Windows: `pnpm lint`, `pnpm typecheck` and `pnpm test` (root scripts 22, ui
276, desktop 5 node and 351 with 19 skipped, design lab 352, web 4), and in Chromium and WebKit
`check-chat`, `check-steering`, `check-questions`, `check-session-fallback`, `check-git-review`,
`check-project-tools`, `check-profile-status` (now opening the account menu first) and
`check-settings` (which includes settings navigation). Side-by-side sheets against the Grok and
Vercel references are in the ignored `target/design-research/sheets/app-2b-chat-*.png`.

### App restyle step 2b: New chat, Settings and Account (2026-10-27)

Branch `app-settings` (on `app-one-system`) redesigns New chat, Settings, Account and the update,
profile and configuration sync panels after the owner's references: Grok's start screen and
settings, X Money's grouped rows, Vercel's empty states. Behaviour, test hooks and accessible
names are kept unless noted.

- **New chat:** the logo, one two-tone display line, one hint and one composer card. Agents that
  can run here are pills over native radios whose mark shows the state: the loader while
  detected, the code once found (settling in once, still under reduced motion), the volt square
  when a sign-in check says it needs you. Unavailable agents and their reasons sit under Other
  agents. The rules moved from `chat.css` to `new-chat.css`. The agent picker is no longer a
  select, so `testIds.test.tsx`, `screens.test.tsx` and the smoke run's `choose()` and
  `agentOption()` read the radio by its value; the smoke run was not executed against a real
  build in this step.
- **Settings:** icon nav with Grok's filled pill, no page subtitles, wells of rows with one control
  each. General is one well, Shortcuts one keycap table (New chat and the menu keys added), About
  the logo, name and version over Updates, This device, Diagnostics and notices.
- **Account:** Profiles, Cloud account, Devices and Security. Each sign-in step is one row with its
  form under it; sign-in errors are one red line under the field; Sign out and the reset entry are
  chevron rows. Turnstile sits in a well over a status line with a loader, check or red square.
- **Configuration sync:** files in mono with their state and keep-local switch, Review as the one
  action, Vercel empty states.
- **Docs:** visual language 6.13 (New chat) and 6.16 (Settings) describe what is built. The style
  guard allowlists settings.css's checkbox data URL like the shell's.

Sheets of every screen at 1440 x 900 and 1024 x 700 beside their references are in the ignored
`target/design-research/sheets/app-2b-settings-*.png`.

### App restyle step 2b: Agents, onboarding, Library, sync and dialogs (2026-10-27)

Branch `app-secondary` (on `app-one-system`) redesigns the secondary surfaces against the owner's
Vercel and Grok references, translated to Graphite dark. Chat and settings were redesigned in
parallel on other branches and are not touched here.

- **Agents** (visual language 6.17a): Vercel's project list. One framed list, a 64px row per
  harness with its mark, name, version, status (a word and a 6px square; volt only for Needs
  sign-in), the date auracode last verified it, at most one action (Install, Update or Sign in) and
  a kebab menu for the rest. A row opens its details and the executable picker. Detection shows
  the mark's pixel loader, then the status and version settle once and the green square arrives.
  The one-click list is `ONE_CLICK` in `AgentRow.tsx` (it moved from `AgentsScreen.tsx`).
- **Onboarding** (6.17): four skippable steps in one centred column (Grok's start screen) over
  the dither field gathered at the window's sides (the website hero). The side panel, the numbered
  checklist, the motion step and "Skip this step" are gone; a setup saved at the motion step
  resumes at First project. The account step says plainly that accounts are optional and
  invite-only.
- **Library** (6.18) and **configuration sync**: Vercel list cleanliness; Copy history is a view
  after one divider; review, apply, restore and recovery dialogs follow one pattern (the title, one
  sentence, rows or a hairline grid, Cancel and one primary or the red pill).
- **Dialogs and takeover screens** (6.19, 6.21): the terminal sheet, clone, install review,
  vendor command, folder resolver, startup error and configuration recovery on the same pattern.
- **Checks:** `check-setup.mjs` now asserts the centred layout, the roster and the retired-step
  resume instead of the removed panel and motion radios, and audits Agents with a row menu open
  from the keyboard. Biome's descending-specificity warnings in these stylesheets went from 22 to
  none (repository total 70 to 48).

Verified locally on Windows: `pnpm lint`, `pnpm typecheck` and `pnpm test` (root scripts 22, ui
276, desktop 5 node and 348 with 19 skipped, design lab 352, web 4), and in Chromium and WebKit
`check-setup`, `check-setup-actions`, `check-agent-installations`, `check-chat-auth`,
`check-library`, `check-config-sync`, `check-config-recovery`, `check-worktree-setup`,
`check-git-review`, `check-workspace-removal`, `check-repository-publication`,
`check-folder-resolution` and `check-settings`, each passing with its axe audits clean. Sheets
of each screen at 1440x900 and 1024x700 beside its reference, with checklists, are in the ignored
`target/design-research/sheets/app-2b-secondary-*.png`. Not done here: the hand walkthrough of
the built app and the Windows and macOS CI run, which belong to the integration of steps 2a to 2c.

### App restyle step 2b: integration (2026-10-27)

Branch `app-redesign` (from `app-one-system`) merges `app-chat-shell`, `app-settings` and
`app-secondary` in that order, then brings over the reviewed OpenCode install from
`opencode-install` (the Rust installer as is; `opencode` joins `ONE_CLICK` in `AgentRow.tsx`).

- **Conflicts:** `chat.css` keeps the shell's picker rules and drops the old New chat block, now
  `new-chat.css`; `preview.tsx` keeps the shell's palette commands and uses `NewChatPreview`;
  configuration sync takes the settings rows and wells from `app-settings` for the panel and the
  review, restore and recovery dialogs from `app-secondary`, with one merged `config-sync.css`;
  the progress log keeps all three entries.
- **Layout:** the probe found 44 of 152 views with findings after the merges (250 off the grid, 4
  focus, no overlap), all in New chat, settings, account, verification, config sync, Agents, the
  Git and project tools dialogs and their fixtures. Settings, account and Agents rows are now one
  60px row (the label 20 over its line 16, a 28px control 16px in); the strong segmented control is
  a 36px track with its 28px segments 4px in, in settings and dialogs alike; dialogs, the Agents
  frame and its hairlines and New chat's folder row draw their lines inset; New chat's drop snaps
  to the grid; the verification frame shows a keyboard focus ring through the window's blur into
  it, since a cross-origin frame never matches `:focus`. The probe now exempts only the window
  offset of a modal dialog centred by its margins. A full run in Chromium and WebKit is clean: 152
  of 152 views.
- **Seams:** the settings sidebar takes the chat sidebar's geometry (the logo in the band, rows 4px
  apart, words at x 44); the Library's views share the settings nav's spacing and divider; the
  Library and Agents page heads stack alike. The worktree setup, keep-local, data transfer,
  project tools and verification fixtures show their panels in their real containers.

Verified locally on Windows: `pnpm lint`, `pnpm typecheck` and `pnpm test` (root scripts 22, ui
276, desktop 5 node and 351 with 19 skipped, design lab 352, web 4); every
`apps/desktop/scripts/check-*.mjs` in Chromium and WebKit with its axe audits clean
(`check-notices` and `check-settings-navigation` run inside `check-settings`); `cargo clippy -p
aura-agents --lib --tests -- -D warnings` and `cargo test -p aura-agents --lib installer`. The
overview sheet of every preview mode is the ignored
`target/design-research/sheets/app-2b-integrated-overview.png`. Not covered by the probe: the
Library and setup actions fixtures, which have their own pages instead of `?preview=` routes (the
Library still has 11 findings per view there). Not done: the hand walkthrough of the built app and
the Windows and macOS CI run.

### M2b and M2c gaps (2026-10-27)

Branch `m2bc-gaps` (from `app-redesign`) closes the gaps left after the 2b integration. Each item
is its own commit.

- **Move into a busy folder:** Chat options offers the destination project's folders. A folder
  with other active chats shows New chat's warning and an explicit checkbox; Move chat waits for
  it, `allow_busy_folder` is true only when the warning shows and is checked, and the folder is
  checked again right before the move (`lib/chatMove.ts`). Dialog sections draw their hairline
  inset.
- **Notification click target:** `navigationTarget` checks the ID `shell_take_navigation` returns
  against the chat list and the workspace before anything is selected: it waits while they load,
  opens an archived chat with the archived view and ignores an unknown ID.
- **Queue:** each queued row has Edit (inline; Enter saves, Esc cancels without interrupting the
  turn), Move up and Move down beside Remove, keyboard reachable, with focus following a moved
  row. Rust gains `chat_queued_text`, `chat_edit_queued` and `chat_move_queued`: an edit keeps the
  prompt's attachments, mentions, place and hold; a move rewrites the stored times so a reopened
  chat keeps the order; the prompt a checkpoint is being saved for can no longer change.
- **Steer:** only Codex steers. For Claude Code and Pi a message typed during a turn shows "After
  this turn" where Steer would be, never a dead control; the Queue disc stays what Enter does. The
  Steer and Queue pill now holds 24px segments 4px in, on the grid.
- **Shortcuts:** Ctrl+1 to Ctrl+9 (Cmd on macOS) open the Nth chat the sidebar lists (folded
  projects count none; Needs you rows are not counted twice), never while composing or behind a
  dialog; the first nine rows carry `aria-keyshortcuts`, and Settings lists the keys with Ctrl+N.
- **Settings:** General has New chats (default agent, its model once that agent has listed models
  in this run, and autonomy with Full auto the default), While agents work (Notifications, Keep
  awake, Keep running in the tray or menu bar) and App. The values live in the profile's setup
  preferences (older files read the defaults) and Rust applies them at startup, after a profile
  switch and on every save: the session manager starts never-started chats with the default
  autonomy and model (a project's model and a saved session win), the native shell skips
  notifications, releases or takes keep-awake at once, and closes through the guarded quit path
  when the tray switch is off. New chat selects the default agent once detection says it can run.
- **Library:** the three-pane frame's ring and dividers are inset, the views and items panes are
  200 and 360px, row hairlines sit over each 56px row, and the item detail and copy controls are on
  the grid. `check-layout.mjs` now opens fixture pages by name and walks `library.html`, an opened
  item and Copy history, plus Chat options, the queue and its editor, both typed composer states
  and General with a default agent.

Verified locally on Windows: `pnpm lint` (Biome's 37 warnings, none new), `pnpm typecheck` and
`pnpm test` (root scripts 22, ui 276, desktop 5 node and 377 with 19 skipped, design lab 352,
web 4); `cargo test -p aura-core --lib --features account-sync` (518) and `cargo test -p
auracode-desktop --lib` (205, bindings regenerated); `cargo clippy -p aura-core -p
auracode-desktop --lib --tests -- -D warnings` and `cargo fmt --check`. In Chromium and WebKit:
`check-layout` (192 of 192 views clean), `check-chat`, `check-settings` (with the checks it runs,
`check-steering` among them), `check-library`, `check-setup`, `check-setup-actions`,
`check-chat-auth`, `check-agent-installations`, `check-config-recovery`,
`check-folder-resolution`, `check-profile-status` (its first run's browser crashed, the rerun
passed), `check-repository-publication`, `check-workspace-removal`, `check-account-reset` and
`check-account-vault`. Sheets are the ignored `target/design-research/sheets/app-gaps-*.png`. Not
done: the hand walkthrough of the built app, the WebDriver smoke, the Windows and macOS CI run, and
the installed-app checks of notifications, tray closing and keep-awake, which have only unit tests.

### Windows native acceptance (2026-10-27)

Branch `native-acceptance` (`m4-worktree-ui` merged with `m2bc-gaps`). The debug app ran by hand on
Windows 11 (3840x2160 at 150%), driven through Orca and UI Automation, on its own data folder with
Vite serving the UI. The worktree feature refuses a data folder whose worktree path passes 200
UTF-16 units, so after the first launches the data folder moved from the scratchpad (167
characters) to `%TEMP%\auracode-na\d`.

- **First launch: pass.** The intro condenses the dither into the seal and turtle, lights it and
  raises the word, then fades into Welcome. The steps, Continue and Skip setup (from step 1 and from
  step 4) work. The shell is crisp at 150%. The 100% system scale was not switched on this shared
  PC; the UI was checked at WebView2 device scale 1 instead (`TAURI_WEBVIEW_AUTOMATION` with
  `--force-device-scale-factor=1`) and renders cleanly.
- **New chat, Demo agent: pass after two fixes.** In a scratch Git repo the chip reads "Worktree
  from main on aura/<id>" and Create made a locked worktree on that branch; Local in the chip's
  popover made a chat in the project folder. Streaming, Retry, Edit and Fork (all through the
  visible handoff review), queue edit and reorder during a running turn, a held queue surviving a
  quit, and a Changes panel revert that restored the file all worked.
- **Tray: pass.** The logo tile sits in the notification area overflow; Open, Quit and a left click
  work; the tooltip counts active and waiting chats; the badge is fg-1 while working and volt when a
  chat needs you.
- **Notification: partly verified.** A Demo turn finishing with the window hidden produced "An
  agent finished its turn" (attributed to Windows PowerShell, as Tauri does for an exe under
  `target\debug`). Do not disturb was on, so it went straight to the notification centre, where a
  click is not reported on Windows (plugin limitation); routing to the chat was not observed. Run
  from any other folder the debug exe sends toasts under the unregistered `si.auracode.desktop` ID
  and Windows drops them.
- **Quit guard: pass.** Quitting from the tray during a turn asks "One chat is still active";
  Keep auracode open leaves the turn and queue running; Stop agents and quit exits with no
  auracode process or WebView2 child left.
- **Settings switches: pass.** Keep awake: the system execution state (`CallNtPowerInformation`,
  no admin; `powercfg /requests` needs admin) shows `ES_SYSTEM_REQUIRED` only while a turn runs,
  drops at once when the switch goes off mid-turn and returns when it goes on. Keep running in the
  tray off makes closing the window ask the quit question.
- **Minimize, CPU of auracode and its 7 WebView2 processes:** idle 0.3% of one core. A `/stress`
  answer at 120 tokens a second, 10 s windows interleaved: visible 36.9% and 50.0%, minimized
  23.3% and 24.5%. Minimized, the GPU process drops to 0 (the existing hide-on-minimize works) but
  the renderer keeps handling the stream at about 20% of a core.
- **Real agents: blocked.** One Claude Code turn on Haiku 4.5 reached the CLI and was refused by
  the account's 5-hour limit; the chat shows the error and its log. The switch to Codex shows the
  visible handoff block for review and in the next prompt. Two Codex turns in that chat ("yo",
  "whats up") were typed by someone else at the keyboard, on Codex's default model; no Codex prompt
  was sent by the acceptance run.
- **Docked items: pass.** Every Settings page, Agents (with a fix), Library, the command palette
  (files appear under Files only) and Ctrl+1 to Ctrl+3.

Fixed, each with a test where one fits: a launch with its own data folder kept its webview profile
and window geometry in the installed app's folders; worktree chats held every first prompt because
checkpoints refused the profile's own worktrees; the "Next message includes a handoff" banner
stayed after the handoff was delivered; the line diff put a changed line's addition above its
removal; the tray's working badge merged with the logo and its tooltip said "1 need attention";
the Agents page's verification text ran under the row menus.

Found and not fixed: quitting with an open session sometimes logs "database closed with ops still
waiting; they are lost" for one chat (dropped=1, twice), although transcript, queue and turn end
survived; project folders are stored as `\?\C:\...` and New chat shows that prefix (Claude Code
and Codex both started in such a folder); after an agent switch every earlier turn is labelled with
the new agent; the quit question is a light native dialog whose default button is the destructive
one; the Account page's verification frame fails in the dev build and never leaves "Loading
verification"; marks under 24px show one letter, so Claude Code and Codex are both "C"; the sidebar
dock counts 12 other agents where New chat counts 9. Application Control blocked the first two
builds' new build scripts (4551); a later plain rebuild passed and nothing was bypassed.

Checks on this branch: `cargo clippy -p aura-core -p auracode-desktop --all-targets -- -D warnings`
and `cargo clippy -p aura-core --features account-sync --lib --tests -- -D warnings`; `cargo test
-p auracode-desktop --lib` (208); `cargo test -p aura-core --features account-sync --lib` for
checkpoints, conversation and gitworkspaces (83); desktop Vitest (403, 19 skipped), `tsc` and Biome
(37 warnings, none new). The browser `check-*` scripts, the full aura-core suite and CI were not
run. Bindings were unchanged by the merge.

### Open pull requests merged and the production API switched on (2026-10-28)

The owner granted full merge autonomy. PRs #8 to #18 were merged in order on one branch, each
with its own merge commit, verified together and pushed to `main` once (01ede50). GitHub marks
all eleven merged. Conflicts were confined to this log (both sides kept), the notice catalogue
(regenerated), the Agents page (the redesign's version, which already offers the OpenCode install)
and three files where the earlier integration merges' resolutions applied unchanged.

Checks on the merged tree:
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass: desktop 426 plus 5, ui 276, design lab 352,
  web 4, scripts 22.
- `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings` pass.
- Rust suites: aura-config 102, the desktop lib 208, and aura-core lib with account-sync 551 of
  552 (the failure is the account test race fixed below).
- The website's browser tests pass in Chromium and WebKit, and the worker builds and passes 5
  runtime tests.
- Application Control blocked the aura-agents lib test binary (4551), so it runs in the final CI.

`auracode.si` served the merged build about 15 minutes after the push. Every route answers, and
the home page shows the new landing.

**Production API.** The zone route `auracode.si/api/*` now points to `auracode-api`, the staged
build with the invitation-order fix, as the owner pre-approved for M6. Verified live:
- `health` and `config` return 200, with the production Turnstile key.
- `auth/session`, `devices` and `account` return 401 without a session.
- A sign-in challenge with an invalid Turnstile token gets 403, and so does a foreign origin. No
  email is sent, and the allowlist and Turnstile secrets are present.
- `/signin` renders the real Turnstile widget.

One live invited sign-in remains for the owner, because it needs the emailed code.

**Account test race.** `accounts::tests::reset_detaches_old_profile_durably...` failed with
InvalidState in about one run in five. Account writes are ordered per vault entry across the
process, and every account test uses the same origin and account ID, so a restore in one test made
another test's account stale. The tests now take turns with that entry. The result: 0 failures in
20 runs of `accounts::`, against 3 in 15 before. Production code is unchanged.

### Windows native acceptance fixes (2026-10-28)

Branch `native-fixes` (from local `app-integrated`: the redesigned app with the worktree flow, the
M2b/M2c gaps, the M4 panel and the first acceptance fixes). The merge needed no bindings change.
Each item is its own commit (the sidebar foot and the agent count share one).

- **Lost writes on quit:** both drops came right as the store closed, after every chat had
  answered its quit (`took_ms=1`): an answered actor still took messages and queued store work,
  and a chat without a running actor could start one after the quit began. A quit's answer now
  also waits for work in flight (page reads, an option's answer, a process winding down), bounded
  by `shutdown_all`'s deadline; after it the actor is sealed and refuses store work with
  `ShuttingDown`, and no actor starts once the quit began. If the store still closes with ops
  waiting (a deadline ran out), each is named: lost writes at error level and counted, reads at
  warn level.
- **Verbatim paths:** a Windows verbatim path takes its plain spelling (`C:\...`,
  `\\server\share`) when that names the same folder: it fits MAX_PATH (259 UTF-16 units) and no
  part needs the prefix (`.`, `..`, a trailing dot or space, a DOS device name, a character Win32
  rejects, an empty part); volume GUID paths and anything unsafe keep it. New folder locations are
  saved that way, every `folder_locations.path` comparison binds the same spelling, worktree
  previews show it, and the interface's folder comparison accepts both. Migration 14 rewrites saved
  rows with the same Rust rule after the usual pre-migration backup.
- **Each turn keeps its agent:** history pages name each turn's agent (`turn_agents`, by the rule
  conversation and sync use), a live turn takes the chat's agent of that moment, and the transcript
  labels each turn with its own agent, through reloads.
- **Agent marks:** every `AgentMark` shows its two-letter code (CC, CX, OC, PI) at every size.
- **Sidebar foot and one agent count (owner request 2026-10-28):** the sidebar ends with the logo
  and one Settings button (Ctrl+,); the agent dock and the profile row are gone, and the band keeps
  only the collapse toggle, so the logo shows once. Settings has Account and Agents, and the
  palette gains Open agents. An account whose sync is paused or failing puts a small dot on the
  Settings button and names it. One lineup (`lib/chat/agentLineup.ts`) feeds New chat's choices,
  its "Other agents" count and the composer's picker. `check-profile-status` became
  `check-sidebar-footer` (CI renamed with it); `check-layout` dropped the two dock menus.
- **Status dots are circles (owner request 2026-10-28):** `StatusDot`, an `AgentMark`'s waiting and
  failed states and every hand-drawn status mark in the app; pixels, loader cells, the pixel check,
  diffstat squares, bullets and plan nodes stay square. The tray badge was already round.
- **Quit question:** the window comes forward and asks in its own Graphite dialog, Keep auracode
  open focused (Enter, Esc, the scrim and the close button keep it open), the red "Stop agents and
  quit" as the explicit choice; it hides only once quitting goes ahead. If the page does not show
  the question within 3 s, the system dialog asks, Keep open first and default.
- **Account verification in the development build:** not a product bug. `/verify-device` lets
  only the installed app's origins embed it (`frame-ancestors` and the parents it answers), and the
  development build runs at `http://localhost:1420`. Such a build now says so at once and loads no
  frame; the installed app keeps the frame and its 30 s "could not load" message.
- **Hidden rendering:** the chat store applies every frame as it arrives but, while the page is
  hidden, does not tell the view; it renders once, with everything, when the page shows again.

Verified locally on Windows: `pnpm lint` (Biome 28 warnings, no errors), `pnpm typecheck`, `pnpm
test` (root scripts 22, ui 278, desktop 5 node and 441 with 19 skipped, design lab 352, web 4);
`cargo fmt --all --check`; `cargo clippy -p aura-protocol -p aura-core -p auracode-desktop
--all-targets -- -D warnings` and the account-sync clippy; `cargo test -p aura-core --lib` (459),
with `--features account-sync` (554), `-p aura-protocol --lib` (23) and `-p auracode-desktop --lib`
(210, bindings regenerated with `turn_agents`), after cleaning the workspace crates in the shared
target. In Chromium and WebKit every `apps/desktop/scripts/check-*.mjs` passed with its axe audits:
`check-layout` (all 252 views clean, the quit dialog among them), `check-sidebar-footer`,
`check-chat`, `check-settings` (with the fourteen checks it runs), `check-setup`,
`check-setup-actions`, `check-library`, `check-new-chat-worktree`, `check-terminal-panel`,
`check-chat-auth`, `check-agent-installations`, `check-config-recovery`,
`check-folder-resolution`, `check-repository-publication`, `check-workspace-removal`,
`check-account-reset` and `check-account-vault`. Sheets are the ignored
`target/design-research/sheets/app-fixes-{sidebar,quit,marks,dots}.png`.

Not done: the minimized CPU was not measured again (it needs the native debug build, whose exe in
the shared target the owner may run, and Vite's port 1420 was held by another session), so the
hidden-page change rests on Vitest; the quit question was seen in the browser preview, not the
running app. Application Control (4551) blocked several freshly linked binaries; relinking let each
run and nothing was bypassed. `.github/scripts/acceptance-gates.test.mjs` (outside `pnpm test`)
already failed on `app-integrated`: `check-layout`, `check-new-chat-worktree` and
`check-terminal-panel` are missing from the CI workflow. CI and the hand walkthrough of the built
app were not run.

### Website in Shallows (2026-10-28, branch `site-shallows`)

The owner chose direction B, Shallows, from three concepts ("shallows looks hella good. implement
that"), and asked that it fix the earlier review: drop the tiles section and everything below it,
remove the film card's Pause button, make hovering a seal or turtle smooth, and lose the dither.
`docs/design/visual-language.md` records Shallows as the brand surface (1, 4.16, section 5).

- **Shared primitives** in `@auracode/ui/graphite`, committed first and alone (bd537fe) for the
  app branch: `Creature` with `SEAL_PATH` and `TURTLE_PATH` (and small variants for 64px and
  below), generated from splines in `creatureGeometry.ts` so the gaps between body and flippers
  are exact; `Shallows`, the lit-water panel and its tokens; `Swimmers`, transform-only motion on
  the shared frame clock, paused off screen and in hidden tabs, still under reduced motion, with a
  smooth eased give-way field for the pointer instead of the old lens.
- **Website**: the hero is one lit panel with the nav resting on it, two near silhouettes and a far
  turtle, the rotating headline (now a FLIP glide, no blur, no glint), one Download and the real
  app. The film card, the tiles and the giant dithered footer logo are gone. One capabilities panel
  takes their place: six one-line rows with a 2px timer and a live view of the app that cross-fades
  on hover, focus, click or the timer, a real tab list. Then a hairline FAQ, a closing panel in
  lit water and a minimal footer. The 404 is a lit panel with a turtle. Status marks are circles.
  The social card is redrawn in Shallows; the dither fallback images are no longer built, and no
  dither code ships to the site (checked in the built JavaScript).
- **Motion**: blocks rise 16px and fade in once; the three primary Download pills are magnetic
  (transform only); the product settles in on scroll where scroll timelines run. Only transform
  and opacity animate, plus the FAQ's 300ms disclosure.

Checks on this branch: `pnpm lint` (37 warnings, all existing in desktop CSS), `pnpm typecheck`
and `pnpm test` pass: scripts 22, ui 294, desktop 441 plus 5 (19 skipped), design lab 352, web 4.
`pnpm --filter @auracode/web test:browser` passes in Chromium and WebKit, now also running axe on
each of the six capability views and checking their keys, and that the home page has no canvas and
no Play or Pause. `worker:build` and `worker:test` pass (5 of 5). Frame times on the built site in
headless Chromium at 1440 by 900: 0 of 1,495 frames over 25ms across idle, sweeping the pointer over
the swimmers, hovering the magnetic button, scrolling and switching capabilities (max 16.8ms, no
long tasks); the trace shows 14ms of layout and 52ms of paint in total. Comparison sheets are in
`target/design-research/sheets/site-shallows-*.png`.

Not done here: the desktop app still uses the dither field on its first-launch intro and
onboarding until its Shallows branch; `StatusDot` itself becomes a circle with the `native-fixes`
branch (the site styles its own dots). The hand walkthrough before merge and real Safari remain.

### Plugin library per agent (2026-10-28, branch `plugin-library`)

The Library is now the Plugin library (Settings, then Plugin library), one section per agent:
Claude Code, Codex, Pi and OpenCode. Details, sources and the edge-case table are in
[plugin-library.md](plugin-library.md).

- **Live from the CLI:** `claude plugin list --json --available`, `claude plugin marketplace list
  --json`, `codex plugin list --json --available`, `codex plugin marketplace list --json`, `codex mcp
  list --json` and `pi list` run through the bounded helper launch (20 s, 6 MB). Commands that start
  MCP servers (`claude mcp list`, `pi mcp list`, `opencode mcp list`) and every OpenCode command
  (it installs plugins at startup) are never run; those features come from files. A failed command
  fails only its feature and says why. Codex MCP env and header values are dropped while parsing.
- **Version awareness:** listings are cached with the version they were read from, and a changed
  version rereads them. Detection now computes a harness status (not installed, checking, up to
  date, update available, unknown, failed); an update shows a calm line on the agent's section and
  on the Agents page with the existing reviewed Update.
- **Sync per agent:** a per-device switch for Claude Code, Codex and Pi (General preferences), the
  sync review grouped by agent with Apply all, and a named hold for every edge case: agent missing,
  sync off, agent too old, marketplace missing (offered from the synced GitHub source in the
  review), installer needed, another OS, missing command path, foreign command path, retained after
  a failed install (that declaration restored through the journal), offline, and removed on another
  device. Synced MCP commands are classified before any filesystem access, so UNC, device, `..` and
  rooted `~` remainders are never probed (two security review findings, fixed with tests).
- Instruction files left this surface for the Instructions surface; aura-config keeps their code.

Verified locally on Windows after merging `origin/main`: `pnpm lint` (Biome, 28 warnings),
`pnpm typecheck`, `pnpm test` (root scripts 22, ui 296, desktop 5 node and 465 with 19 skipped,
design lab 352, web 4); `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D
warnings` and `cargo clippy -p aura-core --features account-sync --lib --tests -- -D warnings`;
`cargo test` for aura-config (117), aura-agents (97, with fake CLIs on temporary homes),
aura-protocol (26), aura-core lib with account-sync (566) and the desktop lib (210, bindings
regenerated). In Chromium and WebKit: `check-plugin-library`, `check-settings` (with
`check-config-sync`), `check-setup` and `check-agent-installations`, axe clean; `check-layout`
296 of 296 views clean, run against this branch's own dev server (another worktree held the
probe's default port). Sheets beside the
Vercel references are the ignored `target/design-research/sheets/app-plugins-*.png`. Not done: the
hand walkthrough of the built app, real listings against the owner's own homes (only sandboxed
homes were used), and the Windows and macOS CI run.

### App in Shallows (2026-10-28, branch `app-shallows`)

The owner picked direction B, Shallows, and asked for elite styling and motion everywhere,
including the small spaces. The app now draws no dither: it no longer imports the dither engine
(`packages/ui` keeps it for now). Built on the shared primitives from `site-shallows` (#22).

- **Intro**: a short Shallows moment inside setup's unchanged 1800ms hold. The window lights up like
  water seen from below, a seal and a turtle glide in on diagonals as black silhouettes, nose up and
  shrink into the places the logo's animals take, and fade as the logo forms out of them; then
  "auracode" rises. CSS keyframes on transform and opacity only. Warm launches and reduced motion
  show the formed mark still; Escape, Enter, Skip intro and sign-in links behave as before. The
  intro shares setup's water, so the hand-off only lifts the mark away before the card rises.
- **Setup**: window-wide lit water with a turtle, a seal and a far turtle that ease out of a fine
  pointer's way, behind one opaque card (radius 20, water-low, a lit rim and one long shadow) that
  holds every step. Progress is four soft bars whose fill sweeps in.
- **Shell**: the main pane is the rounded inset panel (radius 16) with a calm rim drawn outside it,
  its top edge lit and a faint light under the content; Settings and Diagnostics draw the same
  pane, and the chat and the right panel keep it when they split. The sidebar stays on black.
- **New chat and empty chats**: the pane fills with lit water, a seal and a far turtle that never
  yield to the pointer; the card and the composer float on it (radius 20, soft lit rim, one long
  shadow). New chat arrives in three soft steps; disclosures turn a quiet chevron.
- **Detection** (setup, Agents, New chat): one soft circular pulse while an agent is looked for,
  its mark dimmed; an eased check in a green-tinted circle once found, with the word and version
  settling; a calm red dot that only fades in on failure. One 16px slot holds every state.
- **Small spaces** (`motion.css`): sidebar rows take a layered fill that fades in and grows from
  96%, the open chat's fill settles under the row it moves to, and a chat that appears drops in;
  popovers grow from their anchor; dialogs lift out of a fading scrim; tooltips rise 2px; banners
  and notices drift in once; the send disc's arrow lifts into place. Every button settles to 97%
  while pressed; the primary pill and the send disc lean up to 3px toward a fine pointer through
  an inline `translate` (`lib/magnetic.ts`). Only transform, translate and opacity move; all of it
  stands still under reduced motion.
- **Docs**: `visual-language.md` 6.1, 6.2, 6.9, 6.13, 6.17, 6.17a, 6.19 and section 7's app clause.

Checks on this branch (merged with `origin/main` at 8207546): `pnpm lint` (28 warnings, all
existing descending-specificity notes in desktop CSS; the style guard passes), `pnpm typecheck`
and `pnpm test` pass: scripts 22, ui 296, desktop 5 node and 460 (19 skipped, 4 new magnetic
tests), design lab 352, web 4. In Chromium and WebKit, against this branch's own preview server:
`check-layout` (all 276 views clean), `check-chat` (16 axe scans), `check-new-chat-worktree`
(8), `check-terminal-panel` (7), `check-settings` with the fourteen checks it runs, and
`check-setup`, which now asserts the water covers the window with its three swimmers and no dither
or canvas remains. Also passing: `check-sidebar-footer`, `check-library`,
`check-setup-actions`, `check-agent-installations`, `check-chat-auth`,
`check-config-recovery`, `check-folder-resolution`, `check-repository-publication`,
`check-workspace-removal`, `check-account-reset` and `check-account-vault`; every axe audit
these run reports zero violations. Sheets next to the concept frames, at 1440x900 and 1024x700, are the ignored
`target/design-research/sheets/app-shallows-{intro,onboarding,detection,motion-detection,newchat,chat,settings-dialog}.png`.

Not done: the hand walkthrough of the built app; the minimized and idle CPU with New chat's
swimmers running was not measured natively; Agents and the Library stay full-window pages on
black (the Library belongs to `plugin-library`); the dither engine stays in `packages/ui`, unused by
the website and the app, for a follow-up to delete. CI was not run.

### Uninstalling deletes all of auracode's data (2026-10-28, branch `uninstall-wipe`)

The owner asked that uninstalling remove all app data, as if auracode had never been installed,
and what that means for the agents already installed. The answer is in
[uninstall.md](uninstall.md): the agents, their homes and the files auracode wrote there at the
person's request stay, and so do their sessions, repositories and branches. auracode's own data
goes.

- **One cleanup in Rust** (`aura_core::uninstall`, behind `account-sync`):
  - `plan` finds the data folder, the platform folders named after the bundle, the entries
    auracode made in an `AURACODE_DATA_DIR` folder, the updater's leftovers in temp, and every
    auracode worktree. Each worktree is checked with Git for uncommitted files and for commits no
    other branch, tag or remote has.
  - `execute` removes the secure-store index and the account keys it lists. In machine scope it
    then sweeps auracode's own service: Windows asks Credential Manager for the
    `auracode.sync.v1:` prefix only, macOS searches the keychain by service, and no other
    credential is read.
  - It then removes clean worktrees with Git's prune, and the folders. Links are removed as links
    and read-only files are cleared. Locked files are retried for about ten seconds and then
    listed.
  - Unsaved worktrees stay in place, unlocked, unless chosen. Branches are never deleted. A second
    run is a no-op.
- **`auracode --uninstall-cleanup`** runs that before Tauri starts:
  - A running copy is asked to quit through the single-instance hand-over
    (`--quit-for-uninstall`). It stops only its own agents and terminals, and its quit flow skips
    the question.
  - Exit codes: 0 done, 3 still running (nothing deleted), 4 something left (listed).
- **Windows uninstaller:** Tauri NSIS hooks run the cleanup before any file is removed.
  - The confirm page's checkbox now reads "Keep my auracode data", so deleting is the default;
    `/S` and `/P` delete quietly, and `/KEEPDATA` keeps everything.
  - Updates, and the in-place uninstall a newer installer runs, keep everything.
  - Tauri's own whole-folder step is off. The hooks clear the installer's registry records and
    Windows' notification settings.
  - If auracode will not quit, Tauri's check closes it and a copy of the program cleans up after
    the files are removed.
  - The bundle targets are now `app`, `dmg` and `nsis`, so no MSI ships without the cleanup.
- **Settings, About, This device, Delete all auracode data** (Windows and macOS):
  - Rust's one-use review lists every path with its size and where the keys are.
  - Worktrees with work saved nowhere else are named in a red-edged well and kept unless ticked.
  - It says what stays, offers the Trash on macOS (`NSFileManager`), and needs DELETE typed.
  - Applying starts the cleanup detached and quits.
  - A copy with its own `AURACODE_DATA_DIR` only ever touches that folder, and keeps account keys.

Verified locally on Windows, merged with `origin/main` at 80f61bd (unchanged since):
- **JavaScript:** `pnpm lint` (Biome, 28 existing warnings, style guard clean) and
  `pnpm typecheck` pass. `pnpm test` passes:
  - root scripts 22 and ui 296;
  - desktop node 10 (5 new uninstaller-hooks tests against the pinned CLI's embedded template)
    and Vitest 484 with 19 skipped (7 new);
  - design lab 352 and web 4.
- **Rust:** `cargo fmt --all --check` passes.
  - `cargo clippy -p aura-sync -p aura-core -p auracode-desktop --all-targets -- -D warnings` and
    the account-sync Clippy pass.
  - `cargo test`: aura-core lib with account-sync 581 (12 new, on temporary data folders with
    real Git and a fake secure store); aura-sync lib 56 with 2 ignored; desktop lib 219 (9 new;
    bindings regenerated).
  - The ignored Credential Manager test ran once against the real store, with a throwaway test
    prefix, and passed.
- **Browser checks** (Chromium and WebKit, against this checkout's own Vite, since other
  checkouts held 1426 and 1489):
  - `check-delete-data`: 12 axe audits, no violations;
  - `check-settings`, with its sub-checks;
  - `check-layout`: all 340 views clean.

Not done:
- Building and running the NSIS installer. makensis was not available, so the hooks were not
  compiled; the node test pins them to the template instead.
- The macOS Trash move, keychain sweep and dialogs: written but not compiled or run on this
  machine.
- The real uninstall and the in-app deletion were not run, by design.
- The hand walkthrough of the built app, and CI.

### One entry per agent (2026-10-28, branch `one-agent-entry`)

The owner asked why Claude Code and Codex each appeared twice ("Claude Code (ACP)", "Codex
(ACP)"): too complex. Now every list shows one Claude Code and one Codex, and the same holds for
Antigravity and Grok Build (their text fallbacks) and OpenCode (its 1.x and 2.x lines). The rule
and the data mapping are in [plan.md](plan.md), "One entry per agent".

- **Catalog and detection:** each catalog entry is a connection filed under its agent
  (`AgentSpec::agent`, with a label such as Direct or ACP adapter). Detection reports one
  `AgentEntry` per agent with its `connections`: Automatic uses the first connection that can run
  (native when the CLI meets its floor, else the adapter), an explicit Connection setting picks
  one, and when none can run the reason names what each lacks. Updates, sign-in checks,
  executable choices and Plugin library listings act on the connection in use.
- **Connection setting:** device-local `agent-connections.json` beside `agent-executables.json`
  (a damaged file means Automatic and is replaced on the next choice; one from a newer build is
  left unchanged), the `agent_set_connection` command, and a Connection row (the Graphite settings
  row) in Claude Code's and Codex's details on the Agents page, which also states the adapter's
  one-time download.
- **Existing data, no migration:** chats, project defaults and the New chat default saved as
  `claude-acp` or `codex-acp` (also from synced older devices) read as their agent. Native session
  rows keep the connection that made them, so a chat that ran on the adapter keeps resuming that
  session through the adapter, across handoffs to Codex and back; fresh sessions take the setting;
  a native fork keeps its source's connection (saved in the continuation, cleared once it starts).
  No stored id changes, so no schema version and no downgrade break.
- **Lists:** New chat, the composer's picker, onboarding's "Found N agents", the Agents page and
  the Plugin library read the same Rust list; onboarding no longer filters ids by suffix.
  `aura-cli agents` prints one entry per agent with its connection line; `aura-cli probe` and
  `smoke` still take connection ids, and a desktop smoke run given `claude-acp` sets Claude
  Code's Connection in its own data folder first.

Verified locally on Windows after merging `origin/main` (80f61bd): `pnpm lint` (28 existing
warnings), `pnpm typecheck`, `pnpm test` (scripts 22, ui 296, desktop 5 node and 481 with 19
skipped, design lab 352, web 4) and `.github/scripts/acceptance-gates.test.mjs` (6); `cargo fmt
--all --check`, `cargo clippy --workspace --all-targets -- -D warnings` and the account-sync
Clippy; `cargo test` for aura-agents (106), aura-protocol (26), aura-config (156), aura-cli (77),
aura-core lib (479, and 574 with account-sync) and its integration suites, and the desktop lib
(210, bindings regenerated). `session_lifecycle::shutdown_all_bounded` fails, identically on
`origin/main` (history read after the quit seal), so it is not from this branch. In Chromium and
WebKit: `check-setup` (now also one row per agent and the Connection setting, axe clean),
`check-settings`, `check-plugin-library`, `check-agent-installations`,
`check-new-chat-worktree`, `check-chat`, and `check-layout` (all 328 views clean). Before and after sheets
are the ignored `target/design-research/sheets/app-one-agent-{new-chat,agents}.png`.

Not done: no real agent ran (the adapter-session resume is covered by store and session tests
with fake drivers); the Agents page's opened details (the facts list's 33px rows) are off the 4px
grid, which `check-layout` does not open, and the Connection row sits under them; the hand
walkthrough of the built app; CI.

### Shallows finished across the app and the website (2026-10-28, branch `shallows-finish`)

The follow-ups `app-shallows` left: the website's product views, Agents and the Plugin library in
the inset pane, the unused dither engine, the Settings nav's motion and the swimmers' idle cost.

- **Website product views**: the hero's images are a fresh 2x capture of the desktop's
  `?preview=settled` (the inset pane, the logo and Settings at the sidebar's foot, round status
  dots), regenerated by the new `apps/web/scripts/product-images.mjs`; a 2240 wide WebP joins the
  480, 960 and 1440 sources for 2x screens. The six capability views are redrawn after the app's
  preview modes: New chat on lit water with its agent pills, a handoff waiting above the composer,
  the Changes panel beside the chat, the picker with Effort and Autonomy, the queue with Steer, and
  the sidebar beside the open chat. A view under 640px keeps each split's point.
- **Agents and the Plugin library** stand alone in the inset pane (`.pane-shell` in `App.tsx` and
  their previews; shell and container CSS only, the rows and their components untouched). Fills
  tuned for black (a row under the hand, an open row, the harness well) step up one surface there.
- **Dither engine deleted**: neither app imported it; `DitherField`, its engine, sprites, palettes,
  tokens, styles and tests left `@auracode/ui`, and a test guards that they stay gone.
- **Settings nav** takes the sidebar's layered hover and eased open-page fill.
- **Swimmer cost**, idle 10 s with the pointer outside, headed Chromium on this PC's 168Hz display,
  `SystemInfo.getProcessInfo` plus a trace: New chat's two swimmers cost 11.3% of a core in the
  renderer and 12.2% in the GPU process (168 frames a second, 0.4ms of main-thread work each), the
  website hero 17.3% and 19.6% (its shimmer alone 5.3% and 14.3%). Now the swimmers step about 30
  times a second at rest and ask for no frame between steps (`cadence.ts`), every frame only while
  one gives way to the pointer or settles back, and the shimmer steps along its eased curve: New
  chat 3.7% and 3.6%, the hero 7.0% and 8.7%. Reduced motion costs nothing. A minimised window
  drew no frames (under 1% each); Playwright's Chromium kept reporting it visible, so the hidden
  path was also checked by a `visibilitychange` to hidden: 0 frame requests in 3 s, creatures
  frozen, resumed on visible. Headless Chromium rasterises in software, so its GPU figures are not
  representative.

Checks on this branch (`origin/main` unchanged at 80f61bd): `pnpm lint` (28 warnings, all existing
descending-specificity notes in desktop CSS; style guard passes), `pnpm typecheck`, `pnpm test`:
scripts 22, ui 253 (the dither and sprite tests left, 3 cadence tests joined), desktop 5 node and
477 (19 skipped), design lab 352, web 4; the acceptance gate test (6). `pnpm --filter @auracode/web
test:browser` passes in Chromium and WebKit (axe on all six views, no overflow at 390 and 320), and
the built site ships no dither. `worker:build` and `worker:test` (5 of 5). In Chromium and WebKit:
`check-layout` 328 of 328 views clean, `check-plugin-library`, `check-settings` (with settings
navigation and its other checks), `check-setup` (Agents), `check-agent-installations`,
`check-sidebar-footer`, `check-chat` and `check-new-chat-worktree` (its WebKit run failed once on a
`newChatFixture` race before the preview mounted and passed on both reruns). Sheets are the ignored
`target/design-research/sheets/shallows-finish-{site-hero,site-capabilities,agents,plugin-library}.png`.

Not done: the hand walkthrough of the built app and site; real Safari; the CPU of the native
WebView2 window (measured in Chromium only). CI was not run.

### Agents: opened details on the 4px grid (2026-10-28, branch `agents-details-grid`)

The follow-up `one-agent-entry` left. An agent's details now continue the row's text column to
the kebab's edge: facts are 36px rows on a hairline drawn over their top, the label on the value's
baseline; the Connection row is the Settings row without the well's inset, on the same hairline,
with a one-line description ("Applies to new chats." then Automatic or the adapter's download);
one Updates fact replaces two and no longer repeats the row's update line; the executable list's
legend stacks 20 over 16. `check-layout` opens Codex direct and on its adapter, Claude Code with an
update, Grok Build not installed, Cursor broken, setup's compact roster and the executable choice;
the old details gave 7 to 18 grid findings each. The Agents fixture gains installations, a cached
release and Claude Code's Update action.

Verified on Windows: `pnpm lint` (28 existing warnings), `pnpm typecheck`, `pnpm test` (scripts
22, ui 253, desktop 10 node and 488 with 19 skipped, design lab 352, web 4), the acceptance gate
test (6); in Chromium and WebKit `check-setup`, `check-agent-installations`, `check-settings` and
`check-layout` (368 of 368 views clean). Sheet: the ignored
`target/design-research/sheets/agents-details-grid.png`. Not done: the hand walkthrough of the
built app; CI.

### Agents' own logos (2026-10-28, branch `agent-logos`)

The owner asked for "the actual logos" of the agents wherever the app and the site name them, and
then for "cool animations to those logos" on the site.

- **Which agents have a logo**: each vendor's brand kit or official repository was read, with its
  guidelines. Codex (the OpenAI Blossom, white), Cursor (the flat cube for dark backgrounds),
  OpenCode (its dark logo), Pi (its badge, in its dark-scheme colour) and oh-my-pi (its
  repository icon) are drawn as published. Claude Code (Anthropic allows its marks only in
  materials it approves beforehand), Antigravity (Google requires an approval request) and Hermes
  (Nous Research's terms forbid promotional use without written permission, and its only
  clear-background mark is illegible under 32px) keep their codes. Grok Build keeps GB because
  xAI's terms allow use only of the file at its download link, which refused automated
  retrieval; the bot check was not worked around. Sources, hashes, guidelines and terms, and how to
  add a mark, are in `third-party/brand-marks.md`; the notices page names the marks as their
  owners' trademarks, outside any auracode license.
- **AgentMark** draws the logo in its tile (2px margin up to 16px, then about a sixth), unaltered,
  at a per-mark optical scale; states still take its place, and a ghost keeps the logo at full
  strength in its dashed tile (vendors forbid dimming). The marks are flat SVG in
  `packages/ui/src/graphite/agent-logos/`, parsed into React shapes (no inner HTML) and tested to
  hold nothing but plain shapes and a name. `AgentLogo` draws a mark alone. Every existing use
  updated at once; the handoff above the composer and Settings' default agent gained a mark.
  `?preview=agent-marks` shows every agent at every size and state, and `?preview=settled&
  agents=lineup` offers a full lineup in the picker.
- **Website**: the capabilities panel's New chat and picker views show the marks; the first row's
  sentence and the FAQ answer that names the agents carry a row of all nine marks. They rise in
  24ms apart (done by 592ms), drift 1.5px on their own periods while on screen, lift 3px over a
  soft shadow under the pointer, and are still under reduced motion. Pointing at a mark in the
  capabilities row chooses it in the view (or lights Other agents); the rows wait 90ms before
  switching so the pointer can reach the marks. The hero keeps its text: four agents have no usable
  mark, and OpenAI's terms keep its mark smaller than auracode's own.
- **Idle cost**, headed Chromium at 1440 by 900, 10 s each, pointer outside: capabilities held on
  "Switch agents" (marks hidden) renderer 6.0%, GPU 4.5%, 26.6 ms/s main thread, 35.0 frames/s;
  held on "Your agents" (marks drifting) 6.6%, 4.4%, 30.8 ms/s, 36.8 frames/s. FAQ with the agents
  answer closed 10.5%, 14.7%, 53.7 ms/s; open 11.2%, 9.1%, 58.1 ms/s (the closing panel's water is
  in view in both). A hidden tab with the marks in view requested 0 frames in 3 s.
- The product images were regenerated with `product-images.mjs`; the settled chat shows no agent
  mark (Claude Code, named in text), so they came out byte-identical.

Checks on this branch: `pnpm lint` (26 warnings, all existing descending-specificity notes in
desktop CSS; style guard and instruction check pass), `pnpm typecheck`, `pnpm test`: scripts 23,
ui 260, desktop 10 node and 488 (19 skipped), design lab 352, web 4; the acceptance gate test (6).
`pnpm --filter @auracode/web test:browser` passes in Chromium and WebKit (axe on all six views,
CSP, no overflow at 390 and 320). `worker:build` and `worker:test` (5 of 5). In Chromium and
WebKit: `check-setup`, `check-chat`, `check-plugin-library`, `check-instructions`,
`check-new-chat-worktree`, `check-settings` (with the session fallback) and `check-layout` (170
views per engine, 0 findings). Sheets are the ignored
`target/design-research/sheets/agent-logos-*.png`.

Not done: the hand walkthrough of the built app and site; real Safari; approval requests to
Anthropic, Google and Nous Research and a hand download of xAI's kit, each of which would turn a
code into a logo; confirming oh-my-pi's canonical mark with its maintainers. CI was not run.

### Every agent's logo (2026-10-28, branch `agent-logos-more`)

The owner asked for real logos on the four agents that kept codes ("many other people are allowed
to use their logos ... I'm already handling the legal part"). Each mark is the vendor's own, as
its own site or kit publishes it today; `third-party/brand-marks.md` records the source, hash and
"used at the owner's direction; the owner is handling permissions with the vendor".

- **Claude Code**: the Claude spark from Anthropic's press kit, in Clay (its only published
  colour).
- **Grok Build**: the Grok mark exactly as x.ai's Grok page draws it, in `currentColor` (fg-1
  here). xAI's logo zip sits behind a bot check, which was not worked around.
- **Antigravity**: the white icon from Google's Antigravity press page.
- **Hermes**: the wing that the Hermes Agent site uses as its header logo, turned 45 degrees as
  that site shows it (the file stays upright). It reads as a wing from 24px; at 14 and 16 it is a
  small blue stroke. The repository's figure illustrations do not read under 32px.

Only custom ACP agents now show a two-letter code. The hero headline stays text. The notices page
names all nine marks.

Checks on this branch: `pnpm lint` (26 existing warnings), `pnpm typecheck`, `pnpm test` (scripts
23, ui 261, desktop 10 node and 488 with 19 skipped, design lab 352, web 4); `test:browser` in
Chromium and WebKit; `worker:build` and `worker:test` (5 of 5); `check-setup`, `check-chat`,
`check-plugin-library` and `check-layout` (170 views per engine, 0 findings) in Chromium and WebKit.
Sheets are the ignored `target/design-research/sheets/agent-logos-more-*.png`.

Not done: the hand walkthrough; the vendor permissions (owner); CI.

### Why a queued message waits (2026-10-28, branch `queue-unstuck`)

The owner: "even if i sent a message to it through aura code and its not working it just queues".
A queued prompt leaves the queue only when the session can dispatch, and nothing on screen said
why it could not. What kept prompts there:

- **Checkpoints.** The app saves a folder checkpoint before every prompt, and the prompt sits in
  the queue meanwhile, so each send first showed "1 queued"; a large folder made that long.
- **Starting.** A prompt sent while the agent starts (detection, adapter install, resume) waits
  for `Ready`, shown only as "1 queued".
- **No idle report.** Claude Code, Codex and Pi report their run state, and the queue waited for
  `idle` after each result. Claude Code stays `running` while its Stop hooks or background agents
  work, so the queue could wait without end; the Claude driver also refused any prompt before idle.
- **Held prompts.** Prompts queued at a restart, a stop, an error or a sign-in come back held and
  wait for Send queued, which released all of them at once; the queue did not say what held them.
- **Failed starts.** A failed start or a missing folder left prompts queued with no word in the
  queue (the error card was further up).
- **Not a cause:** another chat or a terminal in the same folder. Chats and terminals share a
  folder; only a revert, a Git action or the worktree setup reserve one, and those refuse a new
  message with an error instead of queueing it. A test shows a second chat in a working chat's
  folder sending at once.

Fixes:

- **The reason, typed in Rust.** `SessionInfo.queue_wait` (`QueueWait`): starting, working,
  finishing its turn (with since and sends-at), needs an answer (permission or question), saving a
  checkpoint, stopping, a chat change, start failed, sign-in, stopped, folder missing, workspace
  removed, or held after a restart, a stop, an error, a sign-in or a removed workspace. The chat
  actor recomputes it after every event and flushes a header when it changes; the attach snapshot
  carries it. Bindings regenerated.
- **Idle grace (15 s, `SessionTimings::idle_grace`).** An agent that reports work in progress with
  no prompt of auracode's open and nothing waiting for an answer counts as idle for the queue after
  15 s without its idle report; the log says so. Claude Code's own result-to-idle gap is
  milliseconds and Stop hooks take seconds, so 15 s never cuts a normal turn short, while a missing
  report costs only a moment. A late busy report after that cannot make the chat busy again or
  hold the next prompt; a late idle report changes nothing. An open request is never waited out,
  and an agent that only counts as idle is not idle-evicted. The native Claude driver now accepts a
  prompt after its result while Claude Code still works (Claude Code queues input it receives,
  `command_lifecycle: queued`) and still refuses one while its own prompt or a request is open; the
  synthetic `result-before-idle` fixture and its golden assert exactly that.
- **Send now (`chat_send_now`).** Moves the prompt to the front and releases it if held, then
  interrupts the running turn when the agent can interrupt (without holding the other prompts, as
  Esc would), skips the idle wait, or starts a stopped or failed agent. A starting agent, an open
  request or a saving checkpoint still comes first. A Git reservation's release now also dispatches.
- **UI.** The queue's head says why in plain words with a round dot (red only for a failure to
  clear) and the count after it, and offers the one action that helps: Send now (working, finishing
  its turn), Retry or Start, Recreate folder for a missing worktree, Send queued for held prompts,
  and Send on each held row. A message typed while the agent starts says "Once started" beside the
  send disc, and the placeholder says it goes once the agent has started. The still-working line
  (no output for a minute) offers Send now beside Stop when a message waits; the head then does not
  repeat it. `?preview=queue-*` shows eight cases.

Tests: `session_queue_wait` (11, scripted drivers on paused time: starting, Send now interrupting
and going next, the idle grace, an open request outlasting the grace, late reports after the
grace, late notifications after a turn-based agent's end_turn, a held prompt sent alone, a
restart-held prompt starting the agent, sign-in, failed start and missing folder, two chats in one
folder), a checkpoint unit test, the replay fixture, and vitest for the words, the queue's
actions, Send now in the chat store, the quiet line and the starting composer.

Checks on this branch: `pnpm lint` (26 existing warnings), `pnpm typecheck`, `pnpm test` (scripts
23, ui 261, desktop 10 node and 497 with 19 skipped, design lab 352, web 4); the acceptance gate and
webdriver-smoke unit tests (14); `cargo fmt --check`; Clippy `-D warnings` on aura-protocol,
aura-drivers (with replay), aura-core (with account-sync) and the auracode-desktop lib and tests;
aura-core 587 lib and 94 integration tests; aura-drivers 448 lib (with replay) and replay 3;
aura-protocol 23; auracode-desktop lib 219 (bindings regenerated, unchanged by the rerun).
`check-chat` (32 axe scans each, the eight queue cases and their actions) and `check-steering` in
Chromium and WebKit; `check-layout` 200 views in WebKit with 0 findings, and in Chromium 199 of 200
clean: the quiet line's buttons sat 6px in, so it is now 36px tall, and the eight queue cases and
steering then passed clean at both sizes. The sheet is the ignored
`target/design-research/sheets/queue-reasons.png`.

Not done: the hand walkthrough in the native app; aura-drivers' `conformance` and `codex_schema`
test binaries (Windows Application Control blocks them, 4551); a real agent run (none was sent);
CI.

### Milestone walkthrough of the Windows app (2026-10-28, branch `app-walkthrough`)

The whole desktop app walked by hand on Windows 11 (3840x2160 at 150%), in the native WebView2
window of a debug build from `main` (1ecd9b8), on throwaway data folders (`%TEMP%\auracode-walk\d`
and `d2`) and a scratch Git project. The window was driven over WebView2's DevTools port
(`TAURI_WEBVIEW_AUTOMATION`), with UI Automation and window messages for the folder picker, the
tray and minimize; Orca was not installed on this PC.

Walked, and passing after the fixes below: the first-launch intro (seal and turtle form the logo,
then setup's water); all four setup steps, Skip setup and the clone form (no clone started); New
chat (worktree chip by default, Local, the popover, the busy-folder consent); Demo chats
(streaming, Retry, Edit and resend, Fork, queue edit and reorder, Steer's "After this turn",
held messages, Changes and a revert that restored the files on disk); the terminal panel;
the Git dialog with a scratch repository and a saved worktree setup; the sidebar, Ctrl+1 to 9,
the logo and Settings foot; the command palette; every Settings page (General's switches and
autonomy, Instructions against the scratch project, Account, Configuration sync, Shortcuts,
About, This device, Delete all auracode data opened and cancelled, never confirmed);
Diagnostics; Agents (logos, details, Connection, the row menu); the Plugin library (looked
only); the quit question (Keep auracode open, then Stop agents and quit, no auracode child
left); the tray (tooltip, a click restores the window) and minimize.

Fixed (one commit each, tests where they fit):
- **Terminal panel**: Windows PowerShell never started ("The type initializer for
  System.Net.ServicePointManager threw an exception") and Command Prompt opened in `C:\Windows`:
  both were spawned from verbatim `\\?\` paths. Shells now start from the plain spelling.
- **Window**: the native caption was Windows' grey band above the black app; DWM paints it
  `--g-bg` with an fg-3 title.
- **Worktree setup**: a program typed as `PING.EXE` was not found (looked up as `PING.EXE.exe`);
  its failure note ended "arguments.. Review"; raw `invoke` failures read "Something went
  wrong." or "The terminal could not continue." instead of Rust's reason.
- **New chat**: choosing a project replaced the agent already picked with the project's
  default (Claude Code turned back into the demo agent).
- **Names**: worktree chats showed the worktree id as their project in the header and in Needs
  you; versions repeated the agent's name ("Claude Code / Claude Code 2.1.312"); "built in" in
  lower case; verbatim paths and "1 changed paths" in the Git dialog; "Reverted 2 file(s)".
- **Setup and Agents**: an installed agent sank among the absent ones when the roster unfolded;
  wrapped detail actions sat 12px off the column; the Agents page cut the catalog's verification
  sentence mid-word (now "Tested on 2.1.310" or "Untested") and counted the demo ("5 of 10" where
  setup says 4 of 9); the clone form showed a red error before a folder could be chosen.
- **Polish**: browser triangles on three disclosures; orphaned last words; the Instructions editor not wrapping; Edit and resend's
  full-width soft button; the sidebar's "Your projects and chats will appear here" under a
  project; missing terminal and sidebar shortcuts; Diagnostics' "+ Chats" and "orbs".

The queue, exercised on purpose with the Demo agent (no change made; `queue-unstuck` owns it):
every send, even to an idle agent, shows "1 queued" for 0.6 to 1 s while the header says "Saving
checkpoint before sending the prompt", then sends. Sent during a turn (normal and `/slow`), right
after a turn, while starting, after a cancelled `/hang`, and in a second Local chat on a busy
folder: each sent once the turn ended, none stuck. During `/hang` a queued message waits with
only "1 queued" until Stop, which turns it into "held" with Send queued. After a quit with a
queued message, the reopened chat shows it held; a new message then jumps ahead and is sent while
the older one stays "1 queued · held" with the agent Ready (still held 10 s later, 18:44Z) until
Send queued is pressed. While a worktree setup command runs, New chat has no composer at all.

Measured, auracode and its 7 WebView2 processes, 10 s each, New chat idle with its swimmers:
visible 8.3% and 5.3% of one core; minimized 0.6% and 0.9%. Real agents, one short turn each in
the scratch project: Claude Code 2.1.312 on Haiku 5.5 answered in 1.4 s; Codex 0.162.1 on
GPT-6-Luna in 3.2 s. Sheets are the ignored `target/design-research/sheets/walkthrough-*.png`.

Left, with reasons: the scrollbars keep Chromium's arrow buttons (styling them means turning off
`scrollbar-color` on Windows across every scroller), and the transcript column moves 8px left when
an answer first scrolls (a both-edges scrollbar gutter fixed it but set rows off the 4px grid, so
it was reverted; a fixed 8px custom scrollbar would allow both); a revert leaves its saved originals as
untracked `.auracode-revert-*` files inside the worktree (where to keep them is a backend
decision); worktree folders appear as project folders by their ids in New chat's and
Instructions' folder lists; a worktree chat's Git dialog still offers "Create an isolated
workspace"; the Demo agent's mark reads "MO"; the first New chat setup run once failed and a
second identical run worked (the reason now shows); the Plugin library took about 17 s to list.
The opened Instructions page first showed the owner's user-level `~/.codex/AGENTS.md` (the app's
default scope); it was switched to the scratch project and nothing outside it was edited.

Checks: desktop `tsc` and Vitest (494, 19 skipped), Biome (26 existing warnings), the notice
catalogue refreshed for the desktop manifest;
`cargo fmt --check`, Clippy on aura-process, aura-core and the desktop app with `-D warnings`;
`cargo test` for aura-process (193), aura-core's session tests (67) and the desktop window tests
(25). In Chromium and WebKit: `check-setup`, `check-setup-actions`, `check-chat`, `check-settings` (with
its sub-checks, after building the website it reads), `check-new-chat-worktree`,
`check-agent-installations`, `check-instructions`, `check-terminal-panel`, `check-git-review` and
`check-sidebar-footer`. `check-layout` in Chromium only (the owner was gaming, so one engine at a
time): 186 of 186 views clean; its `plugins#plugin-item` step was left out because it fails the
same way on `origin/main`'s frontend (the row menu closes when focusing its first item scrolls the
page). WebKit's `check-layout`, the native macOS build and CI were not run.


## 2026-10-29: Scoped secure-store cleanup

Replaced the cleanup's blanket service sweep with names-only discovery and one pure decision
routine shared by Settings review, CLI dry-run and execution. Only validated v1/v2 account
indexes and whole supported account bundles are classified. Foreign indexes protect references
under both production and preview, including removal receipts. Unknown or unreadable entries
retain all account keys and retry indexes. Custom-only cleanup preserves orphan bundles.

The review carries opaque target/value fingerprints to the child cleanup. Immediate replanning
can only narrow that set; changed or newly retained indexes protect their references. Account
deletion precedes owning-index deletion, and failures preserve retry indexes. Missing roots use
the nearest canonical existing ancestor and a validated suffix; ambiguous paths preserve keys.
Settings and CLI now show each opaque target's kind, decision and reason, plus warnings.

Native stores hold shared lifetime leases and cleanup holds an exclusive lease after target apps
exit. The permanent empty local-data `si.auracode.sync.v1.lock` file has no user data and is never
removed. No-follow opens, regular-file validation, nonblocking locks and explicit unlocks avoid
unlocked fallbacks. Dry-run branches before process waits, quit requests, deletions and Trash,
and opens an existing lease only. The uninstall guide removes blanket credential-deletion steps
and explains retained keys, retries, older binaries and the permanent lock.

Verification: aura-sync's vault filter passes 14/14, including temporary-file and subprocess
lease tests; aura-core's account-sync uninstall filter passes 26/26 with fake stores and temporary
data roots. Core/sync Clippy (all targets, account-sync, `-D warnings`) passes. Focused dialog
Vitest passes 8/8, uninstaller hook tests 5/5, and refreshed notice catalogue tests 6/6. Touched
frontend Biome, rustfmt, diff checks and instruction parity pass. Cargo.lock and catalogue input
hashes are refreshed. Malformed native entry names use opaque review aliases, and the inherited
ignored real Credential Manager mutation test was removed.

The desktop Rust uninstall test build is blocked before desktop source checking by E0463 in its
existing serde/specta/process_wrap/windows dependency graph. Its new dry-run dispatch and review
argument tests remain unexecuted. Generated bindings and integrated typechecking remain with the
coordinator. Native secure-store cleanup has not been run, including dry-run; no real credentials,
application data or agent homes were accessed. Native macOS integration remains unverified.

## 2026-10-29: durable revert recovery

Reverts save every selected original and its recovery manifest before the first working-file
mutation. Local profiles use private `checkpoints/reverts/<token>` groups. Account profiles keep
token-bound encrypted checkpoint child groups, including after a partial revert. The same-volume
swap still checks the actual renamed file before publishing replacement bytes and refuses to
replace a concurrent writer's path. Complete and partial reverts copy, verify and sync surviving
swap objects before unlinking their sources, so the durable store can be on another volume.

Legacy cleanup now requires bounded recovery metadata for an existing checkpoint in the same chat,
folder and canonical root, with expected regular-file entries. Invalid manifests, arbitrary UUID
directories, links, junctions and unexpected contents stay untouched. Interrupted cleanup retains
its earlier content catalogs and can resume. Storage or cleanup failure is an explicit revert error;
if saving and no-clobber restoration both fail, the only surviving copy stays available at the
reported recovery path. Recovery browsing/export still needs its separate UI integration.

Focused checkpoint and session-checkpoint tests pass with Account encryption enabled. They cover
Local/Account success and partial failure, backup failure before mutation, concurrent writes,
copy-path recovery, interrupted cleanup, invalid manifests, Windows junction preservation and
ciphertext-only Account recovery. Formatting and instruction parity were checked. Full integrated
checks, binding regeneration and macOS qualification remain integration gates.


### Revert recovery review follow-up

Independent review found missing sync of the first Local recovery root's parent, missing file and
parent sync before removing an emergency-restored original's staging link, and a legacy validation
handle dropped before cleanup. Recovery now retains that capability and exact journal, rejects
directory or journal substitution, syncs Local recovery parents on creation and retry, and keeps a
staged original if either emergency restoration sync fails. Windows directory-entry crash durability
is explicitly unverified because the existing directory sync helper is Unix-only. Added deterministic
parent/file sync failure and directory/journal substitution fixtures. The amended checkpoint and
session-checkpoint suite passes 33 tests. Aura-core Clippy passes with Account sync enabled and
with no default features, including test targets and warnings denied. Formatting, instruction parity
and diff checks pass. No native app walkthrough or cleanup of real data was performed.

## 2026-10-29: Durable setup admission and retained worktree discovery (in verification)

Worktree chats now persist setup state and generation before becoming visible. Their normal
conversation opens immediately, with setup review/output in the docked terminal panel and the
composer using the saved queue throughout. Rust gates explicit starts and dispatch, records
terminal-owner success only after confirmed cleanup, holds messages on failure and interrupts
unfinished attempts at restart. Retries review only the command, preserve copied files and reject
older generation tokens/completions.

A profile-scoped worktree registry route exposes retained folders whose chat could not be saved.
New chat and Project settings show their branch, source, retained path and detail, reviewed recovery
and Open folder. Recovery retains reconciled chatless records. Managed worktree folder labels name
the branch and source, New chat omits them as source folders, and Move chat keeps its destinations.
See `docs/worktree-setup-and-recovery.md` for execution and recovery behavior.

Verification: all desktop Vitest tests passed (504 passed, 19 skipped). Chromium passed the new
setup/recovery flow with Axe and the New chat checker with seven Axe scans; the running setup
screenshot was inspected. Core worktree tests passed 18/18 and terminal tests 16/16. With
account-sync, setup regressions passed 14/14 and migration/backup tests 12/12; core Clippy for the
library and tests passed with warnings denied. Biome, rustfmt and instruction parity passed.
Desktop binding export remains blocked by dependency E0463 errors for serde, specta, process_wrap
and windows. Generated bindings were left untouched; TypeScript checking is blocked on those new
types/commands. Native app and macOS verification remain integration gates.

## Plugin library progressive loading (2026-10-29)

The library publishes cached detection, cached listing rows and file inventory for all four supported
agents before starting listings, then publishes each completed provider independently through a typed
Tauri channel. At most two providers refresh at once; commands within a provider remain sequential
and overlapping listing requests share their work. Failed refreshes retain cached and file rows.
Generations reject superseded installation/configuration jobs, new reads cancel older requests, and
profile draining and shutdown cancel owned refresh futures. Renderer request lifetimes ignore stale
callbacks and replies after unmount, including StrictMode remounts. Initial detection is explicitly
checking. Cursor, Grok Build, Antigravity and Hermes remain unavailable, and OpenCode sync remains
unsupported. The Plugin library row-menu regression from d8bd025 is retained; its layout probe waits
for that menu's actual first focused item.

The controlled progressive browser fixture and the existing Plugin library/sync checks passed in
Chromium and WebKit with clean axe audits. The menu and item layout probes passed all eight
engine/viewport views. Focused Vitest passed 13 tests for progressive requests, stale replies/errors/completion,
unmount/remount, checking detection and existing section wording. aura-agents passed all 109 unit
and integration tests, including the shared fixture environment changes. The core Plugin library
assembly and account-sync integration suites passed four tests each.
The two General preferences tests also passed, including rejection of an OpenCode sync action.
All-target Clippy on aura-agents and aura-core with account-sync passed with warnings denied.

Controlled Windows measurements with temporary homes and delayed fake CLIs: cold first usable
648.9763 ms, fast provider 1.1081209 s while Claude remained blocked, all finished 1.2424665 s;
warm first usable 2.5796 ms and all finished 3.0168 ms. These measure the actual core stream with
fixtures, not owner CLI performance. Generated-binding typecheck remains an integration gate for
the coordinator. Standalone desktop checking stopped before app code with missing third-party
crate metadata (`paste`, `serde`, `url`, `schemars`, `json_patch`, `plist`); no third-party artifacts
were cleaned. No owner configuration, paid agent runs, hosted CI, deployments or releases were used.

## 2026-10-29: Instructions interruption recovery

Implemented version 2 journals with explicit backup, file publication, managed metadata and settlement
boundaries. Opening Instructions and applying later changes recover under the existing configuration
gate. Recovery rolls back only exact before/after/staged states, finishes committed metadata with an
entry comparison, preserves external edits, and blocks overlapping unresolved writes. Startup and
Instructions expose retained journal paths. Only settled journals count toward the newest-40 retention
limit; malformed and unresolved evidence stays. Legacy complete journals retain their evidence because
they did not record metadata intent. All verification fixtures use temporary or synthetic homes.

Verification: aura-config 170/170 tests (75 unit, 95 integration), all-target Clippy with warnings
denied, focused frontend tests 9/9, desktop TypeScript, touched frontend Biome checks, rustfmt and
instruction parity. Chromium and WebKit Instructions flows each pass 11 axe scans with zero
violations, including pending/recovered notices and the immediate overlap error with its backup
path; screenshots were inspected. The first Rust run caught a case-only rename recovery regression,
fixed by checking original content because rename mutations have no replacement bytes. The native
desktop startup-notice test and native binding export remain unrun because the shared desktop graph
has blocked dependencies; exported DTO shapes did not change. The dedicated Unix symlink interruption
test requires macOS verification.
### 2026-10-29: Setup admission review follow-up

Prelaunch setup failures now hold messages even when no process starts. Review tokens bind their
observed generation before apply admission. The Rust completion owner starts before expiry,
folder and reservation checks; a setup-specific native terminal reservation owns the prepared
launch across reserve/start IPC, and only its matching chat/token can claim it. Busy windows,
closed pending slots, expired reviews/commands and unavailable folders record failure. Stale or
unrelated tokens cannot fail replacement attempts. A successful retry keeps failed messages held.

Focused verification passed: account-sync setup regressions 16/16, all terminal tests 16/16, the
foreign-key index check 1/1 after updating its expected count to twenty, core Clippy library/tests
with warnings denied, and frontend API/terminal/setup tests 15/15. Existing worktree card and Git
review containers replace compact file rows and the single-row chat banner for rich recovery/setup
content; no CSS was changed. Root's integrated browser/layout recheck remains pending for those
container changes. Native bindings remain generated only by the integration owner.
Independent review found two admission races in this piece. Profile drain cancellation now holds a
scoped pause that rejects library requests registered after drain began, including a command that
already acquired its profile lease. Failed or abandoned transitions drop that pause and deliberately
reopen the current manager; successful retired managers remain shut down. Listing resolution now
captures the configuration revision before resolving the connection and installation, validates it
under the listing admission lock, and retries if the selection changed in that gap. Deterministic
boundary tests passed: detector admission 1/1, all agent unit tests 67/67, provider and selection
integration 6/6 each, core progressive integration 5/5 and core assembly 4/4. All-target Clippy for
aura-agents and aura-core with account-sync passed with warnings denied. The two native profile
lease tests are written but remain unrun because the desktop dependency graph is blocked before
app code. They remain an explicit integration gate.
## Task 6 review correction, verified

The independent round-1 review found two malformed-evidence gaps. Source now preserves validated
metadata identity hints even when journal schema validation fails, and uses one phase validator for
recovery and retention. Contradictory rollback/commit evidence is rejected before recovery writes,
and successful recovery must reach a valid terminal state. Added deterministic temporary-home
regressions for same-entry blocking versus unrelated writes, invalid identity hints, contradictory
markers with byte-preserved file/journal evidence, and malformed marker bytes. Verification passed:
aura-config 174/174 tests (79 unit, 95 integration), all-target Clippy with warnings denied, rustfmt,
instruction parity, and diff checks. The native startup-notice test remains unrun because the desktop
dependency graph is blocked; these fixes change no frontend or exported DTO shape.

### 2026-10-29: Preserve setup retry capacity after receipt expiry

Setup review admission now reclaims this chat's obsolete review before checking capacity. The
cache bounds 64 chats, each with its current generation command receipt and one replacement
review, so expired bound receipts preserve failure attribution without locking out retries.
The old command identity remains valid until retry apply replaces its generation; unrelated
chat receipts retain their generation identity.

The full-cache regression first reproduced the review refusal, then passed with the change.
All account-sync setup tests passed 17/17, including earlier prelaunch failure and queue-hold
regressions. Core Clippy library/tests with warnings denied, rustfmt and instruction parity passed.
Root also reported the integrated setup/recovery layout checks clean in sixteen
focused views across both browser engines. Native bindings remain an integration-owner gate.

### 2026-10-29: Setup acceptance fixture follows the integrated queue

The settings acceptance sweep exposed a fixture mismatch after FIFO held-row controls were
integrated: one held message offers Send it now, while Send all appears for multiple held rows.
The setup/recovery checker now uses that single-row action. Its native-free transport implements
selected-row sending, releases only the unheld prefix and queues new messages behind a held head,
matching the production actor contracts. The checker also verifies sending a later held row keeps
the other hold and that releasing the head sends the following unheld message in order.

Biome, JavaScript syntax and instruction parity checks passed. No production backend or UI changed.
The coordinator's failed settings log is the red evidence; both-engine settings reruns remain the
coordinator's gate after merging this fixture change. No Cargo or browser process ran for this fix.

### 2026-10-29: Close integrated journal cleanup and provider availability gaps

Custom data-root cleanup now includes app-owned clone lifecycle journals. A temporary-root test
creates real lifecycle records and two local Git clones, then verifies journal removal, unchanged
repository commits and untracked work, preserved unrelated custom-root files and a successful
repeat cleanup. Secure storage stays in the in-memory fake store throughout the test.

A provider whose installation disappears now loses its cached CLI listings and live timestamp;
the library falls back to the current file inventory. Refresh completion and subsequent opening
cannot retain stale Live rows. Admission validates provider detection generations so an older
missing result cannot erase a newer reinstall result. Actual listing-command failures still keep
cached rows with their failure warning. The integrated SessionInfo growth also required boxing
the mock driver's private event message; public protocol serialization is unchanged.

Both source findings reproduced before their fixes. Green checks passed: cleanup 27/27, core
library integration 6/6, assembly 5/5, agents unit 68/68, provider 7/7, selection 6/6 and mock-driver
20/20. Broad all-target Clippy for agents, core with account-sync and drivers with replay passed
with warnings denied, along with rustfmt, instruction parity and diff checks. This fix wave ran
no browser, server, owner store/configuration access, real cleanup, paid agent prompt or hosted CI.
Native compilation, bindings and the final integrated acceptance gates remain with the coordinator.

### 2026-10-29: Scoped cleanup acceptance fixtures

The delete-data browser checker still expected the old blanket key-deletion wording. It now
checks complete scoped decisions: deleted-root index, exclusive accounts and eligible orphan
bundles removed; foreign indexes and shared accounts retained, with their exact reasons and
unique opaque targets. A synthetic unknown-payload case retains every key and retry index and
shows the uncertainty warning on both Windows and macOS previews. Sharing alone has no such
warning. The narrow view also checks the populated key rows.

The preview and dialog unit tests share typed synthetic key data. No production cleanup behavior
changed and no native cleanup, Cargo or browser run was performed for this follow-up. Targeted
Vitest passes 9/9; touched-file Biome, checker syntax, diff and instruction parity checks pass.
Chromium/WebKit runtime verification remains with the integration coordinator.

### 2026-10-29: Verify scoped cleanup and unsupported Plugin explanations

The updated cleanup reviews pass in Chromium and WebKit, including shared and unknown entry
retention, failed-start retry, macOS Trash wording and narrow-window rendering. All 16 accessibility
audits and 12 focused layout views passed. The Plugin checker now explicitly verifies the explanation
for unsupported extension readers and OpenCode configuration sync; both browser engines passed.

The pinned pnpm 12.15.0 executable is now available. Frozen install passed across all seven workspace
projects without lockfile resolution changes. Pinned lint passes with 26 existing CSS specificity
warnings; UI typecheck and 261 tests, design-lab typecheck and 352 tests, web typecheck/build and four
static tests, and 29 root script tests pass. No dependency or production styling change was needed.

The refreshed core account-sync unit and integration suite passed 734 tests after the final backend
review fixes. A later setup hold-event visibility regression is being corrected separately. Native
compilation, binding export, integrated desktop typecheck and Windows hands-on acceptance remain
open under the host's application-control restriction. Nothing has been published from this train.

### 2026-10-29: Exact live queue holds across setup retries

The browser rerun exposed a production visibility gap: a second message typed during interrupted
setup was held in Rust but appeared unheld because another held row already existed. A separate
red browser assertion reproduced the same problem for a message queued during a retry when that
retry failed. Rust now includes the exact hold on queued lifecycle events and emits an update when
an existing queued row becomes held. Other lifecycle states leave that optional field empty, and
older producers without it remain readable.

The chat store uses this row truth without duplicating setup admission rules or reattaching. A
same-ID queue update preserves its position and creation time, so hold updates do not reorder the
queue or reset loaded conversation history. The setup fixture mirrors these authoritative events.
Focused store tests passed 49/49 after red regressions, including duplicate/old frames,
setup boundaries, mixed held/unheld rows, preserved history and exact reattach snapshots. A stopped
Sending row returns ahead of its followers with its original timestamp. Final
setup/recovery browser checks passed in Chromium (3.96 seconds) and WebKit (8.61 seconds), including
the later-held-row action, held-head FIFO and retry-failure updates. A full settings run passed both
engines in 174.83 seconds before the final mixed-hold extension; the final extension received the
focused both-engine rerun. Browser ownership was released with engines and server closed.

Rust setup and queue filters passed 18/18 each; protocol tests passed 24/24, including legacy
missing-field compatibility. Branch-local Clippy encountered the already-reviewed mock-driver
enum-size issue fixed on the coordinator's newer ancestor. The normal locked desktop exporter
compiled the native library and passed 1/1; its actual generated bindings are retained. Desktop
typecheck passed, followed by store/transcript tests 72/72. Broad integrated Clippy remains a
coordinator gate. Generated bindings were not edited by hand.

### 2026-10-29: Keep worktree branches visible in the chat header

The native walkthrough found that a managed-worktree chat's header showed only its source project.
The chat screen now follows the selected chat's project and folder IDs and passes Rust's existing
folder display label to the header. A worktree shows its branch and source beside the actual project
name, including custom project names. Local folders keep their display names without repeating an
equal project name. Missing workspace metadata retains the existing folder-name fallback.

The regression first failed for custom Local and managed-worktree labels, then passed after the
presentation fix. All desktop tests passed: 534 frontend tests with 19 existing skips, plus 10 Node
script tests. Desktop typecheck, changed-file Biome checks, stylesheet policy and instruction parity
checks passed. This change adds no Rust logic, generated binding edits or styling. Native and browser
acceptance remain with the integration coordinator.

### 2026-10-29: Exercise header labels through the normal chat acceptance gate

A development-only preview now mounts the real chat screen and its workspace/chat stores with
synthetic metadata. Sidebar selection exercises the stored project and folder IDs for a managed
worktree, a custom source project, a second Local folder in the same project, and equal Local
project/folder names. The worktree label uses Rust's full source-path format with a long Windows
path, rather than the shorter label used in the earlier markup test.

The new checker verifies all four selections in Chromium and WebKit at 1440x900, 1024x700 and the
native minimum of 960x640. All 24 views and accessibility scans passed. It checks the complete
accessible label and path tooltip, readable project/branch prefix, existing path ellipsis, clear
header controls and absence of horizontal overflow. Minimum and wide screenshots were inspected.
The normal check-chat command now invokes this checker on its existing server and forwards its
engine selection. The fresh integrated command passed both engines with 88 accessibility scans,
plus its queue, history, anchor, control, motion and minimum-window assertions.

An initial broad WebKit run timed out locating history-250 after scrolling to the first loaded turn.
The fresh integrated run passed that unchanged assertion without a product or synchronization fix;
the original failure log is retained and its cause remains unproven. Desktop tests passed 534 with
19 existing skips, plus 10 Node script tests; focused header tests, typecheck, Biome, instruction
parity, stylesheet policy and diff checks passed. No production CSS, Rust or generated bindings
changed. Owned browsers and the single preview server were stopped after verification.

### 2026-10-29: Keep Instructions recovery notice fixtures portable

The newly executable desktop library suite exposed a Windows test-path mismatch. The startup
notice was present and named the retained journal, but the fixture built its expected path with
mixed separators while directory enumeration returned normal Windows separators. A diagnostic
red run captured the existing notice; changing only the path construction to component joins made
the original assertion pass. No product notice or journal-recovery behavior changed.

The fixture now checks journals retained before boot and after startup, preserving the complete
notice/path assertion in both cases. It also verifies unchanged malformed journal bytes, no new
journal marker files and an untouched temporary instruction target. The focused regression passes.
The separately reviewed Demo catalog fixture now expects one visible entry per agent and verifies
all five alternate-connection groups, Automatic selection and their unavailable state on an empty
test PATH. Its real startup, transcript, shutdown and restart assertions remain intact.

Combined verification passed all 224 desktop library tests and all three Demo integration tests,
with no failures or ignores. Workspace formatting and desktop all-targets Clippy with warnings denied
passed. Both changes received independent source review with no findings. No production code,
generated bindings, owner configuration, credential access or visible application interaction changed.

### 2026-10-29: Integrated functionality and isolated Windows acceptance

All seven functionality changes and their independent review fixes are integrated locally:
canonical Sending and held FIFO, scoped cleanup, durable revert backups, compose during setup,
retained-worktree recovery, progressive Plugin inventory, interrupted Instructions recovery,
and interrupted clones. Native testing also found and fixed clone admission and worktree labels.
Backend decisions remain in Rust. The excluded styling, fade-mask, Demo-mark and site-flair work
was not imported.

The core account-sync suite passed 743 tests, including 102 integration tests. Workspace Clippy
and formatting passed. The ordinary full workspace run executed 2164 passing tests, two failing
desktop assertions and one intentionally ignored Worker-harness test. The two assertions were
corrected as documented above; the complete affected desktop library and Demo suites then passed
224 and three tests, with scoped all-targets Clippy and formatting. Three workspace targets were
unavailable under Windows Application Control: agents install, config sync_review and core
doctests. They are not passing results. The doctest block was confirmed through Code Integrity
events. No operating-system security settings or blocked artifacts were changed.

Pinned pnpm 12.15.0 frozen installation passes after the final manifest change. Frontend checks
pass with 534 desktop tests, 19 existing skips and ten Node tests; UI 261, design lab 352, web/static
four and root scripts 29 pass. Lint retains 26 existing CSS warnings. Actual native binding export,
414 runtime notice records, both Worker release builds and 28 isolated Worker runtime tests pass.
Both browser engines pass synthetic release validation and the affected acceptance suites. The
complete layout probe passed 412 views; the final normal chat checker passes 88 accessibility
scans, including long backend header labels at the minimum native size. The first WebKit history
wait timed out and passed unchanged on rerun; its cause remains unproven.

Windows hands-on acceptance used fresh isolated data, synthetic agent homes and scratch repositories
with Demo. It verified offline onboarding, conversations, held FIFO, prompt navigation, Changes and
reviewed revert, terminals, Instructions, Plugin rendering/menu stability, settings and shortcuts.
Setup failure and restart held all messages with reasons; reviewed retry succeeded and explicit
release delivered them once in order. Native Git checks covered visible handoffs, dirty-target
refusal, conflict preview, a reviewed two-parent merge, retained uncommitted files through retirement
and restoration, and committed-file recreation with a separate uncommitted backup preserved.
A real public clone succeeded and was added normally. Search and ordinary quit/restart/quit preserved
projects, history and preferences; both quits exited successfully.

The final embedded build passes. Its Demo smoke launch stays off this PC while gaming because
Windows smoke shows and focuses a window. The owner requested CI for the remaining verification;
workflow dispatch and its result are the next gate. Tray-icon reopen/quit could not be targeted
by the installed input tool, and notification clicks remain unobserved. Minimal real Claude/Codex
pipelines were exercised through Rust APIs; the Codex exact-text helper's punctuation deviation
remains recorded. No further paid turn was used. No owner agent credential or configuration files
were inspected or changed.

Windows shell fixtures retain six documented POSIX/executable-bit assumptions and PowerShell 5 is
policy-blocked; PowerShell 7 checks pass. Real account sign-in/email, native macOS hands-on acceptance,
signing/key backup and release/domain decisions remain owner/platform gates. Real cleanup, uninstall
and the product's real PR-creation flow were not used. GitHub billing availability, CI results,
publication and post-merge asset verification remain pending at this checkpoint.

### 2026-10-29: Correct the final CI acceptance inventory and layout deadline

After the owner resolved the Actions billing gate, the final hosted run executed the browser
checks. Chat acceptance passed, including the header-label checker launched by check-chat.
The CI inventory meta-test only followed static imports, so it incorrectly reported that child
checker as uncovered. It now also follows explicit Node child-checker invocations; removing a
checker from the invoked script graph still leaves it uncovered.

The complete layout probe reached 410 of 412 clean views with no findings before its 15-minute
step deadline. The final two views were not verified by that run. Only the complete layout step
now has a 20-minute limit; the meta-test keeps other browser steps bounded to 15 minutes.
Both meta-test failures were reproduced locally before correction. All 14 acceptance-inventory
and WebDriver script tests, changed-file Biome, workflow policy and instruction parity checks
pass. Full hosted layout completion remains pending, alongside the separately diagnosed Rust
workspace and native chat-smoke failures. No passing result is inferred from the timeout.

### 2026-10-29: Exercise the current native agent radio control in WebDriver

The external Windows test reached the embedded native window with matching WebView and driver
versions, but waited for a removed select option. Its retained DOM shows Demo ready in the current
radio group. The test now clicks Demo's visible label through WebDriver, then checks the associated
radio's checked state before creating the chat. The hidden radio input is not used as a visible
click target. Folder setup remains the only setup IPC; chat input, stop and reload still use the
external driver.

The scenario double now models the radio selection and rejects the stale option control, producing
three failing scenario tests before the harness correction. A negative case verifies that an
unchecked radio preserves the native-window result and prevents chat creation. All 15 acceptance
inventory/WebDriver script tests, changed-file Biome, instruction parity and diff checks pass.
The actual hosted Windows WebDriver rerun is still required; this entry records no native pass.

### 2026-10-30: Repair process spawning and the Windows link fixture exposed by CI

The completed hosted run passed both encrypted-storage jobs, PowerShell checks and generated
binding parity. The bootstrap artifact exactly matched committed bindings. Hosted Windows also
passed the three targets previously unavailable under local Application Control. Its ordinary
workspace run passed 2183 tests with one intentional Worker-harness ignore and one failing
relative-link fixture. macOS exposed a separate PTY lifetime failure. Neither full workspace
run is recorded as passing.

Owned process launches now serialize the short spawn boundary with PTY descriptor setup.
The previous shared spawn guard allowed concurrent launches to inherit temporary descriptors,
consistent with the macOS PTY test stalling until its sibling's 600-second lifetime expired.
Editor, cleanup-review Git, detached cleanup helper and macOS process-table launches use the
same boundary. The guard is released before waiting or draining output. Two deterministic
regressions failed before correction; 236 process tests and seven affected caller tests pass,
with scoped all-target Clippy and formatting. Independent review is complete. The actual macOS
runtime rerun remains required; the failed run did not capture the individual inherited descriptor.

The Windows relative-link fixture now constructs its target with native path components while
retaining the linked-folder traversal and canonical destination assertions. A Windows error-123
assertion preserves conservative classification of an invalid target. No production classifier
or test skip changed. All 79 configuration-library tests and scoped Clippy pass locally, but this
PC's existing missing-symlink-privilege skip means actual traversal must be verified on hosted
Windows. No security setting or owner data was changed.

### 2026-10-30: Stabilize the sticky prompt at the transcript boundary

Both hosted native chat checks stopped because the transcript reader could not reach the end.
A four-turn fixture using the real transcript reproduced an idle feedback loop: the sticky
prompt repeatedly reserved and released 32 pixels while scrollTop alternated by 64 pixels.
The content height stayed fixed. Prompt selection now uses a stable point in the surrounding
chat, and header removal compensates from the virtualizer's offset before viewport clamping.
Explicit return-to-prompt navigation retains its separate final alignment.

The normal chat acceptance command now observes 60 idle frames, uses wheel input, returns to
a later prompt, reads every turn through the unchanged native smoke reader, and checks that
appended output stays pinned. Chromium and WebKit pass these checks and the existing history,
focus, reading-anchor and minimum-window checks, with 88 accessibility scans. All 39 focused
scroll/smoke unit tests pass. Independent review is complete, and the integrated desktop
typecheck, 534 tests and ten Node tests pass with 19 existing skips. No styling, smoke-reader
limit or tolerance changed.

An earlier full browser run timed out at the existing history-250 wait. Six focused sequence
replays and the unchanged full rerun passed; that intermittent failure is retained without
claiming its cause was fixed. Hosted native chat, reopen and the complete layout probe still
require a final-source rerun.

### 2026-10-30: Keep the slow-folder test hook from delaying unrelated probes

The integrated account-sync rerun passed 640 library tests and failed the existing folder-list
responsiveness test before reaching integration tests. Its test-only delay retained a mutex
guard through the simulated slow-folder sleep, so an unrelated folder could also miss the list
deadline. This reproduced a previously intermittent assertion without involving process spawning.

The hook now releases its configuration lock before sleeping. The existing regression deliberately
starts the slow probe first and preserves its original deadlines, folder states and singleflight
assertions. It fails deterministically before the repair, then passes four consecutive targeted
runs afterward. The change is entirely test-only; production folder checks are unchanged.
Independent review, scoped all-target account-sync Clippy and formatting pass. The complete
account-sync test suite and final hosted CI remain pending at this checkpoint.

### 2026-10-30: Complete the final Windows and macOS functionality checks

[Final CI](https://github.com/itscool2b/auracode/actions/runs/40987992919) passed on
`b52beae2050579224bdb3c433780c4ce34c9e849`: all six executed jobs succeeded. The binding
refresh/bootstrap and comparison jobs intentionally skipped because this run used check mode.
Both platform jobs checked generated bindings against committed bytes; their downloaded exports
also matched exactly. The earlier refresh run's committed-byte and cross-platform comparisons
remain recorded. This entry changes only the verification record, not the tested application.

The ordinary workspace suites passed 2248 tests on macOS and 2186 on Windows, with zero failures
and one explicit compiled-Worker-harness ignore per platform. The separate Worker runtime checks
exercised that harness. Both encrypted-storage jobs, feature Clippy checks, workspace Clippy and
Rust formatting passed. The repaired macOS PTY suite passed all four tests in 0.74 seconds.
The final local core account-sync `--tests` run passed 743 tests, including 102 integration tests,
with no failures or ignores. Its only difference from the CI source was progress documentation.

Both native builds and stream checks passed. Chat passed 30 of 30 checks and reopen passed eight
of eight on each platform, including held queues, interrupted output and a persisted large blob.
Windows external WebDriver passed all five native-window, chat, interruption and reload checks
with matching runtime and driver versions. The previously blocked local install, sync-review and
doctest targets passed on hosted Windows; this does not imply a local security-policy change.

The complete layout probe passed all 412 views. Chromium and WebKit chat checks passed the prompt
boundary and header-label assertions alongside 88 accessibility scans. Settings, Plugins,
Instructions, account recovery, clone/setup, worktrees, terminals, cleanup-review fixtures,
website and synthetic release checks all passed, as did Worker builds/runtime tests and the
remaining workflow/script checks. Local desktop verification passed 534 tests and ten Node tests
with 19 existing Vitest skips. Hosted macOS ran all 553 Vitest tests; its Node suite passed eight
and skipped two Windows-only NSIS-template checks, which passed in the local ten-test suite.
The normal website build and four static tests passed; its file hashes
are retained for deployment verification. Lint retains 26 existing CSS warnings.

Original failures remain recorded. The browser history wait passed unchanged on rerun, with no
claim that its intermittent cause was fixed. The minimal headless Claude/Codex pipelines remain
qualified separately: Claude's result-to-idle gap and subsequent queue passed, while Codex's
strict helper expected `ok` and received `ok.`. No extra paid turn was used. Native macOS hands-on,
invited sign-in/email, tray-icon targeting and unobserved notification clicks remain open alongside
signing/key backup and installer/release/domain approvals. No real cleanup/uninstall or owner
agent credential/configuration file inspection occurred. Finished PR publication, the authorized
merge and deployed-asset checks follow this verification checkpoint.
