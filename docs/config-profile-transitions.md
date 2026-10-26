# Account-managed configuration transitions

The shared vendor homes and existing logins remain in place. An Account may own only configuration
identities explicitly claimed by a successful reviewed synchronization action. Remote heads and
merge bases do not establish ownership. A claim stores the original device baseline and latest
completed Account snapshot inside that Account's encrypted profile. Local/unmanaged files and
credential stores are not migrated.

## Managed claim contract

`AccountConfigServices.managed` implements `ConfigManagedStore`. The synchronous functions in
`aura_config::sync::managed` run inside the existing owned blocking task, while retaining the
profile lease, Library mutation lock and maintenance admission:

1. Validate the review and prepare the file action without writing it.
2. Call `prepare_claim(store, &review.local, desired)` before filesystem application, publication
   or merge-base advancement. It durably records a pending token and the desired content hash.
3. Apply files when required, then await the existing `review.complete` acknowledgment.
4. Call `commit_claim(store, &claim, desired)` only after success. A failure leaves the pending
   claim visible and blocks a profile transition. Never claim success after a failed acknowledgment.

`cancel_claim` is allowed only before any effect began, or after a verified rollback. A timeout or
generic error is not proof of rollback. A canceled initial claim owns nothing. Later attempts may
capture a fresh unmanaged baseline; an already committed claim always retains its first baseline.

For an uncertain pending claim, prepare a fresh explicit three-way review and retain its previous
claim token privately. After resolving outstanding filesystem receipts and revalidating that review,
use `resume_claim(store, &previous_claim, &fresh_local, desired)`, then the normal apply/complete/commit
sequence. This replaces the pending token while preserving the original baseline, including an
uncommitted first claim. File rollback does not imply that remote publication or the base was undone.
The automatic runner must never resume a pending claim.

Automatic sync considers only `store.load()?.document.items` entries with `committed == true` and
`pending == None`, plus an established merge base. First-link, vendor-required, device-only,
conflicting, skipped and recovery cases remain manual. The store has no implicit network behavior.

The desktop runs at most eight managed identities after a successful encrypted Account exchange,
using a rotating cursor. Open manual reviews are excluded. It shares the Library mutation lock and
profile admission with manual application, and unchanged bases do not generate writes. The shared
executor revalidates each review, records ownership before effects and commits ownership only after
file/publication/base acknowledgment. History restoration persists a skipped marker before changing
files, so an automatic cycle cannot immediately republish the restored version. Configuration sync
shows pending claims and offers a fresh explicit review after filesystem recovery.

The whole ownership document is one authenticated, atomically replaced encrypted record, bounded
to 8 MiB and the existing maximum item count. This avoids a crash gap between an item index and its
snapshots. A size-limit failure occurs before replacement or vendor mutation. Missing/corrupt state
is an error, never an empty manifest. Profile close invalidates the service. Snapshot values and
pending tokens never enter IPC, logs or plaintext sidecars.

## Remaining transition coordinator

This foundation does not yet switch vendor configuration. The next step will snapshot outgoing
managed content, restore its baselines and apply the incoming Account snapshots under one durable
transition coordinator. Incoming baselines must match the restored device state; unavailable,
conflicting and unresolved items fail visibly. A nonsecret, strictly validated root locator will
identify the encrypted pending transaction before any mutation. Interrupted work must block native
launches and expose a typed recovery action until completion or rollback. Profile publication comes
only after successful file and encrypted-state acknowledgments. No isolated agent home or implicit
re-login is introduced.
