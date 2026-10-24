# auracode: implementation plan

## Context
The user runs many coding agents (Claude Code, Codex, Antigravity, Pi / oh-my-pi, Cursor, Grok Build,
OpenCode, Hermes...) and hates toggling between apps. auracode is one desktop app (macOS, Windows, Linux)
with a ChatGPT-style interface: projects on the left, chats inside projects, any installed agent driving a
chat through its real harness (headless, rendered in our UI, never a terminal). The base app needs no login.
A website at auracode.si lets people create an account and download the app; the same account signs into
the app and syncs projects, chats, and agent config (Claude Code, Codex, Pi) across machines. The bar: the
most beautiful app of its kind, a killer onboarding, dead simple, every edge case handled.

## Decisions (user-confirmed unless marked)
- **Stack:** Tauri v2. Everything that isn't UI is Rust (agent processes + protocols, detection, updates,
  git, storage, search, sync, crypto); UIs are React + TypeScript; the small web API is TypeScript.
- **Agents:** one generic ACP client (most agents) plus native Rust drivers for Claude Code, Codex, Pi.
- **Platforms:** macOS, Windows, Linux; agents auto-detected wherever it runs, including WSL on Windows.
- **Default autonomy: Full auto**, with per-turn checkpoints, isolation, and a visible badge as safety net.
- **Data:** local SQLite per profile on each device (works offline, no login). Cloud split:
  - **Neon** = the database (Postgres) + Neon Auth (users, email codes, JWTs).
  - **Cloudflare** = DNS, the website and API (Workers), downloads and encrypted blobs (R2), bot protection
    (Turnstile), inbound mail forwarding (Email Routing).
  - **Resend** = outgoing email (sign-in codes) from `@auracode.si`.
- **Website:** landing page, downloads (auto-detected OS), sign up / sign in, account page (devices, export,
  delete), legal pages. Same accounts as the app.
- **Accounts:** passwordless email code, on the site and in the app; seamless account switching in the app.
- **Sync scope:** projects + chats + config; config only for Claude Code, Codex, Pi.
- **Domain:** stays registered at Namecheap; nameservers move to Cloudflare. The user's existing Cloudflare
  zones all use `asa.ns.cloudflare.com` + `rohin.ns.cloudflare.com`; the auracode.si pair is confirmed
  the moment the zone is created (first execution step).
- **(My recommendation, user may veto) End-to-end encrypted sync.** Chats contain code and secrets. Cost:
  a new machine is approved from a signed-in one or uses a recovery key.
- **Trust:** never read, store, or proxy agent credentials; auracode never injects hidden prompts.

## Machine facts (verified 2026-10-24)
- macOS 26.6.2 arm64, rustc/cargo 1.99, Node 26.0.0, npm 11.12, git 2.54, gh 2.92 logged in as itscool2b
  (ssh, repo scope), Homebrew 6. No pnpm/bun. Global git user.name is NOT set (email is).
- Installed agents: Claude Code 2.1.310, Codex 0.164.0, Hermes 0.22.5 (`hermes-acp`), Antigravity CLI `agy`
  1.4.7. Not installed: pi, omp, opencode, gemini, cursor `agent`, grok (leftover config dirs prove nothing).
- Claude runs a `claude daemon` with helpers in separate process groups (one orphaned to launchd); Codex has
  a shared app-server daemon with its own updater; the ChatGPT app bundles its own codex.
- This dev environment exports `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_EFFORT`: children must not inherit them.
- The user's code lives under `~/Desktop` (macOS privacy-protected).
- Claude Code syncs account-level skills/plugins itself (`~/.claude/{skills,plugins}/synced/`): never touch.
  Shared cross-agent skills live in `~/.agents/skills`.
- Cloudflare: account `megagrb16@gmail.com`, three active free zones (arjunbajpai.com, mijonion.com,
  wpsservice.com), no auracode.si zone yet. Resend and Neon MCPs connected.

## Product principles
1. Simple first: zero setup, no login needed, everything auto-detected, one composer box, smart defaults.
2. Real harnesses, not reimplementations: each agent keeps its own auth, config, tools, skills, plugins.
3. No hidden instructions. The only thing auracode adds to a prompt is the visible handoff block when you
   switch agents or devices. (The "let the agent chill" philosophy.)
4. Local-first; cloud only for accounts and sync.
5. Every animation means something: the orb and the aura are live state, not decoration.

## UX spec: app
**Design language "Aura".** The active agent's colour radiates softly behind the glass as a slow light
field; thinking intensifies it, waiting-for-approval turns it amber, switching agents cross-fades it.
Dark-first, near-black base, three glass elevations, hairline gradient borders, squircle corners
(generated `clip-path`, since WebKit lacks `corner-shape`); grain and specular highlights are Design Lab
options. Spring motion (Motion only; it also drives timelines). Messages fade/rise in per block. Honours
reduced motion. Fonts bundled (OFL): Geist (UI), Instrument Serif (hero moments), Geist Mono (code).

**Layout.** Frameless translucent window: Liquid Glass on macOS 26+, vibrancy on older macOS, Mica on
Windows 11 (dark fallback on Windows 10), tuned CSS translucency on Linux. Sidebar (collapsible to icon
rail): wordmark, New chat, search, Projects (expand to chats; each row has a live mini-orb: running / needs
approval / done-unseen / error), agent dock with update badges, account menu, settings. Main: centred 760px
transcript + floating glass composer. Right panel (toggle): Changes, Files, Plan, Session info.

**Chat.** User messages in subtle right bubbles; agent output full width under an agent glyph with an
agent + model tag. Thinking as a collapsible "Thought for 12s" pill. Tool calls grouped ("Read 3 files",
"Edited App.tsx +12 -3", "Ran npm test") expanding to diffs, ANSI output, search results; long output capped
in the UI with the rest loaded from disk. Inline permission cards (outside Full auto) with shortcuts and an OS
notification when unfocused. Sticky plan checklist above the composer. Turn footer: duration, tokens, cost
if known, files-changed chip. Every message: copy, edit-and-resend, retry, fork into a new chat. Titles come
from the agent when it provides one, else the first line (never a hidden title prompt).

**Composer.** Auto-growing input; `+` attach (images, files), `@` file mentions (fuzzy, git-aware), `/`
slash commands (agent-advertised + /switch /model /new). One pill "Claude Code · Opus · High" opens agent >
model > effort; autonomy toggle; Send/Stop. Typing during a turn queues (or steers where supported); Esc
interrupts, a second Esc force-stops.

**Autonomy.** Full auto (default) / Auto-edit / Ask. Full auto = Claude `bypassPermissions` (falls back to
`acceptEdits` with a notice if the user's settings forbid bypass); Codex `approvalPolicy: never` +
`danger-full-access` (Auto-edit = `on-request` + `workspace-write`); agy/ACP bypass modes where advertised,
otherwise auracode auto-answers permission requests; Pi/oh-my-pi never ask anyway. A "Full auto" badge sits
on the composer and orb rim; switching into an agent that can't ask (Pi) shows a notice.

**Thinking orbs.** One WebGL2 canvas draws every visible orb through scissor viewports. Shader in the
style of the MIT ElevenLabs orb / Paper Shaders (soft ovals, flow warp, ring noise, colour ramp) with
per-agent palette and motion signature, morphing into the agent's logo via a committed SDF atlas (msdfgen)
and `mix(orbSDF + noise, logoSDF, t)` plus curl-noise warp. Polished first for Claude (terracotta spark),
Codex (monochrome liquid, cursor-blink core), Pi (precise orbit, pi glyph), Antigravity (blue-violet star,
upward drift); then Cursor, Grok, OpenCode, oh-my-pi, Hermes; a neutral aurora + monogram for anything else.
States: idle, thinking, streaming, tool, waiting, error, done. Idle 20-30fps, DPR <= 2, paused offscreen,
recovers from WebGL context loss; static poster fallback without WebGL2. CSS mini-orbs in the sidebar.
Official logos are fine for a private build; swap to inspired glyphs before public release (trademarks).

**Boot cinematic.** ~2s, skippable, short on warm launches, skipped when opened from a notification or link,
off with reduced motion. Window created hidden and shown after first paint; shaders compile during the dark
opening; plays from cached detection and reconciles live (never waits on the shell). Darkness, particles
converge, orb ignites, a light sweep reveals the wordmark (placeholder SVG slot for the user's logo),
detected agents ignite as orbiting orbs and dock into the sidebar as the glass UI resolves.

**Onboarding (showpiece; every step skippable; under a minute; keyboard-driven; resumable; re-runnable):**
1. Boot flows into a welcome line with the breathing orb and "Get started".
2. Discovery: the orb splits into one orb per agent as results stream in, each igniting in brand colour
   with version and sign-in status; known-but-missing agents appear as ghost orbs with Install. No agents
   at all: install suggestions plus a "Try the demo" chat driven by the scripted mock agent.
3. Account (switched on in M6): "Sync across your machines": email then 6-digit code, or "Skip, use
   auracode locally". First device: recovery-key card (copy / save / confirm). Additional device: "Approve
   on your Mac" (matching short code on both screens) or "Use recovery key", then "Restoring your
   workspace": projects and chats fly into the sidebar, and a config summary ("Claude Code: +3 skills, +1
   plugin") asks once before applying.
4. Make it yours: accent + motion level (Cinematic / Subtle / Minimal), previewed live.
5. First project: drop a folder, pick one, or clone from GitHub (searchable via `gh`); the orb flies into
   the composer with a starter suggestion.

## UX spec: website (auracode.si)
Same Aura design language and `packages/ui` components (the orb is the hero), fast and static where possible.
- `/` landing: cinematic orb hero, "every agent, one aura", agent logo row, glass feature sections, primary
  Download button for the visitor's OS, secondary "Create account".
- `/download`: OS-detected primary button plus every platform (macOS universal DMG, Windows x64 + arm64
  installers, Linux AppImage + deb), version, release notes, SHA-256 checksums, install notes (Gatekeeper /
  SmartScreen steps while builds are unsigned), system requirements.
- `/signup`, `/signin`: email then 6-digit code, Turnstile against bots, resend cooldown.
- `/account`: email, devices (name, platform, last seen, revoke), sync storage used, "sign out everywhere",
  data export, delete account (confirmed by a fresh email code).
- After signup: "Download auracode" plus "Open auracode" (`auracode://signin?email=...` opens the app on
  its sign-in step with the email prefilled; shown next to Download since the site can't know if it's
  installed).
- `/privacy`, `/terms`, `/changelog`. `.si` is an EU domain and accounts hold emails, so GDPR basics apply:
  privacy policy listing subprocessors (Neon, Cloudflare, Resend), export, deletion (draft for the user to
  review; not legal advice).
- Works without WebGL (poster image) and with reduced motion; download page works without JavaScript.

## Projects, chats, agent switching
- **Project** = name + colour + 1..n folders + optional default agent/model. Folders have a portable
  identity (git remote URL + default branch, or "local-only on <device>") separate from the device-local
  path, which is what lets projects sync across macOS/Windows/Linux.
- **Chat** = one primary folder; extra folders become add-dirs only where the agent supports them, and the
  chat header shows exactly which folders it can reach.
- **Isolation (M4):** "Direct" vs "Isolated" (git worktree on a new branch `aura/<slug>`). Until M4, a second
  chat in a busy folder gets a warning. From M4, auracode asks before isolating.
- **One thread, many agents.** Switching agent resumes that agent's native session if it has one in this
  chat (sending only what happened since its last turn), else starts one in the same cwd; either way the
  first prompt carries a visible, token-budgeted handoff block (earlier user messages, other agents' final
  answers, files changed + `git diff --stat`). Agents that can't resume (restart, cwd change) take the same
  handoff path. Model/effort switches stay inside the native session where supported.
- **Checkpoints (M2):** before every turn, a snapshot into a shadow git repo per folder
  (`<profile>/checkpoints/<folder-id>.git`, temp `GIT_INDEX_FILE`, refs under `refs/aura/*`). Never touches
  the user's index, branches, or stash, and works in non-git folders. One-click revert of any turn.

## Architecture
```
auracode/                        Cargo workspace + pnpm workspace
  crates/
    aura-protocol/               AuraEvent, commands, capabilities, sync/API types (serde + specta -> TS)
    aura-agents/                 data-driven catalog, env resolution, detection, channels, versions, auth
    aura-drivers/                protocol drivers: acp, claude, codex, pi; stream fallbacks; mock
    aura-core/                   sessions + process lifecycle, store, git/checkpoints/worktrees, search, handoff
    aura-config/                 (M8) per-agent config adapters (read into items, apply changes)
    aura-sync/                   (M6/M7/M9) API client, token manager, merge engines, crypto
    aura-cli/                    dev CLI: detect, smoke-test agents, record fixtures, replay
  apps/
    desktop/src-tauri/           Tauri shell: thin commands/channels over aura-core, window glass, plugins
    desktop/src/                 React UI
    web/                         (M6) auracode.si: React Router 7 on Cloudflare Workers
  services/api/                  (M6) Cloudflare Worker (TypeScript): accounts, devices, sync, webhooks
  packages/ui/                   TS design system shared by app + site: tokens, glass, motion, Orb, Aura
  packages/api-types/            TS types generated from aura-protocol (shared by app, site, API)
  infra/                         wrangler configs, SQL migrations for Neon, release scripts
```
- **Processes.** One Tauri process runs aura-core on tokio (`panic = "unwind"` in release; panics contained
  per task). aura-core doesn't depend on Tauri, so a headless daemon can reuse it later for remote access.
- **Shell.** Tauri 2.12.x: `transparent` + `windowEffects` `liquidGlassRegular` (vibrancy fallback), `mica`
  (never `acrylic`/`blur`). Overlay titlebar + `trafficLightPosition` on macOS; Windows titlebar decided by
  an M0 spike (custom controls lose Snap Layouts, so native caption buttons are the default). Plugins:
  single-instance, deep-link (`auracode://`), notification, window-state, updater, dialog, opener.
- **Crates (exact versions pinned at M0):** tokio 1.54, serde, tauri-specta 2.0.0-rc.26 (pinned `=`; ts-rs
  fallback), `agent-client-protocol` 3.5 (pin), process-wrap 10, portable-pty 0.9 (login terminal),
  rusqlite 0.40 + rusqlite_migration + tokio-rusqlite (one writer + read pool, FTS5; SQLCipher from M7), the
  `git` CLI for all git work (`GIT_OPTIONAL_LOCKS=0` when polling), ignore + nucleo-matcher, notify,
  reqwest 0.13, semver, similar/diffy, toml_edit + jsonc-parser, keepawake, keyring, tracing. Our own
  login-shell env resolver.
- **IPC.** Commands for request/response; `Channel` for streams; token deltas batched per frame into frames
  under 8 KiB; tool output capped (full output on disk).
- **App UI stack.** React 19.3, Vite, TypeScript, Tailwind 4.3, Motion 14, shadcn on Base UI (fully
  restyled), Zustand, react-virtuoso + use-stick-to-bottom (no layout animations inside the virtual list),
  Streamdown 2.7 (sanitized, own reduced-motion handling), Shiki 4 in a worker (finished code blocks only,
  throttled while streaming), @pierre/diffs, xterm.js 6 + WebGL (login terminal), OGL, Lucide, Floating UI.
- **Web stack.** React Router 7 (framework mode) on Cloudflare Workers, Tailwind, Motion, `packages/ui`,
  Turnstile. Marketing pages prerendered; auth/account routes server-rendered.
- **Cloud layout.**
  - `auracode.si` + `www` (redirect): the `web` Worker. It reverse-proxies `/api/auth/*` to Neon Auth so
    auth cookies are first-party on auracode.si (no third-party-cookie or Safari ITP problems), and forwards
    `/api/v1/*` to the `api` Worker over a service binding (one origin for site and API).
  - `api` Worker (TypeScript): verifies Neon Auth JWTs (EdDSA, JWKS, small clock leeway), devices, sync
    endpoints, presigned R2 URLs, the Neon Auth OTP webhook (signature-checked) that sends branded codes via
    Resend, rate limits. Talks to Neon Postgres through Hyperdrive.
  - R2: `auracode-releases` (public at `download.auracode.si`: installers, `latest.json`, checksums) and
    `auracode-blobs` (private, encrypted attachments).
  - Neon: one project, Postgres schema migrated from `infra/`, Neon Auth (Email OTP + JWT plugin, trusted
    domain `https://auracode.si`, branded emails via webhook).
- **Engines.** WKWebView (Safari 26/27) on macOS, WebView2 on Windows, WebKitGTK on Linux. Large glass is
  native; CSS `backdrop-filter` only on small overlays and never animated; idle GPU power measured in M0.
- **Catalog vs drivers.** The catalog is data (per agent: binaries + known dirs per OS, version command,
  channel rules, latest-version source, vendor update command, auth-status command, launch spec, config dir,
  brand, last-verified version). Drivers are per protocol: ACP, Claude stream-json, Codex app-server, Pi RPC
  (+ stream fallbacks, mock). Agents launch through their stable symlink/shim; real paths only identify the
  install channel. Copies bundled inside other apps are read-only channels.
- **Driver trait.** `create_session({cwd, add_dirs, model, effort, autonomy, resume_id})` returning a
  session with `send`, `steer?`, `interrupt`, `set_model`, `set_effort`, `set_autonomy`, `fork?`, `rewind?`,
  `respond(request_id, decision)`, an event stream, `close`. The UI reads `capabilities`, never agent names.
- **AuraEvent** (ACP vocabulary): turn.started/ended, message.delta/completed, thought.delta/completed,
  tool.call, tool.update (text | diff | terminal), permission.requested/resolved, ui.request, plan.updated,
  usage.updated, limits.updated, session.updated (native id, title, model, effort, mode, commands), notice,
  error.
- **Profiles from day one.** All local data under `<app data>/profiles/<profile_id>/` (database,
  attachments, checkpoints, logs). M0 ships one "Local" profile; M6/M7 add one per account.
- **Storage.** UUIDv7 ids, `device_id`, tombstones (no hard deletes), portable folder identity from M0; the
  sync clock and sync-state tables arrive by migration in M7. Events append-only, compacted per turn; FTS
  updated at compaction. DB backed up before every migration.

## Agent integration (researched 2026-10-24)
| Agent | Path | Notes |
|---|---|---|
| Claude Code | Native: own Rust control loop over stream-json; user's `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio` | Own lenient serde types; `claude-codes` crate and the official Python Agent SDK are references, diffed each release. Control: `initialize`, `interrupt`, `set_model`, `set_permission_mode`, `apply_flag_settings` (effort), `get_usage`, `get_context_usage`, `list_models`, `rewind_files`; we answer `can_use_tool`; fork via `--fork-session`/resume-at. `rate_limit_event` feeds the limits meter. Unknown messages logged, never fatal; capabilities from `system/init`; compatibility smoke per new version. Day-one fallback (M1a): ACP via `claude-agent-acp`. |
| Codex | Native: `codex app-server --listen stdio://`, own process | Own serde subset with `#[serde(other)]`, tested against the JSON Schema from `codex app-server generate-json-schema` per supported version. `thread/start/resume/fork/list`, `turn/start` (model, effort, cwd, approvalPolicy, sandboxPolicy, images, mentions), `turn/steer`, `turn/interrupt`, `turn/diff/updated`, approvals, `model/list`, `account/rateLimits/read`, plugin/skill/config APIs (reused by Library + Sync). Never the shared daemon (opt-in later). Day-one fallback: `codex-acp`. |
| Pi | Native RPC `pi --mode rpc` | `prompt`/`steer`/`follow_up`/`abort`, `set_model`, `get_available_models`, `set_thinking_level`, `fork`, `get_session_stats`, `extension_ui_request` (rendered as confirm/select/input). Turn ends on `agent_settled`; split on LF only. |
| Antigravity | ACP via Google's `agy_acp_server` (registry `antigravity-acp`) | Fallback `agy -p --input-format stream-json --output-format stream-json` (text only, no approvals, interrupt = kill). |
| oh-my-pi | ACP `omp acp` | Never set `PI_CODING_AGENT_DIR` globally. |
| Cursor | ACP `agent acp` | Dialect: answer `cursor/ask_question` / `cursor/create_plan`; model switch = restart with `--model`. Never detect by the name `agent`. |
| Grok Build | ACP `grok agent stdio` | Fallback `grok -p --output-format streaming-json`. |
| Hermes | ACP `hermes acp` | Dialect: `session/set_model`. Not in the registry; hard-coded. |
| OpenCode | ACP `opencode acp` | Detect V1 (1.19.x) vs V2 (2.1.x). |
| Gemini CLI + registry agents | Generic ACP (registry `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`) | Shown with an "unverified" badge until tested. |

ACP client advertises `fs` and `terminal` as false (agents use their own file I/O and shells). Model/effort
via session config options; `session/list|load|resume`; `usage_update`; `auth.terminal` login. Unknown
agent-to-client requests get JSON-RPC "method not found" so agents never hang.

**Detection + updates.**
- Env: resolve the login-shell env asynchronously (`$SHELL -ilc` with stdin `/dev/null`, markers, 10s
  timeout), cache it, never block boot on it; plus known dirs (`~/.local/bin`, `~/.opencode/bin`,
  `~/.grok/bin`, `~/.pi/agent/bin`, `~/.bun/bin`, `~/.volta/bin`, `/opt/homebrew/bin`, npm prefix, shims).
- A binary counts only if `--version` runs. Channel from the real path; updates run the vendor's own update
  command for that channel (agents also self-update; we don't fight it). Each driver records a
  last-verified version; newer, untested versions get a small badge.
- Latest versions: npm dist-tags, GitHub releases (ETag), Homebrew JSON, vendor endpoints, ACP Registry;
  on launch + every 6h, cached.
- Auth status via each agent's own command; login runs the agent's own flow in a small terminal sheet.
- Windows: PATH = HKLM + HKCU merged with `REG_EXPAND_SZ` expansion; npm packages launched via their `bin`
  entry or bundled `.exe`; console handling chosen by an M0 spike (a tool call that runs git must not pop
  windows); Job Objects.
- WSL, automatic: `wsl.exe -l -q` (UTF-16LE), probe each distro, show "Codex · WSL Ubuntu"; an `AgentHost`
  (Native | Wsl{distro}) spawns via `wsl.exe -d <distro> --cd <path> -e ...` with path translation.

**Agent terms (matters now that other people can download auracode).** auracode only spawns the user's own
unmodified binaries. Anthropic allows signing in to the unmodified binary with your own subscription for
individual use and forbids third-party products offering claude.ai login or routing plan credentials;
OpenAI allows local/open-source app-server use, never commercial/hosted; Google's terms ban third-party
access, so their own ACP server is the sanctioned path. Personal use fits all three. Before a public launch:
get written confirmation from each vendor or default to API-key mode (every agent gets an optional API-key
setting).

**Prior art.** T3 Code (MIT; Codex, Claude, Cursor, Grok, OpenCode, Antigravity, polished), CC Switch (148k
stars; config push + WebDAV/S3 sync, no chat), AionUi (20+ agents via ACP), Zed, Conductor. Open ground:
full agent lifecycle, encrypted sync of projects + chats + config, one consistent chat for every agent,
consumer-grade polish. MIT/Apache code may be read for reference; never AGPL (Toad, opcode).

## Engineering rules
- **Processes:** drain stdout and stderr continuously; bounded large-line framing (base64 images); shutdown
  = protocol interrupt, close stdin, wait, SIGTERM, walk descendants by parent pid, SIGKILL last; record pid
  + start time and kill only our own leftovers at startup; never kill vendor daemons; treat agent state dirs
  as shared with vendor apps.
- **Env scrub:** children get the resolved login-shell env minus `CLAUDECODE`, `CLAUDE_CODE_*`,
  `CLAUDE_EFFORT`, `CODEX_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`.
- **Long runs:** keep the machine awake while turns run; closing the window keeps auracode in the menu bar /
  tray with a badge; quitting with live turns asks; app updates wait for idle.
- **Diagnostics:** rotating raw protocol log per session + "Copy debug bundle" (tokens redacted; also feeds
  fixtures).
- **Security:** sanitized markdown (no raw HTML from agents), strict CSP, minimal Tauri capabilities (the
  webview can't spawn processes or read arbitrary files; everything goes through vetted Rust commands),
  deep links validated against an allowlist of routes and params, path traversal checks on attachments and
  mentions, external links open in the browser (non-http schemes ask first).
- **macOS privacy:** builds signed with a stable local self-signed identity from M0 so `~/Desktop` grants
  stick (ad-hoc signatures change every build).
- **Worktrees (M4):** created outside the repo (short app-data path, avoids MAX_PATH and file watchers),
  always on a new branch, optional "bring uncommitted changes", per-folder setup (files to copy like
  `.env`, an install command), merge blocked while a Direct chat runs in the target.

## Edge cases (each one has a defined behaviour and a test)
**Agents.** Not installed; installed but broken (`--version` fails: shown as broken with the error); several
installs of one agent (PATH order wins, others listed as shadowed, user can pick); installed, updated, or
removed while auracode runs (watch bin dirs + re-detect on focus; running sessions keep their process);
signed out or token expired mid-turn (sign-in sheet, then resume); rate limit or quota hit (meter shows reset
time, one click hands the chat to another agent); version too old (update required) or untested-new (badge,
lenient parsing); crash mid-turn (error card with stderr tail + "Restart and resume"); silent for minutes
(soft "still working" with Interrupt, never auto-killed); folder-trust prompts that need a TTY (handled via
flags/config or surfaced in the UI); model removed upstream (fall back to default with a notice); proxies
(`HTTPS_PROXY` passed through).
**Sessions + streaming.** Huge transcripts (virtualized, paged from SQLite); huge or binary or invalid-UTF-8
output (capped, lossy decode, raw on disk); oversized or unsupported images (resized/converted, per-agent
limits); interrupt during a tool (second Esc force-stops); app quit or crash mid-turn (on relaunch the turn
is marked interrupted with Resume; partial message kept and labelled); sleep/wake (reconnect, WebGL restore);
disk full (persistence pauses with a banner, no crash); permission request while hidden (notification +
sidebar badge).
**Projects + git.** Folder moved, renamed, deleted, or on an unplugged drive ("Folder missing": Locate or
Remove); non-git folder (checkpoints still work; isolation offers `git init`); submodules, LFS, huge repos
(checkpoints respect .gitignore with size caps); detached HEAD or rebase/merge in progress (git actions
blocked with the reason); merge conflicts on merge-back (hand to an agent or open in editor); branch name
collisions (suffix); worktree deleted by hand (prune and recover); `gh` missing or signed out (PR action shows
setup); clone failures (auth, network, disk) with clear retry; Windows long paths, case-insensitive
collisions, CRLF; reverting a checkpoint after files changed outside the agent (diff + confirm, never a
silent clobber).
**Accounts.** Wrong or expired code, too many attempts (clear message, resend cooldown); email not arriving
(resend, spam hint, delivery status from Resend); bot signups (Turnstile on the site; per-IP and per-email
rate limits in the proxy, also covering in-app requests); same flow for new and returning emails; session
expired or device revoked from the site (app drops to signed-out, local data intact and encrypted); offline
(sign-in waits, app fully usable locally); sign-out with unsynced changes (warns with a count); switching
accounts with chats running (asks); account deleted elsewhere (app signs out and offers to keep local data
as a Local profile); email change (re-verify); account created on the site but never used in the app (first
app sign-in becomes "first device"); approval request expires or codes don't match (abort, retry); lost
recovery key with no other device (cloud data can't be decrypted, said plainly at creation; "reset sync"
after email verification starts fresh).
**Sync.** Offline edits on several devices (clock-ordered last-writer-wins for metadata, append for
transcripts, 3-way for config); dropped connection mid-push (idempotent batches, resume from cursor); older
app meets newer data (schema version on records; never overwrites newer, prompts update); deleting a project
on one device while its chat runs on another (applied after the turn ends); repo at different paths (device
mapping; Locate or Clone); server down (local-first, backoff, status dot); storage quota reached ("sync
paused", never data loss); config for an agent not installed (waits); secrets (never plaintext).
**Website + downloads + updates.** Wrong OS/arch guess (universal macOS DMG avoids the Apple Silicon/Intel
problem; all platforms always listed); unsigned builds (clear Gatekeeper/SmartScreen steps + checksums until
signing is set up); "Open auracode" when not installed (Download sits next to it); cookies or JS disabled
(download page still works); update signature mismatch (refused); interrupted download (retry); update while
chats run (waits for idle); WebView2 missing on Windows (installer bootstraps it); Windows 10 (no Mica:
fallback theme); Linux without a keyring (encrypted file fallback with a warning), Wayland transparency
quirks, AppImage needing FUSE (deb alternative).
**Onboarding.** No agents found (install suggestions + demo chat); slow detection (cached/skeleton orbs that
reconcile); everything skipped (lands in a usable app); quit halfway (resumes where it left off); no WebGL2
or reduced motion (static, still beautiful); tiny windows and multiple monitors (responsive, minimum size).

## Milestones (each its own branch and PR, opened only when finished and tested)
**Day 1 (first execution step):** create the `auracode.si` zone in Cloudflare (with confirmation), report
its two nameservers, and give the user the Namecheap steps (Domain List > auracode.si > Manage >
Nameservers > Custom DNS > paste both; turn DNSSEC off first if it's on). No records are needed yet.

**Foundation (the app)**
- **M0 Scaffold + spikes.** Private repo, pnpm (Homebrew), Cargo + pnpm workspaces, fmt/clippy/ESLint/
  Prettier, Tauri app with the glass window, typed command + Channel round trip, profile layout + SQLite
  schema, stable self-signed signing identity (created locally with the user's OK), CI on macOS/Windows/
  Ubuntu (fmt, clippy, tests, typecheck, lint; `tauri build` only on main merges and nightly). Spikes:
  worst-case render (animated aura + orbs + fast stream) on WebKit and WebView2 with idle power; Windows
  spawning (hidden console, git child); Claude control round trip incl. resume after a cwd change; Windows
  titlebar.
- **M1a Core + ACP + bare UI.** Session manager, process lifecycle + env scrub, mock driver + replay
  harness, protocol logs, ACP client, minimal unstyled chat UI. Verified with Hermes and the Claude/Codex
  ACP adapters. In parallel, Design Lab: 2-3 visual directions rendered from recorded streams; the user picks
  one.
- **M1b Claude native driver.** **M1c Codex native driver.**
- **M1d Pi + the rest.** With the user's OK, install pi, oh-my-pi, OpenCode, Cursor CLI, Grok Build via their
  official installers (Cursor/Grok need the user's sign-in), then Pi native driver and the ACP dialects
  (Antigravity, Cursor, Grok, oh-my-pi, OpenCode) + agy/grok fallbacks.
- **M1e Catalog.** Detection on macOS/Windows/Linux + WSL, channels, versions, vendor updates,
  last-verified badges, auth status. Done when `aura-cli smoke <agent>` passes for every installed agent.
- **M2a Design system + transcript.** Chosen direction: tokens, fonts, glass, motion, Orb + Aura,
  transcript components, against fixtures.
- **M2b App shell with real agents.** Sidebar, projects, chats, persistence, titles, edit/retry/fork,
  checkpoints + Changes panel + revert, agent switching with handoff, busy-folder warning, notifications,
  keep-awake, tray, quit guard.
- **M2c Composer + palette.** Attachments, @mentions, slash commands, queue/steer, agent/model/effort/
  autonomy pickers, command palette, shortcuts, settings.
- **M3 Boot, onboarding, agents.** Boot cinematic, full onboarding (account step behind a flag until M6),
  Agents page (install, update, sign-in sheet, verified badges).
- **M4 Parallel work.** Worktrees per the rules above, merge/PR/discard, concurrent chats polish,
  multi-folder handling, open in editor/terminal, general terminal panel.
- **M5 Packaging + releases.** DMG (universal) / NSIS (x64, arm64) / AppImage + deb; `tauri-plugin-updater`
  (Tauri signing key generated and backed up; losing it ends updates); CI on tag builds every platform,
  uploads installers + `latest.json` + checksums to R2 (`download.auracode.si`, needs the zone active);
  app updates wait for idle. Windows/Linux artifacts come from CI every milestone so the user can test.

**Then (order is the user's call)**
- **M6 Website + accounts.** Resend domain, Neon project (region chosen with the user) + Neon Auth, R2
  buckets, Hyperdrive, `web` + `api` Workers, Turnstile; the site (landing, download, sign up/in, account,
  legal); in-app email-code sign-in, onboarding account step on, device registry, "Open auracode" deep link,
  devices revocable from the site.
- **M7 Workspace sync.** E2E keys, device approval + recovery key, account profiles + seamless switching,
  projects + chats sync, "Continue here".
- **M8 Config Library.** Skills, MCP servers, plugins, instructions for Claude/Codex/Pi; copy across agents.
- **M9 Config sync** for Claude Code, Codex, Pi.
- **Suggested:** Arena (one prompt, N agents, separate worktrees, compare diffs); relay ("Codex reviews what
  Claude wrote"); import past CLI sessions; live remote view from phone/web; dictation; usage dashboard;
  browser-based app sign-in and GitHub sign-in (Neon Auth OAuth Provider, PKCE + loopback).

## Sync design (M6-M9)
**Accounts.** In-app sign-in: email, then code; Rust calls Neon Auth through `https://auracode.si/api/auth`
(`send-verification-otp` type `sign-in`, then `sign-in/email-otp`), keeps the opaque session token in the
OS keychain, and exchanges it for 15-minute JWTs (`/token`) for the API. The site uses the same endpoints
with first-party cookies. Branded codes: Neon Auth's OTP webhook hits the `api` Worker, which sends through
Resend from `auth@auracode.si`.

**Data (Neon Postgres).** `devices` (user, name, platform, public key, last seen, revoked), `records`
(user, collection, id, hlc, device_id, deleted, ciphertext, nonce, key_version, server_seq), `chat_chunks`
(append-only, one per compacted turn), `user_keys` (wrapped keys, KDF params), `quotas`. Push = idempotent
upserts accepted only when the incoming clock is newer (records) or the expected ETag matches (config
blobs); pull = "changes since server_seq". Sync on focus, after each turn, and every 60s. The server never
merges anything. Every query is scoped by the JWT's `sub`.

**Encryption (recommended):** one random account key; records sealed with XChaCha20-Poly1305 and AAD =
account|collection|id|version. New devices get the key sealed to their X25519 key after approval on a
signed-in device (matching short code), or from the recovery key shown once at the first device. Cached in
the OS keychain, zeroized in memory. Agent API keys never synced by default. (The site can't read synced
chats; it manages the account.)

**Account switching.** Each account is its own profile (SQLCipher-encrypted database, key in keychain);
switching closes one profile and opens another with an animated transition; running chats ask first. Agent
config follows the account: the account's synced items are applied to the real agent dirs after snapshotting
the outgoing account's managed items (switching back restores them exactly; unmanaged files untouched), or
optionally per account, isolated agent homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`) for
fully separate configs and logins. Sign out keeps the encrypted profile; "remove from this device" wipes it.
First sign-in on a machine with Local data offers "Bring your local projects into this account".

**Workspace sync (projects + chats).** Metadata merges last-writer-wins per field by a hybrid logical clock;
deletes are tombstones; transcripts are append-only and union cleanly (offline continuation on two devices
shows a fork marker). Git folders resolve on a new device by origin URL across configured code roots, else
Clone; local-only folders show "Mac only" with one-click "Publish to GitHub". "Continue here" starts a fresh
native session seeded with the handoff block; optionally the chat's `aura/<slug>` branch is pushed so code
state follows.

**Config sync (Claude Code, Codex, Pi).** Two snapshots can't tell "installed on the Mac" from "uninstalled
on Windows", so each device keeps its last-synced Base and runs a 3-way merge with tombstones (VS Code
Settings Sync's model).
- Items: a skill, a plugin (`name@marketplace` + enabled; version only if pinned), a marketplace, an MCP
  server (secrets split out), an instructions file, one setting key path, a subagent/command/prompt/hook,
  a Pi extension/theme/package.
- L=R in sync; L=B and R changed: apply remote (incl. deletes); R=B and L changed: push (deletes become
  tombstones); both changed: per-key merge for settings, `diffy::merge` for text files, conflict UI only for
  overlapping edits. First link = union only, with a "Windows gains B, Mac gains C" preview. Items that fail
  to apply go on a per-device "skipped" list so absence is never read as uninstall. Missing agents' items
  wait ("3 Codex items waiting").
- Synced: Claude `settings.json` per key, `CLAUDE.md`, `rules/`, `skills/`, `commands/`, `agents/`,
  `output-styles/`, `keybindings.json`, plugins + marketplaces, `mcpServers` from `~/.claude.json`; Codex
  `config.toml` per key (minus `projects`), `AGENTS.md`, `agents/*.toml`, `rules/`, `hooks.json`; Pi
  `settings.json` per key, `keybindings.json`, `mcp.json`, `models.json` (keys as secrets), `AGENTS.md`,
  `SYSTEM.md`, `APPEND_SYSTEM.md`, `skills/`, `prompts/`, `themes/`, `extensions/`, packages; `~/.agents/skills`
  once.
- Never: credentials, caches, sessions, trust tables, `~/.claude.json` as a whole, `~/.claude/*/synced`.
  Paths normalised to `~`; OS-specific items auto-scoped to their platform; anything can be "this device
  only". Applied through each agent's own CLI/API first, format-preserving edits otherwise, snapshot before
  every apply, dry-run preview, one-click rollback.

## Repo + git workflow
- **One private monorepo** (`gh repo create itscool2b/auracode --private`) holding the app, the website,
  the API, and the shared packages. Not one long-lived branch per product (they drift apart), and not two
  repos (the app, site, and API share the design system, the generated API types, and the API contract, so
  one PR must be able to change them together). If the app is ever open-sourced, the API can be split out
  then with history intact (`git filter-repo`).
- Repo-local `user.name itscool2b`, `user.email megagrb16@gmail.com` (global config untouched).
- `main` gets the initial scaffold commit. Every piece of work happens on a short-lived feature branch
  named after its milestone (`m0-scaffold`, `m1a-core-acp`, ..., `m6-website`), merged through one PR when
  finished and tested. No drafts, review fixes pushed to the same PR, no co-author or generated-by lines.
  PRs via the GitHub MCP, falling back to `gh` (logged in as itscool2b).
- Deploys are separate even though the repo is shared: CI path filters run only what changed; the website
  and API deploy to Cloudflare on merge to `main` (preview deploys on PRs); the app releases only when a
  version tag (`v0.1.0`) is pushed, which builds every platform and publishes to `download.auracode.si`.
- Cloud changes (zone, DNS records, Neon project, Workers, R2, Resend domain) are confirmed with the user
  before each one runs; secrets live in Wrangler/Cloudflare secrets and GitHub Actions secrets, never in git.

## Verification
- **Rust tests:** replay of recorded raw streams (Claude, Codex, Pi, ACP) into expected AuraEvents; Codex
  types validated against generated schemas; detection on fake PATHs (symlinks, `agent` collision, leftover
  dirs, WSL output parsing); channel rules; env scrub; process shutdown chain and leftover cleanup;
  checkpoint/revert in git and non-git folders; handoff budget and delta; merges (LWW, append, 3-way config
  table incl. first-sync union, tombstones, skipped, vendor zones); crypto round trips; each edge case above
  that lives in Rust.
- **Real-agent smoke (opt-in, uses quota):** `aura-cli smoke <agent>` in a temp repo: stream, tool call,
  approval, interrupt, resume, model switch, fork.
- **App UI:** Vitest for logic; Playwright on the Vite build with mocked Tauri IPC in Chromium and WebKit for
  flows (onboarding, project, chat, stream, approve, diff, interrupt, restart, switch agent, sign in, switch
  account); DOM screenshot baselines with orb canvases masked; one full-app WebDriver smoke on Windows.
- **Web + API:** Worker unit tests with Vitest's Workers pool (auth proxy, JWT checks, rate limits, webhook
  signatures, sync conflicts, quota); Playwright against a preview deploy (signup, signin, account, delete,
  download links per OS, no-JS download page); a release dry run that publishes to a staging R2 prefix and
  updates an old build through `latest.json`.
- **Manual:** I run the real app on this Mac with every installed agent and review screenshots for polish;
  the user tests Windows builds as they land. Budgets: 60fps while streaming and scrolling, near-zero idle
  CPU with orbs paused, warm launch interactive in under 300ms, landing page LCP under 2s.
- **CI:** macOS, Windows (with a WSL distro for detection tests), Ubuntu.
