import type { ComposerAttachment, ComposerInput } from "../bindings";
import type { ComposerTransport } from "./composer";
import { errorMessage } from "./errors";

interface DraftState {
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly mentions: readonly string[];
  readonly ready: boolean;
  readonly error: string | null;
}

/** Keeps an editor alive across view changes; Rust owns its durable copy. Writes are serialized. */
export class ComposerDraftStore {
  #state: DraftState = { text: "", attachments: [], mentions: [], ready: false, error: null };
  readonly #listeners = new Set<() => void>();
  #dirty = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving: Promise<void> | null = null;
  #loading = false;
  constructor(
    readonly chatId: string | undefined,
    readonly api: ComposerTransport | undefined,
  ) {
    if (!chatId || !api) this.#state = { ...this.#state, ready: true };
    else void this.load();
  }
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) void this.flush();
    };
  };
  readonly getSnapshot = () => this.#state;
  get disposable() {
    return this.#listeners.size === 0 && !this.#dirty && !this.#saving && !this.#loading;
  }
  get saved() {
    return !this.#dirty && !this.#saving;
  }
  #emit(state: DraftState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  async load() {
    if (!this.api || !this.chatId || this.#loading || this.#state.ready) return;
    this.#loading = true;
    try {
      const draft = await this.api.draft(this.chatId);
      this.#emit({
        text: draft.input.text,
        attachments: draft.files,
        mentions: draft.input.mentions,
        ready: true,
        error: null,
      });
    } catch (error) {
      this.#emit({
        ...this.#state,
        error: `Could not open the saved draft. ${errorMessage(error)}`,
      });
    } finally {
      this.#loading = false;
    }
  }
  update(change: Partial<Pick<DraftState, "text" | "attachments" | "mentions">>) {
    if (!this.#state.ready) return;
    this.#emit({ ...this.#state, ...change });
    this.#dirty = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, 200);
  }
  input(): ComposerInput {
    return {
      text: this.#state.text,
      attachments: this.#state.attachments.map((item) => item.id),
      mentions: [...this.#state.mentions],
    };
  }
  /** A send may finish after the user switches chats or continues editing the draft. */
  consume(sent: ComposerInput, onlyMatching = false) {
    if (onlyMatching && JSON.stringify(this.input()) !== JSON.stringify(sent)) return;
    this.update({
      text: this.#state.text === sent.text ? "" : this.#state.text,
      attachments: this.#state.attachments.filter((item) => !sent.attachments.includes(item.id)),
      mentions: this.#state.mentions.filter((path) => !sent.mentions.includes(path)),
    });
    void this.flush();
  }
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#saving) return this.#saving;
    if (!this.api || !this.chatId || !this.#dirty || !this.#state.ready) return;
    this.#saving = (async () => {
      while (this.#dirty) {
        this.#dirty = false;
        const input = this.input();
        try {
          await this.api?.saveDraft(this.chatId as string, input);
          if (this.#state.error) this.#emit({ ...this.#state, error: null });
        } catch (error) {
          this.#dirty = true;
          this.#emit({ ...this.#state, error: `Draft has not been saved. ${errorMessage(error)}` });
          break;
        }
      }
    })().finally(() => {
      this.#saving = null;
    });
    return this.#saving;
  }
}

const drafts = new WeakMap<ComposerTransport, Map<string, ComposerDraftStore>>();
export async function flushComposerDrafts(api: ComposerTransport): Promise<boolean> {
  const stores = [...(drafts.get(api)?.values() ?? [])];
  await Promise.all(stores.map((store) => store.flush()));
  return stores.every((store) => store.saved);
}
export function composerDraft(chatId: string | undefined, api: ComposerTransport | undefined) {
  if (!chatId || !api) return new ComposerDraftStore(chatId, api);
  let cache = drafts.get(api);
  if (!cache) {
    cache = new Map();
    drafts.set(api, cache);
  }
  const existing = cache.get(chatId);
  if (existing) return existing;
  if (cache.size >= 64)
    for (const [id, value] of cache) {
      if (value.disposable) cache.delete(id);
      if (cache.size < 64) break;
    }
  const store = new ComposerDraftStore(chatId, api);
  cache.set(chatId, store);
  return store;
}
