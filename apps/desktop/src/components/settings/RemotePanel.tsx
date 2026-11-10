import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { encode } from "uqr";
import type { RemoteBotLink, RemoteDevice, RemotePairing, RemoteStatus } from "../../bindings";
import { ago, linkLabel, type RemoteApi, remaining, remoteApi } from "../../lib/remote";
import { Modal } from "../chat/Modal";
import { Row, Switch } from "./SettingsRow";
import "./remote.css";

const message = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong.";

/**
 * Settings' Remote access page: the switch, the devices paired with this computer and the bots
 * linked to it (docs/remote-sessions.md). Pairing and linking each show their secret once, in a
 * dialog; the lists never repeat it.
 */
export function RemotePanel({ api = remoteApi }: { readonly api?: RemoteApi }) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  /** The devices that were paired when the pairing dialog opened: a new one ends it. */
  const [before, setBefore] = useState<readonly string[]>([]);
  const [linking, setLinking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    api.status().then(
      (value) => {
        if (live) setStatus(value);
      },
      (failure) => {
        if (live) setError(message(failure));
      },
    );
    const stop = api.subscribe((value) => {
      if (live) setStatus(value);
    });
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  // "Last seen 3 min ago" keeps telling the truth while the page stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = useCallback(async (action: () => Promise<RemoteStatus>) => {
    setError(null);
    try {
      setStatus(await action());
    } catch (failure) {
      setError(message(failure));
    }
  }, []);

  /** Pairing and linking need remote access on: asking for either turns it on. */
  const ensureOn = useCallback(async () => {
    if (status?.enabled) return;
    setStatus(await api.setEnabled(true));
  }, [api, status]);

  const pair = async () => {
    setError(null);
    try {
      await ensureOn();
      setBefore((status?.devices ?? []).map((device) => device.id));
      setPairing(await api.pair());
    } catch (failure) {
      setError(message(failure));
    }
  };

  const link = async () => {
    setError(null);
    try {
      await ensureOn();
      setLinking(true);
    } catch (failure) {
      setError(message(failure));
    }
  };

  const enabled = status?.enabled ?? false;
  const paired = pairing
    ? (status?.devices.find((device) => !before.includes(device.id)) ?? null)
    : null;

  return (
    <>
      <p className="settings-lead">
        See and steer this computer's chats from your phone, or let a bot work with them. auracode
        connects out to its relay; nothing on this computer listens for connections.
      </p>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-group">
        <Row title="Remote access" detail={status ? linkLabel(status) : "Checking…"}>
          <Switch
            label="Remote access"
            checked={enabled}
            disabled={status === null}
            testId="remote-enabled"
            onChange={(value) => void run(() => api.setEnabled(value))}
          />
        </Row>
      </div>

      <section className="settings-section" aria-labelledby="settings-remote-devices">
        <h2 id="settings-remote-devices">Devices</h2>
        <div className="settings-group">
          {(status?.devices ?? []).map((device) => (
            <Row
              key={device.id}
              title={device.name}
              setting="Devices"
              detail={
                device.connected ? "Connected now" : `Last seen ${ago(device.last_seen_at, now)}`
              }
            >
              <button
                className="g-button g-button-outline g-button-28"
                type="button"
                aria-label={`Remove ${device.name}`}
                onClick={() => void run(() => api.removeDevice(device.id))}
              >
                Remove
              </button>
            </Row>
          ))}
          <Row
            title="Pair a device"
            detail="Shows a link and a code to scan with your phone. It opens once, within ten minutes."
          >
            <button
              className="g-button g-button-outline g-button-28"
              type="button"
              data-testid="remote-pair"
              disabled={status === null}
              onClick={() => void pair()}
            >
              Pair
            </button>
          </Row>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-remote-bots">
        <h2 id="settings-remote-bots">Bots</h2>
        <div className="settings-group">
          {(status?.bots ?? []).map((bot) => (
            <Row
              key={bot.id}
              title={bot.name}
              setting="Bots"
              detail={`${bot.full ? "Full control" : "Chats"} · ${
                bot.last_used_at === null
                  ? "Not used yet"
                  : `Last used ${ago(bot.last_used_at, now)}`
              }`}
            >
              <button
                className="g-button g-button-outline g-button-28"
                type="button"
                aria-label={`Remove ${bot.name}`}
                onClick={() => void run(() => api.removeBot(bot.id))}
              >
                Remove
              </button>
            </Row>
          ))}
          <Row
            title="Link a bot"
            detail="Gives Grok Bot, or any assistant that connects to MCP servers, tools to read your chats, message your agents and answer their requests."
          >
            <button
              className="g-button g-button-outline g-button-28"
              type="button"
              data-testid="remote-link-bot"
              disabled={status === null}
              onClick={() => void link()}
            >
              Create link
            </button>
          </Row>
        </div>
      </section>
      <p className="settings-footnote">
        A paired browser's session is encrypted end to end: the relay passes it along and cannot
        read it. A bot's calls are not: the relay and the bot's own service read them, and either
        could act as that bot. Remote access works while auracode is open, including in the tray.
      </p>

      {pairing ? (
        <PairingDialog
          pairing={pairing}
          paired={paired}
          onRenew={() => void pair()}
          onClose={() => {
            setPairing(null);
            if (!paired) void run(() => api.cancelPairing());
          }}
        />
      ) : null}
      {linking ? (
        <BotDialog
          create={(name, full) => api.createBot(name, full)}
          onClose={() => {
            setLinking(false);
            void run(() => api.status());
          }}
        />
      ) : null}
    </>
  );
}

/** A QR code as one SVG path: dark modules on white, whatever the app's appearance. */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, path } = useMemo(() => {
    // Four modules of quiet space on every side, as scanners expect.
    const code = encode(text, { ecc: "M", border: 4 });
    let d = "";
    code.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: code.size, path: d };
  }, [text]);
  return (
    <svg
      className="remote-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}

function CopyField({ value, label }: { readonly value: string; readonly label: string }) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const field = useId();
  useEffect(
    () => () => {
      if (reset.current !== null) clearTimeout(reset.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (reset.current !== null) clearTimeout(reset.current);
    reset.current = setTimeout(() => setState("ready"), 1600);
  };
  return (
    <div className="remote-copy">
      <label className="sr-only" htmlFor={field}>
        {label}
      </label>
      <input
        id={field}
        className="g-input remote-secret"
        readOnly
        value={value}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button className="g-button g-button-outline" type="button" onClick={() => void copy()}>
        <span aria-live="polite">
          {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy"}
        </span>
      </button>
    </div>
  );
}

function PairingDialog({
  pairing,
  paired,
  onRenew,
  onClose,
}: {
  readonly pairing: RemotePairing;
  readonly paired: RemoteDevice | null;
  readonly onRenew: () => void;
  readonly onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = pairing.expires_at <= now;
  return (
    <Modal title="Pair a device" onClose={onClose}>
      {paired ? (
        <>
          <p className="remote-result" role="status">
            Paired with {paired.name}. It can open your chats from now on, without another link.
          </p>
          <div className="g-dialog-actions">
            <button className="g-button g-button-primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : expired ? (
        <>
          <p className="remote-result" role="status">
            This link expired before a device opened it.
          </p>
          <div className="g-dialog-actions">
            <button className="g-button" type="button" onClick={onClose}>
              Close
            </button>
            <button className="g-button g-button-primary" type="button" onClick={onRenew}>
              New link
            </button>
          </div>
        </>
      ) : (
        <>
          <QrCode text={pairing.url} label="Pairing code" />
          <p className="remote-note">
            Scan it with your phone's camera, or open the link in the browser of the device you want
            to pair.
          </p>
          <CopyField value={pairing.url} label="Pairing link" />
          <p className="remote-note" data-testid="remote-pairing-time">
            Opens once, for another {remaining(pairing.expires_at, now)}. Whoever opens it first can
            read and steer this computer's chats, so keep it to yourself.
          </p>
        </>
      )}
    </Modal>
  );
}

function BotDialog({
  create,
  onClose,
}: {
  readonly create: (name: string, full: boolean) => Promise<RemoteBotLink>;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("Grok Bot");
  // What the link may do is chosen here and is the link's for good: a wider one is a new link.
  const [full, setFull] = useState(false);
  const [link, setLink] = useState<RemoteBotLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await create(name, full));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Link a bot" onClose={onClose}>
      {link ? (
        <>
          <p className="remote-note">
            This is {link.name}'s address. It is shown once and works like a password: anyone who
            has it can read your chats and direct your agents. Removing the link here stops it.
          </p>
          <CopyField value={link.url} label="Bot address" />
          <ol className="remote-steps">
            <li>
              In Grok, open Connectors (grok.com/connectors), choose New Connector, then Custom.
            </li>
            <li>Paste this address as the MCP server URL.</li>
            <li>Ask your bot to list your auracode chats.</li>
          </ol>
          <p className="remote-note">
            Other assistants work the same way: add it wherever they take a remote MCP server.
          </p>
          <div className="g-dialog-actions">
            <button className="g-button g-button-primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="remote-note">
            A linked bot gets tools to direct your agents, and agents can edit files and run
            commands. So either level below is as much trust as handing someone this computer: the
            level limits the bot's own tools, not what an agent it directs can do.
          </p>
          <fieldset className="remote-levels">
            <legend>What it can do</legend>
            <label className="remote-level">
              <input
                type="radio"
                name="remote-bot-level"
                checked={!full}
                onChange={() => setFull(false)}
              />
              <span>
                <strong>Chats</strong>
                <span>
                  List and read your chats, send messages, start chats, stop turns and answer
                  permission requests.
                </span>
              </span>
            </label>
            <label className="remote-level">
              <input
                type="radio"
                name="remote-bot-level"
                checked={full}
                onChange={() => setFull(true)}
              />
              <span>
                <strong>Full control</strong>
                <span>
                  Everything in Chats, and what you do in this window: make a project from any
                  folder on this computer, choose a chat's model and thinking, set its access level
                  (full auto included), start a stopped agent, hand a chat to another agent, rename
                  and archive chats, read a turn's file changes, and read and write project memory,
                  which every later chat in that project starts with. It has no tool for Settings,
                  sign-in, installing software or deleting data.
                </span>
              </span>
            </label>
          </fieldset>
          <label className="settings-field" htmlFor={field}>
            <span>Name</span>
            <input
              id={field}
              className="g-input"
              value={name}
              maxLength={48}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions">
            <button className="g-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="g-button g-button-primary" type="submit" disabled={busy}>
              Create link
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
