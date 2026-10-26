# Auracode implementation progress

## 2026-10-26: profile configuration transaction engine

Added a read-only managed-profile transition planner and a bounded transactional apply/restore
engine. It records each receipt ID before dispatch, verifies final selected content and preserves
unmanaged concurrent changes during inverse application. Five synthetic transaction regressions and
aura-config all-target Clippy pass. Encrypted transition storage, the root locator, startup admission
and actual profile publication/recovery integration are still pending. No real configuration or
agent process was accessed.

## 2026-10-26: managed configuration claim foundation

Added an encrypted, content-bound Account ownership store and explicit prepare/commit/cancel claim
functions. They preserve the first device baseline, retain unresolved acknowledgments and distinguish
committed management from ordinary sync heads. Account prepare/close now creates and invalidates the
dedicated store. Three pure claim regressions and aura-config all-target Clippy pass. The new encrypted
store test awaits native account-feature execution in the integrated environment. Profile filesystem
switching and typed crash recovery are still pending, as described in `docs/config-profile-transitions.md`.

## 2026-10-26: explicit vendor integration reviews

Added personal Claude plugin/marketplace, Codex plugin/marketplace and Pi package command planning,
an explicit Library form and an owned terminal flow. Starts consume a ten-minute page/profile token
and recheck executable bytes, config realm and selected public declarations. The terminal retains
profile, mutation and quit/update maintenance guards through confirmed cleanup. Unsupported vendor
commands and private/ambiguous targets remain explicit errors. See `docs/vendor-integrations.md`.
Three synthetic planner tests, agent all-target Clippy, generated protocol DTO export and three
frontend tests passed. Chromium and WebKit fixtures verified separate review and explicit Start,
terminal cancellation and accessible dark forms. Full native compilation/test execution remains
pending where Application Control blocks dependency build scripts. Existing steering-event frontend
type errors are outside this checkpoint. No real integrations, credentials, vendor prompts,
remote CI or deployment ran.

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


## M8 bounded configuration inventory

The new Rust aura-config crate inventories approved Claude/Codex/Pi roots and one shared skills
source. It selects only instruction, skill, MCP and plugin/package declarations. Credential files,
vendor synced content, caches, sessions and trust/account sections stay outside the inventory.
Capability-relative no-follow reads bound file size, tree depth, file count and aggregate size;
skill revisions include companion files. Malformed content reports a sanitized error without a
parser excerpt. MCP entries with authentication, unknown options or incompatible transport remain
visible with values hidden and an explicit copy restriction. Plugin declarations expose no userConfig.

This is the first M8 checkpoint, with source evidence and remaining work in docs/config-library.md.
Copy/apply/rollback and the desktop Library are still being implemented. Development uses only
temporary synthetic configuration fixtures, with no real credential/config reads, agent processes,
pushes or CI dispatches.

The next M8 checkpoint adds instruction/skill copy previews, durable per-operation journals and
restart-safe rollback. Both source and destination revisions are checked, directory handles remain
bound through apply, and hard-link publication refuses a concurrent new target. Independent original
snapshots remain available even if an editor retains an old file handle. Rollback refuses later edits
and deletions while recognizing interrupted publication. Complete skill bundles preserve binary
assets and execution bits; unrelated target files remain untouched. Fourteen Windows fixture tests
and aura-config all-target Clippy pass. macOS execution, scoped MCP/plugin mutation and Library UI
remain pending. All copies and recovery checks used temporary synthetic files only.

## M4 visible chat relocation

Moving a stopped chat into its managed worktree, or back to its source folder, now has a bounded
preview of the exact folder change and visible conversation handoff. Apply consumes a one-use token,
rechecks worktree ownership and conversation state, and reserves both canonical folders plus other
affected chat actors. The chat folder and pending handoff are saved in one transaction. Earlier
messages and native sessions remain intact. Applying the move sends no prompt; the next user prompt
starts a fresh native session with the reviewed handoff. Returning keeps the isolated directory and
its files. Cross-folder native resume remains unqualified and is not advertised.

All 313 core tests pass on Windows. The new actor regressions cover preserved history, exact deferred
handoff, fresh-session enforcement even when resume is supported, return to source, one-use tokens,
live destinations and changed conversations. Core, CLI and desktop all-target Clippy and binding
export pass. No migration is needed. The relocation Tauri commands and generated DTOs are included
for frontend integration. Optional bring-changes/setup, PR creation, missing
worktree recreation and macOS execution remain pending. No remote CI, push, agent prompt or login ran.
The integrated M4 ownership/recovery registry and setup preferences now have explicit encrypted
Account backends. Mutable records authenticate existing ciphertext before atomic replacement, retain
corrupt/future versions and refuse plaintext fallback. Twenty-four focused Windows tests pass,
including M4 create/retire/merge/recovery behavior, keyed registry reopening and setup revision/error
behavior. Default and account-feature core all-target Clippy pass. The activation audit is recorded
in `docs/account-storage-audit.md`; production profile switching, sync scheduling and IPC remain next.

## Integrated folder movement interface

The Git dialog now exposes separate workspace creation and chat relocation. Each move shows the
exact current folder, destination and visible handoff before a one-use confirmation. Returning to
the project folder preserves the isolated worktree. The interface refreshes chat state after an
uncertain IPC outcome and prevents dismissal during an owned operation. Chromium and WebKit
review-flow checks pass, including stopping a live session, both move directions, stale reviews,
merge conflicts, retirement/restoration and accessibility. Exact integrated binding regeneration
and native macOS/Windows execution are part of the second combined checkpoint, still pending.

## Native quit waits for owned file and vendor work

Normal quit acquires an admission guard before waiting for owned Git/configuration mutations and
vendor updates. It blocks new starts and mutations while existing owners finish, retains the guard
through session/store closure and reopens admission on a cancelled quit. If owned work has not
finished within five seconds, the window and database stay open with a visible message. The user
can retry after the operation ends. There is no forced-discard shortcut for this preflight.
Application update cleanup delegates the same guard. Forced OS termination relies on the durable
operation journal. Eight desktop quit tests, the core admission/drain regression and core/desktop
Clippy pass on Windows. No real vendor maintenance or native prompts ran.

## Cloud acceptance preparation

The compiled Rust Worker passes twelve isolated runtime cases. New cases exercise Turnstile
hostname/action/replay rejection, provider outage, failed email delivery and cooldown, secure cookie
issuance, immediate account revocation and scheduled cleanup including a late ciphertext upload.
Provider non-success HTTP status now fails before accepting its JSON. All network responses and
email failure are synthetic; actual delivery acceptance remains pending.

An isolated US-jurisdiction `auracode-preview` D1 and private `auracode-preview-blobs` R2 bucket are
provisioned. The R2 public managed domain is disabled and no custom domains exist. Preview Wrangler
configuration points only at those resources. Backup/migrations, secrets, widget, deployment and
public account acceptance remain pending. Local Wrangler is unauthenticated. The production build
dry run succeeds, but neither environment has been deployed. The combined CI workflow now includes
the compiled Worker runtime and site build, and its encrypted gate covers the full core library.


## M4 bring uncommitted changes

Isolation can now bring reviewed working-file contents, deletions, renames and nonignored untracked
files into the new checkout as unstaged changes. The source files, HEAD and exact index bytes remain
unchanged, including mixed staged and unstaged edits. Previews hash bounded file contents in addition
to Git status, so an edit that keeps the same status label still invalidates Apply. Protected agent
configuration, credentials, links, special files and files over 10 MiB are excluded with bounded
warnings. The total copy is limited to 100 MiB and 5,000 paths. Ignored setup files remain separate.

File publication shares the checkpoint no-follow and recovery-preserving implementation. A changed
destination fails before copying; a publication failure retains original and replacement files in
the new checkout and records RecoveryRequired. Successful cleanup removes only this operation's exact
temporary files. A Windows directory-handle cleanup failure was reproduced and fixed by closing the
owned handle before removal. Git state is checked again afterward. Seventeen Git tests and thirteen
checkpoint tests pass on Windows, including exact CRLF/binary bytes, staged rename/deletion, protected
exclusions and concurrent source/destination edits. The final copy checks and core/CLI/desktop
all-target Clippy pass. DTOs are unchanged. Setup, PR creation and remaining M4 acceptance stay pending;
no remote CI, push or real-agent work ran.

A follow-up review added configured provider-root and app-profile exclusions to bringing changes.
Custom CLAUDE_CONFIG_DIR, CODEX_HOME and PI_CODING_AGENT_DIR locations are resolved and bound into the
source snapshot before file contents are read, even when their filenames look ordinary. Known home
configuration locations are protected too. An owned temporary fixture verifies exclusion and rejects
using a protected root itself as a source. The focused regression and current Git suite pass on
Windows after a normal rebuild; the earlier test executable had been blocked by Application Control.
Core, CLI and desktop all-target Clippy pass. No policy or security setting was changed.

The PR helper foundation now accepts at most 1 MiB of stdin and closes it after writing, keeping
reviewed bodies out of process arguments and temporary files. It preserves owned-tree cleanup,
concurrent bounded output draining and timeout/cancellation behavior. Successful pipe delivery does
not prove the helper consumed the bytes; the caller still validates its result. All eleven Windows
helper tests and process all-target Clippy pass, including complete multiline input, blocked input,
size rejection and existing descendant cleanup. No real GitHub or repository mutation ran.

### M8 owned Library command layer, 2026-10-26

- Added approved environment/project root resolution, serialized one-use copy commands and durable
  recovery history. Changes retain core maintenance ownership through journal completion even if
  the webview caller disappears. At most four preparations retain source bytes and directory handles.
- Sixteen pure configuration tests and the root-resolution fixture pass, with core/config all-target
  Clippy. The independent Specta DTO export is deterministic and requires no desktop runtime.
- Full desktop compilation/export remains pending because Application Control blocked an existing
  Tauri plugin build script. No bypass, real agent configuration read, native prompt or CI run occurred.
  Library presentation and broader MCP/config conversion acceptance remain in progress.

### M8 Library presentation checkpoint, 2026-10-26

- Added the dark standalone Library screen with project/source and agent filters, literal item
  previews, before/after copy review, explicit apply, and retained-copy recovery. No route edits
  overlap root's App/Settings work. Its seven-command transport uses generated Rust DTOs.
- Chromium and WebKit synthetic checks pass for no mutation on mount, HTML escaping, review/cancel,
  explicit copy and restore, stale apply rejection and cancellation of late abandoned preparations.
  Both inspection and review pass axe; the actual screenshots were inspected against the current
  dark Orbit frame and visual-language rules. The exact Harvey URL redirected to signup, so no new
  reference login was attempted; connected Mobbin returned related Harvey imagery instead.
- Focused Library TypeScript and Biome checks pass. Full app typechecking remains pending the
  planned native binding refresh for preexisting conversation/search DTO changes. MCP/plugin apply
  and broader Library acceptance continue; M8 is not complete.
The account coordinator and fifteen typed desktop commands now cover explicit email proof, device
registration/approval/revocation, recovery setup, local fingerprint confirmation and sign-out. No
bearer or private key reaches IPC. A separate bounded app-owned vault index binds opaque Account
profiles to the canonical data root and origin, with an exclusive empty operational lock. Local
restoration requires no network, and profile preparation leaves the active pointer unchanged. The
service origin is compile-time restricted to production or preview; `account_config` pairs the
Turnstile frame with that environment. Eight core coordinator tests, the device-list/revocation
regression, and core/desktop all-target Clippy pass on Windows. Desktop binding generation is blocked by Windows
Application Control on the `selectors` build script, without a workaround. Guarded profile runtime
activation, writer projection and sync scheduling remain pending. No real sign-in or credential
access was used during development.

## Second integration corrections

The second deliberate CI batch passed the compiled Worker checks, frontend checks, both browser
engines and the complete macOS native chat smoke. Its two encrypted Windows/macOS core failures were
stale future-schema fixtures that still used the now-current schema number. Those fixtures now use
the current version plus one and preserve their refusal/no-quarantine assertions. Tokio's Unix PTY
registration now explicitly states and satisfies descriptor ownership for its replacement API.
Historical Linux spike results remain historical, while current runner documentation names the
actual Windows spike job. CI helper contracts now require manual dispatch, and ShellCheck installation
also runs after another independent check fails. All 33 spike-document checks and workflow lint pass
locally; the full shell suite needs jq, which this local shell does not have. Native Perl selection
is shared by encrypted, ordinary desktop and installer builds now that account storage is enabled.
The exact second-batch binding artifact is recorded; subsequent Library/account commands still need
the final combined native export. Remaining native/platform gates are not marked complete.
The pure aura-protocol Account DTO exporter now passes and generated TypeScript is committed for
the Account UI's thin invoke transport. It retains the Rust serde names and bounds timestamps to
JSON numbers. This does not change or substitute for the blocked full Tauri command export gate.

## M4 reviewed pull request publication

The worktree PR preview now shows the repository, committed head, base, diff summary, exact title/body
and whether the branch will be published. Apply consumes that review once and rechecks local state,
origin and remote branch/base state while holding folder/actor reservations in an owned task. A new
remote branch uses an explicitly empty expected ref lease, which only creates a missing branch.
An existing remote branch must already equal the reviewed commit. No local files are committed, no
existing remote history is replaced, and an existing matching open PR is reused without editing it.

GitHub CLI receives an explicit repository/head/base and the body through bounded stdin. The explicit
head disables implicit pushing/forking; the created PR is normal, with maintainer edits disabled.
Missing CLI, sign-in/access failures and uncertain network outcomes have actionable errors; an
unconfirmed final head after creation returns the PR URL with a warning. GitHub.com origin remotes
are supported initially. Five focused publication tests pass on Windows with a fake GitHub service
and a real owned temporary bare Git repository. The full current Git suite has 23 passing tests;
core/CLI/desktop all-target Clippy and exact binding export pass. Native GitHub publishing, macOS
execution, setup and remaining M4 acceptance are pending. No real remote mutation or agent call ran.
The native behavior follows the official [GitHub PR create](https://cli.github.com/manual/gh_pr_create)
and [Git push lease](https://git-scm.com/docs/git-push) contracts.

## Account setup and remaining dark surfaces

Settings now includes the real Rust account command transport, email/code flow, recovery-key
acknowledgment, device approval and revocation, fingerprint comparison and sign-out. Transient proofs,
codes and recovery text are never persisted by the frontend. Account activation and sync scheduling
remain separate pending work, with inactive state shown explicitly. Library navigation and project
folder selection are connected. Git isolation exposes reviewed uncommitted-file copying after the
configured credential-root exclusion fix. Diagnostics and startup errors now use Orbit typography,
solid dark surfaces and marks; obsolete milestone copy and placeholder navigation are removed.
The dark-only rule is also explicit in both byte-identical root instruction files.

The production verification page and desktop frame enforce exact origins, source windows and a
fresh attempt nonce. The website keeps hashed script CSP and permits framing only on that route.
The native page gains only exact verification-frame sources, with no remote command capabilities.
Pinned Wry's macOS navigation handler covers child frames, so its narrow verification-document
allowlist now covers the hosted page and Cloudflare challenge documents without making them trusted
app origins. Native/live-widget acceptance remains pending: the local test build was blocked by
Application Control on Specta's build script. No bypass was attempted.

Chromium and WebKit checks pass for invalid sign-in codes, recovery-key acknowledgment, fingerprint
confirmation, mismatched recipient codes, revocation, sign-out, verification origin/window/nonce
rejection, empty browser storage and accessibility. The combined Settings/Git/verification/account
browser batch, desktop typecheck, website static checks and Biome pass locally. The second hosted
integration also passed Windows native chat smoke and cross-platform generated binding parity.
The newer account/Library command set still needs the final combined native binding export.

### M8 per-entry MCP copy and recovery, 2026-10-26

- Added scoped JSON/TOML MCP edits with reviewed stdio/HTTP conversion, required Claude transport
  type, duplicate-key rejection and refusal of selected credential/unknown fields. Other servers,
  project trust and private settings never enter a preview or lasting recovery receipt.
- Full-document private transaction files remain in the original config realm only while the
  publication is unfinished. Checked publication retains uncertain originals; successful operations
  remove temporary documents. Persistent receipts keep only safe before/after entry values. Restore
  applies the inverse entry change to current configuration, preserving unrelated later edits.
- All 22 pure configuration tests and all-target Clippy pass. Added interruption coverage before
  moving the original, between move/publication and after publication, plus private-value exclusion,
  unrelated-edit preservation, stale rejection and Claude state-file tests. A first test executable
  was blocked by Application Control; the normal rebuild after substantive recovery edits passed
  without renaming, relocating or changing policy. No actual agent configuration was read or written.
- Chromium/WebKit tests now also cover MCP review and protected-entry rejection; focused TypeScript
  and Biome pass. Native desktop compilation, plugin installation/conversion and remaining Library
  acceptance stay pending. The Library back action is neutral for Settings integration.

## Reviewed GitHub publication interface

The Git dialog now prepares title, description and optional base, then displays the exact repository,
head commit, remote-branch action and diff summary before publication. Confirmation uses the Rust
one-use review; the resulting link is opened only by a separate user click. Chromium and WebKit pass
the complete create/move/recover/publish presentation path and accessibility checks with synthetic
commands, and desktop typechecking passes. No actual remote repository was changed by these tests.
The integrated native publisher has also received independent source review with no blocking finding.
MCP per-entry configuration copy/rollback passed a separate independent review before integration.
Production Orbit tokens are unconditionally dark; historical light values are scoped to the archived
Design Lab alone and cannot select a light appearance for the desktop or website.

## Encrypted configuration sync boundary

Schema 0009 adds the Account config merge-base store and encrypted blob transfer/reference queues.
Local profiles leave these tables empty. The fresh-schema and indexed-foreign-key regressions pass;
the config port implementation follows as a separate checkpoint. Setup remains device-local in
schema 0008, and schema 0010 is reserved for accepted steering-input persistence.

Added the Rust configuration port for account-bound encrypted snapshots, revision-checked publication,
explicit tombstones and per-device merge bases. Logical IDs and snapshot metadata must be encrypted by
the account runtime; no account key, token or vault handle enters the configuration crate. Oversized
items remain explicitly skipped, and partial applies retain their previous merge base. Migration 0009
is reserved for the account port's encrypted configuration storage. `cargo check -p aura-config` passes.
The merge, apply and desktop integration remain in progress.

### M3 explicit native installation checkpoint (2026-10-26)

- Added Rust-reviewed, version-pinned npm installation for missing native Claude, Codex and Pi.
  The review resolves Node and a validated npm package entry without reading or interpreting shell
  shims, vendor configuration or credentials. Start rechecks availability and the exact reviewed
  paths, argv and executable bytes. See `docs/setup-actions.md` for official sources and limits.
- Agents/onboarding now expose a separate review and Start installation action in the owned dark
  terminal. Mount/review cannot launch a process. Closing or page cancellation stops its process;
  Rust enforces a ten-minute lifetime even with no renderer polling. Installation and sign-in stay
  separate. A partial npm package is preserved for the vendor's next explicit attempt.
- Generated setup DTOs through the pure aura-protocol Specta exporter. Full native command binding
  refresh remains assigned to the final integrated Windows/macOS verification.
- Passed: installer recipe/replacement regression; setup DTO export; all-target aura-agents Clippy;
  complete desktop TypeScript; four existing terminal transport tests; Chromium and WebKit review,
  explicit-start, close cancellation, stale-review rejection and accessibility checks. Inspected
  the actual dark screenshots, including correcting terminal dialog centering.
- Native core tests and Clippy could not reach our code: Application Control blocked io-lifetimes'
  build-script-build with Windows error 4551 in this worktree. No bypass or binary relocation was
  attempted. A harmless local-process no-polling deadline regression is included for integration.
  No real installer, sign-in, model prompt, credentials, push or CI dispatch was run. Clone remains
  the next authorized implementation step, not complete.

### M9 snapshot and merge foundation

Configuration snapshots now carry validated provider-relative identities and explicit tombstones.
The pure merge preserves first-link additions, merges independent setting keys and text edits with
`diffy`, and leaves overlaps or edit/delete races unresolved for user review. It never writes conflict
markers. Missing heads and unavailable items wait. File, tree, field, scope and payload validation
reject unsafe paths, trust/credential fields and future schemas. Canonical encoding binds content to
its exact item. Thirteen focused Rust regressions pass; scanner, reviewed apply and UI are pending.
Guarded Account activation now prepares the keyed database, files, metadata and services before
publishing the active profile. It drains admitted commands, flushes pending writes and refuses
live agents, owned folder work or terminals. Failure preserves the current dataset and active
pointer. Startup can show a locked Account profile while restoring only auracode's local key;
Local stays available explicitly. Profile publication invalidates channels, native notification
generations and cached Library previews. A bounded no-follow audit preserves and refuses known
legacy plaintext locations. Unknown ACP fallback strings now log lengths only.

Seven focused native profile/generation tests, eleven existing desktop state tests, the core audit
regression and the writer flush regression pass on Windows. Core and desktop all-target Clippy pass.
An ordinary native build now permits the full command exporter, which passed and regenerated the
committed TypeScript without a policy workaround. Sync projection/scheduling, encrypted recovery
browsing and macOS runtime qualification remain pending; no real account login was performed.


### Profile switching interface

Settings now lists Local and remembered Account profiles and exposes explicit activation after device
approval. Switching freezes interaction, saves drafts, waits for native preparation and reloads the
whole webview after publication so old stores, promises and channels cannot leak into the new dataset.
Unsaved drafts and native refusal preserve the current page. Locked startup presents account unlock
and Local selection. Three frontend transition tests, complete TypeScript, and Chromium/WebKit picker,
unsaved-draft, active-work refusal, locked recovery and accessibility checks pass. Full native two-profile
interaction and real account-key restoration remain final qualification gates.

### M9 bounded discovery checkpoint

Added explicit user-root discovery for Claude, Codex, Pi and shared skills, with independent settings
key paths, binary skill dependencies, home-path normalization and platform scopes. Known credential
and trust fields are excluded. Protected MCP entries currently wait rather than exporting their secret
fields. Missing agents, malformed or duplicate-key documents, incomplete/protected bundles and read
failures cannot establish deletion. Empty settings containers never create overlapping parent items.
Aggregate discovery and each snapshot are bounded. All nine discovery and thirteen merge regressions
pass using temporary synthetic files. No real agent configuration was inspected or changed. Reviewed
application, secret-free MCP extraction and desktop orchestration remain pending.
### Owned cleanup confirmation retry (2026-10-26)

- Independent clone review identified that ProcessControl::shutdown deliberately shares its first
  report forever, including an unconfirmed result. Added retry_unconfirmed_shutdown as an explicit
  recovery seam: it joins pending or confirmed chains and replaces only a completed unconfirmed
  chain. Ordinary shutdown retains its original idempotent behavior.
- Passed all three focused control tests, including real Shared-future pending/unknown/leftover/
  confirmed states, plus all-target aura-process Clippy. No native or vendor processes were run.

### M3 owned GitHub clone checkpoint (2026-10-26)

- Implemented separate Rust clone review, start, cancellation, status and recovery history, plus the
  first-project dialog. Only bounded GitHub HTTPS/SSH repository URLs are accepted. The user picks
  a parent and a new portable name; atomic directory creation refuses every existing destination.
- Git runs with isolated configuration, no hooks/templates/custom filters/submodules or credential
  prompts, and strict SSH host verification. Public HTTPS and already-configured private SSH are
  explicit UI choices through the pasted URL. No GitHub CLI sign-in is attempted. Raw helper output
  is bounded, unlogged and classified without exposing it. Startup is limited to 15 seconds and
  cloning to ten minutes. Stop reaches owned processes only, retains folder reservations through
  confirmed cleanup, and uses the separately tested explicit shutdown-retry seam.
- Started/outcome records are flushed beside the selected destination, outside profile metadata.
  Interrupted and canceled partial files remain for inspection. No clone recovery action deletes
  files or reuses an existing target. A started receipt alone never proves target ownership: a
  collision before create can leave a receipt for an independently created path. Outcome is not
  exposed as Ready until its recovery record is durable.
- Added six focused Rust cases for strict URL/name validation, one-use/page ownership and canceled
  admission, existing-target refusal, interrupted/canceled recovery and bounded error redaction.
  These await integrated native execution because the existing io-lifetimes build script is blocked
  by Application Control 4551. The expanded pure protocol source compiled, but Application Control
  also blocked the rebuilt existing setup DTO exporter executable. No executable was relocated or
  changed to bypass policy, and bindings were not handwritten. Exact clone DTO generation and full
  TypeScript/native verification remain pending the authorized integrated export environment.
- Passed Biome plus Chromium and WebKit clone review/no-start, cancellation, ready-folder selection,
  existing-target refusal and accessibility checks. Existing onboarding persistence/demo/storage-
  retry browser checks passed on both engines. Inspected the actual dark clone review screenshot.
  Independent read-only review found the cached-shutdown report issue, fixed in 8567390, and no
  confirmed overwrite blocker. No real remote clone, installer, auth command, model prompt, push or
  CI dispatch was run. Clone source is reviewable; native/binding acceptance is still pending.
The Account writer now implements `ConfigSyncPort` for bounded encrypted snapshots and local
merge bases. Wire item IDs are derived with the account key; logical IDs, scope, content hashes
and revisions stay in authenticated payloads. Snapshot reads bind the exact item/head and verify
the content hash. Publication checks the current head and queues its encrypted blob atomically;
the head is ineligible for upload until the blob is acknowledged. Device-state writes check both
the previous base and an independent local revision, so concurrent skipped/device-only changes
cannot erase each other. Fifteen focused sync tests and core/sync all-target Clippy pass. Network
blob transfer, remote projection, the active desktop service and encrypted apply journal follow;
this storage checkpoint does not claim a completed sync session.

The Account writer can now bind its confirmed account/device key and seal project, portable folder
and chat metadata in the same transaction as each local edit. Per-field clocks retain untouched
values; tombstones remain explicit and local clock rollback does not discard edits. Folder paths,
setup recipes, native sessions, prompt queues and drafts are excluded. Embedded credentials and
local paths in Git remotes are not projected. Outbox SQL failures retain their SQLite error class
so disk-full and busy errors keep the writer's existing retry behavior.

All twelve focused sync/Account-writer tests and Account-feature all-target Clippy pass, including
transaction rollback, reopen durability, field clocks, privacy exclusion and Local refusal. This
is a storage checkpoint: desktop attachment, remote row projection, transcript chunks and network
scheduling remain pending. No network or agent call was made by these tests.
## M4 setup schema checkpoint, 2026-10-26

Schema 8 adds device-local worktree setup recipes keyed by folder and device in the profile database. Account profiles use the existing SQLCipher connection; the table is outside sync projection. It stores paths and explicit command arguments only, never copied file contents, terminal output or execution grants. Existing database migration backup behavior remains in use. The separate reviewed copy and terminal service is still being verified and is not a completed M4 acceptance claim.

## M4 reviewed worktree setup service, 2026-10-26

Setup settings now expose typed read/save, preview/apply and guarded terminal-start commands. Saved recipes remain inert. A review displays exact source and destination paths, file sizes and resolved executable arguments. It expires after ten minutes and can be consumed once. Apply checks app-owned worktree identity and Git repository ownership, refuses changed source bytes and existing destinations, and reports copied paths if publication stops partway through. Explicitly selected application environment files are supported; agent configuration, credential paths, keys, links and configured provider/profile roots remain excluded. Copies are limited to 32 files, 1 MiB each and 16 MiB total. Contents stay out of settings, previews and protocol logs.

Command start is a separate explicit action. The owned PTY keeps folder and actor reservations through shutdown, even if IPC or the window disappears. A ten-minute command deadline stops only the owned tree. Unconfirmed cleanup retains reservations and returns a recovery error. Command-only previews support rerunning installation without recopying existing files. Windows requires a native executable or an explicitly selected interpreter with arguments; shell shims are never silently expanded. No actual vendor, installation, network clone or paid agent command was executed during development.

Verification: six focused setup and terminal regressions passed on Windows. The storage run passed 73 tests; its one stale foreign-key-count assertion was updated for the new table and then passed separately. Core and desktop all-target Clippy passed with warnings denied, rustfmt and mirrored-instruction checks passed. The desktop TypeScript exporter compiled but Windows Application Control blocked its test executable with OS error 4551 before execution. Generated bindings remain unchanged pending the final integration export. macOS setup execution and the complete M4 product acceptance remain pending.

### Integrated setup and profile admission

The ordinary Windows native build and exact desktop command export now pass with the combined
installer, clone, worktree setup and Account profile commands. The pure setup DTO export also passes.
An integration review found and closed a clone-start gap: its native profile admission now stays owned
through asynchronous reservation, execution and cleanup. Profile publication cancels stale clone
reviews; worktree startup retains admission through terminal ownership. Boot subscribes to profile
publication before reading initial state, avoiding a lost startup-unlock event. Integrated Clippy is
pending because Windows Application Control blocked darling_macro loading with error 4551. No policy
change, artifact rename or alternate execution was attempted.

### Worktree setup interface

Owned worktrees now expose per-device setup recipes, explicit copy/command review, create-only file
application and the owned terminal's separate Start setup action. Saving or reviewing never runs the
command. Stale review failures retain source data, and partial copy results list completed files while
withholding the command grant. Chromium and WebKit pass review, no implicit launch, explicit start,
close cancellation, stale/partial recovery and accessibility checks. Screenshots were inspected. Full
TypeScript and eight profile/terminal frontend tests pass. Native source tests, macOS behavior and the
final combined CI remain pending.

### M9 encrypted apply journal contract

Added the profile-bound ConfigApplyJournal port with durable create, authenticated reads, compare-and-swap replacement, a bounded encrypted UUID index, and an 8 MiB receipt limit. Filesystem application and recovery remain in progress. The 44 existing aura-config tests pass against temporary synthetic files; no real configuration was read or changed.


### M9 reviewed orchestration

Added a paged read-only sync inventory and item-bound review of local, base, remote and merged content.
Explicit conflict choices and device-only flags retain per-device state with revision checks. Missing
blobs wait rather than becoming deletion or publication. Completion re-observes the local target and
refuses to advance its base after a failed or partial apply. Interrupted applications keep the prior
base and become explicitly skipped. Five orchestration regressions, pure sync DTO export and all-target
configuration Clippy passed. The final skipped-state helper and sixth regression compile, but Windows
Application Control blocked the updated test executable with 4551 before execution. No workaround was
attempted. Native service, recovery UI and automatic network attachment remain in progress.
### M9 reviewed filesystem apply and recovery

Implemented consuming, expiring configuration reviews, root identity and complete-content checks,
format-preserving JSON/TOML edits, home expansion, explicit per-device/vendor skips, and bounded
encrypted before/after receipts. No-clobber publication retains uncertain originals; temporary
publication files stay inside the original config realm and have verified crash cleanup. Restart
rollback preserves later unrelated settings, refuses selected user edits and has its own inverse
receipt. Tree deletes remove only empty directories. The full 64-test aura-config suite and all-target
Clippy pass on Windows, including 16 new apply/recovery regressions and four document-edit tests.
No real configuration was read or changed. macOS execution, the encrypted profile sink, desktop
orchestration and secret-free MCP projection remain integration work. See `docs/config-apply.md` for
the transient publication-file constraint and required host mutation guards.


### Account-bound configuration services

Account activation now verifies its sync ledger before publishing the profile and exposes a Rust-only
configuration service through the profile admission lease. Its port and encrypted apply journal are
bound to that writer/key. Local and locked profiles cannot obtain them; a failed target preparation
keeps the old service usable, and successful switching invalidates retained old handles. The journal
uses encrypted receipt objects and an encrypted UUID index, exact-byte retry after partial publication,
SHA-256 compare-and-swap replacement, fixed size/count limits, and fail-closed missing-index recovery.
No receipt or config content is persisted in plaintext.

Six focused native profile tests and three initial journal regressions passed on Windows. Core and
desktop all-target Clippy passed. The fourth missing-index regression compiled, but Windows Application
Control blocked the refreshed core test executable (4551); it remains pending execution in the final
qualified test batch. No policy workaround, credential access, network call or real config edit was
performed. Remote projection, blob transfer, transcript sync and scheduling remain in progress.
Follow-up checks also reject case-colliding remote filenames before review and verify that a file
created after durable receipt publication is never overwritten. All 18 apply integration tests and
all-target Clippy pass on Windows.


### M9 native review and recovery admission

- Added Account-profile-only inventory, expiring one-use reviews, apply, device-only controls and encrypted receipt history/rollback commands. Owned blocking work retains profile admission and the shared Library mutation guard through durable completion.
- Applications re-resolve trusted sources and provider availability; changed bindings are refused before a receipt or file mutation. Failed application retains the old merge base and a skipped marker, and unresolved recovery prevents another apply.
- Native Windows binding export passed. Focused configuration verification passed: 19 filesystem apply/recovery tests, 6 orchestration tests and exact DTO export. The broader product and platform acceptance remain pending; network delivery is still separate from local Account publication.
### M9 MCP public projection and local requirements

Added default-empty, bounded MCP `local_fields` metadata containing requirement names only. Discovery
exports supported public settings while leaving environment/header values and bearer-variable
references local. Merge preserves the union of existing requirements. Apply skips missing setup,
unknown fields and credential redirection, retains exact private JSON/TOML spans, and keeps later
local value rotations during rollback. Protected tombstones wait for explicit native removal.
Source evidence and the closed supported subset are documented in `docs/config-apply.md`.
All 75 aura-config tests and all-target Clippy pass on Windows, including five added MCP apply cases
and four metadata/merge regressions. No real configuration, environment secrets or vendor credential
stores were inspected. macOS and desktop/profile integration remain pending.

## Native steering driver checkpoint, 2026-10-26

The driver contract now distinguishes accepted, rejected and unconfirmed steering. Codex uses the committed 0.162.1 schema's native `expectedTurnId` precondition and correlates acknowledgements even after the selected turn settles. Stale local turns are rejected without sending, vendor restrictions remain effective, and malformed acknowledgements or timeouts stop the owned session with an unconfirmed outcome. Four focused fake-process regressions and driver all-target Clippy passed on Windows. The capability remains disabled until the durable actor and composer path is integrated. No paid prompt or live agent call was made.

Pi steering remains unsupported: pinned Pi 1.0.2 awaits asynchronous input handlers before adding steering to a queue and has no exact-turn precondition. Clearing that queue after settlement would also remove unrelated extension inputs. A local busy check therefore cannot meet the product's no-later-turn delivery guarantee. Other drivers explicitly reject the new command.

## Durable steering service checkpoint, 2026-10-26

Schema 10 retains explicit user steering parts and delivery outcomes in the profile database. `composer_steer` reuses validated composer attachments and requires the exact active turn. The actor saves a visible pending entry and typed parts before sending native control, then records accepted, rejected or unconfirmed delivery. Stop, turn settlement and IPC cancellation cannot redirect input into another turn. New prompts, restart, relocation and profile shutdown wait for the outstanding attempt. Sequence admission reserves enough space for split user text and its final status. Crash recovery never retries an uncertain message. Only accepted steering joins retry and visible handoff context; rejected or uncertain text remains visible in the source transcript.

Codex now advertises steering through this path. Pi and all other drivers keep the capability disabled. Six focused core regressions, 25 native Codex tests, two schema checks, 23 protocol tests, fresh-schema and foreign-key checks, and the committed replay suite passed locally on Windows. The new synthetic replay covers accepted and vendor-rejected steering. Core, driver and desktop all-target Clippy passed. Ordinary desktop compilation and exact TypeScript binding export passed. No paid prompts or vendor configuration access occurred. Frontend integration is still owned by the root worktree: its reducers and composer control must handle `steering_status` before product acceptance. This branch's pinned-pnpm typecheck reports those two pending exhaustive cases and older clone type reexports already fixed upstream. macOS and full milestone acceptance remain pending.

## Project default model startup, 2026-10-26

A fresh chat now loads its project's default model into the driver's existing desired startup options when the project default agent matches, or when no default agent is selected. An established agent session keeps its saved settings even after project defaults change. The same initialization is used when an explicitly confirmed continuation selects a fresh agent. No fake native identity or extra migration is created. Two regressions cover startup delivery, saved-setting precedence and provider separation. They compile, but Windows Application Control blocked the test executable with OS error 4551 before execution; that execution gate remains pending. Core all-target Clippy, rustfmt and mirrored-instruction checks passed. No paid or live vendor call was made.

### Authenticated remote metadata projection

Schema 11 adds a durable bounded-work projection queue for authenticated records whose project or
folder has not arrived yet. Cursor advancement and queued dependencies commit together. Portable
project/folder/chat fields merge into existing rows without manufacturing paths, native sessions or
queued inputs; remote deletes remain tombstones and retain local folder locations. Projection clears
its capture triggers so incoming changes are not echoed as fresh local edits. Config heads now accept
newer authenticated snapshots, retain newer unsent local revisions, and leave missing blobs unavailable
until transfer verifies them. Future config schemas remain retained rather than overwritten.

All 24 focused sync tests passed, including the previously blocked missing-index journal regression,
child-before-parent pages, per-field merge, tombstones, malformed-page rollback and config clock
collisions. Core all-target Clippy and the schema foreign-key/index check passed. This remains a storage
checkpoint: the network scheduler, blob transfer and transcript chunk import are not attached yet.

### Configuration sync interface and MCP integration

- Settings now includes Account-only configuration inventory, paginated items, device-only controls, explicit per-item merge choices, four-version review, confirmed removals and encrypted receipt recovery. Expired/stale one-use reviews require a new review; partial results show recovery instead of success.
- Both Chromium and WebKit pass the actual production component with synthetic responses: Local profile gating, no automatic apply, manual conflict choice, pagination, stale review, partial apply, explicit rollback, removal confirmation and accessibility. The dark Orbit review screenshot was inspected. Source formatting passes.
- MCP manual choices retain all present devices' local setup requirement names. Codex plugin and marketplace declarations require a native vendor workflow. Two added integration regressions compile, but Windows Application Control blocked this new executable with error 4551 before execution; these tests remain pending for qualified execution. No policy workaround was attempted.
### Bounded encrypted blob exchange

The Account writer now exposes typed transfer work independently of HTTP. It releases config heads
only after acknowledgement of the exact uploaded ciphertext, authenticates downloaded blobs against
the requested item/head/content hash, and saves blob availability transactionally. Transfer snapshots
bound uploads to one blob and downloads to four; queued requests have byte/batch limits. Replayed
acknowledgements are idempotent, and a mismatched or truncated download leaves the snapshot unavailable.
Both focused exchange regressions and core all-target Clippy pass on Windows. Network attachment and
compacted transcript transfer remain in progress; this checkpoint made no network requests.
## Steering interface checkpoint, 2026-10-26

The composer now offers an explicit Steer action only when the advertised capability, running status and exact open turn are available. Send retains its existing queue behavior. The chat store rejects stale or unsupported turns without a fallback send, permits one outstanding steering attempt, and keeps Stop available. Transcript messages retain pending, accepted, rejected or unconfirmed delivery outcomes across text deltas and late acknowledgements. An unresolved message in an ended or recovered turn displays delivery unconfirmed. Only an accepted acknowledgement clears a still-matching submitted draft; newer text or context is preserved. Rejected, uncertain and failed attempts are never retried automatically.

The transcript's repeated virtual rows now use named groups instead of duplicate Turn landmarks, correcting the accessibility failure exposed by multiple user messages in one turn. Eighty-three focused reducer, chat store and draft tests passed, along with desktop typecheck, Biome, instruction parity and diff checks. The new browser-only steering fixture passed Chromium and WebKit checks for unsupported and idle controls, exact turn targeting, delivery outcomes, preserved drafts, Stop and late acceptance, plus an axe accessibility scan. No agent or native command ran. Full integrated Windows/macOS acceptance and the earlier Application Control-blocked default-model test execution remain pending.

### Active Account sync worker

Account profiles now attach one Rust worker after successful publication. It coalesces initial,
turn-completion and requested focus triggers, polls every 60 seconds, transfers bounded encrypted
metadata/config batches and blobs, and respects offline/rate-limit backoff. Explicit account actions
suspend its owned in-flight request before changing authentication; revoked or expired authorization
pauses automatic requests. Profile replacement and quit stop the worker without discarding its outbox.
A profile-tagged public-status event and the existing AccountStatus.sync field expose its progress.
The native focus forwarding hook is available for root integration.

Core, sync and desktop all-target Clippy pass. Two keyed profiles exchanged config through a fake
network and the real writer; owned in-flight suspension/stop passed. A loopback HTTP regression passed
for a lost upload acknowledgement and rejection of substituted ciphertext. Two paused-clock tests
found a startup wake issue; the coalesced wake/priority fix and corrected timer-wheel boundary compile,
but Windows Application Control blocked the refreshed executable (4551), so their corrected runs remain
pending. No policy workaround or real account request was performed. Transcript chunks, concurrent
continuation markers, explicit Local import and remote-folder resolution remain pending M7 work.

### Preview deployment and live API checks

The preview D1 export was downloaded and verified before all three migrations were applied. The real Rust WASM Worker is deployed with preview-only data bindings, separate secret-store credentials and managed Turnstile widget, no workers.dev access, the same-origin API route and cleanup cron. Live health/configuration, missing-session and foreign-Origin checks passed. Production resources remain untouched. The website build is ready, but JWT-authenticated static asset upload returned Unauthorized after session registration; publication remains pending an authenticated supported upload path. Real email, browser challenge and signed-in multi-device acceptance are still pending. See infra/README.md for exact resource evidence.

### Sync status and focus integration

The main window now requests a coalesced native sync on focus. Profile-tagged status events refresh Account status and completed-cycle workspace, chat-list and configuration inventories; events from older profiles are ignored and listeners are released even when registration completes after navigation. Three focused listener ownership tests, integrated TypeScript and Biome pass. No account credentials reach the UI listener. Integrated native export and final platform checks remain pending the combined source batch.
## Portable project folder identity checkpoint, 2026-10-26

Creating a project or explicitly adding its folder now inspects bounded local Git metadata through the owned helper. Repository roots with a qualified credential-free origin retain portable remote identity and the locally recorded origin default branch. A feature branch is never guessed to be the default. Subfolders, non-Git folders, private agent roots and unqualified remotes remain local; unavailable inspection preserves existing identity. The helper does not fetch, authenticate or change the index. Re-adding a folder updates its existing ID, and moving a chat between projects while preserving its folder carries the portable metadata. Device paths remain exclusively in folder_locations. Existing folders can be qualified by explicitly adding them again; automatic cross-device location resolution is still pending in the sync milestone.

Four focused identity regressions passed on Windows, covering URL qualification, local-only fallbacks, unchanged Git index, stable folder IDs, project moves and missing foreign-device paths. Core all-target Clippy, rustfmt and instruction parity passed. Only owned temporary repositories were used. The two previously blocked project-default-model tests also executed successfully in an ordinary Cargo run, clearing that local execution gate. No vendor prompt, credentials access, network Git operation or CI dispatch occurred.

### Combined native command export

The ordinary Windows native build now compiles the integrated Account worker, steering, configuration reviews and vendor terminals. Exact Tauri binding export passes. Added the desktop's explicit UUID dependency for one-use vendor tokens and fixed the reported configuration Clippy style finding. Full milestone verification remains reserved for the final combined source batch.
## Reviewed fresh-session recovery checkpoint, 2026-10-26

Start fresh in the production header and error card now opens a visible continuation review. The new FreshSession action builds bounded context from the current agent's complete saved conversation, preserving the existing accepted-steering filter. Confirmation saves the exact handoff, retains source turns and archive state, and starts no agent or prompt. The next explicit message starts without the missing native ID and includes the reviewed context. Existing resume/retry controls keep their meaning, and no vendor stderr is guessed to trigger an automatic fallback.

All seven core continuation tests passed, including a failed native resume followed by reviewed recovery, archive preservation, same-chat history retention and exact next-message context. Fifty-one focused frontend tests, TypeScript checking, exact Windows binding export, Biome, instruction parity and diff checks passed. Chromium and WebKit verified both Start fresh entry points, cancellation, visible context, confirmation without a send, retained source text and the saved handoff, with an axe scan. Core-only all-target Clippy passed; the dependency-inclusive run exposed an inherited collapsible_if warning in aura-config/src/sync/review.rs, reported to its owner. Native live-agent and full Windows/macOS integrated acceptance remain pending. No paid prompt or real native session was used.

### Managed configuration automation and acknowledgment recovery
- Integrated encrypted ownership claims into every reviewed configuration application. A fresh
  explicit review can reconcile an uncertain claim while preserving its original device baseline.
- Successful Account exchanges process at most eight previously selected items per batch, under
  profile admission and the Library mutation lock. First-link, open reviews, device-only/skipped
  items, vendor declarations, conflicts and unfinished receipts remain manual. Unchanged bases
  do not generate writes. History restoration pauses automatic sync before changing files.
- Twenty-seven focused aura-config library/review tests pass, including the previously pending
  manual MCP requirements and Codex plugin regressions, automatic selection/base preservation,
  conflict exclusions and failed-acknowledgment recovery. Desktop TypeScript checking passes.
- Native all-target Clippy reached the changed configuration crate but Windows Application Control
  blocked darling_macro-b433f63937ec6736.dll with error 4551. No policy changes or bypass attempted;
  combined native qualification remains pending the final permitted Windows/macOS verification.

### Late steering and immutable history

Turn compaction now waits for an outstanding steering result, then includes its final saved visible
status before the turn can become immutable sync history. Compaction also advances the saved last
event sequence through that late outcome. A controlled driver regression ends its turn before replying
to steering and verifies both the incomplete and sealed states. That regression and core all-target
Clippy passed locally on Windows. No vendor call was performed.

### Bounded encrypted transcript transport

Schema 12 records each turn's parent and source agent without copying native session identities.
Completed, compacted turns are captured incrementally through the profile writer as one immutable
`chat_chunks` head pointing to a reverse chain of encrypted pieces, each at most 3 MiB. Raw event JSON,
typed prompt/steering parts and authenticated attachment ranges survive capture. Heavily escaped rows
use bounded fragments; progress and ciphertext commit together. An already missing attachment remains
explicitly unavailable. A head cannot leave the outbox until every referenced piece is uploaded.
Incoming pieces authenticate the account, turn and ordinal, reject head rewrites and ciphertext
substitution, and remain staged until session admission can safely publish them to visible history.

All 34 focused sync tests passed on Windows, including bounded restartable capture, unknown events,
image bytes, accepted steering, fragmentation, upload ordering and two-device encrypted transport.
This run also passed both scheduler clock/revocation tests previously blocked by Application Control.
The schema/index regression and core all-target Clippy passed. No policy workaround, vendor prompt or
real account request was used. Remote turn publication, open-view reconciliation, concurrent fork
markers, explicit Local import, folder resolution and Continue-here integration remain pending M7 work.

### Nested Library skills and duplicate provenance
Pi and shared portable skill collections now use bounded recursive discovery. Nested logical keys
remain distinct, duplicate previews explain the other sources and vendor-specific precedence, and
copying a nested skill reviews its normal direct target with the existing recovery journal. Fifteen
focused inventory/copy tests passed, including private-subtree exclusion, depth failure, duplicate
provenance and nested-copy rollback. Tests used temporary synthetic files only. No native vendor
configuration, credentials, network requests or CI jobs were involved in this verification.
## Windows/macOS release preparation and acceptance audit, 2026-10-26

The new Rust `aura-release` tool prepares a fresh local stage from four explicitly named artifact roles. It streams bounded files, verifies Tauri prehashed signatures and the signed app version, and emits deterministic updater metadata, website download data and SHA-256 checksums for the same copied bytes. It rejects incomplete target sets, unsafe filenames, input links, incorrect signatures, changed staged metadata and reused output directories. Failed stages remain marked incomplete. It never signs, uploads, deletes old stages, reads credentials or claims platform signing or architecture qualification. Its only committed key/signature material is a synthetic test fixture.

The desktop now has a compile-time stable/staging update channel. The endpoint and accepted package prefix are fixed for each channel, with crossing rejected. Staging builds identify themselves in Settings and startup version diagnostics; unknown channel values fail the build. The normal website catalog remains empty and unpublished. An explicit `AURACODE_RELEASE_STAGE` selects a locally verified stage at build time. Download links, architecture labels, version, notes and checksums are prerendered, including a visible staging label. Catalog types and desktop bindings were generated from Rust.

Nine release-tool tests passed on Windows, together with all six native updater tests, exact desktop binding export, release-tool and desktop Clippy, desktop/site typechecks, five build-environment tests and two static website tests. Chromium and WebKit passed a synthetic released-catalog build with JavaScript disabled, all three architecture links, checksums, escaped release notes, mobile overflow checks and rejection of a tampered stage. The rendered dark download page was inspected. The existing settings browser gate now includes explicit steering and reviewed missing-transcript recovery; both engines passed the complete gate, including staging labeling and accessibility. No hosted CI, push, paid prompt, signing operation, real installer, credential access or publication occurred.

`docs/releases.md` records exact final source checks, native smoke commands, target-specific bundle commands, the staged upgrade procedure and the required evidence. Signing identities, protected updater-key backup, the dedicated release route, actual architecture-specific installation and visible-desktop power/privacy checks remain external acceptance prerequisites. General project terminal/editor controls, reviewed non-Git initialization and extra-folder forwarding are tracked as remaining source work, not owner blockers. Native signed-release qualification and M2-M5 product acceptance remain pending.

### Device-local additional project folder context
Native Claude sessions now receive available additional project folders through their supported
add-dir arguments. Unsupported drivers receive only the primary folder, with an explicit notice.
A read-only command and chat-details view show the exact context passed to the live generation,
or the next-start preflight; paths never enter SessionUpdated events or encrypted transcript sync.
The live folder set stays fixed until restart. Missing device mappings, unavailable paths and bounded
scope limits remain visible. Isolated sessions exclude the original checkout, overlapping paths and
its Git repository family. All passed folders participate in mutation admission until owned cleanup.
ACP no longer advertises an additional-directories extension that its request adapter does not send.

Three focused core regressions passed, including actual setup forwarding through a synthetic driver,
current-generation stability, unsupported behavior and real temporary Git isolation. Two UI rendering
checks and desktop TypeScript checking passed. The ordinary combined Windows native command build and
exact binding export also passed. Source-only CSS specificity warnings remain unchanged; final full
Windows/macOS checks, native visuals and packaging acceptance remain pending. No real agent prompt or
user repository operation occurred.
# Account transition storage checkpoint

Added the strict nonsecret transaction locator with exclusive same-data-root lease and complete-file
publication, plus a dedicated encrypted transition store and per-transaction bounded apply journals.
Account close invalidates the stores and journal handles. Five pure transition regressions pass after
tightening phase validation. Native locator/store tests are added but could not run: Application
Control blocked num-traits and libsqlite3-sys build scripts with error 4551. Desktop switch and typed
startup recovery wiring remain pending; no real configuration, credentials or agents were accessed.

### Independent release verification trust
Release verification now requires the updater public key from trusted release configuration, instead
of accepting the mutable staged plan as its own trust anchor. The CLI and website build fail without
that independent pin. Artifact handles also refuse leaf links atomically during open. All ten release
regressions and all-target Clippy passed. Chromium and WebKit verified the synthetic download stage,
including all architecture links without JavaScript and rejection of changed staged bytes. No real
signing key, installer, publication or hosted CI job was involved.
Normal quit now also takes the existing profile-transition mutex before draining owned work, and
LiveAgents refuses a drain while an idle barrier is held. This prevents closing storage during a
profile switch or update preparation. The existing quiesce regression now asserts drain refusal;
native execution remains blocked by the dependency build-script policy failure described above.

The native profile coordinator now captures outgoing managed settings, restores baselines and
applies incoming settings before pointer publication. A to B switches pass through a quiescent
Local phase, keeping each transaction encrypted only by its owning Account. Failure in phase two
publishes the actual Local selection and an explanatory notice. Typed startup recovery blocks both
desktop commands and direct native agent starts. Explicit recovery verifies the strict locator and
encrypted transaction before rollback or finish verification. Ambiguous pointers are preserved,
not silently repaired to Local. Five additional native regression cases are present but not yet
executed under the local build-script policy block. Exact Tauri bindings and recovery UI integration
remain pending; the M9 transition feature is not claimed complete.

The separate dark ConfigurationRecovery screen is ready for App integration. Two component tests,
Biome and Chromium/WebKit browser checks pass, including axe, explicit action only, retained errors,
locked-account disablement and unavailable-record refusal. Its rendered screenshot was checked
against the current Orbit frame. Integrated Windows native build/export passed. The first focused
profile run passed 12/13; the stale A-to-B failure assertion is corrected to require Local fallback
and invalidation while preserving A's encrypted receipt/head for reopen. Parent will rerun the native
case and wire the screen before the final combined gate. No real configuration or account was used.

### Admitted remote history and Continue here

Staged encrypted turns now publish through the chat actor after earlier writes finish and only when
no native session, queued prompt, steering or chat mutation is active. Publication validates the full
piece chain, remaps event sequences, imports authenticated attachments into encrypted storage, and
commits visible rows atomically. Missing ancestors defer publication. Offline sibling continuations
retain both branches and add a visible fork notice. Fair selection keeps busy chats from starving
other incoming history. Existing attached views receive a sequence gap and reattach to durable history.

New remote history invalidates earlier handoff reviews. Continue here previews a bounded visible
handoff, preserves the saved native session, and starts a fresh session only with the next user prompt.
Neither applying a review nor importing a turn sends an agent prompt. The actor rejects ordinary
start/send until that handoff has been reviewed. Unknown event JSON and accepted steering remain in
the imported transcript; device folder mappings and native session IDs are never copied.

Seven focused transcript tests and the Account actor handoff regression passed on Windows, including
authenticated malformed-data rollback, missing-parent deferral, branch union, encrypted image transfer,
busy-session deferral, view reconciliation and stale-review rejection. Account-feature all-target
Clippy, default core compilation and ordinary native TypeScript export passed. Only the generated
conversation declarations were retained because this isolated branch lacks newer installer/clone/setup
commands already exported by the integrated branch. Pinned pnpm typecheck still reports its existing
AppInfo fixture and steering reducer gaps; it reports no new conversation errors. Root integration owns
the scheduler admission hook and Continue here UI. Explicit Local import, folder resolution, macOS and
complete M7 acceptance remain pending. No real account request or vendor prompt was used.
## Reviewed Git initialization checkpoint, 2026-10-26

The Git workspace dialog now offers explicit initialization for a non-Git folder. Review shows the canonical folder and initial branch with a one-use, expiring token. Confirmation rechecks the folder identity and refuses existing metadata, ancestor repositories, private agent roots and live folder ownership. Git generates metadata only in an owned temporary directory; publication creates a fresh `.git` through pinned no-follow directory handles. Working files remain unchanged, no index or first commit is created, and interrupted publication retains its incomplete marker for review. Profile admission and the folder reservation survive canceled IPC until the owned operation finishes.

Five owned-temporary-directory service regressions and the live-folder admission regression passed on Windows. Core and desktop all-target Clippy, exact native binding export, TypeScript, Biome and instruction parity passed. Chromium and WebKit verified stop-before-review, cancellation, explicit confirmation, first-commit isolation refusal and a consumed stale review. The existing Git, relocation, recovery and pull request browser flows remain passing. The action error now survives a failed inspection refresh. No user repository was initialized, and no remote CI or paid agent was used. General project terminal/editor controls and native Windows/macOS acceptance remain pending.

### Remote history desktop integration
Successful Account exchanges now reconcile staged turns under current-profile admission before
announcing completion, preserving the existing managed-configuration hook. Actual imported batches
schedule another coalesced cycle; busy chats return without spinning. Import failures remain staged
and produce a fixed visible error in both event and polled status without hiding network/revocation
states. A later successful reconciliation clears that error.

Chats with new remote history show Continue here, block composing until a visible handoff is reviewed,
and keep that handoff visible until the next user message. Existing fresh-session recovery stays
available. Both browser engines passed cancellation and confirmation without any native start or
prompt, verified the resulting usable composer and passed accessibility. The rendered dark screen
was inspected. The integrated Windows native build, all 13 focused profile tests, import-status
regression and exact binding export passed. Local import, folder resolution, the final platform gates
and complete M7 acceptance remain pending.
Account actions now retain profile-transition admission through owned completion, including vault
initialization, and profile selection resolves its key under the same lock. Recovery allows only
explicit existing-account access restoration; management actions remain refused and sync cannot
resume with a pending locator or another profile's account. Added two native regressions for that
policy and renderer-cancellation ownership, pending integrated execution. Recovery-only AccountPanel
suppresses management calls and controls and requires the matching profile before unlock activation.
Chromium and WebKit checks pass for correct/wrong account, existing-key recovery, first-key refusal
and zero management calls, alongside the prior configuration recovery coverage. No native auth ran.

### Recovery shell integration
The app now renders configuration recovery before locked-profile, setup or chat controls. Its access
panel targets the transaction's owning Account and restores only the selected profile or the pending
transaction. A Local workspace can restore the inactive owner's access without switching into it.
Ambiguous recovery offers no account or profile action. Native notices and startup errors remain
visible; failed actions do not reload away their explanation. The recovery-only fixture now satisfies
the full typed Account API without an unsafe partial cast.

Desktop TypeScript, Biome, all three native account-admission tests and both recovery browser engines
passed. The dark recovery screen was visually inspected. Earlier integrated profile checks passed all
13 cases. Final combined tests, native platform acceptance and real account recovery remain pending.

### Lost-key reset server checkpoint

The Rust API now has a reviewed reset for a freshly email-verified pending desktop device. Its
one-use receipt binds the session, device and previous key generation. Atomic confirmation increments
the generation, installs new opaque envelopes, revokes other access and removes prior cloud sync
references. R2 ciphertext remains tracked for existing garbage collection. Exact lost-response retries
cannot repeat deletion after the new generation has received data. This is destructive reset, not
recovery of plaintext whose key is lost; existing encrypted device profiles remain untouched.

Native and Wasm library checks and Clippy passed. Exact checked-in SQL executed successfully in
temporary Node SQLite databases for reset, other-account and R2 tracking preservation, stale admission,
retry safety and rollback. Five Rust regressions were added but their run was blocked by host Application
Control 4551 on the libsqlite3-sys build script. The compiled Worker runtime regression is added and
syntax-checked; it still needs execution with the next coherent Worker build. No service or migration
was deployed. Desktop reset UI, durable retry, passphrase vault selection and device-local removal
remain in progress; this does not complete account lifecycle acceptance.

### Explicit desktop passphrase storage checkpoint

Account settings now expose explicit creation and unlock of a bounded encrypted passphrase store.
The existing authenticated vault format stores the profile index and account bundles independently;
there is no OS credential enumeration or automatic migration. Its private app directory records the
selection, so startup with a locked or incomplete selection cannot silently fall back to native
credentials. Creation while native account services are already open reports that quitting and
reopening is required. Unlock and create retain transition admission through owned Rust completion.

Two temporary-directory vault regressions and aura-sync all-target Clippy passed, as did generated
Account DTOs, desktop TypeScript and Biome. Chromium and WebKit verify zero writes before explicit
confirmation, cancellation, wrong-passphrase preservation, unlock and the honest restart state;
accessibility passed and the dark screen was inspected. Native service tests for restart/unlock and
incomplete-choice admission are added, awaiting integrated native execution because this worktree's
SQLite build script remains blocked by Application Control. Full native command export is also
pending. Restoring bindings to existing encrypted profiles after keychain/index loss, durable client
reset and device-local removal remain in progress. No real secure store was opened by these checks.

### Review pending work before sign-out
Desktop sign-out now opens an explicit review with the last reported pending-change count, or an
honest unknown-count explanation. It states that encrypted local data stays and sync pauses. Cancel
keeps the account open; confirmation alone invokes sign-out, and failure stays visible in the review.
Chromium and WebKit passed unknown and nonzero-count review, cancellation, confirmation and
accessibility alongside the existing account/device flows. TypeScript and Biome passed. No account
request or credential operation ran during these synthetic checks.

### Readable export core checkpoint
The Rust profile writer can now produce a bounded Markdown snapshot of one saved conversation.
It joins message deltas within their original turns, preserves unsupported saved events in fenced
blocks, excludes other chats and labels attachment/blob and unsaved-draft limits explicitly. Source
and output limits fail without returning a partial export. Two focused Windows regressions passed
with Account encryption enabled. Native save-file publication and the visible export action are
still being implemented; the website's desktop export promise is not yet fully satisfied.


## Reviewed project terminal and editor controls, 2026-10-26

The chat header now opens Project tools for its saved native folder. A short-lived one-use review binds the chat, canonical folder identity, qualified shell executable and exact argv. Windows offers installed system PowerShell and Command Prompt with profile/autorun scripts disabled; macOS offers its standard Zsh and Bash without user startup files. The explicit Start button opens an owned PTY. General shells can run alongside agents; their nonexclusive folder-use guards block overlapping Git mutations and application/profile idle barriers until cleanup is confirmed. The page and ProfileLease remain owned through startup and cleanup, and output is ephemeral and bounded.

Detected standard installations of Cursor, Visual Studio Code and Insiders can receive a fixed, escaped folder URI. Detection reads only executable metadata. Cursor's installed application distribution declares its protocol and native file opener; no vendor configuration or credentials were inspected. The UI reports only an OS dispatch receipt, handles missing link handlers explicitly, and requires a fresh review after success or failure. Custom installations and unsupported folder paths remain manual. No editor was actually launched during development.

Quit now preserves project terminals until explicit confirmation. Cancel leaves them open; confirmation closes their owned processes and waits for the folder guards to release before storage closes. Unconfirmed cleanup keeps storage open and the folder protected with a specific message. Protected setup/vendor work retains the prior drain behavior. The ordinary quit host no longer tries to reacquire the transition mutex already held by its caller. Eleven focused core tests passed, including a real owned PTY child, shared agent/folder ownership, stale identity, page cleanup and quit preflight. Eight native quit-flow tests passed, including cancellation, cleanup failure and real-store closure under the held outer transition mutex. The native editor URI escaping test, exact generated bindings, core/desktop all-target Clippy, TypeScript, seven terminal/folder frontend tests, Biome and instruction parity passed. Chromium and WebKit passed review/cancel/start/close, stale review, missing editor-handler recovery, no automatic retry, accessibility and mobile overflow checks; rendered dark dialogs were inspected. Native macOS execution and final Windows/macOS visual/release acceptance remain pending. No real shell command, agent prompt, login, user repository mutation, remote push or CI dispatch occurred.

### Updater cleanup admission correction

Updater installation already retains the profile-transition, session-idle and terminal-idle barriers across cleanup and installation. Its quit wrapper now reuses those barriers instead of asking for ordinary drain admission, which correctly refuses an already-quiesced manager. The protected-work wait, refusal to discard drafts, storage flush and installer handoff remain unchanged. Both updater cleanup tests now model refused ordinary admission and pass; combined native Clippy passes. This fixes a source-level always-refused install path, not the still-pending signed-package upgrade acceptance.

### Explicit Local project import

An unlocked Account can now review selected Local projects and copy their chats, saved drafts and
attachments into encrypted storage. The inactive Local database is opened read-only under its owner
lock. A content revision binds the review to the copied rows; a changed source or identity collision
rolls back the whole selection. Schema 13 stores device-local import receipts, so repeating an import
does not overwrite subsequent Account edits. Portable metadata and its sealed outbox commit together.
The original Local database, vendor sessions and files remain intact.

Imported turns preserve source agents but no native-session identity or checkpoint reference. Existing
recovery closes unresolved approvals and retains unfinished responses as interrupted. Continue here is
required before a new prompt. Managed worktree ownership, queued prompts and protocol logs remain in
Local, with those boundaries stated in the review. Attachment reads reject links and changed hashes;
already missing files are counted explicitly. Source schema mismatches fail without migration/repair.
Owned apply tasks retain both profile and session admission through the actual writer result.

The new LocalImportPanel reads Local only after its review button, lets the user select projects and
shows repeat/missing-file outcomes. It uses dark Orbit controls and generated command DTOs. Account
screen wiring and browser acceptance remain with the integrated application. Five focused core tests,
the schema foreign-key check, ordinary native bindings export, desktop TypeScript and Biome checks
passed on Windows. Core and desktop all-target Clippy passed after a minimal existing profile-command
lint correction agreed with its owner. No real Local profile, vendor login, network request or paid
prompt was used. Remote folder resolution, macOS and complete M7 acceptance remain pending.

### Readable chat export and Local import entry points

Chat details now offers an explicit readable Markdown export. The review explains plaintext disclosure, saved-message scope, incomplete running turns and excluded attachment payloads. Rust reads a bounded writer-ordered snapshot and opens the native save dialog; the renderer never receives the conversation payload or supplies a filesystem path. A profile lease survives canceled IPC through final publication. Saving stages a synced temporary file beside the selected destination and publishes without replacing existing files. Canceling creates no export; failed publication removes temporary plaintext.

The unlocked active Account settings now mounts the Local project review keyed by profile ID. An explicit import refreshes both the workspace and chat list, with failures shown without automatically retrying the import. Focused native save/no-overwrite/cleanup tests, exact generated bindings, TypeScript and core/desktop all-target Clippy passed on Windows. Chromium and WebKit passed review, cancellation, selection, already-imported refusal, stale-review recovery, empty Local state, export success/cancel/error, accessibility and narrow viewport checks. The rendered dark dialogs were inspected. Both flows join the existing settings browser gate. Native macOS and complete release acceptance remain pending; no real user chat, profile or account was exported or imported.
### Deleted account detection checkpoint

Deletion now records short-lived receipts only for sessions that remain valid inside the guarded deletion transaction. Exact unexpired tokens retain client-kind and browser request checks before receiving `account_deleted`; unknown, expired and previously revoked tokens remain unauthorized. Cleanup removes expired receipts, and the privacy notice documents their minimal contents and maximum 30-day retention. The desktop client preserves its confirmed decryption key and a versioned durable Deleted state while clearing the session. No owner account or authentication service was contacted.

Three SQL deletion regressions and three client state/bundle/error regressions passed on Windows. The reviewed Keep as Local copy, UI wiring, generated bindings and integrated platform gates remain in progress.

### Compiled account deletion and website recovery

The current Rust Worker passes thirteen local D1/R2 runtime cases, including the lost-key reset and typed account-deletion paths. Deletion receipts identify only an exact still-valid session at deletion: unknown, previously revoked, expired and wrong-client tokens remain unauthorized. Browser mutations still require Origin and CSRF, the minimal receipt survives session cleanup, and its expiry removes the deletion signal. The deletion fixture now advances both receipt timestamps consistently with the database constraint.

The website now clears account controls and any open confirmation when the account is deleted, explains retained local work, and offers Open auracode, Download and fresh account creation. Chromium and WebKit passed the new deletion presentation and existing account flows with accessibility checks. A WebKit focus assertion now waits for the existing code-entry focus effect instead of observing between render and effect. Public installer signing is explicitly deferred by the owner; continue source, unsigned build and update-tooling work without treating missing signing identities as a current blocker. Live cloud website upload authorization and native acceptance remain separate pending work.

### Integrated passphrase storage verification

The integrated native Windows account service passes all five focused admission and vault tests, including explicit passphrase creation, reopening locked, wrong-password rejection and interrupted setup refusing OS-storage fallback. Full desktop and lightweight account DTO exports pass with both the new vault states and Deleted state retained; desktop TypeScript passes. The final manual CI gate now includes the isolated vault browser checks. README and release instructions reflect dark-only Windows/macOS scope, deliberate CI batches, the preview API's actual deployment state and the owner's signing deferral. No full final batch or release publication has run yet.
### Reviewed folder resolution on another device

Git folders can now search explicitly selected code roots for the same normalized origin. Roots live
only in the current device's keyed settings. Search visits at most three levels, 4096 directory entries
and 128 repositories within 20 seconds, skips hidden/linked directories and reports incomplete checks.
It never fetches, changes the index or reads vendor configuration. Locate reviews a chosen root, checks
the origin again after admission, and commits only this device's folder location with identity CAS.
Local-only copies require explicit review because their contents have no portable Git identity.

Owned mutations retain profile admission, stop new agent starts, reserve affected parked actors including
archived chats, and refresh their working directories from the committed writer response before release.
A different location with native history on this device is refused rather than silently reusing that
session in a new cwd. FolderResolver reuses the reviewed GitHub clone dialog with a fixed origin and
requires a separate mapping confirmation after clone completion. Other hosts remain available through
Locate. The integrated app still needs to mount the standalone component and refresh workspace context.

Four focused core tests passed with default and Account features on Windows. They cover device isolation,
stale mapping CAS, native-history refusal, parked actor refresh, bounded discovery and an origin swap with
an unchanged Git index. Ordinary native bindings export, core/desktop all-target Clippy, pinned pnpm
typecheck and Biome passed. Chromium and WebKit passed synthetic review, retry, saved-result refresh-error
and locked clone-origin checks. No real user folder, account request, vendor prompt or remote mutation
was used. Publish to GitHub for local-only folders, native macOS qualification and complete M7 acceptance
remain pending.

### Folder resolution in project settings

Project folder rows now offer Find on this device or Change location. The resolver is keyed by active profile and folder, uses the native picker, and refreshes committed workspace and chat summaries after mapping. Its review opens separately from the project form so Clone cannot submit project edits. Selected code roots, matching origin search, Locate and the existing reviewed Clone flow are available from that screen. The component has compact dark dialog spacing and wraps paths and actions on narrow windows.

Chromium and WebKit passed the integrated modal fixture's mapping, stale review, post-save refresh failure and fixed clone origin flows, plus accessibility and narrow-dialog overflow checks. Rendered narrow screenshots were inspected. TypeScript, Biome, workflow lint and instruction parity pass. This adds the resolver browser gate and screenshots to final manual CI; native platform and final combined acceptance are still pending. No user folder was remapped and no remote was cloned.

### Passphrase file-open hardening

Passphrase ciphertext and lock opens now request no-follow semantics atomically through directory handles, then validate the opened regular file. The ciphertext length is checked on that handle and its read remains bounded. This closes the former metadata-check/path-open race without reading any OS credential store. Five focused vault tests, the Windows regular-file refusal regression and aura-sync all-target Clippy passed. The additional symbolic-link assertions are Unix-only and remain for the final macOS gate.
### Reviewed Keep as Local preservation

A deleted Account with its matching workspace unlocked can now review and explicitly create a separate unencrypted Local copy. The one-use ten-minute review binds saved project/chat rows; changed reviews refuse before creating a destination. The owned writer operation retains profile, transition, terminal and session admission until it finishes. Existing Local and encrypted Account data remain intact. The allowlisted projection preserves archived chats, available referenced attachments and drafts, resets managed-worktree context, excludes native sessions/credentials/configuration/queued controls/checkpoints/logs, and recovers unfinished turns only in the destination. A later Open Local copy is separate from copying.

New profiles remain unpublished until copied data is synced and profile metadata is atomically linked without replacement. Pinned no-follow attachment/publication writes and verified Windows private access protect the destination. Missing attachments are counted; malformed data and copy limits preserve an explicitly identified partial plaintext folder without adding it to the profile list. Limits are visible in review: 1024 projects, 512 MiB of workspace rows, 4096 attachments and 512 MiB of decrypted attachment data. A cumulative regression proves the next blob is refused before writing when its size exceeds the remaining budget.

Seven focused encrypted-profile copy/recovery/publication tests passed on Windows, including the strengthened no-replace metadata test. Exact native binding export, core/desktop all-target Clippy, desktop TypeScript and Biome passed. Chromium and WebKit passed explicit consent, cancellation, stale/partial failures, no automatic retry, separate open failure, accessibility and mobile review checks; rendered dark dialogs were inspected. The deletion Worker wasm check passed. A later broader aura-sync run was blocked before execution by Windows Application Control4551; its three earlier focused deleted-state/bundle/error tests passed. No bypass or retry was attempted. Root owns the production AccountPanel mount and compiled Worker runtime verification; final Windows/macOS integration and real-account acceptance remain pending. No owner data, actual authentication, network mutation, paid prompt, remote push or CI dispatch occurred.

### Integrated Keep as Local gate

The combined native command export and desktop TypeScript pass with preservation, folder resolution, passphrase storage and readable export together. Chromium and WebKit pass the preservation fixture's explicit consent, cancellation, stale review, partial-copy reporting and separate Open Local copy recovery. The existing settings browser gate now includes those checks and screenshots using its owned development server. The account lifecycle coordinator is integrating the production Deleted-account entry point; that mount is not complete yet.
### Durable reset client checkpoint

The client now saves the exact reset request and unconfirmed new key in its encrypted version-3
bundle before dispatch. Versions 1 and 2 remain readable. Restart, request failure and fresh sign-in
retain that material; all key wrapping and recovery proofs use the reviewed next generation. A narrow
same-account cancellation endpoint arbitrates against commit before the client may discard an
unconfirmed key. A committed or ambiguous matching generation retains it for verification.

Core reset completion saves a detached old-profile binding before acknowledging the durable reset.
Existing encrypted profile files remain intact and cannot be reopened with the new generation's key.
Seventeen focused account tests pass, including four new restart/retry, cancellation, vault-failure and
fresh-sign-in regressions. Client all-target and Worker Wasm Clippy pass; the exact cancellation SQL
also passed temporary Node SQLite arbitration tests. Generated Account DTOs include Deleted and
reset types. Core fault-injection coverage for binding and acknowledgement failures is added, awaiting
integrated native execution with the blocked SQLite build noted above. Reset presentation, restored
profile binding after vault loss and device-local removal remain in progress; no live reset occurred.

### Agent discovery on focus

Returning to an unlocked app refreshes installed-agent discovery at most once per minute. Startup,
focus bursts and an in-flight refresh are coalesced, while running sessions retain their original
launch specifications. The native Windows cooldown/concurrency regression and rustfmt pass. This
also fixes the integrated reset-confirmation closure ownership required for native compilation.
Watching binary directories and selecting shadowed installations remain pending.

The owner requested Cloudflare MCP deployment. Its documented request interface can manage resources
and upload the Rust Worker, but cannot supply the separate bearer token required by Static Assets
uploads. The official direct-upload documentation confirms that requirement. Website publication
remains pending; no alternate authentication, new login request or live resource mutation was made.

### Account reset and Deleted preservation controls

- Added an explicit reset review that shows the affected encrypted record/blob/device counts, requires saving the new recovery key and typing `RESET SYNC`, and never begins a reset on mount.
- Saved uncertain reset requests expose exact retry and server-arbitrated cancellation. Confirmed server resets with unfinished local binding cleanup remain visible after restart.
- Deleted accounts now show retained workspace guidance and mount Keep as Local only for the matching active unlocked Account. Opening the panel does not copy data.
- Chromium and WebKit synthetic browser checks pass for review cancellation, confirmation failure, exact retry, pending cancellation, committed local completion and Deleted activation/mount boundaries. TypeScript, Biome and instruction parity pass. No live account, key, configuration or cloud data was used.
- Explicit existing-profile key rebinding and reviewed removal from this device remain in progress.

### Reviewed debug bundle

The chat menu can prepare an editable debug preview before an explicit clipboard copy. Native Rust
reads only that saved chat's newest owned protocol log, bounds discovery and the last MiB, refuses
linked log directories/files, omits partial or invalid records and redacts complete records again.
The preview discloses that messages, code and paths can remain. Nothing is uploaded or copied on mount.
It includes app/platform versions and preserves existing logs without accessing vendor configuration.

Focused redaction, path-scope and bounded-tail tests pass. Native command export, desktop TypeScript,
process/desktop all-target Clippy and both browser engines pass. Browser checks cover cancel, editable
copy, read/clipboard failure, accessibility and narrow layout; the rendered dialog was inspected.
The broad process test command passed the new tests but later hit Application Control4551 launching
an unrelated supervisor test binary with zero matching tests. It was not bypassed or retried. The
focused library run passed after adding the bounded-tail assertion. Final platform acceptance remains
pending. Integrated reset command bindings were also regenerated in this checkpoint.
### Explicit private repository publication

Mapped local-only folders now expose reviewed Publish to GitHub. Rust requires a regular Git root with
an existing commit, resolves the chosen user or organization through the user's GitHub CLI, and shows
the exact repository, private visibility, branch and commit before any remote mutation. Non-Git and
unborn repositories point to explicit initialization/commit work. No staging, automatic commits or
vendor credential reads are added. The implementation follows the official
[gh API command contract](https://cli.github.com/manual/gh_api) and
[GitHub repository endpoints](https://docs.github.com/en/rest/repos/repos).

Creation and push intent are saved before execution in a bounded recovery journal, encrypted for Account
profiles. Unknown create/push outcomes stop for a new review. Recovery checks the pinned repository ID,
private visibility and branch commit; a missing response never causes an automatic create retry or
branch overwrite. Git pushes only the reviewed commit with an absent-branch lease, verifies its effective
destination, and adds origin only after confirmation. The index and uncommitted files remain unchanged.
Portable folder identity updates use the reviewed folder ID and device path rather than creating a new
folder. Recovery drafts survive restart; no sign-in or GitHub read occurs merely by mounting the UI.

Focused Windows tests passed for HTTP status handling, uncertain creation/push recovery, identity and
visibility changes, native origin preservation, mixed index/worktree state, empty-repository guidance,
device mapping CAS and encrypted recovery with plaintext-layout refusal. The production push path was
also exercised against a disposable local bare repository: its absent-branch lease rejected a second
commit while preserving the first. Eleven matching Account-feature tests plus the added no-commit test,
ordinary native bindings export, core/desktop all-target Clippy, TypeScript and Biome passed. Chromium
and WebKit passed explicit review, private confirmation, uncertain-result retry, reopened journal and
post-publication refresh failure checks. No GitHub repository, remote branch, real login or paid agent
call was created during development. Integrated UI placement, native macOS qualification and complete
M7 acceptance remain pending.

### Integrated publishing and preview API update

The publication control is available through Change location for mapped Local folders. It now uses
the dark project dialog layout, including wrapping paths/commits and compact confirmation controls.
Native combined command export and TypeScript pass. Both browser engines pass publication recovery,
accessibility and narrow-dialog checks; screenshots were inspected. The accessibility run caught a
skipped heading level, which was corrected. Reset and publication checks join the final manual CI gate.

The compiled Worker passes all thirteen runtime cases, now including cross-account cancellation
isolation, cancellation winning before reset, cancellation after committed reset, and preserving newly
uploaded records on retry. Using the owner's requested Cloudflare connector, a fresh preview database
backup was downloaded and verified, migrations 0004/0005 were applied, and the tested Rust Worker was
deployed with platform secrets preserved. The migration ledger, zero-user count and foreign keys were
checked. Live preview health/configuration return 200/no-store, missing authentication returns 401 and
foreign Origin returns 403. Exact deployment and backup hashes are recorded in infra/README.md.
Website static upload and signed-in multi-device acceptance remain pending. No real sign-in, email,
account deletion/reset, GitHub publication or production data mutation occurred.
### Existing Account workspace binding recovery

- Added explicit selection of an existing Account profile after recovering its account key into a new secure store. Matching account, key generation and fingerprint are verified against the existing encrypted database before its binding is saved; missing/empty/wrong-key profiles are preserved and refused.
- Changed device registrations reissue queued envelopes with new sender clocks while retaining field clocks and ciphertext payload contents. Config records receive a matching encrypted header and fresh blob; old immutable blobs remain available to existing reviews and merge bases.
- Strict profile ownership, no-follow file opens, retained file identities and the native transition gate prevent restoring an open or mismatched recovery profile. Secure-store save failures remain retryable without discarding queued edits or cursors.
- Ten core Account tests and the config header/blob regression pass with SQLCipher, including reset binding failure recovery. Chromium and WebKit cover explicit workspace selection, wrong-key failure and retry. The native full command binding export remains an integrated gate.

## Reviewed project and folder removal checkpoint

- Added explicit one-use removal and restore reviews in Project settings and the removed-items list. Parent metadata tombstones hide affected chats without deleting files, Git worktrees, messages, drafts, attachments, native history or device folder mappings. Restoring retains archived chat states and independently removed child folders. The bounded list shows up to 1,000 projects and 1,000 folders, revealing older entries as items are restored.
- Apply retains the native profile lease in an owned task, takes organization/maintenance admission, reserves affected actors and canonical folders, flushes actor writes, and rechecks the reviewed membership and timestamps in the writer transaction. Active agents, queued prompts, pending steering and open project terminals prevent removal. Restore preserves held queues.
- Account parent tombstones use existing encrypted metadata capture. Shared dispatch/writer admission defers incoming removals across startup, active turns, background work and pending steering. Once committed, a workspace change notification holds queued prompts and stops idle harnesses; cached actors cannot send, restart, continue or dispatch until restoration. Deferred metadata is retried by ordinary sync work, without requiring a new remote edit.
- Core all-target check and Clippy with account-sync, rustfmt, instruction parity, and Chromium/WebKit review/cancel/stale-token/restore/parent-before-child/accessibility/narrow-layout fixtures passed locally. These fixtures test presentation with an injected API, not a native end-to-end removal. SQL/session/projection regressions compile, but Windows Application Control4551 blocked the core test executable before any tests ran. Native binding export was separately blocked before desktop source compilation by denied Tauri updater/dialog build scripts. Desktop typecheck currently reports missing generated removal bindings and their derived type errors. No security settings were changed, no real user item was removed, and no remote CI or native-agent invocation ran.
- Integration gates pending: generate exact desktop bindings, rerun desktop typecheck, execute the core workspace_removal and parent_tombstone tests, include the new check-workspace-removal.mjs fixture in final browser gates, and exercise actual native removal/restore on an owned disposable profile on Windows/macOS. Public signing and packaged release qualification remain separate pending acceptance.

### Rust client against the compiled cloud runtime

A new isolated contract test runs the actual Rust HTTPS client in its test-only loopback mode against
the compiled Rust Worker with disposable D1 and private R2 bindings. It registers synthetic Windows
and macOS devices, initializes a real account key/recovery envelope, requires approval for the second
device, unwraps that device's key, sends and decrypts records/blobs, checks retry/cursor/tombstone
behavior and confirms immediate revocation. The server never receives the plaintext record or blob.
The test performs no real sign-in, email, vendor credential access or deployed-cloud mutation.

All fourteen compiled Worker runtime cases pass, including the new Rust-client contract. The client
unit is ignored in ordinary Cargo runs and invoked explicitly by the existing Worker runtime gate,
which supplies only its own 127.0.0.1 endpoint and deterministic disposable session fixtures. This
adds cross-component evidence without changing the production client's HTTPS-only rule.
### Device-local executable selection

The Agents screen now lists discovered executable entries in environment-override and PATH order,
including broken entries and shadowed alternatives. Opening the picker explicitly probes versions;
mounting the screen never selects a binary. The user can pin a ready executable or restore the
environment default. Native transports retain their executable-only Windows policy; reviewed npm
packages still resolve through their package bin without interpreting shell shims.

Selections are provider-wide across alternate transports and saved atomically in auracode's local
`agent-executables.json`, separate from portable Account data and vendor configuration. A missing or
broken pinned executable refuses new starts. Corrupt preference data also fails closed. Changing a
choice invalidates stale probe generations but never changes an already prepared launch or owned
session. A file lock prevents lost updates between app processes. Refresh rechecks the exact chosen
entry, and the desktop observes bin-directory/file metadata and symlink/package-bin targets every
30 seconds; unchanged metadata does not launch probes. Existing throttled focus refresh remains.

Discovery is bounded to eight executable entries and 256 PATH directories, with visible truncation
and an additional saved choice when needed. Candidate version helpers retain their existing owned
process timeout/output limits, with at most four candidate probes in flight per picker. Metadata
polling can take up to one interval to notice changes; same-size replacements preserving all metadata
are still checked by explicit/focus refresh. No executable contents, credential stores or vendor
configuration files are scanned.

Focused Windows tests cover ordered discovery, override rules, bounds, metadata additions/removals,
in-place changes, durable selections, provider aliases, broken-first behavior, missing-selection
refusal, default reset, corrupt preferences and selection during an older in-flight probe. Existing
vendor maintenance regressions still pass. Exact native binding export, agents all-target Clippy,
desktop library Clippy, desktop TypeScript and Chromium/WebKit selection/retry/reset/accessibility
checks passed. The combined core all-target check exposed unrelated private key-restore calls in
the existing Account fixtures; the lifecycle owner supplied their separate correction. Native macOS qualification and
final integrated acceptance remain pending. No real agent, login, paid prompt, remote mutation,
push or CI dispatch was performed.

### Combined native and browser verification

The combined native command export and desktop TypeScript pass with executable selection, workspace
removal and recovered Account binding together. The removal fixture now returns the native command's
actual null result. Chromium and WebKit pass all three screens' review/retry/cancel/accessibility
checks. Their standalone gates and screenshots are included in the final manual CI batch.

The integrated SQLCipher core library suite executed all 492 tests: 490 passed, and two recovery
fixtures still assumed an old schema version/page layout. The unknown-version fixture now always uses
the current schema plus one, and damaged-schema checks include every table from current migrations.
All 25 focused salvage tests pass after those fixture corrections. Production salvage behavior was
unchanged. This broad run also exercised the new removal and Account rebind tests successfully; the
reviewed held-prompt acknowledgement follow-up and remaining lifecycle work still require integration.
### Removal dispatch acknowledgement follow-up

Independent review found a race where incoming removal could win after send admission but before dispatch. The prompt was safely saved as held, but its acknowledgement incorrectly claimed immediate delivery when checkpoints were disabled. Dispatch now reports its actual queued outcome and emits the normal queued lifecycle for this path. A deterministic test hook removes workspace admission at that exact boundary and checks the held queue, queued acknowledgement/lifecycle and absence of a driver prompt. Core all-target account-sync Clippy and instruction parity pass; native test execution remains pending after the earlier Application Control denial.
### Reviewed removal from this device

- Removal requires an explicit switch to Local with configuration recovery complete, then a one-use review, a data-loss acknowledgement and literal `REMOVE`. It erases only the selected mapped Account profile and auracode's account/device bundle. The review reports unknown pending sync changes honestly, counts other mapped profiles, and explains that other isolated data roots retain files but lose access to the shared bundle. Cloud data and other running sessions are not revoked.
- An encrypted secure-store receipt is saved before staging the app profile. Pinned no-follow directories, strict profile ownership and rechecks protect publication and bounded deletion. Interrupted file, key or index acknowledgements retain a resumable receipt; cancellation is accepted only while original files remain unstaged. The owned native operation holds profile, transition, session and terminal admission through completion.
- Fifteen core Account tests and the maximum-vault-size regression pass on Windows, including staged-content changes, active profile locks, receipt-save refusal and failures after staging/key erasure. Workspace rebind now refuses a future database schema before writing. Desktop all-target Clippy and exact native binding export pass. Chromium and WebKit pass explicit Local admission, no mount actions, destructive review, cancellation, failed removal and completion, with accessibility checks; rendered dark dialogs were inspected. No real profile, credential store, cloud record or vendor configuration was modified. Final combined Windows/macOS checks remain pending.

### Codex startup model recovery

Codex can reject a saved or project-selected model before opening a thread. An absent catalog entry is not proof of removal because configured provider aliases can be valid. After an explicit open RPC error and a complete model list with exactly one advertised default, auracode now shows the actual error and an always-ask choice to retry opening once with that default. Successful custom aliases are preserved. Authentication errors and incomplete, empty or ambiguous catalogs do not trigger the choice. This follows the pinned Codex 0.162.1 thread processor's explicit model override behavior: https://raw.githubusercontent.com/openai/codex/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs .

Cancel retains the original selection and thread. Acceptance retries only thread/start or the same thread/resume, leaves visible prompts queued, resets incompatible effort, and persists the effective selection only after successful Ready. It never retries a prompt or asserts that a generic error proves a removed model. The choice remains interactive under Full auto and does not expire while the user is deciding; Stop withdraws it.

Added owned fake-protocol regressions for fresh/resumed startup, paginated metadata, no automatic action, custom aliases, cancellation, failed retry, authentication/catalog failures, stale/duplicate answers and Stop. Core regressions cover always-ask behavior, successful model persistence, and retaining the project model plus queued text after failure. Core all-target account-sync Clippy and formatting pass. Windows Application Control4551 blocked serde_core, serde_json and num-traits test build scripts before driver tests ran; the earlier core test executable denial also remains an execution gate. No policy change, paid prompt, user configuration read, remote CI or public protocol/binding change occurred. Final integration must execute these focused tests and verify the existing native pre-Ready question UI on an owned profile.
### Preserve config edit ordering through device recovery

Independent review found that reissuing an old queued config edit with the recovered device's sender clock could make it appear newer than a later edit from another device. Rebinding now preserves the encrypted content revision and immutable blob while resealing only the outer sender envelope. Config acceptance compares content revisions, and reissues the winning content under the current sender when an authoritative stale-content head has a later transport clock. Existing merge bases and pending reviews retain their exact revision and blob identity.

All 42 core sync tests and account-sync all-target Clippy pass on Windows. New regressions cover a later remote edit after rebind, reverse convergence against stale content with a later transport clock, current-device sender validation and acknowledgement queue drain. No server schema, API DTO, actual account or credential store changed. This supersedes the earlier rebind checkpoint's fresh-config-blob behavior.
### Active workspace identity and cached sync status

The main sidebar now names the active Local or Account profile instead of always claiming Local.
Account profiles show their native cached sync state and pending count; Local profiles do not call
the account service or register sync listeners. The new getter reads only the published runtime,
without opening a vault, authenticating or triggering network work. Settings remains the existing
entry point for profile and sync controls. Subscription cleanup, profile IDs and live-event precedence
prevent a delayed cache response or retired profile event from changing the current workspace label.

Ten focused frontend tests, exact native binding export, desktop library Clippy, TypeScript, Biome
and instruction parity passed. Chromium and WebKit passed Local/Account/paused states, settings
navigation, delayed-response/profile-switch cases, accessibility and narrow layout; dark screenshots
were inspected. Exact export also includes the previously integrated rebind/removal commands and the
removal fixture's existing null-result correction. No real account, credential store, agent or network
service was accessed. Native platform acceptance remains part of the final combined gate.

### Chat sign-in recovery

An authentication-required chat now offers the existing vendor terminal sheet when the detected
installation advertises a reviewed login command. Opening the card or sheet does not start a process;
the sheet retains its separate Start sign-in action. Driver-supplied commands remain display/copy
only, while Rust independently selects and rechecks the installed executable. A completed or failed
login leaves Retry explicit so held prompts are not sent automatically. Unsupported installations
and failed metadata lookups retain manual command instructions and Retry. Retired metadata responses
cannot enable sign-in for a different agent.

Twenty-four focused card/terminal tests, desktop TypeScript, Biome and instruction parity passed.
Chromium and WebKit passed explicit launch, cancellation, success/failure, Retry, unsupported/manual
fallback and stale lookup cases with synthetic terminal IO. Accessibility checks and inspected dark
desktop/narrow screenshots passed. No vendor login, credential store, account service or paid prompt
was used. Native sign-in acceptance remains in the final platform gate.

### Pending questions remain beside the composer

Unanswered, actionable UI questions now share the permission dock while the session has a process, including pre-Ready startup recovery. Each request shows whether it belongs to a turn or the session; turn requests include a bounded prompt label. The transcript keeps the resolved history and informational notifications, but does not duplicate a docked question. The existing response path owns pending, failure and withdrawal state. A hidden composer keeps its draft while the user answers.

Chromium and WebKit fixtures passed keyboard selection/submission, no automatic answer in Full auto, pre-Ready questions, pending/error/retry, agent withdrawal, reattachment, mixed permission/question requests, notification-only behavior, preserved drafts, accessibility and the 390px layout. Screenshots were inspected. Forty-nine related frontend tests, TypeScript, targeted Biome and instruction parity pass. The question fixture joins the existing final settings browser gate. These are production-component fixtures with an owned synthetic transport, not paid-agent or packaged native acceptance.

### Codex recovery answer lifecycle

- Corrected Codex startup-model recovery so a submitted answer does not also emit a withdrawal. Core already resolves the answer; the extra withdrawal produced a false notice that the answer did not reach the agent.
- The real driver regression covers accepting the offered default and cancelling the recovery without withdrawal. Stop still withdraws its unanswered card, closes the owned process, and preserves queued user work through the existing core contract.
- Validation: six focused native Codex recovery driver tests and both core startup recovery tests passed; aura-drivers all-target Clippy with replay/testing passed. No real agent or paid prompt ran.
### Informational notifications do not request attention

Chat activity now excludes Notify prompts from waiting status, matching the actionable request dock. Notifications remain in the transcript without an answer or resolution. A regression covers a notification beside running tool output, an actionable question taking attention, and the answered question restoring tool activity while the notification stays unresolved. All seven activity tests, desktop TypeScript, targeted Biome and instruction parity pass. No native agent call or CI run was performed.

### Website links and Account onboarding

The packaged Windows/macOS app now receives `auracode://signin` links through Tauri's native
deep-link and single-instance plugins. Rust accepts only bounded Account navigation with an optional
email hint. It rejects other actions, extra query keys, credentials, ports and fragments. A latest
pending request survives webview reload until the matching acknowledgement; old acknowledgements
cannot erase a newer request. Development does not register or replace OS URL associations.

The UI defers navigation through loading, locked profiles, configuration recovery, profile switching
and open dialogs. Links open Account without authenticating, sending a code or changing the selected
account. Repeated links preserve an inline code challenge, recovery key and unsent email. Onboarding
now offers the real Account screen and returns to its saved setup step. Ordinary settings shortcuts
still return to chats. Independent review caught and corrected early consumption across recovery
reloads and unwanted Account remounts before this checkpoint.

The integrated desktop native library passed all 201 tests, including URL rejection, stale
acknowledgements, packaged configuration and exact command binding export. All-target desktop Clippy,
TypeScript and 348 frontend tests pass (19 existing cases skipped). Chromium and WebKit passed the
combined settings/account/configuration/continuation/question flows, including preservation across
repeated Account navigation, and the onboarding return path. An earlier compiled native test binary
was blocked by Application Control4551; ordinary verification after subsequent source integration
ran successfully. No policy, binary relocation or security bypass was used. Actual installed OS URL
activation remains in packaged acceptance.

Cloudflare MCP also confirmed Universal SSL enabled and an active Let's Encrypt certificate covering
`auracode.si` and `*.auracode.si`, expiring 2027-01-22 with Cloudflare-managed renewal. The owner does
not need to purchase an SSL certificate from the domain registrar.
