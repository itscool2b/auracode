# Auracode implementation progress

Updated 2026-10-26. Scope: the accepted Rust-first, Cloudflare-hosted plan, M1b through M9.

## Active integrated-product continuation

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
