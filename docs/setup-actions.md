# Explicit setup actions

## Native agents

The Agents and onboarding screens offer reviewed npm installation for missing native Claude,
Codex and Pi integrations on Windows and macOS. The versions match the catalog's acceptance pins:
Claude 2.1.310, Codex 0.162.1 and Pi 1.0.2. These are integration pins, not a claim that the full
current milestone or every platform has passed real-agent acceptance.

Reviewing an installation inspects only executable/package metadata. It does not install, sign in,
read npm configuration or read agent state. Rust resolves Node plus npm's actual `bin/npm-cli.js`,
checks the npm package name, and presents the exact program, argument vector and working directory.
The Start action refreshes detection and checks the reviewed paths, arguments and executable bytes.
It refuses an agent that is no longer missing. No shell shim, command interpolation, administrator
elevation or execution-policy override is used.

The explicit action runs npm in the existing owned, unlogged terminal. npm itself uses its ordinary
global prefix and configuration. A user must have a suitable Node/npm installation and permission
to write that prefix. Closing the sheet, closing/reloading its page or reaching ten minutes stops
only the owned installer tree. A failed or canceled installation can leave a partial npm package;
the app preserves npm's files and offers normal refresh/review instead of deleting them. Success
does not imply authentication or availability until detection has checked the installed agent.

Sources checked 2026-10-26:

- [Claude installation documentation](https://code.claude.com/docs/en/setup#install-with-npm)
  documents `npm install -g @anthropic-ai/claude-code` and its required optional native packages
  and postinstall step. Its install keeps lifecycle scripts enabled.
- [Codex 0.162.1 README](https://github.com/openai/codex/blob/rust-v0.162.1/README.md)
  documents `npm install -g @openai/codex` as a supported package-manager installation.
- [Pi 1.0.2 README](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/README.md)
  documents `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, requiring
  Node 22.19 or newer. Pi keeps that explicit script restriction.

Other providers retain their official installation guides until a reviewed installer is available.
Fresh Node/npm installation and vendor authentication are separate user actions. Development tests
use synthetic packages, fake browser replies and a harmless local terminal child, never a real
installer or sign-in command.

## GitHub clone

The first-project step accepts GitHub HTTPS repository URLs and GitHub SSH URLs with the `git`
user. Validation rejects credentials, query text, custom ports, branch paths, other hosts and
external transports. The user chooses a parent with the native folder picker and supplies a new
portable folder name. A one-use review lasts ten minutes and belongs to its originating window.

Start atomically creates the destination. Existing paths, even empty folders or links, are refused.
Before that create, an immutable started record is flushed in a new sibling
`.auracode-clone-<uuid>` directory. A collision after the record is written can therefore leave an
interrupted receipt without having created its target. A receipt never authorizes deletion or
claims that every file in its destination belongs to auracode. There is no destructive recovery
operation. Interrupted, canceled and failed folders stay for inspection; retry requires another
explicit new name. Selecting the same parent shows bounded recovery history. A completed clone can
be selected as the first project without cloning it again after a database-save failure.

Rust runs Git through the production raw owned-process spawner with a fifteen-second startup limit
and ten-minute operation limit. Cancel, page reload and ordinary quit reach the owned job. Folder
reservations remain held through process-tree cleanup and durable outcome recording. An
unconfirmed shutdown is reported as cleanup pending, with explicit process-layer confirmation
retries. It is never treated as successful cleanup just because the leader exited.

Git receives an isolated global/system configuration, empty hook/template directories, no inherited
Git environment, no submodule recursion and only HTTPS/SSH transports. HTTPS cloning is public-only
because credential helpers and prompts are disabled. Private clones can use SSH access already
configured in the user's tools, with batch mode and strict host-key checking. Auracode does not
read keys, credential files or GitHub CLI authentication, and never changes authentication. Git
output is unlogged, bounded and reduced to authentication/network/disk/other failure messages.

The Git behavior follows the official [clone documentation](https://git-scm.com/docs/git-clone),
[configuration isolation variables](https://git-scm.com/docs/git) and
[transport policy](https://git-scm.com/docs/git-config#Documentation/git-config.txt-protocolallow).
Development fixtures use temporary directories and synthetic replies, with no remote clone.
