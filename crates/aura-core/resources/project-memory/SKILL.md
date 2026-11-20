---
name: aura-project-memory
description: Read and edit the current o7 project's shared memory using its session-scoped tools.
---

o7 attaches the project's Markdown memory as visible reference context to a real user message on each native session's first turn, and after a revision changes. The current user request and instruction files take precedence over that background. Native agent memory and AGENTS.md are independent.

The user lets agents edit project memory unless they turn that off in Aura's Project memory page. They see a notice of each edit and can undo it.

When the o7 project-memory MCP tools are available:

1. Call `aura_memory_read` before changing anything. It returns the Markdown and its current `revision`.
2. Write the complete updated Markdown with `aura_memory_write`, passing that revision as `base_revision` and a concrete one-sentence `reason`. Send the whole document, not a fragment. Keep it concise: durable facts, decisions and conventions that help future chats in this project, not a log of this session.
3. If the write reports that memory changed, another chat or the user edited it since your read. Read again, apply your change to the new Markdown, and write against the new revision. Retrying an identical write is safe.
4. If the write reports that the user has turned agents' edits off, nothing was saved. Do not try again: tell the user what you would have saved, so they can add it themselves.

The app's `--aura-memory-helper read` and `--aura-memory-helper write` modes offer the same scoped transport when session credentials are supplied by o7. Write takes its JSON arguments on stdin. Do not read or open Aura's profile database, search for tokens, or write credential files.

On a remote host, after a session stops, while the profile is locked, or when the app cannot be reached, memory tools may be unavailable. Continue using the visible reference context, and ask the user to update project memory in o7 rather than claiming a change was saved.
