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

## Layout

```
crates/aura-protocol/   shared types: AuraEvent, event frames, capabilities (serde, exported to TypeScript)
crates/aura-core/       device identity, data folder, profiles, the per-profile SQLite store
crates/aura-drivers/    frame batching for the UI and the scripted mock agent; agent drivers arrive in M1
apps/desktop/           Tauri v2 app: Rust shell in src-tauri/, React UI in src/
packages/ui/            Aura design system: tokens, fonts, glass, motion, Orb, AuraField
docs/                   plan and spike write-ups; spike code sits next to its write-up in docs/spikes/
.github/workflows/      CI checks and unsigned desktop bundles
```

Planned, not created yet:

```
crates/aura-agents/     M1          agent catalog, login-shell environment, detection, versions, auth
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
  first cargo command. The minimum supported version is `rust-version` in `Cargo.toml` (1.90).
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
rebuilds and relaunches when its code changes. App data lives in `si.auracode.desktop` inside the OS data
folder (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows, `~/.local/share` on Linux).

### Checks

CI runs these on every pull request and push to `main`, plus nightly:

```sh
# Linux
pnpm check                      # pnpm lint, pnpm typecheck, pnpm test (Vitest)
cargo fmt --all --check

# Linux and Windows; macOS too on main, nightly, and manual runs
pnpm build                      # the production frontend build
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo test --manifest-path docs/spikes/windows-spawn/Cargo.toml     # not on macOS
cargo build --manifest-path docs/spikes/claude-control/Cargo.toml   # compile only
```

- Biome is the only linter and formatter outside Rust (there is no ESLint or Prettier): `pnpm lint`
  checks, `pnpm format` rewrites. It covers TypeScript, CSS, JSON, and YAML. It does not format Markdown
  (hand-wrapped prose and tables) and never touches `pnpm-lock.yaml` (written by pnpm). Rust is formatted
  with `cargo fmt --all`.
- Clippy rejects `unwrap()` and `expect()` outside tests (`Cargo.toml` and `clippy.toml`).
- The claude-control spike only compiles in CI: running it drives a real Claude Code session.

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
| `AURACODE_SMOKE` | Runs the scripted smoke check through the real UI (a demo turn, a cancelled turn, a short stress burst) and prints `AURACODE_SMOKE_RESULT <json>` on stdout, or a failing result if the UI has not reported within 120 seconds. Takes precedence over `AURACODE_STRESS`. |
| `AURACODE_SMOKE_EXIT` | With `AURACODE_SMOKE`, exits after the result: code 0 if the check passed, 1 otherwise. |
| `RUST_LOG` | Log filter for the Rust side, which logs to stderr. Default `info`. |

For example `AURACODE_STRESS=orbs=24,rate=200 pnpm dev`. In PowerShell, run
`$env:AURACODE_STRESS = "orbs=24,rate=200"` first.
