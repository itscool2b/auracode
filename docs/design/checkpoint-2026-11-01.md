# Desktop refinement review, 1 November 2026

Status: implementation complete on `codex/desktop-customization`. On 1 November the owner requested cancellation of CI and a PR/merge based on the completed local checks, with further testing deferred to the owner. This does not mark the captures as an approved golden baseline or establish complete native release acceptance.

The desktop retains the audited Devin structure, Aura logo, Inter typography and System/Light/Dark behavior. The owner replaced lime accents with neutral selection and focus tones. Access and native workflow controls sit on the left of the composer; the model, effort and agent picker sits on the right. Project plus buttons open scoped new-chat drafts. The new-chat surface uses a compact form, and Customize adds Plugins & MCP, Instructions and Project memory without unmounting the active chat. Shared instruction choices include clear descriptions.

## Reproducible proposal

Start the desktop Vite development server and run `node apps/desktop/scripts/check-customization.mjs http://127.0.0.1:1474`. Its captures under `target/customization-browser/` show both appearances, native control UI, model search, project-prefilled creation, Customize, instruction choices, and memory draft retention across tabs at 1440px and 960px. They use synthetic services and production components.

`check-shared-mcp.mjs` and `check-project-memory.mjs` cover the new panels with synthetic data. Existing instruction, worktree and chat suites cover preserved workflows. The layout probe covers the changed preview states in Chromium and WebKit, both appearances and both supported window sizes. Website product images are regenerated from the integrated light desktop preview, without fabricated product content.

## Evidence and limits

Completed browser evidence includes the customization suite in both engines and appearances, instruction flows with 22 accessibility scans, the new-chat worktree suite with seven scans per engine, shared MCP and memory review suites, and 64 layout views with no findings. Chat regressions passed 32 accessibility scans per engine and 24 header selections per engine. The website remains light under a dark OS preference and without JavaScript in both browser engines.

Final interaction regressions cover access/Plan focus restoration, project worktree source resolution after delayed discovery, deliberate folder selection and cancellation, preserved instruction scope after workspace refresh, and MCP scope that adopts late project discovery without changing an explicit global choice or an open editor/import. `pnpm --filter @auracode/desktop check:customization` runs the combined suite on an owned development server and is included in CI.

The integrated frontend check and build pass. Frontend tests include 572 desktop tests, 262 shared UI tests and 352 Design Lab tests; 19 existing desktop tests are skipped. Workspace Rust Clippy passes with warnings denied. The complete account-enabled core library suite passes 717 tests with three ignored. Exact Rust-generated TypeScript bindings match the committed file. A complete local Rust workspace test attempt was blocked before execution by Windows Application Control on a Tauri build script; policy was left unchanged. Remote native jobs provide separate coverage below.

Native protocol evidence is separate: isolated temporary homes with Codex 0.162.1 and Claude Code 2.1.312 connected a local synthetic MCP server with one tool. Pi 1.0.2 initialized and registered the exact shipped extension. No model prompts, copied credentials, user configuration writes or OAuth flows were used. `apps/desktop/scripts/check-native-mcp.mjs` reproduces this probe with explicit installed executable paths.

The embedded Windows debug build passes. Its stream smoke passes with no sequence gaps; chat passes 30 checks and reopen passes eight, including persisted history, held queues, blob loading and clean shutdown. These checks exercise actual Tauri commands, storage, processes and the WebView with the scripted demo agent. They do not qualify live vendor model turns. Native macOS window materials, menus and release acceptance are not established by the local Windows run. The prior styling review remains historical evidence, not a substitute for new-source checks.

The platform workflow, [CI run 41279278805](https://github.com/itscool2b/auracode/actions/runs/41279278805), was cancelled at the owner's request. It ran against source commit `9607df94258989b652636cc207c5ba8be5e5c3d9`. Both encrypted-storage jobs and all four layout jobs passed, with 206 layout views each, 824 total across engines, appearances and window sizes. PowerShell verification passed. Follow-up `5ecc1129` only changes four lifecycle error messages to the new Plugins & MCP name; all five affected plugin-library unit tests pass locally.

Before cancellation, the macOS Rust test step reported replay/curation fixture mismatches, including expected events without the new `aura.access` and `aura.workflow` options. The installer/clone browser step failed in Node's HTTP client with `setTypeOfService EINVAL`. These failures and unfinished jobs remain follow-up work; the cancelled run is not a passing full-CI result. No CI rerun was requested after the owner deferred further testing.

Implementation behavior and boundaries are documented in [desktop-customization.md](../desktop-customization.md) and [Plugins & MCP](../plugin-library.md).
