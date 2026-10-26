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
records on 2026-10-26. Its DNS status is `ready`, with no reported errors. Actual delivery and
Workers paid-plan eligibility remain unverified. Production Turnstile configuration is pending.
No Neon project, Neon Auth service, Hyperdrive connection, or Resend domain is needed.

The preview bucket's managed public domain is disabled and its custom domain list is empty.
On 2026-10-26, the empty preview database was exported before applying migrations 0001 through 0003.
The downloaded SQL backup is in ignored `target/backups/auracode-preview-before-migrations.sql`,
SHA-256 `309d1516f5d4f4f792b17106f7b761312f848c634e3028d70e6eb8ed39df7398`.
All 29 statements succeeded; migration tracking lists all three files, foreign-key checks return no
violations, and the database contains zero users.

The real compiled Rust Worker is deployed as `auracode-api-preview`, using the preview D1 and R2,
the sender-restricted email binding and disabled observability. Its WASM artifact SHA-256 is
`ab614304a96015270a6eec16bc9615f48c51d744e4c536dd27c03f7a2e310e6e`.
Workers.dev and version preview URLs remain disabled. The route is `preview.auracode.si/api/*`,
with the configured five-minute cleanup trigger and an originless proxied DNS record.
A separate managed Turnstile widget permits only `preview.auracode.si`; its public site key is
`0x4AAAAAAFmu9KbL2voFn5QY`. `TURNSTILE_SECRET` and a cryptographically generated 32-byte
`AUTH_HMAC_KEY` were written directly into Cloudflare's secret store without being returned or logged.

Live preview checks pass: health and public configuration return 200 with `no-store`, an unauthenticated
account request returns 401, and a foreign browser Origin returns 403. Actual email delivery, browser
challenge completion, signed-in device sync and live revocation/cleanup acceptance remain pending.
The compiled Rust API previously passed twelve local runtime cases, including failed email binding,
Turnstile rejection/replay, cookies, revocation and scheduled ciphertext cleanup. No email was sent.

The website's fresh production build is ready (48 static assets). Its Cloudflare upload-session
registration succeeded, but the documented JWT-authenticated asset upload returned Unauthorized.
No website Worker or catch-all route was deployed, and no alternative access path was used after
that denial. Static-site deployment remains pending a supported authenticated upload path.
