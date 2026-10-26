# Project instructions

## Keep both instruction files identical

`AGENTS.md` and `CLAUDE.md` must remain byte-for-byte identical at all times. Every edit to either
file must update the other in the same change and commit. Neither file overrides the other.
Run `node .github/scripts/check-instructions.mjs` before committing. CI rejects drift.

## Communication and execution

- Get to the point. Use independent judgment, explain disagreements, and change direction when the
  evidence warrants it. Do not agree just because the owner suggested something.
- Never use em dashes in new prose, comments, UI copy, commits, or PR descriptions.
- Carry authorized work through implementation and verification. Ask only when critical information
  is missing or a consequential action is outside the owner's authorization.
- Keep durable progress and decisions in `docs/progress.md`. Do not describe pending work as complete.

## Rust first

- Use Rust for backend services, APIs, authentication, business logic, agent integration, persistence,
  synchronization, encryption, and background processing, on desktop and in the cloud.
- Use React and TypeScript for interfaces. TypeScript or JavaScript may supply necessary platform
  bindings, frontend rendering, and existing build/test tooling, but not a parallel backend.
- Any other language exception needs a concrete technical reason documented with the implementation.
  Convenience alone is not a reason to move backend logic out of Rust.
- Use native formats for infrastructure configuration and SQL migrations. Do not replace useful
  platform tooling just to make configuration look like Rust.

## Cloudflare infrastructure

- Host auracode's cloud application infrastructure on Cloudflare: Rust Workers, D1 for relational data,
  R2 for encrypted blobs and releases, Turnstile, and Cloudflare Email Service for sign-in codes.
- Neon, Neon Auth, Hyperdrive, and Resend are no longer part of the architecture. Historical spike
  reports remain historical; current plans and implementation must follow this decision.
- Local SQLite stays local-first. The base app needs no login or network connection.
- Separate environments and resources. Never modify unrelated projects. Secrets belong in platform
  secret stores, never source control or logs. Do not expose private blob buckets publicly.

## Product and safety invariants

- Follow `docs/plan.md` and the chosen Orbit language in `docs/design/visual-language.md`.
- The product is dark only, including desktop, onboarding and the website. Do not add a light
  theme, system-theme switching or an appearance selector. Historical light design studies are
  references, not product requirements.
- Verify visual work against the original handoff's exact Mobbin and official-site references:
  SpaceXAI/Grok Bot, X Money, Harvey and Aside. Inspect actual screens before implementation;
  written tokens and passing functional tests alone do not establish visual fidelity.
- The current release targets Windows and macOS only. Linux and WSL development, acceptance,
  installers and release work are deferred. Preserve existing portable code without expanding scope.
- Run the user's own agent harnesses. Never read, copy, store, or proxy their credential files or
  keychain entries. Do not edit their real agent configuration as part of development.
- No hidden prompts. Agent/device handoffs are visible to the user.
- Stop only processes auracode owns. Preserve vendor daemons and other applications.
- Keep real-agent verification minimal and use inexpensive models. Never run the paid Claude spike
  binary; its unit tests are safe.
- Full auto remains the default, but never overrides vendor restrictions or always-ask requests.
- Every documented failure case needs defined behavior and verification. Preserve existing chats,
  protect the user's Git index, and back up databases before migrations.

## Git and verification

- Work on a milestone branch and commit logical steps as work progresses. Never develop on `main`.
- Use repo-local author `itscool2b <megagrb16@gmail.com>`; do not change global Git identity.
- Open one PR per completed, tested milestone. No draft PRs. Fix review findings on the same branch
  and PR. Merge only when the owner authorizes it.
- Do not add co-author trailers, generated-by text, or AI attribution to commits or PRs.
- Use the pinned pnpm version, Rust stable at the workspace MSRV or newer, Biome, rustfmt, and Clippy.
  Regenerate and commit TypeScript bindings when their Rust source changes.
- Commit locally during implementation and batch remote pushes. Do not run CI for routine edits
  or each checkpoint. Reserve CI for at most two planned integration checkpoints and the final
  Windows/macOS verification, then fix failures and rerun affected gates until they pass.
- Use focused local checks when they prevent costly rework. Run the full integrated test/build
  suite at completion. Report unavailable platform checks honestly; never call an unverified gate done.
