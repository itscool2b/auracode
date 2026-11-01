---
name: aura-project-memory
description: Read or propose updates to the current Aura project's shared memory using its session-scoped tools.
---

Aura attaches the accepted project Markdown as visible reference context to a real user message on each native session's first turn, and after a revision changes. The current user request and instruction files take precedence over that background. Native agent memory and AGENTS.md are independent.

When the Aura project-memory MCP tools are available:

1. Call `aura_memory_read` before preparing an update.
2. Propose the complete replacement Markdown with `aura_memory_propose`, including the exact `base_revision`, a concrete `reason`, and a fresh `idempotency_key`. Repeat the same key only when retrying identical content.
3. Explain the proposal to the user. Only the user can accept it in Aura's Project memory page. A proposal is not an accepted revision.

The app's `--aura-memory-helper read` and `--aura-memory-helper propose` modes offer the same scoped transport when session credentials are supplied by Aura. Propose accepts the JSON arguments on stdin. Do not read or open Aura's profile database, search for tokens, write credential files, or try to apply an update directly.

On a remote host, after a session stops, while the profile is locked, or when the app cannot be reached, memory tools may be unavailable. Continue using the visible reference context. State that updates need the user's review in Aura rather than claiming a proposal was saved.
