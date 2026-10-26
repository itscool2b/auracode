# Auracode implementation progress

Updated 2026-10-26. Scope: the accepted Rust-first, Cloudflare-hosted plan, M1b through M9.

## Completed before this continuation

- M0 and M1a are merged. Main at `3b35c66` passes CI and installer builds on all three platforms.

## Current work: project rules and infrastructure

- Created the US-jurisdiction `auracode` D1 database and the two auracode R2 buckets.
- Deleted the explicitly confirmed `mijonion-media` bucket and its 65 files.
- Added mirrored project instructions and their CI check, including mismatch/missing-file tests.
- Updated architecture documentation for Rust, Cloudflare and Orbit. No cloud application is deployed.
- Verified the new buckets have no public r2.dev access or custom domains; verified the old bucket is absent.
- Local checks passed: pnpm check (4 instruction tests, 805 frontend tests, 19 pre-existing skips),
  pnpm build, cargo fmt, 33 documentation tests, and the full locked Rust workspace test suite.
  Foundation PR #4 CI passed lint, Clippy, Linux and Windows application smoke checks.
- A separate review found no blocking code issues; corrected its two documentation inconsistencies.

## Remaining, in order

M1c is being implemented independently on `m1c-codex-native`, rebased onto M1b checkpoint `cfb67db`.
The native Codex driver uses an owned stdio app-server, initializes once, persists the native thread
ID, separates turn completion from idle, and handles approvals, grouped questions, model/effort
settings and account quota updates. Initial verification covers 31 native unit tests, seven synthetic
and three recorded native replay fixtures, and conformance to the installed Codex 0.162.1 generated schema. Existing ACP
and Claude fixtures remain unchanged. Initial work used no real prompts, credential/config inspection
or vendor update. Later prompted verification is recorded below. This is not milestone acceptance.

The driver now detects a closed asynchronous stdin writer after a send was accepted and stops the
owned process without waiting for its request timeout. Regression tests also verify outstanding
callbacks are cancelled and withdrawn before a turn completes. This incorporates the shared process
writer-closure seam from M1b commit `447fe72`.
Known process exit is distinguished from an input failure so buffered final output still drains,
including when the event receiver is backpressured. A 1,000-delta regression verifies this path.

Independent review identified four M1c defects, now fixed with targeted regression tests: raw
reasoning block boundaries, lost tool output when a final snapshot omits it, missing file-approval
diff context, and inherited automatic approval reviewers. The driver explicitly requests user review
at thread open and every turn, and fails startup if the effective reviewer remains automatic.
Review fixes have passed the native tests and all frozen replay/schema checks; a separate verification
of these fixes is still pending. Malformed completion/input metadata fails safely and quota state is
bounded across repeated updates. The final M1b startup/identity/rewind contracts are integrated;
Codex rejects unsupported startup overrides before spawning and returns an explicit error for rewind.
Post-integration native tests, all 91 replay fixtures, schema conformance, generated bindings and
targeted Clippy pass.

The native Codex free probe passed on Windows with installed 0.162.1: 20 checks passed, none failed,
and six were explicitly skipped. It verified initialization ordering, authoritative thread ID,
native model discovery, staged next-turn settings, idle interrupt, owned shutdown, interrupted
startup and restart. Three protocol logs prove no prompt or steer was sent. Resume and actual
turn-setting application remain unverified by this free probe. Full workspace Rust tests and Clippy,
rustfmt, pinned pnpm 12.15.0 checks (813 frontend tests, 19 existing skips), and both frontend builds
pass. The generated vendor schema is excluded from formatting to preserve its recorded hash.
The three free-probe recordings have curated fixture/golden pairs, with account usage and plan,
installation identity, configured MCP names and incidental stderr sanitized. All 84 fixtures replay.
Replay preserves the recorded Codex client version without weakening full payload comparison, and
recognizes explicit startup cancellation without requiring a Ready event. The running vendor version
also recognizes the installed binary's `Codex Desktop/0.162.1` user-agent spelling.
Ask uses a read-only native sandbox with untrusted-command approvals and user review, so it does
not pregrant workspace writes. Auto-edit keeps workspace write access; Full auto requests full access
with no driver auto-answering of vendor callbacks. The tightened Ask mapping passes schema and replay
tests.

The first minimal native smoke used explicit GPT-6-Luna and low effort. Basic text and native turn
usage passed. The permission scenario displayed both callbacks; denial worked, but allow-once failed
inside the native Windows execution helper before the command started. Ten checks passed and one
failed; interrupt, continuation, full auto and resume were not attempted. The smoke stopped after
three visible prompts, with no paid retries. A free direct `command/exec` running only `Get-Location`
in the same owned temp repository reproduced `helper_unknown_error: setup refresh had errors` under
the same read-only sandbox. `windowsSandbox/readiness` reported `ready`, so no setup mutation or
sandbox weakening was justified. No credential/config files were inspected or edited.

The real callback also exposed a narrower `availableDecisions` menu than the stable schema. The
driver now bounds both displayed options and outgoing answers to advertised supported choices.
Persistent policy amendments remain unsupported. Two native regressions and a synthetic replay
exercise this restriction, and the real basic turn has a curated recording and golden. Targeted
Clippy and instruction checks pass; Windows Application Control refused the new native and schema
test executables with error 4551 before any test ran. The new replay golden is a reviewed expected
result derived from its prior passing fixture and still requires CI execution. Live acceptance
remains pending the native helper issue and the remaining four smoke scenarios.

Read-only follow-up found no removed or overridden variables in either owned smoke spawn log.
The environment resolver preserves Windows runtime variables, and a direct child inheriting the
shell environment reproduced the same error. There is no evidence that auracode's scrub caused it.
The [official 0.162.1 setup helper source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning.rs)
uses this generic error after accumulated runtime or filesystem ACL failures; the exact local
failure remains unknown. The [readiness implementation](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/windows_sandbox_processor.rs)
checks setup state, not whether a fresh sandboxed command succeeds.
The official latest stable CLI release is 0.164.0 as checked on 2026-10-26, and the installed CLI
offers `codex update`, but its help exposes no check-only switch. The desktop updater reports the
installed 26.1021.31345 production release is up to date. No CLI update, setup mutation, policy
change or doctor run was performed; no claim is made that an upgrade fixes this helper failure.

The subsequently authorized targeted diagnostic read used only `.sandbox/setup_error.json` and
the 2026-10-26 daily sandbox log block for the owned free probe at 06:06:28 UTC. The fatal array
contains one error: runtime read/execute ACL validation of Codex's `cua_node/.../bin/node_repl.exe`
failed to open the ACL target for a root-only update because the file was in use, Windows error 32.
It processed zero write roots. The user-profile read-attributes warning was nonfatal. No unrelated
log history, credentials or configuration was read. No vendor process was stopped or ACL changed.
The [pinned runtime validation source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning/setup_runtime_bin.rs)
walks the app runtime tree independently of the requested command. The installed `command/exec`
schema has no runtime selector, so selecting another shell does not address that failure. An offline
driver regression preserves the failed tool and its error text even when the provider completes the
turn normally. Paid allow-once and the remaining smoke scenarios stay pending an external fix.

The later helper-failure regression initially expected plain text instead of terminal content. CI
caught the incorrect test expectation; the corrected test requires the exact native terminal error
and exit code -1. All 34 Codex unit tests pass locally after that test-only correction.

Checkpoint `e2416e7` passed [Linux and Windows CI](https://github.com/itscool2b/auracode/actions/runs/40278206764),
including the native approval regressions, all replay fixtures, generated schema checks, bindings,
frontend checks and both app smoke runs. macOS was skipped by branch policy. The subsequently added
helper-failure lifecycle regression compiles and passes Clippy; its execution is part of the next CI
checkpoint. The restricted-menu expected golden is now verified on both CI platforms.

M1c requirements still pending: opt-in prompted verification, generated
schema verification for the historical 0.164.0 baseline, independent verification of review fixes,
and final combined verification. Steer, fork, image attachments,
additional directories, rewind and secret input are explicitly unavailable until their complete
core/UI and attachment paths exist. Unsupported MCP elicitation is cancelled with a visible notice.
Native thread listing has no user-facing library seam yet. No M1c PR has been opened.

M1b is in progress on `m1b-claude-native`. Native discovery, driver dispatch, transcript mapping,
permissions, multi-question UI, run-idle gating and shared native-session ownership are implemented.
Native live verification, recorded fixture curation, review fixes and local workspace gates are
complete. CI and milestone installer builds are the remaining release gates before a PR.
Foundation PR #4 has not been merged.

M1b acceptance checklist (unchecked items remain required):

- [x] Dedicated native envelope parser and standalone subscription redaction.
- [x] Recorded text/tool fixtures without duplicate committed output; split cache accounting.
- [x] Native catalog alongside ACP, minimum version checks and executable safety.
- [x] Separate prompt completion and native run idle; preserve ACP/mock behavior.
- [x] Native/ACP ownership aliases scoped by local host and effective configuration directory.
- [x] Multiple questions, multi-select/free text, preserved native input, generated UI bindings.
- [x] Driver control/cancellation/shutdown tests and integrated protocol replay goldens.
- [x] Coalesced usage/context refresh, advertised model metadata, structured auth-required handling.
- [x] Typed fork/resume-at startup and native rewind control with accurate capability reporting.
- [x] Startup failure matrix, oversized frames, timeout/late-response reconciliation.
- [x] Verify compatible installed native CLI with free controls before the minimal paid smoke.
- [ ] Full workspace checks, frontend/build tests, CI, independent final review, completed PR.

Observed checks during integration: core suite passed 327 Rust tests plus one doctest; the Questions
UI passed 286 frontend tests (19 existing skips) and typecheck. New native tests reproduced and fixed
the actual `state` field on idle frames, cancellation of a held prompt, and pause of EOF drain time
during backpressure. Native regression coverage is now 41 tests, and 74 replay fixtures pass.
The real Windows Claude 2.1.310 free probe passed 20 checks with no prompts sent; five checks were
explicitly skipped (including resume without a persisted transcript). Its first run found an unset
effort choice bug, now fixed with an explicit Default/reset choice and regression coverage.
Full workspace Clippy, frontend check (813 tests, 19 existing skips), and both frontend builds pass.
Workspace test reruns corrected stale catalog assertions; final combined verification is pending.
Independent review found fresh starts reused the chat UUID as the native session ID. Fresh starts
now allocate a UUIDv7 for each spawn. Typed native startup options validate fresh/fork IDs and
resume-at message IDs before spawning, preserve ordinary resume sources, and enable SDK file
checkpointing only when explicitly requested. Replay supplies a separate deterministic session seed.
The actor still supplies default startup options; fork/resume-at UI belongs to M2b,
and fork/rewind capabilities remain unadvertised. This startup step passed 304 driver unit tests, four
conformance tests, all 74 replay fixtures, targeted driver/core Clippy, and the mirrored instructions
check. These initial checks made no paid calls. Subsequent live acceptance is recorded below.
No M1b PR has been opened.

Further review fixes and verification:

- Windows ownership keys now resolve existing directory aliases through metadata and fold path casing.
  All eight local ownership tests pass, including differently cased paths with an uncreated config root
  and equivalent UUID spellings.
- The smoke runner tracks accepted queued prompts until native idle and removes its own queued work on
  failure. Five CLI smoke integration tests and CLI Clippy pass.
- Native file rewind now has a typed driver command and result. It requires explicit startup opt-in,
  validates checkpoint IDs, waits for idle with no pending requests, and preserves link-safety skips.
  Any failed real rewind or timeout closes the process before held prompts can run, since partial file
  changes are possible. Six rewind
  regression tests pass. The future M2b checkpoint UI remains required.
- CI for checkpoint `08c19b1` passed Linux and Windows Rust checks, bindings, frontend lint, app streams
  and chat smoke tests. macOS was skipped by the branch workflow. Newer review fixes still need CI.
- One combined local workspace rerun was blocked by Windows Application Control refusing synthetic
  test executables (error 4551). No policy bypass was attempted; the checkpoint's CI suite passed.
- M1c native Codex implementation is progressing in its own `m1c-codex-native` worktree. It is not
  complete or merged into this branch.

Live Claude acceptance on Windows, with the installed native 2.1.310 CLI:

- The final free probe passed 20 checks with five explicit skips. Its three spawn logs contain no
  model prompts.
- The minimal Haiku/low smoke passed all 20 checks across six scenarios and seven visible prompts:
  streaming, deny then allow-once tool permissions, interrupted partial text, continuation after
  interruption, full auto, and resumed conversation. Each turn was stored once.
- Free `/usage` checks verified resume after changing cwd, native fork and reopening that fork,
  and resume-at into a new fork followed by reopening. These establish native identity and lifecycle,
  not a semantic memory-truncation claim. An initial resume check used a mistyped ID and failed;
  the corrected observed session ID passed.
- One Sonnet/medium thinking turn cost $0.1097759 and returned 302 thinking tokens. Claude supplied
  empty thinking text, so the initial text-byte acceptance check failed. The driver now preserves
  that activity and its duration without inventing reasoning or exposing signatures. Offline replay
  of that same recording verifies the fix; no second paid call was sent. The acceptance harness
  now checks completed thinking blocks and reports text bytes and token evidence separately.
- Seven curated recordings cover the six smoke scenarios plus withheld thinking text. Curation
  removes native identities and reconstructs split tool JSON before redacting paths. Original
  records remain in order; replacement chunk boundaries are documented as synthetic.
- Native init metadata now updates the effective model and permission mode. A resolved path-resume
  identity must acquire ownership and be durably saved before queued work can run. The new checked
  transaction acknowledgment reports real write success, including missing/rejected rows. Its gate
  survives stop/restart and waits through stalled writes rather than timing out before a late commit.
  Four core identity tests verify lock contention, rejected writes, conflicting ownership and restart.
- Eleven native failure tests cover startup failures, mandatory oversized frames, stdin failure,
  late replies and bounded shutdown. Content-only oversized frames retain the valid remainder.
  Transport failures drain valid buffered content and the final result; identity failures discard
  subsequent content from the rejected session. A known child exit cannot be misclassified as EPIPE.
- Final local checks pass: full locked Rust workspace with all features, all-target workspace Clippy,
  rustfmt, TypeScript bindings, pnpm check (813 frontend tests, 19 existing skips), both frontend builds,
  and spike documentation checks. The driver suite includes 340 unit tests, four conformance tests
  and 81 fixture replays. The six opt-in acceptance-harness unit tests also pass. The buffered-exit
  regression passed 12 repeated runs after its race fix. Linux/Windows CI and installer builds for
  the final checkpoint remain pending; macOS has not been run locally on this Windows host.

CI follow-up: Linux run `40276798121` exposed a smoke-start race. A delayed attach snapshot could
overwrite a newer live Ready header, causing the first prompt wait to time out. The CLI watcher now
keeps a live header at or beyond the attach boundary; regressions cover both delayed snapshots and
fresh snapshots replacing older events. The rebuilt Windows test executable was blocked by
Application Control (4551), so this follow-up needs CI verification. No policy bypass was attempted.

1. M1b: native Claude driver, protocol replay, session readiness, permissions/questions, smoke tests.
2. M1c: native Codex app-server driver and generated-schema compatibility.
3. M1d: native Pi and remaining ACP integrations.
4. M1e: catalog, updates, WSL, Windows daemon protection.
5. M2a: Orbit design system and live transcript.
6. M2b: projects, checkpoints, handoffs, native shell integration.
7. M2c: attachments, mentions, composer, palette, settings.
8. M3: boot, onboarding, agent management.
9. M4: worktrees, parallel chats, terminals.
10. M5: installers, signed updates, releases.
11. M6: website and Rust accounts/API on Cloudflare.
12. M7: encrypted workspace sync and recovery.
13. M8: Config Library.
14. M9: three-way config sync.

## M1d Pi implementation checkpoint (2026-10-26, pending verification)

- Isolated branch `m1d-pi-agents` starts from checked backend commit `cfb67db`. The native Pi
  catalog entry and Rust driver are implemented against the installed 1.0.2 protocol and official
  pinned source. Only `pi --version` was executed; no prompts, sign-in or configuration reads.
- Added explicit prompt acceptance versus `agent_settled` handling, `clear_queue` before `abort`,
  bounded process shutdown/drain, authoritative settings refresh, usage/context reduction and
  extension select/confirm/input mapping. Unsupported editor prefills cancel visibly. Full auto
  is the only advertised autonomy; dialogs are never auto-answered. Product steer/fork/rewind
  capabilities remain false, with typed native fork startup available for later UI work.
- Added pure tests, fake-process lifecycle/failure tests, a protocol-derived replay fixture and
  native Pi correlation/redaction support. Rustfmt parsing and instruction-file synchronization
  pass. Two ordinary local Cargo attempts were blocked before driver compilation by Windows
  Application Control, error 4551 on dependency build scripts. No policy changes or alternate
  execution paths were attempted. Linux CI for `f316b59` passed all 19 Pi tests, workspace Clippy
  and binding regeneration. Full test failures identified five stale catalog assertions and the
  base branch's CLI readiness race. Follow-up CI, expanded replay evidence and authorized
  real-agent acceptance remain required.
- Remaining M1d ACP dialect integrations are separate work and are not implemented by this checkpoint.
- Follow-up review confirms Pi's model/thinking RPC setters are session-local unless the SDK caller
  explicitly requests persistence. Removed the auto-compaction toggle because its setter always
  persists user settings. The Pi free probe uses native read-only state checks and leaves settings
  unchanged. New regressions cover resource bounds, exhausted retries, dropped setting receivers
  and buffered process output under event backpressure. Final Windows and follow-up CI are pending.
- CI run `40280216757` passed every applicable gate for `fa41b80` on Linux and Windows, including
  workspace tests, Clippy, generated bindings, replay and desktop smoke tests. Lint and PowerShell
  checks also passed. The next source audit found the synthetic settlement fixture incorrectly
  included an `aborted` field: official Pi 1.0.2 emits `agent_settled` without fields. Corrected
  the adapter and fixture, deriving cancellation from owned interrupts or assistant stop reasons.
  Added manual-compaction idle handling, automatic-compaction continuation coverage and a bound
  for oversized committed block arrays. These follow-up changes require their own CI run. No
  real prompts have been sent, and M1d acceptance remains pending.

## Decisions and constraints

- M1e process supervision now has an explicit host boundary: native execution delegates unchanged,
  while WSL and unknown hosts return `HostUnavailable` before starting a process. A Windows job
  around `wsl.exe` does not establish ownership of its Linux descendants. The Linux supervisor and
  its deployment/qualification remain pending, so discovered WSL installations are not launchable
  yet. Two fake-spawner regressions cover the boundary; local execution is blocked by Application
  Control build-script checks and awaits CI. No blocked binaries or host policy were altered.
- M1e process review found shutdown could erase recovery records even when owned descendants
  remained. Unix cleanup now retains exact escaped identities after incomplete cleanup, including
  a clean application close. Failed process-table reads no longer count as an empty group. Two
  registry regressions cover retention and later successful cleanup; Linux execution awaits CI.
- The Rust Linux supervisor endpoint now handles bounded control frames, raw agent lines, parent
  leases, EOF/signals, malformed input, queued-prompt disposal and redacted exit diagnostics through
  the existing process services. Read-only inspection supplies executable paths, canonical cwd and
  known provider configuration roots without exporting environment values. Eleven focused tests
  and all-target process Clippy pass on Windows. The earlier full process run passed 176 unit and
  nine helper tests before Application Control blocked a remaining integration executable. Linux
  ownership tests are added but await CI. WSL deployment/bridge and Windows daemon breakaway remain
  gated and pending; see [the host contract](host-supervision.md).
- Independent review tightened cleanup confirmation further: unreadable escaped identities and
  incomplete group enumeration remain unknown and retain recovery metadata. They never authorize
  a signal; only matching pid/start identities do. Injected permission/parsing failures and pid
  replacement regressions compile, and Windows all-target Clippy passes. Application Control
  blocked their test executable and the macOS cross-check build scripts; execution awaits CI.

M1e is progressing in the isolated `m1e-agent-catalog` worktree. Its first checkpoint adds typed
native/WSL host identity, bounded WSL distribution decoding, installation channel classification from
resolved paths, provider alias identity, and exact-version verification metadata. Detection and UI
integration are still pending; no host capability is advertised by these standalone types. The 31
agent tests, protocol host regression, all-target agent/protocol Clippy, and bindings export pass on
Windows. No real agent configuration or credentials were read or changed.

The next M1e checkpoint integrates the shared ACP catalog and optional native identity, preserving
Codex's authoritative ID. Successful version probes now populate installation metadata and the New
chat screen shows channel ownership and exact verification scope. Windows appends known install
directories after the resolved PATH; npm prefix input is bounded to 64 KiB. Agent detection tests
(20), agent unit tests (31), combined driver unit tests (362), environment tests (66), desktop tests
(287 with 19 existing skips), typecheck, bindings export and targeted all-target Clippy pass locally.
WSL launch/cleanup, update/auth helpers, remote version caching and milestone acceptance remain open.

Explicit `agent-auth <id>` and `agent-update <id>` commands now use the user's detected vendor binary
and reviewed channel-specific argument vectors. Claude/Codex auth responses are reduced to local
credentials-present, sign-in-required or unknown; account details are discarded. Updates reject
bundled/unknown installs and local npm dependencies, serialize provider aliases, invalidate cached
metadata and verify the resulting binary. Login command plans await the terminal sheet. Two fake
maintenance integration tests, nine CLI parser tests and all-target agent/CLI Clippy pass locally.
Windows Application Control blocked the newly linked agent unit-test executable (4551); those new
pure cases require CI. No real auth, login, update or paid prompt was run for this checkpoint.
The auth contracts are from [Claude's CLI reference](https://code.claude.com/docs/en/cli-reference),
installed CLI help, and [Codex 0.162.1 login source](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/cli/src/login.rs).
Corrected M1c head `887ad12` passed full [Linux/Windows CI](https://github.com/itscool2b/auracode/actions/runs/40281970244).

M1e now checks reviewed public npm, GitHub and Homebrew release endpoints in the background on real
desktop startup, refreshing successful checks after six hours. Bounded HTTPS responses, ETags and
auracode's own disk cache retain a clearly stale version when offline. Bundled installs continue to
defer updates to their owning application; release metadata never controls readiness or runs an
installer. The protocol and generated bindings expose latest-release metadata for the catalog UI.
The 37 agent unit tests, two maintenance integration tests, release cache cases, binding export,
desktop typecheck and 287 desktop tests pass locally. The update test also verifies that completed
alias probes cannot survive a vendor update. Remote catalog CI still needs the inherited M1d catalog
assertion and spike-documentation fixes; WSL supervision, host persistence and milestone acceptance
remain pending. No real authentication flow, update or paid prompt was run.

Host persistence now uses schema migration 0003, with the existing pre-migration backup and rollback
path. Earlier chats and agent sessions remain native. A typed host is saved independently of the
provider and transport; unknown host data is unavailable rather than silently native. The legacy
`create_chat` API remains native, and `create_chat_on_host` plus generated `chatCreateOnHost` and
`ChatSummary.agent_host` form the explicit UI seam for M2b. Restored WSL/unknown chats fail before
native detection or spawning while the qualified Linux bridge is unavailable. Resuming a saved ID
from another host is refused; starting fresh is explicit. Native launches now pass through
`HostSpawner`. The 258 core unit tests and 27 lifecycle tests passed before the final two targeted
host regressions, which also pass, as do bindings export, targeted all-target Clippy, desktop
typecheck and 287 desktop tests. Linux cwd translation and canonical configuration realms await the
supervisor inspection contract; no WSL launch capability is claimed yet.

The catalog now exposes reviewed maintenance capabilities, coarse vendor sign-in checks and explicit
channel-owned updates through typed desktop IPC and the selected installation's controls. Selecting
an agent only checks which actions are available; auth checks and updates require their own user
action. Bundled/unsupported updates show their reason. Delayed responses cannot replace another
agent's status, and release metadata continues to refresh in an already-open window. The provider
update lock now includes verification and atomic cache publication, preventing a second updater from
replacing the binary during the first verification. Four fake maintenance integration tests, bindings
export, targeted all-target Clippy, desktop typecheck and 289 desktop tests pass. No real updater or
authentication command ran. Interactive vendor login remains pending a qualified terminal sheet.

Public release metadata now includes the [official ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)
for Antigravity ACP, Cursor, Grok and distinct OpenCode V1/V2 entries. Only reviewed IDs and version
fields are consumed; distribution commands and download URLs are not executed. Cache keys retain
the selector so two agents in one registry document cannot overwrite each other's versions.
Reviewed npm package owners now cover Pi, OMP and Grok, while local dependencies and Bun global
layouts are still refused by the npm updater. The package names are supported by the registry,
[OMP's pinned package manifest](https://github.com/can1357/oh-my-pi/blob/v18.12.6/packages/coding-agent/package.json)
and [Pi's pinned CLI documentation](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md).
The 39 agent unit tests and all-target agent Clippy pass. No package or agent was installed or updated.

- M1d ACP subtask: deferred Cursor questions/plan approval and OMP form elicitation are implemented
  with fake-pipe and pure conversion regressions. OMP advertises form support to prevent its
  no-form plan auto-approval path and exposes only its enforceable Full auto autonomy. See
  [the contract baseline](spikes/m1d-acp.md). A normal Cargo retry now runs after an initial
  Application Control build-script rejection. The 354 driver unit tests and six identity tests
  pass; no real-agent runs were performed.
- Driver readiness now permits an absent native ID until a vendor creates a transcript on the
  first visible prompt. Core stores no fabricated resume target and claims the confirmed ID only
  when reported, holding queued work until its checked database write succeeds. Existing drivers
  retain their known IDs. Regressions cover two initially anonymous sessions, failed first prompts,
  restart without a resume target and the durable save barrier for an initially absent ID.
- M1d catalog adds Antigravity, Cursor, Grok, oh-my-pi and separate OpenCode major lines, plus
  restricted agy/Grok text fallbacks. Version-qualified discovery never probes generic `agent`.
  ACP/fallback ownership aliases are shared. Agent tests (24 unit, 20 discovery, six installation)
  and 357 driver unit tests, four schema checks and three fixture replay integration tests pass.
  Install/authentication and real vendor acceptance remain pending; no paid prompts were run.

- Rust owns backend logic. TypeScript remains for React and necessary platform/build glue.
- D1 and Cloudflare Email Service replace Neon/Postgres, Neon Auth, Hyperdrive, and Resend.
- Reuse the existing targeted environment scrub, not the handoff's older blanket prefix scrub.
- Native Claude must distinguish a completed turn from an idle run before dispatching queued work.
- Native and ACP aliases must share native-session ownership checks.
- Updated the local signed native Claude executable from 2.1.296 to 2.1.310 using its official
  `claude update` command. No credential/config files were inspected or edited. Version checks remain
  at the recorded baseline. Free probes and fixture coverage precede any paid verification.
- One finished PR per milestone, no automatic merges. This foundation branch precedes M1b.
- Added LF text checkout attributes after Windows CRLF conversion caused baseline formatter failures.
  Normalization changes no existing tracked source content; binary files remain binary.
