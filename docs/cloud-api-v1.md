# Account and encrypted sync API v1

Implementation: `apps/api`, Rust Worker. This contract is not evidence of a deployed or accepted
account service. The desktop E2E crypto specification is `docs/sync-crypto-v1.md` on its integration
branch. Account and device IDs are server-generated opaque 32-byte random base64url strings.

All binary fields use canonical URL-safe base64 without padding. Identifiers accept ASCII letters,
digits, `_` and `-`, at most 128 bytes. Requests are JSON, capped at 6 MiB while streaming, with a
45-second request deadline. Response errors expose only safe codes/messages. Secrets, emails and
request payloads never enter application logs. No credentials occur in deep links.

## Authentication

| Method and route | Request | Response |
| --- | --- | --- |
| POST `/api/v1/auth/challenges` | `email`, `turnstile_token`, `client_kind` (`browser` or `desktop`) | `challenge_id`, `expires_in:600`, `resend_after:60` |
| POST `/api/v1/auth/verify` | `challenge_id`, six-digit `code` | `user_id`, `expires_at` (Unix seconds), `csrf_token`, `token` (desktop only; null for browser) |
| GET `/api/v1/auth/session` | authentication | `session:{user_id,client_kind,device_id,created_at,expires_at}`, `csrf_token` |
| POST `/api/v1/auth/logout` | authentication | `ok:true` |
| DELETE `/api/v1/account` | authentication verified within five minutes | `deletion_pending:true` |

Turnstile is validated server-side, including exact hostname and action `signin`. Requests from a
browser require the configured HTTPS Origin. Desktop initiation still solves Turnstile in a visible
verification UI, then sends its token through Rust. Codes expire after ten minutes, allow five
attempts and are consumed in the same D1 batch that creates the user/session. Resend replaces the
challenge after 60 seconds. Wrong, expired, consumed and undelivered codes never create a session.

The API sends the same email regardless of whether the account already exists. Bounded rates apply
per HMAC-keyed email and Cloudflare client IP. Failure or timeout in email sending returns
`delivery_failed` and invalidates that challenge. Request a new code after the cooldown; ambiguous
delivery is never automatically repeated. The service does not pretend an email was sent.

Desktop tokens use `Authorization: Bearer <token>` and belong in the OS keychain. Browser tokens use
`__Host-auracode`, Secure, HttpOnly, SameSite=Strict, Path=/, with a 30-day absolute expiry. A fresh
browser sign-in rotates a presented session for the same account. Mutating cookie requests require
the exact Origin plus `X-Auracode-CSRF`, available from verify/session. Browser and desktop token types
cannot substitute for each other, and ambiguous cookie/bearer combinations are rejected. Every request
checks account/session expiry and revocation. Sync also requires its bound approved device.

## Devices and key envelopes

Lost-key reset uses POST `/api/v1/sync/reset/review` from a pending desktop device whose session was
email-verified within five minutes. It returns `review:{id,key_version,expires_at,records,blobs,other_devices}`;
the version is the next key generation and expiry is Unix seconds. The review describes permanent
removal of all existing encrypted cloud data and revocation of every other device and session.
Confirmation POST `/api/v1/sync/reset` carries `review_id`, exact `confirmation:"RESET SYNC"`,
`wrapped_key`, `recovery_envelope` and `recovery_verifier`. Both envelopes and the verifier bind the
review's next key version using the existing crypto contract. Confirmation rechecks fresh verification,
pending-device state and the prior generation inside the atomic write. It returns the ordinary keys
response. The same exact request may be retried after a lost response for up to one day without repeating
deletion; a changed request conflicts. Ciphertext R2 objects remain tracked until scheduled collection,
so blob quota may temporarily include pending cleanup. Existing offline encrypted profiles are retained.
This endpoint does not recover the old plaintext or require its lost key.

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/api/v1/devices` | authentication | `devices:[{id,name,platform,public_key,verification_code,created_at,last_seen,approved_at,revoked_at}]` |
| GET `/api/v1/devices/:id` | authentication | `device:Device`, independent of the listing cap; 404 for unknown or other-account IDs |
| POST `/api/v1/devices` | `name`, `platform` (`windows`/`macos`), `public_key` (32 bytes) | `device_id`, `verification_code`, `approved:false` |
| DELETE `/api/v1/devices/:id` | authentication | `revoked:true` |
| POST `/api/v1/keys` | `wrapped_key`, `recovery_envelope`, `recovery_verifier` | same as GET keys |
| GET `/api/v1/keys` | bound desktop session | `key_version`, `recovery_envelope`, `wrapped_key` (null until approved), `approved_at` |
| POST `/api/v1/devices/approve` | `device_id`, `verification_code`, `wrapped_key` | `approved:true` |
| POST `/api/v1/devices/recover` | `recovery_proof`, `wrapped_key` | same as GET keys |

Registration assigns the new ID to the authenticated session atomically. A caller cannot register or
sync as an arbitrary existing device. Registration is limited to 32 live devices and pending approval
expires after 600 seconds. Repeat registration after reauthentication if that deadline elapsed.
Revoking a device revokes its sessions and removes its wrapped key. Existing encrypted local data is
retained by the client, which stops network sync.

Only the first device initializes account keys, in one conditional transaction. Later devices require
an approved device or the recovery proof. The initialization record binds its winning device so two
concurrent first-device requests cannot both become approved. Device approval requires an explicit
matching-code comparison in UI. Each client derives its displayed code from its own actual key:

`SHA256(compact_json(["auracode-device-approval-v1", account_id, device_id, public_key]))`

Interpret the first four bytes as unsigned big-endian, take modulo 1,000,000 and pad to six digits.
The client must not trust a server-supplied display code as proof of its own public key.

`KeyEnvelope` is `{algorithm,ciphertext,nonce,ephemeral_public_key}`. Nonce is 24 bytes; the wrapped
32-byte account key plus tag is 48 bytes. Device algorithm is
`x25519-hkdf-sha256-xchacha20poly1305-v1`, with a 32-byte ephemeral key. Recovery algorithm is
`recovery-xchacha20poly1305-v1`, with a null ephemeral key. Initial key version is 1; rotation is not
implemented by these endpoints yet and clients must not claim that revocation erases previously
downloaded ciphertext or key material.

The recovery master key never leaves the client. The encryption key and 32-byte recovery auth proof
use distinct HKDF-SHA256 labels. `recovery_verifier` is base64url SHA256 of the encoded proof string;
`recovery_proof` supplies that derived proof for approval. Pending devices may fetch the recovery
ciphertext, but never another device's key envelope. The server has neither master nor account keys.

## Records, cursors and private blobs

### Retained-device sign-in

A fresh desktop session can regain an existing approved device only by proving possession of its
retained private key. POST `/api/v1/devices/rebind/challenges` with `{device_id}` returns
`{challenge_id,device_id,envelope,expires_in:300}`. POST `/api/v1/devices/rebind/verify` with
`{challenge_id,proof}` returns `{device_id,rebound:true}`. Fetch `/keys` after success.

The envelope algorithm is `x25519-hkdf-sha256-xchacha20poly1305-rebind-v1`. Its random 32-byte
plaintext is a one-use possession proof, never an account key. HKDF-SHA256 uses the same fixed salt
`auracode-hkdf-sha256-v1`, with both info and AEAD AAD equal to compact UTF-8 JSON:

`["auracode-device-rebind-v1",account_id,device_id,challenge_id,recipient_public_key,ephemeral_public_key]`

The proof is canonical base64url. The server stores only its domain-separated HMAC verifier and
atomically consumes it into the fresh session's device binding. It allows five attempts, expires
after five minutes, and rechecks account/session/device revocation during the transaction. Merely
matching a public key never approves a device. A lost successful response can be reconciled through
GET session, which reports the bound device ID.

### Encrypted changes

POST `/api/v1/sync` accepts `{records:[Record]}`, at most 32 per request with no repeated
collection/id pair. `Record` contains:

```text
collection: projects | chats | chat_chunks | config
id: opaque identifier
hlc: 13-digit epoch milliseconds : 10-digit counter : bound device ID
deleted: boolean
nonce: base64url 24 bytes
ciphertext: base64url 16..65536 bytes
key_version: positive integer matching the account's current version
```

HLCs more than five minutes ahead are rejected. Records are accepted only when their HLC is newer
than the current head. `chat_chunks` IDs are immutable after first insert. The response is
`{heads:[...]}`, one authoritative head per input; clients compare it to their submitted envelope
and resolve stale writes or chunk conflicts. Heads and pull records also carry `server_seq` and
the server-bound `device_id`. `deleted` is a JSON boolean in requests and responses.

GET `/api/v1/sync?after=N` returns `{records,next_cursor,has_more}` in increasing sequence order,
up to 32 changes. Cursors are monotonically increasing SQLite sequence integers, scoped by the
authenticated account in every query. Repeated pushes do not create duplicate change rows. The
server retains history and tombstones until account deletion; it performs no plaintext merge.
Clients bind account/collection/id/key-version/HLC/deleted into AEAD AAD before accepting data.

PUT `/api/v1/blobs/:id` accepts `{nonce,ciphertext,key_version,expected_etag}`. Ciphertext is at most
4 MiB. Use null `expected_etag` only to create; replace only with the previously fetched ETag.
Response is `{etag}`. GET returns `{etag,nonce,key_version,size_bytes,ciphertext}`. Blob AAD binds
account/id/key-version. The R2 key and prefix are server-owned and are never caller paths or public URLs.

Blob writes reserve quota before uploading to a unique versioned object. The D1 pointer changes only
if authentication and the expected ETag still match. Losing CAS attempts remain tracked for cleanup,
including request interruption and storage failures. Old versions and abandoned uploads are collected
after the lease expires. A failed cleanup retains its record for the next scheduled retry.

Initial service limits are 100 MiB of sync history and 1 GiB of reserved blob storage per account.
Record accounting includes routing/envelope overhead. These are application defaults, not claims
about Cloudflare plan limits. Quota checks and counters commit atomically with writes.

## Browser account management

GET `/api/v1/config` returns `{protocol:1,turnstile_site_key}`. The public key is null until the
environment has a configured widget. No secret or test key is substituted in production.
GET `/api/v1/account` returns `{account:{id,email,created_at,sync_used_bytes,sync_limit_bytes,
blob_reserved_bytes,blob_limit_bytes}}`. POST `/api/v1/auth/logout-all` revokes every session,
including the caller, without revoking device keys. A retained device can sign in and prove possession.

POST `/api/v1/account/email/challenges` takes `{email,turnstile_token}` and requires a session
created within five minutes. It delivers a ten-minute, five-attempt code to the new address.
POST `/api/v1/account/email/verify` takes `{challenge_id,code}`. Proof is bound to the initiating
session. A successful change preserves the account ID, keys and encrypted data and revokes all
other sessions. An address already belonging to another account returns conflict only after proof;
accounts are never merged. Both routes retain browser Origin/CSRF and send/verify rate limits.

GET `/api/v1/account/export` downloads `auracode-encrypted-export.jsonl`. The stream contains an
account row with device public metadata and encrypted key envelopes, encrypted record history up
to a captured sequence, each current encrypted blob, then a mandatory `complete` marker. It never
includes session tokens, verifier hashes or internal R2 paths. Interrupted downloads lack the marker
and must be retried. Reads are bounded to one record page or one blob and recheck authentication on
each page, with a ten-minute total bound. Blob heads reflect their value when read; pause syncing for
a stable workspace export. Account deletion or revocation aborts an active export. The desktop,
which holds the keys, owns plaintext export and import, not the website.

## Deletion and failure behavior

Account deletion immediately denies authentication and revokes all sessions. Scheduled cleanup clears
records, keys, devices and private objects, then erases the email and retains a random-ID tombstone.
Its R2 prefix is rescanned so a write already in flight at deletion cannot leave an untracked object.
Cleanup is bounded and retries failed work; no unrelated bucket or prefix is touched.

`invalid_request`, `invalid_code`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `quota`,
`rate_limited`, `delivery_failed` and `unavailable` are the defined error codes. Rate/delivery failures
include Retry-After. Clients must keep local encrypted data on all network/auth errors and never
substitute a new empty account state for a failed pull. A response lost after a successful mutation
is reconciled by fetching authoritative state. Code verification itself is single-use; a lost token
response requires requesting a fresh code.
