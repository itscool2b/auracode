/**
 * Whether a chat shows as Chat (auracode's interface) or Terminal (its agent's own interface in
 * auracode's terminal; docs/superpowers/plans/2026-11-06-terminal-chats.md). The choice is this
 * device's: a terminal needs the agent's CLI here, and the chat's synced record stays as it was,
 * so a chat synced to another device opens there as Chat. New chats take the default saved here.
 */
export type ChatInterface = "chat" | "terminal";

/** The agents whose own interface a chat can open in. */
export const TERMINAL_AGENTS: ReadonlySet<string> = new Set(["claude", "codex"]);

export function terminalSupported(agentId: string): boolean {
  return TERMINAL_AGENTS.has(agentId);
}

const PREFIX = "auracode.chat-interface.";
const DEFAULT_KEY = "auracode.chat-interface-default";

export interface InterfaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The choices as an external store for React. Storage failures leave Chat in place. */
export class ChatInterfaces {
  readonly #storage: InterfaceStorage | null;
  readonly #listeners = new Set<() => void>();
  #version = 0;

  constructor(storage: InterfaceStorage | null) {
    this.#storage = storage;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Changes whenever a choice does, for useSyncExternalStore. */
  readonly getVersion = (): number => this.#version;

  /** The chat's view: Terminal only when it was chosen here and its agent has one. */
  of(chatId: string, agentId: string): ChatInterface {
    return this.#read(PREFIX + chatId) === "terminal" && terminalSupported(agentId)
      ? "terminal"
      : "chat";
  }

  set(chatId: string, value: ChatInterface): void {
    this.#write(PREFIX + chatId, value === "terminal" ? "terminal" : null);
  }

  /** What New chat starts with. */
  defaultInterface(): ChatInterface {
    return this.#read(DEFAULT_KEY) === "terminal" ? "terminal" : "chat";
  }

  setDefault(value: ChatInterface): void {
    this.#write(DEFAULT_KEY, value === "terminal" ? "terminal" : null);
  }

  #read(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  #write(key: string, value: string | null): void {
    try {
      if (value === null) this.#storage?.removeItem(key);
      else this.#storage?.setItem(key, value);
    } catch {
      /* A full or blocked storage keeps the last choice; Chat is always available. */
    }
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}

export const chatInterfaces = new ChatInterfaces(
  typeof localStorage === "undefined" ? null : localStorage,
);
