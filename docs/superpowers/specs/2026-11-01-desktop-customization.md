# Desktop customization specification

Approved by the owner in chat on 1 November 2026: implement the proposed desktop, native controls, Plugins & MCP, and project memory plan.

## Product decisions

- Replace lime accents, focus and selection with neutral semantic pairs, retaining status colors, the Aura logo, Inter and desktop System/Light/Dark. Website stays light. Existing production components and visual-language/reference-audit guidance remain authoritative.
- Composer: attachment, labeled effective access and native Plan on the left; model picker and send/stop on the right. Searchable harness/model/effort picker uses live capabilities and existing reviewed handoffs.
- Project plus opens the existing new-chat flow, prefilling project and sole/last valid folder, otherwise showing that project's folders. Project agent default precedes profile default. Compact 640px new-chat form preserves setup, recovery, worktree and busy-folder checks.
- Customize below Search/New chat opens Plugins & MCP, with Instructions and Project memory sections. Keep active chat/draft/process state.
- Expose live plugin/package/marketplace/skills/hooks/commands/subagent/MCP inventory and supported operations through versioned backend capabilities. Provide named native customization routes for functions without structured interfaces. Do not invent a universal CLI management schema.
- Shared MCP defaults to project scope, optionally all projects. Stable Aura server identity; project override wins for the same ID. Native conflicts require review. Session snapshots use Codex thread config, Claude process MCP config, qualified Pi extension and advertised ACP new/load/resume capabilities. Preserve native homes/configs. Explicit import/export, local credentials/auth, portable definition sync, real per-agent status and restart behavior.
- Always explain shared compatible MCP, agent-specific plugins, definition sync and local authentication in Customize.
- Native Plan is separate from plan-progress rendering and access wherever supported. Codex collaboration, Claude permission mode, advertised ACP modes. Idle-only transitions without queued messages/approvals; preserve explicit implementation approval and remembered execution access. Unsupported modes are honest. No prompt-only fake mode.
- Preserve legacy autonomy and flat config option storage. Add compatible versioned per-native-session controls. Invalid/unavailable values cannot silently become Full access or execution mode.
- One Aura-owned versioned Markdown memory per project across folders/worktrees. Existing encrypted account storage and local storage, export/import/history and sync conflict handling. User edits; agent proposals require reviewed acceptance with base revision. No lost concurrent writes.
- Memory is visible reference context below current request and instruction files, attached to the first real turn per native generation and after revision changes; persist exact revision with turn. No memory-only turn or hidden system injection. Native memory untouched.
- App-owned read/propose memory service, session-bound credentials, portable skill/helper and optional session MCP. No agent apply endpoint or direct database access. Context delivery remains available on unreachable hosts with clear proposal availability.
- Instructions choices become Shared instructions and Agent-specific files, with scope, paths, actual readers and current review/backups/drift handling preserved.

## Acceptance

Capability changes, old chat migration, mode failures/queues/handoffs; project creation/recovery; MCP transport/auth/config preservation/resume/cancellation/conflicts/secrets/profile isolation; memory snapshot/retry/concurrent proposals/encryption/sync/helper lifecycle; light/dark keyboard/reflow/reduced-motion browser verification; light website under dark OS and no JS. Run check/build, affected Rust suites and browser integration checks. Native Windows/macOS evidence stays distinct from fixtures. Commit on codex/ branch and create only a finished tested PR. New captures need explicit visual lock before golden status.
