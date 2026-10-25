//! The replay harness (package B, feature `replay`): the real ACP driver over `FakeSpawner` pipes
//! against a fake agent playing a curated protocol log, on paused time, with the collected events
//! and replies compared with a golden file.

pub mod curate;
pub mod fake_agent;
pub mod fixture;
pub mod golden;
