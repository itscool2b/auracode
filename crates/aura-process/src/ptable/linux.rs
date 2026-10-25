//! Linux: parsing `/proc/<pid>/stat` and `/proc/<pid>/cmdline` (package A). The parser is pure and
//! builds on every OS so its tests run everywhere; only reading `/proc` is Linux-only.
