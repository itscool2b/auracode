# Desktop account client foundation

`crates/aura-sync` owns account transport, cryptography and app-only secure storage in Rust. This is
not completed M7 acceptance: desktop account IPC/UI, SQLCipher profiles, durable outbox/merge/cursors,
config adapters and macOS execution are still pending. No real sign-in or credential-store access was
used during development. The cloud contract is `docs/cloud-api-v1.md` on the cloud API branch.

## UI and actor seam

One serialized account actor owns `Account`. Its public view contains `id()`, `device_id()`,
`access()` and `key_fingerprint()`. It never exports the bearer, device private key or account key to
IPC. `local_key()` is a Rust-only backend seam for the encrypted profile and sync engine. Local keys
survive sign-out, session expiry and device revocation. A replacement Account owner invalidates older
owners' network and persistence capabilities within the process.

`local_key_handle()` shares only a durably confirmed key with the Rust profile writer through an
`Arc`; it is never an IPC payload. Last-owner drop zeroizes the key. This handle deliberately keeps
offline storage available after sign-out or revocation and grants no network permission. Unconfirmed
remote keys are unavailable through both local-key APIs.

The visible sign-in view solves Turnstile and calls `ApiClient::begin_auth` and `verify_auth`. After
the user chooses available OS storage, or explicitly chooses a passphrase fallback, call
`Account::signed_in`. The vault scope derives from the API client's actual HTTPS origin; it cannot be
overridden to read credentials for a different service. Existing bundles retain their private keys.
`Account::restore` is offline and never treats a retained token as permission to sync.

Call `connect(now_unix_seconds)` to verify the server session. An approved retained device proves
private-key possession through rebind. Lost registration responses are reconciled using the bound
device and its actual public key. An abandoned pending registration requires explicit registration
again. A revoked device stops at Denied. Only Ready may use the account's pull/push methods.

| Access | User action |
| --- | --- |
| VerificationRequired | Connect or retry the visible failed operation. No sync yet. |
| NeedsDevice | Name this computer and register it. |
| NeedsFirstKey | Prepare a recovery key, display its text once, ask the user to retain it, then initialize. |
| PendingApproval | Compare the locally derived six-digit code with a trusted device, or use the recovery key. |
| VerifyAccountKey | Compare the complete fingerprint on the new and trusted devices, then explicitly confirm locally. |
| Ready | Sync is allowed while session checks remain valid. |
| SignedOut / Expired / Denied | Local data remains available; sign in again to authorize network access. |

`prepare_first_key()` returns an ephemeral `FirstKeySetup`. Its recovery text is secret: display it
only in the explicit recovery view, never logs, analytics, localStorage or account metadata. Dropping
setup cancels without a server write. Only after the user confirms retention may the actor call
`initialize(setup, now)`. Initialization and recovery pin the locally known key before accepting a
server response. A remotely approved new device must call `confirm_account_key` only after the user
compares all fingerprint groups with `key_fingerprint()` on the trusted approving device.

The actor calls `approve` only after an explicit matching-code comparison. It fetches the target
device by ID, validates the actual public key and pending lifetime, then seals the retained account
key to that public key. Names and server display codes never authenticate the recipient.

## Persistence and failures

Vault I/O runs on blocking workers. The versioned secret bundle atomically contains the device key,
optional session, device ID and pinned or pending account key. Unknown or truncated bundle versions
are refused and left untouched. Queued writes carry an owner epoch and generation so cancellation or
a replacement sign-in cannot let an older queued write resurrect a removed token. Newly received data
keys are not exposed locally until their successful durable save and required trust confirmation.

Every request uses a bounded body and deadline. There are no implicit retries, redirects or hidden
auth prompts. A lost mutation response is reconciled by fetching server state; code verification
requires a new code if its token response was lost. HTTP 401/403 clear the live session immediately,
persist that removal, and retain local keys. The client never replaces failed pulls with empty data.

`sign_out()` halts live network access first, retains local keys, persists token removal and attempts
server revocation. Its result reports whether server revocation was confirmed. A vault failure is
returned as an error, never reported as completed sign-out; the UI must let the user unlock storage
and retry. If local persistence and server revocation both fail, the disk may still hold the older
token. Restore always requires explicit session verification before sync. Recovery/passphrase loss
does not trigger a plaintext fallback or erase the encrypted profile.

Pending gates: IPC cancellation and window/profile switch integration, private profile directory
validation, SQLCipher keying/migration backups, local-only import consent, real OS storage execution
on macOS, visible Turnstile/account UI, encrypted offline queue/merge, config preview/rollback, and
end-to-end approval/recovery across two real app devices. Those are not claimed complete here.
## Encrypted profile storage seam

`aura-core/account-sync` enables SQLCipher-backed account opening. Obtain a profile-bound
`DatabaseKey` from the locally confirmed account key and pass an `Arc` to
`Store::open_encrypted(&profile, key)`. `Store::open` refuses Account profiles before touching their
database. Local profiles continue through their existing plaintext open and recovery path.

The store retains the key for a separate integrity connection and encrypts each pre-migration online
backup. Call `store.check_integrity()` rather than the unkeyed path helper for account data. The
sidecar `aura.encrypted.db.encryption` is bounded, contains only a format version and initialization state, and
blocks unkeyed path opens even in a build without the account feature. An unknown marker, wrong key,
damaged encrypted header, or missing database previously marked ready never creates an empty
replacement. Migration failures roll back after a keyed backup. No database key appears in SQL text.

Accounts use `aura.encrypted.db`, while Local retains `aura.db`. A build predating encryption cannot
mistake the ciphertext for corrupt plaintext at its old path. If an old account database or its
sidecars are present, the account open fails before changing either location. Import/restore must be
explicit and may not silently choose a database. Acquire the existing profile ownership guard before
activating an account, as for Local, so another auracode process cannot change the profile concurrently.

Encrypted recovery currently stops with an actionable error and preserves the original file. It does
not invoke plaintext salvage, `VACUUM INTO`, schema-page rewriting, or unkeyed scratch files. Explicit
encrypted-backup restoration still needs its product flow. SQLCipher encrypts the database, WAL and
backup data only. External attachment/checkpoint files and protocol logging must be handled separately
before enabling production account sessions; this checkpoint does not claim those files are encrypted.

The `EncryptedFiles` backend now publishes only ciphertext in a capability-bound profile directory.
Its bounded format marker pins the file key and purpose. Reads refuse final-component links and
immutable writes validate existing ciphertext before treating a repeat as success. Synced temporary
ciphertext is published with a non-replacing hard link, so unsupported filesystems report an error
rather than silently overwriting data. Failed writes remove their own temporary object. Actual
attachment, dead-letter and checkpoint callers still need this backend wired into their paths.

## Transaction-bound sync ledger

Migration0007 adds the persisted device clock, pull cursor, coalesced outgoing heads and deferred
encrypted revisions. `SyncLedger` requires a keyed Store and pins account, device, key version and
key fingerprint. Its `edit_metadata` callback writes the application projection inside the same
transaction as metadata encryption, the clock and outgoing record. Changed fields need the new
clock; field removal is an explicit tombstone. A failed callback leaves all four unchanged.

`outgoing` returns at most 32 records. After HTTP, `accept_heads` merges the authoritative replies
against the current local metadata, preserving edits made while the request was in flight. Only a
head containing the current local state clears that outgoing item. Push replies do not advance the
pull cursor. `accept_pull` authenticates and validates the whole ordered page, merges fields, calls
the projection callback and advances its cursor in one transaction. A damaged final record rolls
back earlier projections too. Unknown schemas are retained before cursor progress and block old
edits or outgoing replacement of that item. No server error or payload is logged by the ledger.

The ledger currently processes project/chat metadata. Config and immutable chat-chunk codecs are
retained as authenticated ciphertext for their dedicated processors, which remain to be connected.
The sole writer integration, scheduler, typed project/chat projection adapters, device-identity
renewal, config previews/applies and account switching are still required for end-to-end acceptance.
