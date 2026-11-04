import { Channel } from "@tauri-apps/api/core";
import { commands, type DictationEvent, type DictationModel } from "../bindings";
import { errorMessage } from "./errors";
import { settle } from "./ipc";

export interface DictationApi {
  model(): Promise<DictationModel>;
  download(id: string, event: (event: DictationEvent) => void): Promise<void>;
  start(id: string, event: (event: DictationEvent) => void): Promise<void>;
  stop(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}
/** The person's language tag, which Whisper hears in place of guessing from a short clip. */
export function systemLanguage(): string | null {
  return typeof navigator === "undefined" ? null : navigator.language || null;
}

export const dictationApi: DictationApi = {
  model: () => settle(commands.dictationModel()),
  download: async (id, onmessage) => {
    await settle(commands.dictationDownload(id, new Channel(onmessage)));
  },
  start: async (id, onmessage) => {
    await settle(commands.dictationStart(id, systemLanguage(), new Channel(onmessage)));
  },
  stop: async (id) => {
    await commands.dictationStop(id);
  },
  cancel: async (id) => {
    await commands.dictationCancel(id);
  },
};

/** What Rust reports for a processor without AVX2; the panel says it before any command runs. */
export const UNSUPPORTED_MESSAGE =
  "Dictation needs a processor with AVX2 (Intel from 2013 or AMD from 2015 onward). The rest of auracode works as usual.";

export type DictationState =
  | { state: "idle" | "checking" | "needs_model" | "ready" }
  | { state: "cancelling"; message?: string }
  | DictationEvent;

/** A new model download helps only when the model itself failed. */
export function offersModelDownload(value: DictationState): boolean {
  return value.state === "failed" && value.reason === "model";
}

/** Retrying cannot help a processor that lacks the engine's instructions. */
export function offersRetry(value: DictationState): boolean {
  return value.state === "failed" && value.reason !== "unsupported";
}
export function dictationBusy(value: DictationState): boolean {
  return [
    "checking",
    "downloading",
    "preparing",
    "recording",
    "transcribing",
    "cancelling",
  ].includes(value.state);
}

/** Owns one recording/download. Late events and invoke completions cannot edit another chat. */
export class DictationController {
  #state: DictationState = { state: "idle" };
  #listeners = new Set<() => void>();
  #active: string | null = null;
  #cancelled: string | null = null;
  #disposed = false;
  #generation = 0;
  constructor(
    readonly api: DictationApi,
    readonly insert: (text: string) => void,
  ) {}
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.#state;
  #set(value: DictationState) {
    if (this.#disposed) return;
    this.#state = value;
    for (const listener of this.#listeners) listener();
  }
  async open() {
    if (dictationBusy(this.#state) || this.#disposed) return;
    const generation = ++this.#generation;
    this.#set({ state: "checking" });
    try {
      const model = await this.api.model();
      if (this.#disposed || generation !== this.#generation) return;
      if (model.supported === false)
        this.#set({ state: "failed", message: UNSUPPORTED_MESSAGE, reason: "unsupported" });
      else if (model.installed) await this.start();
      else this.#set({ state: "needs_model" });
    } catch (error) {
      if (generation === this.#generation)
        this.#set({ state: "failed", message: errorMessage(error), reason: "other" });
    }
  }
  async #run(kind: "download" | "start") {
    if (this.#active || this.#disposed) return;
    const id = crypto.randomUUID();
    this.#active = id;
    this.#cancelled = null;
    this.#set(
      kind === "download"
        ? { state: "downloading", received: 0, total: 147951465 }
        : { state: "preparing" },
    );
    try {
      await this.api[kind](id, (event) => {
        if (this.#disposed || this.#active !== id) return;
        if (
          this.#cancelled === id &&
          !["cancelled", "complete", "failed", "model_ready"].includes(event.state)
        )
          return;
        if (["complete", "cancelled", "failed", "model_ready"].includes(event.state)) {
          this.#active = null;
          if (this.#cancelled === id) {
            this.#set({ state: "idle" });
            return;
          }
        }
        if (event.state === "complete") {
          if (event.text.trim()) this.insert(event.text.trim());
          this.#set({ state: "idle" });
        } else if (event.state === "model_ready") this.#set({ state: "ready" });
        else if (event.state === "cancelled") this.#set({ state: "idle" });
        else this.#set(event);
      });
      // The user can cancel/unmount while the native command is still being admitted.
      if (this.#disposed || this.#active !== id) {
        await this.api.cancel(id);
      } else if (this.#cancelled === id) await this.cancel();
    } catch (error) {
      if (this.#active !== id) return;
      this.#active = null;
      this.#set(
        this.#cancelled === id
          ? { state: "idle" }
          : { state: "failed", message: errorMessage(error), reason: "other" },
      );
    }
  }
  download() {
    return this.#run("download");
  }
  start() {
    return this.#run("start");
  }
  async stop() {
    if (!this.#active || this.#state.state !== "recording") return;
    const id = this.#active;
    try {
      await this.api.stop(id);
    } catch (error) {
      if (this.#active !== id) return;
      this.#set({ state: "failed", message: errorMessage(error), reason: "other" });
      await this.cancel();
    }
  }
  async cancel() {
    ++this.#generation;
    const id = this.#active;
    if (!id) {
      this.#set({ state: "idle" });
      return;
    }
    this.#cancelled = id;
    this.#set({ state: "cancelling" });
    try {
      await this.api.cancel(id);
    } catch (error) {
      if (this.#active !== id) return;
      this.#set({
        state: "cancelling",
        message: `Could not stop dictation. ${errorMessage(error)}`,
      });
    }
  }
  dispose() {
    void this.cancel();
    this.#disposed = true;
    this.#active = null;
    this.#listeners.clear();
  }
  activate() {
    if (this.#disposed) {
      this.#disposed = false;
      this.#set({ state: "idle" });
    }
  }
}

/** Use the original selection only if typing has not changed the draft in the meantime. */
export function insertDictation(
  current: string,
  transcript: string,
  original: string,
  start: number,
  end: number,
): string {
  const text = transcript.trim();
  if (!text) return current;
  const unchanged = current === original;
  const before = unchanged ? current.slice(0, start) : current;
  const after = unchanged ? current.slice(end) : "";
  const left = before && !/\s$/.test(before) ? " " : "";
  const right = after && !/^\s/.test(after) ? " " : "";
  return `${before}${left}${text}${right}${after}`;
}
