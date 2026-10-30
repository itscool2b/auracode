# Visual checkpoint, 30 October 2026

Status: implemented for review, not yet visually approved. Branch: `codex/visual-system`.

## What is ready

The shared Aura foundation supplies paired light and dark palettes, Inter desktop typography, Geist website typography, semantic code and terminal colors, neutral primary controls, compact radii and restrained motion. System appearance is the default; explicit choices persist per desktop profile or website browser. Desktop native themes and existing terminal instances follow appearance changes.

The representative implementation covers the website homepage and desktop chat, Changes panel, General settings and populated Plugin library. Standalone animals, water effects and magnetic motion have been removed from production entry points; the actual logo is preserved. The homepage has a real desktop selector detail, an uncropped desktop context image, six capability tabs and the stepped handoff proof. Existing actions and workflows are retained.

The governing direction and reference limits are in [visual-language.md](visual-language.md) and [reference-audit.md](reference-audit.md). Broader surface polish and native release acceptance remain after visual review. Do not treat this checkpoint as a complete release or the screenshots as an approved golden baseline.

## Review artifacts

Run `pnpm --filter @auracode/web build`, then `node apps/web/scripts/design-checkpoint.mjs --serve` from the repository root. The script writes `target/visual-checkpoint/index.html` and 20 PNG captures. It serves the gallery on `http://127.0.0.1:1439/`, the website on port 1440 and synthetic desktop previews on port 1438. These are local previews, not a deployment. Without `--serve`, the capture script exits after writing the artifacts.

The gallery contains the full and first-viewport homepage, mobile homepage at 390 x 844, chat with Changes, General settings, Plugin library, permission request, agent/model picker, terminal panel and minimum desktop at 960 x 640. Every view has light and dark captures. Standard desktop captures use 1440 x 900; the website's product image is captured separately at 1440 x 760. General settings starts at scroll position zero and full-page homepage captures start at the top. Desktop data and terminal output are synthetic fixtures rendered by production components.

Regenerate the website's actual product images with `node apps/web/scripts/product-images.mjs`. The checked-in light and dark assets come from the existing populated chat and agent lineup fixtures, including the full Changes panel and complete installed-agent picker rows.

## Verification

- Workspace lint, type checks, unit/static tests and production builds pass locally. The test run passed 1,191 tests, with 19 existing desktop tests skipped. Biome reports CSS specificity warnings without errors.
- The homepage, forms, theme persistence, non-JavaScript fallback, CSP, keyboard behavior and accessibility pass the website browser suite in Chromium and WebKit.
- Desktop chat and header suites pass in Chromium and WebKit, including 32 accessibility scans and 24 header selections per engine. Setup checks cover both themes and the absence of independent mascots.
- The complete settings suite passes in Chromium and WebKit after integrating the verification-frame theme checks.
- The checkpoint layout run passes all 64 combinations: eight representative states, two themes, two window sizes and two browser engines. It checks overflow, control overlap, contrast and keyboard focus. The optional `--strict-grid` report retains spacing diagnostics without treating every measured text dimension as a correctness failure.
- Core appearance preference tests cover old-record defaults, saved values, profile isolation and stale revisions. Frontend tests cover system resolution and terminal palette updates without replacing terminal buffers.
- Account verification passes targeted Chromium and WebKit checks across the real cross-origin frame: explicit appearance, live switching, System changes, widget cleanup, stale-proof invalidation, unchanged frame/nonce, forged-message rejection, storage limits, CSP and accessibility.
- The exact Rust-generated TypeScript bindings were exported by the macOS bootstrap job in [CI run 41004771626](https://github.com/itscool2b/auracode/actions/runs/41004771626) for native source commit `4e4b1130be81e7a1e43a2c0e0b3e1208998eaa2d`. The generated file was copied unchanged. The local native build was blocked by Windows Application Control when a dependency build executable was launched. Browser fixtures and successful binding export do not establish native window, menu or release acceptance.
- macOS Clippy and Rust tests passed in that run for the unchanged native source. Native UI smoke/release acceptance and the Windows job were still pending when this checkpoint was prepared.

The final native CI result must be recorded before treating the entire rollout as verified. The bootstrap run used an intermediate commit, so its frontend job is not evidence for the final checkpoint.

## Next review

The owner reviews homepage, populated chat, General settings and Plugin library in both themes. Record accepted changes, the approved commit and artifact locations here before extending this direction across every remaining surface. After rollout, run the complete browser matrix and supported Windows/macOS native checks before opening a pull request.
