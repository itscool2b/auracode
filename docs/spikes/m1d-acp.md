# M1d ACP contract baseline

**Status:** pending real vendor qualification and final CI.

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
- [Antigravity headless protocol](https://antigravity.google/docs/cli/headless/), observed
  2026-10-26, with a 1.4.7 executable baseline. This documentation has no immutable revision.
- [Grok headless protocol](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md),
  pinned to source commit `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`; executable floor 1.0.70.
- [Grok PromptUsage wire types](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/notification.rs):
  the ACP prompt ledger is `_meta.usage`, with input including both cache buckets, unlike the
  disjoint headless projection. The driver separates them and reports turn scope. Incomplete
  ledger flags produce a visible warning; absent usage stays unknown. OMP's pinned
  `#buildTurnUsage` also reports turn scope, so its second turn must not subtract the first.

## Catalog and restricted fallbacks

The catalog adds vendor-named ACP launch recipes for Antigravity, Cursor, Grok, oh-my-pi and
OpenCode V1/V2. Discovery runs only `--version`, enforces the documented minimum and major line
where applicable, and labels these entries unverified. Cursor never probes an unrelated `agent`
executable. Antigravity needs its complete official ACP distribution on PATH; auracode does not
extract or substitute a lone archive member. OpenCode major lines qualify separately.

`agy-stream` uses persistent JSONL input. It waits for the native conversation ID, sends each
visible prompt in a `user` envelope, reconciles streamed response text with the final result and
reports cumulative session usage. `grok-stream` starts one owned process per visible prompt with
`-p` and a chosen `--session-id`, then `--resume` after the vendor confirms creation. Before that
confirmation, readiness has no native ID, so stopping or failing the first prompt cannot save a
fabricated resume target. Windows Grok requires a native executable because prompt text is an
argument; shell shims are rejected. Its command-line prompt is limited to 12,000 UTF-16 units.

Both fallbacks deliberately expose text and token totals only. They cannot enforce Ask/Auto-edit,
show interactive approvals, change options, add folders or fork/rewind; those requests fail
explicitly. They add no bypass flags and retain the user's CLI permission policy. Stop terminates
only the owned process and closes the session. Malformed or oversized output stops safely, a
missing terminal result ends the turn with an error, and EOF/exit cleanup remains bounded.
Tool/thought/media details require the ACP entries. Install/authentication, exact binary identity
and real transcript qualification are still pending for every new catalog entry.

## Deferred input contract

Cursor questions and plan approval, plus OMP form elicitation, remain pending until the user
answers. They are UI requests rather than permission requests, so Full auto never answers them.
Answers preserve native question/option IDs and JSON scalar types. Invalid or late answers cannot
approve or consume another pending request. Turn end, interrupt, shutdown and `$/cancel_request`
cancel the appropriate outstanding requests. Numeric and string JSON-RPC IDs remain distinct.

Cursor's full plan markdown is rendered as transcript text before its confirmation card. It does
not pass through the confirmation card's 2 KiB text cap. A plan callback before Ready is cancelled
because its full context cannot yet be displayed. No hidden prompt or file read is involved.

Cursor todo notifications maintain a bounded list and honor merge versus replacement by native
ID. Cancelled entries are labelled `Cancelled:` and treated as closed. Task and image notifications
use the normal tool mapper, retaining the reported delegation prompt and path without reading
files. These notifications send no reply and never execute work. Only advertised standard options
are offered; a restart-based model switch remains unqualified in the current official docs.

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

| Check | Result | Evidence |
| --- | --- | --- |
| Pure adapters and fake transports | pass | Last executed driver suite passed 362 tests; six native identity tests passed. |
| Core regression suite | pass | Complete core suite passed after optional readiness. |
| Rust formatting and targeted Clippy | pass | Core, drivers and agents all-target checks passed. |
| Final callback regressions and branch CI | pending | Newly linked local test executables were blocked by Application Control; branch CI is the execution fallback. |
| Installation, authentication and real vendor smoke | pending | No real agent runs or credential/config reads were performed. |

Pure callback tests cover exact answer shapes, invalid/duplicate choices, full plan preservation,
OMP boolean/choice/free-text conversion, unsupported types and unsupported constraints. Fake-pipe
tests cover concurrent callbacks, out-of-order answers, withdrawal, late answers, turn-end cleanup,
shutdown with an open approval, form capability advertisement and unsupported autonomy.

The first build was blocked by Windows Application Control (`os error 4551`); a normal Cargo retry
later succeeded without changing policy settings or blocked binaries. Agent discovery unit and fake
tool integration tests pass. Driver tests cover fallback startup, explicit failure, identity
confirmation, text reconciliation, token scope, oversized output and stop without dispatching queued
work. The six native identity tests and core/driver all-target Clippy also pass. Synthetic tests are
not a substitute for the pending authenticated vendor smoke tests.
