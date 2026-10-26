# M1d ACP contract baseline

This implementation uses ACP v1, with the existing schema development dependency pinned to
`agent-client-protocol-schema = 1.12.0`. No authentication, credential/config reads, model prompts
or real-agent runs were performed for this subtask. Installation and authenticated qualification
remain pending.

## Sources frozen for implementation on 2026-10-26

- [Official ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json):
  Antigravity 1.4.3, Cursor 2026.10.22 (`2026.10.22-27dcf5f` distribution), Grok Build 1.0.70,
  OpenCode 1.19.4 and OpenCode V2 2.1.4. Registry observations are version references, not a claim
  that these binaries have passed auracode smoke tests.
- [Cursor ACP documentation](https://cursor.com/docs/cli/acp): the published request/response
  contracts for `cursor/ask_question` and `cursor/create_plan`, including native option IDs,
  cancellation and explicit plan acceptance. Cursor's documentation is not versioned, so the
  callback fixtures are documentation-derived and still need verification against the pinned CLI.
- [OMP 18.12.6 ACP source](https://github.com/can1357/oh-my-pi/blob/v18.12.6/packages/coding-agent/src/modes/acp/acp-agent.ts):
  `createAcpExtensionUiContext`, `elicitFormFromAcpClient`, `#requestAcpPlanApprovalChoice` and
  `#getAvailableModes`. This is a release tag, not moving main.

## Deferred input contract

Cursor questions and plan approval, plus OMP form elicitation, remain pending until the user
answers. They are UI requests rather than permission requests, so Full auto never answers them.
Answers preserve native question/option IDs and JSON scalar types. Invalid or late answers cannot
approve or consume another pending request. Turn end, interrupt, shutdown and `$/cancel_request`
cancel the appropriate outstanding requests. Numeric and string JSON-RPC IDs remain distinct.

Cursor's full plan markdown is rendered as transcript text before its confirmation card. It does
not pass through the confirmation card's 2 KiB text cap. A plan callback before Ready is cancelled
because its full context cannot yet be displayed. No hidden prompt or file read is involved.

OMP advertises `elicitation.form: {}` because its pinned source otherwise automatically approves
plan proposals. Supported forms include string input/editor, explicit boolean choices, string
enums, `oneOf` string constants, arrays of enumerated strings, and OMP's paired `qN__other` free
text fields. No default choice is preselected. Each displayed grouped field requires an explicit
answer; optional empty fields can be dismissed as part of cancelling the form. Numeric, nested,
URL and constrained schemas the current UI cannot represent return an explicit protocol error.
Dialogs that would be truncated by the UI are rejected rather than presented with changed labels.
OMP supplies only a short plan preview in its form request; auracode shows exactly that preview.

OMP's pinned ACP source does not provide a general tool-permission Ask/Auto-edit boundary.
Accordingly only Full auto is advertised for OMP. Starting with or switching to either unsupported
autonomy fails explicitly. Its extension questions and plan approval still require user input.
The vendor may expire a form without a cancellation notification; later replies are ignored by
OMP, and auracode closes the card when the turn ends or the session stops.

Each callback is bounded to 64 KiB; at most 32 can remain pending, each with at most 32 questions
and 64 choices per question. Unsupported request types continue to receive method-not-found.

## Verification status

Pure callback tests cover exact answer shapes, invalid/duplicate choices, full plan preservation,
OMP boolean/choice/free-text conversion, unsupported types and unsupported constraints. Fake-pipe
tests cover concurrent callbacks, out-of-order answers, withdrawal, late answers, turn-end cleanup,
shutdown with an open approval, form capability advertisement and unsupported autonomy.

The initial local Cargo check was blocked before compiling auracode by Windows Application Control
(`os error 4551`) when executing newly compiled dependency build scripts. Rustfmt parsing and source
checks are available; Rust tests and Clippy require a permitted build environment or repository CI.
No policy settings or blocked binaries were changed to work around this restriction.
