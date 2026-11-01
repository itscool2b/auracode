# Desktop customization

Customize is available below Search and New chat. It contains Plugins & MCP, Instructions, and Project memory. Opening it keeps the current chat and its draft mounted. Switching between Customize sections retains unsaved editors until the surface is closed. Chat-specific Instructions opens on that chat's own folder or worktree.

The project header's plus opens the existing new-chat flow with that project selected. A sole usable folder is preselected; otherwise Aura uses the most recently used valid folder within that project. A retained managed worktree resolves to its source folder within the same project. Missing mappings remain unresolved. Delayed discovery never replaces a deliberate folder choice, and canceling the folder picker retains the prefill. The project agent preference takes priority over the profile preference, and detection never replaces a deliberate agent selection. Folder and worktree review, setup commands, busy-folder warnings and creation safeguards still apply.

## Session controls

The composer separates access and workflow controls from the agent, model and effort picker. Model and effort choices come from the live connection. Switching agents uses the existing reviewed continuation flow. A native control's requested, effective and pending values are distinct; a saved option that disappears does not silently grant broader access.

Native Plan is separate from rendered plan progress. Codex uses its advertised collaboration mode, Claude uses native permission mode while remembering execution access, and ACP uses advertised native mode options. Connections without an advertised planning workflow explain that limitation. Leaving Plan through Aura requires explicit implementation approval. Changes to live native access or workflow require an idle session without queued messages or pending requests. Legacy stopped-session access defaults remain editable.

These preferences live in additive versioned `controls_json` state per agent session. They do not overload legacy `Autonomy` or replace `config_json`. Unsupported saved preferences block dispatch until an offered value is chosen. Acknowledgements belong to the current generation; stale replies cannot overwrite a newly attached session.

## Plugins and shared MCP

[Plugins & MCP](plugin-library.md) lists each agent's native inventory and reviewed management capabilities. It uses structured native commands where available and a reviewed terminal route for operations that have no structured interface. The renderer consumes backend capability descriptions rather than maintaining provider-specific command tables.

Shared MCP definitions default to the selected project and can also apply across the profile. A project override replaces an all-projects definition with the same Aura ID. Definitions and conflict history use the profile writer; account profiles encrypt and sync portable revisions. Local environment and header credentials are stored separately and never included in a portable export or sync envelope. OAuth sessions remain with the native agent. Importing a native definition is explicit and leaves the original file intact.

Importing a Local project into an account carries its memory, memory proposals and admitted prompt snapshots, plus project MCP definitions and revision history. It does not copy profile-wide MCP definitions or local credentials. Required credentials must be configured separately in the destination profile.

Each new or resumed native generation receives a resolved snapshot. Codex receives thread configuration, Claude receives an additive session descriptor, qualified Pi receives a temporary extension, and ACP receives advertised MCP transports. Native names are checked for conflicts. Unsupported connections or transports report their limits. Restarting an idle session applies changed definitions without replacing native configuration. A direct connection test only verifies MCP initialization; it does not claim an agent session has connected.

## Project memory

Each project has one accepted Markdown document shared across its folders and worktrees. Aura stores its revisions, reasons and proposal history in the profile database. Account profiles use the existing encrypted storage and encrypted sync path. This is an Aura document, independent of `AGENTS.md`, `CLAUDE.md`, and harness-native memory. The editor explains that distinction.

Users save against an expected revision. Agents can read memory and propose a complete replacement with its base revision, reason and idempotency key. Only user-facing acceptance creates the accepted revision. A stale proposal cannot overwrite newer memory; it must be reconciled in the editor. Importing Markdown or a memory export creates a new reviewed revision. Exported history and proposals remain reference data rather than imported approval state.

Memory is attached visibly as reference text to a real user message on the first native-generation turn and whenever the accepted revision changes. Current user requests and instruction files take precedence. Aura persists the exact admitted revision with the turn before sending it. Retry and edited continuation retain their original admitted memory bytes; a later edit does not silently rewrite historical context. No memory-only model turn or hidden system prompt is generated.

The app-owned service exposes only read and propose operations. A loopback listener and random token bind access to the owning chat, project, profile and native generation. Stopping, failing or retiring the session revokes that grant. The bundled `aura-project-memory` skill describes the tools, and the app's `--aura-memory-helper` mode provides a stdio bridge without exposing database paths or account keys. The optional MCP helper is used only on compatible native connections. Remote or unsupported connections retain visible reference context and explain why proposals cannot be delivered.

## Verification boundary

Browser previews use synthetic data and production components. They verify layout, navigation, keyboard behavior and accessibility, not native CLI or authentication behavior. Native protocol probes use isolated temporary homes and local synthetic MCP servers without model prompts. Embedded Windows smoke tests exercise the actual Tauri command and storage path. These are distinct forms of evidence; neither establishes macOS release acceptance or a golden visual baseline.
