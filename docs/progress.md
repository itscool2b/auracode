# Auracode implementation progress

Updated 2026-10-26. Scope: the accepted Rust-first, Cloudflare-hosted plan, M1b through M9.

## Active integrated-product continuation

Integration update: `737013f` brings the coherent M1e native agent catalog and Rust project
organization into the UI branch. `6e58695` adds native shell behavior. Thin workspace commands,
project create/edit/add-folder, chat rename/pin/archive/restore/move and busy-folder preflight are
now wired locally. Stored default-model editing is withheld until its startup behavior is implemented.
The next binding export was blocked while rustc loaded `tauri_macros` by Windows Code Integrity
events 3077/3033 at 05:00 local time. No policy changes or relocation workaround was attempted.
Generated workspace command bindings and their dependent TypeScript checks remain pending the
planned Windows/macOS integration gate. This is a saved implementation checkpoint, not acceptance.

- Owner corrections are authoritative: Windows/macOS only; batch implementation and CI; use the
  actual original Mobbin references; dark appearance only across desktop, onboarding and website.
- Inspected Grok, SpaceXAI, Harvey, Aside and X Money screens and the selected Orbit lab. Evidence
  and UI mapping are in `docs/design/reference-audit.md`. Replaced the old frame with compact
  navigation, live Needs you, project folds, agent dock, title header and a unified composer.
- Session options and controls remain real but move into disclosures. Pending permissions replace
  the composer without destroying the draft. The product no longer follows OS appearance.
- Local `de4010f` preserves sticky prompt context, focused output, command output folding and the
  native smoke helper's ability to find virtualized tools. Its final native rerun is pending.
- Structural UI checkpoint: desktop TypeScript check passes; production preview visually inspected
  in dark; changed-file Biome has no errors (three CSS ordering warnings). The full functional,
  accessibility, responsive and native suite is reserved for integrated acceptance and is not done.
- Rust project organization APIs, native shell and PTY work are implemented in parallel branches.
  Integrating those implementations and completing their product surfaces is the next work.
- No CI was dispatched for these local checkpoints. Full product completion remains pending.

## M6/M7 Rust cloud API checkpoint

- Implemented Rust Worker auth, bounded email-code challenges, Turnstile verification, hash-only
  sessions, browser Origin/CSRF checks, desktop-bound device registration and approval/recovery.
- Added SQLite-compatible D1 migration, opaque encrypted record/chunk push/pull with monotonic cursors,
  private R2 blob CAS with quota reservations, and retryable account/orphan cleanup. Cloud account
  keys never enter this service. Contracts and deployment prerequisites are in docs/cloud-api-v1.md
  and apps/api/README.md; the independent client owns E2E key handling and merge/application behavior.
- Native Rust tests pass 27 cases, including actual shared SQL atomicity/authorization, quota rollback,
  device bootstrap/approval expiry, recovery binding, revoked writes and blob CAS. Native all-target
  and wasm32 Clippy pass. worker-build 0.8.7 produced the release Wasm and generated runtime shim.
- Five local compiled-Worker runtime tests passed against isolated Miniflare D1/R2: concurrent code
  consumption, browser CSRF/Origin, sync booleans/cursors, private blob CAS and retained-device proof. External network
  requests are blocked by the harness. Pinned Wrangler's production-config dry run passed without
  deploying. Migrated obsolete pnpm build approvals to allowBuilds and approved the pinned workerd
  tool required for these local tests; no host security policy was changed.
- No cloud application, migration, email, account or CI run was deployed/executed. Preview runtime
  tests, production Email Service onboarding, Turnstile/secrets, client integration and installed
  acceptance remain pending. M5 signed release publication is separate.

- Retained desktop device keys can now rebind a fresh sign-in through a five-minute, one-use
  X25519/HKDF/XChaCha20-Poly1305 possession challenge. Its context binds account, device, challenge
  and both public keys. Atomic consumption rechecks expiry, revocation and fresh-session identity;
  replay, wrong-session, expiry and revocation regressions pass. No account key enters this proof.

- Account summary, session-wide sign-out, verified email changes and bounded streaming encrypted
  exports are implemented in Rust. Eight actual compiled-Worker tests pass, including email proof
  isolation/replay, preservation of account identity and export completion without session secrets.
  Native and wasm Clippy pass. The new native SQL unit rerun is blocked by Windows Application
  Control (4551); its compiled-Wasm runtime path passes. No policy or executable was changed.

- M6 website checkpoint: dark-only landing, download, email-code auth, account, privacy, terms and
  changelog routes prerender to static HTML. Account views call the Rust API; browser code handles
  presentation/transport only. The hero uses the actual dark desktop fixture. Build/typecheck,
  static/CSP checks, an assets-only Wrangler production dry run, Chromium and WebKit UI flows,
  and home/account Axe checks pass. Tests block
  external requests and use synthetic responses. Real Turnstile/email/preview integration, macOS
  browser acceptance, installer publication and legal review remain pending. No deploy or CI ran.

Current owner correction: Windows and macOS are the supported targets. Linux and WSL work and
acceptance are deferred. Implementation checkpoints are committed locally with focused checks;
the root task will run CI at major integration and final verification points.

M2b backend work is isolated on `codex/m2b-core`, based on the integrated catalog. The initial
`aura_protocol::workspace` types define project metadata, device-local folder mappings, archived
listing filters, pinned chat metadata, explicit moves, and a busy-folder creation preview. Existing
`ChatSummary` and transcript frames retain their shape. These types are exported in the generated
desktop bindings. Rust now implements project creation/update/folder addition, rename, pin,
archive/restore, organization moves, and project chat creation through the existing SQLite writer.
Busy-folder preflight resolves aliases and includes preparing and retiring sessions; concurrent
project chat creations serialize the final check. Moves require a stopped chat with no queued
prompts, never move files, and cannot change a native session's cwd until the visible handoff path
is implemented. Mutations acknowledge their actual transaction, and actor dispatch waits for a
pending move. Manual titles reject late automatic writes. Saved workspace reads still work when
saving pauses, and another device's folder mapping is never used for local launch.
All 268 core unit tests and all-target core Clippy pass, including nine new organization and
actor regressions. The binding export test passes locally. Tauri wiring, Git folder identities,
checkpoints/Changes/revert, edit/retry/fork and visible agent handoff remain pending. No CI push
or real agent invocation was performed.

The standalone Rust checkpoint service now captures exact file bytes in per-folder shadow Git
repositories using temporary indexes and `refs/aura` refs. Its owned Git helpers disable inherited
Git overrides, global/system configuration, hooks, filters and line-ending conversion. Gitignore
rules, 10 MiB file and 100 MiB total limits, submodule/link exclusions and protected agent/profile
directories have explicit behavior. Changes preserves excluded files as exclusions, never as
deletions. Revert requires a one-use content-bound preview and validates the full selection before
writing. Directory-relative capability handles keep reads and restores inside the selected folder;
replaced/removed files remain in a visible recovery directory if a later step fails. Partial failure
is an explicit result. Eight focused tests cover exact CRLF bytes, unchanged user index/HEAD, ignore
changes, exclusions, restore, stale previews and a concurrent edit between validation and rename.
Core Clippy and desktop binding export pass locally. The Changes DTO is generated.

Production desktop and CLI turns now save the checkpoint before forwarding their original typed
prompt parts. Capture failure holds the queued prompt with a visible reason; interrupt cancels a
pending capture. Native background activity still prevents dispatch until authoritative idle.
The checkpoint reference is saved in the existing turn column, with no new migration. Changes
waits for earlier actor writes before selecting the saved turn. Revert reserves the canonical
folder until file writes finish, including when an RPC is abandoned, and refuses active, preparing
or retiring agents. A later start cannot race that reservation. Diff reads only scanner-approved
files and opens each component without following links. The same image capability guard used by
the composer rejects unsupported images before enqueue without dropping typed parts.
All 281 core unit tests and all-target core/CLI Clippy pass on Windows. The 12 focused checkpoint
tests pass after the history barrier. CLI checks passed 44 unit, 4 demo, 6 headless and 3 scripted
native smoke tests. The binary unit-test executable was blocked by Application Control (4551),
so the full CLI integration command could not finish. The scripted fixture now uses its store's
actual device ID instead of a mismatched literal, preserving device-local folder isolation. Tauri command wiring,
macOS execution, edit/retry/fork and visible handoff remain pending. No CI push was made.

The continuation DTO now defines paged turn summaries, editable free text with retained context,
switch/retry/edit/fork actions, and an exact visible preview with a one-use expiring token.
Retry/edit previews show their complete prompt; switch/fork wait for the next user message.
Source transcript preservation and native-resume status are explicit. TypeScript export passes;
continuation persistence and execution are still being implemented.

The final local M1e follow-up resolves Windows Pi, OMP and Grok npm shims through the reviewed
package's bounded `package.json` bin entry, using `node.exe` or a packaged executable. It never
interprets shim content. Package name, relative entry containment and canonical target are checked;
unknown shims and project-local packages stay unavailable. Channel metadata and update validation
refer to the actual package entry. Fake Windows package/launch/update checks, bounded manifest
tests and all-target aura-agents Clippy pass. No vendor binary was invoked for these tests.

## M1e combined agent checkpoint (2026-10-26)

The catalog branch now includes native Codex, native Pi, the qualified ACP catalog and restricted
text fallbacks, including M1d's notification attachment regression. Pi's readiness assertion uses
the shared optional native identity contract. Catalog assertions derive from the registered data.
The supervisor includes reviewed environment overlays, same-connection inspection and launch, and
an explicit binding from the launched executable to the prepared executable set. WSL launch stays
unavailable until the owned bridge and deployment are qualified.

Local workspace/all-target compilation, full workspace Clippy with all features, generated bindings,
rustfmt, spike documentation checks, and pnpm check pass. The combined agents, CLI, core and driver
test targets pass. All 17 focused supervisor tests pass after correcting the redaction expectation.
The broader process integration targets remain unverified locally because Windows Application
Control blocked the synthetic process helper and one supervisor test executable with error 4551;
no policy bypass was attempted. Fresh combined Linux and Windows CI is pending. Native smoke
acceptance gaps, WSL discovery and launch, Windows vendor-daemon breakaway, and the explicit vendor
sign-in terminal remain pending. No paid prompts, real vendor login, credentials or agent config
were accessed during this checkpoint.

## M2b native shell checkpoint

- Added Rust tray, generic background notifications with retained chat navigation, active-work quit
  confirmation, and same-thread idle-sleep assertions on Windows/macOS. Native appearance is dark
  regardless of the system theme. Windows minimize/restore and tray hide update WebView2 visibility.
- Regenerated the `shellTakeNavigation(): Promise<string | null>` binding. Frontend event/focus
  integration remains with the application integration branch; details are in `docs/native-shell.md`.
- Windows desktop all-target Clippy passed. The desktop library run passed 163 tests with one stale
  catalog assertion excluded; that assertion is already corrected by the later M1d integration.
  New checks cover concurrency, stale notifications, power release, visibility retry and guarded quit.
- Installed Windows/macOS tray, notification routing, real sleep behavior, dark material and rendering
  acceptance remain pending. Linux/WSL and CI pushes are deferred by owner direction. No credentials,
  native agent prompts, login flows or vendor process changes were used.

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

M1b is implemented and verified on `m1b-claude-native`. Native discovery, driver dispatch, transcript mapping,
permissions, multi-question UI, run-idle gating and shared native-session ownership are implemented.
Native live verification, recorded fixture curation, review fixes and local workspace gates are
complete. Final Linux/Windows CI and milestone installer builds passed. The completed PR awaits
owner review and merge authorization.
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
- [x] Full workspace checks, frontend/build tests, CI and independent final review.

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
The completed M1b PR is opened after the final verification below.

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
Application Control (4551). No policy bypass was attempted. Final CI run `40278038126` for `374dbf5`
passed Linux and Windows Rust tests, Clippy, generated bindings, app streams and chat smoke tests,
frontend lint and PowerShell checks. Independent review of the final watcher patch found no issues.
Build run `40276797966` produced Windows and Linux installers from `cfb67db`; the subsequent watcher
patch changes only the developer CLI, not the bundled app. macOS remains untested on this Windows
host and was skipped by the milestone branch workflow. This does not claim macOS native acceptance.

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
- Pi startup now retains newer lifecycle events when the initial `get_state` reply is delayed,
  preventing an old idle snapshot from releasing queued work and an old busy snapshot from leaving
  the chat stuck. Paused-clock regressions cover both orders. A dialog timeout of zero now matches
  native Pi's no-timeout semantics, with an end-to-end answer regression. These final source-audit
  fixes still need CI verification. The preceding settlement/compaction checkpoint `a87ef36` has
  passed Linux CI and Windows tests; Windows frontend smoke is still running.
- The smoke runner now explicitly skips its permission scenario when the agent cannot enforce Ask,
  before changing autonomy or sending prompts. This makes the capability limitation visible for
  Pi and the remaining Full-auto-only integrations. A scripted regression verifies zero mode
  changes and zero prompts for that skip; the existing permission tests now declare their actual
  permissions/Ask support. Verification is pending in the next combined M1d CI run.

## Decisions and constraints

Owner correction on 2026-10-26: finish the full product, prioritize a usable integrated build,
target Windows and macOS only, and defer Linux/WSL. Routine edits and checkpoint pushes must not
launch CI. The workflows now require deliberate dispatch; the planned remaining gates are at most
two major integration runs and a final full run, with focused reruns to repair failures.
AGENTS.md and CLAUDE.md record the same policy. The visual baseline must come from the original
handoff's actual references and chosen Orbit Lab, not the partially restyled M1a shell.
The original reference image/catalog bundle is not in this machine's Downloads folder. Mobbin
inspection has now confirmed Grok conversation layouts, Aside's browser frame, Harvey's product
presentation, SpaceXAI's Grok Bot page and X Money's iOS account/send screens. Exact observations
and links will guide the implementation; unrelated search results are excluded.

CI `40290191800` for `5f10309` passed all 30 native chat checks on Windows and Linux, and the
frontend/browser gates. Both reopen runs passed five checks, then the smoke reader tried to use
an unmounted older tool. The local fix walks the actual scroll surface before interacting with
that tool. A review also found focused controls could disappear when tool groups formed or
finished; local changes preserve focused rows and explicit group expansion. The latest local
frontend check and production build passed, and Chromium passed the expanded browser cases;
WebKit was interrupted when the owner paused work. These changes are not yet fully verified.

Parallel M2a work is on `m2a-orbit`. Orbit geometry, its SVG renderer and mark styles now live in
`@auracode/ui/orbit`, with the Design Lab consuming that same implementation. All 352 Design Lab
tests, UI/Lab typechecks and the Lab build pass after extraction. The live mark now shares one
animation clock, keeps bounded state history without losing orbital phase, and stops scheduling
frames when settled, hidden, offscreen or under reduced motion. Tool completion ripples finish
before idle; reduced-motion success expires with one timer. All 183 UI tests and its typecheck pass.
The desktop now consumes the shared light/dark tokens, follows system appearance and uses SVG
marks for live protocol activity, thought/tool rows, bylines and the empty state. It no longer
probes WebGL at startup; retained diagnostics and other Lab directions keep their existing shader
dependencies. Streamed prose stays stationary, completed tools collapse and failures open, and the
transcript distinguishes native work that continues after a response from an idle session.

The development-only `?preview=` harness renders both synthetic UI cases and curated real Claude
thinking/tool recordings through the real chat store. It has no native transport and is removed
from production builds. Chromium and WebKit each passed 14 state/theme accessibility scans with
zero automated WCAG A/AA violations, keyboard tool disclosure and send, reduced-motion/offscreen/
hidden-document frame checks, zero canvases, and the 960x640 minimum window. Screenshots and JSON
reports are in ignored `target/orbit-browser/`. `pnpm --filter @auracode/desktop check:orbit` runs the
suite with its own local server. This automated evidence does not replace native platform checks.
Full M2a review, long-history rendering and the remaining transcript refinements are pending.
The current frontend gate passes 827 tests with 19 existing skips and both production builds.
The preview and frame instrumentation are absent from the production output. All 11 native window
material tests, desktop all-target Clippy, rustfmt and 33 documentation checks pass after switching
Mica to system appearance; no host security settings changed. CI now runs the browser suite and
retains its screenshots and accessibility reports for seven days.

The next M2a checkpoint virtualizes stable transcript items, including tool-heavy single turns.
The scroll controller distinguishes layout corrections from reader gestures, and a keyboard-accessible
Latest control returns to the current output. Loading older pages preserves a visible text fragment,
including pages cut inside a turn or the same message. Repeated paragraphs are anchored from the end
so an identical paragraph in the newly loaded prefix cannot take over the reading position.
Unanswered forms and focused rows stay mounted; manual thought/tool disclosure choices live at chat
scope and survive row recycling. An independent review caught the draft-loss and partial-turn cases
before completion. Browser fixtures now cover 500 turns, a 1,000-tool turn, append and prepend while
reading, partial-message pages, draft retention, disclosure retention, keyboard focus and Latest.
Both Chromium and WebKit pass that expanded suite, including repeated paragraphs in one message.
The frontend gate passes 828 tests with 19 existing skips, and both production builds pass.
M2a still needs its remaining transcript refinements and final milestone review. CI run `40282377517`
passed Linux/Windows checks and the browser suite for the preceding `e1f3c67` checkpoint; macOS was
skipped. The new virtualization checkpoint needs its own CI run.

CI run `40286596525` for `95d73c8` found two regressions: the native chat smoke reader still
expected a whole turn in one mounted element, and partial-page restoration could apply the same
height correction twice. The smoke reader now walks the real scroll surface, opens tool groups,
and assembles the rendered pieces by stable identity. Fragment restoration suppresses duplicate
virtual row compensation until measurements settle, with immediate cancellation on reader input.
A separate history revision prevents live frames from prematurely finishing a pending page load.
Both Chromium and WebKit pass partial-turn and partial-message anchors, including repeated text.

The next transcript checkpoint adds copy controls with truthful success/failure feedback, long-prompt
folding, persistent grouped tool disclosures, and inline diffs with relative line numbers, change
markers, totals, folding and explicit truncation. Response and receipt copying use only reported
data; cumulative cost is labeled as session cost. Malformed full-diff payloads fall back to the
retained preview. The smoke reader itself is exercised against the browser fixture.
Local verification passes 832 frontend tests with 19 existing skips, both production builds,
and 16 accessibility scans per browser plus clipboard, folding, diff and long-history checks.
The attempted native rebuild was blocked by Windows Application Control (4551) at a Tauri build
script; no bypass was attempted. Native chat/reopen verification remains pending on this checkpoint's
CI run. Remaining M2a presentation work and final milestone review are still pending.

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
- Explicit supervisor launch overrides now preserve driver flags and native executable paths.
  Inspection uses the same scrub-then-override order, while the Linux login environment stays local.
  Overrides are bounded, Debug/error output omits values, and secret literals are registered before
  spawning. All-target process Clippy passes; the focused regression executable compiled but Windows
  Application Control blocked execution (4551). Linux inspection/launch consistency remains a CI
  requirement. The bridge and deployment are still gated.
- Supervisor protocol v2 now binds inspection and launch on one leased connection with a
  preparation token. Final driver overrides are accepted only when canonical cwd, provider roots
  and executable paths remain identical; stale tokens, changed realms and unreadable config roots
  fail before process spawn. Seventeen focused Windows tests and all-target Clippy pass after an
  ordinary Cargo retry. The Linux same-connection integration regression awaits CI; no WSL host
  capability is enabled by this server-only checkpoint.
- Independent preparation review added binding of the actual launch program to the inspected
  executable set. Stable and resolved paths are accepted only for that set, and adapters must
  include Node explicitly. Pure mismatch coverage passes in the 17-test supervisor suite; Linux
  integration also attempts an uninspected program and requires rejection before spawning.
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
- ACP refinements preserve OMP choice labels/descriptions separately from native values, show
  Cursor's separate tasks/phases before plan approval, merge bounded Cursor todo notifications
  and retain task/image context through ordinary tool events. Grok's prompt-wide usage ledger
  uses disjoint cache buckets and turn scope. The current plan table now matches the documented
  agy stdin protocol and leaves Cursor restart-based model switching unqualified.
  The complete core suite passed after optional readiness; final branch CI remains pending.
  The last executed driver run passed 362 tests. Application Control subsequently blocked the
  newly linked test executables; the two newest callback regressions and doc-check compile but
  await branch CI execution. No binaries or security policy were changed to bypass the block.
- The first ACP branch CI exposed omitted qualified-binary match arms in CLI probes and repository
  inspection, plus the new spike report's required status/table format. Those integration fixes
  are applied; catalog assertions now derive expected IDs from the shared catalog so combined Pi
  integration does not retain a stale agent list. CLI all-target Clippy and its unknown-agent
  regression pass. Desktop test compilation remains blocked by Application Control build scripts;
  final combined CI remains pending.

## Decisions and constraints

M1d integration checkpoint: Pi and the deferred ACP callbacks, qualified catalog recipes and
restricted text fallbacks now coexist on `m1d-pi-agents`. Pi `5146ee5` passed complete Linux and
Windows CI in run `40282637352`. Catalog merge resolution preserves all 14 entries and updates
cross-package catalog assertions through the shared catalog. The free probe explicitly limits
text fallbacks to executable detection and starts no chat or prompt, with a real fake-process
version-check regression. The permission smoke scenario explicitly skips unsupported Ask modes.
Combined verification and real-agent acceptance are still pending; no new paid calls were made.
Grok text smoke expects native per-turn usage; the text fallbacks' logs are listed without claiming
the ACP replay path supports them. Text fallback replay remains an explicit acceptance limitation.
Agy text usage now keeps a baseline per owned process: the first sample retains session scope,
subsequent totals become turn differences, and a restarted process begins a new baseline. A fake
process regression covers two cumulative results and a resumed process. Combined CI found a
missing field in the new no-prompt probe test constructor; that compile defect is corrected.
The usage regression and corrected combined checkpoint still await CI execution.
Pi's synthetic replay evidence now includes thinking with a tool round trip and an interrupted
extension confirmation. The semantic checks require deduplicated text and reasoning, one native
tool lifecycle with final output, turn token totals and dialog withdrawal before the cancelled
turn. These fixtures derive from the pinned public wire types; they are not real-agent recordings.
Combined Windows CI `40285702748` passed Clippy, all new Pi/Headless/CLI behavior regressions,
bindings and desktop smokes. Its full test step exposed two stale catalog assumptions: the CLI
missing-agent count and Grok's single-probe count despite ACP/fallback aliases. Those assertions
now derive the catalog size and verify every observed invocation is a version check. Final combined
CI, the expanded replay fixtures and real-agent qualification remain pending.
Combined checkpoint `d7055a6` passed the complete Linux CI job and all 398 driver tests on both
platforms, including the expanded Pi replay fixtures. Windows exposed one scheduling race in a
CLI smoke assertion: force stop reaches `Stopped` before the retired driver's join releases its
live slot. The smoke regression now waits within its existing stop deadline for that release,
before any shutdown fallback, and still verifies that the removed prompt never runs. The corrected
Windows gate remains pending; native-agent acceptance and macOS verification remain outstanding.
A subsequent Pi dialog review found that core's fixed display limits could shorten native
confirmation text or select labels before an answer. Pi now cancels unsupported oversized dialogs
with a notice, as ACP callbacks already do. Pure regressions cover escaped text, Unicode character
limits and aggregate size; a fake-wire regression requires cancellation without a partial question
and verifies the next supported dialog remains answerable. Execution awaits branch CI because
ordinary local Cargo is still blocked by Application Control.
Combined CI `40288849525` passed all 401 driver tests on Linux, including Pi's dialog fidelity
regressions. The Linux test step found an existing notification-test subscription race: its
script emitted before the recording sink attached, so the event could already belong to initial
history. The test now injects its notification after attachment, preserving its actual notification
and autonomy assertions. Final combined CI and real-agent qualification remain pending.

- M1d ACP subtask: deferred Cursor questions/plan approval and OMP form elicitation are implemented
  with fake-pipe and pure conversion regressions. OMP advertises form support to prevent its
  no-form plan auto-approval path and exposes only its enforceable Full auto autonomy. See
  [the contract baseline](spikes/m1d-acp.md). Local Rust validation is pending because Windows
  Application Control blocked clean dependency build scripts; no real-agent runs were performed.

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

## M1e terminal foundation

The native process layer now exposes a raw binary transport using the existing environment scrub,
registry, direct-child exit observation and owned-tree shutdown. Its bounded stdin queue preserves
whole packets when an async enqueue is cancelled; close interrupts blocked output and discards
queued transport bytes. Terminal payloads never enter protocol logs or the retained stderr tail.
Windows validation passed 183 process unit tests, three raw transport regressions, 31 existing
spawn/helper/shutdown tests and all-target Clippy. The tests verify binary fidelity, concurrent pipe
draining, owned descendants ending on last-control drop and an unrelated sibling remaining alive.
The PTY platform layer, explicit sign-in sheet, Unix execution evidence and vendor acceptance remain
pending. No vendor login or model prompt was run.

The PTY layer now uses Windows ConPTY with suspended native process creation, Job assignment before
resume and kill-on-close containment. Explicit standard-handle initialization prevents redirected
parent output from escaping the terminal. The macOS path opens a controlling PTY in an owned session,
with close-on-exec descriptors and asynchronous nonblocking IO. Output is bounded to 256 KiB, never
logged, and drained independently of the viewer with a post-exit deadline. The implementation uses
native bindings instead of portable-pty because its Windows launcher resumes before a Job could be
assigned, leaving a descendant ownership race. No breakaway flags or shell command interpolation are
used. Four harmless Windows PTY tests pass for terminal IO, quoting, Unicode, resize, descendant
cleanup, unrelated-process preservation and stalled output. Three raw transport regressions and
all-target process Clippy also pass. macOS execution and the sign-in sheet remain pending.

Explicit sign-in now has a reusable dark Orbit terminal sheet and typed IPC. A reserved, window-owned
ID exists before the vendor command starts, so Close can cancel a delayed launch. The Rust service
allows one terminal per window and four total, rejects cross-window IDs and concurrent reads, and
closes pending/running terminals on page reload or exit. It launches only the detected installation's
reviewed Claude/Codex login argv after executable identity validation. No arbitrary command or vendor
credential/config file is accepted. Output stays ephemeral; xterm logging and OSC clipboard writes
are disabled. Rendering completion gates the next bounded read, input is ordered and bounded, and
resize requests coalesce. The explicit Start button avoids mount-triggered sign-in and StrictMode
duplication. A completed command does not assert that authentication succeeded.

Local Windows checks pass: four core ownership/cancellation tests plus the harmless PTY child helper,
five frontend flow-control/presentation tests, generated bindings, TypeScript, Biome, and core/desktop
all-target Clippy. An actual owned test process exercises terminal input and cancellation without any
vendor login. The existing frontend suite also passed 293 tests with 19 existing skips while checking
the new dependencies. Root UI integration, interactive browser review and macOS execution remain
pending. No real login, paid prompt, CI dispatch or push was performed for these changes. Native
transport and xterm reference sources: Microsoft ConPTY session creation documentation and the
official xterm.js flow-control/security guides. M4 can reuse the same Rust ownership and streaming
seam; arbitrary shell launch and a general terminal panel are not exposed by this checkpoint.

## Composer context checkpoint

Typed prompt parts now persist through the queue and begun turns. Explicit file picker, drag/drop,
and pasted-image UI feed a Rust import service with bounded image decoding, metadata-free PNG
normalization, bounded UTF-8 text, private content-addressed storage and chat-scoped attachment IDs.
File discovery reads names only, excludes private credential paths and dependencies, and validates
mentions inside the active project folder. Transcript text includes the text-file context sent to
the agent. Images and mentions now map to native Claude, Codex, Pi and capability-checked ACP input.
The dark composer exposes removable context chips and keyboard file selection, retains input after
send failure, and avoids clearing text typed while a send was pending.

The core and driver crates pass all-target compilation and Clippy. Import/path/integrity and wire
regressions are written for the integration test batch. Generated desktop bindings, native picker,
paste/drop, queue restart and browser acceptance remain pending. Windows Application Control still
blocks this root checkout's Tauri macro DLL, so binding generation belongs to the planned remote
Windows/macOS integration checkpoint. No policy changes, paid-agent calls, CI dispatch or push were
made. Durable unsent drafts and the remaining M2c controls are still being implemented.

Wire references: [ACP content](https://agentclientprotocol.com/protocol/v1/content),
[Pi RPC commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md),
and the checked-in Codex 0.162.1 app-server schema. Image decoding uses the bounded
[image crate API](https://docs.rs/image/0.25.10/image/).

The local draft backend now stores text, selected attachment IDs and mentions in migration0005,
using the existing backed-up migration path and bounded writer. Restore resolves attachment metadata
within the chat. Core compilation passes after checkpoint integration; a profile-reopen regression
is staged for the integration test batch. UI draft lifetime/write ordering is being wired separately.

Draft UI now reuses the same editor state across chat views and serializes persistence so a slow save
cannot overwrite newer input. Successful sends consume only their own text/context and preserve
edits made while sending. Load/save failures keep the draft in place with retry. Native quit now
requests an acknowledged draft flush before stopping agents or closing SQLite, and offers to keep
the app open if that flush fails. Required Tauri event permissions also enable existing notification
navigation and native file-drop listeners. Ordering/failure/quit regressions are staged for the final
integration batch; Biome and rustfmt pass. Native compilation/binding generation remain pending the
planned platform check. This checkpoint does not mark M2c or the product complete.

## Checkpoint Changes interface

The dark Changes panel now connects the Rust checkpoint service to current-file comparisons,
per-file diffs, checkpoint selection, explicit multi-file revert previews and partial-failure recovery
paths. Active sessions must stop before a revert. The panel resizes with a pointer or keyboard,
closes with Escape without interrupting an agent, and restores focus. Snapshot failures disable
revert until a successful refresh. The autonomy disclosure now describes the implemented checkpoint
behavior. Preview fixtures exercise attachment/mention controls and selected-file revert without
accessing any real project files.

A focused Chromium accessibility scan of the panel passed with no violations, and keyboard focus
restoration passed. Biome and rustfmt pass apart from existing CSS ordering warnings. The combined
browser regression is prepared for the integration batch. Native command bindings, real checkpoint
UI acceptance on Windows/macOS, and broader milestone checks remain pending. No remote CI or push.

## Local search and command palette

Rust now exposes bounded project/chat metadata search and literal-prefix FTS over completed messages,
with accent folding, archived opt-in, deleted-row filtering and plain-text snippets. Reads use the
profile writer and its saved-data path when saving is paused. The dark command palette opens from
Search or Cmd/Ctrl+K, supports keyboard selection and scope filters, and adds project-file mentions
to the existing draft. Available workspace commands use the same real actions as the main UI.

Core all-target compilation passes after reconciling the combined Cargo lockfile. The search regression
and integrated browser checks are queued for the verification batch. A focused Chromium interaction
found no browser errors; its one near-threshold contrast finding was corrected. Production bindings
and full platform acceptance remain pending. No CI dispatch or push.

## Conversation continuation backend checkpoint

Migration 0006 saves explicit continuation state, links forks to their source, and persists actual
native capabilities. The bounded preview lists the exact handoff and retained prompt before apply;
it never sends a model prompt. Retry/edit retain the original transcript. Switch-back resumes the
selected agent's saved session when its recorded capability, host and cwd permit it, with only the
missing turns in the visible handoff. Latest-turn Claude and Pi forks use the supported native fork
startup and a distinct session ID. Other forks use a new chat and visible context. Earlier-turn native
truncate/fork mappings and native Codex fork remain unavailable until qualified end to end.

Confirmed handoffs survive actor reconstruction and are consumed atomically with the begun turn.
Image references copy only source-chat metadata selected from a saved turn; a missing image aborts
the transaction. Preview tokens expire, are single use, and reject intervening conversation changes.
Continuations require stopped agents and no queued prompts. Ambiguous legacy attachment-only prompts
cannot be edited safely and show a reason; unchanged retry remains available. File context includes a
bounded real Git diff stat computed from the private checkpoint trees, without accessing the user's
index. Checkpoint exclusions now also reject known credential and private-key paths before reads.

All 294 core unit tests pass locally on Windows, including continuation recovery, exact context,
attachment rollback, native fork identity, checkpoint/index protection and migration salvage. Core
and CLI all-target Clippy and the desktop binding export pass. No real-agent prompt, vendor login,
push or CI dispatch ran. UI integration, macOS execution, project default-model application, portable
Git folder identity, missing-native-transcript fallback and M4 Git lifecycle remain pending.

## Visible history continuations

Message Edit, Retry and Fork actions and the paged conversation history now use content-bound Rust
previews. The dialog shows exact handoff/prompt text and native resume/fork behavior, requires a
stopped session and no queued prompts, and refreshes its preview after stopping changes the history.
Confirmed mutations cannot be retried merely because a later UI refresh failed. The agent picker
now lists real detected agents beside separate model and effort controls; changing agents opens the
same review flow. No hidden model call summarizes the conversation.

A pending handoff has a read-only Rust API and remains visibly inspectable above the composer after
reopening a chat. Sending waits until its saved handoff can be read; a failure has an explicit retry.
Core all-target compilation passes. A focused Chromium flow passed fork preview/confirmation, the
persistent visible handoff and selected-file revert, with zero browser errors and zero accessibility
violations in the continuation dialog. The complete browser/native verification and new bindings
remain pending. No remote CI, push or paid-agent call.

Cloudflare Email Sending now owns the auracode.si sender domain and reports its automatically
provisioned SPF, DKIM, DMARC and return-path DNS as ready. No email was sent; delivery and Workers
plan eligibility still need qualification. Continuation preview refreshes now discard superseded
async responses when the dialog changes intent or closes. The synthetic preview session status is
explicitly typed for transitions after stopping. Both changes join the combined verification batch.
### M3 setup persistence foundation, 2026-10-26

- Added a profile-owned Rust setup store for step, motion, first project and completion. Atomic
  writes precede acknowledgments; revisions reject stale views, and failed writes keep memory
  unchanged. Damaged preferences are preserved; future-version preferences are not overwritten.
- Desktop commands lazily load the store only while this process owns the profile. No agent
  commands, account requests or credential reads are part of this path. Bindings are generated.
- Four focused persistence tests and desktop binding export pass on Windows. Core and desktop
  library Clippy pass. M3 interface and native platform acceptance remain in progress.

### M3 dark setup and Agents interface, 2026-10-26

- Connected the real desktop to the Rust setup store, a skippable cold/warm intro, keyboard-driven
  mission checklist, passive native detection, motion preferences, existing project/folder commands,
  and an Agents screen with the existing explicit update/sign-in terminal controls. Notification
  navigation and smoke/stress launches bypass setup. Missing agents link to checked official guides.
- Shared the actual Orbit globe between product and design reference; removed the lab onboarding's
  appearance selector and simulated account-success claim. Inspected the original Grok Console flow
  and rendered Chromium/WebKit screenshots. Narrow panes omit clipped globe labels.
- Chromium and WebKit checks pass for progression, stored motion/step, skip/restart, intro bypass and
  warm start, passive detection, no-agent demo, accessibility, and a failed setup write after project
  creation without duplicate creation on retry. Workspace typechecks, desktop build, shared UI 184
  tests, and Orbit 52 tests pass. Native core setup tests and desktop binding export passed earlier.
- Broader desktop Vitest reports five pre-existing old-base failures: TerminalSheet's SSR document
  assumption and four stale screen assertions. These untouched root-owned tests remain pending.
  M3 remains pending reviewed new-agent installation, native window/drop/terminal acceptance, final
  globe-to-dock polish and enabled account/clone flows. Details and sources: docs/onboarding.md.
## M7 client foundation

The isolated `aura-sync` crate now implements versioned XChaCha20-Poly1305 record/blob encryption,
X25519 + HKDF-SHA256 device key wrapping, independent recovery encryption/authentication derivation,
and a public-key-bound approval code. The exact byte conventions are in `docs/sync-crypto-v1.md`.
Record AAD includes routing identity, merge clock and deletion state; key envelopes bind account,
device, version and both public keys. Secrets use zeroizing containers and redacted Debug output.
Six focused local tests and all-target Clippy pass, including a synthetic deterministic wire vector,
cross-account/device/record substitution, malformed lengths, non-contributory keys and tampering.
This is the crypto foundation only. API transport, secure local key persistence, account profiles,
SQLCipher migration, sync scheduling/merging, approved config adapters, device UI and cross-platform
acceptance remain pending. No cloud mutation, account login, credential inspection or real config
read/write was performed.
# M7 desktop account transport foundation (2026-10-26)

- Added the Rust `/api/v1` client against cloud contract `7a95e6b`, with HTTPS origins, no redirects
  or hidden retries, sensitive bearer headers, bounded response bodies, static error messages,
  cooldowns, and strict sync cursor/device-clock checks. Server-provided private error text is never
  surfaced. Auth expiry is a distinct result so the sync coordinator can halt without deleting data.
- Eleven focused crypto and local fake-HTTP tests pass, including authoritative stale-write heads,
  global sequence gaps, duplicate writes, malformed tombstones, redirects and token expiry.
- Secure storage, durable sync state, encrypted account profiles, account UI and config adapters are
  still pending. No real auth, credential access, cloud mutation, deployment or paid call was run.

# M7 local secure-store foundation (2026-10-26)

- Added app-only native secret storage for Windows Credential Manager and macOS login Keychain,
  scoped by HTTPS service origin and account. Windows persistence is explicitly local. There is no
  credential enumeration, automatic plaintext fallback, or raw provider error output.
- Added an explicit passphrase store using Argon2id and XChaCha20-Poly1305, bounded files, exclusive
  locking, atomic replacement, and account-bound authenticated context. Wrong passphrases and damaged
  files preserve the existing ciphertext. Session and local key bundles can be replaced atomically.
- Fourteen focused crypto, local HTTP and vault tests pass; all-target Clippy passes. Native calls are
  tested through an in-memory provider and the fallback uses temporary files. No real keychain entry
  was read or changed. Native macOS execution, account state/IPC, SQLCipher profile integration and
  durable sync/config adapters remain pending.

# M7 account state and device trust foundation (2026-10-26)

- Added the Rust account owner with persisted private-key/session bundles, session verification,
  retained-device proof, explicit registration/recovery/approval, and a Ready-only sync gate. Expiry,
  revocation and sign-out halt live sync while retaining local keys. Cancelled queued vault writes
  cannot overwrite newer session removal, and replacement owners invalidate older network access.
- Found and fixed an active-service key-substitution gap: the recipient code alone cannot authenticate
  the origin of a sealed account key. New remote approvals require explicit full-fingerprint
  comparison with the trusted device. Initialization/recovery and later reconnects pin known keys.
- Twenty-five focused tests now cover crypto/server vectors, local HTTP, vaults, key substitution,
  lost registration replies, recovery, first-device setup, stale owners, sign-out storage failure,
  cancellation, expiry and revocation. All-target Clippy passes. One fake-server test bug on Windows
  was corrected by resetting accepted sockets to blocking mode; production HTTP code was unaffected.
- `docs/desktop-account-client.md` defines the root UI/actor seam and remaining integration gates.
  SQLCipher profiles, account IPC/UI, durable sync/merge/config adapters and macOS execution remain
  pending. No real sign-in, credential access, cloud mutation, deployment or paid prompt was run.

# M7 deterministic sync merge foundation (2026-10-26)

- Added fixed-width HLC parsing, monotonic local/received clocks, restart restoration, bounded future
  skew and overflow handling. API and encryption context validation share the same parser.
- Added per-field metadata LWW with independent object tombstones and explicit restoration. Identical
  clocks containing different edits fail visibly instead of discarding either value. Future schemas
  are reported as opaque records to retain, and payload clocks cannot outrun the encrypted envelope.
- Added the pure config Base/Local/Remote decision table, explicit tombstones, first-link union-only
  previews, and unavailable/skipped observations that never become uninstall requests. Text merging,
  append-only chat chunk union, actual adapters, previews/applies and rollback remain pending.
- Thirty-four focused aura-sync tests and all-target Clippy pass. Durable outbox/cursor transactions,
  SQLCipher account profiles and desktop integration are the next required work; no real config,
  credential store, cloud state or existing database was read or modified.

# M7 SQLCipher storage primitive (2026-10-26)

- Added an optional SQLCipher feature with a profile-specific derived key, byte-only key installation,
  disabled cipher logging, memory protection and schema validation. Wrong keys report a static error
  without repairing, replacing or converting the original database. The shared default rusqlite
  declaration remains unchanged, and unkeyed Local databases remain ordinary SQLite.
- All 37 focused aura-sync tests pass on Windows, including encrypted reopen, wrong-key preservation,
  plaintext preservation and keyed online backups retaining data and schema version. Feature-enabled
  all-target Clippy passes. Windows compilation used checksum-verified official portable Perl inside
  the ignored build directory for vendored OpenSSL, with no global installation or policy bypass.
- Core profile opening, backup/recovery key propagation, durable sync transactions and macOS runtime
  qualification remain pending. No existing profile or database was opened or changed by these tests.

# M7 encrypted profile opening (2026-10-26)

- Added the explicit `aura-core/account-sync` keyed Store open, retaining the profile key for integrity
  reads and encrypted pre-migration backups. Unkeyed Account opens fail before file access, while
  Local profiles keep their existing plaintext behavior. A bounded durable encryption marker also
  protects explicit path opens and builds without SQLCipher from plaintext corruption recovery.
- Wrong keys, damaged encrypted headers, unknown marker formats, missing initialized databases and
  newer schemas leave the original data untouched. Failed migrations roll back after an encrypted
  backup. Encrypted damage reports a recovery-required error; plaintext salvage is never attempted.
- Six focused Windows encrypted-store tests pass, including interrupted initial creation, WAL/data
  confidentiality, backup contents/version, wrong-key preservation and failed upgrade rollback.
  All 162 selected storage/chatstore regression tests pass with SQLCipher enabled. Feature-enabled
  and default all-target Clippy pass. No lint allowances were added to production code.
  Account session activation, attachment/checkpoint storage, backup restore UI, durable sync state and
  macOS runtime qualification remain pending. No existing profile was opened or modified.

## M4 worktree creation foundation

A separate Rust GitWorkspaces service now inspects repository state and prepares single-use isolation
previews. Apply verifies the source HEAD/index and repository identity again, journals Creating before
spawning Git, and creates a locked worktree on a new collision-safe aura branch outside the source.
Failures retain a RecoveryRequired record and the possibly created branch/path. The service does not
remove uncertain work or silently roll back. Non-repositories, detached HEAD, unborn branches, active
merge/rebase/cherry-pick/bisect and index locks return concrete reasons. Bounded NUL-delimited Git
status parsing preserves paths with spaces and rename sources. Read helpers disable optional index
locks and inherited Git redirects; explicit worktree operations disable hooks.

Six focused Windows tests and all-target core Clippy pass, using only owned temporary repositories.
The real Git creation test preserves staged index bytes, HEAD, unstaged CRLF bytes and untracked files.
The Git-for-Windows extended-path argument incompatibility was reproduced and fixed with regular
drive/UNC argument spelling while canonical identity checks remain in place. Bindings are generated
from the new DTOs. This service is not yet exposed to chat UI: relocation/native handoff, bringing
uncommitted changes, setup copies/commands, merge/PR/discard/recovery and macOS execution remain pending.
No agent prompt, login, real-repository mutation, push or CI dispatch ran. Protocol references are the
official [Git worktree](https://git-scm.com/docs/git-worktree) and
[Git status porcelain v2](https://git-scm.com/docs/git-status) documentation.

## Picker and integrated UI verification

The model/effort picker now uses the chosen Grok row treatment, native agent-supplied descriptions,
selection marks, effort ticks, and three keyboard-navigable columns. Cmd/Ctrl+. opens it, arrow keys
move between rows and columns, and numeric shortcuts choose available effort levels. Choice changes
retain the existing acknowledged/pending protocol. The synthetic fixture now exercises real option
transitions. Mobbin screens 5df7b658-498f-4145-b78d-0fe9d6460441 and
3025b711-877d-4927-8e9b-21076781be06 were inspected; light reference material does not introduce a
product theme. Dark remains the only product mode.

The combined desktop Vitest batch passed 304 tests and exposed five old-layout/server-render
failures. Those were fixed, and affected files pass their focused reruns. Chromium exercised picker
keyboard changes and found a visible-label mismatch; spacing and accessible names now agree, and
its focused accessibility rerun reports zero violations. The full browser run reached the picker
before that correction; remaining combined checks continue in the planned integration run. Core
all-target compilation passes with integrated onboarding, encrypted-profile seams and M4 service.
Windows/macOS generated bindings and native checks remain pending. No paid-agent prompt ran.

### Deliberate binding bootstrap and native CI coverage, 2026-10-26

- Added an explicit, default-off `refresh_bindings` workflow input. macOS generates exact bindings
  before frontend checks; Windows exports independently and a parity job compares the bytes.
  Normal and final runs still enforce committed binding drift. No binding types are handwritten.
- Enabled the existing mock-agent native stream/chat/reopen smoke on macOS as well as Windows,
  retained native smoke evidence, and enabled safe Claude spike unit tests on both current targets.
  Setup browser fixtures now run beside the Orbit fixtures. No workflow was dispatched.
- Seven isolated exporter-script cases, the actual Windows exporter in normal mode, Bash syntax,
  workflow pin/runner checks and instruction parity pass locally. Hosted macOS/Windows workflow
  execution and ShellCheck remain for the planned integration run. See docs/verification.md.

## Read-only context panel and first hosted integration

The resizable right panel now has Changes, Files, Plan and Session tabs and Cmd/Ctrl+J. Files shows
bounded project search and paths from loaded tool history, opens a read-only preview, and can add a
file mention to the durable composer without sending it. Rust refuses credential/Git-internal paths,
traversal, links at every relative component and special files. Reads are capped at 128 KiB with
nonblocking open; the UI displays at most 2,000 lines. Binary/encoding and missing-file outcomes are
explicit. The preview does not persist content. Plan and Session show agent-reported data and label
unreported usage instead of inventing values.

The focused file-boundary/text/binary regression passes on Windows. All three context tabs and the
file-to-draft interaction pass focused Chromium accessibility checks with zero violations. Dark
Files and Session screenshots were inspected. Bindings for the new file-preview command remain
pending generation. The combined browser script now includes these paths.

The first planned hosted Windows/macOS run is 40311937683 at 28554a1. A cache input expression was
rejected before jobs started and corrected. macOS then found a controlling-terminal ioctl argument
type mismatch, fixed locally in b05d45e with Apple's required unsigned-long conversion. That failure
blocked bootstrap binding generation and downstream frontend gates. Windows passed Clippy and is
still running tests. There has been one started integration run; fixes are being batched.
# M7 durable sync ledger (2026-10-26)

- Added migration0007 after the integrated continuation schema6. The encrypted account ledger pins
  its account/device/key identity and saves the HLC, outgoing records and application projection in
  one transaction. Pull pages authenticate before their projections and cursor commit together;
  failed pages, callback failures and invalid future clocks preserve prior durable state.
- Authoritative push heads merge against the latest local edit, so a delayed acknowledgement cannot
  erase newer offline changes. Per-field merges queue a new combined head. Unsupported authenticated
  revisions are retained before cursor advancement and prevent an older client overwriting that item.
- Seven focused ledger tests pass on Windows for rollback, restart, clock validation, in-flight edits,
  concurrent fields, identity substitution, explicit tombstones and future-schema retention.
  Encrypted v6 migration coverage and Clippy are checked with the commit. Project/chat writer
  integration, scheduling, chat/config codecs, encrypted external files, account UI and macOS
  qualification remain pending; this does not mark M7 complete.

Account databases now use `aura.encrypted.db` so a pre-M7 binary's old `aura.db` corruption recovery
cannot quarantine ciphertext. Local paths are unchanged. Legacy or multiple candidate account files
cause an explicit import/restore error before any account database is opened. Focused Windows tests
preserve both paths byte-for-byte in this case; no existing user profile was read or migrated.

## Windows npm maintenance path identity

The first integrated hosted Windows run exposed a mismatch between a PATH shim's lexical parent
and the package entry's canonical directory. Maintenance now canonicalizes the launch parent before
comparing the global npm prefix, covering Windows short directory names and other path aliases.
The deterministic temporary-directory regression also confirms that a project-local node_modules/.bin
still cannot become a global npm update. This changes path metadata checks only; no actual npm update,
agent prompt, credential access or CI dispatch is part of the fix.

## M4 guarded merge and retirement checkpoint

The worktree service now prepares merges with Git merge-tree and reports conflict paths without
changing either working tree. Apply requires clean source and target state and retains both previous
and prepared commits under recovery refs before changing files. A HEAD lock protects the two-tree
checkout; the branch update compares its expected old commit. A failed checkout or ref update keeps
the prepared commit and an explicit RecoveryRequired journal entry instead of resetting user work.
Git helpers request fsync for durable objects and refs. Discard moves only a validated app-owned,
non-link worktree into the profile's retained directory through Git worktree move. All ignored and
uncommitted bytes, and the branch, remain recoverable; it never recursively deletes the folder.

SessionManager wrappers reserve canonical source/worktree folders and affected chat actors. Live,
starting, retiring, paused-saving and held-queue states refuse mutation. An owned task retains those
reservations after an IPC caller disconnects and releases them only after the operation has finished
journaling. Production receives the optional GitWorkspaces dependency; isolated protocol fixtures
leave it disabled. The native updater's idle admission must also count these folder reservations.

All 305 core unit tests pass on Windows. The nine owned-repository tests also passed after recovery
ref durability was added, and two actor tests cover held queues, live agents and release of the start
guard. Core/CLI all-target Clippy passes. Generated desktop bindings cover action/result DTOs. Root UI
integration and independent merge-race review remain pending, as do relocation, native cwd handoff,
bringing uncommitted files, explicit setup, PR creation, recovery controls and macOS execution. This
is a backend checkpoint, not M4 completion. No real-repository mutation, paid prompt, push or CI ran.
### M5 installer targets and build-path privacy, 2026-10-26

- The manual unsigned Build workflow now names universal macOS DMG and Windows x64/arm64 NSIS
  targets, installs their Rust targets, checks committed bindings first, and labels artifacts as
  unsigned acceptance builds. It neither publishes a release nor changes platform security policy.
- The bundle wrapper remaps checkout, home, Cargo and toolchain paths using encoded Rust arguments.
  Three focused build-environment tests cover Windows spaces, existing flags and malformed roots;
  they pass alongside Biome, workflow pin checks and instruction parity.
- Cross-platform bundling, native installer acceptance, signing, update service and release
  publication remain pending. No build or CI dispatch was started. See docs/releases.md.

### Update admission barriers, 2026-10-26

- Added reversible core admission guards for an idle session manager and empty terminal service.
  Live or starting agents and owned folder mutations prevent quiescence; once admitted, new agent
  starts, folder mutations and terminal reservations are refused until the guard drops. Draft
  persistence remains available for the final flush. Permanent terminal shutdown stays permanent.
- Three focused tests cover folder/agent exclusion, a concurrent start race, terminal reservations
  and permanent shutdown; core library Clippy passes. The updater will use these guards before
  invoking any installer. No installer, credentials or real agent ran.

### M5 explicit signed update service, 2026-10-26

- Added Rust-only check/download/install commands using pinned Tauri updater 2.14.0. Metadata and
  package reads are bounded and restricted to the release HTTPS origin without redirects; package
  signatures must bind the advertised newer version. Unsigned builds remain visibly disabled.
- Installation uses reversible idle barriers, refuses failed draft/storage saves, and confirms
  cleanup before Windows can exit through NSIS or macOS can restart. Vendor updater tasks now hold
  admission through completion, including when their IPC caller disappears. No active work is
  canceled to install an application update.
- Five updater tests, a signed-version/IPC-permission regression, the vendor-maintenance admission
  regression, exact binding export and core/desktop Clippy pass on Windows. An earlier `cargo check`
  build-script hash was blocked by Application Control; normal test and Clippy builds subsequently
  passed without a workaround or policy change. No actual update, sign-in or network probe ran.
- Added explicit signed-updater build configuration that requires supplied signing material. Keys,
  platform signing, release publication, native upgrade/signature acceptance and interface wiring
  remain pending. The bootstrap run is still not final verification.

### Optional encrypted-storage integration gates, 2026-10-26

- Added an explicit `encrypted_storage` workflow input for Windows/macOS SQLCipher client tests,
  encrypted core store and sync ledger tests, plus feature-enabled Clippy. Commands and prerequisites
  were coordinated with the M7 owner. Final verification must enable this gate.
- Windows selects only an installed native Perl for vendored OpenSSL and fails if unavailable.
  No tool installation, credentials, keychain reads or CI dispatch were performed here. Workflow
  pin/runner checks and instruction parity pass; hosted feature-matrix execution remains pending.
- Matched root's workflow correction by removing `save-if` from the Rust cache action. GitHub does
  not permit the earlier status function in that action input. The cancellation safeguard remains.
The local external-file codec now provides bounded chunked authenticated encryption, purpose/object
binding, opaque keyed filenames, authenticated lengths and range reads without plaintext temporary
files. Five focused tests cover chunk boundaries, empty files, nonce carry, substitution, truncation
and reordered chunks. Core file publication, attachment/dead-letter wiring and encrypted checkpoint
storage are still being connected; the codec alone does not enable account sessions.

The core encrypted object backend now uses capability-relative non-following reads, a bounded key-
and purpose-bound marker, owner-private temporary ciphertext, and atomic non-replacing publication.
Three focused Windows tests verify ciphertext-only files, reopening, duplicate validation, legacy/
wrong-key preservation, failed publication cleanup and corrupt-object rejection. Confirmed account
keys can be shared with the Rust writer without exposing them through IPC; nine account lifecycle
tests still pass, including no key handle before fingerprint confirmation and offline access after
sign-out. Caller wiring and macOS filesystem qualification remain pending.

## First integration findings and Git review interface, 2026-10-26

Hosted run 40311937683 completed at 28554a1. Windows passed Clippy, binding export, the process
spike and stream smoke. Its full test run exposed the Windows npm-prefix alias mismatch, outdated
native image capability expectations and demo checkpoint admission fixtures/behavior. The chat
smoke reached its first explicit permission before its old transcript-only selector timed out.
The dock now retains the request's segment identity and the DOM reader finds its actual controls.
macOS failed at the ioctl type mismatch already fixed locally. Remaining native paths still need
the batched rerun; neither platform's overall gate is complete.

The complete Orbit Chromium and WebKit browser suites now pass, including the docked-request
association, Files/Plan/Session, picker choices, accessibility, large history and long single-turn
virtualization, focus, disclosure retention and dark-only rendering under both OS color schemes.
The agent dock's accessible name includes its visible initials. Context-panel launch explicitly
focuses its button so WebKit can restore focus after closing. Programmatic test scrolls issue the
same reader-intent wheel event as a real upward gesture before changing virtualized scroll offset.

The dark Git dialog presents repository branch/commit/files, isolation and merge previews, conflict
paths, retirement and recovery/restoration reviews. Apply consumes the displayed Rust token and
refreshes state even after a rejected or uncertain reply. Chromium/WebKit fixture tests passed
stopped-session gating, no mutation before confirmation, merge conflict refusal, stale-review
failure and retained-worktree restoration. Screenshots and Axe checks passed. Production isolation
remains hidden until chat relocation is connected; backend command integration and exact generated
bindings are still pending. This is a local implementation checkpoint, not M4 completion.

## Dark settings and explicit update controls, 2026-10-26

The settings control and Cmd/Ctrl+, now open a dark settings surface using the Orbit layout and
Grok's list treatment. General exposes the existing Rust motion preference with revision-checked
saves and failure recovery, setup replay and the guarded local-data-folder action. Shortcuts lists
the actual implemented keys. About shows the running version and Rust updater status, download,
release notes and an explicit install confirmation. Opening settings performs no update request.
The UI reports unsigned builds and waits for active work instead of suggesting an update installed.

The chat stays mounted while settings is open, preserving its selection and draft. Hidden chat
keyboard handlers are disabled. Chromium and WebKit checks passed preference-save failure,
keyboard focus, no automatic update calls, the separate install confirmation, idle refusal and
unsigned-build behavior. Axe reported no violations on General, Shortcuts and About. Real
screenshots were inspected. Typechecking still awaits exact integrated binding generation; its
remaining errors name pre-existing missing generated commands/types. No CI dispatch was added.


The merge review found that current Git's read-tree overwrites ignored collisions. Merge application
now uses native fast-forward merge with no-overwrite-ignore against the already prepared two-parent
commit. Native checkout protects ignored files, Git compares the old ref, and automatic stashing is
disabled. The app no longer creates its own HEAD.lock. It verifies symbolic branch identity, HEAD,
index and working-tree state afterward, then checks for changes during final verification. A changed
target follows RecoveryRequired with both durable refs retained. All eleven focused Windows Git tests
pass, including ignored/untracked collisions, branch switching and newly staged changes. An earlier
test launch was blocked by Application Control; a normal rebuild after the fix allowed execution.
No security controls were changed. Source evidence is Git 2.54
[read-tree](https://github.com/git/git/blob/v2.54.0/builtin/read-tree.c) and
[native merge](https://github.com/git/git/blob/v2.54.0/builtin/merge.c), plus the
[no-overwrite-ignore contract](https://git-scm.com/docs/git-merge).
Native drivers now accept an authoritative bounded attachment reader in session setup. Claude,
Codex, ACP and Pi retain their existing text payloads and resolve imported images in memory; reader
failures never fall back to plaintext disk files. Three focused payload tests and driver/core/CLI
all-target Clippy pass, including the account feature. The encrypted reader is ready for the
account writer, which is the next integration step. No real agent was invoked.

The first integrated Windows run exposed stale image-capability expectations from before composer
imports were implemented. The Codex handshake assertion and 25 Claude/Codex replay goldens now
expect the supported image payload path. Reviewed golden changes are only `images: false` to
`images: true`; the focused handshake and all three replay gates pass locally without updating
goldens during verification. Recorded wire inputs and ACP goldens are unchanged.

Account writer file routing now covers composer imports, native attachment reads, tool output pages
and streamed encrypted recovery journals. The ordinary writer entry rejects Account profiles, and
account agent spawns disable raw protocol logs while retaining their unique spawn identity. Eleven
focused Windows tests pass for reopening, ciphertext-only storage, Unicode range boundaries,
corrupt-page rejection, poisoned writes, partial journals and owned spawn logging. Default and
account-feature core all-target Clippy pass. No real profile or credential store was accessed.
Encrypted checkpoints, recovery UI, ledger projection/scheduling and account readiness remain
pending; production account sessions must wait for that remaining wiring.


## Hosted demo-agent regression fixes

The first combined Windows run exposed an outdated empty-PATH desktop fixture after checkpoints
became mandatory. It now keeps agent detection on an empty PATH and gives only the checkpoint helper
a fixed Git directory with a fixture HOME. The prompt acknowledgment correctly describes its wait
for checkpoint capture. A separate core defect treated a legacy driver's background permission as
authoritative busy state when a checkpoint finished. Settlement now follows the same opt-in run-state
rules as normal dispatch; native background work still waits for idle. Five focused checkpoint tests
and all three real-startup desktop demo tests pass locally on Windows. The background test allows its
late event to arrive between turns or inside the next turn, while still proving untagged persistence
after the originating turn and permission survival. No real agent or login was invoked.

## M4 reviewed recovery controls

Managed worktrees now carry a typed operation journal in version 2 local metadata. Interrupted
creation, retirement and restore can be reconciled only after checking the owned path, repository,
branch and native worktree registration. Interrupted merge reconciliation additionally requires a
clean target at exactly its retained before or prepared commit and unchanged recovery refs. Restore
moves a retained directory back to its original owned location, preserving ignored files and its
branch. Missing, ambiguous, redirected, foreign-locked or newer-version records remain unchanged with
a reason. No broad prune, lock deletion, automatic reset or recursive deletion is used.

The eight Git workspace Tauri commands are registered and generated bindings are committed. Recovery
tokens bind the chat, worktree, operation and reviewed state; the manager retains canonical folder and
actor reservations through an owned task even if IPC disconnects. Git diff verification now disables
automatic index refresh and examines a bounded patch, preserving index bytes even after stat-only file
changes. Fourteen Git tests, five checkpoint lifecycle tests and all three desktop demo integration
tests pass on Windows. Core, CLI and desktop all-target Clippy and binding export pass. macOS execution,
chat relocation, optional bring-changes/setup, PR creation and missing-directory recreation remain
pending. No remote CI, push, real-agent prompt or login ran for this checkpoint.
Encrypted checkpoints now capture and reopen exact file bytes and manifests without plaintext Git
objects or scratch copies. Empty temporary Git repositories retain the existing path/ignore policy;
account handoffs use an explicitly labeled byte summary. Explicit user-workspace reverts retain
their existing atomic recovery behavior. Fourteen focused checkpoint/session tests pass on Windows,
including encrypted capture/diff/reopen/revert, plain-constructor refusal, legacy preservation and
the existing user-index/race/interrupt gates. Default and account-feature core all-target Clippy
pass. The profile-wide audit identified M4's worktree registry as another content-bearing file that
needs encryption before Account activation. The sync writer projection, scheduler and account UI
are still pending.

