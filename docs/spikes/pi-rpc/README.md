# Pi native RPC implementation reference

The adapter targets installed Pi **1.0.2**, verified with `pi --version` on Windows on
2026-10-26. No prompts or authentication/configuration files were read during this work.
Protocol references are pinned to the matching official tag:

- [RPC types](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/modes/rpc/rpc-types.ts)
- [RPC runtime](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [RPC commands](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-commands.md)
- [JSON stream](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/json.md)
- [Extension UI](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-extension-ui.md)
- [CLI session flags](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md)

The fetched `rpc-types.ts` SHA-256 is
`be06a1d53916e03e9274cce9e4833692b235494e4047f1f7139d7f0147daae1a`.
The runtime SHA-256 is
`d534e0fa1484844a097963d5f4fb4df9397c5a1b5e29e42aed7575ab6f67989b`.
Pi publishes TypeScript protocol types, rather than a JSON Schema. The fixtures are synthetic
instances derived from those types, not recordings or claims of real-agent acceptance.

The driver completes started/queued prompts at `agent_settled`, not the prompt response or
`agent_end`. Pi 1.0.2 emits `agent_settled` without fields; cancellation comes from an owned
interrupt or the completed assistant message's stop reason. Manual compaction has its own
start/end lifecycle and does not require a subsequent settlement event. Automatic compaction
keeps the agent run busy until settlement. A `handled` disposition completes that prompt while independent extension work
continues under `RunState`. Stop clears native queues before aborting. A setting is acknowledged
only after refreshed state and thinking levels confirm the native result. An ambiguous sent-setting
timeout closes the session rather than releasing a prompt with unknown settings.

Only Full auto is offered because Pi RPC has no native Ask/Auto edit permission policy. All
extension select/confirm/input dialogs require a user answer. Unsupported editor prefills are
cancelled explicitly; terminal widgets, titles and composer replacements have no product surface.
The driver does not advertise images, steer, fork, rewind or permission-policy enforcement.
Fresh starts allocate transcript IDs independently of chat IDs. Native fork startup preserves its
source. Resume paths resolve to the real native ID before Ready; unexpected later session changes
close the driver rather than replacing the chat's transcript silently.

Context occupancy comes only from `contextUsage`. Null occupancy after compaction remains unknown.
Turn token totals sum completed assistant messages; session cost comes from `get_session_stats`.
No transcript scanning or full message-history requests are used for telemetry.

Pi's pinned `AgentSession.setModel` and `setThinkingLevel` persist global defaults only when
`options.persist` is explicitly true. RPC calls them without that option, so the model and thinking
pickers change the session and its transcript only. `setAutoCompactionEnabled` always writes the
settings manager; the adapter deliberately offers no writable auto-compaction option. The Pi free
probe reads metadata and verifies capabilities without invoking any setters. It skips prompted
resume recall, which belongs to a separately authorized acceptance run.

The first two ordinary local Cargo attempts were blocked before compilation by Windows Application
Control (OS error 4551 on dependency build scripts). Linux CI for checkpoint `f316b59` passed all
19 Pi tests, including the protocol replay, workspace Clippy and binding regeneration. Its full
test step exposed catalog assertions that still expected five agents and a known CLI readiness
race from the base branch. CI run `40280216757` passed all applicable Linux/Windows gates for
`fa41b80`. A subsequent audit corrected the synthetic settlement fixture to the actual empty
event shape and added manual-compaction lifecycle coverage; those corrections need another CI
run. Expanded replay evidence and authorized real-agent acceptance remain pending. M1d is not complete.
