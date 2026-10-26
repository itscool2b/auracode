//! Rust account and sync foundation. Secret-bearing types deliberately do not implement Serialize
//! or reveal their contents through Debug. The cloud receives authenticated ciphertext only.
pub mod api;
pub mod crypto;
pub mod wire;
