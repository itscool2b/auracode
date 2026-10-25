import type {
  AgentEntry,
  ChatStatusUpdate,
  ChatSummary,
  EnvStatus,
  StorageStatus,
} from "../../bindings";
import { errorMessage } from "../errors";
import type { Transport } from "./transport";

/**
 * What the whole window knows about chats, as an external store for React: the agents, the
 * environment agents start with, the chat list (kept current by the status channel), and the
 * storage status. Plain classes, so M2a can move them into Zustand slices unchanged.
 *
 * The storage status is polled (every 2 s while saving is paused or failed, every 5 s otherwise),
 * and so are the env while it resolves and the agents while one is still being checked: none of
 * them has a channel of its own.
 */

export interface AppSnapshot {
  readonly agents: readonly AgentEntry[] | null;
  readonly agentsRefreshing: boolean;
  readonly env: EnvStatus | null;
  readonly envError: string | null;
  /** Newest activity first. */
  readonly chats: readonly ChatSummary[] | null;
  readonly chatsError: string | null;
  readonly storage: StorageStatus | null;
}

/** Storage is polled this often while it saves, and `STORAGE_ALERT_POLL_MS` while it does not. */
export const STORAGE_POLL_MS = 5000;
export const STORAGE_ALERT_POLL_MS = 2000;
/** The env and the agents are polled this often while they are still being worked out. */
export const DETECTION_POLL_MS = 1000;
/** A status channel that ended is subscribed again after this long. */
export const STATUS_RESUBSCRIBE_MS = 1000;

const EMPTY: AppSnapshot = {
  agents: null,
  agentsRefreshing: false,
  env: null,
  envError: null,
  chats: null,
  chatsError: null,
  storage: null,
};

/** Newest activity first; equal times keep their order. */
function byActivity(chats: readonly ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => b.updated_at - a.updated_at);
}

export class AppStore {
  readonly #transport: Transport;
  readonly #listeners = new Set<() => void>();
  #state: AppSnapshot = EMPTY;
  #running = false;
  /**
   * Every start and stop gets a number. A poll still waiting for its answer when the store stops
   * (React's development mode starts, stops and starts again at once) must not re-arm in the
   * next run, or that run would poll twice.
   */
  #run = 0;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Every status subscription gets a number: a new one replaces the webview's earlier one, whose
   * channel then ends, and that end must not subscribe yet again.
   */
  #statusGeneration = 0;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): AppSnapshot => this.#state;

  /** Subscribes to the status channel and loads everything once; then keeps polling. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    const run = ++this.#run;
    this.#subscribeStatus(run);
    void this.reloadChats();
    void this.#pollStorage(run);
    void this.#pollEnv(run);
    void this.#pollAgents(run);
  }

  stop(): void {
    this.#running = false;
    this.#run += 1;
    this.#statusGeneration += 1;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  /** Runs `next` after `delay`, unless run `run` has ended by then (or already has). */
  #later(run: number, delay: number, next: () => void): void {
    if (!this.#running || run !== this.#run) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#running && run === this.#run) next();
    }, delay);
    this.#timers.add(timer);
  }

  #subscribeStatus(run: number): void {
    const generation = ++this.#statusGeneration;
    this.#transport
      .statusSubscribe(
        (update) => {
          if (generation === this.#statusGeneration) this.applyStatus(update);
        },
        () => {
          if (generation !== this.#statusGeneration) return;
          // The shell ended the channel: subscribe again, and catch up on what was missed.
          this.#later(run, STATUS_RESUBSCRIBE_MS, () => {
            this.#subscribeStatus(run);
            void this.reloadChats();
          });
        },
      )
      .catch(() => {
        if (generation !== this.#statusGeneration) return;
        this.#later(run, STATUS_RESUBSCRIBE_MS, () => this.#subscribeStatus(run));
      });
  }

  async reloadChats(): Promise<void> {
    try {
      const chats = await this.#transport.chatsList();
      this.#set({ ...this.#state, chats: byActivity(chats), chatsError: null });
    } catch (error) {
      this.#set({ ...this.#state, chatsError: errorMessage(error) });
    }
  }

  /** One status channel update: the chat's row changes; a chat this list lacks reloads it. */
  applyStatus(update: ChatStatusUpdate): void {
    const chats = this.#state.chats;
    if (chats === null || !chats.some((chat) => chat.id === update.chat_id)) {
      void this.reloadChats();
      return;
    }
    const next = chats.map((chat) =>
      chat.id === update.chat_id
        ? {
            ...chat,
            status: update.status,
            needs_attention: update.needs_attention,
            title: update.title ?? chat.title,
            updated_at: update.updated_at,
          }
        : chat,
    );
    this.#set({ ...this.#state, chats: byActivity(next) });
  }

  /** A chat this window just created (or opened) joins the list at once. */
  addChat(chat: ChatSummary): void {
    const others = (this.#state.chats ?? []).filter((known) => known.id !== chat.id);
    this.#set({ ...this.#state, chats: byActivity([chat, ...others]) });
  }

  async #pollStorage(run: number): Promise<void> {
    try {
      const storage = await this.#transport.storageStatus();
      if (!sameStorage(this.#state.storage, storage)) this.#set({ ...this.#state, storage });
    } catch {
      // Only a refused call fails here; the next poll tries again.
    }
    const saving = this.#state.storage?.state.state === "ok";
    this.#later(
      run,
      saving ? STORAGE_POLL_MS : STORAGE_ALERT_POLL_MS,
      () => void this.#pollStorage(run),
    );
  }

  async #pollEnv(run: number): Promise<void> {
    try {
      const env = await this.#transport.envStatus();
      this.#set({ ...this.#state, env, envError: null });
    } catch (error) {
      this.#set({ ...this.#state, envError: errorMessage(error) });
    }
    if (this.#state.env?.state.state === "resolving") {
      this.#later(run, DETECTION_POLL_MS, () => void this.#pollEnv(run));
    }
  }

  async #pollAgents(run: number): Promise<void> {
    try {
      const agents = await this.#transport.agentsList();
      this.#set({ ...this.#state, agents });
    } catch {
      // Agents stay as they were; the next poll or Refresh tries again.
    }
    if (this.#state.agents?.some((agent) => agent.availability.state === "checking")) {
      this.#later(run, DETECTION_POLL_MS, () => void this.#pollAgents(run));
    }
  }

  /** "Refresh agents": the env again and every probe (15 s at most). */
  async refreshAgents(): Promise<void> {
    if (this.#state.agentsRefreshing) return;
    this.#set({ ...this.#state, agentsRefreshing: true });
    try {
      const agents = await this.#transport.agentsRefresh();
      this.#set({ ...this.#state, agents, agentsRefreshing: false });
    } catch {
      this.#set({ ...this.#state, agentsRefreshing: false });
    }
  }

  /** The env banner's Retry: a new resolution, followed until it ends. */
  async retryEnv(): Promise<void> {
    const run = this.#run;
    try {
      const env = await this.#transport.envRefresh();
      this.#set({ ...this.#state, env, envError: null });
    } catch (error) {
      this.#set({ ...this.#state, envError: errorMessage(error) });
    }
    this.#later(run, DETECTION_POLL_MS, () => void this.#pollEnv(run));
  }

  #set(state: AppSnapshot): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
}

function sameStorage(a: StorageStatus | null, b: StorageStatus): boolean {
  return (
    a !== null &&
    a.unsaved_bytes === b.unsaved_bytes &&
    JSON.stringify(a.state) === JSON.stringify(b.state)
  );
}

/** Whether an agent can be chosen for a new chat, and why not. */
export function agentChoice(agent: AgentEntry): {
  readonly enabled: boolean;
  readonly reason: string | null;
} {
  switch (agent.availability.state) {
    case "ready":
    case "checking":
      // A chat created while its agent is still checked waits for the detection at its start.
      return { enabled: true, reason: null };
    case "missing":
    case "broken":
      return { enabled: false, reason: agent.availability.reason };
  }
}

export interface NewChatState {
  readonly agentId: string | null;
  readonly folder: string | null;
  readonly picking: boolean;
  readonly creating: boolean;
  readonly error: string | null;
}

/** The New chat screen: an agent, a folder from the picker, and Create. */
export class NewChatDraft {
  readonly #transport: Transport;
  readonly #listeners = new Set<() => void>();
  #state: NewChatState = {
    agentId: null,
    folder: null,
    picking: false,
    creating: false,
    error: null,
  };

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): NewChatState => this.#state;

  chooseAgent(agentId: string): void {
    this.#set({ ...this.#state, agentId, error: null });
  }

  /** The system folder picker; cancelling it changes nothing. */
  async chooseFolder(): Promise<void> {
    if (this.#state.picking) return;
    this.#set({ ...this.#state, picking: true });
    try {
      const folder = await this.#transport.pickFolder();
      this.#set({
        ...this.#state,
        picking: false,
        folder: folder ?? this.#state.folder,
        error: folder === null ? this.#state.error : null,
      });
    } catch (error) {
      this.#set({ ...this.#state, picking: false, error: errorMessage(error) });
    }
  }

  /** Creates the chat (which starts its agent). Answers it, or `null` with the error shown. */
  async create(): Promise<ChatSummary | null> {
    const { agentId, folder, creating } = this.#state;
    if (agentId === null || folder === null || creating) return null;
    this.#set({ ...this.#state, creating: true, error: null });
    try {
      const chat = await this.#transport.chatCreate(agentId, folder);
      this.#set({ ...this.#state, creating: false });
      return chat;
    } catch (error) {
      this.#set({ ...this.#state, creating: false, error: errorMessage(error) });
      return null;
    }
  }

  #set(state: NewChatState): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
}
