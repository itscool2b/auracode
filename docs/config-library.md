# Local configuration Library

`aura-config` is the Rust adapter boundary. The host supplies approved user or project roots; callers
select logical item IDs, never arbitrary paths. Inspection is explicit and local. It does not run an
agent, load a skill, resolve an environment reference, connect to MCP, or install a package.

The initial inventory covers Claude, Codex and Pi instruction files, portable skill directories,
MCP declarations, Claude/Codex plugin declarations and Pi package declarations. Shared Agent Skills
have one separate source, so the same installation is not counted once for every provider. Missing
roots are reported independently. A malformed source reports a sanitized error and remains unchanged.

Credential files, session stores, caches, `.env` files, key files, vendor `synced` directories and Git
internals are excluded. Config parsing selects only the relevant section. Claude's `.claude.json`
never becomes an item as a whole; projects, trust state and account metadata are not exposed. Plugin
previews include only the declaration name and enabled state. A declaration does not establish that
the corresponding plugin/package is installed or active.

Reads use directory capabilities, no-follow traversal, regular-file checks and bounded reads. Limits
are 1 MiB per file, 256 files and eight directory levels per skill, 16 MiB per source and 2,048 items.
A skill with an excluded or unavailable companion file stays visible but cannot be copied as an
apparently complete bundle. Revisions cover all companion bytes, including binary assets. No file
contents or parser excerpts are logged. Tests use temporary synthetic roots only.

MCP conversion is a closed subset: stdio command/arguments or HTTP URL, with supported enabled state.
Unknown vendor options, environment/header/auth fields, URL userinfo/query/fragment and suspicious
argument interpolation require manual setup. Disabled servers cannot become enabled during a copy.
This is not a general secret detector: arbitrary instructions and scripts remain user-authored content
that requires review. Unsupported fields are never silently discarded to make a conversion succeed.

Source evidence checked on 2026-10-26:

- Claude's official [configuration scopes](https://code.claude.com/docs/en/settings),
  [MCP configuration](https://code.claude.com/docs/en/mcp),
  [skill layout](https://code.claude.com/docs/en/skills), and
  [plugin manifest](https://code.claude.com/docs/en/plugins-reference). These are live documentation;
  the current native driver is pinned separately to Claude 2.1.310.
- Codex [configuration schema at rust-v0.162.1](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/config.schema.json),
  matching the committed native protocol schema. Its `mcp_servers` and `plugins` tables are parsed
  independently of `projects`, provider keys, profiles and trust state.
- Pi 1.0.2 [configuration](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/configuration.md),
  [MCP](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/mcp.md), and
  [skills](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/skills.md).
  Pi packages and executable extensions are not interchangeable with another provider's plugins.

Instruction files and complete skill bundles can now be copied through a ten-minute, one-use Rust
preview. The source revision covers supporting bytes and executable bits. Apply checks all target
revisions before touching any item and keeps the original target directory handle from preview.
Replaced files and independent snapshots remain in an excluded `.auracode-library/<UUID>` directory.
Publication refuses to overwrite a path another writer created. A partial failure returns its recovery
ID and retains originals and staged content. This needs a filesystem with hard-link support; a failure
is reported instead of falling back to an unsafe overwrite. The host must serialize mutations and
keep the blocking operation owned after an IPC caller disconnects.

Rollback validates the retained journal, selected paths and current revisions before any write. It
works after restarting the host and recovers interruption between moving an original and publishing
its replacement. Completed-copy markers distinguish interruption from a later user deletion. Newer
edits are retained, and unrelated target files are neither copied into the journal nor removed.
Windows file contents are flushed before mutation; macOS also flushes containing directories.

The desktop root resolver uses only named configuration path variables and registered local project
folders. It never exports the login environment. Relative overrides need a selected project; a custom
Claude home omits user MCP inventory until the corresponding state-file mapping is verified. Rust
commands serialize changes and retain maintenance admission until the blocking journal operation
finishes, including after its webview caller leaves. Copy history reads validated metadata after
restart and distinguishes completed, interrupted and rolled-back operations.

Library DTOs also have an independent pure-crate Specta exporter, checked for drift in CI. The full
desktop command compilation/export is pending: Windows Application Control blocked an existing
Tauri plugin build script locally. No policy or blocked executable was changed.

MCP/plugin apply, Library UI, duplicate precedence, nested skill discovery and macOS execution checks
remain pending. M8 and M9 are not complete. No real agent configuration was read or changed.
