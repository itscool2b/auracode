# Desktop refinement review, 1 November 2026

Status: implementation and integration verification in progress on `codex/desktop-customization`. The owner approved implementing the refinement plan. This does not mark the captures as an approved golden baseline or establish native release acceptance.

The desktop retains the audited Devin structure, Aura logo, Inter typography and System/Light/Dark behavior. The owner replaced lime accents with neutral selection and focus tones. Access and native workflow controls sit on the left of the composer; the model, effort and agent picker sits on the right. Project plus buttons open scoped new-chat drafts. The new-chat surface uses a compact form, and Customize adds Plugins & MCP, Instructions and Project memory without unmounting the active chat. Shared instruction choices include clear descriptions.

## Reproducible proposal

Start the desktop Vite development server and run `node apps/desktop/scripts/check-customization.mjs http://127.0.0.1:1474`. Its captures under `target/customization-browser/` show both appearances, native control UI, model search, project-prefilled creation, Customize, instruction choices, and memory draft retention across tabs at 1440px and 960px. They use synthetic services and production components.

`check-shared-mcp.mjs` and `check-project-memory.mjs` cover the new panels with synthetic data. Existing instruction, worktree and chat suites cover preserved workflows. The layout probe covers the changed preview states in Chromium and WebKit, both appearances and both supported window sizes. Website product images are regenerated from the integrated light desktop preview, without fabricated product content.

## Evidence and limits

Completed browser evidence includes the customization suite in both engines and appearances, instruction flows with 22 accessibility scans, the new-chat worktree suite, shared MCP and memory review suites, and 64 layout views with no findings. The website remains light under a dark OS preference and without JavaScript in both browser engines. Record any subsequent source changes and final reruns with the completed implementation record.

Native protocol evidence is separate: isolated temporary homes with Codex 0.162.1 and Claude Code 2.1.312 connected a local synthetic MCP server with one tool. Pi 1.0.2 initialized and registered the exact shipped extension. No model prompts, copied credentials, user configuration writes or OAuth flows were used. `apps/desktop/scripts/check-native-mcp.mjs` reproduces this probe with explicit installed executable paths.

The embedded Windows debug build and smoke checks exercise actual Tauri commands, storage, processes and the WebView. Their final results are recorded separately from browser fixtures. Native macOS window materials, menus and release acceptance are not established by this Windows work. The prior styling review remains historical evidence, not a substitute for new-source checks.

Implementation behavior and boundaries are documented in [desktop-customization.md](../desktop-customization.md) and [Plugins & MCP](../plugin-library.md).
