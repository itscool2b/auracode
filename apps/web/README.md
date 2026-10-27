# auracode.si

Dark-only React Router 7 interface, prerendered to static HTML. Cloudflare serves `build/client`.
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
block external requests. They cover desktop/mobile overflow, keyboard focus, no-JavaScript
downloads, invalid-code recovery, email-only app links, CSRF headers, revocation confirmation and
typed deletion confirmation. Axe checks the home and account views. Chromium verifies native Tab
order; Windows WebKit lacks the OS full-keyboard-access setting, so that harness explicitly focuses
the skip link and verifies keyboard activation. Real Safari/macOS acceptance remains pending.

React Router 7.18.4 supports TypeScript through version 6 in its peer contract, so this package pins
TypeScript 6.0.3 locally. The desktop/workspace compiler remains unchanged. The website uses the
shared Geist font package and the Graphite tokens from `@auracode/ui`.

## Reference evidence

The site follows the Graphite language in [visual-language.md](../../docs/design/visual-language.md).
Its section 2 records what each reference contributes and section 5 the site composition. The
references are the owner's Mobbin and official-site set: SpaceXAI (x.ai), X Money, Harvey, Aside
and Vercel for organisation, styling and measured motion, and the AI in Design Report 2026 as the
bar for uniqueness, not copied. Timings come from the live sites, not from static images. No
third-party reference image, font or script is shipped.

The product image is a capture of the real desktop interface in its local preview mode, not a
fabricated mock. Regenerate it from the integrated desktop whenever the app changes visibly. The
dither fields, pixel mark and favicon are original and generated at build time by
`scripts/site-images.ts`. Without JavaScript the hero and closing fields show their first frame as
a static image and the other fields step aside for their content (the screenshot, the wordmark,
the 404 numerals). Reduced motion shows a still frame.

## Deployment prerequisites

The assets-only `wrangler.toml` remains available. The separate [Rust website Worker](../web-worker/README.md)
embeds the same public build for ordinary code deployment without an Assets upload. It is deployed
at [auracode.si](https://auracode.si) and [preview.auracode.si](https://preview.auracode.si).
Live checks verified all 48 public files, nine page HEAD responses, security headers and missing-asset
handling. Preview `/api/*` resolves to
the more-specific Rust API Worker route on the same origin. Production `/api/*` remains closed with
404 responses; public accounts are not enabled. Deploy only one website implementation per route
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
