# Checkpoint capture and prompt latency

Aura saves a checkpoint before dispatching an ordinary queued prompt. This is an application
feature that provides consistent Changes and selected-file revert across native harnesses.
The harness still owns model execution and its native tools. A failed capture holds the prompt;
stopping a capture leaves it unsent. Native steering retains its existing separate lifecycle.

## Local capture

Every capture discovers eligible paths again and reads their current bytes through the existing
capability-relative, no-follow scanner. SHA-256, file mode, exclusions, and size limits remain
authoritative. Equal sizes or modification times never authorize reuse.

The service retains hints from at most eight successful folder/root captures in memory. Matching
content avoids another scratch copy and Git hash operation. Before reuse, bounded binary
`cat-file --batch` responses must match the expected object type, length, and SHA-256. An unchanged
complete file map can also reuse a tree after every cached tree body matches its expected bytes.
Tree inventories are optional and bounded to 20,000 trees and 16 MiB; larger valid layouts simply
skip the cache.

Missing cached objects trigger one cold retry. Malformed objects and mismatched contents fail
capture. Verification continues across batches after a missing object so that it cannot hide
later corruption. Hints are removed before fallible work and published only after the new ref
and manifest are durable. Every successful turn still gets a distinct checkpoint, commit, ref,
and version 1 manifest, even when its tree is unchanged.

Freshly written blobs are also verified before publication: Git can reuse an existing object
without replacing damaged contents. This keeps a cold retry from bypassing the check. Verification
helpers read at most 4,096 objects and 16 MiB of output per batch.

Blob writes use a fresh bare staging repository whose only worktree contains numeric scratch
copies. Each batch gets its own temporary index and writes objects only into the private checkpoint
store. Workspace and checkpoint-store attributes, filters, and hooks cannot participate; the staging
repository starts empty and global/system configuration remains isolated. Returned stage entries
must match every numeric identity before their object IDs are mapped back to captured files.

On APFS/HFS+ and NTFS/ReFS, Git's `add` transaction uses its documented `batch` durability strategy:
object writes share a full disk-flush barrier before becoming visible. Other filesystems and failed
filesystem detection retain full per-object fsync. Filesystem detection uses a handle to the actual
object-store directory. See [Git's durability configuration](https://github.com/git/git/blob/v2.55.0/Documentation/config/core.adoc).

NUL-terminated pathspec and final index inputs are at most 1 MiB. Blob batches contain at most 256
files, with up to four independent writers active. Verification and real-path index/tree/ref
publication wait for every writer and remain sequential. Objects and refs are durable; disposable
indexes are not fsynced. User indexes remain outside this path.

## Concurrency and cancellation

A process-wide coordinator reserves both the canonical workspace root and its profile storage
folder identity. Equal or nested roots conflict, including across profiles. Equal storage/folder
identities also conflict if the workspace moves. Disjoint workspaces can proceed concurrently;
older conflicting waiters retain priority.

The initiating future owns cancellation. Blocking workers retain cloned operation contexts and,
when needed, the scratch directory. Cancelling the caller cannot release a workspace reservation
or delete scratch files beneath a worker. Scans stop at cooperative boundaries. Revert and recovery
check cancellation before mutation, then retain ownership through completion or rollback.

## Account capture

Account capture retains its two-pass scan/read fingerprint comparison and authenticated immutable
encrypted objects. It creates no plaintext content or manifest scratch copies. It shares the
workspace coordinator, cancellation rules, and timings, but does not use the Local Git cache.
No storage format, public API, database migration, or checkpoint setting changes are required.

## Diagnostics and verification

Structured prompt timings distinguish actor acceptance, dispatch attempt, checkpoint result and
eligibility, successful driver-command enqueue, first meaningful driver event, and first assistant
text. Recovered queue entries report their original acceptance time as unknown. Enqueue confirms
delivery to the driver command channel, not provider receipt. Existing turn-duration semantics
remain unchanged.

Capture timings cover lease wait, setup, recovery, discovery, scan, verification, tree writes,
publication, and total outcome. Git helpers record duration, operation, and outcome at debug level.
Diagnostics contain IDs, counts, and durations, never prompt text, filenames, or file contents.

Run the focused native regression suite with:

```text
cargo test -p aura-core checkpoints --no-default-features
cargo test -p aura-core --features account-sync --lib
```

The ignored `checkpoint_performance` test creates disposable 1,000, 10,000, and 20,000-file
workspaces and reports cold, unchanged, and one-file-edit captures. With `account-sync`, it measures
both storage modes. `AURA_CHECKPOINT_BENCH_COUNTS` selects comma-separated sizes and
`AURA_CHECKPOINT_BENCH_WARM` selects the number of unchanged samples, defaulting to one.

```text
cargo test -p aura-core checkpoint_performance -- --ignored --nocapture
```

Set `AURA_CHECKPOINT_BENCH_WORKSPACE` to an explicit workspace and run
`checkpoint_workspace_performance` to measure its cold capture and three unchanged captures.
It only reads that workspace; its private checkpoint profile is temporary. The separate
`checkpoint_prompt_performance` fixture measures manager-send to scripted-driver receipt for
three 1,000-file turns. It exercises the real actor and checkpoint path without a provider or
model request. Both fixtures are ignored by ordinary test runs.

Compare the same fixture and build profile against the base revision, without concurrent builds
or filesystem-heavy tests. These timings measure checkpoint completion and exclude provider
latency. See [verification](verification.md) for the Windows/macOS and encrypted-storage gates.

The manual `CI` workflow accepts `checkpoint_benchmarks: true` for a dedicated comparison run.
This mode runs encrypted verification and then the identical fixtures against the chosen baseline
and current source on Windows and macOS. It skips unrelated app/UI jobs and uses a separate
concurrency group, so it does not cancel a normal verification run. Baseline sources, temporary
profiles, and measurement logs stay outside the measured checkout. Artifacts retain raw logs,
normalized measurements, source revisions, fixture identities, and toolchain versions.
Baseline and current builds use separate Cargo target directories. Before timing, the runner
checks each executable's test list against its source and retains that list with the evidence.

These are native test-profile backend measurements. A cold capture starts with an empty private
checkpoint store; it does not flush the operating system's disk cache. The baseline runs first.
The workspace fixture has three unchanged samples, while synthetic fixtures default to one sample
per scenario. Results describe these runs, not tail latency or statistical significance. The send
fixture excludes desktop UI/IPC, real harness startup, provider/model latency, and production log
formatting and writes. It measures Local storage; Account timings come from direct capture.

`AURA_CHECKPOINT_BENCH_DIAGNOSTICS=1` enables a bounded checkpoint-only event collector in the
ignored core fixtures; CI comparisons enable it. Collection adds small bounded allocations and
mutex locking, but formatting and output occur after each elapsed time is frozen. `CAPTURE_DIAGNOSTIC`
records retain phase/helper timings and durability selection without messages, IDs, paths, or
contents, and remain separate from normalized measurement rows.
