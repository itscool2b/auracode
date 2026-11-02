# Halo review, 1 November 2026

Status: implemented on `codex/halo` and merged at the owner's request, which asked for a full website and desktop restyle as the last styling pass, then local verification, a website deploy, a merge to main and a local install, with no CI run. The captures below are proposals until the owner locks the design; they are not golden references.

The direction is recorded in [visual-language.md](visual-language.md) and its sources in [reference-audit.md](reference-audit.md).

## What changed

Website (`apps/web`):

- One stylesheet tree replaces the old three-layer `site.css`: base, chrome, mock, home, capabilities and pages.
- The home page is rebuilt around a live handoff window, a halo lit by the working agent and a letter roll.
- Further sections: a logo-sprite marquee, a scroll-flattened product reveal and a night capabilities band with a gliding tab indicator, then odometer numbers, a word wheel, the FAQ and a night finale with a giant footer wordmark.
- Utility pages are glass sheets over a soft halo.
- The logo sprite cut the home page's HTML from about 200 KB to about 147 KB.

Every eyebrow is gone, and `check-styles.mjs` now rejects new ones in the website, the desktop and the shared primitives.

Shared (`packages/ui`):

- **Glass tokens.** The tokens cover window, fills, card, rims, blurs and shadows, and the concentric radii.
- **Motion tokens.** Glide and bloom.
- **Font.** Geist on the desktop in place of Inter.
- **Pill primitives.** Buttons, segmented controls, switches, chips, menus, tooltips and dialogs.
- **Token tests.** Every glass fill over the worst plausible material must keep 4.5:1 text, and blur and shadow values may come only from tokens.

Desktop (`apps/desktop`):

- **Window.** The sidebar sits on the window material. The chat (with its docked terminal), the settings pages and the Changes panel float as layers. The composer is a frosted capsule whose rim breathes in the working agent's glow.
- **Floating surfaces.** Menus, popovers, dialogs and tooltips are frosted. Settings groups and transcript cards are rimmed cards, and every control is a pill.
- **Settings breadcrumb.** It now sits in the header band, as the chat header does.
- **Scrollbars.** On Windows, scrollbars are rounded thumbs without arrow buttons.

Native (`apps/desktop/src-tauri`):

- Windows 11 build 22523 and later uses the Acrylic system backdrop, and builds 22000 to 22522 keep Mica.
- A glass window hands its caption colours back to the system. `GlassEffect` gains `acrylic`, and the bindings are regenerated.

## Browser evidence

Website:

- `test:browser` passes in Chromium and WebKit, including the new full-motion pass. It covers axe on every route, the light page under a dark OS preference, no-JS, reduced motion, 390 and 320px reflow and the CSP.
- `static.test.mjs` passes 4 of 4.

Desktop:

- **Layout probe.** All 824 views are clean: every preview mode in Chromium and WebKit, light and dark, at 1440x900 and 1024x700.
- **Glass emulation.** Development previews take `&glass=acrylic` to paint a colourful desktop behind the window, or `&backdrop=worst` for the worst plausible material. `check-layout.mjs --glass worst` repeats the probe over that backdrop. The chat, its opened pickers and menus, the Changes panel, new chat, the terminal, settings, Customize, Agents, setup and Plugins & MCP are clean on it in both appearances.
- **Suites.** These pass in both engines:
  - `check:chat`: 32 accessibility scans and 24 header selections per engine.
  - `check:customization`, `check:setup` and `check:header-labels`.
  - The instructions suite (22 axe scans) and the plugin library suite.
- **Fixes the suites forced.** Their axe scans caught five contrast misses on lit glass fills before they shipped: the picker rows' details, the new-chat agent meta, the Changes tab count, the queue's Held pill and a Git review error line. Each is fixed and the scan passes. In WebKit, a box-shadow transition started under the composer's running halo animation never advanced, so the steering suite's settle wait timed out. The composer now drops that transition while the halo runs. The header-labels fixture gained one folder, because Geist sets its "long" label narrower than Inter did.
- **Unit tests.** Desktop: 572 passed, 19 skipped. The shared token tests pass, including text contrast on every glass fill over the worst material.

## Native evidence (Windows 11 build 26300, 150% scaling)

Native checks ran with isolated data folders and the scripted demo agent only:

- **Debug build** (embedded frontend): the stream smoke passed with 0 sequence gaps at about 168 fps. The chat smoke passed 30 of 30 checks, and the reopen launch passed 8 of 8, with a clean quit each time.
- **Release build:** the chat smoke passed 30 of 30.
- **Window behaviour:**
  - Dragging by the caption moved the window exactly as far as the pointer.
  - A corner resize changed the size exactly. The window clamps at its 960x640 minimum.
  - Hovering maximize shows the Snap Layouts flyout, and maximize and restore work.
- **Captures in dark and light:**
  - The Acrylic material is shared by the caption and the sidebar.
  - The chat and settings float as layers, and the settings breadcrumb sits in the header band.
  - The composer glows while the demo agent works.
  - Scrollbars are rounded thumbs without arrow buttons.
- **Smart App Control:** it blocked one later debug build ("An Application Control policy has blocked this file"). The policy was left unchanged, and that binary was not run.

These checks do not cover macOS vibrancy or Liquid Glass, a Mica-only Windows 11 build, Windows 10's opaque fallback, or live vendor model turns.

## Limits

CI was not run, at the owner's request; the local checks above are the evidence. Browser fixtures and native captures are kept apart. Neither establishes macOS release acceptance.

## Integrated desktop verification, 2 November 2026

The memory, model/thinking picker, transcript, request flow, image previews, Customize navigation,
agent discovery and local dictation changes extend Halo. This verification does not establish the
owner's visual lock.

Browser fixtures in Chromium and WebKit passed for chat, model/header controls, images, dictation,
requests, Settings-to-Customize navigation and the complete Customize suite. Relevant desktop
states ran in light and dark. The website's four static tests and browser suites passed again,
including dark system preference, no JavaScript, mobile reflow and CSP checks. These are browser
results, not native material or microphone evidence.

The integrated Windows x64 debug app, with its production frontend embedded, ran in isolated
data folders beside the installed host. The stream check received 144 events in 132 frames with
zero sequence gaps. All 33 chat checks and all eight reopen checks passed, with clean database
and runtime-registry shutdown. New native checks cover:

- Paste/import and decoding through the real image IPC, opening and closing the full preview,
  sending the image, and decoding its saved thumbnail and full preview after relaunch.
- All three Settings links opening the intended Customize section in both appearances, with
  destination focus and the original chat, session and unsent draft preserved.
- Instructions opened from the chat and project folder retaining their exact scope.

A separate manual inspection used the same isolated debug app, selected by its process and window
handle. The saved-image gallery and dialog, compact composer, Settings and Customize were inspected
in the native window. Both appearances remained readable without overlapping controls. The model
picker kept Thinking visible above its scrolling list and showed that stopped-chat choices apply
on startup. The dictation panel displayed the on-device model download step. The test process was
then stopped by its own PID; the installed host remained running.

The combined frontend passed 650 unit tests and 29 script tests, production build/typecheck,
Biome and style checks. Rust formatting and Clippy with warnings denied passed. The broad Rust run
passed 753 core unit tests, 477 driver unit tests, 198 process unit tests and 244 desktop unit tests.
Four previously recorded `session_lifecycle` timing tests still fail on this host:
`force_stop_waits_for_daemon_cancel`,
`a_force_stopped_agent_holds_its_session_until_its_process_is_gone`,
`queue_survives_a_restart_held` and `shutdown_all_bounded`.

The pinned Whisper model also passed actual CPU inference and cancellation with the upstream JFK
audio fixture, as detailed in [local dictation](../local-dictation.md). No live microphone capture,
macOS native execution or Windows ARM64 app execution is claimed by this record.

The Windows x64 NSIS installer was then built from `22e9a4a3`. Its actual embedded application,
identified by its AMD64 PE header and auracode product metadata, was extracted without running the
installer. The 65,954,304-byte payload has SHA-256
`889ff1e27edd831f1ea74bdf1397eb875bc24cbdd7839d017c4cbe6fe54260e2`.
Dependency and import inspection found only Windows system and Universal CRT libraries, with no
external C++, OpenMP, Whisper or GGML runtime. That exact payload then passed the stream smoke
(141 events, 129 frames, zero sequence gaps), all 33 chat checks and all eight reopen checks in
fresh isolated data folders. Both chat launches closed their databases and runtime registries.
This is packaged-release evidence; installation into the running host is a separate after-exit
step and must be confirmed against the installed file's full hash after relaunch.
