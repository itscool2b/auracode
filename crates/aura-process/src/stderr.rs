//! The stderr drain (package A): read continuously into a 16 KiB ring (the tail error cards show)
//! and split into log lines of at most 4 KiB, at most 256 KiB per second logged and the rest
//! counted, so a flood never blocks stdout.
