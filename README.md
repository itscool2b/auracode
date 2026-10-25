# auracode

One beautiful home for all your coding agents.

auracode is a desktop app for macOS, Windows, and Linux that drives the coding agents you already use
(Claude Code, Codex, Pi, Antigravity, Cursor, Grok Build, OpenCode, Hermes, and any ACP-compatible agent)
through their real harnesses, rendered in one fast, glassy chat interface. Projects on the left, chats inside
projects, switch agents and models mid-chat, run several at once.

- No login needed for the app. Agents are detected automatically, with their versions, sign-in status, and
  available updates.
- Optional account (auracode.si) to sync projects, chats, and agent config (Claude Code, Codex, Pi) across
  machines, end-to-end encrypted.

## Status

Early development. The full plan, decisions, and milestones live in [docs/plan.md](docs/plan.md).

### M0: scaffold and spikes

Built and pushed on the `m0-scaffold` branch, not merged yet.

Done:

- **Domain.** The auracode.si zone has been active on Cloudflare since 2026-10-24.
- **Scaffold.** The Cargo and pnpm workspaces with rustfmt, clippy, and Biome; the event model
  (`aura-protocol`); the data folder, device identity, profiles, and per-profile database (`aura-core`);
  frame batching and the scripted mock agent (`aura-drivers`); the design system and WebGL orb renderer
  (`packages/ui`); the desktop shell with its glass window, typed commands and channels, and a demo stream;
  the CI and bundle workflows (written, but they have not run yet: see below).
- **Spikes.** [Claude Code's control protocol](docs/spikes/claude-control.md) is decided.
  [Windows spawning](docs/spikes/windows-spawn.md) and
  [the Windows titlebar](docs/spikes/windows-titlebar.md) are designed and implemented, and wait for
  their first Windows run.
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

## Layout

```
crates/aura-protocol/   shared types: events, frames, IPC and session types (serde, exported to TypeScript)
crates/aura-process/    agent processes: spawning, shutdown, leftovers, the agents' env, protocol logs
crates/aura-agents/     the agent catalog, detection, the one-time npm adapter install, launch specs
crates/aura-core/       device identity, data folder, profiles, the per-profile SQLite store, chat sessions
crates/aura-drivers/    the driver contract, frame batching, the scripted mock agent; the ACP driver (M1a)
apps/desktop/           Tauri v2 app: Rust shell in src-tauri/, React UI in src/
packages/ui/            Aura design system: tokens, fonts, glass, motion, Orb, AuraField
docs/                   plan and spike write-ups; spike code sits next to its write-up in docs/spikes/,
                        and docs/spikes/doc-check/ tests the write-ups against the code they cite
.github/workflows/      CI checks and unsigned desktop bundles
.github/scripts/        the scripts those workflows run (smoke run, spike staging, checks) and their tests
```

Planned, not created yet:

```
crates/aura-cli/        M1          dev CLI: detect and smoke-test agents, record and replay fixtures
crates/aura-sync/       M6, M7, M9  API client, merge engines, end-to-end encryption
crates/aura-config/     M8          per-agent config adapters for the Config Library
apps/web/               M6          auracode.si (React Router 7 on Cloudflare Workers)
services/api/           M6          account and sync API (Cloudflare Workers, Neon Postgres)
packages/api-types/     M6          TypeScript types generated from aura-protocol for the app, site, API
infra/                  M5, M6      release scripts, Wrangler configs, Neon migrations
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
  - Windows: Microsoft C++ Build Tools ("Desktop development with C++") and the MSVC Rust toolchain
    (rustup's default on Windows). WebView2 is preinstalled on Windows 10 (version 1803 and later) and
    Windows 11.
  - Linux (Debian, Ubuntu): the same packages CI installs:

    ```sh
    sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
      libayatana-appindicator3-dev librsvg2-dev
    ```

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

### Checks

GitHub Actions cannot run for this account yet (see [M0](#m0-scaffold-and-spikes)), so for now these
checks run locally on a Mac, and nothing runs them on Linux or Windows. From the repository root:

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

`.github/workflows/ci.yml` runs all of these (the doc check in the lint job, the
frontend build inside the smoke build), plus the render-power suite's tests, on Windows under both
Windows PowerShell 5.1 and PowerShell 7. Pull requests and pushes to milestone branches (`m0-scaffold`,
...) run on Linux and Windows. A branch's pushes skip while its open pull request is one GitHub can
merge, since the pull request's runs cover them; during a merge conflict GitHub runs no pull request
workflow, so the pushes run CI themselves. Pushes to `main` and manual runs add macOS. A weekly run on Mondays repeats the rust
job on Linux and clippy on Windows; macOS never runs on a schedule. Biome, the typecheck, Vitest,
`cargo fmt`, the doc check, the CI script checks, and the claude-control unit tests run on Linux only,
and the spawning spike and the smoke runs skip macOS.
`.github/workflows/build.yml` builds unsigned installers for pushes to `main`, nightly when nothing
has built `main`'s newest commit yet (one nightly try per commit), on demand, and for milestone-branch
pushes whose newest commit message contains `[bundle]` (Windows and Linux only).

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
