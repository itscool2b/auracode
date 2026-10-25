//! The streaming top-level key sniffer (package A): fed the bytes of an oversized line, it tracks
//! depth, strings and escapes in constant memory and captures the raw top-level `"id"` value and the
//! `"method"` and `"type"` strings, each at most 256 bytes, wherever they appear.
