# Cloudflare resources

Created and verified on 2026-10-26 in Cloudflare account `5feb14f2fe605875bcf1472f348cb7ed`.
These identifiers are not credentials.

| Resource | Identifier | Purpose |
|---|---|---|
| D1 database | `auracode`, `b5b9de26-4714-4475-aacc-9f599a7c2eb2` | Accounts, sessions, device registry, encrypted sync records |
| R2 bucket | `auracode-blobs` | Private encrypted attachments and config blobs |
| R2 bucket | `auracode-releases` | Installers, checksums, updater manifests |
| Email Sending domain | `auracode.si`, `84273eb1ef3c4b108b774bc0e0a000ed` | Passwordless sign-in sender |
| Preview D1 database | `auracode-preview`, `11d6fa29-5c39-49c5-a85b-1ecc7645dbd5` | Isolated acceptance data, US jurisdiction |
| Preview R2 bucket | `auracode-preview-blobs` | Private acceptance ciphertext |

D1 uses US jurisdiction, with read replication disabled. R2 was created with the eastern North
America location hint, which is not a data-residency guarantee. Both buckets start private; release
distribution is enabled only with the release pipeline. The production database remains empty.
Preview deployment status is recorded below.

The owner authorized permanent deletion of `mijonion-media` and its contents. All 65 objects and
the bucket were deleted on 2026-10-26. `wps-service-cache` and unrelated KV resources were untouched.

Application code goes in Rust Workers. Use checked-in Wrangler configuration and SQL migrations,
separate local/preview data from production, and store credentials only in Cloudflare/GitHub secrets.
Cloudflare Email Sending provisioned the return path `cf-bounce.auracode.si`, SPF, DKIM and DMARC
records on 2026-10-26. Its DNS status is `ready`, with no reported errors. Sending is enabled,
reputation is healthy, and account metadata now reports a daily quota of 200 emails with zero sent.
Workers uses the Standard model; subscription billing was not queried. Actual delivery remains
unverified. Production Turnstile and API preparation are recorded below.
No Neon project, Neon Auth service, Hyperdrive connection, or Resend domain is needed.

The preview bucket's managed public domain is disabled and its custom domain list is empty.
On 2026-10-26, the empty preview database was exported before applying migrations 0001 through 0003.
The downloaded SQL backup is in ignored `target/backups/auracode-preview-before-migrations.sql`,
SHA-256 `309d1516f5d4f4f792b17106f7b761312f848c634e3028d70e6eb8ed39df7398`.
All 29 statements succeeded; migration tracking lists all three files, foreign-key checks return no
violations, and the database contains zero users.

On 2026-10-26, preview migrations 0004 and 0005 were applied through the Cloudflare connector after
downloading a fresh 6525-byte backup to `target/backups/auracode-preview-before-reset-deletion.sql`.
Backup SHA-256: `64f20f22a8d01a804cbf8881760e6f70af4eb770f56cc6f94158acfa0bbd2db3`.
All five migrations are recorded, foreign-key checks are clean and the database still has zero users.

The real compiled Rust Worker is deployed as `auracode-api-preview`, using the preview D1 and R2,
the sender-restricted email binding and disabled observability. Its WASM artifact SHA-256 is
`2ea77875999f5bd52ee6bd1b2ee45293d864bdceb399f64f5663fe5e5996fcbe`.
The connector uploaded verified binary WASM and its generated module, preserving platform secrets;
deployment `cae8aeed9aef4352bb0cb6a9d08e79c6` includes reset cancellation and deletion receipts.
Workers.dev and version preview URLs remain disabled. The route is `preview.auracode.si/api/*`,
with the configured five-minute cleanup trigger and an originless proxied DNS record.
A separate managed Turnstile widget permits only `preview.auracode.si`; its public site key is
`0x4AAAAAAFmu9KbL2voFn5QY`. `TURNSTILE_SECRET` and a cryptographically generated 32-byte
`AUTH_HMAC_KEY` were written directly into Cloudflare's secret store without being returned or logged.

Live preview checks pass: health and public configuration return 200 with `no-store`, an unauthenticated
account request returns 401, and a foreign browser Origin returns 403. Actual email delivery, browser
challenge completion, signed-in device sync and live revocation/cleanup acceptance remain pending.
The compiled Rust API passes fourteen local runtime cases, including failed email binding,
Turnstile rejection/replay, cookies, revocation, reset/cancel arbitration, retained deletion receipts
and scheduled ciphertext cleanup. A real Rust client also completes synthetic two-device key approval,
encrypted record/blob exchange and revocation against the compiled Worker. Live health/configuration and access rejection checks passed again
after the deployment. No email was sent.

The documented Static Assets upload returned Unauthorized, and the connector cannot supply its
separate JWT Authorization header. That upload path remains unused. The website is instead compiled
into a small independent Rust Worker and deployed through the ordinary authorized Worker code API.
The Worker has no Assets, D1, R2, email, secret or outbound-service bindings.

On 2026-10-26, the connector deployed `auracode-web-preview`, deployment
`15cc1403e2e24868b449df0066abd0aa`, with `workers.dev` and version preview URLs disabled. Its new
`preview.auracode.si/*` route (`ea92f2dd41954d8bbccda7968688550d`) retains the more-specific API route.
The 985,588-byte Wasm has SHA-256
`fc9b29d7f557fa3cb1e73b3d4830584b1ea623b4ce25e0e81f7d48557ed2f024`; the 20,473-byte generated JS has
SHA-256 `7fea5f5a1ed14314a3fac9d81f3037e8375a9a4db3b535fe546813fc83a41eeb`.

All 48 public files matched the local tested build byte-for-byte over live HTTPS. Nine page HEAD
requests, missing-asset 404, security headers, auth `no-store` and API route precedence passed.
Evidence is in ignored `target/live-preview-verification.json`. Production website publication is
recorded below; public API activation and actual email/Turnstile/device acceptance remain pending.

Universal SSL is enabled. An active Let's Encrypt certificate covers `auracode.si` and
`*.auracode.si`, expires 2027-01-22 and is renewed by Cloudflare. No registrar certificate is needed.

## Production website

The same tested public modules are deployed as `auracode-web`, deployment
`c200b10b3b3544408ea91257a70c79a0`, with the website hashes recorded above. The Worker has no
application bindings, and development and version preview URLs are disabled. The production route
`auracode.si/*` is `dfbdf5b588f1445c9999b14ef75fd319`. The originless proxied apex A record is
`17d49baeed498e13185721a83493ee8d`, pointing to documentation-only address `192.0.2.1`; the Worker
answers these requests without an origin server.

All 48 public files matched the local tested build over `https://auracode.si`. Nine page HEAD
responses, security headers and missing-asset refusal passed. The closed `/api/v1/config` route
returns plain 404 rather than website HTML. Evidence is in ignored
`target/live-production-verification.json`. The live landing page was visually inspected in the
browser. Installers remain unpublished and the production account API is not publicly routed.

The zone's `always_use_https` setting is enabled and verified. HTTP requests to the apex, a nested
download path with a query string, and the preview host returned 301 to the same HTTPS URL.

## Production preparation, public API route inactive

On 2026-10-26, email-content previews were disabled for the existing `auracode.si` sending domain
(`84273eb1ef3c4b108b774bc0e0a000ed`). Readback confirms `preview_enabled:false`, `enabled:true` and
`drop_suppressed_recipients:false`. This avoids retaining sign-in-code message bodies in the Email
Service Activity log. No email was sent and no message content or existing secret was read.

Before any production schema write, inspection found only D1's internal `_cf_KV` table. The complete
SQL export was downloaded to ignored `target/backups/auracode-production-before-migrations.sql` in
the `auracode-web-worker` managed worktree. The backup is 32 bytes, SHA-256
`309d1516f5d4f4f792b17106f7b761312f848c634e3028d70e6eb8ed39df7398`, export bookmark
`00000001-00000000-00005110-0d7425c001b1a6491da77902b2cb9de5`.
Migrations 0001 through 0005 and the same `d1_migrations` tracker used in preview were then applied
to `b5b9de26-4714-4475-aacc-9f599a7c2eb2`. All 35 statements succeeded. All five migration names are
recorded, `PRAGMA foreign_key_check` returns no rows, and users, sessions and devices each count zero.

The separate managed production Turnstile widget is named `auracode production sign-in`, public
site key `0x4AAAAAAFnCekg62MEAwe_j`, with the single allowed-domain entry `auracode.si`. Cloudflare
domain entries also permit their subdomains; the Rust API independently requires the exact
`APP_ORIGIN` hostname and `signin` action. Preview retains its separate widget and secret.
The new widget secret and a freshly generated 32-byte HMAC key were written directly into production
Worker secret bindings. Their values were never returned, logged, copied into a local file or read back.

`auracode-api` contains the root task's already-tested compiled modules: 1,059,109-byte Wasm,
SHA-256 `2ea77875999f5bd52ee6bd1b2ee45293d864bdceb399f64f5663fe5e5996fcbe`, and 29,811-byte generated
JavaScript, SHA-256 `20f208e0d5dfee4413440affbc90e9ae9d9e5990ebf07135d5427223331f8dfb`.
Bytes were verified again inside the connector before ordinary multipart code upload. Code was
initially staged without an authentication key, so it failed closed while public development
endpoints were disabled. Production bindings were added only after that disabled state was verified.
The configured deployment is `35304950-7ef5-4b73-bfc1-011877401f54`, with version
`a6b23422-0e67-44b8-bbec-d6bd17404ea0` at 100 percent.

Readback confirms the production D1 ID, private `auracode-blobs`, `APP_ORIGIN=https://auracode.si`,
`EMAIL_FROM=signin@auracode.si`, the exact sender allowlist and both secret binding names. The bucket's
`r2.dev` access is disabled and its custom-domain list is empty. `workers.dev` and version preview
URLs are disabled; observability was configured disabled, Logpush is false, and the five-minute
cleanup cron is verified. No public API route or apex DNS record was added by this preparation.

Activation remains gated on the root task's source-check confirmation. Root owns the apex DNS and
production website route. Before opening accounts publicly, complete actual email delivery,
Turnstile/hostname/action acceptance, signed-in device approval/sync/revocation/cleanup checks and
the operator identity, legal contact and retention review described in `apps/web/README.md`.
The legal pages remain drafts. Preparation does not qualify those real-user flows or authorize
test bypasses, and no denied Assets upload, auth or billing endpoint was retried.

## Private preview and website analytics

The current access policy is an invitation-only cloud preview, with no payment flows. Before
activating the new API build, set `CLOUD_ACCOUNT_ALLOWLIST` independently on production and preview
as a secret JSON array of reviewed addresses. Never put membership in source, logs or browser code.
Missing, empty or malformed configuration denies cloud access. Existing accounts retain their
authenticated export, logout and fresh-verification deletion paths when membership is removed.
This is distinct from public account launch and does not resolve the legal-review requirements.

Cloudflare automatically injected an analytics beacon which the strict website CSP rejected. On
2026-10-26, the zone configuration ruleset `ac102c9e05884870928e61c835bccb08` was created in phase
`http_config_settings` with rule `7cfc6746108a4bbc9879589be10f6262`, reference
`auracode_disable_injected_analytics`. Its `set_config` action sets `disable_rum: true` for exactly
`http.host in {"auracode.si" "preview.auracode.si"}`. Readback verified the rule and a browser-agent
HTML fetch found no injected analytics. Unrelated sites and security controls were not changed.
See Cloudflare's [configuration-rule settings](https://developers.cloudflare.com/rules/configuration-rules/settings/).

The invitation build was subsequently uploaded to both API environments. Preview deployment is
`5e39dc99677c4f7fb58274accecedd1f`; production deployment is
`08607e5f6a334bec9fc4697fcd25b36c`. Their tested Wasm is 1,086,146 bytes, SHA-256
`4918d17be4919c1655b7c3f6261f48446b6681a01dd8f79aa6b8cf73a7760ef7`, and generated JavaScript is
29,939 bytes, SHA-256 `ea31dab3f90ad2c749daf772d97706d3921dce396be22e2c7f8cb615657fcc1e`.
Each environment has its own secret `CLOUD_ACCOUNT_ALLOWLIST` with the owner-approved membership;
existing secrets were preserved without reading their values. All 23 compiled API runtime checks
pass on these root-built modules. Live preview health/config return 200, unauthenticated account
returns 401, and an excluded synthetic email receives 403 `invite_required` before any challenge.
Preview user, session and challenge counts remain zero. Production API routing remains inactive.
No real email was sent, and the websites still need the newest invitation UI/assets deployment.

## Notices and invitation-order update (2026-10-26)

Deployments now use Wrangler with temporary configs under ignored `target/deploy-*` that mirror
the checked-in environment sections, set `no_bundle` and upload the tested modules unchanged.
Wrangler keeps existing secrets; secret names were rechecked after upload and no values were read.

- `auracode-web-preview` version `e31091c4-83c3-448b-aa5d-00f448bdeca4`: JS 20,473 bytes, SHA-256
  `7fea5f5a1ed14314a3fac9d81f3037e8375a9a4db3b535fe546813fc83a41eeb` (unchanged); Wasm 1,107,745
  bytes, SHA-256 `e926c1c676e2aa179e619160ee45457ef95a479378b8e23f1da9ce6cfcee7ff0`. All 53 public
  files match the local build over HTTPS, including `/third-party-notices` and its notice text; ten
  page HEAD checks, the notices frame policy, footer link, API precedence and missing-asset 404 pass.
- `auracode-api-preview` version `e4550760-f4c9-47fe-b1f9-24b2b09d5a55`: JS unchanged
  (`ea31dab3…`); Wasm 1,087,289 bytes, SHA-256
  `9d545e661c1928e3a8fa355d196bed041364342b58ebf8cea77391e28d800d6a`. Membership is answered only
  after the per-IP limit and Turnstile. Live: config and health 200, unauthenticated account 401,
  uninvited address with no token 400 and with an invalid token 403, never `invite_required`.
  Preview D1 still has zero users, sessions and challenges; one HMAC-keyed IP rate row exists.
  Bindings, cron, disabled `workers.dev`/preview URLs and all routes are unchanged.

The production website and production API staging await explicit owner approval. Production
still serves website deployment `c200b10b…` and staged API `08607e5f…`, with no `/api/*` route.
