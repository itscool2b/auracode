# auracode

One beautiful home for all your coding agents.

auracode is a desktop app for macOS, Windows, and Linux that drives the coding agents you already use
(Claude Code, Codex, Pi, Antigravity, Cursor, Grok Build, OpenCode, Hermes, and any ACP-compatible agent)
through their real harnesses, rendered in one fast, glassy chat interface. Projects on the left, chats inside
projects, switch agents and models mid-chat, run several at once.

- No login needed for the app. Agents are detected automatically, with their versions, sign-in status, and
  available updates.
- Optional account (auracode.si) to sync projects, chats, and agent config (Claude Code, Codex, Pi) across
  machines, end-to-end encrypted.

## Status

Early development. The full plan, decisions, and milestones live in [docs/plan.md](docs/plan.md).

## Layout

```
crates/          Rust core: protocol types, agent catalog + drivers, sessions, storage, sync, dev CLI
apps/desktop/    Tauri v2 app (Rust shell + React UI)
apps/web/        auracode.si website (Cloudflare Workers)
services/api/    account + sync API (Cloudflare Workers, Neon Postgres)
packages/        shared TypeScript: design system, generated API types
infra/           deployment config and database migrations
docs/            plan, architecture notes, spike results
```
