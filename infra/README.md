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
distribution is enabled only with the release pipeline. The database is empty until versioned
application migrations are implemented and verified. No Worker or public route is deployed yet.

The owner authorized permanent deletion of `mijonion-media` and its contents. All 65 objects and
the bucket were deleted on 2026-10-26. `wps-service-cache` and unrelated KV resources were untouched.

Application code goes in Rust Workers. Use checked-in Wrangler configuration and SQL migrations,
separate local/preview data from production, and store credentials only in Cloudflare/GitHub secrets.
Cloudflare Email Sending provisioned the return path `cf-bounce.auracode.si`, SPF, DKIM and DMARC
records on 2026-10-26. Its DNS status is `ready`, with no reported errors. Actual delivery and
Workers paid-plan eligibility remain unverified. Turnstile configuration is still pending.
No Neon project, Neon Auth service, Hyperdrive connection, or Resend domain is needed.

The preview database and bucket were created on 2026-10-26. The database has no application tables
yet. The preview bucket's managed public domain is disabled and its custom domain list is empty.
The two checked-in `--env preview` configurations reserve `preview.auracode.si` for acceptance;
they do not publish it. Database backup/migrations, separate secrets/widget and deployment remain
pending. The compiled Rust API passed twelve local runtime cases, including failed email binding,
Turnstile rejection/replay, cookies, revocation and scheduled ciphertext cleanup. No email was sent.
