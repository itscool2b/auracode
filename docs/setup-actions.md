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

## Cloning a repository

Setup's first-project step and New project both offer Clone a repository. The person pastes an
address, chooses the folder it goes into and sees the exact command before anything runs:
`git clone --progress -- <address> <folder>`, with the Git executable found on this computer.

**Addresses.** Rust accepts `https://host[:port]/path`, `ssh://[user@]host[:port]/path` and
scp-like `user@host:path` (git@github.com:owner/repository.git); a pasted `github.com/owner/repo`
gets its `https://`. Everything else is refused with its reason in one sentence: `http://` and
`git://` are unencrypted, `file://` and local paths belong to Choose a folder, transports such as
`ext::` and `fd::` run commands, a user name or token in an https address would be stored in the
clone's configuration, `?` and `#` parts and GitHub pages inside a repository (`/tree/main`) are
not repositories, and hosts or paths that start with a hyphen could be read as options. The folder
name defaults to the repository's own (Git's choice) and must be one portable name.

**Checking is inert.** Every change to the form asks Rust again (typing waits 200ms) and Rust
answers with the first problem beside its field (address, folder, name or Git) or a review that
holds the exact program, arguments and destination for ten minutes. Answers for an older form are
dropped and their reviews released; each window keeps at most eight. No folder is created and
Git does not run until Clone.

**The person's own Git.** Git runs with the person's own configuration, credential helpers, SSH
keys and agent, exactly as in their terminal. auracode never reads, stores or passes credentials.
It removes only the variables that would point Git at another repository (`GIT_DIR`,
`GIT_WORK_TREE` and the like) and sets `GIT_TERMINAL_PROMPT=0`, because no terminal is attached:
a helper with its own window (Git Credential Manager, the macOS keychain) still answers, and a
missing sign-in fails with a reason instead of waiting forever.

**The one folder auracode owns.** Start creates the destination itself, atomically, so an
existing folder of that name, even an empty one, is refused and never reused. Git clones into
it. Progress streams from Git's `--progress` lines (stage, the whole clone's percentage and what
has arrived) through a long poll that answers at each change. Cancel, closing the form, the page
going away or quitting stops Git's whole process tree; only after the stop is confirmed does Rust
remove the unfinished folder, and only while the parent is still the chosen folder and the name
still holds the folder created at start. A failed clone is removed the same way, and keeps Git's
last eight lines (never logged) under a plain reason: sign-in, not found, untrusted SSH host,
unreachable server, full disk, path too long or unwritable folder. A finished clone is checked
to hold `.git` and becomes the project: at once in setup, through Create project in New project.
A clone still running after two hours is stopped. If auracode itself ends mid-clone, the
unfinished folder stays; the next clone with that name says the folder already exists.

The Git behavior follows the official [clone documentation](https://git-scm.com/docs/git-clone)
and [environment variables](https://git-scm.com/docs/git#_environment_variables). Rust tests
clone a local bare repository through a `file://` URL with an empty Git configuration (the form
itself refuses `file://`), fail on a missing repository, cancel against a server that never
answers, and remove a folder holding read-only pack files while keeping one put in its place.
