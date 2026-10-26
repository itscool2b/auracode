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
`agent_end`. A `handled` disposition completes that prompt while independent extension work
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

Verification remains pending. The first two ordinary Cargo test attempts were blocked before
compiling the driver by Windows Application Control (OS error 4551 on dependency build scripts).
The code and protocol-derived tests need successful Rust tests, Clippy, replay and real-agent
acceptance in an allowed environment before M1d can be marked complete.
