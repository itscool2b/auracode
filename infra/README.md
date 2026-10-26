# Cloudflare resources

Created and verified on 2026-10-26 in Cloudflare account `5feb14f2fe605875bcf1472f348cb7ed`.
These identifiers are not credentials.

| Resource | Identifier | Purpose |
|---|---|---|
| D1 database | `auracode`, `b5b9de26-4714-4475-aacc-9f599a7c2eb2` | Accounts, sessions, device registry, encrypted sync records |
| R2 bucket | `auracode-blobs` | Private encrypted attachments and config blobs |
| R2 bucket | `auracode-releases` | Installers, checksums, updater manifests |

D1 uses US jurisdiction, with read replication disabled. R2 was created with the eastern North
America location hint, which is not a data-residency guarantee. Both buckets start private; release
distribution is enabled only with the release pipeline. The database is empty until versioned
application migrations are implemented and verified. No Worker or public route is deployed yet.

The owner authorized permanent deletion of `mijonion-media` and its contents. All 65 objects and
the bucket were deleted on 2026-10-26. `wps-service-cache` and unrelated KV resources were untouched.

Application code goes in Rust Workers. Use checked-in Wrangler configuration and SQL migrations,
separate local/preview data from production, and store credentials only in Cloudflare/GitHub secrets.
Cloudflare Email Service domain onboarding and Turnstile configuration belong to the accounts
milestone. No Neon project, Neon Auth service, Hyperdrive connection, or Resend domain is needed.
