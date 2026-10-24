//! Agent drivers: everything that turns an agent's native stream into frames of [`AuraEvent`]s.
//!
//! M0 ships the two pieces every later driver builds on: [`batch::FrameBatcher`], which packs events
//! into size-limited, sequence-numbered frames for the UI, and [`mock`], a scripted agent that powers
//! the UI demo, the streaming stress test, and later the replay harness. The protocol drivers (ACP,
//! Claude stream-json, Codex app-server, Pi RPC) arrive in M1.
//!
//! [`AuraEvent`]: aura_protocol::AuraEvent

pub mod batch;
pub mod mock;
