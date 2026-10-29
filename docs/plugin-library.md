# Plugin library

The Plugin library (Settings, then Plugin library) has one section per agent. Each section shows
what that agent supports, read from the agent's own CLI where the CLI has a reviewed,
machine-readable listing, and from the agent's files where it does not. It also shows the
harness's update status and the device's sync switch for that agent. Every change runs the
agent's own reviewed command in a terminal after the person reads it (see
[vendor-integrations.md](vendor-integrations.md)). Instruction files (`CLAUDE.md`, `AGENTS.md`)
left this surface for the separate Instructions surface. aura-config keeps their inventory and copy
code, which configuration sync and other callers still use, but the Plugin library does not list
them.

## What each agent supports and what feeds it

| Agent | Plugin system | Feature | Fed by | Why |
|---|---|---|---|---|
| Claude Code | Marketplaces | Plugins (installed and available) | `claude plugin list --json --available` | Documented JSON: `installed` with `id`, `version`, `scope`, `enabled`; `available` with `pluginId`, `name`, `description`, `marketplaceName`, `version`, `source`. Older builds print the installed array only, which is also read. |
| | | Marketplaces | `claude plugin marketplace list --json` | `name`, `source`, `repo` (GitHub only is shown; local paths are not). |
| | | Skills | `skills/` in `CLAUDE_CONFIG_DIR` (default `~/.claude`) | No CLI lists skills. |
| | | MCP servers | `mcpServers` in `~/.claude.json` | `claude mcp list` health-checks (connects to) every approved server, so it is never run. |
| | | Slash commands, subagents, hooks | `commands/`, `agents/`, `hooks` in `settings.json` | No listing command. |
| Codex | Marketplaces | Plugins (installed and available) | `codex plugin list --json --available` | Documented JSON with `installed` and `available` arrays (`pluginId`, `name`, `marketplaceName`, `version`, `installed`, `enabled`). |
| | | Marketplaces | `codex plugin marketplace list --json` | `marketplaces` with `name` and `root` (roots are not shown). |
| | | MCP servers | `codex mcp list --json` | It prints env and header values: only their names are kept, and the raw output is wiped after parsing. |
| | | Skills | `skills/` in `CODEX_HOME` and `~/.agents/skills` | No listing command. |
| | | Subagents, hooks | `agents/*.toml`, `hooks.json` | No listing command. |
| Pi | None (packages) | Packages | `pi list --no-approve` with `PI_OFFLINE=1` | Plain text under "User packages:" and "Project packages:"; private sources are shown as "Package N (private source)". |
| | | Skills, MCP servers, prompt templates | `skills/`, `mcp.json`, `prompts/` in `PI_CODING_AGENT_DIR` | `pi mcp list` starts every server, so it is never run. |
| OpenCode | Declared in config | Plugins, MCP servers, skills, commands, agents | `opencode.json` or `opencode.jsonc` (`plugin`, `mcp`) and the `plugins/`, `skills/`, `commands/`, `agents/` folders (and their singular forms) in `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` | OpenCode installs npm plugins with Bun whenever it starts, and `opencode mcp list` checks each server's connection, so no OpenCode command is run. Configuration sync does not cover OpenCode. |

Cursor, Grok Build, Antigravity and Hermes are not listed: auracode has no reviewed way to read
their extensions yet, and the page says so.

Sources, checked on 2026-10-28 against the installed CLIs' `--help` (Claude Code 2.1.312, Codex
0.162.1, Pi 1.0.2) run with every config home pointed at a temporary folder, and against the vendors'
documentation:

- Claude Code: [Install and manage plugins](https://code.claude.com/docs/en/discover-plugins)
  (`claude plugin list`, `claude plugin marketplace list`, scopes, adding marketplaces),
  [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference) (components and
  where they live), and `claude plugin list --help` (`--json`, `--available`).
- Codex: [Codex CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
  (`codex mcp list --json`, `codex plugin list --json --available`,
  `codex plugin marketplace list --json`).
- Pi: `pi --help`, `pi list --help` and `pi mcp --help` (Pi 1.0.2).
- OpenCode: [CLI](https://opencode.ai/docs/cli/), [Plugins](https://opencode.ai/docs/plugins/) and
  [Config](https://opencode.ai/docs/config/).

## How listings run

`aura-agents::plugins` holds the reviewed recipes. Each command runs through the same bounded helper
launch as version probes (`run_helper`): the detected executable (npm shims resolved to their entry),
the resolved environment, the home folder as its working directory, `NO_COLOR=1`, a 20-second
timeout that kills the tree, and at most 6 MB of output. A command that fails, times out, prints too
much or prints something unreadable fails only its own feature: the section says why in one line and
keeps the last cached rows and the agent's file entries. Nothing is installed by a listing.

Opening the page first publishes every supported agent section from cached detection, cached listings
and the file inventory through a typed Tauri channel. These sections are usable before any listing
starts. Detection still in progress is shown as checking. Listing jobs then publish each completed
provider independently, with at most two providers working at once. Commands within one provider run
in sequence, and overlapping requests share that provider's listing work.

Listings are cached per agent with the installed version they were read from. A different installed
version (an update through auracode or any other channel, seen by
detection) reads the listings again and the section says "changed from A to B, so its plugins were
read again". Refresh keeps the current rows visible while it reprobes the supported providers and
reruns their listings. A slow provider's detection or listings do not hold up another provider's
completed section. The section shows "Updated <time>".

A newer refresh generation cancels the previous request. An installation or configuration selection
change prevents older provider jobs from replacing the current cache. Profile switches cancel the
old profile's refresh before draining its command leases, and shutdown cancels owned refresh work.
The renderer ignores callbacks and replies after a newer request or unmount, including development
StrictMode remounts. These lifetime checks do not move listing or inventory decisions out of Rust.

## Harness status

Detection computes one status per agent (`aura-agents::harness`) from the version probe and the
existing release checks: not installed; checking (detection or the first release check is running);
up to date; update available (with the version, on the agent's section and as a calm line on the
Agents page, both with the existing reviewed Update); unknown (offline, no release source for the
installation's channel, or release checks off; the installed version is still shown); and failed
(the binary did not pass its version check, with the reason). Volt marks only an available update.

## Sync per agent

Each of Claude Code, Codex and Pi has a sync switch for this device, saved in the profile's General
preferences (`config_sync_paused`). A paused agent's items are neither published nor applied; they
wait unchanged. The sync review groups items by agent, with the switch and Apply all (each ready item
is its own transaction) on the group's heading. Every held item names its reason:

| Case | Behaviour | Test |
|---|---|---|
| The agent is not installed on this device | The item waits, shown as "Waiting for the agent". Nothing is written. | `sync_agents::an_agent_missing_here_keeps_its_items_pending_and_shown` |
| Sync is off for the agent here | Nothing of it is published or applied. | `sync_agents::a_paused_agent_neither_publishes_nor_applies` |
| The agent here is too old for plugins | Held with the version it needs (the reviewed installer floors: Claude Code 2.1.310, Codex 0.162.1, Pi 1.0.2). | `sync_agents::an_older_agent_holds_a_plugin_with_its_reason` |
| A plugin's marketplace is not added here | Held; the review offers "Add the marketplace" from the GitHub source the other device synced, then "Install". A local-folder marketplace offers no source. | `sync_agents::a_missing_marketplace_is_offered_in_the_review_from_the_synced_source` |
| A plugin install fails | That declaration is put back to its reviewed value through the apply journal, the item keeps its base and is marked with the exit code; other items are unchanged. | `sync_agents::a_failed_plugin_install_restores_that_item_and_keeps_the_others` |
| OS-specific MCP commands or paths | Items with another system's paths stay with that system. A command path that does not exist here is held; it is never written. | `sync_agents::os_specific_commands_and_missing_paths_are_never_applied` |
| A synced MCP command is a network, device or relative path | Classified before any filesystem access (UNC, `\\?\`, `\\.\`, mixed separators, `..`, `~` remainders that are rooted or prefixed, drive-relative, URLs) and held as "Kept on its own device" without a lookup. Bare names are resolved only through this device's PATH. | `sync_agents::commands_from_another_device_are_classified_before_any_filesystem_access`, `sync_agents::network_paths_are_held_unprobed_and_bare_names_use_the_path_lookup` |
| Secrets in MCP env or headers | Only their names travel; values never leave the device, from files or from `codex mcp list --json`. | `sync_agents::secrets_in_mcp_env_and_headers_never_leave_the_device`, `plugins::tests::codex_mcp_keeps_only_the_names_of_secret_fields` |
| Both devices changed the item | The existing conflict review. | `sync_agents::conflicts_removals_and_offline_have_defined_states` |
| The item was removed on another device | Shown as "Removed on another device"; the removal needs its confirmed review. | same |
| Offline | Local items are listed, held as offline, and nothing is written. | same |
| A partial apply across several items | Each item is atomic with its own journal; one failure is that item's outcome and the others apply. | `sync_agents::applying_one_agent_is_atomic_per_item_and_a_failure_keeps_the_others` |

## Checks

- Rust: `cargo test -p aura-agents --lib plugins harness`, `cargo test -p aura-agents --test plugins`
  (fake CLIs that answer only from `fake-listing.json` in the temporary home named by
  `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `PI_CODING_AGENT_DIR`), `cargo test -p aura-config --test
  sync_agents --test extensions`, `cargo test -p aura-core --features account-sync --lib
  plugin_library`, `cargo test -p aura-core --test plugin_library -- --nocapture` (controlled delayed
  fake CLIs measure cold/warm first usable and all finished latency, initial sections before any
  CLI listing, fast providers before blocked ones, refresh detection, cancellation and explicit
  unsupported inventory). `aura-agents --test plugins` also verifies the two-provider limit,
  per-provider singleflight, failed refresh retention and stale installation generations.
- Vitest: `src/components/library/PluginLibraryScreen.test.tsx`, `src/lib/plugins/format.test.ts`,
  `src/lib/plugins/loading.test.ts` (progressive updates and request/unmount lifetime).
- Browser: `node apps/desktop/scripts/check-plugin-library.mjs` (Chromium and WebKit, axe) and the
  layout probe's `plugins`, `plugins-pi`, `plugins-update`, `plugins-failed`, `plugins#plugin-menu`,
  `plugins#plugin-item`, `plugin-sync` and `plugin-sync#plugin-steps` views.
  The progressive fixture holds completion until the browser releases each provider, then sends
  callbacks after unmount. The menu probe waits for the actual menu's first item to receive focus.
  These checks run in the existing manually dispatched CI workflow; Rust integration tests are
  included by `cargo test --workspace` and frontend tests by the existing Vitest run.
