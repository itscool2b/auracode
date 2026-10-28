# Setup and agent management

Setup progress is profile-local Rust state in `onboarding.json`. It contains only the current step,
motion preference, completion, boot-seen marker and selected project ID. Commands are serialized,
revision checked and acknowledged after an atomic write. Invalid data is preserved separately;
future formats are left unchanged. A failed save remains visible and can be retried or bypassed
without claiming success. Re-running setup preserves the user's motion and project selection.

The desktop loads cached detection while presenting the boot scene. The first scene lasts 1.8 seconds,
a warm boot 240 ms. Escape, Enter or Skip intro ends it early; reduced motion and notification chat
navigation bypass it. Smoke/stress launches do not enter setup. No vendor login, install, update,
credential inspection or model prompt is triggered by opening setup or Agents. Explicit status and
maintenance buttons use the existing Rust vendor commands; Sign in opens the existing terminal sheet
whose Start action is separately explicit.

Setup is four skippable steps (Welcome, Your agents, Account, First project) in one calm, centred
column after Grok's start screen, over Graphite's dither field gathered at the window's sides as on
the website hero (docs/design/visual-language.md, 4.15 and 6.17). Motion is no longer a step: Full
already follows the system's reduced motion and Settings changes it; a setup saved at the motion
step resumes at First project. The account step says that accounts are optional and invite-only.
Agent rows resolve in place. Keyboard focus moves to each step's heading. Enter advances except
inside controls, editable content, menus and dialogs. Motion preferences also stop the shared frame
clock, rather than merely hiding its animation with CSS.

Agents (6.17a) is one list: a row per harness with its status, version and verified date, at most
one action (Install for the one-click installers, Update when a newer release is known, Sign in
after a check found it needed) and a menu for the rest. Opening Agents looks up maintenance
metadata for installed agents; it never checks sign-in, updates or installs by itself.

Project selection reuses Rust workspace validation. Folder drops only select a path; Add project
performs the write. A project created before a setup-save failure is reused on retry. Existing
projects are available after reload. Clone remains unavailable until the owned Git clone destination
and failure contract are implemented. The account step remains local-only until the deployment and
desktop account flow are enabled. The no-agent path opens the existing local demo screen.

Missing agents link to their vendor's installation instructions, checked 2026-10-26:

- [Claude Code](https://code.claude.com/docs/en/setup), [Codex](https://developers.openai.com/codex/cli),
  [Cursor](https://cursor.com/docs/cli/installation), [Pi](https://pi.dev/docs/latest/quickstart).
- [Grok Build](https://docs.x.ai/build/overview), [oh-my-pi](https://github.com/can1357/oh-my-pi),
  [OpenCode](https://opencode.ai/docs), [Antigravity](https://antigravity.google/download),
  [Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/installation).

These links are guidance, not an implemented installer. New vendor installation, native macOS/Windows
folder-drop and terminal acceptance, final globe-to-dock boot polish, and the enabled account and
clone flows remain acceptance work. No real account or agent was used in development checks.

`node apps/desktop/scripts/check-setup.mjs` runs the production React components in Chromium and
WebKit against synthetic command responses. It covers the centred layout at two window sizes,
passive detection and the roster, keyboard progression, resume (including the retired motion step),
completion/restart/skip, a failed setup save after project creation, minimum viewport,
reduced-motion intro bypass, warm startup, and accessibility. Core unit tests independently verify
the actual storage behavior. Screenshots are written to `target/setup-browser/`.
