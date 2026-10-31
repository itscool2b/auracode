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

Git receives numeric scratch names through `hash-object --no-filters -w --stdin-paths` and literal
NUL-terminated index records through `update-index -z --index-info`. Inputs are at most 1 MiB.
Hash batches additionally contain at most 512 files to bound per-object disk flush work inside
the helper deadline. Durable objects and refs use full fsync; the disposable scratch index does
not. User indexes, attributes, filters, and hooks remain outside this path.

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
