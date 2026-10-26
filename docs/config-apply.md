# Reviewed configuration application

`aura-config` receives trusted user configuration roots from the active desktop profile. It never
discovers a home directory, reads credentials, starts an agent, or chooses an Account profile itself.
The host holds its profile and configuration mutation guards through the operation. Scope mismatch,
missing agents, unavailable observations and executable package declarations are explicit skips.
They do not establish deletion or advance the device merge base.

`ConfigScanner::prepare_apply` compares the expected local snapshot with a new observation. Its
ten-minute, consuming review binds the canonical configuration root, retained directory identity,
selected identity, complete document bytes or complete skill tree, and proposed bytes. JSON uses
duplicate-safe raw spans. TOML edits retain unrelated comments and tables. Only leading `~` or `~/`
paths are expanded to the host-supplied home. Foreign OS paths cannot masquerade as portable items.
Windows skips executable files whose mode it cannot preserve.

`ConfigApplyJournal` belongs to the unlocked Account profile. The sink encrypts both its UUID index
and receipts, caps history at 256 records and each compact binary receipt at 8 MiB, authenticates
reads and compares exact SHA-256 receipt hashes for replacement. A receipt contains the destination
binding and original/proposed bytes, including private fields of a mixed settings document. These
bytes never become cloud configuration snapshots, UI previews or plaintext profile files. Receipt
creation and its encrypted index must be durable before returning to the filesystem writer.

Publication uses a temporary `.auracode-apply-<UUID>` directory inside the original configuration
realm, with owner-only Unix permissions and the enclosing user-directory ACL on Windows. It contains
only temporary file payloads, never a plaintext receipt. Original files are displaced and verified;
new files are published using no-clobber hard links. All file reads and parent traversal refuse
symlinks. The writer flushes payloads before publication and removes verified temporary payloads
after success. A filesystem without the required hard-link operation returns recovery-required.

A crash can leave plaintext temporary publication files beside the vendor configuration. This is
the same protection realm as the original file, not a retained Account backup. The encrypted receipt
records their exact names and bytes for recovery. A changed displaced original, unknown temporary
file or conflicting user edit is preserved, and recovery refuses to delete it. The app must show
recovery-required rather than claim application succeeded. It must not advance a merge base after
`NeedsRecovery`, a skipped item, a storage error or an incomplete inverse transaction.

Explicit rollback rechecks the encrypted receipt and local destination. A verified original that
was displaced before a crash can be restored without overwriting a recreated destination. Other
inverse writes have their own encrypted receipts. Later changes to selected files or selected
document values block rollback; unrelated JSON/TOML fields are preserved. Rollback is idempotent
after its receipt is marked complete. Trees preserve binary dependencies and remove only empty
directories after reviewed file deletions.

Windows temporary-fixture tests cover stale reviews, durable journal failure, final acknowledgment
failure, partial trees, crash after displacement, changed original retention, explicit tombstones,
private-field preservation, formatting, per-device skips and restart rollback. macOS execution,
the encrypted profile sink and desktop orchestration are separate integration gates. Protected MCP
entries still wait in this checkpoint; secret-free projection is a follow-up.
