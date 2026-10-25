//! The one-time npm adapter install (package A), inside `Detector::prepare_launch`.
//!
//! ```text
//! folder   <data root>/adapters/<package without "@", "/" as "-">-<version>, created private
//! valid    folder/installed.json names this package and version, and its entry file exists
//! install  only when not valid; one attempt per package at a time in this process, holding
//!          folder/install.lock exclusively (so the CLI and the app never install at once):
//!          1. remove folder/node_modules; write folder/package.json and folder/package-lock.json
//!             from the copies committed for this version (crates/aura-agents/adapters/<folder>/)
//!          2. <npm> ci --omit=optional --ignore-scripts --no-audit --no-fund, in the folder, with
//!             the resolved and scrubbed env plus npm_config_update_notifier=false, 10 minutes
//!          3. node_modules/<package>/package.json: the version matches, and `bin` resolves to a
//!             file inside the folder
//!          4. <node> <entry> --version within 30 s prints the version
//!          5. write folder/installed.json atomically
//! ```
//!
//! `--omit=optional` drops the CLIs the adapters bundle, so they can only ever drive the user's own;
//! `--ignore-scripts` runs nothing from the tree. Dropping the future kills npm, and an unmarked
//! folder is cleaned at the next attempt, so an interrupted download never leaves a broken install
//! in use.
