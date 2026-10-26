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
