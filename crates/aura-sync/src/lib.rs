//! Rust account and sync foundation. Secret-bearing types deliberately do not implement Serialize
//! or reveal their contents through Debug. The cloud receives authenticated ciphertext only.
pub mod account;
pub mod api;
pub mod clock;
pub mod crypto;
#[cfg(feature = "sqlcipher")]
pub mod database;
pub mod merge;
pub mod vault;
pub mod wire;
