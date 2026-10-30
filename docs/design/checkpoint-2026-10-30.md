# Styling review, 30 October 2026

Status: the full website and desktop styling pass is implemented. The owner has confirmed the website must stay light and the desktop should default to System. Verification combines completed hosted checks with local checks of the subsequent CI-only correction; the complete design has not been explicitly locked as a golden baseline or accepted as a native release. Branch: `codex/visual-system`.

The website direction combines Typesafe/Jev, Harvey and Vercel: two offset chat and handoff planes on a muted coral dither field with technical registration, a framed real desktop screenshot, open capability rail, inverse closing CTA and ruled utility pages. The desktop extends the Devin-informed direction across its screens, retaining auracode capabilities and logo. Independent water and animal decoration is removed; the logo remains. Shared light and dark tokens, desktop Inter, website Geist and Geist Mono code establish a common foundation.

Desktop appearance defaults to System with profile-local Light and Dark overrides. The website is permanently light with no appearance control or persisted theme, including the script-free standalone notices page and the hosted verification page when embedded in the desktop. Existing workflows and actions remain in scope; no Devin-only features are implied.

## Review artifacts

The reproducible gallery contains **96 captures**: 12 website views in light appearance and 42 desktop views in each appearance. It includes desktop and mobile homepage views, utility pages, settings, account, configuration, agents, plugins, terminal, chat, permissions, recovery and Git states. The manifest and images are in `target/visual-checkpoint/`; the generated `index.html` is the gallery entry. `node apps/web/scripts/design-checkpoint.mjs --serve` regenerates it and serves the gallery at `http://127.0.0.1:1439/`, website at `http://127.0.0.1:1440/`, and desktop fixtures at `http://127.0.0.1:1438/`. Build the website first. Captures use synthetic fixtures, not live account data.

Use these captures as the complete styling proposal until the owner locks the design. Run `node apps/web/scripts/product-images.mjs` to regenerate the light website product screenshot after relevant desktop changes. The desktop gallery retains both appearances.

The governing direction and reference limitations are in [visual-language.md](visual-language.md) and [reference-audit.md](reference-audit.md). The reference audit does not establish a complete live-site review or native parity.

## Verification status

The integrated light-only website revision passed `pnpm check` and `pnpm build`: 1,192 tests passed and 19 were skipped. Website browser checks passed in Chromium and WebKit, including a dark OS preference, an old saved dark preference, no-JavaScript rendering, accessibility, mobile reflow and light verification widgets. Earlier chat and setup browser checks passed in both engines after the desktop pass.

The final CI layout matrix in [run 41015677134](https://github.com/itscool2b/auracode/actions/runs/41015677134) covered 824 views across Chromium and WebKit, both themes, and 1440 x 900 / 960 x 640 windows, with zero findings. Earlier local WebKit reported one textarea-focus finding which passed an isolated rerun; a separate transient module import failure also passed on retry. The final CI matrix is the complete rerun, not an isolated substitute.

The live gallery's theme filters, image loading, website hydration and fixed-light notices passed a final browser check. Regenerating the website product images with the light-only generator produced identical committed assets.

Independent Chromium and WebKit hit tests verified the restored 52px native drag region above the settings breadcrumb, including after scrolling. Browser fixtures and screenshots do not establish native window, menu or release acceptance. Local Windows Rust compilation is blocked by Windows Application Control; that policy was not changed.

Both Windows and macOS native Rust and encrypted-storage jobs passed in the final CI run, including exact bindings, embedded app builds, native stream and chat smoke tests, and Windows external WebDriver smoke. Its browser integration steps passed, including chat, settings, library, account, setup and website checks. Formatting, workflow and ShellCheck steps also passed. The overall run was canceled after its CI-script test stalled: a workflow parsing regex exhibited catastrophic backtracking on the new layout job metadata. A subsequent CI-only correction bounded the parser and added an explicit layout step deadline. Browser fixtures and CI smoke do not replace native release acceptance.

The canceled CI run tested commit `f37741ccaac4fc336e86946d83cb46669d2ff26e`. The subsequent commit `4645a2d5` changes hero punctuation only; its website build, typecheck and Chromium and WebKit browser checks passed locally, followed by `pnpm check` with 1,192 tests passed and 19 skipped.

The CI-only correction is commit `2eb84ef489d026f6030122b2a32a672cbc47dbfa`. Its affected Node CI gate group passed 15 of 15 tests; workflow lint checked two files, Biome checked two files, and binding export passed seven cases. Git Bash `test.sh` finished 78 of 84 checks and exited 1: five unchanged POSIX-versus-Windows path assertions and one unchanged executable-bit assertion failed on this Windows host. The relevant shell scripts match `origin/main`; no fixtures were changed. Evidence is in `target/ci-script-verification.json` and related local artifacts. No overall green CI result is claimed for the CI-only correction.

## Packaging, local installation and rollout

The owner authorized the production styling rollout using the existing verification. The styling rollout is pending merge and automatic Cloudflare deployment; this record does not claim that the new styling is already deployed. Both production and preview API routes exist and the observed public configuration reports `private_preview=true`. Public accounts are not enabled, downloads are unpublished and public installer signing remains deferred.

[Native Build 41119155356](https://github.com/itscool2b/auracode/actions/runs/41119155356) succeeded for all three targets at commit `186feccb`. The x64 installer was downloaded from official artifact `13009744942`, with the archive hash matching. Silent installation returned exit code 0, and the native app opened with System selected. This installation is within the Codex MSIX virtualized LocalCache; an independent normal Windows install and external shortcut were not verified. It is not a public desktop release or native release acceptance.

[CI run 41122959927](https://github.com/itscool2b/auracode/actions/runs/41122959927) at `186feccb` was canceled at the owner's direction while settings checks were active. Before cancellation both native and encrypted-storage jobs passed, all 824 layout views had zero findings, and chat checks passed. The earlier completed browser checks above remain evidence; no overall success is claimed for the canceled run.
