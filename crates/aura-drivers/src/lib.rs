//! Agent drivers: everything that turns an agent's native stream into [`AuraEvent`]s.
//!
//! - [`driver`]: the contract between a session and a driver (the actor, its commands and events,
//!   the bounded event channel, the spawner seam). Frozen for M1a; `testing` (feature `testing`) holds its test
//!   doubles for the session manager's tests.
//! - [`batch`]: the [`batch::FrameBatcher`], which packs events into size-limited, sequence-numbered
//!   frames for the UI, carrying each event's turn tag for storage.
//! - [`mock`]: a scripted agent timeline for the UI demo, the streaming stress test and the demo
//!   agent's driver ([`mock_driver`]).
//! - [`jsonrpc`] and [`acp`]: our own JSON-RPC peer and the Agent Client Protocol driver, with one
//!   dialect per agent family; [`factory`] creates the driver for each kind.
//! - `replay` (feature `replay`): the ACP driver against a fake agent playing a recorded protocol
//!   log, compared with golden events.
//!
//! [`AuraEvent`]: aura_protocol::AuraEvent

pub mod acp;
pub mod batch;
pub mod driver;
pub mod factory;
pub mod jsonrpc;
pub mod mock;
pub mod mock_driver;
#[cfg(feature = "replay")]
pub mod replay;
#[cfg(any(test, feature = "testing"))]
pub mod testing;
