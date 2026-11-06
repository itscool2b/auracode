# Owner requests, 4 November 2026

**Goal:** the owner's 4 November list, approved that day ("do whatever u think is best", then
"do all these changes test and then we figure it out"). One `codex/` branch and pull request per
item, each with its changelog line, tests, both appearances, a native check where it runs natively,
and a hands-on walkthrough before merging.

**Decisions** (the owner left them to Claude):
- Dictation bundles NVIDIA Parakeet TDT-CTC 110M (GGUF, CC-BY-4.0) through `transcribe-cpp`
  (MIT), not Nemotron Speech Streaming 0.6B (475 MB): it is smaller than the Whisper base it
  replaces, makes about a quarter fewer errors, and keeps every installer small.
- Finished turns fold into "Worked for" by default, with a Settings > Chats switch to keep them open.
- Thinking shows live while a turn runs and inside "Worked for" afterwards. This reverses the rule
  that reasoning rows are never rendered.
- Signing: Apple Developer ID for macOS (the owner has the account), Azure Artifact Signing for
  Windows (the owner is a US individual, so eligible).

## Items, in order

1. **Composer buttons and the model picker** (`codex/composer-picker`).
   - Ghost pills at one size (28px, 13px); only Send is filled.
   - The account becomes an initial ringed by its usage; the workflow is an icon until Plan is on.
   - The model pill names the model an alias stands for and only a chosen thinking level.
   - The picker reads search, models (five, then "More models"), thinking, then all agents in a
     grid that is always in view.
2. **Claude Code as the default theme.** New profiles and missing or unknown values; saved choices
   are untouched; Aura stays in the gallery.
3. **Denser transcript, like Codex.** Measured against the owner's Codex screenshot:
   - Aura caps prose at 600px, indented 24px in a 720px column, at 15/24; Codex runs about 745px
     at about 14/23, roughly 40% more text per screen.
   - Change: prose uses the full column at 14/22, list items lose their extra gap, rows sit 12px
     apart, the agent name shows only when the agent changes, and older answers' actions appear on
     hover or focus.
   - Settings > Appearance gets Text size: Compact (default) or Comfortable (today's).
4. **Finished turns fold into "Worked for".**
   - At the turn's end, interim messages, tools, thinking and answered cards fold into one row:
     "Worked for 2m 14s · 12 steps".
   - Under it: the final answer, then one card naming the files the turn changed, with Review
     (opens Changes).
   - The final answer is the run of messages that ends the turn.
   - Never folded: the last message, errors, unanswered questions, plans waiting for Accept,
     a steer. Turns without tools get no row. Old chats fold too.
   - Moved to item 7: per-file Open and Open in (with "open a file at its line"), file-type icons
     on links in answers, and reading Codex's `final_answer` phase in its driver.
5. **Dictation.**
   - Parakeet 110M (about 105 MB) plus Silero VAD v6.2, bundled.
   - Loaded once and kept warm, 2 to 4 threads, nothing while silent, no time limit.
   - Live ghost text at the cursor. Finish sets it with a sweep; cancel dissolves it and restores
     the draft.
   - Errors show inside the bar. Multilingual Whisper stays an optional download.
   - Windows x64 and ARM64, macOS and Linux.
6. **Settings.**
   - One screen with search: General, Appearance, Chats, Voice, Shortcuts; Agents, Plugins & MCP,
     Instructions, Project memory; Account & sync, Data & privacy, About.
   - Customize becomes a shortcut into it. Fix General's radio focus loss during saves.
7. **Missing features**, four pull requests.
   - **A, transcript:** inline diffs, tool inputs, Claude's to-do list, compaction and a Compact
     action, web search links, formatted MCP output, syntax highlighting, Mermaid, LaTeX.
   - **B, session control:** native fork and rewind (Claude `rewind_files` exists without a caller),
     Pi steering, MCP elicitation forms, ACP terminals and file access, what a session loaded.
   - **C, review loop:** diff comments sent to the agent, hunk revert, commit and push, Review
     changes.
   - **D, small touches:** find in chat, optional sounds, open a file at its line, worktree run
     scripts with ports, resume terminal sessions, share a native MCP server with every agent.
8. **Linux.** A port in the owner's WSL Ubuntu: AppImage, .deb and .rpm built on Ubuntu 22.04.
9. **Official builds and the download page.**
   - A manual release workflow: signed macOS universal, signed Windows x64 and ARM64, Linux.
     `aura-release` publishes to download.auracode.si, staging, then stable.
   - The website catalog updates itself.
   - Prerequisites, with the owner: Azure identity validation (started early, as it takes days), the
     Developer ID certificate and an App Store Connect API key, the Tauri updater key (its backup
     kept by the owner) and a Cloudflare R2 token.

## Status

- [x] 1. Composer buttons and the model picker (#73, merged 2026-11-05)
- [x] 2. Claude Code default theme (#74, merged 2026-11-05)
- [x] 3. Denser transcript and the Text size setting (#75, merged 2026-11-05)
- [x] 4. Worked-for fold and the changed-files card (#76, merged 2026-11-05). The switch to keep
  steps open moves to item 6, Settings > Chats.
- [x] 5. Dictation (#77, merged 2026-11-05): Parakeet 110M and Silero VAD bundled, live ghost text,
  no limit, the sweep and the dissolve, failures in the bar. Two threads proved cooler than four.
  Deferred: the optional multilingual Whisper download (transcribe.cpp runs Whisper models too),
  and native macOS and Windows ARM64 runs, which need their builds.
- [x] 6. Settings (#78, merged 2026-11-05): one screen with search, its pages in three groups;
  Customize and Agents open on their pages; Voice with a microphone test; Chats with Keep steps
  open; every change saves in turn without disabling its control, which fixes the radio focus
  loss. Also: the Agents page's red status text meets 4.5:1 in Claude dark.
- [x] 7. Missing features A, B, C, D.
  - [x] A, first part (#79, merged 2026-11-05): tool inputs, web search links, formatted JSON and
    MCP replies, edit line counts, Claude's to-do list as the plan, compaction notices and
    Compact conversation. Inline diffs were already there.
  - [x] A, second part (#80, merged 2026-11-05): syntax highlighting (highlight.js), math (KaTeX)
    and Mermaid diagrams. Mermaid's optional ELK layout is left out: elkjs is EPL-2.0 or GPL-3.0.
  - [x] B, in three pull requests.
    - [x] First part (#81, merged 2026-11-05): native fork for Claude and Pi from the latest answer;
      Rewind on every sent message, on auracode's own checkpoints where the turn has one (every
      agent, shell changes too) and otherwise, in Claude chats, on Claude's `rewind_files`,
      since Automatic checkpoints are off by default; Pi steering. Native fork from an earlier
      answer waits: Claude resumes at a transcript entry id that auracode does not store per
      turn yet.
    - [x] Second part (#82, merged 2026-11-05): MCP input forms for Claude and Codex, which before
      were a silent cancel (Claude) or a cancel with a notice (Codex): forms from the MCP form
      schema and browser steps, checked by one rule in the session and both drivers. And what
      a session loaded, in the Session tab: Claude reports MCP servers with their state, skills,
      plugins, subagents and its tool count; Codex its MCP servers as they start; Pi its
      skills. No agent is asked anything new for it.
    - [x] Third part (#83, merged 2026-11-05): ACP agents' terminals, which showed "terminal
      output is not available": auracode advertises Zed's display-only terminals, so an agent
      such as codex-acp streams a command's output to it, shown live and with its exit code.
      Client file access and client-run terminals stay off on purpose: the agents run commands
      and use files themselves, and auracode has no unsaved buffers to offer, the reason ACP has
      them.
  - [x] C, in three pull requests.
    - [x] First part (#84, merged 2026-11-05): review in Changes. A comment on any diff line, by
      pointer or keyboard, waits until sent or discarded (also while the panel or the chat
      closes, until auracode quits); Send gives the agent one message quoting each line with its
      file and number. Ask the agent to review sends a request for problems by file and line,
      the most serious first, before any change. Sending follows the composer: queued while a
      turn runs, held while a request waits for its answer. Comments need a line diff, so a file
      over 400 lines, which Changes shows as a replacement, takes none.
    - [x] Second part (#85, merged 2026-11-05): one change reverted on its own. Changes shows each
      change with three lines around it and folds the unchanged stretches; Revert above a change
      previews its lines alone (bound to the file's hash, so a later edit makes it stale) and goes
      through the same one-use token, recovery copy and Stop rule as whole files. The line diff
      now sets aside the lines both texts start and end with, so a long file's edit diffs line by
      line (up to 2,000 changed lines a side, and Changes' 128 KiB per text), which also lifts
      the comments' 400-line limit.
    - [x] Third part (#86, merged 2026-11-05): commit and push from the Git workspace dialog, so
      the pull request flow no longer needs a terminal first. Commit changes lists the changed
      files to choose from and a message; its review shows the branch, parent, author, signing
      and stat. The commit is built in a private index and recorded with `commit-tree` and a
      compare-and-swap `update-ref`, so it holds exactly the reviewed contents, nothing is staged
      unless it succeeds, and the person's other staged work stays. Push this branch reviews a
      fast-forward to the upstream (or origin, setting the upstream), with the remote's address
      shown without credentials, and never forces. As with every Git command auracode runs, the
      repository's hooks do not run (an agent could have written them) and Git asks for no
      sign-in, so a push needs Git's stored credentials.
  - [x] D, in several pull requests.
    - [x] Find in chat (#87, merged 2026-11-05): Ctrl+F opens a solid bar at the transcript's top right that counts the query in messages and answers (tool calls and cards are not searched), highlights the matches with the CSS Custom Highlight API and the shown one in the theme's action colour, and steps with Enter and Shift+Enter. A match in a row the virtual list has not rendered is brought into view, and one in a finished turn's folded work opens the fold while it is shown. Matches count in the loaded messages; the bar says so when earlier ones are not loaded.
    - [x] Optional sounds (#88, merged 2026-11-05): Settings > General > Sounds, off by default. The native shell already decides when a chat finished, failed or needs you (for notifications); with Sounds on it also tells the window, in front or not, and the window plays a short synthesized tone (Web Audio, so no sound file ships): rising for finished, falling for failed, two taps for needs you. Turning Sounds on plays one. Windows and macOS, where the native shell runs; Linux follows with item 8.
    - [x] Open a file at its line (#89, merged 2026-11-05): file names in answers (inline code, links to files, paths in sentences), a step's files, the changed-files card and a diff's Open become links once Rust has checked that they name a file inside the chat's folder; a click opens it at its line and column in Settings > Chats > Open files in (the first editor detected until one is chosen). The check matches absolute paths against the folder as text before touching the disk and follows no link, so a path elsewhere (a network share included) is never opened; a bare name or partial path names the one file that ends with it. Each file type has its icon. On Windows every editor now starts from its own executable (Cursor and VS Code with `--goto`), which also spares Project tools' Open in editor the confirmation their URL handler asks each time; macOS keeps the URL handler for those two. Left for later: reading Codex's `final_answer` phase (moved here with this from item 4).
    - [x] Worktree run scripts with ports (#90, merged 2026-11-05): the folder setup recipe gains a Run command (program and arguments, the setup command's rules), and a worktree chat's header gains Run, which starts it in the worktree in a docked terminal tab showing its address, and Stop. Each managed worktree keeps a block of ten local ports from 25000 to 31999 (below every ephemeral range), stored in its registry entry the first time one is needed, skipping blocks another live worktree holds or this machine cannot bind; the first port goes to setup, Run and the worktree's project terminals as AURACODE_PORT, and to Run as PORT. Run holds the worktree like a project terminal, so worktree changes wait until it stops. Also: the model pill's accessible name says the shortened level a narrow window shows, so speech control finds it by its visible words.
    - [x] Resume terminal sessions (#91, merged 2026-11-05): closing the window to the tray already kept terminals running (it only hides the window), so what was lost was a restart. Each chat now remembers, in the window's storage, which terminals its panel had open (shell, name if renamed, whether Run was going, and whether the panel showed), from the person's own actions only, so quitting, which stops every shell, leaves the record as it was. After a restart the chat's panel offers them back by name; Resume starts each again (Run where the chat can still run), Not now forgets them, and a new terminal withdraws the offer. Nothing starts by itself, and no output is kept, as the panel says.
    - [x] Share a native MCP server with every agent (#92, merged 2026-11-05): an agent's own MCP server (Claude, Codex or Pi configuration) gets Share with every agent in its library preview; its entry, reparsed and checked against the reviewed revision, goes through Shared MCP's native import as an all-projects definition, with env and header values kept as this device's local credentials and only their names shared. Secrets in commands, arguments or URLs, and vendor options, refuse. Shared MCP had blocked Antigravity and oh-my-pi (whose configuration auracode cannot read), restricted fallback connections and other hosts from starting whenever any shared server applied; they now start without shared servers and say so in the chat, as the docs' "compatible agents" promised.
    - Codex's final_answer phase (moved here from item 4), examined and left unwired on purpose: Codex 0.162 marks agent messages commentary, partial_answer or final_answer (or nothing, for older models). The fold already takes the run of messages that closes a turn as its answer, which is what final_answer marks in practice, since commentary precedes tools and is folded with them. The one difference, a turn cut off after commentary, is better served by showing that message than no answer, so carrying the phase through every message event would change nothing a person sees.
- [x] 8. Linux (#93, merged 2026-11-06): deb, rpm and AppImage from `pnpm bundle`, the release ones built on Ubuntu 22.04 (`build.yml`), and CI's Rust and encrypted storage jobs on Ubuntu 22.04 too, with Xvfb for the smoke runs. The native shell runs there: an AppIndicator tray (checked for before the tray loads it, since a missing library panics), notifications over D-Bus, Keep awake through systemd's inhibitor lock, and so Sounds. Terminals offer Bash and Zsh; files open in VS Code, its Insiders build, Cursor and Zed; added agent accounts and sync keys use the Secret Service. The window is opaque. Verified in the owner's WSL Ubuntu: the debug app's stream and chat smoke runs (33 and 8 checks), the whole workspace's tests and Clippy, a real GNOME Keyring round trip, the bundled speech models on `jfk.wav` (exact, 14.6% of real time), and the installed deb's smoke runs. Fixed on the way: every directory sync through cap-std failed on Linux (its directories are `O_PATH` descriptors), which broke Revert's recovery copies, encrypted profiles, clone journals and Plugin library copies there; a linked instruction file counted as a copy problem; and stale Linux-only tests. Not verified: Fedora and openSUSE installs, a desktop session's tray and notifications (WSL has neither), and a real microphone.
- [ ] 9. Official builds and the download page. The tooling is done; the owner's credentials and the first runs remain.
  - [x] Linux in releases (#96, merged 2026-11-06): aura-release takes the AppImage, deb and rpm, the download page lists Linux, and the updater runs there. `pnpm bundle --signed-updater` had never worked (the CLI checks its signatures against the empty `plugins.updater.pubkey`); it now gets the key, and a throwaway-key run in WSL produced and verified all seven roles.
  - [x] The Release workflow (#97, merged 2026-11-06): preflight, signed bundles for the four targets (Developer ID and notarization, Azure Artifact Signing, Linux updater signatures), aura-release prepare, verify and publish, and for a stable release the website catalog commit that makes the download page update itself.
  - [ ] Owner prerequisites, listed with their values in docs/releases.md ("Official releases"): the Tauri updater key pair (kept backed up), the Developer ID certificate as .p12 and an App Store Connect API key, Azure Artifact Signing's account, certificate profile and an app registration, and a Cloudflare API token for R2. Then connect `download.auracode.si` to `auracode-releases`.
  - [ ] First runs: Release with publish off (signing check), then staging, an installed staging build updating to the next staging version, then stable.
