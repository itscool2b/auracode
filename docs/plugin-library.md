# Plugins & MCP

Customize, below Search and New chat, opens Plugins & MCP. The existing Settings entry remains
available. Shared MCP has its own section, followed by one section per agent. Each agent section shows
what that agent supports, read from the agent's own CLI where the CLI has a reviewed,
machine-readable listing, and from the agent's files where it does not. It also shows the
harness's update status and the device's sync switch for that agent. Every change runs the
agent's own reviewed command in a terminal after the person reads it (see
[vendor-integrations.md](vendor-integrations.md)). Instruction files (`CLAUDE.md`, `AGENTS.md`)
left this surface for the separate Instructions surface. aura-config keeps their inventory and copy
code, which configuration sync and other callers still use, but the Plugin library does not list
them. The complete customization behavior is described in [desktop-customization.md](desktop-customization.md).

Plugins stay with their agent. Shared MCP applies to compatible agents in the selected scope.
Server definitions can sync; authentication stays on each device.

## Shared MCP

Aura owns stable server IDs and immutable definition revisions. New definitions default to the selected
project, covering its folders and worktrees. All-projects definitions are optional. A project definition
with the same ID replaces the all-projects definition, including when the override is disabled.
Native server names are inspected before session launch. Conflicting names or an unreadable native
configuration require review; native files and homes are never rewritten by shared MCP.

CRUD, explicit Aura/native JSON import, portable export, local credential setup, enable/disable,
connection tests, session status, supported OAuth and idle restart are available from Shared MCP.
Native imports reject unknown vendor options rather than silently dropping behavior. Definition edits
use revision preconditions. Concurrent synced edits retain both versions for explicit acceptance or
keeping the current definition, and the reviewed resolution syncs as an immutable revision too.

Account definitions and local credentials inherit the profile database's encryption. Only portable
definitions and credential field names enter the existing encrypted account sync pipeline. Actual
credential values and OAuth tokens stay local. Changing the executable, arguments, endpoint or credential
requirements clears previous local values. Export never contains credential values.

Each native generation receives an immutable effective snapshot. Codex uses `thread/start` and
`thread/resume` configuration, with thread-scoped status and OAuth. Claude uses `--mcp-config` alongside
native configuration, without `--strict-mcp-config`, and exposes native session status. Pi loads a scoped
extension and must acknowledge actual registration before user-defined shared MCP is considered loaded.
ACP carries definitions through session new/load/resume, checking advertised remote transports. Codex
and Pi support stdio and streamable HTTP; Claude additionally supports legacy SSE; ACP remote support
depends on its initialization capabilities. Restricted text fallbacks and remote hosts do not load
shared definitions. Unsupported management operations are reported explicitly.

Optional Aura memory tools cannot turn missing transport support into a failed chat. Their omission
leaves visible reference context available. Reserved internal server names, including normalized aliases,
cannot be saved as user definitions. A native collision omits the optional helper with a notice.

A connection test performs a bounded MCP initialization handshake, not a tool call. Stdio uses an
explicit active native chat folder or the project's sole local folder; ambiguous folders require a
selected chat. Tests do not execute project-relative scripts from the home directory. HTTP redirects
are refused and matching JSON-RPC responses are required. A direct test is separate from an agent's
actual session status. Status/auth/restart operations require an idle chat with no queued messages or
pending approvals. Saved changes apply after restart; native OAuth and headers remain device local.

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
| OpenCode | Declared in config | Plugins, MCP servers, skills, commands, agents | `opencode.json` or `opencode.jsonc` (`plugin`, `mcp`) and the `plugins/`, `skills/`, `commands/`, `agents/` folders (and their singular forms) in `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode` | OpenCode installs npm plugins with Bun whenever it starts, and `opencode mcp list` checks each server's connection, so no OpenCode command is run for inventory. Configuration sync does not cover OpenCode. |
| Grok Build | Marketplaces | Plugins (installed and available) | `grok plugin list --json --available` | One array; `status` "available" is a marketplace entry, anything else installed ("disabled" off). |
| | | Marketplaces | `grok plugin marketplace list --json` | `name`, `kind` and `source.url` (a GitHub address shows as owner/repo; others do not). |
| | | MCP servers, skills | `~/.grok/config.toml`, `skills/` | No listing command that leaves servers alone. |
| Hermes | Catalog and skill sources | Plugins (installed) | `hermes plugins list --json` | `name`, `status`, `version`, `description`, `source`. `hermes plugins browse` prints no JSON, so the catalog is not listed. |
| | | Skill sources (taps) | `skills/.hub/taps.json` in `HERMES_HOME` | `hermes skills tap list` prints a table; the file it writes holds `taps[].repo`. |
| | | MCP servers, skills | `config.yaml` (documented block-map form), skill folders | |

Cursor adds reviewed `~/.cursor/mcp.json`, command/agent/hook and skill inventory. These readers
retain names and credential field names only and execute no server. Hermes' richer YAML forms require
native review. Cursor, Antigravity and oh-my-pi have explicit unavailable plugin listings where no
interface is qualified. The page never treats an unsupported API as a successful empty live listing.

Adding a marketplace sits in each Marketplaces section ("Add skill source" for Hermes) as well as the
agent's menu. Claude Code, Codex and Grok take a GitHub `owner/repository`, an `https` Git address
without credentials, query or fragment, or an existing absolute local folder, never a network or device
path; each vendor's own `plugin marketplace add` runs after review. Hermes skill sources are GitHub
repositories (`hermes skills tap add`). Grok installs plugins from a source (`grok plugin install`),
not by a marketplace entry's name, so an available Grok plugin offers Install in Grok, which opens its
CLI; its marketplaces update and remove by name, which may hold spaces ("xAI Official"). Hermes installs
a catalog name, `owner/repository` or Git address and updates, removes, enables and disables by name.

The backend publishes versioned management capabilities. The renderer offers only the reviewed
operations in that response. Claude, Codex, Pi, Grok Build (1.0.70 or later) and Hermes have their
supported plugin, package, marketplace or skill-source operations. Installed OpenCode, Hermes, Cursor
and Grok also have named native customization routes, using a reviewed interactive terminal rather than
invented common management flags. The available native screens remain
agent-specific. Native configuration sync continues to cover Claude, Codex and Pi only; shared Aura MCP
definition sync is separate.

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
- Shared session setup: [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup),
  [Claude CLI](https://code.claude.com/docs/en/cli-reference), and
  [Pi 1.0.2 MCP](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/mcp.md).
- Additional inventory: [Cursor MCP](https://prod.cursor.com/docs/mcp),
  [Grok MCP configuration](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md),
  [Hermes MCP](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md)
  and [Hermes skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md).

`apps/desktop/scripts/check-native-mcp.mjs` records native protocol evidence separately from browser
fixtures. The isolated Windows run initialized installed Codex 0.162.1 and Claude Code 2.1.312, each
reporting the local synthetic MCP connected with one tool. Pi 1.0.2 initialized RPC and acknowledged the
actual scoped extension registration. It used empty temporary native homes, copied no credentials,
sent no model prompts and performed no OAuth flow. This is protocol qualification, not release or visual
acceptance. Browser fixture results and light/dark captures are recorded separately by
`check-shared-mcp.mjs`.

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

If the refreshed provider no longer has an installation, its old CLI listings and timestamp are
invalidated and the section uses the current file inventory. Reopening keeps that unavailable
installation state. A failed listing command on an installed provider still retains cached rows
with its failure warning. An older missing-installation result cannot erase a newer reinstalled
provider result: admission also validates the provider's detection generations.

A newer refresh generation cancels the previous request. An installation or configuration selection
change prevents older provider jobs from replacing the current cache. Listing admission validates
the configuration revision captured before resolving the connection and installation; a selection
change in that gap retries resolution. Profile switches pause library admission before draining
their command leases, so even an already admitted command cannot register late helper work. The
pause lasts through the switch or recovery attempt and reopens the current profile if the attempt
fails or is abandoned. Successfully retired managers remain shut down. Shutdown cancels owned work.
The renderer ignores callbacks and replies after a newer request or unmount, including development
StrictMode remounts. These lifetime checks do not move listing or inventory decisions out of Rust.

A controlled Windows run using temporary homes and fake CLIs measured cold first usable sections
at 648.9763 ms, the fast provider at 1.1081209 s while Claude remained blocked, and all finished at
1.2424665 s. Warm first usable sections took 2.5796 ms and all finished took 3.0168 ms. The fixture
adds a 100 ms delay to Codex and releases Claude only after Codex publishes. These are fixture
measurements of the core stream, not timings promised for installed vendor CLIs.

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

- Rust: `cargo test -p aura-agents --lib`, `cargo test -p aura-agents --test plugins`
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
