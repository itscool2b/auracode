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
7. **Every agent auracode supports (owner, 8 November 2026: "fix for all supported harnesses").**
   Phase 1 was Claude Code and Codex. Since 8 November each agent with an interactive interface
   opens in the terminal: Claude Code, Codex (also through their ACP adapters), Grok Build,
   OpenCode, Hermes, Pi, oh-my-pi, Cursor and Antigravity. "Every agent" below lists what each
   one carries over, how its session continues and how its turns come back.

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
a terminal chat as Working while its agent draws output, and under Finished as "Open in the
terminal" once it has been quiet at its prompt for a few seconds (#109; first it showed Working
for as long as the process ran, idle or not); Needs you for terminals waits for the vendors'
notification hooks (phase 2), since a question at the prompt is as quiet as an idle prompt.

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

- 2026-11-06: plan locked with the owner.
- Done (branch codex/terminal-chats):
  - aura_drivers::terminal builds Claude Code's and Codex's interactive launch from the chat's
    setup; credentials only in the environment (OS-cased names, reserved AURA_ names, the launch's
    own names protected; project memory exempt). Tests.
  - The chat actor's open_terminal / terminal_ended: prepared through start(), the session claim
    and live slot held while open, Chat refused meanwhile, a new Claude session saved with its ID
    so Chat resumes it. Tests in session/tests/terminal_chats.rs.
  - Tauri chat_terminal_start / chat_terminal_ended; a page that goes ends its terminal chats.
  - The device-local Chat | Terminal choice, the header switch, the framed terminal view that
    survives navigation, graceful exit on Back to Chat (Ctrl+C twice, then close after 2.5 s).
- Also done: step 4, the import (terminal_import.rs; recorded through the actor's own turn events
  before the session goes back; only what the terminal added; a new Codex thread learned and
  saved); step 5, the handoff to a new agent's terminal, pasted as its first input with every
  control character removed, never on the command line and never sent for the person; New
  chat's Open in and the Settings default; the Dashboard's "In the terminal"; the
  terminal-chat browser fixture and check.
- Left: a native pass with both CLIs in the installed app (PTY behaviour, resume, the import of
  real files, Cursor and Grok updates); crash recovery of a terminal that ended unimported (the
  session file stays the record; the next terminal on that session imports from its own start).
- 2026-11-06, after the owner's first use (#108):
  - Keys: xterm's screen reader mode left most keys it sends uncancelled, so Shift+Tab sent Claude
    Code its mode switch and also moved focus into the app. Every key a terminal sends is now its
    program's alone; keys no terminal can send keep their app meaning; Ctrl+Tab and Ctrl+Shift+Tab
    leave it; a terminal whose program is not running takes no keys. Natively checked in Claude
    Code 2.1.319: Shift+Tab cycled its modes with focus kept, F5 did not reload.
  - New chat's Terminal waited forever: a new chat starts its agent as it is made, and the
    terminal's open arrived while that start was past its preparation, which nothing answered.
    The starting agent is stopped first now, every path that drops a start answers a waiting
    terminal, and a terminal resumes a saved session only when its file exists (the one a new
    chat starts for Chat has none until its first message). Natively: a plain folder opened in
    3.9 s, a Git worktree in 1.6 s.
  - Not done: skipping that first Chat start for a chat created to open in the terminal (it needs
    the three chat-creation commands to take the choice); the stop and restart cost a second or
    two.

## Every agent (8 November 2026)

The owner found Terminal missing for every agent but Claude Code and Codex and asked for all of
them. What each one's terminal gets, from its own `--help` on this machine (Hermes 0.22.5,
Antigravity 1.5.0, Grok Build 1.0.77, OpenCode 1.19.4, Pi 1.0.2, Cursor 2026.11.05) or, for
oh-my-pi (not installed here), from its published documentation:

| Agent | Resume | A new session | Model | Access | Folders | Shared MCP |
| --- | --- | --- | --- | --- | --- | --- |
| Grok Build | `--resume <id>` | named up front, `--session-id` | `--model` | `--permission-mode` | `--add-dir` | its own (`grok mcp`) |
| OpenCode | `--session <id>` | named by OpenCode, learned after | `--model provider/model` | `permission` in `OPENCODE_CONFIG_CONTENT`, `--auto` | chat folder only | `mcp` in `OPENCODE_CONFIG_CONTENT`, values by `{env:}` |
| Hermes | its terminal's own, `--resume <id>` | named by Hermes, learned after | its own | `--yolo` for full access | chat folder only | its own |
| Pi | `--session <id>` | named up front, `--session-id` | `--model` | Pi has no approvals | chat folder only | the Chat driver's extension, `-e` |
| oh-my-pi | `--resume <id>` | named by oh-my-pi | its own | its own | chat folder only | its own |
| Cursor | its terminal's own, `--resume=<id>` | named by Cursor, learned after | its own | `--force` for full access | chat folder only | its own (`.cursor/mcp.json`) |
| Antigravity | `--conversation <id>` | named by Antigravity, learned after | its own | `--mode accept-edits`, `--dangerously-skip-permissions` | `--add-dir` | its own |

- **Which session opens.** The chat's saved session when it has a conversation (turns ran on it, or
  the agent's own record of it exists), else a new one. An agent that can name a new session takes
  an ID auracode chooses and saves, so Chat continues it (Claude Code, Grok Build, Pi). Otherwise
  the new session is learned after the terminal ends, from the agent's own record in the chat's
  folder and started after the terminal opened: Codex's rollout, OpenCode's `session list`,
  Hermes' `sessions export`, Cursor's chat `meta.json` (`cwd`, `createdAtMs`), oh-my-pi's session
  file header, Antigravity's newest conversation. Where nothing is found, Chat keeps its own
  session and the chat says so.
- **Cursor and Hermes keep two stores.** Cursor's ACP sessions (`~/.cursor/acp-sessions`) and
  its interface's chats (`~/.cursor/chats`) cannot load each other (its ACP server answered
  "Session not found" for a terminal chat, natively with 2026.11.05), and Hermes 0.22.5's ACP
  server refused to resume a session its CLI began ("Internal error", `invalid_params`). So their
  Chat keeps its own session, and their terminal keeps one of its own: learned after the first
  terminal, kept as this device's setting (`device/<device>/terminal-session/<chat>`) and resumed
  by the next terminal. The terminal's turns come back into the history, and the next Chat message
  carries them as the visible handoff, as when the chat changes agents. Not done: a Cursor or
  Hermes terminal does not get the Chat turns made since it last ran (the start's preparation has
  no history to hand it); the person sees them in the chat, the terminal's agent does not.
- **The agent's interface.** The connection's program without its protocol arguments (`grok agent
  stdio` becomes `grok`, `opencode acp` becomes `opencode`); through an ACP adapter, the CLI the
  adapter drives (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`); Antigravity's ACP server is a separate
  program, so its terminal finds `agy` beside it or on `PATH`.
- **What comes back.** Session files are read as for Claude Code and Codex, only what the terminal
  added: Grok Build's `chat_history.jsonl` (prompts with `prompt_index`, their words inside
  `<user_query>`; context lines left out), Cursor's `agent-transcripts/<id>/<id>.jsonl` (the words
  inside `<user_query>`), Pi's and oh-my-pi's session JSONL (user and assistant text), Hermes'
  `sessions export` (messages after the terminal opened), OpenCode's `export` (messages created
  after it opened). Antigravity's conversations are binary: its turns stay in its session, which
  Chat continues, and the chat says they were not copied.
- **Leaving.** Each agent's own exit: Ctrl+C twice for most, then the process tree after the grace
  period, as before.
- A setting an agent's terminal cannot take (shared MCP, extra folders, the chosen model) is listed
  in "Left out of this terminal", as shared servers already were.
- Availability comes from the agent's entry (`AgentEntry.terminal`), not a list of names in the
  page, so the header switch and New chat agree with what Rust can launch.
