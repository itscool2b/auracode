# Agent accounts

A Claude subscription has usage limits. When a chat reaches one, its work should not stop with it.
So auracode lets a profile add more Claude Code accounts beside Claude Code's own sign-in. A chat
stopped at a limit then continues on another account, in the same conversation with all its
history.

## How Claude Code runs on an added account

Each added account is a token from `claude setup-token`. That command runs the same browser
sign-in as `/login`, prints a token valid for one year and saves nothing itself. Claude Code reads
the token from `CLAUDE_CODE_OAUTH_TOKEN` (the
[authentication docs](https://code.claude.com/docs/en/authentication), checked 2026-11-01).

Claude Code also supports separate `CLAUDE_CONFIG_DIR` folders, one per account. auracode does not
use them: each folder has its own settings and session history, so a chat started under one account
could not resume under another. With a token, every account runs in the same configuration folder.
History, settings, MCP servers, plugins and skills are shared, and a switch is a restart that
resumes the same session id (`--resume`).

A start on an added account:

- **Sets** `CLAUDE_CODE_OAUTH_TOKEN` to that account's token.
- **Leaves out** the credentials Claude Code would prefer over the token:
  - `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY`.
  - `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and `CLAUDE_CODE_USE_FOUNDRY`.

  Without that, a key in the shell would quietly keep billing it instead.
- **Does not override** two things that still take precedence:
  - An `apiKeyHelper`.
  - A settings file's own `env` block.
- **Affects MCP servers** that Claude Code starts on that account: they do not see the variables
  that were left out either.

A start on Claude Code's own sign-in passes the environment unchanged, as before.

The token can only make model requests (the docs say so). On an added account:

- Remote Control and claude.ai connectors do not work.
- MCP servers configured locally work.

## Where things are kept

**`agent-accounts.json`** in the profile folder holds, per agent:

- The accounts: id, name and when each was added.
- The account new starts use.

It never holds a token. Only local profiles take added accounts: an account profile keeps all of
its files encrypted, and this file is not encrypted yet.

**Tokens** are in the system's secure storage:

- Credential Manager on Windows; the login keychain on macOS.
- Elsewhere there is none, and accounts cannot be added.

Details:

- Each token is one entry in the `auracode.agents.v1` service. Its name is a digest of the
  account's UUIDv7 id, so it names no account, email or folder.
- The sync key review (`auracode.sync.v1`) never sees these entries.
- **Removing an account** removes its token first. If that fails, the account stays listed so the
  removal can be retried.
- **Deleting all auracode data, or uninstalling,** reads the account ids from every profile being
  deleted, then removes their tokens. A token that cannot be removed is named in the report.

Nothing logs a token. The session redactor gets each token as a secret literal, and its `sk-ant-…`
shape rule covers the rest. Commands never return a token, and errors never contain one.

## Choosing and switching

**On the Agents page,** Claude Code's details show:

- **Account:** which account chats sign in with when they start.
- **The added accounts,** each with Remove (it asks once more).
- **Add account,** which:
  1. Opens a dialog with three steps.
  2. Runs `claude setup-token` in the owned terminal sheet after its separate Start.
  3. Takes a name and the pasted token. The token is checked for the `sk-ant-oat` shape; line
     breaks a terminal copy adds are removed, and an API key is refused by name.

A running chat keeps the account it started on until it starts again. Choosing an account never
restarts anything.

**When Claude Code reports its usage limit,** the Claude driver passes it on as the limit with its
reset time. Claude Code 2.1.316 marks both its own limit message and the turn's result with
`"api_error": "usage_limit_reached"`. Then:

- **The prompt is held.** The failed prompt goes back into the queue, held (`usage_limit`).
- **The process keeps running.** Waiting for the reset and sending the held prompt still works.
- **No assistant message.** Claude Code's own limit text does not appear as one; the failed turn's
  error card carries it.
- **The chat shows a card** with Claude Code's words and:
  - Continue with each other account, including Claude Code's own sign-in when the chat ran on an
    added one.
  - Add account.

**Continue with an account:**

1. Makes it the account Claude Code starts on.
2. Starts this chat's agent again on it, resuming the same session.
3. Releases the held prompts, which go once it is ready.

A switch never cuts a turn short. Other chats keep their account until they start again.

A chosen account whose token cannot be read fails the start, and the error names the account. It
never falls back to another account.

**When Claude Code refuses an added account's token** (it expired a year after it was made, was
revoked, or was mistyped), the usual sign-in card would be wrong: its vendor sign-in signs in
Claude Code's own account. Instead:

- The message names the refused account.
- The card offers Continue with the other accounts, and Add account.
- The failed prompt waits, held.

The chat keeps the id of the account its last start used, so this works after the process stops.

## Not covered

- **Codex.** Codex keeps each sign-in's threads in that sign-in's home (`CODEX_HOME`). This
  install's thread store is a database of about 1 GB. A second Codex account could not continue a
  chat, so the Agents page says so. Handing the chat off to another agent is the way on there.
- **Other agents.** They have no documented per-process token, so they have no added accounts.
- **Automatic switching.** auracode never switches accounts on its own. Moving on to another
  subscription at a limit is the person's choice, made in the card.

## Verification

- **Rust:**
  - The account store: add, choose, remove, a missing token, damaged and newer files.
  - Token entry names.
  - The cleanup's account ids.
  - The Claude driver on the frames from a real 5-hour limit.
  - Three session tests on scripted drivers:
    - A limited chat holds its prompt, keeps its process, then continues on another account. The
      restart has the token, has no `ANTHROPIC_API_KEY`, resumes the same session and resends the
      prompt.
    - A refused token names the account and offers no vendor sign-in.
    - A chosen account without its token never starts.
- **`check-accounts.mjs`** runs the production components in Chromium and WebKit, light and dark,
  with axe:
  - Add account, with its token sheet, a refused API key and a token broken over two lines.
  - The choice, and Remove.
  - The limit card's switch.
  - The no-secure-storage case.
  - The Agents page.
- **Not covered:** no real token or Claude subscription was used. A real account switch is the
  owner's to try.
