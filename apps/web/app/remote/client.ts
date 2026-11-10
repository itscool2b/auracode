/**
 * A browser's remote session with one computer (docs/remote-sessions.md): the socket to the
 * relay, the sealed channel through it, and the state the page draws.
 *
 * The chat itself is folded by the desktop app's own reducer, from the same events its window
 * gets, so a turn reads the same here as there.
 */
import type {
  ChatAttach,
  ChatSnapshot,
  ChatStatusUpdate,
  EventBatch,
  HistoryPage,
  ProjectSummary,
  PromptAck,
  UiAnswer,
  WorkspaceChat,
} from "../../../desktop/src/bindings";
import {
  applyEntries,
  type Entry,
  emptyTranscript,
  type Transcript,
  withTasks,
} from "../../../desktop/src/lib/chat/transcript";
import { Channel, decode, encode, importSecret, randomBytes } from "./channel";
import { deleteHost, loadHosts, type SavedHost, saveHost } from "./storage";

export interface RemoteAgent {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
}

export interface Overview {
  readonly host_name: string;
  readonly projects: readonly ProjectSummary[];
  readonly chats: readonly WorkspaceChat[];
  readonly agents: readonly RemoteAgent[];
  readonly default_agent: string | null;
}

export type Phase =
  /** Nothing is paired and no pairing link was opened. */
  | { readonly name: "empty" }
  | { readonly name: "connecting" }
  /** The relay answers; the computer is off, asleep or has auracode closed. */
  | { readonly name: "away" }
  | { readonly name: "ready" }
  /**
   * This pairing is over: the link was spent, or the computer no longer accepts this browser
   * (`refused` names it, so the page can offer to try again or to forget it).
   */
  | { readonly name: "ended"; readonly reason: string; readonly refused?: string };

export interface OpenChat {
  readonly id: string;
  readonly snapshot: ChatSnapshot;
  readonly transcript: Transcript;
  /** Older history exists and can be loaded. */
  readonly hasMore: boolean;
  readonly loadingEarlier: boolean;
}

export interface State {
  readonly phase: Phase;
  readonly hosts: readonly SavedHost[];
  /** The computer this session is with. */
  readonly host: { readonly id: string; readonly name: string } | null;
  readonly overview: Overview | null;
  /** The chat being opened, before its history has arrived. */
  readonly opening: string | null;
  readonly chat: OpenChat | null;
}

/** A request the computer refused, in its own words. */
export class RemoteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Credential =
  | { readonly kind: "pair"; readonly hostId: string; readonly id: string; readonly key: CryptoKey }
  | { readonly kind: "device"; readonly host: SavedHost };

interface Pending {
  readonly resolve: (data: unknown) => void;
  readonly reject: (error: Error) => void;
}

const VERSION = 1;
const PING_MS = 25_000;
const PONG_MS = 10_000;
const REQUEST_MS = 30_000;

/** This browser in a few words, as the computer's Settings will list it. */
export function deviceName(agent: string): string {
  const platform = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows PC"
            : /Linux/.test(agent)
              ? "Linux"
              : "Browser";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox|FxiOS/.test(agent)
      ? "Firefox"
      : /Chrome|CriOS/.test(agent)
        ? "Chrome"
        : /Safari/.test(agent)
          ? "Safari"
          : null;
  return browser ? `${platform} (${browser})` : platform;
}

/** A pairing link's fragment: the computer's id, the link's id and its key. */
export function parsePairing(
  fragment: string,
): { hostId: string; id: string; key: Uint8Array<ArrayBuffer> } | null {
  const [hostId, id, key, ...rest] = fragment.replace(/^#/, "").split(".");
  if (!hostId || !id || !key || rest.length > 0) return null;
  const bytes = decode(key, 32);
  if (!decode(hostId, 16) || !decode(id, 8) || !bytes) return null;
  return { hostId, id, key: bytes };
}

export class RemoteClient {
  #state: State = {
    phase: { name: "connecting" },
    hosts: [],
    host: null,
    overview: null,
    opening: null,
    chat: null,
  };
  readonly #listeners = new Set<() => void>();
  readonly #origin: string;
  #credential: Credential | null = null;
  #socket: WebSocket | null = null;
  #channel: Channel | null = null;
  #nonce: Uint8Array<ArrayBuffer> | null = null;
  #ready = false;
  /** Incoming messages are opened one after another, in the order they arrived. */
  #inbox: Promise<void> = Promise.resolve();
  /** Outgoing messages are sealed one after another, so their numbers match their order. */
  #outbox: Promise<void> = Promise.resolve();
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #retries = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #pong: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;
  /** The open chat's every entry, oldest first: an earlier page rebuilds the transcript. */
  #entries: Entry[] = [];
  #cut: string | null = null;
  #before: number | null = null;
  #expected = 0;
  /** Live frames that arrived while the chat's history was still on its way. */
  #early: EventBatch[] = [];
  #refetch: ReturnType<typeof setTimeout> | null = null;

  /** `origin` is the relay's WebSocket origin, the page's own unless a test says otherwise. */
  constructor(origin: string) {
    this.#origin = origin;
  }

  readonly getState = (): State => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<State>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  /**
   * Loads what is paired and connects: with the pairing link in `fragment` when there is one,
   * else to the computer paired most recently.
   */
  async start(fragment: string): Promise<void> {
    const hosts = await loadHosts();
    this.#set({ hosts });
    const pairing = parsePairing(fragment);
    if (pairing) {
      this.#credential = {
        kind: "pair",
        hostId: pairing.hostId,
        id: pairing.id,
        key: await importSecret(pairing.key),
      };
      pairing.key.fill(0);
    } else if (fragment.replace(/^#/, "") !== "") {
      this.#set({ phase: { name: "ended", reason: "This pairing link is not complete." } });
      return;
    } else if (hosts[0]) {
      this.#credential = { kind: "device", host: hosts[0] };
    } else {
      this.#set({ phase: { name: "empty" } });
      return;
    }
    this.#connect();
  }

  /** Switches to another paired computer. */
  use(hostId: string) {
    const host = this.#state.hosts.find((entry) => entry.hostId === hostId);
    if (!host) return;
    this.#credential = { kind: "device", host };
    this.#set({ host: null, overview: null, chat: null, opening: null });
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    this.#close();
  }

  /** The page came back to the front: do not wait out a backoff. */
  wake() {
    if (this.#stopped || !this.#credential) return;
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) return;
    this.#retries = 0;
    this.#connect();
  }

  #close() {
    if (this.#retry !== null) clearTimeout(this.#retry);
    if (this.#ping !== null) clearInterval(this.#ping);
    if (this.#pong !== null) clearTimeout(this.#pong);
    this.#retry = this.#ping = this.#pong = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    this.#sessionOver("The connection closed.");
  }

  /** The sealed session is gone; whatever waited on it fails. */
  #sessionOver(reason: string) {
    this.#channel = null;
    this.#nonce = null;
    this.#ready = false;
    for (const pending of this.#pending.values()) pending.reject(new Error(reason));
    this.#pending.clear();
  }

  #connect() {
    const credential = this.#credential;
    if (!credential || this.#stopped) return;
    this.#close();
    if (this.#state.phase.name !== "away") this.#set({ phase: { name: "connecting" } });
    const hostId = credential.kind === "pair" ? credential.hostId : credential.host.hostId;
    const socket = new WebSocket(`${this.#origin}/api/remote/v1/client/${hostId}`);
    this.#socket = socket;
    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || socket !== this.#socket) return;
      const text = event.data;
      this.#inbox = this.#inbox.then(() => this.#received(socket, text)).catch(() => {});
    };
    socket.onclose = () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#sessionOver("The connection closed.");
      if (this.#state.phase.name === "ended" || this.#stopped) return;
      if (this.#state.phase.name === "ready") this.#set({ phase: { name: "connecting" } });
      // 1, 2, 4, 8, then every 15 seconds.
      const wait = Math.min(15_000, 1000 * 2 ** Math.min(this.#retries, 4));
      this.#retries += 1;
      this.#retry = setTimeout(() => this.#connect(), wait);
    };
    this.#ping = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send("ping");
      this.#pong ??= setTimeout(() => socket.close(), PONG_MS);
    }, PING_MS);
  }

  async #received(socket: WebSocket, text: string) {
    if (socket !== this.#socket) return;
    if (text === "pong") {
      if (this.#pong !== null) clearTimeout(this.#pong);
      this.#pong = null;
      return;
    }
    if (text === "h0") {
      this.#sessionOver("The computer went away.");
      this.#set({ phase: { name: "away" } });
      return;
    }
    if (text === "h1") return this.#hello(socket);
    // The relay ended this socket; the close that follows connects again.
    if (text === "x") return;
    if (!text.startsWith("m")) return;
    const kind = text[1];
    const body = text.slice(2);
    try {
      if (kind === "R") return this.#refused(body);
      if (kind === "W") return await this.#welcome(body);
      if (kind === "E" && this.#channel) return await this.#opened(await this.#channel.open(body));
    } catch {
      // A message this session cannot open ends it; a new one starts on reconnect.
      socket.close();
    }
  }

  #hello(socket: WebSocket) {
    const credential = this.#credential;
    if (!credential) return;
    this.#sessionOver("The session started again.");
    this.#nonce = randomBytes(16);
    const id = credential.kind === "pair" ? credential.id : credential.host.deviceId;
    socket.send(
      `mH${JSON.stringify({ v: VERSION, kind: credential.kind, id, nonce: encode(this.#nonce) })}`,
    );
    if (this.#state.phase.name === "away") this.#set({ phase: { name: "connecting" } });
  }

  /**
   * The computer's answer to this side's hello. Exactly one is accepted per hello: a second one,
   * replayed by whoever carries the messages, would derive the same keys again and start their
   * message numbers over, which must never happen. So the nonce is spent the moment it is used,
   * and a welcome with no hello waiting for it ends the session.
   */
  async #welcome(body: string) {
    const credential = this.#credential;
    const nonce = this.#nonce;
    this.#nonce = null;
    const welcome = JSON.parse(body) as { v?: unknown; nonce?: unknown };
    const hostNonce = typeof welcome.nonce === "string" ? decode(welcome.nonce, 16) : null;
    if (!credential || !nonce || this.#channel || welcome.v !== VERSION || !hostNonce)
      throw new Error("unexpected welcome");
    const [key, id] =
      credential.kind === "pair"
        ? [credential.key, credential.id]
        : [credential.host.key, credential.host.deviceId];
    this.#channel = await Channel.create(
      "client",
      key,
      nonce,
      hostNonce,
      `${credential.kind}|${id}`,
    );
  }

  #refused(body: string) {
    const reason = (JSON.parse(body) as { reason?: unknown }).reason;
    const credential = this.#credential;
    if (reason === "busy") return;
    if (reason === "version") {
      this.#end("This page and the auracode on that computer do not match. Update auracode.");
      return;
    }
    if (credential?.kind === "device") {
      // Nothing proves who sent a refusal, so it deletes nothing: the key stays until the person
      // decides. If the device was removed on the computer, forgetting it here tidies up.
      const host = credential.host;
      this.#end(
        `${host.hostName} no longer accepts this browser. If you removed it in auracode's Settings, pair again from there.`,
        host.hostId,
      );
    } else {
      this.#end(
        "This pairing link was already used or has expired. Create a new one in auracode: Settings, Remote access, Pair.",
      );
    }
  }

  #end(reason: string, refused?: string) {
    this.#credential = null;
    this.#set({
      phase: refused ? { name: "ended", reason, refused } : { name: "ended", reason },
      host: null,
      overview: null,
      chat: null,
      opening: null,
    });
    this.#close();
  }

  /** One opened message: a reply to a request, or something the computer says by itself. */
  async #opened(text: string) {
    const message = JSON.parse(text) as Record<string, unknown>;
    // A session's first sealed message is the computer's "ready", once; nothing else comes first.
    if ((message.ev === "ready") === this.#ready) throw new Error("out of place");
    if (typeof message.re === "number") {
      const pending = this.#pending.get(message.re);
      this.#pending.delete(message.re);
      if (!pending) return;
      if (message.ok === true) pending.resolve(message.data);
      else {
        const error = (message.error ?? {}) as { code?: unknown; message?: unknown };
        pending.reject(
          new RemoteError(
            typeof error.code === "string" ? error.code : "failed",
            typeof error.message === "string" ? error.message : "The computer refused.",
          ),
        );
      }
      return;
    }
    switch (message.ev) {
      case "ready":
        // Opening this proved the computer holds the key. Now this side proves the same.
        this.#ready = true;
        void this.#begin(String(message.host_name ?? "")).catch(() => this.#socket?.close());
        break;
      case "chat":
        this.#status(message.update as ChatStatusUpdate);
        break;
      case "frame":
        this.#frame(message.batch as EventBatch);
        break;
      case "lost": {
        const open = this.#state.chat;
        if (open && open.id === message.chat_id) void this.open(open.id).catch(() => {});
        break;
      }
      case "reset":
        this.#set({ chat: null, opening: null });
        void this.refresh();
        break;
    }
  }

  /** The session is up: pair if this was a pairing link, then show the computer's chats. */
  async #begin(hostName: string) {
    const credential = this.#credential;
    if (!credential) return;
    this.#retries = 0;
    let host: SavedHost;
    if (credential.kind === "pair") {
      const paired = (await this.#request({
        op: "pair",
        name: deviceName(navigator.userAgent),
      })) as { device_id: string; device_key: string };
      const raw = decode(paired.device_key, 32);
      if (!raw) throw new Error("unexpected device key");
      host = {
        hostId: credential.hostId,
        hostName,
        deviceId: paired.device_id,
        key: await importSecret(raw),
        pairedAt: Date.now(),
      };
      raw.fill(0);
      await saveHost(host);
      // The session carries on as the device; the next connection uses its own key.
      this.#credential = { kind: "device", host };
      const added = host;
      this.#set({
        hosts: [added, ...this.#state.hosts.filter((entry) => entry.hostId !== added.hostId)],
      });
    } else if (credential.host.hostName !== hostName && hostName) {
      // The computer was renamed: the list of paired computers follows.
      const renamed = { ...credential.host, hostName };
      host = renamed;
      this.#credential = { kind: "device", host };
      void saveHost(host);
      this.#set({
        hosts: this.#state.hosts.map((entry) =>
          entry.hostId === renamed.hostId ? renamed : entry,
        ),
      });
    } else {
      host = credential.host;
    }
    this.#set({
      phase: { name: "ready" },
      host: { id: host.hostId, name: host.hostName },
    });
    await this.refresh();
    const following = this.#state.chat?.id ?? this.#state.opening;
    if (following) await this.open(following).catch(() => this.#set({ chat: null, opening: null }));
  }

  #request(body: Record<string, unknown>): Promise<unknown> {
    const channel = this.#channel;
    const socket = this.#socket;
    if (!channel || !socket || !this.#ready || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("The computer is not reachable right now."));
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("The computer did not answer in time."));
      }, REQUEST_MS);
      this.#pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#outbox = this.#outbox
        .then(async () => {
          // A session that changed while this waited its turn cannot carry it.
          if (channel !== this.#channel) throw new Error("The session started again.");
          socket.send(`mE${await channel.seal(JSON.stringify({ id, ...body }))}`);
        })
        .catch((error: unknown) => {
          this.#pending.get(id)?.reject(error instanceof Error ? error : new Error("Not sent."));
          this.#pending.delete(id);
        });
    });
  }

  /** Reads the computer's projects, chats and agents again. */
  async refresh(): Promise<void> {
    const overview = (await this.#request({ op: "overview" })) as Overview;
    this.#set({
      overview,
      host: this.#state.host ? { ...this.#state.host, name: overview.host_name } : null,
    });
  }

  #status(update: ChatStatusUpdate) {
    const overview = this.#state.overview;
    if (!overview) return;
    const known = overview.chats.some((entry) => entry.chat.id === update.chat_id);
    if (!known) {
      // A chat made elsewhere: one read brings it, however many updates announce it.
      this.#refetch ??= setTimeout(() => {
        this.#refetch = null;
        void this.refresh().catch(() => {});
      }, 400);
      return;
    }
    const merge = <T extends { id: string }>(chat: T): T =>
      chat.id === update.chat_id
        ? {
            ...chat,
            status: update.status,
            needs_attention: update.needs_attention,
            title: update.title ?? (chat as { title?: string | null }).title ?? null,
            updated_at: update.updated_at,
          }
        : chat;
    const chats = overview.chats
      .map((entry) => ({ ...entry, chat: merge(entry.chat) }))
      .sort((a, b) => b.chat.updated_at - a.chat.updated_at);
    const open = this.#state.chat;
    this.#set({
      overview: { ...overview, chats },
      chat:
        open && open.id === update.chat_id
          ? { ...open, snapshot: { ...open.snapshot, chat: merge(open.snapshot.chat) } }
          : open,
    });
  }

  /** Follows a chat: its newest history, then its live events. */
  async open(chatId: string): Promise<void> {
    this.#early = [];
    this.#set({ opening: chatId, chat: this.#state.chat?.id === chatId ? this.#state.chat : null });
    let attach: ChatAttach;
    try {
      attach = (await this.#request({ op: "open", chat_id: chatId })) as ChatAttach;
    } catch (error) {
      if (this.#state.opening === chatId) this.#set({ opening: null });
      throw error;
    }
    if (this.#state.opening !== chatId) return;
    this.#entries = entriesOf(attach.history);
    this.#cut = attach.history.cut_turn_id;
    this.#before = attach.history.has_more ? attach.history.before_seq : null;
    this.#expected = attach.next_seq;
    const transcript = withTasks(
      applyEntries(emptyTranscript(this.#cut), this.#entries),
      attach.snapshot.tasks ?? [],
    );
    this.#set({
      opening: null,
      chat: {
        id: chatId,
        snapshot: attach.snapshot,
        transcript,
        hasMore: this.#before !== null,
        loadingEarlier: false,
      },
    });
    const early = this.#early;
    this.#early = [];
    for (const batch of early) this.#frame(batch);
  }

  /** Stops following and returns to the list. */
  close() {
    this.#set({ chat: null, opening: null });
    this.#entries = [];
    void this.#request({ op: "close" }).catch(() => {});
  }

  #frame(batch: EventBatch) {
    if (this.#state.opening === batch.chat_id) {
      this.#early.push(batch);
      return;
    }
    const chat = this.#state.chat;
    if (!chat || chat.id !== batch.chat_id) return;
    if (batch.seq_start > this.#expected) {
      // Events were missed: the chat is read again from the computer.
      void this.open(chat.id).catch(() => {});
      return;
    }
    const fresh: Entry[] = [];
    let snapshot = chat.snapshot;
    batch.events.forEach((event, index) => {
      const seq = batch.seq_start + index;
      if (seq < this.#expected) return;
      if (event.type === "session_updated") {
        snapshot = {
          ...snapshot,
          session: event,
          chat: { ...snapshot.chat, status: event.status },
        };
      }
      fresh.push({ seq, turnId: null, event });
    });
    this.#expected = Math.max(this.#expected, batch.seq_start + batch.events.length);
    if (fresh.length === 0) return;
    this.#entries.push(...fresh);
    this.#set({
      chat: { ...chat, snapshot, transcript: applyEntries(chat.transcript, fresh) },
    });
  }

  /** Reads the page of history before what is shown. */
  async loadEarlier(): Promise<void> {
    const chat = this.#state.chat;
    if (!chat || this.#before === null || chat.loadingEarlier) return;
    this.#set({ chat: { ...chat, loadingEarlier: true } });
    try {
      const page = (await this.#request({
        op: "history",
        chat_id: chat.id,
        before_seq: this.#before,
      })) as HistoryPage;
      const current = this.#state.chat;
      if (!current || current.id !== chat.id) return;
      this.#entries = [...entriesOf(page), ...this.#entries];
      this.#cut = page.cut_turn_id;
      this.#before = page.has_more ? page.before_seq : null;
      this.#set({
        chat: {
          ...current,
          transcript: withTasks(
            applyEntries(emptyTranscript(this.#cut), this.#entries),
            current.snapshot.tasks ?? [],
          ),
          hasMore: this.#before !== null,
          loadingEarlier: false,
        },
      });
    } catch (error) {
      const current = this.#state.chat;
      if (current?.id === chat.id) this.#set({ chat: { ...current, loadingEarlier: false } });
      throw error;
    }
  }

  send(chatId: string, text: string): Promise<PromptAck> {
    return this.#request({ op: "send", chat_id: chatId, text }) as Promise<PromptAck>;
  }

  async interrupt(chatId: string): Promise<void> {
    await this.#request({ op: "interrupt", chat_id: chatId });
  }

  /** Answers a permission request; no option declines it. */
  async permission(chatId: string, requestId: string, optionId: string | null): Promise<void> {
    await this.#request({
      op: "permission",
      chat_id: chatId,
      request_id: requestId,
      option_id: optionId,
    });
  }

  /** Answers a question; no answer dismisses it. */
  async answer(chatId: string, requestId: string, answer: UiAnswer | null): Promise<void> {
    await this.#request({ op: "answer", chat_id: chatId, request_id: requestId, answer });
  }

  /** Starts a chat in a project's folder with its first message, and opens it. */
  async create(folderId: string, agentId: string | null, text: string): Promise<void> {
    const created = (await this.#request({
      op: "create",
      folder_id: folderId,
      agent_id: agentId,
      text,
    })) as { chat: WorkspaceChat };
    await this.refresh().catch(() => {});
    await this.open(created.chat.chat.id);
  }

  /** Deletes a computer's key from this browser, without asking the computer anything. */
  async discard(hostId: string): Promise<void> {
    await deleteHost(hostId);
    const hosts = this.#state.hosts.filter((entry) => entry.hostId !== hostId);
    this.#set({ hosts });
    if (hosts[0]) this.use(hosts[0].hostId);
    else this.#set({ phase: { name: "empty" } });
  }

  /** Unpairs this browser: the computer forgets the device and this browser its key. */
  async forget(): Promise<void> {
    const credential = this.#credential;
    if (credential?.kind !== "device") return;
    const host = credential.host;
    // Best effort there; here the key goes whatever the computer says.
    await this.#request({ op: "forget" }).catch(() => {});
    await deleteHost(host.hostId);
    const hosts = this.#state.hosts.filter((entry) => entry.hostId !== host.hostId);
    this.#set({ hosts });
    if (hosts[0]) this.use(hosts[0].hostId);
    else {
      this.#credential = null;
      this.#close();
      this.#set({
        phase: { name: "empty" },
        host: null,
        overview: null,
        chat: null,
        opening: null,
      });
    }
  }
}

function entriesOf(page: HistoryPage): Entry[] {
  return page.items.map((item) => ({ seq: item.seq, turnId: item.turn_id, event: item.event }));
}
