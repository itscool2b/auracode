# Owner requests, 4 November 2026

**Goal:** the owner's 4 November list, approved that day ("do whatever u think is best", then
"do all these changes test and then we figure it out"). One `codex/` branch and pull request per
item, each with its changelog line, tests, both appearances, a native check where it runs natively,
and a hands-on walkthrough before merging.

**Decisions** (the owner left them to Claude):
- Dictation bundles NVIDIA Parakeet TDT-CTC 110M (GGUF, CC-BY-4.0) through `transcribe-cpp`
  (MIT), not Nemotron Speech Streaming 0.6B (475 MB): it is smaller than the Whisper base it
  replaces, makes about a quarter fewer errors, and keeps every installer small.
- Finished turns fold into "Worked for" by default, with a Settings > Chats switch to keep them open.
- Thinking shows live while a turn runs and inside "Worked for" afterwards. This reverses the rule
  that reasoning rows are never rendered.
- Signing: Apple Developer ID for macOS (the owner has the account), Azure Artifact Signing for
  Windows (the owner is a US individual, so eligible).

## Items, in order

1. **Composer buttons and the model picker** (`codex/composer-picker`).
   - Ghost pills at one size (28px, 13px); only Send is filled.
   - The account becomes an initial ringed by its usage; the workflow is an icon until Plan is on.
   - The model pill names the model an alias stands for and only a chosen thinking level.
   - The picker reads search, models (five, then "More models"), thinking, then all agents in a
     grid that is always in view.
2. **Claude Code as the default theme.** New profiles and missing or unknown values; saved choices
   are untouched; Aura stays in the gallery.
3. **Denser transcript, like Codex.** Measured against the owner's Codex screenshot:
   - Aura caps prose at 600px, indented 24px in a 720px column, at 15/24; Codex runs about 745px
     at about 14/23, roughly 40% more text per screen.
   - Change: prose uses the full column at 14/22, list items lose their extra gap, rows sit 12px
     apart, the agent name shows only when the agent changes, and older answers' actions appear on
     hover or focus.
   - Settings > Appearance gets Text size: Compact (default) or Comfortable (today's).
4. **Finished turns fold into "Worked for".**
   - At the turn's end, interim messages, tools, thinking and answered cards fold into one row:
     "Worked for 2m 14s · 12 steps".
   - Under it: the final answer, then one card naming the files the turn changed, with Review
     (opens Changes).
   - The final answer is the run of messages that ends the turn.
   - Never folded: the last message, errors, unanswered questions, plans waiting for Accept,
     a steer. Turns without tools get no row. Old chats fold too.
   - Moved to item 7: per-file Open and Open in (with "open a file at its line"), file-type icons
     on links in answers, and reading Codex's `final_answer` phase in its driver.
5. **Dictation.**
   - Parakeet 110M (about 105 MB) plus Silero VAD v6.2, bundled.
   - Loaded once and kept warm, 2 to 4 threads, nothing while silent, no time limit.
   - Live ghost text at the cursor. Finish sets it with a sweep; cancel dissolves it and restores
     the draft.
   - Errors show inside the bar. Multilingual Whisper stays an optional download.
   - Windows x64 and ARM64, macOS and Linux.
6. **Settings.**
   - One screen with search: General, Appearance, Chats, Voice, Shortcuts; Agents, Plugins & MCP,
     Instructions, Project memory; Account & sync, Data & privacy, About.
   - Customize becomes a shortcut into it. Fix General's radio focus loss during saves.
7. **Missing features**, four pull requests.
   - **A, transcript:** inline diffs, tool inputs, Claude's to-do list, compaction and a Compact
     action, web search links, formatted MCP output, syntax highlighting, Mermaid, LaTeX.
   - **B, session control:** native fork and rewind (Claude `rewind_files` exists without a caller),
     Pi steering, MCP elicitation forms, ACP terminals and file access, what a session loaded.
   - **C, review loop:** diff comments sent to the agent, hunk revert, commit and push, Review
     changes.
   - **D, small touches:** find in chat, optional sounds, open a file at its line, worktree run
     scripts with ports, resume terminal sessions, share a native MCP server with every agent.
8. **Linux.** A port in the owner's WSL Ubuntu: AppImage, .deb and .rpm built on Ubuntu 22.04.
9. **Official builds and the download page.**
   - A manual release workflow: signed macOS universal, signed Windows x64 and ARM64, Linux.
     `aura-release` publishes to download.auracode.si, staging, then stable.
   - The website catalog updates itself.
   - Prerequisites, with the owner: Azure identity validation (started early, as it takes days), the
     Developer ID certificate and an App Store Connect API key, the Tauri updater key (its backup
     kept by the owner) and a Cloudflare R2 token.

## Status

- [x] 1. Composer buttons and the model picker (#73, merged 2026-11-05)
- [x] 2. Claude Code default theme (#74, merged 2026-11-05)
- [x] 3. Denser transcript and the Text size setting (#75, merged 2026-11-05)
- [x] 4. Worked-for fold and the changed-files card (#76, merged 2026-11-05). The switch to keep
  steps open moves to item 6, Settings > Chats.
- [x] 5. Dictation (#77, merged 2026-11-05): Parakeet 110M and Silero VAD bundled, live ghost text,
  no limit, the sweep and the dissolve, failures in the bar. Two threads proved cooler than four.
  Deferred: the optional multilingual Whisper download (transcribe.cpp runs Whisper models too),
  and native macOS and Windows ARM64 runs, which need their builds.
- [x] 6. Settings (#78, merged 2026-11-05): one screen with search, its pages in three groups;
  Customize and Agents open on their pages; Voice with a microphone test; Chats with Keep steps
  open; every change saves in turn without disabling its control, which fixes the radio focus
  loss. Also: the Agents page's red status text meets 4.5:1 in Claude dark.
- [ ] 7. Missing features A, B, C, D.
  - [x] A, first part (#79, merged 2026-11-05): tool inputs, web search links, formatted JSON and
    MCP replies, edit line counts, Claude's to-do list as the plan, compaction notices and
    Compact conversation. Inline diffs were already there.
  - [x] A, second part (this pull request): syntax highlighting (highlight.js), math (KaTeX) and
    Mermaid diagrams. Mermaid's optional ELK layout is left out: elkjs is EPL-2.0 or GPL-3.0.
  - [ ] B, C, D.
- [ ] 8. Linux
- [ ] 9. Official builds and the download page
