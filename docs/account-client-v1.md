# Desktop account command contract

The desktop resolves `AURACODE_API_ORIGIN` at compile time. Only `https://auracode.si` (the default)
and `https://preview.auracode.si` are accepted. `account_config` returns `service_origin` and
`verification_url`, which is that origin plus `/verify-device`. No command accepts a caller-selected
service URL. The UI must bind the Turnstile frame to this exact origin, its content window and a
fresh attempt nonce. Proofs stay in memory and are discarded after use or cancellation.

Rust owns sign-in, vault access, device keys and account keys. Each command returns a typed result;
`AccountFailure` has `code`, a displayable static `message`, and optional `retry_after_seconds`.
The server's arbitrary error bodies never become UI messages or logs. Request arguments use Tauri's
generated camelCase call syntax; response fields use snake_case.

Account DTOs are also generated independently into `apps/desktop/src/lib/account/bindings.ts` by
`cargo test -p aura-protocol export_account_bindings`. This pure exporter requires no desktop runtime
or native webview; CI checks its exact output. The full native command export remains a separate gate.

| Command | Arguments | Success |
| --- | --- | --- |
| `account_config` | none | `AccountConfiguration` |
| `account_status` | none | `AccountStatus` |
| `account_request_code` | email, turnstileToken | `SignInChallenge { id, expires_in, resend_after }` |
| `account_verify_code` | challengeId, code | `AccountStatus` |
| `account_refresh` | none | `AccountStatus` |
| `account_register_device` | name | `AccountStatus` |
| `account_prepare_recovery` | none | `RecoverySetup { id, recovery_key }` |
| `account_confirm_recovery` | setupId, retained | `AccountStatus` |
| `account_cancel_setup` | none | `AccountStatus` |
| `account_recover` | recoveryKey | `AccountStatus` |
| `account_confirm_fingerprint` | fingerprint | `AccountStatus` |
| `account_devices` | none | `AccountDevice[]` |
| `account_approve_device` | deviceId, verificationCode | `AccountStatus` |
| `account_revoke_device` | deviceId | `AccountStatus` |
| `account_sign_out` | none | `AccountSignOut { status, server_revoked }` |
| `profiles_list` | none | `ProfileMeta[]` |
| `account_activate` | none | `AppInfo` |
| `profile_activate` | profileId | `AppInfo` |

`AccountStatus` contains `access`, optional `account_id`, `device_id`, `profile_id`,
`approval_code`, `fingerprint`, `local_key_available`, and `sync`. Access values are `signed_out`,
`verification_required`, `needs_device`, `needs_first_key`, `pending_approval`, `verify_account_key`,
`ready`, `expired`, and `denied`. The sync object reports `state`, optional `pending_changes`,
`last_sync_at` and `message`. Device and sync timestamps use Unix milliseconds.

After verification, call refresh to check the session binding and discover the required next step.
Device registration uses the native Windows/macOS platform. First-device setup displays the recovery
key only after the explicit prepare action; it must never enter diagnostics, URLs, localStorage or
other frontend persistence. Confirmation requires the current setup ID and `retained: true` within
ten minutes. Closing setup calls cancel and clears transient UI text. A replacement setup invalidates
the previous ID. Recovery input is cleared from its Rust buffer after parsing.

A pending device displays a code computed from its own key. The trusted source accepts a code the
user compared on the recipient and refetches that recipient before wrapping its account key. The new
recipient must separately compare the complete account-key fingerprint with the trusted source.
`verify_account_key` is not ready for sync or local profile activation. Existing confirmed keys stay
pinned across sign-out, reconnect and recovery. Revoking the current device halts sync, removes its
bearer and retains local decryption access. A sign-out with `server_revoked: false` has removed the
local session but could not confirm remote revocation.

The coordinator retains no email. Account/profile bindings use a separate app-owned vault namespace
bound to the canonical local data root and service origin. The bounded index remembers at most eight
accounts and fails closed on corruption, duplicate profile bindings or a future schema. An empty
`accounts.lock` file serializes that index across processes; it is never deleted. New Account profiles
use opaque UUIDs and the literal display name `Account`. Opening/restoring the coordinator performs no
network request. IPC mutation tasks finish their state publication even when their invoking page
reloads. Sync remains inactive until its writer projection and scheduler are attached.

Profile activation is explicit after local key confirmation. `account_activate` selects the current
account's separate dataset; `profile_activate` selects an existing Local or remembered Account
profile. Neither command imports, merges or converts Local data. Before invoking either command,
the UI must finish saving drafts. The native transition drains already admitted commands, refuses
live agents, owned file work and terminals, then flushes the current store. Target ownership,
encrypted storage, metadata and recovery are prepared before the active pointer changes. Preparation
failure preserves the current runtime and pointer. The transition also serializes with quit and
application-update installation.

A successful transition emits `profile-changed` with the new `AppInfo`. The UI must reload the
webview, discarding its stores, cached content, promises and channels. Native page tokens and
notification generations are invalidated; pending Library previews are cleared. Rust operations
may retain a `ProfileLease` through their owned task, and cached work can retain its
`ProfileGeneration` token to reject use after a transition. `AppInfo.profile_switching` reports
admission closure; `profile_locked` reports a selected Account dataset awaiting its local key.

Startup of a selected Account profile initially opens no database and reads no vault on the startup
thread. It then restores only auracode's own local key without a network request. Failure retains
the locked dataset and allows explicit Local selection. Account activation rejects known legacy
plaintext logs, journals and database paths without reading their contents or deleting them.
