# Terminal chats: the agent's own interface inside auracode

Owner, 6 November 2026: "the option to go GUI like currently or TUI. TUI will launch the terminal
... it needs to be a sexy looking terminal", then, on the implications, "we can have something in
our own GUI which would allow them to switch harnesses, and we would transfer for them ... handle
ALL EDGE CASES POSSIBLE FOR EVERYTHING ... lock in this as well."

## Decisions

1. **Per chat, not a global mode.** Each chat is a Chat (auracode's interface, as today) or a
   Terminal (the agent's own TUI in auracode's terminal). New chat has the choice, with a default
   in Settings > Chats; an open chat switches between them from its header. A global mode would hide
   half the app for one preference.
2. **auracode's own terminal, not an external one.** xterm.js with the WebGL renderer, the theme's
   terminal palette, Geist Mono, generous padding, the glass pane frame and no chrome of its own.
   The agent's process stays in auracode's job and dies with it; the folder, worktree, accounts and
   environment are the chat's.
3. **Same vendor session across Chat and Terminal.** A chat's agent session (Claude Code's session
   ID, Codex's thread ID) is the one the terminal resumes, and the one Chat resumes after the
   terminal. Switching view on the same agent keeps the full context, not a summary.
4. **The terminal's conversation comes back into auracode.** When a terminal session ends, or the
   chat switches view or agent, auracode reads the agent's own session file (Claude Code's
   `~/.claude/projects/<folder>/<session>.jsonl`, Codex's rollout under `~/.codex/sessions`) and
   records its new turns in the chat's history. History, Load earlier, Find, sync, the Dashboard's
   Finished lane and handoffs to other agents then work for terminal turns too.
5. **Switching agents transfers.** From the header's agent switcher: to the same agent, the session
   continues (decision 3); to another agent, auracode imports the terminal's turns (decision 4) and
   starts the new agent with the existing visible handoff (the recent turns and the current file
   changes, 8 KB), in Chat or in its own Terminal.
6. **Interface choice is device-local.** A terminal needs the agent's CLI on this device, and the
   chat record's sync format stays unchanged (older builds keep syncing). The choice lives in a
   local table keyed by chat; a chat synced to a device without it opens as Chat.
7. **Phase 1 agents: Claude Code and Codex.** They have the strongest TUIs, take MCP and resume
   options on their command lines, and write session files auracode can read. Other agents show
   Terminal as unavailable, saying why, until each is checked.

## What carries over to a terminal

- **Shared MCP** (including each server's agents) and project memory: passed on the command line as
  in Chat (`--mcp-config` for Claude Code, `-c mcp_servers.*` for Codex).
- **Plugins, skills, plugin sync**: unchanged; the TUI reads the agent's own configuration.
- **Accounts**: the chat's account's environment. Continuing on another account at a usage limit is
  Chat-only (auracode cannot read the limit in a TUI).
- **Changes panel, Run, worktree terminals, update notices**: unchanged (they read the folder).

## What a terminal chat does without

Approval cards, questions, the queue, steering, Rewind, the Worked-for fold and changed-files card,
image attachments: the TUI handles its own. Dictation types into the terminal. The Dashboard shows
a terminal chat as Working while its process runs and Finished after it exits; Needs you for
terminals waits for the vendors' notification hooks (phase 2).

## Edge cases

- The agent's CLI is missing, broken or another version than detected: Terminal says why and offers
  Chat; a chat already in Terminal opens as Chat with a notice.
- A Chat session is live (or a turn is running) when Terminal is chosen: auracode stops the idle
  session first; a running turn must finish or be stopped (the switch says so, never kills work).
- The terminal is open when Chat is chosen or the agent switches: the TUI is asked to exit (Ctrl+C
  twice, then the process tree after a grace period), its turns are imported, then the new view
  starts. Unsaved input in the TUI is the TUI's; the switch says it will close the terminal.
- The TUI exits by itself (`/exit`, crash, sign-out): the pane shows how it ended with Start again,
  and its turns are imported.
- auracode quits or crashes with a terminal open: the process dies with the job; at next start the
  import runs for sessions that ended unimported (the session file is the record).
- The session file is missing, unreadable, partly written, from another format version, or huge:
  the import skips what it cannot parse, counts it, bounds its read, and never blocks the switch;
  the chat says how many entries were left out.
- The same vendor session was continued outside auracode: the import takes only entries after the
  last imported one, by the file's own IDs, so nothing is duplicated.
- Folder missing, worktree removed, folder not allowed: as for Chat (folder resolution first).
- Window resize, zoom, theme or appearance change: the terminal refits and repaints its palette
  live; a theme switch never restarts the agent.
- Copy and paste, links, Ctrl+C semantics, IME and dead keys, bracketed paste, mouse reporting,
  scrollback: xterm's, with Ctrl+Shift+C/V and the platform shortcuts.
- Several terminal chats at once: each has its own PTY; the app-wide terminal limit applies and says
  so when reached.
- Another device opens the chat: it sees the imported turns, opens it as Chat, and can resume the
  vendor session only if that device has the same session file (otherwise a handoff from history).

## Order of work

1. Device-local interface choice, Settings default, New chat choice (no behavior yet).
2. Rust: prepare a terminal launch for a chat (folder, env, account, shared MCP, session resume),
   started through the existing PTY layer; Tauri commands.
3. The terminal chat view and its styling; switching view in the header; the live-session rules.
4. Importing Claude Code and Codex session files into history, on exit and on switch.
5. The agent switcher's transfer from a terminal chat.
6. Dashboard states for terminal chats; phase 2: vendor hooks for Needs you.

## Status

- 2026-11-06: plan locked with the owner. Nothing built yet.
