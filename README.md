# auracode

One beautiful home for all your coding agents.

auracode is a desktop app for macOS and Windows that drives the coding agents you already use
(Claude Code, Codex, Pi, Antigravity, Cursor, Grok Build, OpenCode, Hermes, and any ACP-compatible agent)
through their real harnesses, rendered in one dark-only Orbit chat interface. Projects on the left, chats inside
projects, switch agents and models mid-chat, run several at once.

- No login needed for the app. Agents are detected automatically, with their versions, sign-in status, and
  available updates.
- Optional account (auracode.si) to sync projects, chats, and agent config (Claude Code, Codex, Pi) across
  machines, end-to-end encrypted.

## Status

The integrated product is in development and final acceptance is pending. The full plan and decisions
live in [docs/plan.md](docs/plan.md); [docs/progress.md](docs/progress.md) records implementation and
verification evidence. Windows and macOS are the current targets. Linux and WSL are deferred.

Backend and cloud services are Rust-first. The selected cloud architecture is Rust Workers, D1, R2
and Cloudflare Email Service. The Rust API is deployed to an isolated preview environment; website
deployment and real email/device acceptance remain pending. Production storage remains empty.
React/TypeScript handles interfaces. Root AGENTS.md and CLAUDE.md are identical project instructions,
enforced by the lint gate. Public installer signing is deferred at the owner's request.

Current source includes native agent drivers, the dark Orbit workspace, onboarding, project and Git
controls, configuration Library, encrypted account sync, local import and readable export. Account
recovery and portable folder resolution are being completed. The milestone notes below describe the
earlier merged foundation, not the current branch's full implementation. Release requirements and
the deliberate final verification batch are in [docs/releases.md](docs/releases.md).

### M0: scaffold and spikes

Merged into main.

Done:

- **Domain.** The auracode.si zone has been active on Cloudflare since 2026-10-24.
- **Scaffold.** The Cargo and pnpm workspaces with rustfmt, clippy, and Biome; the event model
  (`aura-protocol`); the data folder, device identity, profiles, and per-profile database (`aura-core`);
  frame batching and the scripted mock agent (`aura-drivers`); the design system and WebGL orb renderer
  (`packages/ui`); the desktop shell with its glass window, typed commands and channels, and a demo stream;
  the CI and bundle workflows, which run on Linux and Windows (see [Checks](#checks)).
- **Spikes.** [Claude Code's control protocol](docs/spikes/claude-control.md) is decided.
  [Windows spawning](docs/spikes/windows-spawn.md) passes its automated tests on Windows and Linux in
  CI; its manual checklist and [the Windows titlebar](docs/spikes/windows-titlebar.md) wait for a
  Windows PC.
  [Render and power](docs/spikes/render-power.md) has measured the hidden window and the page in WebKit;
  the visible window and Windows remain.

Pending, each waiting on the repository owner:

- **The local signing identity.** `pnpm signing create` adds a self-signed certificate and its private key
  to the login keychain, so it waits for the owner's OK (see
  [apps/desktop/README.md](apps/desktop/README.md#signing-on-macos)). Until then builds are signed ad hoc,
  and macOS asks for `~/Desktop` access again after every rebuild.
- **The macOS visible-window render and power run.** It needs an unlocked Mac left idle for about 20
  minutes ([steps](docs/spikes/render-power.md#finishing-the-macos-half)).
- **The Windows manual checklists.** CI runs on Linux and Windows (the spawning spike's tests, the
  smoke run on WebKitGTK and WebView2, the render-power suite's unit tests), but the manual checklists
  for [spawning](docs/spikes/windows-spawn.md#manual-checklist-the-users-windows-pc),
  [the titlebar](docs/spikes/windows-titlebar.md#verification), and
  [render and power](docs/spikes/render-power.md#windows-webview2-half-still-to-run) need a Windows
  PC.
- **An app screenshot.** It needs an unlocked screen: a locked Mac hides every window.

### M1a: sessions, processes, the ACP client and the bare chat UI

Merged into main from the `m1a-core-acp` branch, following [its spec](docs/design/m1a.md): agent processes and their
environment, the session manager and its store, the ACP driver, the chat commands and channels, a bare
chat UI styled through tokens, and `aura-cli`. Verified against real agents on this Mac (spec 10.6):
Hermes, Claude Code through claude-agent-acp and Codex through codex-acp each pass the free probes, the
six paid scenarios and a chat through the UI, with recorded fixtures replayed in CI. The visual
language the UI moves to next is [Orbit](docs/design/visual-language.md), prototyped in the Design Lab.

## Layout

```
crates/aura-protocol/   shared types: events, frames, IPC and session types (serde, exported to TypeScript)
crates/aura-process/    agent processes: spawning, shutdown, leftovers, the agents' env, protocol logs
crates/aura-agents/     the agent catalog, detection, the one-time npm adapter install, launch specs
crates/aura-core/       device identity, data folder, profiles, the per-profile SQLite store, chat sessions
crates/aura-drivers/    the driver contract, frame batching, the scripted mock agent; the ACP driver (M1a)
crates/aura-cli/        dev CLI: probes and smoke-tests agents headlessly, records and replays fixtures
apps/desktop/           Tauri v2 app: Rust shell in src-tauri/, React UI in src/
apps/design-lab/        M1a Design Lab: visual directions rendered from a recorded chat (see its README)
packages/ui/            shared design system; Orbit production migration follows in M2a
docs/                   plan and spike write-ups; spike code sits next to its write-up in docs/spikes/,
                        and docs/spikes/doc-check/ tests the write-ups against the code they cite
.github/workflows/      CI checks and unsigned desktop bundles
.github/scripts/        the scripts those workflows run (smoke run, spike staging, checks) and their tests
```

Cloud application components (resource inventory already exists in infra/README.md):

```
crates/aura-sync/       M6, M7, M9  API client, merge engines, end-to-end encryption
crates/aura-config/     M8          per-agent config adapters for the Config Library
apps/web/               M6          auracode.si (React Router 7 on Cloudflare Workers)
services/api/           M6          Rust account and sync API (Cloudflare Workers, D1)
packages/api-types/     M6          TypeScript types generated from aura-protocol for the app, site, API
infra/                  M5, M6      release scripts, Wrangler configs, D1 migrations
```

## Development

### Prerequisites

- **Rust** stable with rustfmt and clippy. `rust-toolchain.toml` selects it, so rustup installs it on the
  first cargo command. The minimum supported version is `rust-version` in `Cargo.toml` (1.95, set by
  the rusqlite_migration dependency). rustup never updates an installed stable on its own, so if
  `rustc --version` is older, run `rustup update stable`.
- **Node.js** 22.12 or a later 22.x, 24.x, or 26 and newer: the range Vite 8 and Vitest 5 support, set
  by `engines` in `package.json`. `pnpm install` refuses any other version. CI uses 24.
- **pnpm** 12, the version pinned by `packageManager` in `package.json`: `brew install pnpm`, or see
  [pnpm.io/installation](https://pnpm.io/installation). pnpm reads its settings from
  `pnpm-workspace.yaml`.
- **Tauri's system dependencies** ([details](https://v2.tauri.app/start/prerequisites/)):
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Windows: Microsoft C++ Build Tools ("Desktop development with C++"), the MSVC Rust toolchain
    (rustup's default on Windows), and WebView2. The installer bootstraps a missing WebView2 runtime.

### Run

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `tauri dev`: Vite serves the UI on `localhost:1420` with hot reload, and the Rust shell
rebuilds and relaunches when its code changes. Release bundles (`pnpm bundle`) and the macOS signing
identity (`pnpm signing`) are described in [apps/desktop/README.md](apps/desktop/README.md).

App data lives in a folder named `si.auracode.desktop` inside the local (never roaming) app data folder:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/si.auracode.desktop` |
| Windows | `%LOCALAPPDATA%\si.auracode.desktop` |
| Linux | `$XDG_DATA_HOME/si.auracode.desktop`, or `~/.local/share/si.auracode.desktop` when `XDG_DATA_HOME` is unset |

`AURACODE_DATA_DIR` moves it anywhere else (see [Environment switches](#environment-switches)).

### aura-cli

`aura-cli` runs agents without the app, through the same session manager, on a temporary profile
with a fresh temporary git repository as the chat folder (M1a spec 9.5 and 10):

```sh
cargo run -p aura-cli -- agents                               # the env and each agent
cargo run -p aura-cli -- probe hermes                         # free probe steps, no prompt
cargo run -p aura-cli -- smoke hermes --scenario all --spend  # paid scenarios
cargo run -p aura-cli -- fixture <log> --scenario basic --out <file>
cargo run -p aura-cli -- replay <fixture>                     # against its golden; --update writes it
```

A probe or smoke run keeps its folder (protocol logs, database, chat folder) and ends with the
`aura-cli fixture` command for each log it left. Its agent processes register in the real data
folder's `run/`, so the app's next start cleans up after a crashed run, and it shares the app's
downloaded adapters. `--data-dir <dir>` runs on that data folder's own profile instead, and is refused
while the app runs on it. `aura-cli help` lists every option; `RUST_LOG` shows its logs on stderr
(default: warnings only).

### Checks

CI runs only when deliberately dispatched for an integration checkpoint or final verification. The
active matrix is Windows and macOS. Routine commits and pushes do not trigger CI. To run focused
checks locally, from the repository root:

```sh
pnpm check                      # pnpm lint, pnpm typecheck, pnpm test (Vitest)
pnpm build                      # the production frontend build
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo test --manifest-path docs/spikes/windows-spawn/Cargo.toml
cargo build --manifest-path docs/spikes/claude-control/Cargo.toml   # compile only, never run
cargo test --manifest-path docs/spikes/claude-control/Cargo.toml    # unit tests only, never the binary
cargo test --manifest-path docs/spikes/doc-check/Cargo.toml         # spike docs against the code
bash .github/scripts/lint-workflows.sh                              # action pins, runner labels, schedule names
shellcheck -x .github/scripts/*.sh
bash .github/scripts/test.sh                                        # the CI scripts' own tests

# The smoke runs: the app, with its frontend embedded, streams a demo turn, a cancelled turn, and a
# stress burst through the real UI; then it drives the chat screens against the demo agent in two
# launches on one data folder, quitting through the quit flow between them, and prints every
# check. A second argument, stream or chat, runs one of the two.
pnpm --filter @auracode/desktop tauri build --debug --no-bundle
bash .github/scripts/run-smoke.sh target/debug/auracode
```

`.github/workflows/ci.yml` includes Rust and native smoke checks on Windows/macOS, the Windows
PowerShell suites, frontend tests, compiled Rust Worker tests, and Chromium/WebKit browser gates.
Enable encrypted-storage verification for the final run. `.github/workflows/build.yml` is an
explicit unsigned Windows/macOS installer qualification workflow. Neither a commit message nor a
tag publishes a release. Signing, hardware acceptance and distribution follow [docs/releases.md](docs/releases.md).

- Biome is the only linter and formatter outside Rust (there is no ESLint or Prettier): `pnpm lint`
  checks, `pnpm format` rewrites. It covers TypeScript, CSS, JSON, and YAML. It does not format Markdown
  (hand-wrapped prose and tables) and never touches `pnpm-lock.yaml` (written by pnpm) or the replay
  fixtures and goldens in `crates/aura-drivers/tests/fixtures` (written by the replay harness). Rust is
  formatted with `cargo fmt --all`.
- Clippy rejects `unwrap()` and `expect()` outside tests (`Cargo.toml` and `clippy.toml`).
- The claude-control binary is never run, in CI too, because running it drives a real Claude Code
  session, which spends quota. Only its unit tests run: they feed the code canned input, and a shell
  stands in for `claude` where they need a process.

### Generated TypeScript bindings

`apps/desktop/src/bindings.ts` types the UI's calls into Rust. tauri-specta generates it from the shell's
command list. After changing a command or a type it uses, run
`cargo test -p auracode-desktop export_bindings` and commit the result (debug builds of the app also
regenerate it at startup). CI fails when the committed file is out of date.

### Environment switches

For development and automation; the app reads them once at startup. On/off switches accept `1`, `true`,
`yes`, or `on` in any case; any other value is off.

| Variable | Effect |
|---|---|
| `AURACODE_DATA_DIR` | Keeps all app data in this folder instead of the OS default, for example a throwaway folder to test a first launch. Blank values are ignored; a relative path is resolved against the current folder. |
| `AURACODE_NO_GLASS` | Opaque window without the native glass (Liquid Glass, vibrancy, Mica): the baseline of the power spike. |
| `AURACODE_STRESS` | Opens straight into the stress view. Comma-separated `orbs` (1 to 24), `rate` (1 to 5000 tokens/s), `aura` (1 or 0), and `seconds` (0 to 86400, 0 streams until the window closes); missing keys default to `orbs=6,rate=200,aura=1,seconds=0`, and `1` alone means all defaults. An invalid value is ignored and the app shows a notice. See [docs/spikes/render-power.md](docs/spikes/render-power.md). |
| `AURACODE_SMOKE` | Runs a scripted smoke check through the real UI and prints `AURACODE_SMOKE_RESULT <json>` on stdout, or a failing result if the UI has not reported in time (120 seconds; 300 for `chat`, 900 with `AURACODE_SMOKE_AGENT`). `1` (or `stream`): a demo turn, a cancelled turn, a short stress burst. `chat`: the chat screens against the demo agent, every block, card and queue path, ending with the quit flow while a turn runs; `chat-reopen`: the same data folder started again, checking the stored history, the interrupted turn and Resume. Each chat check is in the result. `0`, `false`, `no` and `off` are off; any other value that names no check prints a failing result. Takes precedence over `AURACODE_STRESS`. Smoke runs keep running while the window is hidden or the screen is locked (macOS 14 and later). |
| `AURACODE_SMOKE_EXIT` | With `AURACODE_SMOKE`, exits after the result, through the quit flow: code 0 if the check passed, 1 otherwise. |
| `AURACODE_SMOKE_FOLDER` | With `AURACODE_SMOKE=chat` or `chat-reopen`, the chat's folder (an absolute path), which the folder picker answers without a dialog. Required for those. |
| `AURACODE_SMOKE_AGENT` | With `AURACODE_SMOKE=chat`, one minimal chat with this agent (`hermes`, `claude-acp`, `codex-acp`) instead of the demo agent's run: under Ask it sends "Reply with exactly: ok" and passes when the reply is ok (`mock`, the demo agent, gets `/echo ok`). `run-smoke.sh` passes it on and then runs that one launch. A real agent spends your quota, so this is for local runs only: the app and `run-smoke.sh` refuse it while `CI` or `GITHUB_ACTIONS` is set. A first start may download the agent's adapter, hence the longer watchdog. |
| `RUST_LOG` | Log filter for the Rust side, which logs to stderr. Default `info`. |

For example `AURACODE_STRESS=orbs=24,rate=200 pnpm dev`. In PowerShell, run
`$env:AURACODE_STRESS = "orbs=24,rate=200"` first.
