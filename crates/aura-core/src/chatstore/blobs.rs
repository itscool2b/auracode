//! Blob files (package C): `<profile>/attachments/<sha256>`, written `.partial`, synced and renamed,
//! at most 64 MiB stored per blob, read back in pages that end on a character boundary.
