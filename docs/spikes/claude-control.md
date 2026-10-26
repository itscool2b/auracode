# Spike: Claude Code control protocol (M0 spike 3)

**Status:** decided. The M0 question (the control round trip, including resume after a cwd change)
was answered against the real CLI on macOS. What was not tested, Windows and Linux included, is
listed under "Not tested (budget) and open items" and handed to M1b; it does not reopen this spike.

Measured on 2026-10-24 against the user's installed Claude Code **2.1.310** (`~/.local/bin/claude`, native
build), macOS 26.6.2 arm64, signed in with a Claude Max subscription. Reference sources were pinned to the same
CLI version: Python `claude-agent-sdk` 0.2.174 (`_internal/query.py`, `_internal/transport/subprocess_cli.py`,
`types.py`; its bundled CLI is exactly 2.1.310), TypeScript `@anthropic-ai/claude-agent-sdk` 0.3.310 (`sdk.d.ts`),
and code.claude.com/docs (headless, sessions, permission-modes, permissions).

The harness is `docs/spikes/claude-control/` (standalone Cargo project, tokio + serde_json + uuid). Model budget:
**6 short prompts used of 6** (about $0.023 in Claude Code's own estimate); every other probe used free control
requests or the built-in `/usage` command, which completes a full turn locally without calling the model.
All fixtures are redacted (email, organization, account/org UUIDs, user id, home path, scratch path, timezone).

## Key conclusions

1. **The plan's native path works as designed.** `claude -p --input-format stream-json --output-format stream-json
   --verbose --include-partial-messages --permission-prompt-tool stdio` gives a long-lived process that takes many
   turns, answers control requests in 1 to 500 ms, asks the host for permissions over stdout, and exits cleanly
   when stdin closes. Nothing needs a TTY.
2. **Always pass `--permission-mode`.** Without it this user's spawn came up in `auto`, inherited from
   `permissions.defaultMode` in `~/.claude/settings.json`. `default` (the config name of "Manual") and the CLI alias
   `manual` are both accepted.
3. **`echo` never asks.** The read-only command set (`echo`, `ls`, `cat`, `pwd`, `grep`, read-only `git`, ...) is
   auto-approved in every mode, so `echo auracode-spike` alone produces no `can_use_tool`. `touch` does.
4. **Interrupt is clean and non-destructive.** The receipt arrives in 6 to 13 ms (before the result), the turn ends
   as `result/error_during_execution` with `terminal_reason: "aborted_streaming"` (or `"aborted_tools"` when a
   permission was open), the partial answer stays in context, and the same process takes the next prompt.
5. **An open permission request is withdrawn on interrupt** with `{"type":"control_cancel_request","request_id":...}`;
   a late answer to it is silently ignored (no reply, no effect). The UI must drop the card on that frame.
6. **Resume follows the folder.** `--resume=<id>` works from the original folder, from a git worktree of it, and
   from an unrelated non-git folder (also `--resume=<absolute .jsonl path>`). The session keeps its id, tools run in
   the new cwd, and Claude Code tells the model itself: "Primary working directory: `<new>` (was `<old>`)", plus
   worktree guidance. The transcript keeps growing in the **original** folder's project directory.
7. **Forks can take our id.** `--resume=<id> --fork-session --session-id=<uuid>` is accepted; the fork uses exactly
   that uuid and writes its transcript under the **new** folder's project directory, leaving the original untouched.
   Passing `--session-id` on every spawn lets auracode know the native id before the first turn.
8. **Bypass must be allowed at launch.** `set_permission_mode bypassPermissions` fails unless the process was started
   with `--allow-dangerously-skip-permissions` (or `--dangerously-skip-permissions`); with the former it succeeds
   later. Launch with it whenever the user's policy allows, so Full auto can be switched on mid-chat.
9. **Leaving the parent-session variables in changed nothing observable** in 2.1.310 print mode (no refusal, own
   session id, own messaging socket, identical payloads). Scrub them anyway, by name: the plan's original blanket
   `CLAUDE_CODE_*` / `CODEX_*` scrub also deleted legitimate user configuration, so the plan now uses an explicit
   denylist instead (see the issues below).
10. **Frames are big.** The initialize answer is about 66 KB, every `system/commands_changed` about 60 KB (re-sent
    in full as MCP servers connect, 150 to 166 commands), `get_context_usage` 48 KB (summary) to 163 KB (full).
    The driver must reduce these in Rust; none of them can go to the UI raw (8 KiB frame budget).

## Results

| # | Experiment | Works? | Notes |
|---|---|---|---|
| 0 | Free probe: `initialize` only | Yes | 1.8 s cold (SessionStart hooks run first). `--model haiku` resolves to `claude-haiku-5-5`. `/usage` listed as built-in. |
| 1 | Session start in fresh git repo (dir A), `initialize`, basic turn | Yes | `initialize` 0.7 to 1.8 s. "Reply with exactly: ok" returned `ok`, first text 1.5 s, result 1.6 s. Fixture `turn-basic.jsonl`. |
| 2 | Permission flow, `--permission-mode default` | Yes | `echo auracode-spike` ran with no request (read-only set). `touch spike-allowed.txt`: `can_use_tool`, allowed, ran (file exists). `touch spike-denied.txt`: denied, model got an `is_error` tool_result and carried on; listed in `result.permission_denials`; file absent. Calls were sequential. Fixture `turn-permission.jsonl`. |
| 2b | Interrupt while a `can_use_tool` is unanswered | Yes | `control_cancel_request` 13 ms after the interrupt, then the receipt, a "user rejected" tool_result, `[Request interrupted by user for tool use]`, `result` with `terminal_reason: "aborted_tools"`. Late `allow` ignored, file not created. Fixture `turn-interrupt-permission.jsonl`. |
| 3 | Interrupt mid-answer ("count to 300"), then another turn | Yes | Interrupt after 3 text deltas: receipt `{"still_queued":[]}` in 6 ms, 7 more buffered deltas, partial `assistant`, `[Request interrupted by user]`, `result/error_during_execution`, `terminal_reason: "aborted_streaming"`, `stop_reason: null`. Follow-up "last number?" answered `37`: partial text is kept and the process is fully usable. Fixture `turn-interrupt.jsonl`. |
| 4 | Other control requests | Yes (all exist) | `get_context_usage`, `list_models`, `get_usage`, `set_model`, `set_permission_mode`, `apply_flag_settings`, `interrupt` (idle), `rewind_files` all answer; details below. `bypassPermissions` refused without the launch flag. Unknown subtype gets a clean error. Fixture `controls.jsonl`. |
| 5 | Shutdown by closing stdin, `ps` before/after | Yes | Exit 0 in 0.4 to 0.8 s (exit **1** when the last result was an error; by design). Only helper seen: the Playwright MCP server (`npm exec` then `node`), inside the child's process group, gone after exit. No daemon, no orphan, no `claude daemon`. |
| 6a | `--resume=<id>` from dir A | Yes | Same session id, history loaded (doubles as the interrupt run). |
| 6b | `--resume=<id>` from dir B, a git worktree of A | Yes | Same id; `system/init.cwd` is B; model recalled `auracode-spike`; model told "Primary working directory: B (was A)" and "This is a git worktree"; transcript appended to A's project file. Fixture `resume-worktree.jsonl`. |
| 6c | `--resume=<id>` from dir C, unrelated non-git folder | Yes | Same id, cwd C, history loaded (no model call: `/usage`). No "No conversation found". Fixture `resume-unrelated.jsonl`. |
| 6d | `--resume=<absolute .jsonl path>` from dir C | Yes | Same id, cwd C. Fixture `resume-path.jsonl`. |
| 6e | `--resume=<id> --fork-session --session-id=<uuid>` from C | Yes | Fork id is exactly the given uuid; new transcript in C's project dir; original unchanged. Fixture `fork.jsonl`. |
| E | Env scrub comparison (scrubbed vs everything inherited) | No observable difference | Same init payloads, own session id and socket, parent socket untouched, transcript `entrypoint` `sdk-cli` either way. Fixtures `env-scrubbed.jsonl`, `env-inherited.jsonl`. |

## Recommended driver contract (M1b)

### Spawn

```text
claude -p
  --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages
  --permission-prompt-tool stdio
  --permission-mode <default|acceptEdits|bypassPermissions>   always explicit (Ask | Auto-edit | Full auto)
  --allow-dangerously-skip-permissions                        unless policy/root forbids; lets Full auto be entered later
  --model <alias or id>                                       explicit; aliases: default opus fable sonnet haiku
  [--effort <low|medium|high|xhigh|max>]                      only when the user picked one
  --session-id=<uuid v7>                                      new sessions: we know the id before turn 1
  | --resume=<id>                                             continue a native session (any cwd)
  | --resume=<id> --fork-session --session-id=<uuid v7>       branch a native session
  [--add-dir <dir> ...]
```

- Pass id-carrying values in `--flag=value` form (the SDK does this for `--resume`, `--session-id`,
  `--resume-session-at`): `--resume` takes an optional value, so a dash-leading value in two-token form would be
  parsed as a separate flag.
- Do **not** pass `--bare` (it never reads OAuth/keychain, so subscription logins fail) or `--system-prompt`
  (the Python SDK passes `--system-prompt ""` by default, which would strip Claude Code's own prompt; auracode
  wants the real harness and adds nothing).
- Spawn through the stable symlink, in a new process group (`process_group(0)`), all three pipes piped,
  stdout and stderr drained continuously by their own tasks.

### Environment

- Start from the resolved login-shell env. Remove parent-session markers. Observed in this dev environment:
  `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_MESSAGING_SOCKET`,
  `CLAUDE_CODE_MESSAGING_TOKEN` (a secret: never log it), `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_BRIDGE_SESSION_ID`.
  `CLAUDE_PID` was not in the plan's original list; the plan's denylist now has it.
- Then set `CLAUDE_CODE_SDK_READS_SESSION_STATE=1`, as both official SDKs do on every spawn. It turns on
  `system/session_state_changed` frames (`sdk_host_only: true`) whose `idle` is the authoritative end of a run
  (background agents included); `requires_action` marks a pending permission.
- Leave `CLAUDE_CODE_ENTRYPOINT` unset: the CLI then records `entrypoint: "sdk-cli"` and uses the Agent SDK system
  prompt ("You are a Claude agent, built on Anthropic's Claude Agent SDK."). An inherited `cli` value was ignored.
- `rewind_files` needs `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true` at spawn (see controls); set it only if M2
  wants Claude's own file rewind in addition to our checkpoints.
- Comparison result: with every marker inherited the child still started, took its own session id
  (`b69d...` vs `7835...`, never the parent's), bound its own socket (`/tmp/cc-socks/<own pid>.sock`), left the
  parent's socket in place, and produced byte-identical payloads apart from random ids and hook ordering. Only
  a local-command turn was compared (no prompt budget left for a model turn), so effects that need a model turn
  (for example `CLAUDE_EFFORT` overriding the chosen effort) remain unverified. The scrub stays as hygiene.

### Init sequence

1. Spawn. Write `initialize` at once:
   `{"type":"control_request","request_id":"req_1_<rand>","request":{"subtype":"initialize","hooks":null}}`.
2. Before the answer, expect `system/hook_started` / `system/hook_response` frames for every `SessionStart` hook
   (4 here: the user's Orca hook plus plugins). They stream even without `--include-hook-events`.
3. The answer (0.7 to 1.8 s) carries, inside `response.response`: `commands` (150; built-ins have
   `"builtin": true` and `aliases`), `agents`, `models` (`value`, `resolvedModel`, `displayName`, `description`,
   `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode`,
   `supportsThinkingOff`), `account` (email and organization: never log or persist), `output_style`,
   `available_output_styles`, `pid` (the real CLI pid behind any shim), `claude_code_version`,
   `current_permission_mode`, `session_state`, `capabilities`, `fast_mode_*`, remote-control flags. Beside it, in
   `response`, sit `pending_permission_requests` and `pending_user_dialog_requests`: a re-sent `initialize`
   re-delivers prompts the CLI is still blocked on (reconnect path).
4. Optional and free: `{"subtype":"get_context_usage","detail":"summary"}` (85 ms) gives the model and context
   window before the first turn (`claude-haiku-5-5`, 1,000,000 tokens).
5. Then send prompts. `system/init` arrives **per turn**, not once, so the session id is otherwise unknown until
   the first turn starts.

### Sending a prompt

```json
{"type":"user","message":{"role":"user","content":"Reply with exactly: ok"},"parent_tool_use_id":null,"session_id":"default","uuid":"01a16d16-4d53-74f3-9208-9b7482b47007"}
```

- `uuid` is ours (v7 works). It comes back as `command_lifecycle.command_uuid`, on the first `assistant` and the
  `message_start` stream event (`user_message_uuid`), and on the `result` (`user_message_uuid`,
  `user_message_uuids`). Always send one.
- `content` may be a string or content blocks (images later). Slash commands (`/usage`, `/model sonnet`, skills)
  dispatch from plain text. `client_composed: true` would disable `@path` expansion, slash dispatch and the CLI's
  turn-start attachments (CLAUDE.md, skill listings): never set it for typed prompts.
- Untested but declared: `priority: "now"|"next"|"later"` and `shouldQuery: false` (queue/steer), see Open items.

### What one turn looks like

Basic turn, in order (from `turn-basic.jsonl`):

```text
system/session_state_changed (running)
command_lifecycle (queued)  command_lifecycle (started)
system/init
system/status (requesting)
system/commands_changed x4          MCP servers connecting; full command list each time
stream_event/message_start          wrapper adds ttft_ms, thinking_display, api_message_id, user_message_uuid
stream_event/content_block_start/text
stream_event/content_block_delta/text_delta
assistant/text                      one assistant message per content block, stop_reason null
stream_event/content_block_stop
stream_event/message_delta          real stop_reason and usage live here
stream_event/message_stop
rate_limit_event
result/success
command_lifecycle (completed)  system/session_state_changed (idle)  system/commands_changed
```

Tool turns repeat `message_start ... message_stop` per API call, with `content_block_start/tool_use`,
`input_json_delta` fragments, `assistant/tool_use`, then `user/tool_result` and a new `system/status`.
No thinking blocks appeared (`thinkingTokens: 0` on haiku-5-5), so these fixtures lack `thinking_delta`.

### Permission handling

- The request (exact, redacted):

```json
{"type":"control_request","request_id":"29fa89f8-1a8f-4200-a94b-42c7b43cb55d","request":{
  "subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
  "description":"Create spike-allowed.txt file",
  "input":{"command":"touch spike-allowed.txt","description":"Create spike-allowed.txt file"},
  "blocked_path":"<SPIKE>/dir-a/spike-allowed.txt",
  "permission_suggestions":[
    {"type":"addRules","behavior":"allow","destination":"localSettings","rules":[{"toolName":"Bash","ruleContent":"touch spike-allowed.txt"}]},
    {"type":"addDirectories","destination":"session","directories":["<SPIKE>/dir-a"]},
    {"type":"setMode","destination":"session","mode":"acceptEdits"}],
  "tool_use_id":"toolu_01XPuU56sPX4yJyoP73DmS1N"}}
```

  The CLI's request ids are UUIDs. No `title` or `decision_reason` was sent for Bash; build the card from
  `description` / `display_name` / `input`. The SDK types also declare `title`, `decision_reason`,
  `decision_reason_type`, `classifier_approvable`, `suppress_always_allow_rule`, `default_to_no`,
  `requires_user_interaction`, `agent_id`, `mcp_server`: parse leniently.
- Allow (sent; the session ran the command):
  `{"type":"control_response","response":{"subtype":"success","request_id":"<id>","response":{"behavior":"allow","updatedInput":{...the input as received...}}}}`
- Deny (sent; the model continued the turn):
  `{"type":"control_response","response":{"subtype":"success","request_id":"<id>","response":{"behavior":"deny","message":"auracode spike: denied on purpose"}}}`.
  Add `"interrupt": true` to also end the turn. Allow-always (untested): add
  `"updatedPermissions": [<one of permission_suggestions>]`; do not offer it when `suppress_always_allow_rule` is set.
- What the model sees: allowed Bash gets `tool_use_result {stdout, stderr, interrupted, isImage, noOutputExpected}`;
  a deny gets `{"type":"tool_result","content":"<our message>","is_error":true}` and `tool_use_result:"Error: <our message>"`;
  a withdrawn request gets Claude Code's standard "The user doesn't want to proceed with this tool use..." text and
  `tool_use_result:"User rejected tool use"`.
- While a request is open: `session_state_changed: requires_action`, then `running` after the answer.
- On interrupt with a request open: `{"type":"control_cancel_request","request_id":"<that id>"}`. Drop the card,
  record `PermissionResolved{Cancelled}`, never answer it. A late answer produced nothing at all.
- Denials and withdrawals are listed in `result.permission_denials` (`tool_name`, `tool_use_id`, `tool_input`).
- User hooks run inside our sessions. This user has `PermissionRequest` hooks for Orca and Yappr (both idle here).
  A `PermissionRequest` hook that returns a decision answers the prompt before the host sees it, and a slow one
  (Yappr's has a 600 s timeout) delays it. Never assume every tool call produces a `can_use_tool`.
- Read-only commands, and anything already allowed by rules or the mode, never ask.

### Interrupt semantics

Request: `{"type":"control_request","request_id":"req_3_spike","request":{"subtype":"interrupt"}}`.
Observed order (from `turn-interrupt.jsonl`): buffered `text_delta`s, then the receipt
`{"type":"control_response","response":{"subtype":"success","request_id":"req_3_spike","response":{"still_queued":[]}}}`,
then `assistant` with the partial text (`stop_reason: null`), `user` `[Request interrupted by user]`,
`content_block_stop`, `message_delta` (`stop_reason: null`), `message_stop`, then:

```json
{"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":null,"terminal_reason":"aborted_streaming","num_turns":2,"errors":["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null"],"user_message_uuid":"01a16d18-77e6-7753-9ae9-b208ac4d809c", "...": "usage, modelUsage, total_cost_usd, ..."}
```

then `command_lifecycle` `cancelled` and `session_state_changed` `idle`. With a tool pending the result has
`stop_reason: "tool_use"`, `terminal_reason: "aborted_tools"` and the user text reads
`[Request interrupted by user for tool use]`. Map any `terminal_reason` starting with `aborted_` to
`TurnEnded{Cancelled}`; do not show it as an error. Interrupting an idle session is harmless (receipt
`{"still_queued":[]}`). `cancel_queued: true` (capability `interrupt_cancel_queued_v1`) also drops queued prompts.
The interrupted turn's `result` reported an unchanged `total_cost_usd`, so the meter lags until the next result. A second Esc should still escalate to SIGTERM (the plan's
force-stop): docs say SIGTERM exits 143 and leaves the turn unrecorded, so prefer the protocol interrupt first.

### Control requests (all against 2.1.310)

| Request | Answer |
|---|---|
| `get_context_usage` (`detail: "summary"`) | 50 to 85 ms. `model`, `totalTokens`, `maxTokens`, `rawMaxTokens`, `percentage`, `isAutoCompactEnabled`, `autoCompactThreshold`, `categories[{id,name,tokens,kind}]`, `apiUsage`, plus large `gridRows` etc. (48 KB). Use for the context meter. |
| `get_context_usage` (default `full`) | 431 ms, 163 KB (token-count API per category). Avoid for polling. |
| `list_models` | `{"models":[...]}` (same rows as initialize, plus `description`). 12 ms. |
| `get_usage` (`skip_behaviors: true`) | 186 ms. `session{total_cost_usd,...,model_usage}`, `subscription_type: "max"`, `rate_limits_available`, `rate_limits{five_hour:{utilization:31,resets_at:"<ISO>"}, seven_day:{...}, extra_usage, model_scoped, ...}` plus about 25 opaque code-named keys. Utilization is **0 to 100** here. |
| `set_model` `{"model":"sonnet"}` | `{"model":"claude-sonnet-5-5"}`, and a replayed user message `<local-command-stdout>Set model to ...</local-command-stdout>` with `isReplay: true` (hide it). |
| `set_model` `{"model":"default"}` | `{"model":"claude-opus-5-5"}`: the **settings** default, not the `--model` given at launch. Re-send the launch model to "reset". |
| `set_permission_mode` `acceptEdits` / `default` / `manual` | `{"mode":"acceptEdits"}` / `{"mode":"default"}` / `{"mode":"default"}` (alias normalized), plus `system/status` with `permissionMode`. |
| `set_permission_mode` `bypassPermissions` | Error `Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions`; success when launched with `--allow-dangerously-skip-permissions`. |
| `apply_flag_settings` `{"settings":{"effortLevel":"low"}}` | Success, `response: null`. `"bogus"` was **also** accepted silently and `null` resets: validate effort against `models[].supportedEffortLevels` ourselves. |
| `interrupt` (idle) | `{"still_queued":[]}` |
| `rewind_files` `{"user_message_id":...,"dry_run":true}` | Success subtype carrying `{"canRewind":false,"error":"File rewinding is not enabled."}`: errors can hide inside a success. |
| unknown subtype | `{"subtype":"error","error":"Unsupported control request subtype: aura_spike_unknown"}` |

Not exercised: `mcp_status` and `get_settings` (their answers can contain server headers and settings `env`
values, so they were kept out of committed fixtures), `set_max_thinking_tokens`, `stop_task`,
`background_tasks`, `cancel_async_message`, `rename_session`, `reload_plugins`, `mcp_*`.

### Shutdown and process tree

- Close stdin, then wait: exit 0 in 0.4 to 0.8 s after an idle turn; the official SDK waits 5 s, then SIGTERM, 5 s,
  then SIGKILL. Exit code 1 after an error result is deliberate (shell-script convention), not a crash: read the
  last `result.is_error` before calling it one.
- While alive the child started only the Playwright MCP server (`npm exec @playwright/mcp@latest` then
  `node .../playwright-mcp`), both in the child's process group, both gone after exit. Remote MCP servers have no
  local process. Hook shells are transient. No daemon, no detached helper, no new orphan. No `-p` child here started
  the `claude daemon` the plan observed on this machine.
- Each child creates `/tmp/cc-socks/<pid>.sock` (reported as `system/init.messaging_socket_path`); all nine were
  gone after their processes exited.

### Resume, fork and the cwd question

| Spawned in | Flags | Session id | Tools run in | Transcript written to | Model told |
|---|---|---|---|---|---|
| original folder A | `--resume=<id>` | same | A | A's project file | nothing new |
| git worktree B of A | `--resume=<id>` | same | B | **A's** project file (now lists cwds A and B) | "Primary working directory: B (was A)", "This is a git worktree", stash safety advice |
| unrelated folder C | `--resume=<id>` or `--resume=<abs .jsonl>` | same | C | **A's** project file | (local command only; same update expected on a model turn) |
| unrelated folder C | `--resume=<id> --fork-session --session-id=<new>` | `<new>` exactly | C | new file in **C's** project dir; A untouched | (local command only) |

Project directory: `~/.claude/projects/<cwd with every non-alphanumeric character replaced by "-">/<id>.jsonl`
(truncated and hashed past 200 characters; `CLAUDE_CONFIG_DIR` moves the root). Docs: lookup by id searches the
current project and its worktrees, then every other project, and reports `No conversation found with session
ID: <id>` only when none (or more than one) holds it.

Rules for the handoff design:

- Moving a chat to another folder does **not** need the handoff block for Claude: respawn in the new cwd with
  `--resume=<id>`. Claude Code re-renders the environment for the model and warns it not to leave a worktree.
- When both sides continue (isolate a branch while the Direct chat goes on), use
  `--fork-session --session-id=<new uuid>`: each folder then owns its own transcript and both stay resumable.
- The handoff block is still needed when the native transcript is gone (purged, 30-day cleanup, another machine)
  or a different agent takes over.
- `-p --resume` starts in the mode a new `-p` run would (here: the user's `auto`), never the mode the session
  ended in, except plan mode: pass `--permission-mode` on every resume.
- Two processes must never resume the same id at once (docs: messages interleave into one transcript).
- The snapshotted system prompt still names the original folder (`--system-prompt-snapshot` defaults to on); the
  environment update overrides it in-conversation. Watch this in the M1b smoke.

## Observed message shapes (redacted, abbreviated where marked)

`system/init` (per turn; arrays cut):

```json
{"type":"system","subtype":"init","cwd":"<SPIKE>/dir-a","session_id":"33bf8fe2-fc45-4b7b-9e6e-51b4fc18ea25",
 "tools":["Task","AskUserQuestion","Bash","..."],
 "mcp_servers":[{"name":"plugin:context7:context7","status":"pending","source":"plugin"},"..."],
 "model":"claude-haiku-5-5","permissionMode":"default",
 "slash_commands":["find-skills","..."],"terminal_slash_commands":["doctor","color","focus"],
 "apiKeySource":"none","claude_code_version":"2.1.310","output_style":"default",
 "agents":["claude","Explore","..."],"skills":["find-skills","..."],
 "plugins":[{"name":"code-simplifier","path":"<HOME>/.claude/plugins/cache/claude-plugins-official/code-simplifier/1.0.0","source":"code-simplifier@claude-plugins-official","version":"1.0.0"},"..."],
 "plugin_warnings":[{"plugin":"context7@synced","type":"synced-plugin-shadowed","message":"..."}],
 "capabilities":["interrupt_receipt_v1","interrupt_cancel_queued_v1","interrupt_send_now_v1","interrupt_requeue_taken_v1","msg_lifecycle_v1","request_marker_lists_v1","lifecycle_wakeup_source_v1","sdk_mcp_tools_list_changed","sdk_mcp_manifests","mcp_read_resource_v1","mcp_tool_ui_meta_v1","ui_surface_v1","mcp_call_result_not_for_model_v1"],
 "analytics_disabled":false,"product_feedback_disabled":false,"uuid":"7258fe2d-5c86-4028-93d4-8fdae7dabcab",
 "memory_paths":{"auto":"<HOME>/.claude/projects/<SPIKE_ENC>-dir-a/memory/"},"original_cwd":"<SPIKE>/dir-a",
 "additional_directories":[],"messaging_socket_path":"/tmp/cc-socks/31561.sock",
 "fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","per_turn_effort_active":true,
 "view_mode":"default","user_message_uuids":["01a16d16-4d53-74f3-9208-9b7482b47007"]}
```

`initialize` answer (arrays cut):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"req_1_spike","response":{
  "commands":[{"name":"find-skills","description":"...","argumentHint":""},"... 150 total"],
  "agents":[{"name":"claude","description":"..."},"..."],
  "output_style":"default","available_output_styles":["default","Proactive","Concise","Explanatory","Learning"],
  "user_output_styles_dir":"<HOME>/.claude/output-styles",
  "models":[{"value":"default","resolvedModel":"claude-opus-5-5","displayName":"Default (recommended)","description":"...","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"],"supportsAdaptiveThinking":true,"supportsFastMode":true,"supportsAutoMode":true,"supportsThinkingOff":false},"... 13 total"],
  "account":{"email":"<EMAIL>","organization":"<ORG_NAME>","subscriptionType":"Claude Max","apiProvider":"firstParty"},
  "pid":31561,"claude_code_version":"2.1.310","current_permission_mode":"default","feedback_mode":{"kind":"post"},
  "analytics_disabled":false,"remote_control_auto_enable":false,"remote_control_auto_connect_default":false,
  "remote_control_available":true,"remote_control_auto_on_by_default":false,"ide_rc_auto_enable_gate":true,
  "fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","session_state":"idle",
  "capabilities":["ui_surface_v1","mcp_call_result_not_for_model_v1"]},
 "pending_permission_requests":[],"pending_user_dialog_requests":[]}}
```

Lifecycle and status frames:

```json
{"type":"command_lifecycle","command_uuid":"01a16d16-4d53-74f3-9208-9b7482b47007","state":"queued","uuid":"b266140f-abd0-435c-b970-562e5a55dec2","session_id":"33bf8fe2-fc45-4b7b-9e6e-51b4fc18ea25"}
{"type":"system","subtype":"session_state_changed","state":"requires_action","sdk_host_only":true,"uuid":"...","session_id":"..."}
{"type":"system","subtype":"status","status":"requesting","session_id":"...","uuid":"...","user_message_uuids":["01a16d16-5b71-73cb-81a4-5b4747dced2c"]}
{"type":"system","subtype":"status","status":null,"permissionMode":"acceptEdits","uuid":"...","session_id":"..."}
{"type":"system","subtype":"hook_started","hook_id":"9010b507-...","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"...","session_id":"..."}
{"type":"system","subtype":"hook_response","hook_id":"9010b507-...","hook_name":"SessionStart:startup","hook_event":"SessionStart","output":"{}\n","stdout":"{}\n","stderr":"","exit_code":0,"outcome":"success","uuid":"...","session_id":"..."}
{"type":"system","subtype":"commands_changed","commands":["... full list, about 60 KB ..."],"session_id":"...","uuid":"..."}
```

`command_lifecycle.state`: `queued`, `started`, `completed`, `cancelled`. `session_state_changed.state`:
`running`, `requires_action`, `idle`.

Partial-message events:

```json
{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_011CgLmaCPa5PAwTKyWCgfjx","model":"claude-haiku-5-5","role":"assistant","type":"message","usage":{"...":"..."}}},"session_id":"...","parent_tool_use_id":null,"uuid":"...","ttft_ms":1413,"thinking_display":"updates","api_message_id":"msg_011CgLmaCPa5PAwTKyWCgfjx","user_message_uuid":"01a16d16-...","user_message_uuids":["01a16d16-..."]}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01RYLUiN9knPhtcKgqhQQbem","name":"Bash","input":{},"caller":{"type":"direct"}}},"session_id":"...","parent_tool_use_id":null,"uuid":"...","api_message_id":"msg_..."}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"command\": \"echo aurac"}},"session_id":"...","parent_tool_use_id":null,"uuid":"...","api_message_id":"msg_..."}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\n34\n35\n36\n37"}},"...":"..."}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"container":null},"usage":{"input_tokens":2,"cache_creation_input_tokens":16736,"cache_read_input_tokens":12799,"output_tokens":4,"output_tokens_details":{"thinking_tokens":0},"iterations":["..."]},"context_management":{"applied_edits":[]}},"...":"..."}
{"type":"stream_event","event":{"type":"message_stop"},"...":"..."}
```

Tool use, tool result, limits, result:

```json
{"type":"assistant","message":{"id":"msg_011CgLmaUEJfsy7xDyFb6spT","model":"claude-haiku-5-5","role":"assistant","type":"message","content":[{"type":"tool_use","id":"toolu_01RYLUiN9knPhtcKgqhQQbem","name":"Bash","input":{"command":"echo auracode-spike","description":"Echo spike marker string"},"caller":{"type":"direct"}}],"stop_reason":null,"usage":{"...":"..."},"...":"..."},"parent_tool_use_id":null,"session_id":"...","uuid":"...","timestamp":"...","request_id":"...","user_message_uuid":"01a16d16-5b71-...","wire_tool_inputs":"..."}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01RYLUiN9knPhtcKgqhQQbem","type":"tool_result","content":"auracode-spike","is_error":false}]},"tool_use_result":{"stdout":"auracode-spike","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"tool_result_meta":"...","parent_tool_use_id":null,"session_id":"...","uuid":"...","timestamp":"..."}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1792834800,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.3,"resetsAt":1792834800,"status":"allowed"},"seven_day":{"utilization":0.2,"resetsAt":1793358000,"status":"allowed"}}},"uuid":"...","session_id":"..."}
{"type":"result","subtype":"success","is_error":false,"result":"ok","stop_reason":"end_turn","terminal_reason":"completed","num_turns":1,"duration_ms":1531,"duration_api_ms":1432,"ttft_ms":"...","total_cost_usd":0.0034773900000000003,"usage":{"input_tokens":2,"output_tokens":4,"cache_creation_input_tokens":16736,"cache_read_input_tokens":12799,"...":"..."},"modelUsage":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":4,"cacheReadInputTokens":12799,"cacheCreationInputTokens":16736,"costUSD":0.00347739,"contextWindow":1000000,"maxOutputTokens":128000,"thinkingTokens":0,"...":"..."}},"permission_denials":[],"queued_turn_count":0,"result_index":0,"user_message_uuid":"01a16d16-4d53-74f3-9208-9b7482b47007","user_message_uuids":["01a16d16-4d53-74f3-9208-9b7482b47007"],"session_id":"33bf8fe2-...","uuid":"...","...":"first_content_frame_ms, first_request_input_tokens, model_usage_since_last_result, safety_stops, subagent_stats, fast_mode_*"}
```

`rate_limit_event` uses a **0 to 1** fraction and unix seconds; `get_usage` uses **0 to 100** and ISO strings.
`total_cost_usd` and `modelUsage` are cumulative for the session (a resume continues the saved total); `usage`
is the main loop of this turn only.

Local command (`/usage`) turn: `system/init`, `system/commands_changed`, an `assistant` message with
`"model":"<synthetic>"` and extra keys `local_command_run`, `local_command_source`, `usage_report`, then
`{"type":"result","subtype":"success","num_turns":0,"duration_api_ms":0,"local_command":"usage","terminal_reason":null,"result":"You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 31% used ...", ...}`.

## Surprises

- `echo` (and the whole read-only set) never asks, in any mode; the planned permission probe needed `touch`.
- This user's `defaultMode: "auto"` silently applies to our spawns unless `--permission-mode` is passed.
- `set_model "default"` means the settings default (opus), not the launch `--model`.
- `apply_flag_settings` accepts an invalid effort without an error; `rewind_files` reports failure inside a success.
- `control_cancel_request` is real and immediate; late answers vanish without a reply.
- Exit code 1 after an error result (for example after any interrupt that ends the last turn).
- Resume works across unrelated folders, and on the worktree resume Claude Code re-briefed the model about the
  cwd change itself, including worktree and stash safety rules (seen in the stored request; the unrelated-folder
  resumes ran only local commands, so no model request exists to inspect there).
- `--fork-session` honors `--session-id`.
- Print mode uses the Agent SDK persona ("You are a Claude agent, built on Anthropic's Claude Agent SDK.").
- User plugins inject context through `SessionStart` hooks (the Vercel plugin adds a long "Vercel Plugin Session
  Context" and, in an empty folder, a "Greenfield execution mode" block telling the model to start executing).
  That is the user's own setup, not auracode, but it shapes model behaviour in auracode chats.
- MCP servers connect lazily: `system/init` lists most as `pending`, and the first turn after a spawn can tell the
  model that hundreds of connector tools are "no longer available (MCP server disconnected)".
- Transcripts grow fast (860 KB after five small turns) because they store request blobs.
- `-p` sessions get no generated title (docs; nothing in the stream), so the plan's "first line" title fallback is
  the only source. The TS SDK declares an `initialize` `title` field (untested) if we ever want to set one.

## What the M1b driver must handle

- Bounded NDJSON framing with a generous limit (163 KB lines seen; base64 images will be larger), lossy UTF-8,
  `\r\n`; skip non-JSON stdout lines; a JSON-looking line that fails to parse is a bug report, not a crash.
- Lenient types for every frame family seen: `system/{init,status,session_state_changed,commands_changed,
  hook_started,hook_response}`, `command_lifecycle`, `stream_event/*`, `assistant`, `user`
  (`tool_result`, `isReplay` local-command output, interrupt markers), `rate_limit_event`, `result/*`,
  `control_request/can_use_tool`, `control_cancel_request`, `control_response/{success,error}`. Unknown types:
  log, never fail.
- Correlate control requests by `request_id` (both directions) and prompts by our `uuid`.
- `initialize` first; tolerate hook frames before its answer; use `pending_permission_requests` after a reconnect.
- Know the session id up front (`--session-id`) and refresh `SessionInfo` from each turn's `system/init`.
- Turn end = `result`; run end = `session_state_changed: idle`; map `terminal_reason` (`completed`,
  `aborted_streaming`, `aborted_tools`, `max_turns`, `budget_exhausted`, `prompt_too_long`, `api_error`, ...) and
  `subtype` (`success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, ...) onto `StopReason`;
  `success` with `is_error: true` is an API failure (`api_error_status` has the HTTP code).
- Text and tool streaming from `stream_event`, but treat `assistant` messages (one per content block) as the
  committed content; use `message_delta.stop_reason`, not `assistant.message.stop_reason` (always null).
- Tool calls: `content_block_start/tool_use` + `input_json_delta` for live args, `assistant/tool_use` for final
  input, `user/tool_result` + `tool_use_result` for output (`is_error` decides failed).
- Permissions as above, including withdrawal, hooks pre-empting, concurrent requests keyed by id, and the
  bypass launch flag.
- Interrupt as above; keep the partial message; Esc twice still escalates to signals.
- Limits from `rate_limit_event` (and `get_usage` on demand), normalized; context from
  `get_context_usage {detail:"summary"}`; cost from the latest `result`.
- Reduce big frames in Rust: commands lists, init payloads and context usage never cross to the UI raw;
  debounce `commands_changed` (5 per session start here).
- Shutdown: close stdin, wait, then the plan's signal escalation on the process group; interpret exit 1 against
  the last `result.is_error`.
- Spawn rules: explicit `--permission-mode`, `--allow-dangerously-skip-permissions` when allowed, equals-form ids,
  scrubbed env plus `CLAUDE_CODE_SDK_READS_SESSION_STATE=1`, own process group.
- Resume/fork per the table; never two live processes on one session id.

## Issues for the plan and the protocol

All four are now in [the plan](../plan.md): the env scrub as its engineering rule, the three protocol
items as M1a follow-ups that the M1b driver maps.

- **Env scrub is too broad (plan).** `CLAUDE_CODE_*` and `CODEX_*` also match documented user configuration that
  people export in their shell profile, which the resolved login-shell env will carry: `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_GIT_BASH_PATH` (Windows), `CODEX_HOME`, and more.
  Scrubbing them breaks Bedrock/Vertex users and points Codex at the wrong home. Suggested instead, and adopted
  by the plan: an explicit denylist of session markers (the names listed under Environment, plus
  `CLAUDE_CODE_SESSION_*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_CODE_BRIDGE_*`), with `CLAUDE_PID` added. The
  spike's harness still applies the plan's original list (plus `CLAUDE_PID`), as it was instructed to.
- **Frame size (protocol).** `SessionInfo.commands` for this user is 150 to 166 entries; one `SessionUpdated`
  carrying them exceeds `MAX_FRAME_BYTES` (8 KiB) and a single event can't be split across frames. Needs either a
  request/response command for the command list or a chunked/diffed event.
- **Message lifecycle (protocol, optional).** `command_lifecycle` (`queued`/`started`/`completed`/`cancelled`) is
  what the composer's queue UI needs; `AuraEvent` has no matching event.
- **Token accounting (protocol, minor).** Claude reports `cache_creation_input_tokens` and
  `cache_read_input_tokens` separately; `TokenUsage.cached_input_tokens` can hold only one of them.

## Not tested (budget) and open items

- Thinking blocks (`thinking_delta`, signatures): haiku-5-5 did not think for these prompts. M1b needs one
  fixture from a thinking turn (for example sonnet or opus at medium effort).
- Parallel tool calls producing overlapping `can_use_tool` requests (calls were sequential here).
- Allow-always (`updatedPermissions`) and `deny` with `interrupt: true`.
- Steering and queueing: `priority: "now"|"next"|"later"`, `shouldQuery: false`, `cancel_async_message`,
  `interrupt_send_now_v1`; `--replay-user-messages`.
- Images in `message.content`; `--add-dir`; subagent streams (`parent_tool_use_id`); background tasks
  (`task_*` frames); compaction (`compact_boundary`); `set_max_thinking_tokens`; `rewind_files` with
  checkpointing enabled.
- Closing stdin while a permission request is open (docs say the CLI cancels it).
- Effect of an inherited `CLAUDE_EFFORT` on a real model turn.
- Windows (`claude.exe`, `.cmd` shim refusal per the SDK, Job Objects) and Linux.

## Fixtures

All in `docs/spikes/claude-control/fixtures/`. `<name>.jsonl` holds the raw stdout lines in order, redacted
(placeholders `<HOME>`, `<HOME_ENC>`, `<SPIKE>`, `<SPIKE_ENC>`, `<EMAIL>`, `<ORG_NAME>`, `<ORG_UUID>`,
`<ACCOUNT_UUID>`, `<USER_ID>`, `<TIMEZONE>`). `<name>.stdin.jsonl` holds what the harness wrote, one
`{"after_stdout_line":N,"t_ms":T,"message":{...}}` per write, so a replay knows when each message was sent.
Total about 3.6 MB, mostly repeated command lists; curate before using them as unit-test inputs if size matters.

| Fixture | Contents |
|---|---|
| `turn-basic` | spawn, initialize (with SessionStart hook frames), basic turn |
| `turn-permission` | echo (no request), allowed and denied `can_use_tool`, final text |
| `controls` | every control request in the table, then the stdin-close exit |
| `turn-interrupt` | resume from dir A, interrupted count, follow-up turn |
| `turn-interrupt-permission` | fresh session, permission held, interrupt, `control_cancel_request`, late allow ignored |
| `resume-worktree` | resume from a git worktree, model turn using earlier context |
| `resume-unrelated` | resume by id from a non-git folder, `/usage`, bypass switch allowed by launch flag |
| `resume-path` | resume by absolute transcript path, `/usage` |
| `fork` | fork with a chosen `--session-id`, `/usage` |
| `env-scrubbed`, `env-inherited` | the same spawn with and without the scrub, `/usage` |

## Reproduce

```sh
cd docs/spikes/claude-control
cargo run -- probe --root <scratch>              # free
cargo run -- p1 --root <scratch>                 # 2 prompts; refuses to run twice on one root
cargo run -- interrupt --root <scratch>          # 2 prompts
cargo run -- resume-worktree --root <scratch>    # 1 prompt
cargo run -- resume-unrelated --root <scratch>   # free
cargo run -- resume-path --root <scratch>        # free
cargo run -- fork --root <scratch>               # free (add --with-model-prompt for 1 prompt)
cargo run -- env-compare --root <scratch>        # free
cargo run -- interrupt-permission --root <scratch>   # 1 prompt
cargo run -- redact --root <scratch>             # re-apply redaction to fixtures in place
```

Each run prints a redacted JSON summary (also saved under `<scratch>/raw/`) and keeps the unredacted pipe log in
`<scratch>/raw/<name>.log.jsonl`, outside the repository. Every prompt is gated: the harness first checks through
free control requests that the session would answer on the requested model.

`cargo test` runs 37 unit tests without Claude: line framing (split chunks, CRLF, invalid UTF-8, oversized lines),
redaction, the env scrub, `ps` parsing and tree reports, the SDK message shapes, and, against `/bin/sh` stand-ins,
a 2 MB stderr flood that must not block stdout, a child exiting before answering `initialize`, and the
SIGTERM escalation. `cargo clippy -- -D warnings` and `cargo fmt --check` are clean.
