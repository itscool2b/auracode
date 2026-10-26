# auracode API

Rust Worker using `worker` 0.8.7, D1, private R2 and Cloudflare Email Service. This is application
source. All account encryption and merge logic stays on clients.

## Invite-only cloud access

Cloud accounts and sync are a private preview without billing or a paywall. Every environment must
set `CLOUD_ACCOUNT_ALLOWLIST` in its Cloudflare secret store. Its value is a JSON array of exact
email addresses, for example `["invited@example.invalid"]` in an isolated fixture. Do not put real
membership in Wrangler vars, source, test fixtures, command arguments or logs. Local development
can use an ignored local secret file with synthetic addresses.

The complete configuration must be valid: a nonempty array of at most 256 addresses and 16 KiB.
Each address uses the same trimmed, ASCII-lowercased email contract as sign-in. There are no domain
wildcards, alias expansion or public membership APIs. Missing, empty or malformed configuration
returns `503 unavailable` for authentication and cloud-feature access. Public `/api/v1/config`
returns `private_preview: true` without exposing addresses or configuration contents.

An excluded address without a nondeleted account receives `403 invite_required` before Turnstile,
email delivery, challenge creation or account creation. Verification rechecks the current list.
Existing accounts may still authenticate after invitation removal for account/session details,
encrypted export, logout, logout-all and fresh-verified deletion. Their verification transaction
never creates or recreates an account: session creation joins only an existing nondeleted account
inside the same atomic D1 batch. Removing an invitation does not delete data or revoke its sessions.
This preserves self-service exit while every device, key, reset, sync and blob route independently
requires current eligibility. Existing valid sessions retain those safe account-management routes
even if the allowlist configuration becomes unavailable. Session expiry/revocation, device
revocation, CSRF and deletion's five-minute verification requirement still apply.

Email changes require both the current account email and destination email to be invited. The
destination is checked before sending and again before consuming its proof. List changes take
effect on subsequent requests; restoring eligibility preserves the existing account and data.
The `invite_required` error is an access pause, not account deletion or a reason to erase local keys.

## Build and checks

From the repository root:

```powershell
rustup target add wasm32-unknown-unknown
cargo test -p auracode-api --locked
cargo clippy -p auracode-api --all-targets --locked -- -D warnings
cargo clippy -p auracode-api --target wasm32-unknown-unknown --locked -- -D warnings
cargo install worker-build --version 0.8.7 --locked
```

From `apps/api`, `worker-build --release` produces Wrangler's generated JavaScript/Wasm entrypoint.
JavaScript is generated runtime glue only. No backend behavior is implemented in JavaScript.

Use `corepack pnpm --filter @auracode/api worker:check` for Wrangler's local deployment dry run.
Wrangler is pinned in this package. Apply local migrations before local
runtime tests. Default bindings name local resources and contain a placeholder D1 ID; they cannot
accidentally address the production database. Production requires explicit `--env production`.

After building, `corepack pnpm --filter @auracode/api worker:test` runs the compiled Rust Worker in
Miniflare with isolated D1/R2, fixed synthetic secrets and a synthetic Turnstile response. Unexpected
outbound subrequests fail and no request reaches the network. The
JavaScript file supplies platform bindings and test assertions, not another implementation of the
backend. Miniflare disposes its owned runtime after the suite. These tests create no real accounts.
The cases include delivery failure and cooldown, wrong-site/action and replayed Turnstile proofs,
browser cookie protections, immediate revocation and scheduled private-object cleanup. The invite
suite uses Miniflare's local-only email capture, changes the secret configuration between requests,
and checks blocked creation, stale-session cloud access, existing-account exit and deletion races.
Successful local delivery also verifies the Rust-composed raw MIME, including Date and a random
Message-ID required by the binding. It does not establish actual external email delivery.

## Production prerequisites

- Verify `auracode.si` in Cloudflare Email Service and enable transactional delivery from
  `signin@auracode.si`. The sender-restricted binding is configured; onboarding is not performed here.
- Create the Turnstile widget for `auracode.si`, action `signin`. Set `TURNSTILE_SECRET` and a new
  cryptographically random 32-byte base64url `AUTH_HMAC_KEY` through Cloudflare's secret store.
  Neither belongs in Wrangler vars, source, logs, GitHub output or command arguments.
  Set its public `TURNSTILE_SITE_KEY` as an environment variable for the website config endpoint.
- Set the reviewed `CLOUD_ACCOUNT_ALLOWLIST` through the intended environment's secret store before
  enabling its API route. Keep preview and production membership separate; never deploy test
  membership or an empty permissive fallback.
- Export/back up D1 and apply the versioned migration to the intended production database. Verify the
  schema with local and preview runtime tests first. Existing D1/R2 IDs are documented in infra/README.
- Install the same-origin `/api/*` route and scheduled trigger. Keep the blobs bucket private with
  no `r2.dev` or public domain. Client uploads/downloads go through session authorization.
- Verify real delivery failure, Turnstile replay/hostname/action checks, cookie behavior, rate limits,
  revocation and R2 cleanup on a separate preview deployment before enabling accounts publicly.
- Integrate the desktop keychain/E2E client and website. This API alone cannot encrypt a profile,
  approve a device safely in UI, or generate recovery keys on the user's behalf.

No deployment, resource mutation, email send or real account authentication is performed by the
Rust unit tests. Installed application signing keys, updater manifests and M5 release publication
remain separate release-pipeline requirements; this API does not fabricate signed installers.

## Protocol

See [the account and sync contract](../../docs/cloud-api-v1.md). API errors return
`{error: snake_case_code, message: safe_message}`. No provider error text or request payload is logged.
Responses use `Cache-Control: no-store`; there is no cross-origin credentialed CORS surface.

Sources checked 2026-10-26: [Rust Workers](https://developers.cloudflare.com/workers/languages/rust/),
[D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[Email Service binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/),
[sender restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/),
and [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
