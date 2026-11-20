# The name

The product is **o7**, at [o7.codes](https://o7.codes). Until 19 November 2026 it was called
auracode, and "Aura" for short. The owner asked for the old name to go everywhere; this page says
how far that has gone, what still carries the old name, and why each of those is not a plain
find-and-replace.

Write "o7", lowercase, wherever a person reads the name: the website, the app's text, a window
title, an error, a tool's description, the docs.

## Done: the name people read

The website, the app's text, its window title and tray, the uninstaller's words, what agents and
bots are told about the app, and the docs. The default theme is still called Aura: that is a
theme's name, not the product's.

Dated history keeps the name of its day: older changelog entries, `docs/progress.md`, the design
notes and spikes, the older sections of `infra/README.md`, and recorded agent sessions in test
fixtures. So do the Design Lab's studies, which are history too.

## Not renamed, on purpose: what the app reads back

These are written to disk, into Git or into a saved chat by one version and recognised by a later
one. Renaming one makes an updated app stop recognising what it wrote before.

| Name | Where | What breaks if it changes |
|---|---|---|
| `auracode <id>`, `auracode retired <id>` | a Git worktree's lock reason | the app no longer knows its own worktrees |
| `auracode checkpoint`, `auracode before-turn checkpoint` | a checkpoint commit's author and message | earlier checkpoints are not found |
| `[auracode project event]` | the start of a message a coordinator is sent | events already in a chat read as plain messages |
| `Project memory (Aura reference context, revision ` | the start of the memory attached to a message | old messages show the whole memory instead of folding it |
| `auracode remote v1 ...` | the labels the remote channel's keys are made from | a paired phone and a computer on different versions cannot talk |
| `auracode-remote` | the phone browser's key store | every phone is unpaired |
| `auracode://` | a link scheme earlier versions registered | the uninstaller would not find and remove it |

## Not renamed yet: internal names

Package names (`@auracode/*`), crate names (`aura-*`), setting names (`AURACODE_*`, `AURA_*`), CSS
classes and style tokens, tool and server names agents see (`aura_browser`, `aura_memory_read`).
Nobody using the app reads these. Renaming them is mechanical but touches most files, and two of
them are contracts: a setting name is used by people's scripts, and a tool name is in agents'
saved permissions.

## Not renamed yet: the install's identity

The program is still `auracode.exe`, installed under `auracode`, with its data in
`si.auracode.desktop`, published from the `auracode` repository by Workers named `auracode-*`.
Each of these is how an installed copy finds itself:

- **The product name** decides the install folder and the registry key the installer looks
  under. An update carrying a new one installs beside the old copy instead of over it, and the
  running copy restarts into the old program: it would never update again.
- **The identifier** is the data folder. Every chat, setting and Git worktree lives under it, and
  worktrees record their folder's full path. A new identifier starts empty unless the folder is
  moved and every worktree repaired.
- **The repository's name** is in the address every installed copy checks for updates. GitHub
  redirects a renamed repository, until something else takes the old name.
- **A Worker's name** owns its Durable Objects: a relay under a new name starts with no rooms.

Renaming these needs a migration that is tested on a real install on each system, with the
owner at the computer, not a rename pushed out through the updater.
