/**
 * The Dashboard cards the person cleared, on this device: each chat with the last activity it had
 * when cleared, so its card comes back with its next activity. Nothing is archived or deleted; a
 * cleared chat stays in the sidebar. Entries for chats that are gone are dropped as the list is
 * written, and the list stays small.
 */
import type { ChatSummary } from "../bindings";

const KEY = "auracode.dashboard-cleared";
const MAX_ENTRIES = 500;

export interface ClearedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type ClearedMap = ReadonlyMap<string, number>;

export function parseCleared(text: string | null): ClearedMap {
  const map = new Map<string, number>();
  if (!text) return map;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return map;
    for (const [id, at] of Object.entries(value)) {
      if (typeof at === "number" && Number.isFinite(at) && id.length <= 128) map.set(id, at);
    }
  } catch {
    /* Unreadable: nothing is cleared. */
  }
  return map;
}

/** The cleared cards as an external store for React. */
export class DashboardCleared {
  readonly #storage: ClearedStorage | null;
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #map: ClearedMap;

  constructor(storage: ClearedStorage | null) {
    this.#storage = storage;
    let text: string | null = null;
    try {
      text = storage?.getItem(KEY) ?? null;
    } catch {
      text = null;
    }
    this.#map = parseCleared(text);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getVersion = (): number => this.#version;

  /** Cleared, and nothing has happened in the chat since. */
  readonly isCleared = (chat: ChatSummary): boolean => {
    const at = this.#map.get(chat.id);
    return at !== undefined && chat.updated_at <= at;
  };

  /** Clears these chats' cards; `known` are every chat that still exists, to drop the rest. */
  clear(chats: readonly ChatSummary[], known: readonly ChatSummary[]): void {
    if (chats.length === 0) return;
    const alive = new Set(known.map((chat) => chat.id));
    const next = new Map([...this.#map].filter(([id]) => alive.has(id)));
    for (const chat of chats) next.set(chat.id, chat.updated_at);
    // The newest clearings are kept when the list would grow past its size.
    const entries = [...next].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
    this.#map = new Map(entries);
    try {
      this.#storage?.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* A blocked storage keeps the clearing for this run only. */
    }
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}

export const dashboardCleared = new DashboardCleared(
  typeof localStorage === "undefined" ? null : localStorage,
);
