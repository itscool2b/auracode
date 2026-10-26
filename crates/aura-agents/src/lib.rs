//! The agents auracode can start, and what it takes to start each one.
//!
//! - [`catalog`](mod@catalog): the data. Each [`AgentSpec`] names its driver, its dialect, how to find and run it
//!   ([`Recipe`]), its start timeout, the vendor daemons the kill rule spares, and the version last
//!   verified with auracode.
//! - [`Detector`]: whether each agent can start here ([`Availability`]), probed with the resolved,
//!   scrubbed env and cached; and the launch spec of one start, which installs an npm adapter the
//!   first time ([`Detector::prepare_launch`]). Other crates' tests use [`Detector::fixed`], whose
//!   [`FixedAgent`]s answer as given.
//!
//! The catalog includes native Claude, Hermes, the Claude and Codex ACP adapters, and the demo agent.
//! Detection never installs or runs an adapter. Installation has its own timeout and the user's
//! consent (creating the chat after the download note).
//!
//! [`Availability`]: aura_protocol::session::Availability

pub mod catalog;
mod detect;
pub mod hosts;
mod install;
pub mod installation;
pub mod installer;
mod launch;
pub mod maintenance;
mod npm_entry;
mod probe;
pub mod releases;
mod shared;

use std::time::Duration;

pub use catalog::{AgentSpec, Recipe, UserBinary, catalog, get, parse_version, version_at_least};
pub use detect::{Detector, FixedAgent, Gate};
pub use launch::LaunchError;

/// A detection probe (`<program> --version`) is killed with its tree after this.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Probes keep at most this much output.
pub const PROBE_MAX_STDOUT: usize = 64 * 1024;

/// The one-time adapter install (`npm ci`) may take this long.
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// The installed adapter's `--version` check, which loads every module, may take this long.
pub const INSTALL_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
