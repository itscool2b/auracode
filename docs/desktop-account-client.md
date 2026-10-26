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
