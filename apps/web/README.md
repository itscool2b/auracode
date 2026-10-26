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
shared Geist font package and the approved dark Orbit values.

## Reference evidence

Read the root task's `docs/design/reference-audit.md`, then inspected these original references:

- [SpaceXAI Grok Bot](https://mobbin.com/sites/sections/dfea7d6f-670a-4d55-8289-ff0267c89efb): sparse
  navigation, concise title and a large contained product viewport.
- [Aside hero](https://mobbin.com/sites/sections/bdad14df-7d77-4d9d-8c30-dfd826d134d1): centered headline
  and action, with the actual product below. Its light palette and cloud art are not reused.
- [Harvey product framing](https://mobbin.com/sites/sections/599949fd-6c3a-4f84-84cf-e74a9082141d):
  restrained text hierarchy and contained product presentation. The original audit's Harvey panels
  remain the account/table structure reference.

The screenshot is the actual dark React desktop fixture supplied by the root task on 2026-10-26,
not a fabricated product mock. Refresh it from the integrated desktop before public release.
The SVG globe and orbital mark are original Orbit geometry. Reduced motion stops rotation and
entrances. No third-party reference image is shipped.

## Deployment prerequisites

The assets-only `wrangler.toml` remains available. The separate [Rust website Worker](../web-worker/README.md)
embeds the same public build for ordinary code deployment without an Assets upload. Deploy one
implementation for a given website route, and rebuild from the final integrated source. Neither
implementation has been deployed by this source checkpoint. `/api/*` must resolve to the more-specific Rust API Worker route on the same
origin. Verify this precedence in a separate preview before publishing the site. The generated
`_headers` supplies a hash-based CSP for the exact prerendered framework scripts. Rebuild headers
whenever HTML changes. Turnstile is the only permitted third-party script and frame origin.

Complete API Email Service onboarding, secrets and migrations, and set the public
`TURNSTILE_SITE_KEY` Worker variable for the intended hostname. A missing key disables sign-in with
a clear message, never a test-key bypass. Preview tests must exercise actual delivery, expiration,
resend/rate limits, CSRF/cookie behavior, account changes and streaming downloads against the Rust
Worker. Browser fixture tests do not qualify those external services.

Publish signed Windows/macOS installers, per-artifact SHA-256 checksums and release notes before
enabling download links. No version or download is invented here. Confirm the supported ARM64
builds in the final release matrix. Final operator identity, legal contacts, retention/legal review
and desktop plaintext export/import acceptance are required before opening accounts publicly.
The pre-release legal pages explicitly state their draft status.

The API export is a streamed encrypted JSONL archive, not a readable chat export. It must end with
the `complete` marker. Browser download failure must be retried; the website never buffers the
entire archive or receives account keys. Desktop E2E acceptance remains a separate gate.
