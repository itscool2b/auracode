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

This first checkpoint is an inventory foundation. Reviewed copy/apply/rollback, the desktop root
resolver, Library commands/UI, duplicate precedence, nested skill discovery and platform execution
checks remain pending. M8 and M9 are not complete. No real agent configuration was read or changed.
