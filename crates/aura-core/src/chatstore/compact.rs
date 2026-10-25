//! Per-turn compaction (package C), pure: deltas concatenated into pieces of at most 1 MiB, each tool
//! merged into one call (or one update for another turn's tool), the last plan and usage kept, every
//! other row verbatim, original sequence numbers kept; plus the full-text rows.
