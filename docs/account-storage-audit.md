# Account storage activation audit

Scope: integrated root `a81dfb4` plus the M7 metadata work. These are source and synthetic fixture
checks, not a claim that production account switching and synchronization are complete.

| Storage | Account behavior and evidence |
| --- | --- |
| Chat database, WAL and migration backups | SQLCipher key required. Distinct `aura.encrypted.db`; unkeyed/legacy opens fail before plaintext repair. Synthetic migration, backup and reopen tests pass. |
| Composer drafts, continuations and visible handoffs | Existing SQL writer tables, so they inherit the keyed connection. No separate plaintext continuation file found. |
| Attachments and full tool output | Purpose-bound encrypted objects with bounded authenticated pages; native image readers decrypt only in memory. No plaintext fallback. |
| Checkpoint bytes and manifests | Encrypted objects. Empty temporary Git repositories only discover paths; no payload copies or Git objects. Capture/diff/reopen/revert tests pass. |
| Failed database operations | Encrypted bounded JSONL parts and a completion manifest; incomplete groups retain authenticated parts. Recovery browsing/export still needs UI integration. |
| Raw native protocol logs | Disabled by the Account writer's session spawner. Spawn identity and owned-process cleanup remain intact. |
| M4 worktree ownership and recovery journal | `worktree-registry` encrypted metadata object, preserving registry versions 1/2 and typed retained refs. Local registry layout stays unchanged. |
| Setup preferences | Encrypted `onboarding` metadata object, including the first project reference. Plain Account entry refuses access. |
| Terminal output | Existing terminal service streams to the owning window and does not persist output. No login was executed for this audit. |
| Frontend persistence | Production chat/draft stores do not persist transcript data through localStorage/sessionStorage. Dev fixture and stress counters are separate development surfaces. |

The outer profile manifest, active-profile pointer, local device identity, encryption format markers
and process ownership journal remain operational metadata. Account creation must use an opaque
profile ID and a generic Account label rather than persisting sign-in email addresses in that outer
manifest. The leftover-process journal records PID/start time, fixed agent labels and reviewed
daemon matching rules; it does not store prompts, cwd or chat paths.

Explicit worktree checkouts and `.auracode-revert-*` recovery copies are user workspace files. They
remain ordinary files, under the same visible create/revert controls that protect the user's index
and preserve newer edits. They are not encrypted account-profile copies.

Remaining activation work: keyed boot/profile switching and all service constructors, account IPC,
sync writer projection and scheduling, encrypted recovery browsing/export, and macOS runtime
qualification. Diagnostics also need a final check for arbitrary vendor strings before enabling
account sessions; disabling raw protocol logs alone is not a complete diagnostic audit. Existing
Local data is never implicitly imported, erased or converted.
