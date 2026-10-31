# Native checkpoint measurements, 2026-10-31

These measurements compare the Local checkpoint optimization with its baseline using the same
fixtures and workspace on each native runner. They measure backend capture and scripted-driver
dispatch, not complete assistant response time.

- [Validation run](https://github.com/itscool2b/auracode/actions/runs/41177407155).
- Baseline: `af499cd05684df8d2f08e48af21d268b522862f7`.
- Measured implementation: `05d4e42c533559b88a45e729ea86744148f184fe`.
- Identical core fixture blob: `b95e9b975383ace8b45f7609a636159cbe68aa82`.
- Identical prompt fixture blob: `8f5c97c5aeb5f3d3bfe4c312409454a3729e950b`.

## Results

Cells show **baseline to current**, in milliseconds. Unchanged workspace and synthetic captures
use the median of three sequential captures in the same store. Cold, one-file edits, and each
prompt scenario have one observation. The retained measurement files include every sample.

| Platform | Fixture | Cold | Unchanged | One-file edit |
| --- | --- | ---: | ---: | ---: |
| macOS | Local workspace, 1,628 files | 4,920 to 4,190 | 1,733 to 973 | Not measured |
| macOS | Local prompt dispatch, 1,000 files | 3,119 to 2,114 | 1,860 to 467 | 1,855 to 818 |
| macOS | Local, 1,000 files | 1,714 to 1,766 | 861 to 347 | 793 to 429 |
| macOS | Local, 10,000 files | 17,863 to 16,256 | 8,373 to 2,751 | 9,720 to 2,904 |
| macOS | Local, 20,000 files | 38,553 to 38,061 | 18,946 to 5,084 | 20,113 to 5,568 |
| macOS | Account, 1,000 files | 8,055 to 8,099 | 433 to 454 | 436 to 453 |
| macOS | Account, 10,000 files | 80,045 to 84,968 | 4,079 to 4,313 | 4,088 to 4,223 |
| macOS | Account, 20,000 files | 162,822 to 181,441 | 8,473 to 8,281 | 8,472 to 8,227 |
| Windows | Local workspace, 1,628 files | 18,823 to 17,138 | 5,700 to 1,599 | Not measured |
| Windows | Local prompt dispatch, 1,000 files | 9,557 to 9,827 | 2,936 to 712 | 3,020 to 1,109 |
| Windows | Local, 1,000 files | 9,697 to 9,642 | 2,977 to 743 | 3,028 to 1,089 |
| Windows | Local, 10,000 files | 94,763 to 97,140 | 27,556 to 4,934 | 27,605 to 5,661 |
| Windows | Local, 20,000 files | 188,400 to 200,372 | 55,706 to 9,579 | 54,472 to 13,972 |
| Windows | Account, 1,000 files | 7,434 to 7,551 | 815 to 845 | 831 to 824 |
| Windows | Account, 10,000 files | 81,271 to 76,673 | 7,378 to 7,670 | 7,436 to 7,347 |
| Windows | Account, 20,000 files | 150,788 to 156,251 | 14,195 to 14,422 | 14,215 to 14,388 |

On macOS, unchanged Local captures took 43.9% less time on the repository fixture (1.78x speedup)
and 59.7% to 73.2% less on the synthetic fixtures (2.48x to 3.73x). The single unchanged
manager-to-scripted-driver measurement fell by 74.9%. These results do not support a universal
"at least 2x" claim. Local synthetic cold changed +3.0%, -9.0%, and -1.3% at 1,000, 10,000,
and 20,000 files; workspace cold fell 14.8%.

On Windows, unchanged Local captures took 71.9% less time on the repository fixture (3.56x)
and 75.0% to 82.8% less on synthetic fixtures (4.01x to 5.82x). The unchanged prompt-dispatch
observation fell 75.7%. Cold results were mixed: workspace fell 9.0%, while synthetic cold changed
-0.6%, +2.5%, and +6.4% at 1,000, 10,000, and 20,000 files. Prompt cold increased 2.8%.

Account has no established general speedup or non-regression result. Its macOS cold captures
increased 6.2% at 10,000 files and 11.4% at 20,000 files. In the current 20,000-file cold sample,
`write_objects` consumed 179,240 of 181,441 ms (98.8%); scan took 1,072 ms and publication 971 ms.
The baseline lacks phase instrumentation, so this identifies the current dominant stage without
establishing the cause of the difference. Windows Account unchanged medians increased 1.6% to
4.0%; its 20,000-file median was 14,422 ms, with a 14,265 to 15,233 ms range, versus baseline
14,195 ms with a 14,129 to 15,397 ms range. An Account non-regression claim would need repeated
fresh-store comparisons with alternating revision order and diagnostics disabled.

## Verification and provenance

Both native jobs completed successfully. macOS passed 692 core tests; Windows passed 677. Each
passed 64 SQLCipher/sync tests, with three core and one sync test intentionally ignored. Both
Clippy checks and all six benchmark invocations passed on each platform. The fixture invocations
run the ignored benchmarks explicitly, one per process.

The comparison uses separate Cargo target directories for baseline and current sources. Test-list
checks confirmed the cache sentinel absent from the baseline and present in the implementation;
macOS lists contained 661 and 695 tests, and Windows lists contained 645 and 680. Each platform's
artifact contains exactly 37 measurement rows per revision, matching the raw logs. Every workspace
sample captured 1,628 files and 28,343,064 bytes.

Each platform's diagnostics contain 794 events, no dropped-event markers, and seven Local
object-write decisions, all with `batch_fsync=true`. Concurrent Git helper durations overlap
and must not be summed as wall time.

The earlier complete [application and frontend validation run](https://github.com/itscool2b/auracode/actions/runs/41154741726)
passed at `1bcbec79`. Subsequent production changes are confined to checkpoint internals; the
measured revision reruns the affected native core, encrypted-storage, and Clippy gates. Local
compilation checks also passed with and without `account-sync`. Windows Application Control
blocked local Rust test executables, so runtime evidence comes from the native CI runners.

## Measurement limits

These are hosted native test-profile builds with `account-sync`, fixed baseline-first order,
and an empty private store for each cold case. "Cold" does not flush operating-system disk
caches. Three unchanged samples share a store and are not independent fresh-store repeats.
Single cold/edit observations and these medians do not establish statistical significance or
tail latency.

Current workspace and synthetic captures include bounded diagnostic collection; formatting and
stdout happen after timing. Baseline emits no checkpoint phase events. The separate prompt
fixture has no diagnostic collector and uses Local storage with a prestarted scripted driver.
It excludes desktop UI/IPC, actual harness startup, provider/model latency, first assistant text,
and production log formatting and writes.

## Retained evidence

The following files preserve the result beyond the CI artifact retention period. Line endings
are normalized. Diagnostic records retain their following measurement delimiter, which identifies
the file count for that capture; sample numbers restart for each fixture size.

- macOS: [environment](macos/environment.txt), [provenance](macos/provenance.txt),
  [all measurements](macos/measurements.txt), [current capture diagnostics](macos/current-capture-diagnostics.txt).
- Windows: [environment](windows/environment.txt), [provenance](windows/provenance.txt),
  [all measurements](windows/measurements.txt), [current capture diagnostics](windows/current-capture-diagnostics.txt).

See [checkpoint capture](../../checkpoint-capture.md) for implementation guarantees and reproduction
instructions. CI artifacts additionally contain raw compiler/test output and complete test lists.
