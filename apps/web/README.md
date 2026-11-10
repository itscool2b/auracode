# auracode.si

React Router 7 interface that follows the system appearance, prerendered to static HTML. Cloudflare serves `build/client`.
`entry.server.tsx` is build-time React rendering only; the server output is removed by `ssr:false`.
There is no JavaScript application backend. The Rust Worker in `apps/api` owns every account,
authentication, authorization, email, export and sync operation.

## Local checks

```powershell
corepack pnpm --filter @auracode/web typecheck
corepack pnpm --filter @auracode/web test
corepack pnpm --filter @auracode/web test:browser
corepack pnpm --filter @auracode/web dev
```

Browser checks use owned headless Chromium and WebKit, synthetic API/Turnstile responses, and
block external requests. They cover dark and light with the system (and the verification frame pinned light),
desktop/mobile overflow, keyboard focus, the agents' chips at every width (complete, in view,
still) and as toggle buttons, the feature cards, the phone menu, no canvas and no Pause button, no-JavaScript downloads, invalid-code recovery, email-only app links, CSRF headers, revocation confirmation and
typed deletion confirmation. Axe checks the home and account views. Chromium verifies native Tab
order; Windows WebKit lacks the OS full-keyboard-access setting, so that harness explicitly focuses
the skip link and verifies keyboard activation. Real Safari/macOS acceptance remains pending.

React Router 7.18.4 supports TypeScript through version 6 in its peer contract, so this package pins
TypeScript 6.0.3 locally. The desktop/workspace compiler remains unchanged. The website uses the
shared Geist font package and semantic tokens from `@auracode/ui`.

## Reference evidence

The website was rebuilt on 10 November 2026 as a close copy of dot.com (the Grok Bot page), as [visual-language.md](../../docs/design/visual-language.md) describes. [reference-audit.md](../../docs/design/reference-audit.md) records the actual observations and their limits. The owner has not yet visually approved the pass. No third-party reference artwork or brand assets are shipped.

The product image is a capture of the real desktop interface in its local preview mode, not a
fabricated mock. Regenerate it whenever the app changes visibly with
`node apps/web/scripts/product-images.mjs`: it captures the desktop's `?preview=settled` at 1440 by
760 and 2x, in light and in dark, and writes the WebP sources (480, 960, 1440 and 2240 wide) and
the light PNG fallback. The card views are drawn from tokens after the app's own preview modes (New
chat, a pending handoff, the Changes panel and the queue); update them with the
app. The favicons and social card are generated at build time by `scripts/site-images.ts` from the
logo's own paths. Without JavaScript the site still follows the system appearance, the agents' chips show the
default choice and the FAQ opens natively. The standalone notices page is script-free and follows the system appearance too. The changelog page is built from the repository's `CHANGELOG.md` by `scripts/changelog.ts`. The website has no appearance control or persisted theme. Reduced motion disables the live window and transitions.

## Deployment prerequisites

The assets-only `wrangler.toml` remains available. The separate [Rust website Worker](../web-worker/README.md)
embeds the same public build for ordinary code deployment without an Assets upload. It is deployed
at [auracode.si](https://auracode.si) and [preview.auracode.si](https://preview.auracode.si).
The Rust API Worker is routed on both hosts, and its current public configuration reports
`private_preview=true`; public accounts are not enabled and downloads are not published. Production styling deploys automatically from main after merge through Cloudflare Workers Builds;
verify the deployment against the merged commit. Deploy only one website implementation per route
and rebuild from the final integrated source. The generated `_headers` supplies a hash-based CSP
for the exact prerendered framework scripts. Rebuild headers
whenever HTML changes. Turnstile is the only permitted third-party script and frame origin.

Production API Email Service configuration, secrets, migrations and the hostname-specific public
`TURNSTILE_SITE_KEY` are prepared; nonsecret deployment evidence is in [infra/README.md](../../infra/README.md).
Email-content previews are disabled. A missing site key disables sign-in with a
clear message, never a test-key bypass. Preview tests must still exercise actual delivery, expiration,
resend/rate limits, CSRF/cookie behavior, account changes and streaming downloads against the Rust
Worker. Browser fixture tests do not qualify those external services.

Public installer signing is deferred at the owner's request. Downloads remain disabled until
reviewed Windows/macOS installers, per-artifact SHA-256 checksums and release notes are published
under [docs/releases.md](../../docs/releases.md). Unsigned package compilation and native installation
checks remain separate acceptance gates, including the supported ARM64 builds. Final operator identity, legal
contacts, retention/legal review and live desktop E2E acceptance are required before opening accounts
publicly. Desktop readable export and Local import are implemented with focused fixture checks.
The pre-release legal pages explicitly state their draft status.

The API export is a streamed encrypted JSONL archive, not a readable chat export. It must end with
the `complete` marker. Browser download failure must be retried; the website never buffers the
entire archive or receives account keys. Desktop E2E acceptance remains a separate gate.
