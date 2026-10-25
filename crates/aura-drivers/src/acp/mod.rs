//! The ACP driver (package B): startup (spawn, `initialize`, open with resume, load or new,
//! configure), the main loop that handles commands, stdout and event permits in wire order on one
//! task, cancellation, permissions, and the closing and draining phases that hand over every event
//! before `run` returns.

pub mod dialect;
pub mod map;
pub mod options;
pub mod permissions;
pub mod wire;
