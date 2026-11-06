# Changelog

Every pull request merged into `main`, newest first, under the day it merged (UTC). Each pull
request adds its own line in the same pull request; see "Changelog" in
[docs/developing-in-aura.md](docs/developing-in-aura.md). `node .github/scripts/check-changelog.mjs`
checks the format.

## 2026-11-06

- Load earlier brings a chunk of the chat at once: it keeps fetching until 20 more turns appear, even through a turn of tens of thousands of tool updates, and keeps those updates folded so long chats stay light. ([#100](https://github.com/itscool2b/auracode/pull/100))
- New chat's agent picker opens downward like a select, so a long list no longer runs under the title bar and hides its search field. ([#99](https://github.com/itscool2b/auracode/pull/99))
- The owner plan's status records item 9: the release tooling is done, and the signing credentials and first runs remain. ([#98](https://github.com/itscool2b/auracode/pull/98))
- A Release workflow builds signed macOS, Windows and Linux packages, verifies them with aura-release, publishes them to staging or stable, and points the download page at a stable release; it waits for the signing credentials in docs/releases.md. ([#97](https://github.com/itscool2b/auracode/pull/97))
- Releases include Linux: the download page lists Linux beside macOS and Windows, a release carries the AppImage, deb and rpm with their checksums and update signatures, and auracode on Linux updates itself like the other platforms once a signed release is out. ([#96](https://github.com/itscool2b/auracode/pull/96))
- The third-party notices fingerprint the desktop package again after #94 added a command to it, so the website builds and deploys. ([#95](https://github.com/itscool2b/auracode/pull/95))
- Tests catch up with #81 and #82 and with a model change handing the thinking level to the agent, and CI also checks dictation, images and the Processes page in Chromium and WebKit. ([#94](https://github.com/itscool2b/auracode/pull/94))
- auracode runs on Linux: deb, rpm and AppImage packages, built on Ubuntu 22.04 so they run there and on newer distributions, with the tray, notifications, Keep awake, sounds, dictation, Bash and Zsh terminals, opening files in VS Code, Cursor or Zed, and added agent accounts kept in the desktop keyring (GNOME Keyring, KWallet). ([#93](https://github.com/itscool2b/auracode/pull/93))

## 2026-11-05

- Share an agent's own MCP server with every agent: in Plugins & MCP, Preview and copy, then Share with every agent makes it a shared server for every project, with its keys and header values kept on this device. Agents that cannot take shared servers (Antigravity, oh-my-pi, restricted connections) now start without them and say so, instead of refusing to start. ([#92](https://github.com/itscool2b/auracode/pull/92))
- Terminals come back after a restart: a chat's terminal panel offers the shells it had open, under their names, and Run, and starts them again on Resume. Nothing starts by itself, and their earlier output is not kept. ([#91](https://github.com/itscool2b/auracode/pull/91))
- Run in worktree chats: a Run command saved in the folder's setup, beside its setup command, starts from the chat's header in the worktree's terminal panel, with its address to open, until Stop. Each worktree keeps ten local ports of its own, the first in AURACODE_PORT for setup, Run and the worktree's terminals and in PORT for Run, so worktrees can serve side by side. ([#90](https://github.com/itscool2b/auracode/pull/90))
- File names open in your editor at their line: paths an agent writes in its answers (`src/app.ts:42`, a link to a file, or a path in a sentence), a step's files, the changed-files card and a diff's Open, once auracode has checked the file is in the chat's folder. Settings > Chats chooses the editor. On Windows, Cursor and Visual Studio Code now open directly, without their confirmation prompt. ([#89](https://github.com/itscool2b/auracode/pull/89))
- Sounds: a setting (Settings > General, off by default) plays a short, quiet tone when a chat finishes, fails or needs you, rising, falling or two taps, for the same moments as notifications but also while auracode is in front. ([#88](https://github.com/itscool2b/auracode/pull/88))
- Find in chat: Ctrl+F (Cmd+F on macOS) opens a bar that counts a word or phrase in your messages and the agent's answers, highlights every match, and steps through them with Enter and Shift+Enter, scrolling to matches in long chats and opening folded work where one sits. ([#87](https://github.com/itscool2b/auracode/pull/87))
- Commit and push from the Git workspace dialog: choose the changed files and write the message, review the exact commit (author, files, stat), then push the branch to its upstream or origin, fast-forward only, creating the remote branch and its upstream when needed. Git hooks do not run and nothing is staged unless the commit succeeds. ([#86](https://github.com/itscool2b/auracode/pull/86))
- Changes shows each change with three lines around it and folds the rest, diffs long files line by line, and reverts one change on its own: Revert above a change puts back just its lines from before the turn, through the same preview and recovery as whole files. ([#85](https://github.com/itscool2b/auracode/pull/85))
- Review in Changes: comment on any line of a diff, by pointer or keyboard, and send the comments to the agent as one message that quotes each line with its file and number; or ask the agent to review the changes and report problems before it changes anything. Unsent comments wait while the panel or the chat closes. ([#84](https://github.com/itscool2b/auracode/pull/84))
- ACP agents' commands show their output as it comes and their exit code, where they said "terminal output is not available". ([#83](https://github.com/itscool2b/auracode/pull/83))
- MCP servers' forms and browser steps now show in Claude and Codex chats (they were cancelled), checked field by field; and the Session tab lists what the session loaded: MCP servers with their state, skills, plugins and subagents, as each agent reports them. ([#82](https://github.com/itscool2b/auracode/pull/82))
- Fork into a new chat from the latest answer continues Claude's or Pi's own session, with everything it knew; Rewind on a sent message restores the files from before it and goes on to edit it, from auracode's checkpoints or, in Claude chats, from Claude's own copies of what it edited; and Pi can be steered while it works. ([#81](https://github.com/itscool2b/auracode/pull/81))
- Answers colour their code in the theme's colours, set math with KaTeX (inline and on its own line), and draw Mermaid diagrams, with their code a click away. ([#80](https://github.com/itscool2b/auracode/pull/80))
- An opened tool call shows what it was given; a web search lists the pages it found as links; JSON and MCP replies are set out over lines; an edit's row counts its changed lines; Claude's to-do list shows as the turn's checklist; and a compacted conversation shows where it happened, with Compact conversation in the chat's menu. ([#79](https://github.com/itscool2b/auracode/pull/79))
- Settings is one screen with a search that finds any setting: General, Appearance, Chats, Voice and Shortcuts, then Agents, Plugins & MCP, Instructions and Project memory (Customize opens there), then Account & sync, Data & privacy and About. Chats can keep finished turns' steps open, Voice tests the microphone, and controls keep keyboard focus while they save. ([#78](https://github.com/itscool2b/auracode/pull/78))
- Dictation is built in and has no time limit: bundled Parakeet and Silero models run on this device, the words appear live at the cursor as you speak, Finish sweeps them into the draft and Cancel dissolves them. ([#77](https://github.com/itscool2b/auracode/pull/77))
- A finished turn folds its work under "Worked for 1 min 42 s · 12 steps" above its final answer, as Codex does, with a card under the answer naming the files it changed. ([#76](https://github.com/itscool2b/auracode/pull/76))
- More of a chat fits on screen: its text sets at 14/22 and answers run the whole column, with a Comfortable text size in Settings for the earlier size. ([#75](https://github.com/itscool2b/auracode/pull/75))
- Claude Code's theme is the default for profiles that never chose one; a saved choice, Aura included, is kept. ([#74](https://github.com/itscool2b/auracode/pull/74))
- The composer's controls are quiet ghost pills with only Send filled, the account shows as its initial ringed by its usage, the model pill names the model Default stands for, and the picker reads models, thinking, then every agent, always in view. ([#73](https://github.com/itscool2b/auracode/pull/73))

## 2026-11-04

- Themes: Settings offers one for every supported agent (Claude Code, Codex, Grok Build, Pi, Antigravity, Cursor, OpenCode, oh-my-pi and Hermes) beside Aura, each in light and dark, applied at once and saved in the profile. ([#72](https://github.com/itscool2b/auracode/pull/72))
- Grok Build and Hermes show their plugins and marketplaces (Hermes: skill sources), Claude Code marketplaces show their source again, and every Marketplaces section can add one from a GitHub repository, an https Git address or a local folder. ([#71](https://github.com/itscool2b/auracode/pull/71))
- See every process the agents run: a Processes page lists each chat's subagents, background commands and every program its agent started (even ones whose parent exited), with Stop; earlier turns' tasks stay in reach in the chat, and Stop says it also ends running tasks. ([#70](https://github.com/itscool2b/auracode/pull/70))
- Add this changelog, kept current by every merge, with a format check in `pnpm lint`. ([#69](https://github.com/itscool2b/auracode/pull/69))
- Dictation records on Windows: routine audio glitch reports no longer end every recording after a tenth of a second, and Whisper's AVX2 build transcribes 11 s of speech in 0.65 s instead of 18 s. ([#68](https://github.com/itscool2b/auracode/pull/68))

## 2026-11-03

- Website: Fraunces Italic accents, a seamless two-lane marquee and site-wide polish. ([#67](https://github.com/itscool2b/auracode/pull/67))
- The working line shows the logo of the company whose model is working. ([#66](https://github.com/itscool2b/auracode/pull/66))
- Subagents and background commands appear above the composer and open into a panel that follows their progress. ([#65](https://github.com/itscool2b/auracode/pull/65))
- Website: the brand-colour glows are gone, with the depth they gave replaced. ([#64](https://github.com/itscool2b/auracode/pull/64))
- Switch a Claude Code chat's account from the composer, see usage per account and review plans before they run; the app loses its glows. ([#63](https://github.com/itscool2b/auracode/pull/63))

## 2026-11-02

- Desktop updates are verified after installing, and the previous app comes back if the new one fails to launch. ([#62](https://github.com/itscool2b/auracode/pull/62))
- Image attachments show thumbnails before sending and in history, with an enlarged preview. ([#61](https://github.com/itscool2b/auracode/pull/61))
- Offline Whisper dictation in the composer, after a one-time verified model download. ([#60](https://github.com/itscool2b/auracode/pull/60))
- Agent CLIs installed while auracode runs, and native Windows Cursor runtimes, are found without a restart. ([#59](https://github.com/itscool2b/auracode/pull/59))
- Settings links open the shared Customize sections. ([#58](https://github.com/itscool2b/auracode/pull/58))
- Questions and permission requests appear one at a time, in the order they arrived. ([#57](https://github.com/itscool2b/auracode/pull/57))
- Active turns show one working line with its elapsed time, and tool disclosures open smoothly. ([#56](https://github.com/itscool2b/auracode/pull/56))
- The model picker switches models reliably and keeps the thinking level in view. ([#55](https://github.com/itscool2b/auracode/pull/55))
- Agents edit project memory directly, with a switch back to review. ([#54](https://github.com/itscool2b/auracode/pull/54))

## 2026-11-01

- A Claude chat that hits its usage limit continues on another added account, with its history. ([#53](https://github.com/itscool2b/auracode/pull/53))
- Record the verified host upgrade in the development guide. ([#52](https://github.com/itscool2b/auracode/pull/52))
- `host-upgrade` hands the installer an empty folder and verifies the binary it writes. ([#51](https://github.com/itscool2b/auracode/pull/51))
- `host-upgrade` snapshots keep the installed files themselves, so a rollback restores a binary Windows still allows. ([#50](https://github.com/itscool2b/auracode/pull/50))
- Refresh the third-party notices catalogue after #48. ([#49](https://github.com/itscool2b/auracode/pull/49))
- Develop auracode safely from inside auracode: development builds get their own data folder and instance. ([#48](https://github.com/itscool2b/auracode/pull/48))
- New worktree chats get the folder's Git-ignored `AGENTS.md` and `CLAUDE.md` by default. ([#47](https://github.com/itscool2b/auracode/pull/47))
- Halo: the website and the desktop app restyled, with glass windows over the native window material. ([#46](https://github.com/itscool2b/auracode/pull/46))
- Access and Plan controls beside a searchable agent, model and effort picker, shared MCP servers and project memory. ([#45](https://github.com/itscool2b/auracode/pull/45))

## 2026-10-31

- Automatic checkpoints become opt-in, so ordinary messages send without snapshot work. ([#44](https://github.com/itscool2b/auracode/pull/44))
- Local checkpoints add far less delay before a prompt reaches the agent. ([#43](https://github.com/itscool2b/auracode/pull/43))

## 2026-10-30

- One Aura visual system for the website and the desktop app; the desktop follows the system appearance with Light and Dark overrides. ([#42](https://github.com/itscool2b/auracode/pull/42))
- An interrupted clone keeps its state and offers safe recovery. ([#41](https://github.com/itscool2b/auracode/pull/41))
- Interrupted Instructions changes recover without losing edits made outside auracode. ([#40](https://github.com/itscool2b/auracode/pull/40))
- The Plugin library fills in agent by agent, and its row menus stay put. ([#39](https://github.com/itscool2b/auracode/pull/39))
- The composer stays usable while a new worktree is being set up. ([#38](https://github.com/itscool2b/auracode/pull/38))
- Revert keeps verified originals and recovery manifests in app data before changing a repository. ([#37](https://github.com/itscool2b/auracode/pull/37))
- Credential cleanup touches only auracode's own entries, and concurrent copies of the app are protected. ([#36](https://github.com/itscool2b/auracode/pull/36))
- Sent messages reconcile by prompt ID, and held messages keep their order. ([#35](https://github.com/itscool2b/auracode/pull/35))
- Reliable sending and held queues, composing during setup, safe recovery and cleanup, and progressive plugin inventory. ([#34](https://github.com/itscool2b/auracode/pull/34))

## 2026-10-28

- Fixes from the Windows walkthrough: the terminal, title bar, setup, names and New chat's agent. ([#33](https://github.com/itscool2b/auracode/pull/33))
- A queued message says why it waits, and never waits forever for an idle report. ([#32](https://github.com/itscool2b/auracode/pull/32))
- The Claude, Grok, Antigravity and Hermes logos join the others. ([#31](https://github.com/itscool2b/auracode/pull/31))
- Each agent's real logo in the app and on the site, with motion on the site. ([#30](https://github.com/itscool2b/auracode/pull/30))
- An agent's opened details on the Agents page sit on the 4 px grid, and the layout probe opens them. ([#29](https://github.com/itscool2b/auracode/pull/29))
- Shallows follow-ups: today's app on the site, one pane, the dither removed and lighter swimmers. ([#28](https://github.com/itscool2b/auracode/pull/28))
- One entry per agent: the ACP adapters become a connection setting. ([#27](https://github.com/itscool2b/auracode/pull/27))
- Uninstalling removes all of auracode's own data, and Settings can do the same. ([#26](https://github.com/itscool2b/auracode/pull/26))
- Shallows in the app: lit water, the chat in an inset panel and motion in the small spaces. ([#25](https://github.com/itscool2b/auracode/pull/25))
- Instructions: one `AGENTS.md` for every agent or a file per agent, reviewed before every write. ([#24](https://github.com/itscool2b/auracode/pull/24))
- Plugin library: one section per agent, read from the agent's own CLI, with update status and per-agent sync. ([#23](https://github.com/itscool2b/auracode/pull/23))
- Shallows: the website rebuilt in lit water, with shared primitives. ([#22](https://github.com/itscool2b/auracode/pull/22))
- Fixes from Windows acceptance, including writes lost on quit, and a clean sidebar foot. ([#21](https://github.com/itscool2b/auracode/pull/21))
- M3: clone a repository, an optional account step, and more agent installs and sign-ins. ([#20](https://github.com/itscool2b/auracode/pull/20))
- Account tests take turns, and the merge and production API are recorded. ([#19](https://github.com/itscool2b/auracode/pull/19))
- Windows native acceptance and the defects it found. ([#18](https://github.com/itscool2b/auracode/pull/18))
- A docked terminal panel, conflict help and more editors. ([#17](https://github.com/itscool2b/auracode/pull/17))
- Close the remaining M2b and M2c gaps. ([#16](https://github.com/itscool2b/auracode/pull/16))
- New chats get their own worktree automatically, Codex-style. ([#15](https://github.com/itscool2b/auracode/pull/15))
- Create a chat in its own worktree, and recreate deleted worktrees. ([#14](https://github.com/itscool2b/auracode/pull/14))
- Every app screen redesigned on the Grok, Vercel and X Money references. ([#13](https://github.com/itscool2b/auracode/pull/13))
- A reviewed one-click OpenCode install on the Agents page. ([#12](https://github.com/itscool2b/auracode/pull/12))
- One styling system for the desktop app. ([#11](https://github.com/itscool2b/auracode/pull/11))
- Publish a verified release stage safely. ([#10](https://github.com/itscool2b/auracode/pull/10))
- Tests for the search behind the command palette. ([#9](https://github.com/itscool2b/auracode/pull/9))
- The website rebuilt on the reference landing pages. ([#8](https://github.com/itscool2b/auracode/pull/8))

## 2026-10-27

- The seal and turtle logo everywhere. ([#7](https://github.com/itscool2b/auracode/pull/7))
- M2a: the design system, the transcript and the Graphite redesign. ([#6](https://github.com/itscool2b/auracode/pull/6))
- A Rust-first, Cloudflare-only project foundation. ([#4](https://github.com/itscool2b/auracode/pull/4))

## 2026-10-26

- Fix the two tests that failed main's first macOS and Linux runs. ([#3](https://github.com/itscool2b/auracode/pull/3))
- M1a: sessions, processes, the ACP client and the first real agent chats. ([#2](https://github.com/itscool2b/auracode/pull/2))
- M0: the scaffold, foundations, CI and spikes. ([#1](https://github.com/itscool2b/auracode/pull/1))
