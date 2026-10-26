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

## Decisions and constraints

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
