# Remote sessions

A person sees and steers the chats on their computer from a phone's browser, and a bot (Grok Bot,
or any assistant that connects to MCP servers) can do the same through tools. The computer opens
no port: auracode keeps one outbound WebSocket to a relay, and everything else reaches it through
that.

It is off until turned on in Settings > Remote access, and it works while auracode is open,
including in the tray.

## What a person does

1. **Settings > Remote access > Pair.** A dialog shows a code to scan and the same link as text.
   The link opens once, within ten minutes. Asking for it turns remote access on.
2. **Open the link on the other device.** `auracode.si/remote` pairs, takes the key out of the
   address bar, and lists the computer's chats by project. From then on that browser opens the
   page without a link.
3. **Use it.** Open a chat to follow it live, send a message (it queues behind a running turn, as
   in the app), stop a turn, answer a permission request or a question, start a chat in a
   project's folder.
4. **Remove a device** in Settings, or "Forget this computer" on the page. Either ends every
   session of that device at once.

For a bot: **Settings > Remote access > Create link** names the bot and shows one MCP address,
once. In Grok that address goes in grok.com/connectors > New Connector > Custom. The bot then has
eight tools: `list_chats`, `list_projects`, `read_chat`, `send_message`, `wait_for_chat`,
`respond_to_request`, `stop_chat`, `start_chat` (`apps/relay/src/tools.json`).

## The parts

| Part | Where | What it does |
|---|---|---|
| Relay | `apps/relay` (Worker `auracode-relay`, route `auracode.si/api/remote/*`) | One Durable Object per computer holds its host socket and the browsers' sockets and forwards between them. Serves MCP to bots. |
| Service | `crates/aura-remote` | Pairing links, devices and bot links (`registry.rs`), the sealed channel (`crypto.rs`), one session per browser (`host.rs`, `host/session.rs`), bot tools (`bot.rs`, `render.rs`), the socket (`relay.rs`). |
| App | `apps/desktop/src-tauri/src/remote.rs` | Starts the service, gives it the open profile's chats through the same lease a window's commands take, and exposes the commands Settings uses. |
| Settings page | `apps/desktop/src/components/settings/RemotePanel.tsx` | The switch, devices, bots, and the two dialogs that show a secret once. |
| Remote page | `apps/web/app/pages/remote.tsx`, `apps/web/app/remote/` | The browser's session (`client.ts`), its half of the channel (`channel.ts`), where device keys are kept (`storage.ts`). |

The remote page folds a chat with the desktop app's own reducer
(`apps/desktop/src/lib/chat/transcript.ts`), from the same events the app's window gets, so a turn
reads the same in both.

The relay is TypeScript, where the rest of the Workers are Rust: Durable Object WebSocket
hibernation is native there, and the relay holds no logic worth sharing, only forwarding. Every
decision about who may do what is made in Rust on the computer.

## Who is trusted with what

- **The computer decides everything.** It checks each browser's key and each bot's token itself.
  Nothing the relay says is believed without that.
- **A paired browser's session is sealed end to end.** The relay carries messages it cannot read,
  change, reorder or replay. A relay that turned hostile could drop messages or refuse service,
  and nothing more.
- **A bot's calls are not sealed.** A bot speaks MCP over HTTPS to the relay, so the relay reads
  each call and answer in passing, as does the bot's own service. The Settings page says so. The
  computer still checks the bot's token on every call, so a relay cannot invent a bot.
- **A device or a bot link reaches one workspace**: the profile that was open when it was made
  (Local, or an account's). `remote.json` is the installation's, but each record names its
  profile, and the computer accepts a key or a token only while that profile is the open one.
  When another profile opens, browsers are told to start over, the other profile's sessions end,
  an open pairing link closes, and the relay is given only the open profile's bot links, so the
  others' addresses answer 404. A refused browser is told the computer has another workspace
  open (`elsewhere`) and keeps its key for when its own is open again. Settings lists the open
  workspace's devices and bots only. With no profile open, nothing is accepted.
  The same binding holds at the point of use: a session keeps the profile its key was accepted
  under, a bot call the profile its token was, and every call into the app's chats is made
  through `Backend::bound(profile)`. The app hands out a profile's chats only while that profile
  is the open one, reading both under the lock a switch takes (`AppState::sessions_of`). So in
  the moment between the app opening another profile and the service hearing of it, a session of
  the old profile is refused rather than served the new one's chats.
- **Anyone holding a device key or a bot address controls the chats**, and agents can edit files
  and run commands. There are no narrower permissions yet: pair your own devices, and link only
  a bot you would trust at the keyboard.

### Pairing and keys

A pairing link is `https://auracode.si/remote#<computer id>.<pairing id>.<key>`: 16, 8 and 32
random bytes, base64url. The key is in the fragment, which browsers never send to a server; the
page reads it once and removes it from the address bar and history before connecting. The pairing
lives in the computer's memory only, opens once, expires after ten minutes, is replaced by the
next link, and closes after eight sessions that fail to prove its key.

Pairing creates a device: an id and a fresh 32-byte key, sent to the browser inside the pairing
session. The browser imports it as a WebCrypto key that cannot be exported and stores that key
object in IndexedDB, so a script on the origin can use it and none can read it out. The computer
keeps device keys, and only the SHA-256 of each bot token, in `remote.json` in the data folder,
beside the chats themselves and readable by the same user.

### The sealed channel

Both sides hold one 32-byte secret: the pairing key, or the device key.

1. The browser sends `H{ v, kind, id, nonce }` with a fresh 16-byte nonce.
2. The computer finds the key for that id, answers `W{ v, nonce }` with its own nonce, and derives
   two AES-256-GCM keys with HKDF-SHA256 (salt: both nonces; info: one label per direction).
3. Each side numbers its messages from zero. The number is the nonce, and the associated data
   names the credential (`pair|<id>` or `device|<id>`), so a message opens only as the next one,
   from the other side, under that credential.
4. The computer's first sealed message is `ready`. Opening it proves the computer holds the key.
   The browser's first sealed message proves the same the other way, and only then does the
   computer tell the relay the browser is accepted.

The browser accepts exactly one welcome per hello and one `ready` per session, so a replayed
welcome can never restart a key's numbering. Anything that fails to open, arrives out of order,
or is not one of the operations ends the session. `crates/aura-remote/tests/vectors.json` holds
vectors both implementations are tested against.

A refusal (`R`) is not sealed, since there may be no key to seal it with. So it deletes nothing:
the page says the computer no longer accepts this browser and lets the person try again or forget
it.

### What the relay stores and limits

Per computer: the hash of the key that first claimed its id, and the hashes of its bot tokens.
No D1, R2, KV or secrets.

- A host socket needs the key whose hash claimed the id, and may not come from a browser.
- A browser socket must come from the site's origin. Until the computer accepts it, it is one of
  at most eight unproven sockets (three per address), and a newcomer replaces the oldest: knowing
  a computer's id cannot keep a paired browser out. Accepted browsers are never replaced; after
  the computer reconnects they have thirty seconds to be accepted again.
- A browser sends at most 96 KiB per message and 240 messages per ten seconds.
- A wrong or removed bot address is a plain 404. At most eight bot calls wait at once, each for
  at most 55 seconds.

The computer also ends any connection that has not proved a key within twenty seconds, holds at
most 32 connections, 16 running calls per browser and 8 running bot calls, and stops sending live
events to a browser that falls 4 MiB behind (the page then opens the chat again).

## Operations a browser can ask for

`pair`, `overview`, `open`, `close`, `history`, `send`, `interrupt`, `permission`, `answer`,
`create`, `forget` (`crates/aura-remote/src/wire.rs`). Each maps to the session manager call the
app's own window makes; there is no file, terminal, settings or account access. A new chat starts
in the project folder itself with the project's usual agent.

The computer pushes `chat` (a status changed), `frame` (live events of the followed chat), `lost`
(open the chat again) and `reset` (another profile was opened: start over).

## Running and testing it

- **Deploy:** `corepack pnpm --filter @auracode/relay exec wrangler deploy --env production`
  (and `--env preview`). The route `auracode.si/api/remote/*` is more specific than the API's
  `auracode.si/api/*`, so those requests reach the relay.
- **Development:** a debug build reads `AURACODE_REMOTE_RELAY` (for example
  `ws://127.0.0.1:8799`) and `AURACODE_REMOTE_SITE` together; release builds reach only
  auracode's own relay. A page served from `localhost` accepts `?relay=ws://127.0.0.1:<port>`.
- **Tests:**
  - `corepack pnpm --filter @auracode/relay worker:test`: the relay in the Workers runtime.
  - `cargo test -p aura-remote`: the service against a relay on this machine, with a simulated
    browser and bot.
  - `corepack pnpm --filter @auracode/web test`: the browser's channel against the shared
    vectors, and the page's headers.
  - `apps/desktop/scripts/check-remote.mjs` (part of `check:settings`): the Settings page.
  - `corepack pnpm --filter @auracode/relay worker:e2e`: everything together on this machine.
    It needs the website built and `cargo build -p aura-remote --example demo_host`, a stand-in
    computer with a scripted agent.
  - `node apps/relay/tests/native.mjs <auracode.exe> [--prompt]`: the real debug app in a data
    folder of its own, paired from a separate browser and called by an MCP client. `--prompt`
    also runs a turn through the development build's scripted agent.

## Not done

- Notifications on the phone when a chat needs an answer.
- Narrower permissions for a device or a bot (read only, no new chats).
- New chats in a worktree, attachments, images and the queue's own controls from the page.
- A bot link that is sealed end to end: it would need the bot to run a program of ours.
