import type {
  AuraEvent,
  AuthPrompt,
  Autonomy,
  ChatAttach,
  ChatSummary,
  ConfigValue,
  ErrorInfo,
  EventBatch,
  HistoryPage,
  LimitWindow,
  QueuedPrompt,
  SessionInfo,
  SessionLists,
  StorageStatus,
  UiAnswer,
  UsageInfo,
} from "../../bindings";
import { errorMessage } from "../errors";
import { CommandError } from "../ipc";
import { applyEntries, type Entry, emptyTranscript, type Transcript } from "./transcript";
import type { Transport } from "./transport";

/**
 * One open chat view, as an external store for React (`useSyncExternalStore`).
 *
 * **Joining** (spec 6.8): the view's channel buffers frames while `chat_attach` runs; the answer
 * brings the snapshot, the newest history page and `next_seq`. The page is applied, then the
 * buffered frames from `next_seq` on, then live frames. A frame that starts past the expected seq,
 * or the channel ending, means frames were lost: the store detaches, drops its state and attaches
 * again. A failed attach is retried when the storage status changes and on Retry.
 *
 * **Everything else**: the queue and the header follow the live frames; cards and questions
 * disable their buttons while an answer is on its way, and a `request_not_pending` answer closes
 * them; the lists (options, slash commands, autonomy) are fetched on attach and again, debounced,
 * whenever the session's `revision` changes; Esc interrupts, then force-stops; "Load full output"
 * pages through a blob; "Still working" shows after a minute without frames during a turn.
 */

export type ChatPhase = "attaching" | "live" | "failed";

/** A card or question with an answer on its way, or one that is no longer waiting. */
export interface RequestState {
  readonly busy: boolean;
  /** The shell said `request_not_pending`: the card closes without its resolution. */
  readonly gone: boolean;
  readonly error: string | null;
}

/** A full output loaded page by page. */
export interface BlobState {
  readonly text: string;
  readonly nextOffset: number;
  readonly total: number;
  readonly eof: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ChatState {
  readonly chatId: string;
  readonly phase: ChatPhase;
  /** Why the last attach failed. */
  readonly attachError: string | null;
  readonly chat: ChatSummary | null;
  readonly session: SessionInfo | null;
  readonly queue: readonly QueuedPrompt[];
  readonly usage: UsageInfo | null;
  readonly limits: readonly LimitWindow[] | null;
  readonly lastError: ErrorInfo | null;
  readonly auth: AuthPrompt | null;
  readonly storage: StorageStatus | null;
  readonly transcript: Transcript;
  readonly hasMore: boolean;
  readonly loadingEarlier: boolean;
  readonly earlierError: string | null;
  /** Rows that did not parse (written by a newer build), across the loaded pages. */
  readonly skipped: number;
  /** Saving is paused: rows from this seq to the attach point are not shown yet. */
  readonly unsavedFrom: number | null;
  readonly lists: SessionLists | null;
  readonly listsError: string | null;
  readonly requests: ReadonlyMap<string, RequestState>;
  readonly blobs: ReadonlyMap<string, BlobState>;
  /** The last failed send, shown under the composer. */
  readonly sendError: string | null;
  /** The last failed header, queue or picker action. */
  readonly actionError: string | null;
  /** Minutes without a frame while a turn runs, once there is at least one. */
  readonly stillWorkingMinutes: number | null;
}

/** How much `chat_blob` returns per call at most. */
export const BLOB_PAGE = 256 * 1024;

/** A new `revision` refetches the lists after this long without another one. */
export const LISTS_DEBOUNCE_MS = 200;

/** "Still working" shows after this long without a frame during a turn. */
export const STILL_WORKING_MS = 60_000;

export interface ChatStoreOptions {
  /** Wall clock, for queued prompts' times and the still-working hint. */
  readonly now?: () => number;
}

function initialState(chatId: string): ChatState {
  return {
    chatId,
    phase: "attaching",
    attachError: null,
    chat: null,
    session: null,
    queue: [],
    usage: null,
    limits: null,
    lastError: null,
    auth: null,
    storage: null,
    transcript: emptyTranscript(),
    hasMore: false,
    loadingEarlier: false,
    earlierError: null,
    skipped: 0,
    unsavedFrom: null,
    lists: null,
    listsError: null,
    requests: new Map(),
    blobs: new Map(),
    sendError: null,
    actionError: null,
    stillWorkingMinutes: null,
  };
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof CommandError && error.code === code;
}

/** Whether a stop in this status holds every prompt queued until now. */
function holdsQueue(status: SessionInfo["status"]): boolean {
  switch (status) {
    case "cancelling":
    case "stopping":
    case "stopped":
    case "failed":
    case "auth_required":
      return true;
    case "starting":
    case "ready":
    case "running":
      return false;
  }
}

export class ChatStore {
  readonly chatId: string;
  readonly #transport: Transport;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  #state: ChatState;

  /** Every attach gets a number; frames, ends and answers of older ones are ignored. */
  #generation = 0;
  #subscriptionId: string | null = null;
  /** Frames that arrived while the attach call ran. */
  #buffer: EventBatch[] = [];
  #attaching = false;
  #expectedSeq = 0;
  /** Every applied entry, oldest first: "Load earlier" rebuilds the transcript from these. */
  #entries: Entry[] = [];
  /** The oldest loaded page's cut turn. */
  #cut: string | null = null;
  #beforeSeq: number | null = null;
  #closed = false;

  #listsTimer: ReturnType<typeof setTimeout> | null = null;
  #listsRequest = 0;
  #stillTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the last frame arrived or the running turn started. */
  #lastActivity = 0;
  /** An interrupt was asked for and the turn has not ended: the next Esc force-stops. */
  #interruptAsked = false;
  /** A snapshot taken in `auth_required` is fresh: no need to join again for its commands. */
  #authRefreshed = false;
  /** The channel ended while its attach call ran: the attach's answer decides what follows. */
  #endedWhileAttaching = false;
  /** Joins that lost their subscription again before any live frame arrived. */
  #quickRejoins = 0;
  #rejoinTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(chatId: string, transport: Transport, options: ChatStoreOptions = {}) {
    this.chatId = chatId;
    this.#transport = transport;
    this.#now = options.now ?? (() => Date.now());
    this.#state = initialState(chatId);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ChatState => this.#state;

  /** Opens the view: the first attach. */
  open(): Promise<void> {
    this.#closed = false;
    return this.#attach();
  }

  /** Closes the view (unmount): detaches and stops every timer. */
  close(): void {
    this.#closed = true;
    this.#generation += 1;
    this.#clearTimers();
    const subscription = this.#subscriptionId;
    this.#subscriptionId = null;
    if (subscription !== null) {
      this.#transport.detach(subscription).catch(() => undefined);
    }
  }

  /** Detaches, drops the view's state and attaches again: Retry, or a storage change. */
  async reattach(): Promise<void> {
    if (this.#closed) return;
    this.#quickRejoins = 0;
    await this.#rejoin();
  }

  async #rejoin(): Promise<void> {
    if (this.#rejoinTimer !== null) {
      clearTimeout(this.#rejoinTimer);
      this.#rejoinTimer = null;
    }
    this.#generation += 1;
    const subscription = this.#subscriptionId;
    this.#subscriptionId = null;
    // Detach first, so the shell never holds two views of this chat for this window.
    if (subscription !== null) {
      await this.#transport.detach(subscription).catch(() => undefined);
    }
    if (this.#closed) return;
    await this.#attach();
  }

  /**
   * Frames were lost (a gap) or the channel ended: join again. The first time at once; when joins
   * keep losing their subscription before any live frame, after a growing pause, so a broken
   * session never spins.
   */
  #lost(): void {
    if (this.#closed) return;
    const attempt = this.#quickRejoins;
    this.#quickRejoins += 1;
    if (attempt < 2) {
      void this.#rejoin();
      return;
    }
    this.#generation += 1;
    this.#set({ ...this.#state, phase: "attaching" });
    if (this.#rejoinTimer !== null) clearTimeout(this.#rejoinTimer);
    const delay = Math.min(250 * 2 ** (attempt - 2), 5000);
    this.#rejoinTimer = setTimeout(() => {
      this.#rejoinTimer = null;
      void this.#rejoin();
    }, delay);
  }

  /** The storage status changed: a failed attach retries; a page with unsaved rows re-attaches. */
  storageChanged(status: StorageStatus): void {
    const previous = this.#state.storage;
    if (previous !== null && sameStorage(previous, status)) return;
    this.#set({ ...this.#state, storage: status });
    if (this.#state.phase === "failed") {
      void this.reattach();
    } else if (this.#state.unsavedFrom !== null && status.state.state === "ok") {
      void this.reattach();
    }
  }

  // ---------- the join protocol ----------

  async #attach(): Promise<void> {
    const generation = ++this.#generation;
    this.#buffer = [];
    this.#attaching = true;
    this.#endedWhileAttaching = false;
    this.#set({ ...this.#state, phase: "attaching", attachError: null });
    let attached: ChatAttach;
    try {
      attached = await this.#transport.attach(
        this.chatId,
        (frame) => this.#onFrame(generation, frame),
        () => this.#onEnd(generation),
      );
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#attaching = false;
      this.#set({ ...this.#state, phase: "failed", attachError: errorMessage(error) });
      return;
    }
    if (generation !== this.#generation || this.#closed) {
      // Replaced or closed while attaching: the shell drops this subscription.
      this.#transport.detach(attached.subscription_id).catch(() => undefined);
      return;
    }
    this.#attaching = false;
    this.#subscriptionId = attached.subscription_id;
    this.#applyAttach(attached);
    const buffered = this.#buffer;
    this.#buffer = [];
    for (const frame of buffered) {
      if (!this.#applyFrame(frame)) return;
    }
    this.#refreshLists();
    if (this.#endedWhileAttaching) this.#lost();
  }

  #applyAttach(attached: ChatAttach): void {
    const { snapshot, history } = attached;
    this.#cut = history.cut_turn_id;
    this.#beforeSeq = history.before_seq;
    this.#entries = pageEntries(history);
    if (history.unsaved_from !== null) {
      this.#entries.push({ seq: history.unsaved_from, gap: true });
    }
    this.#expectedSeq = attached.next_seq;
    this.#interruptAsked = false;
    this.#authRefreshed = snapshot.session.status === "auth_required";
    this.#lastActivity = this.#now();
    this.#set({
      ...this.#state,
      phase: "live",
      attachError: null,
      chat: snapshot.chat,
      session: snapshot.session,
      queue: snapshot.queue,
      usage: snapshot.usage,
      limits: snapshot.limits,
      lastError: snapshot.last_error,
      auth: snapshot.auth,
      storage: snapshot.storage,
      transcript: applyEntries(emptyTranscript(this.#cut), this.#entries),
      hasMore: history.has_more,
      loadingEarlier: false,
      earlierError: null,
      skipped: history.skipped,
      unsavedFrom: history.unsaved_from,
      requests: new Map(),
      stillWorkingMinutes: null,
    });
    this.#armStillWorking();
  }

  #onFrame(generation: number, frame: EventBatch): void {
    if (generation !== this.#generation || this.#closed) return;
    if (this.#attaching) {
      this.#buffer.push(frame);
      return;
    }
    this.#applyFrame(frame);
  }

  #onEnd(generation: number): void {
    if (generation !== this.#generation || this.#closed) return;
    if (this.#attaching) {
      // A refused attach ends its channel too; its answer says what happened.
      this.#endedWhileAttaching = true;
      return;
    }
    // The shell dropped this view (its session stopped, or it was replaced): join again.
    this.#lost();
  }

  /** Applies one frame; a gap joins again and answers `false`. */
  #applyFrame(frame: EventBatch): boolean {
    const ahead = frame.seq_start - this.#expectedSeq;
    if (ahead > 0) {
      this.#lost();
      return false;
    }
    if (!this.#attaching) this.#quickRejoins = 0;
    const skip = Math.min(-ahead, frame.events.length);
    const events = frame.events.slice(skip);
    this.#expectedSeq = Math.max(this.#expectedSeq, frame.seq_start + frame.events.length);
    this.#lastActivity = this.#now();
    if (events.length === 0) return true;
    const entries: Entry[] = events.map((event, index) => ({
      seq: frame.seq_start + skip + index,
      turnId: null,
      event,
    }));
    this.#entries.push(...entries);
    let state: ChatState = {
      ...this.#state,
      transcript: applyEntries(this.#state.transcript, entries),
      stillWorkingMinutes: null,
    };
    for (const event of events) state = this.#applyLive(state, event);
    this.#set(state);
    this.#armStillWorking();
    return true;
  }

  /** The live state a frame's events change: the header, the queue, usage and limits. */
  #applyLive(state: ChatState, event: AuraEvent): ChatState {
    switch (event.type) {
      case "session_updated": {
        const { type: _type, ...session } = event;
        return this.#sessionChanged(state, session);
      }
      case "prompt_lifecycle": {
        if (event.state === "queued") {
          const queued: QueuedPrompt = {
            prompt_id: event.prompt_id,
            preview: event.preview ?? "",
            held: false,
            created_at: this.#now(),
          };
          return {
            ...state,
            queue: [...state.queue.filter((row) => row.prompt_id !== event.prompt_id), queued],
          };
        }
        return { ...state, queue: state.queue.filter((row) => row.prompt_id !== event.prompt_id) };
      }
      case "usage_updated": {
        const { type: _type, ...usage } = event;
        return { ...state, usage };
      }
      case "limits_updated":
        return { ...state, limits: event.windows };
      case "permission_resolved":
      case "ui_resolved":
        // The card is resolved now; whatever answer was on its way is done.
        return { ...state, requests: without(state.requests, event.request_id) };
      default:
        return state;
    }
  }

  #sessionChanged(state: ChatState, session: SessionInfo): ChatState {
    const previous = state.session;
    let queue = state.queue;
    if (!session.queue_held) {
      if (queue.some((row) => row.held)) queue = queue.map((row) => ({ ...row, held: false }));
    } else if (
      previous === null ||
      !previous.queue_held ||
      (previous.status !== session.status && holdsQueue(session.status))
    ) {
      // A stop, an error or a crash holds every prompt queued until now; the frames say only
      // that some are held, and those that arrive afterwards are not.
      queue = queue.map((row) => (row.held ? row : { ...row, held: true }));
    }
    if (session.status !== "running" && session.status !== "cancelling") {
      this.#interruptAsked = false;
    }
    if (previous?.status !== "running" && session.status === "running") {
      this.#lastActivity = this.#now();
    }
    if (previous !== null && previous.revision !== session.revision) this.#scheduleLists();
    if (session.status === "auth_required" && state.auth === null && !this.#authRefreshed) {
      // The frames carry no sign-in commands: a fresh snapshot does.
      this.#authRefreshed = true;
      queueMicrotask(() => void this.reattach());
    } else if (session.status !== "auth_required") {
      this.#authRefreshed = false;
    }
    return {
      ...state,
      session,
      queue,
      auth: session.status === "auth_required" ? state.auth : null,
    };
  }

  /** The older page: the same turn continues when the newest one cut it. */
  async loadEarlier(): Promise<void> {
    const before = this.#beforeSeq;
    if (!this.#state.hasMore || before === null || this.#state.loadingEarlier) return;
    const generation = this.#generation;
    this.#set({ ...this.#state, loadingEarlier: true, earlierError: null });
    let page: HistoryPage;
    try {
      page = await this.#transport.history(this.chatId, before);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#set({ ...this.#state, loadingEarlier: false, earlierError: errorMessage(error) });
      return;
    }
    if (generation !== this.#generation) return;
    this.#cut = page.cut_turn_id;
    this.#beforeSeq = page.before_seq;
    this.#entries = [...pageEntries(page), ...this.#entries];
    this.#set({
      ...this.#state,
      transcript: applyEntries(emptyTranscript(this.#cut), this.#entries),
      hasMore: page.has_more,
      loadingEarlier: false,
      skipped: this.#state.skipped + page.skipped,
    });
  }

  // ---------- the lists ----------

  #scheduleLists(): void {
    if (this.#listsTimer !== null) clearTimeout(this.#listsTimer);
    this.#listsTimer = setTimeout(() => {
      this.#listsTimer = null;
      this.#refreshLists();
    }, LISTS_DEBOUNCE_MS);
  }

  #refreshLists(): void {
    const request = ++this.#listsRequest;
    this.#transport.lists(this.chatId).then(
      (lists) => {
        if (request !== this.#listsRequest || this.#closed) return;
        this.#set({ ...this.#state, lists, listsError: null });
      },
      (error: unknown) => {
        if (request !== this.#listsRequest || this.#closed) return;
        this.#set({ ...this.#state, listsError: errorMessage(error) });
      },
    );
  }

  async setOption(optionId: string, value: ConfigValue): Promise<void> {
    try {
      const lists = await this.#transport.setOption(this.chatId, optionId, value);
      this.#listsRequest += 1;
      this.#set({ ...this.#state, lists, listsError: null });
    } catch (error) {
      this.#set({ ...this.#state, listsError: errorMessage(error) });
    }
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    try {
      const lists = await this.#transport.setAutonomy(this.chatId, autonomy);
      this.#listsRequest += 1;
      this.#set({ ...this.#state, lists, listsError: null });
    } catch (error) {
      this.#set({ ...this.#state, listsError: errorMessage(error) });
    }
  }

  // ---------- prompts and the session ----------

  /** Sends the text exactly as typed. Answers whether it was taken (the composer then clears). */
  async send(text: string): Promise<boolean> {
    if (text.trim() === "") return false;
    try {
      await this.#transport.send(this.chatId, text);
      this.#set({ ...this.#state, sendError: null });
      return true;
    } catch (error) {
      this.#set({ ...this.#state, sendError: errorMessage(error) });
      return false;
    }
  }

  cancelQueued(promptId: string): Promise<void> {
    return this.#act(
      () => this.#transport.cancelQueued(this.chatId, promptId),
      (error) => {
        if (isCode(error, "request_not_pending")) {
          // It started or was removed meanwhile.
          this.#set({
            ...this.#state,
            queue: this.#state.queue.filter((row) => row.prompt_id !== promptId),
          });
          return true;
        }
        return false;
      },
    );
  }

  resumeQueue(): Promise<void> {
    return this.#act(() => this.#transport.resumeQueue(this.chatId));
  }

  start(fresh: boolean): Promise<void> {
    return this.#act(() => this.#transport.start(this.chatId, fresh));
  }

  stop(): Promise<void> {
    return this.#act(() => this.#transport.stop(this.chatId));
  }

  interrupt(): Promise<void> {
    this.#interruptAsked = true;
    return this.#act(() => this.#transport.interrupt(this.chatId));
  }

  forceStop(): Promise<void> {
    return this.#act(() => this.#transport.forceStop(this.chatId));
  }

  /** Esc: interrupts a running (or starting) turn; the next Esc, while it cancels, force-stops. */
  escape(): Promise<void> | null {
    const status = this.#state.session?.status;
    if (status === "cancelling" || (status === "running" && this.#interruptAsked)) {
      return this.forceStop();
    }
    if (status === "running" || status === "starting") return this.interrupt();
    return null;
  }

  revealLog(): Promise<void> {
    return this.#act(() => this.#transport.revealLog(this.chatId));
  }

  async #act(
    call: () => Promise<void>,
    handled: (error: unknown) => boolean = () => false,
  ): Promise<void> {
    try {
      await call();
      if (this.#state.actionError !== null) this.#set({ ...this.#state, actionError: null });
    } catch (error) {
      if (!handled(error)) this.#set({ ...this.#state, actionError: errorMessage(error) });
    }
  }

  // ---------- cards and questions ----------

  /** Answers a permission card (`null` dismisses it). Its buttons stay disabled meanwhile. */
  respondPermission(requestId: string, optionId: string | null): Promise<void> {
    return this.#answer(requestId, () =>
      this.#transport.respondPermission(this.chatId, requestId, optionId),
    );
  }

  /** Answers a question (`null` dismisses it). */
  respondUi(requestId: string, answer: UiAnswer | null): Promise<void> {
    return this.#answer(requestId, () => this.#transport.respondUi(this.chatId, requestId, answer));
  }

  async #answer(requestId: string, call: () => Promise<void>): Promise<void> {
    if (this.#state.requests.get(requestId)?.busy) return;
    this.#setRequest(requestId, { busy: true, gone: false, error: null });
    try {
      await call();
      // Disabled until the resolution arrives in a frame.
    } catch (error) {
      if (isCode(error, "request_not_pending")) {
        this.#setRequest(requestId, { busy: false, gone: true, error: null });
      } else {
        this.#setRequest(requestId, { busy: false, gone: false, error: errorMessage(error) });
      }
    }
  }

  #setRequest(requestId: string, request: RequestState): void {
    const requests = new Map(this.#state.requests);
    requests.set(requestId, request);
    this.#set({ ...this.#state, requests });
  }

  // ---------- full outputs ----------

  /** Loads the next page of a truncated output (256 KiB, ending on a character boundary). */
  async loadBlob(sha256: string): Promise<void> {
    const current = this.#state.blobs.get(sha256);
    if (current?.loading || current?.eof) return;
    const offset = current?.nextOffset ?? 0;
    this.#setBlob(sha256, {
      text: current?.text ?? "",
      nextOffset: offset,
      total: current?.total ?? 0,
      eof: false,
      loading: true,
      error: null,
    });
    try {
      const page = await this.#transport.blob(this.chatId, sha256, offset, BLOB_PAGE);
      this.#setBlob(sha256, {
        text: (current?.text ?? "") + page.text,
        nextOffset: page.next_offset,
        total: page.total,
        eof: page.eof,
        loading: false,
        error: null,
      });
    } catch (error) {
      this.#setBlob(sha256, {
        text: current?.text ?? "",
        nextOffset: offset,
        total: current?.total ?? 0,
        eof: false,
        loading: false,
        error: errorMessage(error),
      });
    }
  }

  #setBlob(sha256: string, blob: BlobState): void {
    const blobs = new Map(this.#state.blobs);
    blobs.set(sha256, blob);
    this.#set({ ...this.#state, blobs });
  }

  // ---------- still working ----------

  /** Re-arms the hint: it shows a minute after the last frame of a running turn, then counts up. */
  #armStillWorking(): void {
    if (this.#stillTimer !== null) {
      clearTimeout(this.#stillTimer);
      this.#stillTimer = null;
    }
    if (this.#closed || this.#state.session?.status !== "running") {
      if (this.#state.stillWorkingMinutes !== null) {
        this.#set({ ...this.#state, stillWorkingMinutes: null });
      }
      return;
    }
    const quiet = this.#now() - this.#lastActivity;
    const minutes = Math.floor(quiet / STILL_WORKING_MS);
    if (minutes >= 1 && this.#state.stillWorkingMinutes !== minutes) {
      this.#set({ ...this.#state, stillWorkingMinutes: minutes });
    }
    const nextAt = (minutes + 1) * STILL_WORKING_MS - quiet;
    this.#stillTimer = setTimeout(() => {
      this.#stillTimer = null;
      this.#armStillWorking();
    }, nextAt);
  }

  #clearTimers(): void {
    if (this.#listsTimer !== null) clearTimeout(this.#listsTimer);
    if (this.#stillTimer !== null) clearTimeout(this.#stillTimer);
    if (this.#rejoinTimer !== null) clearTimeout(this.#rejoinTimer);
    this.#listsTimer = null;
    this.#stillTimer = null;
    this.#rejoinTimer = null;
  }

  #set(state: ChatState): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
}

function pageEntries(page: HistoryPage): Entry[] {
  return page.items.map((item) => ({ seq: item.seq, turnId: item.turn_id, event: item.event }));
}

function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  if (!map.has(key)) return map;
  const copy = new Map(map);
  copy.delete(key);
  return copy;
}

function sameStorage(a: StorageStatus, b: StorageStatus): boolean {
  return a.unsaved_bytes === b.unsaved_bytes && JSON.stringify(a.state) === JSON.stringify(b.state);
}
