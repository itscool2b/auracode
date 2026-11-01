# Desktop Customization Implementation Plan

> **For agentic workers:** Use coordinated subagent implementation for independent subsystems and review each subsystem before final whole-branch verification.

**Goal:** Deliver the owner's desktop refinement, native control, shared MCP, and project memory plan.

**Architecture:** Extend React/Tauri production components and Rust session/config/store boundaries. Drivers retain native semantics, Rust owns capability discovery, configuration and persistence, and UI consumes typed snapshots. Additive state preserves old chats.

**Tech Stack:** React, TypeScript, CSS semantic tokens, Tauri, Rust, SQLite/SQLCipher, native CLI and ACP protocols.

**Spec:** ../specs/2026-11-01-desktop-customization.md

## Global Constraints

- No em dashes. Preserve Aura logo, Inter, desktop System/Light/Dark and permanently light website.
- Read docs/design/visual-language.md, reference-audit.md and linked checkpoint before UI changes. Extend existing components/tokens.
- Preserve workflows, native state, accessibility, keyboard navigation and reviewed handoff semantics.
- Real harness capabilities only. Unknown modes never increase access. Do not rewrite native config homes for session sharing.
- Account data remains encrypted. Auth and secrets stay local. Agents can propose memory changes but cannot accept them through the bridge.
- Work in the shared isolated checkout; root coordinates commits, registration files, generated bindings and migrations. Workers never overwrite unrelated edits.

## Review Focus

1. Saved native settings disappear after provider update: block unsafe fallback and allow recovery.
2. Project contains several folders or an unavailable mapping: never silently create in another project.
3. Native and shared MCP definition overlap: retain native configuration and resolve conflict visibly.
4. Memory changes after a turn is queued/retried: persist and resend one admitted context snapshot.
5. Profile changes during helper work: revoke grants and prevent late cross-profile results.

### Task 1: Desktop composition and navigation

**Owner:** root. **Files:** shared graphite token pairs, desktop chat/new-chat/styles/components, App navigation, InstructionsPanel, design docs and UI fixtures.

**Interfaces:** Consume current SessionLists plus Task 2 additive session controls; expose Customize sections using Task 3 Plugins & MCP and Task 4 ProjectMemoryPanel.

- [x] Add meaningful tests for project-prefilled creation/default precedence and supported access controls.
- [x] Replace lime with neutral token pairs; split composer control placement; refine searchable picker, compact new-chat form, project plus and instruction choices.
- [x] Add Customize navigation with persistent chat state and integrate backend panels.
- [x] Run affected frontend tests/typecheck/browser fixtures, then commit exact owned changes.

### Task 2: Native session controls

**Owner:** session worker. **Files:** aura-protocol session controls, aura-drivers options/modes, aura-core session controls/persistence, desktop thin command and transport.

**Interfaces:** Add typed SessionControls descriptors/state to session lists and set-control command. Preserve Autonomy/config_json. Send root exact UI API and registration additions early.

- [x] Add tests for supported access, future effort choices, old serialized records, invalid saved modes and queued transition admission.
- [x] Implement versioned per-native-session control persistence and driver-native access/workflow routes, with requested/effective/pending distinction.
- [x] Wire Codex/Claude/ACP Plan, including remembered Claude execution access, idle admission and explicit native approval.
- [x] Run protocol/driver/core targeted tests and report exact evidence and owned paths for commit.

### Task 3: Plugins and shared MCP

**Owner:** customization worker. **Files:** aura-agents/config vendor/plugin modules, new aura-core MCP module, protocol MCP/capability module, driver MCP-specific launch/setup wiring, desktop library components/API.

**Interfaces:** Shared MCP resolution yields immutable per-session definitions plus runtime compatibility. Coordinate driver options and core actor attachment hooks with Task 2/root. Root owns central registration and migration list.

- [x] Test definition resolution, scopes, native collisions, secret omission, transport compatibility and stale profile results.
- [x] Implement canonical shared definitions with CRUD/import/export, local secrets, portable sync and revision/conflict handling.
- [x] Inject MCP into Codex/Claude/qualified Pi/ACP session lifecycle; preserve native configs and report actual runtime support/status.
- [x] Replace renderer provider conditionals with backend capability/actions; extend supported inventory/management and native customization entry points.
- [x] Build Plugins & MCP UI with persistent explanation, scope/status/actions/auth/restart states; run targeted suites and report paths.

### Task 4: Project memory

**Owner:** memory worker. **Files:** new protocol/core memory modules, store/writer integration, session prompt snapshots, helper/service/skill, desktop memory panel/API and tests.

**Interfaces:** ProjectMemoryPanel consumes typed read/save/propose/accept/history operations; app-owned service exposes read/propose only. Coordinate actor context hook and internal MCP definition with root/workers.

- [x] Test revisions, stale proposals, encrypted storage, exact queued context and project/profile isolation.
- [x] Implement canonical Markdown/history/proposals with optimistic concurrency, import/export and encrypted sync.
- [x] Deliver visible per-generation/revision memory context with real turns using existing text-part contract.
- [x] Add session-bound read/propose service, bundled helper/skill and optional MCP bridge; revoke grants with lifecycle and preserve unreachable-host fallback.
- [x] Build editor/history/proposal review UI and targeted tests; report owned paths for commit.

### Task 5: Integration and verification

**Owner:** root and independent reviewers. **Files:** typed command registration/generated bindings, migrations, tests/fixtures/docs and affected integration points.

- [x] Integrate additions without legacy wire/storage regressions; generate exact Rust bindings.
- [x] Review each subsystem for spec compliance and correctness; resolve material findings.
- [x] Run pnpm check/build, affected Rust tests, browser checks and visual inspection in both desktop appearances, plus website dark-OS/no-JS regression.
- [x] Verify actual installed harness operations and native Windows behavior separately; initiate supported native CI for platform coverage. The owner cancelled the remaining CI on 1 November and deferred further testing; completed checks and outstanding failures are recorded in the styling review.
- [x] Record evidence/limitations and updated design review. Commit remaining changes and push the branch for the requested non-draft PR and merge.

The owner's final instruction is to stop CI, open the PR and merge based on local verification. Full-CI acceptance and follow-up testing are explicitly deferred, not represented as passing.
