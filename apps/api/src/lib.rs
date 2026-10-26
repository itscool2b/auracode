//! Account and opaque sync API. Plaintext agent data and account encryption keys never enter it.

pub mod crypto;
pub mod policy;
pub mod possession;
pub mod reset_sql;
pub mod sql;
pub mod types;

pub mod account_sql;
#[cfg(target_arch = "wasm32")]
mod edge;
