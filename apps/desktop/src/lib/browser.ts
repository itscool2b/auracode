/**
 * The browser beside the chat (docs/superpowers/plans/2026-11-09-browser.md): its commands, its
 * events as a store for React, and each chat's panel on this device. Rust owns the tabs and the
 * pages; the window shows them and places each page over the panel.
 */
import { listen } from "@tauri-apps/api/event";
import {
  type BrowserEvent,
  type BrowserRect,
  type BrowserStatus,
  type BrowserTab,
  type ChatBrowser,
  type ClearData,
  commands,
  type GoAction,
  type HistoryEntry,
  type PickedElement,
} from "../bindings";
import { settle } from "./ipc";

export const BROWSER_EVENT = "auracode-browser";

/** Everything the panel asks of the browser. The fixture implements it without pages. */
export interface BrowserApi {
  status(): Promise<BrowserStatus>;
  chat(chatId: string): Promise<ChatBrowser>;
  open(chatId: string, input: string | null, activate: boolean): Promise<BrowserTab>;
  close(tabId: string): Promise<void>;
  activate(chatId: string, tabId: string): Promise<void>;
  move(tabId: string, index: number): Promise<void>;
  /** Loads what was typed; answers the address it became. */
  navigate(tabId: string, input: string): Promise<string>;
  go(tabId: string, action: GoAction): Promise<void>;
  /** Shows a tab's page over `rect` (CSS pixels of the window), or hides what shows. */
  place(tabId: string | null, rect: BrowserRect | null, visible: boolean): Promise<void>;
  /** The page as shown, as a JPEG data URL; `null` where the engine cannot take one. */
  capture(tabId: string): Promise<string | null>;
  zoom(tabId: string, zoom: number): Promise<number>;
  devtools(tabId: string): Promise<void>;
  focus(tabId: string): Promise<void>;
  annotate(tabId: string, on: boolean, accent: string, ink: string): Promise<boolean>;
  pickAt(tabId: string, x: number, y: number): Promise<PickedElement | null>;
  suggest(input: string): Promise<HistoryEntry[]>;
  history(query: string, limit: number, before: number | null): Promise<HistoryEntry[]>;
  removeHistory(urls: string[]): Promise<number>;
  clear(data: ClearData): Promise<void>;
  openOutside(url: string): Promise<void>;
  /** Every browser event; answers the unsubscribe. */
  listen(listener: (event: BrowserEvent) => void): () => void;
}

export const tauriBrowserApi: BrowserApi = {
  status: () => settle(commands.browserStatus()),
  chat: (chatId) => settle(commands.browserChat(chatId)),
  open: (chatId, input, activate) => settle(commands.browserOpen(chatId, input, activate)),
  close: async (tabId) => {
    await settle(commands.browserClose(tabId));
  },
  activate: async (chatId, tabId) => {
    await settle(commands.browserActivate(chatId, tabId));
  },
  move: async (tabId, index) => {
    await settle(commands.browserMove(tabId, index));
  },
  navigate: (tabId, input) => settle(commands.browserNavigate(tabId, input)),
  go: async (tabId, action) => {
    await settle(commands.browserGo(tabId, action));
  },
  place: async (tabId, rect, visible) => {
    await settle(commands.browserPlace(tabId, rect, visible));
  },
  capture: (tabId) => settle(commands.browserCapture(tabId)),
  zoom: async (tabId, zoom) => (await settle(commands.browserZoom(tabId, zoom))) ?? 1,
  devtools: async (tabId) => {
    await settle(commands.browserDevtools(tabId));
  },
  focus: async (tabId) => {
    await settle(commands.browserFocus(tabId));
  },
  annotate: (tabId, on, accent, ink) => settle(commands.browserAnnotate(tabId, on, accent, ink)),
  pickAt: (tabId, x, y) => settle(commands.browserPickAt(tabId, x, y)),
  suggest: (input) => settle(commands.browserSuggest(input)),
  history: (query, limit, before) => settle(commands.browserHistory(query, limit, before)),
  removeHistory: (urls) => settle(commands.browserHistoryRemove(urls)),
  clear: async (data) => {
    await settle(commands.browserClear(data));
  },
  openOutside: async (url) => {
    await settle(commands.browserOpenOutside(url));
  },
  listen: (listener) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    void listen<BrowserEvent>(BROWSER_EVENT, (event) => listener(event.payload)).then(
      (unlisten) => {
        if (stopped) unlisten();
        else stop = unlisten;
      },
      () => {
        // Outside the app (a fixture): no events.
      },
    );
    return () => {
      stopped = true;
      stop?.();
    };
  },
};

/** What an agent is doing in a chat's browser, while it does it. */
export interface AgentWork {
  readonly label: string;
  readonly tabId: string | null;
}

const EMPTY: readonly BrowserTab[] = [];

/**
 * The browser as React reads it: each chat's tabs (from Rust's events), whether the plugin is on,
 * and what agents are doing. Events the panel acts on itself (a pick, a shortcut, a download) go
 * to `onEvent` listeners.
 */
export class BrowserStore {
  readonly api: BrowserApi;
  readonly #chats = new Map<string, ChatBrowser>();
  readonly #loading = new Set<string>();
  readonly #agents = new Map<string, AgentWork>();
  readonly #listeners = new Set<() => void>();
  readonly #events = new Set<(event: BrowserEvent) => void>();
  #status: BrowserStatus | null = null;
  #version = 0;
  #stop: (() => void) | null = null;

  constructor(api: BrowserApi) {
    this.api = api;
  }

  /** Starts listening (once, on first use). */
  #start(): void {
    if (this.#stop) return;
    this.#stop = this.api.listen((event) => this.#take(event));
    void this.api.status().then(
      (status) => {
        this.#status = status;
        this.#changed();
      },
      () => {
        this.#status = {
          enabled: false,
          unavailable: "The browser is not available here.",
          passwords: false,
          private: false,
        };
        this.#changed();
      },
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#start();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getVersion = (): number => this.#version;

  /** Events the panel handles itself. */
  onEvent(listener: (event: BrowserEvent) => void): () => void {
    this.#start();
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  status(): BrowserStatus | null {
    return this.#status;
  }

  /** Whether the browser can be offered: the plugin is on and the system can show it. */
  usable(): boolean {
    return this.#status?.enabled === true && this.#status.unavailable === null;
  }

  /** A chat's tabs, loading them the first time they are asked for. */
  tabs(chatId: string): readonly BrowserTab[] {
    return this.chat(chatId)?.tabs ?? EMPTY;
  }

  chat(chatId: string): ChatBrowser | null {
    const known = this.#chats.get(chatId);
    if (!known && !this.#loading.has(chatId)) {
      this.#loading.add(chatId);
      this.#start();
      void this.api.chat(chatId).then(
        (browser) => {
          this.#loading.delete(chatId);
          // An event that arrived meanwhile is newer.
          if (!this.#chats.has(chatId)) {
            this.#chats.set(chatId, browser);
            this.#changed();
          }
        },
        () => this.#loading.delete(chatId),
      );
    }
    return known ?? null;
  }

  active(chatId: string): BrowserTab | null {
    const chat = this.#chats.get(chatId);
    if (!chat) return null;
    return chat.tabs.find((tab) => tab.id === chat.active) ?? null;
  }

  agent(chatId: string): AgentWork | null {
    return this.#agents.get(chatId) ?? null;
  }

  /** Puts a chat's new state in at once (an open the window made), before Rust's event. */
  apply(browser: ChatBrowser): void {
    this.#chats.set(browser.chat_id, browser);
    this.#changed();
  }

  #take(event: BrowserEvent): void {
    switch (event.type) {
      case "chat":
        this.#chats.set(event.browser.chat_id, event.browser);
        this.#changed();
        break;
      case "status":
        this.#status = event.status;
        this.#changed();
        break;
      case "agent":
        if (event.label === null) this.#agents.delete(event.chat_id);
        else this.#agents.set(event.chat_id, { label: event.label, tabId: event.tab_id });
        this.#changed();
        break;
      default:
        break;
    }
    for (const listener of [...this.#events]) listener(event);
  }

  #changed(): void {
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}

export const browserStore = new BrowserStore(tauriBrowserApi);

/** How a chat's browser panel sits beside its conversation, on this device. */
export interface PanelPlacement {
  readonly open: boolean;
  /** The panel's share of the chat's width, beside the conversation. */
  readonly share: number;
  /** The panel takes the whole chat (the conversation hidden). */
  readonly full: boolean;
}

export const DEFAULT_SHARE = 0.5;
export const MIN_SHARE = 0.28;
export const MAX_SHARE = 0.78;

const PANEL_PREFIX = "auracode.browser-panel.";
const SHARE_KEY = "auracode.browser-panel-share";

export interface PanelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return DEFAULT_SHARE;
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));
}

/** Each chat's panel: open or not, its width and Full view. Storage failures keep it closed. */
export class BrowserPanels {
  readonly #storage: PanelStorage | null;
  readonly #listeners = new Set<() => void>();
  #version = 0;

  constructor(storage: PanelStorage | null) {
    this.#storage = storage;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getVersion = (): number => this.#version;

  of(chatId: string): PanelPlacement {
    const fallback = clampShare(Number(this.#read(SHARE_KEY) ?? DEFAULT_SHARE));
    const saved = this.#read(PANEL_PREFIX + chatId);
    if (!saved) return { open: false, share: fallback, full: false };
    try {
      const value = JSON.parse(saved) as Partial<PanelPlacement>;
      return {
        open: value.open === true,
        share: clampShare(typeof value.share === "number" ? value.share : fallback),
        full: value.full === true,
      };
    } catch {
      return { open: false, share: fallback, full: false };
    }
  }

  set(chatId: string, change: Partial<PanelPlacement>): void {
    const next = { ...this.of(chatId), ...change };
    next.share = clampShare(next.share);
    if (change.share !== undefined) this.#write(SHARE_KEY, String(next.share));
    this.#write(PANEL_PREFIX + chatId, JSON.stringify(next));
  }

  #read(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  #write(key: string, value: string): void {
    try {
      this.#storage?.setItem(key, value);
    } catch {
      /* A full or blocked storage keeps the last placement. */
    }
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}

export const browserPanels = new BrowserPanels(
  typeof localStorage === "undefined" ? null : localStorage,
);

/** An address as the bar shows it while not editing: no `https://`, no lone trailing slash. */
export function shownAddress(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:")
      return decodeURIComponent(parsed.pathname.replace(/^\/(\w:)/, "$1"));
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const scheme = parsed.protocol === "http:" && !isLocal(parsed.hostname) ? "http://" : "";
    return `${scheme}${parsed.host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** The host a person recognises (`localhost:5173`, `github.com`), or the file's name. */
export function siteOf(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return parsed.pathname.split("/").pop() || "Local file";
    return parsed.host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".test")
  );
}

/** Whether the page is reached privately: HTTPS, a local file, or this computer. */
export function secureAddress(url: string | null): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "file:" ||
      (parsed.protocol === "http:" && isLocal(parsed.hostname))
    );
  } catch {
    return false;
  }
}

/** A tab's name in its strip: its title, else its site, else "New tab". */
export function tabName(tab: BrowserTab): string {
  return tab.title.trim() || siteOf(tab.url) || "New tab";
}

/** Whether two placements need the page moved: whole CSS pixels are enough. */
export function sameRect(a: BrowserRect | null, b: BrowserRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.round(a.x ?? 0) === Math.round(b.x ?? 0) &&
    Math.round(a.y ?? 0) === Math.round(b.y ?? 0) &&
    Math.round(a.width ?? 0) === Math.round(b.width ?? 0) &&
    Math.round(a.height ?? 0) === Math.round(b.height ?? 0)
  );
}

/** Days for the history list: Today, Yesterday, then the date. */
export function dayLabel(at: number, now: number): string {
  const day = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const difference = Math.round((day(now) - day(at)) / 86_400_000);
  if (difference <= 0) return "Today";
  if (difference === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
