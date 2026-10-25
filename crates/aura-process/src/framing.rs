//! The bounded line framer (package A, ported from `docs/spikes/claude-control/src/framing.rs`):
//! 64 KiB reads, split on `\n` only, one trailing `\r` dropped, lossy UTF-8, empty lines skipped,
//! lines whose first non-space byte is neither `{` nor `[` dropped as noise, and lines over the cap
//! skipped while the sniffer keeps their top-level keys.
