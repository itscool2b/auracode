# Styling review, 30 October 2026

Status: the full website and desktop styling pass is implemented. The owner has confirmed the website must stay light and the desktop should default to System. Final integration checks are in progress; the complete design has not been explicitly locked as a golden baseline or accepted as a native release. Branch: `codex/visual-system`.

The website direction combines Typesafe/Jev, Harvey and Vercel: two offset chat and handoff planes on a muted coral dither field with technical registration, a framed real desktop screenshot, open capability rail, inverse closing CTA and ruled utility pages. The desktop extends the Devin-informed direction across its screens, retaining auracode capabilities and logo. Independent water and animal decoration is removed; the logo remains. Shared light and dark tokens, desktop Inter, website Geist and Geist Mono code establish a common foundation.

Desktop appearance defaults to System with profile-local Light and Dark overrides. The website is permanently light with no appearance control or persisted theme, including the script-free standalone notices page and the hosted verification page when embedded in the desktop. Existing workflows and actions remain in scope; no Devin-only features are implied.

## Review artifacts

The reproducible gallery contains **96 captures**: 12 website views in light appearance and 42 desktop views in each appearance. It includes desktop and mobile homepage views, utility pages, settings, account, configuration, agents, plugins, terminal, chat, permissions, recovery and Git states. The manifest and images are in `target/visual-checkpoint/`; the generated `index.html` is the gallery entry. `node apps/web/scripts/design-checkpoint.mjs --serve` regenerates it and serves the gallery at `http://127.0.0.1:1439/`, website at `http://127.0.0.1:1440/`, and desktop fixtures at `http://127.0.0.1:1438/`. Build the website first. Captures use synthetic fixtures, not live account data.

Use these captures as the complete styling proposal until the owner locks the design. Run `node apps/web/scripts/product-images.mjs` to regenerate the light website product screenshot after relevant desktop changes. The desktop gallery retains both appearances.

The governing direction and reference limitations are in [visual-language.md](visual-language.md) and [reference-audit.md](reference-audit.md). The reference audit does not establish a complete live-site review or native parity.

## Verification status

The integrated light-only website revision passed `pnpm check` and `pnpm build`: 1,192 tests passed and 19 were skipped. Website browser checks passed in Chromium and WebKit, including a dark OS preference, an old saved dark preference, no-JavaScript rendering, accessibility, mobile reflow and light verification widgets. Earlier chat and setup browser checks passed in both engines after the desktop pass.

The complete desktop layout matrix covered 824 views across Chromium and WebKit, both themes, and 1440 x 900 / 960 x 640 windows. Chromium passed all 412. WebKit reported one keyboard-focus finding on the light 960 x 640 queued-message textarea; that exact case passed an isolated rerun with 35 focus stops. The original report is retained in `target/layout-browser/webkit.json`, with the isolated evidence in `target/layout-isolated/`. No product change was made to hide the result. A settings run also encountered a non-reproducing module import failure; an isolated recovery rerun passed. The final complete settings suite passed in both browsers after updating its hosted-verification expectation to the light-only website contract, retaining nonce, sign-in, security and persistence checks.

The live gallery's theme filters, image loading, website hydration and fixed-light notices passed a final browser check. Regenerating the website product images with the light-only generator produced identical committed assets.

Independent Chromium and WebKit hit tests verified the restored 52px native drag region above the settings breadcrumb, including after scrolling. Browser fixtures and screenshots do not establish native window, menu or release acceptance. Local Windows Rust compilation is blocked by Windows Application Control; that policy was not changed. Supported Windows and macOS checks are running in [CI run 41011586464](https://github.com/itscool2b/auracode/actions/runs/41011586464) for implementation commit `49b8932d5184a1a4866078291613906434c667ed`.

The exact Rust-generated TypeScript bindings were exported by the macOS bootstrap job in [CI run 41004771626](https://github.com/itscool2b/auracode/actions/runs/41004771626) for native source commit `4e4b1130be81e7a1e43a2c0e0b3e1208998eaa2d`. That intermediate run is not evidence for final integrated frontend or native release acceptance.
