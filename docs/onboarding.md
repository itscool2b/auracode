# Setup and agent management

Setup progress is profile-local Rust state in `onboarding.json`. It contains only the current step,
motion preference, completion, boot-seen marker and selected project ID. Commands are serialized,
revision checked and acknowledged after an atomic write. Invalid data is preserved separately;
future formats are left unchanged. A failed save remains visible and can be retried or bypassed
without claiming success. Re-running setup preserves the user's motion and project selection.

The desktop loads cached detection while presenting the intro: the o7 logo and wordmark,
1.8 seconds on a cold start and 240 ms on a warm boot. Escape, Enter or Skip intro ends it early;
reduced motion shows the formed mark at once, and notification chat navigation bypasses it.
Smoke/stress launches do not enter setup. No vendor login, install, update or model prompt is
triggered by opening setup or Agents; each installed agent's sign-in is checked with its own status
command (owner, 17 November 2026: an agent that needed a sign-in did not say so until "Check
sign-in" was found in a menu). Sign in opens the existing terminal sheet whose Start action is
separately explicit, and the sign-in is checked again when the sheet closes.

Setup is three steps (Welcome, Your agents, First project) in one calm, centred column on one card
(docs/design/visual-language.md). Every step is
skippable: Continue never requires anything, the progress bars visit any step and Skip setup
finishes from anywhere. The step is saved on every move, so quitting halfway resumes there. Motion is not a
step: Full already follows the system's reduced motion and Settings changes it; a setup saved at
the retired motion step resumes at First project. So does one saved at the sign-in step setup
had while o7 had accounts (removed on 16 November 2026). Keyboard focus moves to each step's heading.
Enter advances except inside controls, editable content, menus and dialogs. Motion preferences
also stop the shared frame clock, rather than merely hiding its animation with CSS.

Welcome says it plainly: o7 itself needs no account or network, and each agent keeps its
own sign-in. Setup offers no account and no sign-in of o7's own.

First project offers a folder (chosen or dropped), an existing project, or Clone a repository,
which replaces the step's content in place, X Money style: "Clone a repository." / "Git copies it
into a new folder.", the address, where it goes (the parent folder and the new folder's name,
joined like a path), the exact `git clone` command in a well, then Clone (Enter) and Back
(Escape). While Git runs the heading says "Cloning owner/repository." / "Cancel leaves nothing
behind.", with Git's stage, the whole clone's percentage on a 2px bar, what has arrived and Cancel
clone (Escape). A finished clone becomes the first project at once. A failure says why in one
sentence and keeps Git's own last lines, with Try again (Enter) and Edit (Escape). New project
offers the same clone in a dialog beside Choose folder. The rules (addresses accepted and refused,
the person's own Git and credential helpers, the one folder o7 owns and removes) are in
docs/setup-actions.md.

Reopening the clone form after a restart lists its saved prior attempts. It shows each retained
destination and offers Open folder, Retry in another folder, and Dismiss notice. A validated
completed clone can be added through the normal project flow. Dismissing a notice removes
only its journal record; recovery never deletes the cloned folder or changes the person's files.

Project selection reuses Rust workspace validation. Folder drops only select a path; Add project
performs the write. A project created before a setup-save failure is reused on retry. Existing
projects are available after reload. With no agent found, "Explore the local demo" finishes setup
and opens New chat with the scripted Demo agent chosen.

Agents (6.17a) is one list: a row per harness with its status, version and verified date, at most
one action (Install for the one-click installers, Update when a newer release is known, Sign in
when its check found it needed) and a menu for the rest; setup's compact rows show that action
too. Opening Agents looks up maintenance metadata for installed agents and checks their sign-in;
it never updates or installs by itself.
One-click installs are reviewed, version-pinned npm commands for Claude Code, Codex, Pi, OpenCode 1
and Grok Build. Sign in runs the vendor's own login for Claude Code, Codex, Cursor, Grok Build,
OpenCode and Hermes. Claude Code's details also list the accounts its chats can run on and Add
account ([Agent accounts](agent-accounts.md)). The other agents keep their official guides, each for a stated reason in
docs/setup-actions.md:

- [Claude Code](https://code.claude.com/docs/en/setup), [Codex](https://developers.openai.com/codex/cli),
  [Cursor](https://cursor.com/docs/cli/installation), [Pi](https://pi.dev/docs/latest/quickstart).
- [Grok Build](https://docs.x.ai/build/overview), [oh-my-pi](https://github.com/can1357/oh-my-pi),
  [OpenCode](https://opencode.ai/docs), [OpenCode 2](https://opencode.ai/v2/docs),
  [Antigravity](https://antigravity.google/download),
  [Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/installation).

Still open for acceptance: native macOS/Windows folder-drop and terminal walks through the built
app, and a real clone and a real agent sign-in through the built app. No real agent account was
used in development checks.

`node apps/desktop/scripts/check-setup.mjs` runs the production React components in Chromium and
WebKit against synthetic command responses. It covers the centred layout at two window sizes,
passive detection and the roster, keyboard progression, resume (including the retired motion step),
completion/restart/skip, a failed setup save after project creation, a keyboard clone that becomes
the first project, minimum viewport, reduced-motion intro bypass, warm startup, and accessibility.
`check-setup-actions.mjs` covers installs and the clone dialog (the command before start, a
refused address, cancel, finish, failure and retry, a taken name). Core unit tests independently
verify the actual storage behavior and real clones against a local bare repository. Screenshots
are written to `target/setup-browser/` and `target/setup-actions-browser/`. `?preview=clone`,
`clone-running`, `clone-error`, `new-project` and `agents-installing` show each state for
`check-layout.mjs`.
