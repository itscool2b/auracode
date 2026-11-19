import { Logo } from "@auracode/ui/graphite";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  PermissionOption,
  SessionStatus,
  UiAnswer,
  UiPrompt,
  UiQuestion,
  WorkspaceChat,
} from "../../../desktop/src/bindings";
import {
  type RenderedItem,
  type RenderedSegment,
  renderTranscript,
  stopReasonLabel,
} from "../../../desktop/src/lib/chat/transcript";
import { type OpenChat, type Overview, RemoteClient, type State } from "../remote/client";
import { Markdown } from "../remote/markdown";
import { ChatPickers } from "../remote/pickers";
import { keepsPairings } from "../remote/storage";

export const meta = () => [
  { title: "Remote · auracode" },
  { name: "robots", content: "noindex" },
  { name: "referrer", content: "no-referrer" },
];

/**
 * A pairing link carries its key after the `#`. It is read once and taken out of the address bar
 * and the history before anything else runs, so it is never shared, bookmarked or sent anywhere.
 */
let taken: string | null = null;
function takeFragment(): string {
  if (taken === null) {
    taken = location.hash;
    if (taken) history.replaceState(null, "", location.pathname + location.search);
  }
  return taken;
}

/** The relay is this site. A page served from this machine may name another, for development. */
function relayOrigin(): string {
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const named = local ? new URLSearchParams(location.search).get("relay") : null;
  if (named && /^wss?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(named)) return named;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

export default function RemotePage() {
  const [client, setClient] = useState<RemoteClient | null>(null);
  // A pairing link waits for a tap. Opening the page pairs nothing by itself, so a program that
  // only opens links (a mail or chat scanner) cannot spend the link or become a device.
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    const next = new RemoteClient(relayOrigin());
    const fragment = takeFragment();
    if (fragment.replace(/^#/, "") === "") void next.start("");
    else setAsking(fragment);
    setClient(next);
    const wake = () => {
      if (document.visibilityState === "visible") next.wake();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      next.stop();
    };
  }, []);
  return (
    <main id="main" className="remote">
      {client && asking !== null ? (
        <Centered title="Pair this browser?">
          <p>
            This link pairs this browser with your computer. Once paired, it can read your chats
            there and direct your agents, which can edit files and run commands.
          </p>
          <p>Go on only if you opened this link from your own computer just now.</p>
          <p className="remote-card-actions">
            <button
              type="button"
              className="g-button g-button-primary g-button-44"
              onClick={() => {
                setAsking(null);
                void client.start(asking);
              }}
            >
              Pair this browser
            </button>
            <button
              type="button"
              className="g-button g-button-outline g-button-44"
              onClick={() => {
                setAsking(null);
                void client.start("");
              }}
            >
              Not now
            </button>
          </p>
        </Centered>
      ) : client ? (
        <Remote client={client} />
      ) : (
        <Centered title="Remote">
          <p>Connecting to your computer.</p>
          <noscript>
            <p>This page needs JavaScript: it encrypts everything in your browser.</p>
          </noscript>
        </Centered>
      )}
    </main>
  );
}

function Remote({ client }: { readonly client: RemoteClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  if (state.phase.name === "empty")
    return (
      <Centered title="Reach your computer from here.">
        <p>
          In auracode on your computer, open Settings, then Remote access, and choose Pair. Scan the
          code it shows with this device, or open its link here.
        </p>
        <p>
          <a className="g-button g-button-outline g-button-44" href="/download">
            Get auracode
          </a>
        </p>
      </Centered>
    );
  if (state.phase.name === "ended")
    return (
      <Centered title="This pairing is over.">
        <p role="status">{state.phase.reason}</p>
        {state.phase.refused ? (
          <Refused client={client} hostId={state.phase.refused} />
        ) : state.hosts.length > 0 ? (
          <p>
            <button
              type="button"
              className="g-button g-button-primary g-button-44"
              onClick={() => client.use(state.hosts[0]?.hostId ?? "")}
            >
              Open {state.hosts[0]?.hostName}
            </button>
          </p>
        ) : null}
      </Centered>
    );
  if (state.chat || state.opening) return <ChatScreen client={client} state={state} />;
  return <ListScreen client={client} state={state} />;
}

/** A computer turned this browser away: try again, or delete its key here. */
function Refused({ client, hostId }: { readonly client: RemoteClient; readonly hostId: string }) {
  return (
    <p className="remote-card-actions">
      <button
        type="button"
        className="g-button g-button-primary g-button-44"
        onClick={() => client.use(hostId)}
      >
        Try again
      </button>
      <button
        type="button"
        className="g-button g-button-outline g-button-44"
        onClick={() => void client.discard(hostId)}
      >
        Forget this computer
      </button>
    </p>
  );
}

function Centered({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="remote-centered">
      <a className="remote-mark" href="/" aria-label="auracode">
        <Logo size={56} />
      </a>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** Where the session stands, in a word or two. */
function linkWords(state: State): { readonly text: string; readonly tone: "ok" | "wait" } {
  switch (state.phase.name) {
    case "ready":
      return { text: "Connected", tone: "ok" };
    case "away":
      return { text: "Computer is away", tone: "wait" };
    default:
      return { text: "Connecting", tone: "wait" };
  }
}

function statusWords(chat: WorkspaceChat["chat"]): {
  readonly text: string;
  readonly tone: string;
} {
  if (chat.needs_attention) return { text: "Needs you", tone: "attention" };
  const words: Record<SessionStatus, readonly [string, string]> = {
    running: ["Working", "working"],
    starting: ["Starting", "working"],
    cancelling: ["Stopping", "working"],
    stopping: ["Stopping", "working"],
    ready: ["Idle", "idle"],
    stopped: ["Stopped", "idle"],
    failed: ["Failed", "failed"],
    auth_required: ["Needs sign-in on the computer", "failed"],
  };
  const [text, tone] = words[chat.status];
  return { text, tone };
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30
    ? `${days}d`
    : new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });
}

const message = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong.";

function ListScreen({ client, state }: { readonly client: RemoteClient; readonly state: State }) {
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const overview = state.overview;
  const link = linkWords(state);
  const groups = useMemo(() => {
    if (!overview) return [];
    return overview.projects
      .map((project) => ({
        project,
        chats: overview.chats.filter((entry) => entry.project_id === project.id && !entry.archived),
      }))
      .filter((group) => group.chats.length > 0)
      .sort((a, b) => (b.chats[0]?.chat.updated_at ?? 0) - (a.chats[0]?.chat.updated_at ?? 0));
  }, [overview]);
  const folders = overview?.projects.flatMap((project) => project.folders) ?? [];
  const open = (id: string) => {
    setError("");
    client.open(id).catch((failure) => setError(message(failure)));
  };
  return (
    <div className="remote-screen">
      <header className="remote-bar">
        <a className="remote-mark" href="/" aria-label="auracode">
          <Logo size={34} />
        </a>
        <div className="remote-bar-title">
          <h1>{state.host?.name || overview?.host_name || "Your computer"}</h1>
          <p className="remote-link" data-tone={link.tone} role="status">
            {link.text}
          </p>
        </div>
        <button
          type="button"
          className="remote-icon"
          aria-label="This computer"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Dots />
        </button>
      </header>
      {menu ? <HostMenu client={client} state={state} onClose={() => setMenu(false)} /> : null}
      {error ? (
        <p className="remote-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="remote-list">
        {state.phase.name === "away" ? (
          <p className="remote-hint">
            Your computer is not answering. Open auracode there, and check it is awake and online.
            This page connects by itself when it is back.
          </p>
        ) : null}
        {overview && folders.length > 0 ? (
          <button
            type="button"
            className="g-button g-button-primary g-button-44 remote-new"
            disabled={state.phase.name !== "ready"}
            onClick={() => setCreating(true)}
          >
            New chat
          </button>
        ) : null}
        {overview && groups.length === 0 ? (
          <p className="remote-hint">
            {folders.length > 0
              ? "No chats yet. Start one above."
              : "No projects yet. Add one in auracode on your computer."}
          </p>
        ) : null}
        {!overview && state.phase.name !== "away" ? (
          <p className="remote-hint">Reading your chats.</p>
        ) : null}
        {groups.map(({ project, chats }) => (
          <section key={project.id} aria-labelledby={`remote-project-${project.id}`}>
            <h2 id={`remote-project-${project.id}`}>{project.name}</h2>
            <ul className="remote-chats">
              {chats.map(({ chat }) => {
                const status = statusWords(chat);
                return (
                  <li key={chat.id}>
                    <button type="button" className="remote-chat-row" onClick={() => open(chat.id)}>
                      {/* The agent's initial on a disc, its state as the dot on its shoulder. */}
                      <span className="remote-avatar" aria-hidden="true">
                        {(chat.agent_name.trim()[0] ?? "A").toUpperCase()}
                        <span className="remote-dot" data-tone={status.tone} />
                      </span>
                      <span className="remote-chat-text">
                        <strong>{chat.title || "Untitled chat"}</strong>
                        <span>
                          {chat.agent_name} · {status.text}
                        </span>
                      </span>
                      <time dateTime={new Date(chat.updated_at).toISOString()}>
                        {ago(chat.updated_at, now)}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {creating && overview ? (
        <NewChat client={client} overview={overview} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function HostMenu({
  client,
  state,
  onClose,
}: {
  readonly client: RemoteClient;
  readonly state: State;
  readonly onClose: () => void;
}) {
  const others = state.hosts.filter((host) => host.hostId !== state.host?.id);
  return (
    <div className="remote-menu">
      {others.map((host) => (
        <button
          key={host.hostId}
          type="button"
          className="g-button g-button-outline g-button-44"
          onClick={() => {
            onClose();
            client.use(host.hostId);
          }}
        >
          Switch to {host.hostName}
        </button>
      ))}
      <button
        type="button"
        className="g-button g-button-outline g-button-44"
        onClick={() => {
          onClose();
          void client.forget();
        }}
      >
        Forget this computer
      </button>
      <p>
        Forgetting unpairs this browser. Its key is deleted here and stops working there.
        {keepsPairings() ? "" : " This browser keeps pairings only until the page closes."}
      </p>
    </div>
  );
}

function NewChat({
  client,
  overview,
  onClose,
}: {
  readonly client: RemoteClient;
  readonly overview: Overview;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const folders = overview.projects.flatMap((project) =>
    project.folders.map((folder) => ({ project, folder })),
  );
  const agents = overview.agents.filter((agent) => agent.available);
  const [folder, setFolder] = useState(folders[0]?.folder.id ?? "");
  const [agent, setAgent] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const project = folders.find((entry) => entry.folder.id === folder)?.project;
  const usual = project?.default_agent ?? overview.default_agent;
  const usualName = agents.find((entry) => entry.id === usual)?.name;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.create(folder, agent || null, text);
      onClose();
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="remote-dialog"
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id={`${ids}-title`}>New chat</h2>
        <label htmlFor={`${ids}-folder`}>Folder</label>
        <select
          id={`${ids}-folder`}
          className="g-select"
          value={folder}
          onChange={(event) => setFolder(event.currentTarget.value)}
        >
          {folders.map(({ project: owner, folder: entry }) => (
            <option key={entry.id} value={entry.id}>
              {owner.name === entry.display_name
                ? entry.display_name
                : `${owner.name} · ${entry.display_name}`}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-agent`}>Agent</label>
        <select
          id={`${ids}-agent`}
          className="g-select"
          value={agent}
          onChange={(event) => setAgent(event.currentTarget.value)}
        >
          <option value="">{usualName ? `${usualName} (usual)` : "The usual one"}</option>
          {agents
            .filter((entry) => entry.id !== usual)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
        </select>
        <label htmlFor={`${ids}-text`}>Message</label>
        <textarea
          id={`${ids}-text`}
          className="g-textarea"
          rows={4}
          value={text}
          placeholder="What should the agent do?"
          onChange={(event) => setText(event.currentTarget.value)}
        />
        {error ? (
          <p className="remote-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="remote-dialog-actions">
          <button
            type="button"
            className="g-button g-button-outline g-button-44"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="g-button g-button-primary g-button-44"
            disabled={busy || !text.trim()}
          >
            {busy ? "Starting" : "Start chat"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ChatScreen({ client, state }: { readonly client: RemoteClient; readonly state: State }) {
  const chat = state.chat;
  const summary =
    chat?.snapshot.chat ??
    state.overview?.chats.find((entry) => entry.chat.id === state.opening)?.chat ??
    null;
  const status = summary ? statusWords(summary) : null;
  // A turn is under way, whether the agent is working or waiting on an answer.
  const running = summary ? ["running", "starting", "cancelling"].includes(summary.status) : false;
  const working = running && !summary?.needs_attention;
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const link = linkWords(state);
  // Offered only by an auracode that answers it: an older one ends the session on the request.
  const pickers = state.features.includes("pickers") && state.phase.name === "ready";
  return (
    <div className="remote-screen">
      <header className="remote-bar">
        <button
          type="button"
          className="remote-icon"
          aria-label="All chats"
          onClick={() => client.close()}
        >
          <Back />
        </button>
        <div className="remote-bar-title">
          <h1>{summary?.title || "Untitled chat"}</h1>
          <p
            className="remote-link"
            data-tone={state.phase.name === "ready" ? "ok" : "wait"}
            role="status"
          >
            {state.phase.name === "ready"
              ? [summary?.agent_name, status?.text].filter(Boolean).join(" · ")
              : link.text}
          </p>
        </div>
        {chat && summary && pickers ? (
          <button
            type="button"
            className="remote-icon"
            aria-label="Model and agent"
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
          >
            <Sliders />
          </button>
        ) : null}
      </header>
      {picking && chat && summary ? (
        <ChatPickers
          client={client}
          chatId={chat.id}
          agentId={summary.agent_id}
          agentName={summary.agent_name}
          agents={state.overview?.agents ?? []}
          running={running}
          onClose={() => setPicking(false)}
        />
      ) : null}
      {error ? (
        <p className="remote-error" role="alert">
          {error}
        </p>
      ) : null}
      {chat ? (
        <ChatBody client={client} chat={chat} working={working} onError={setError} />
      ) : (
        <div className="remote-transcript">
          <p className="remote-hint">Opening the chat.</p>
        </div>
      )}
      {chat ? (
        <Composer
          disabled={state.phase.name !== "ready"}
          working={running}
          onSend={async (text) => {
            setError("");
            await client.send(chat.id, text);
          }}
          onStop={() => {
            setError("");
            client.interrupt(chat.id).catch((failure) => setError(message(failure)));
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function ChatBody({
  client,
  chat,
  working,
  onError,
}: {
  readonly client: RemoteClient;
  readonly chat: OpenChat;
  readonly working: boolean;
  readonly onError: (message: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /** Whether the reader is at the newest words: only then does new text pull the view down. */
  const pinned = useRef(true);
  const alive = chat.snapshot.chat.status !== "stopped" && chat.snapshot.chat.status !== "failed";
  const segments = useMemo(
    () => renderTranscript(chat.transcript, alive),
    [chat.transcript, alive],
  );
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  });
  const act = (work: Promise<void>) => {
    onError("");
    work.catch((failure) => onError(message(failure)));
  };
  return (
    <div
      className="remote-transcript"
      ref={scroller}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      {chat.hasMore ? (
        <button
          type="button"
          className="g-button g-button-outline remote-earlier"
          disabled={chat.loadingEarlier}
          onClick={() => {
            pinned.current = false;
            act(client.loadEarlier());
          }}
        >
          {chat.loadingEarlier ? "Loading" : "Earlier messages"}
        </button>
      ) : null}
      {segments.length === 0 ? (
        <p className="remote-hint">Nothing here yet. Send a message.</p>
      ) : null}
      {segments.map((segment) => (
        <Turn
          key={segment.key}
          segment={segment}
          onPermission={(request, option) => act(client.permission(chat.id, request, option))}
          onAnswer={(request, answer) => act(client.answer(chat.id, request, answer))}
        />
      ))}
      {working ? (
        <p className="remote-working" role="status">
          <span className="remote-dot" data-tone="working" aria-hidden="true" />
          Working
        </p>
      ) : null}
    </div>
  );
}

/** How Aura begins the project memory it attaches after a message: reference, not the person's words. */
const MEMORY = "\n\nProject memory (Aura reference context, revision ";
function ownWords(text: string): string {
  const at = text.indexOf(MEMORY);
  return at >= 0 && text.slice(at).includes("\nUse this as project background.")
    ? text.slice(0, at)
    : text;
}

type Tool = Extract<RenderedItem, { kind: "tool" }>;

function Turn({
  segment,
  onPermission,
  onAnswer,
}: {
  readonly segment: RenderedSegment;
  readonly onPermission: (requestId: string, optionId: string | null) => void;
  readonly onAnswer: (requestId: string, answer: UiAnswer | null) => void;
}) {
  // A run of steps between two pieces of the agent's words folds into one line.
  const rows: (RenderedItem | readonly Tool[])[] = [];
  for (const item of segment.items) {
    const last = rows[rows.length - 1];
    if (item.kind === "tool" && Array.isArray(last)) rows[rows.length - 1] = [...last, item];
    else rows.push(item.kind === "tool" ? [item] : item);
  }
  const ended = segment.end && segment.end.stopReason !== "end_turn" ? segment.end : null;
  return (
    <div className="remote-turn">
      {rows.map((row) => {
        if (Array.isArray(row)) return <Steps key={row[0]?.key} tools={row} />;
        const item = row as Exclude<RenderedItem, Tool>;
        switch (item.kind) {
          case "user":
            return (
              <p key={item.key} className="remote-user">
                {ownWords(item.text)}
              </p>
            );
          case "message":
            return <Markdown key={item.key} text={item.text} />;
          case "permission":
            return (
              <PermissionCard
                key={item.key}
                title={item.request.title}
                options={item.request.options}
                chosen={
                  item.resolution === null
                    ? undefined
                    : item.resolution.decision.type === "selected"
                      ? item.resolution.decision.option_id
                      : null
                }
                onChoose={(option) => onPermission(item.request.request_id, option)}
              />
            );
          case "question":
            return (
              <QuestionCard
                key={item.key}
                prompt={item.request.prompt}
                resolved={item.resolution !== null}
                onAnswer={(answer) => onAnswer(item.request.request_id, answer)}
              />
            );
          case "error":
            return (
              <p key={item.key} className="remote-error">
                {item.message}
              </p>
            );
          case "notice":
            return (
              <p key={item.key} className="remote-notice">
                {item.message}
              </p>
            );
          case "gap":
            return (
              <p key={item.key} className="remote-notice">
                Part of this turn is still being saved on the computer.
              </p>
            );
        }
        return null;
      })}
      {ended ? <p className="remote-notice">{stopReasonLabel(ended)}</p> : null}
    </div>
  );
}

function Steps({ tools }: { readonly tools: readonly Tool[] }) {
  const last = tools[tools.length - 1];
  const running = tools.some(
    (tool) => tool.display === "pending" || tool.display === "in_progress",
  );
  const failed = tools.filter((tool) => tool.display === "failed").length;
  const name = (tool: Tool) => tool.title || tool.toolName || "Step";
  return (
    <details className="remote-steps">
      <summary>
        <span>
          {tools.length === 1 ? name(tools[0] as Tool) : `${tools.length} steps`}
          {tools.length > 1 && running && last ? `: ${name(last)}` : ""}
        </span>
        <span className="remote-steps-state">
          {running ? "running" : failed > 0 ? `${failed} failed` : ""}
        </span>
      </summary>
      <ul>
        {tools.map((tool) => (
          <li key={tool.key} data-state={tool.display}>
            {name(tool)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PermissionCard({
  title,
  options,
  chosen,
  onChoose,
}: {
  readonly title: string;
  readonly options: readonly PermissionOption[];
  /** `undefined` while it waits; the chosen option, or `null` when it was declined. */
  readonly chosen: string | null | undefined;
  readonly onChoose: (optionId: string | null) => void;
}) {
  if (chosen !== undefined) {
    const option = options.find((entry) => entry.option_id === chosen);
    return (
      <p className="remote-notice">
        {title}: {option ? option.label : "declined"}
      </p>
    );
  }
  return (
    <section className="remote-card" aria-label="The agent asks for permission">
      <p className="remote-card-title">{title}</p>
      <div className="remote-card-actions">
        {options.map((option) => (
          <button
            key={option.option_id}
            type="button"
            className={
              option.kind === "allow_once" || option.kind === "allow_always"
                ? "g-button g-button-primary g-button-44"
                : "g-button g-button-outline g-button-44"
            }
            onClick={() => onChoose(option.option_id)}
          >
            {option.label}
          </button>
        ))}
        {options.length === 0 ? (
          <button
            type="button"
            className="g-button g-button-outline g-button-44"
            onClick={() => onChoose(null)}
          >
            Decline
          </button>
        ) : null}
      </div>
    </section>
  );
}

function QuestionCard({
  prompt,
  resolved,
  onAnswer,
}: {
  readonly prompt: UiPrompt;
  readonly resolved: boolean;
  readonly onAnswer: (answer: UiAnswer | null) => void;
}) {
  const [text, setText] = useState("");
  if (prompt.type === "notify") return <p className="remote-notice">{prompt.message}</p>;
  if (resolved) return <p className="remote-notice">{prompt.message}: answered</p>;
  const dismiss = (
    <button
      type="button"
      className="g-button g-button-outline g-button-44"
      onClick={() => onAnswer(null)}
    >
      Dismiss
    </button>
  );
  return (
    <section className="remote-card" aria-label="The agent asks a question">
      <p className="remote-card-title">{prompt.message}</p>
      {prompt.type === "confirm" ? (
        <div className="remote-card-actions">
          <button
            type="button"
            className="g-button g-button-primary g-button-44"
            onClick={() => onAnswer({ type: "confirm", yes: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className="g-button g-button-outline g-button-44"
            onClick={() => onAnswer({ type: "confirm", yes: false })}
          >
            No
          </button>
        </div>
      ) : null}
      {prompt.type === "select" ? (
        <div className="remote-card-actions">
          {prompt.options.map((option, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: the answer is the option's index.
              key={index}
              type="button"
              className="g-button g-button-outline g-button-44"
              onClick={() => onAnswer({ type: "select", index })}
            >
              {option}
            </button>
          ))}
          {dismiss}
        </div>
      ) : null}
      {prompt.type === "input" ? (
        <form
          className="remote-card-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) onAnswer({ type: "input", text });
          }}
        >
          <input
            className="g-input"
            aria-label="Your answer"
            value={text}
            placeholder={prompt.placeholder ?? ""}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <div className="remote-card-actions">
            <button
              type="submit"
              className="g-button g-button-primary g-button-44"
              disabled={!text.trim()}
            >
              Answer
            </button>
            {dismiss}
          </div>
        </form>
      ) : null}
      {prompt.type === "questions" ? (
        <Questions questions={prompt.questions} onAnswer={onAnswer} dismiss={dismiss} />
      ) : null}
      {prompt.type === "form" || prompt.type === "link" ? (
        <>
          <p className="remote-notice">Answer this one on your computer, or dismiss it here.</p>
          <div className="remote-card-actions">{dismiss}</div>
        </>
      ) : null}
    </section>
  );
}

function Questions({
  questions,
  onAnswer,
  dismiss,
}: {
  readonly questions: readonly UiQuestion[];
  readonly onAnswer: (answer: UiAnswer) => void;
  readonly dismiss: ReactNode;
}) {
  const [selected, setSelected] = useState<Readonly<Record<string, readonly number[]>>>({});
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const answered = (question: UiQuestion) =>
    (selected[question.id]?.length ?? 0) > 0 || (texts[question.id] ?? "").trim() !== "";
  const toggle = (question: UiQuestion, index: number) => {
    const current = selected[question.id] ?? [];
    const next = question.multi_select
      ? current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b)
      : [index];
    setSelected({ ...selected, [question.id]: next });
  };
  return (
    <form
      className="remote-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer({
          type: "questions",
          answers: questions.map((question) => ({
            question_id: question.id,
            selected: [...(selected[question.id] ?? [])],
            text: (texts[question.id] ?? "").trim() || null,
          })),
        });
      }}
    >
      {questions.map((question) => (
        <fieldset key={question.id}>
          <legend>{question.question}</legend>
          {question.options.map((option, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the answer is the option's index.
            <label key={index} className="remote-choice">
              <input
                type={question.multi_select ? "checkbox" : "radio"}
                name={`question-${question.id}`}
                checked={(selected[question.id] ?? []).includes(index)}
                onChange={() => toggle(question, index)}
              />
              <span>
                <strong>{option.label}</strong>
                {option.description ? <span>{option.description}</span> : null}
              </span>
            </label>
          ))}
          {question.allow_free_text ? (
            <input
              className="g-input"
              aria-label={`Another answer to: ${question.question}`}
              placeholder="Something else"
              value={texts[question.id] ?? ""}
              onChange={(event) => setTexts({ ...texts, [question.id]: event.currentTarget.value })}
            />
          ) : null}
        </fieldset>
      ))}
      <div className="remote-card-actions">
        <button
          type="submit"
          className="g-button g-button-primary g-button-44"
          disabled={!questions.every(answered)}
        >
          Answer
        </button>
        {dismiss}
      </div>
    </form>
  );
}

function Composer({
  disabled,
  working,
  onSend,
  onStop,
  onError,
}: {
  readonly disabled: boolean;
  readonly working: boolean;
  readonly onSend: (text: string) => Promise<void>;
  readonly onStop: () => void;
  readonly onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    // The box grows with what is typed, up to a third of the screen.
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, window.innerHeight / 3)}px`;
  });
  const submit = async () => {
    const words = text;
    if (!words.trim() || sending || disabled) return;
    setSending(true);
    try {
      await onSend(words);
      setText("");
    } catch (failure) {
      // What was typed stays, to send again.
      onError(message(failure));
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="remote-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={field}
        className="g-textarea"
        rows={1}
        aria-label="Message"
        placeholder={working ? "Add to the queue" : "Message the agent"}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {working ? (
        <button type="button" className="g-button g-button-outline g-button-44" onClick={onStop}>
          Stop
        </button>
      ) : null}
      <button
        type="submit"
        className="g-button g-button-primary g-button-44"
        disabled={disabled || sending || !text.trim()}
      >
        Send
      </button>
    </form>
  );
}

function Dots() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="10" r="1.6" fill="currentColor" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      <circle cx="16" cy="10" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Two sliders: what a chat runs on can be changed here. */
function Sliders() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3 6.5h6.5M13.5 6.5H17M3 13.5h3.5M10.5 13.5H17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="11.5" cy="6.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.5" cy="13.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Back() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
