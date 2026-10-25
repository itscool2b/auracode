//! The session's spawner (package C): what drivers spawn through. It mints each spawn id, opens the
//! spawn's protocol log, and records every process control, so force stop reaches them.
