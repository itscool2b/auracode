# Styling review, 30 October 2026

Status: the full website and desktop styling pass is in progress and under test. The owner has not yet visually approved it. The current proposal and captures are not an approved golden baseline or release acceptance. Branch: `codex/visual-system`.

The website direction combines Typesafe/Jev, Harvey and Vercel: two offset chat and handoff planes on a muted coral dither field with technical registration, a framed real desktop screenshot, open capability rail, inverse closing CTA and ruled utility pages. The desktop extends the Devin-informed direction across its screens, retaining auracode capabilities and logo. Independent water and animal decoration is removed; the logo remains. Shared light and dark tokens, desktop Inter, website Geist and Geist Mono code establish a common foundation.

Desktop appearance defaults to System with profile-local Light and Dark overrides. The website is permanently light with no appearance control or persisted theme, including the script-free standalone notices page. Existing workflows and actions remain in scope; no Devin-only features are implied.

## Review artifacts

The review gallery is being expanded from the original representative checkpoint to approximately 100 captures across the website and desktop, states and viewport sizes, with both desktop appearances and the light-only website. The exact count and final artifact locations must be recorded after capture. Use the final integrated source and review captures as proposals until the owner approves them. Run `node apps/web/scripts/product-images.mjs` to regenerate actual product images after relevant desktop changes.

The governing direction and reference limitations are in [visual-language.md](visual-language.md) and [reference-audit.md](reference-audit.md). The reference audit does not establish a complete live-site review or native parity.

## Verification status

The full implementation is being tested. Record final commands, results, skipped checks and gallery count here after the integrated run. Earlier checkpoint checks are not evidence that the newer full pass is complete. Browser fixtures and screenshots do not establish native window, menu or release acceptance. Supported Windows and macOS native verification remains a separate gate.

The exact Rust-generated TypeScript bindings were exported by the macOS bootstrap job in [CI run 41004771626](https://github.com/itscool2b/auracode/actions/runs/41004771626) for native source commit `4e4b1130be81e7a1e43a2c0e0b3e1208998eaa2d`. That intermediate run is not evidence for final integrated frontend or native release acceptance.
