//! The agents auracode can start, and what it takes to start each one.
//!
//! - [`catalog`]: the data. Each [`AgentSpec`] names its driver, its dialect, how to find and run it
//!   ([`Recipe`]), its start timeout, the vendor daemons the kill rule spares, and the version last
//!   verified with auracode.
//! - [`Detector`]: whether each agent can start here ([`Availability`]), probed with the resolved,
//!   scrubbed env and cached; and the launch spec of one start, which installs an npm adapter the
//!   first time ([`Detector::prepare_launch`]).
//!
//! M1a knows Hermes, the Claude and Codex ACP adapters, and the built-in demo agent. Detection never
//! installs and never runs an adapter; the install is its own step, with its own timeout and the
//! user's consent (creating the chat after the download note).
//!
//! [`Availability`]: aura_protocol::session::Availability

pub mod catalog;
mod detect;
mod install;
mod launch;

use std::time::Duration;

pub use catalog::{AgentSpec, Recipe, UserBinary, catalog, get, parse_version, version_at_least};
pub use detect::{Detector, FixedAgent};
pub use launch::LaunchError;

/// A detection probe (`<program> --version`) is killed with its tree after this.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Probes keep at most this much output.
pub const PROBE_MAX_STDOUT: usize = 64 * 1024;

/// The one-time adapter install (`npm ci`) may take this long.
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// The installed adapter's `--version` check, which loads every module, may take this long.
pub const INSTALL_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
