/**
 * The clone form's state, outside React so it can be tested without a DOM. Rust reads the form
 * after every change (typing waits 200ms) and answers with the exact command or the first problem;
 * answers for an older form are dropped and their reviews released. Start runs the reviewed
 * command; the record is then followed with Rust's long poll until Git finishes.
 */
import type { CloneApi } from "./api";
import type { CloneCheck, CloneField, CloneRecord, CloneRecovery } from "./bindings";

export type ClonePhase = "form" | "running" | "failed" | "done";

export interface CloneView {
  readonly phase: ClonePhase;
  readonly remote: string;
  readonly parent: string | null;
  /** What the name field shows: the typed name, or the repository's own. */
  readonly name: string;
  readonly nameTyped: boolean;
  /** Rust's answer for the form as it is now; null while the form changes. */
  readonly check: CloneCheck | null;
  readonly checking: boolean;
  readonly starting: boolean;
  readonly record: CloneRecord | null;
  /** A line about the last clone, such as a cancel, shown over the form. */
  readonly notice: string | null;
  /** A failure to reach Rust at all. */
  readonly error: string | null;
  readonly recoveries: readonly CloneRecovery[];
  readonly recoveryError: string | null;
  readonly recoveryBusy: string | null;
}

export interface CloneDraft {
  readonly remote?: string;
  readonly parent?: string | null;
  /** Starts as soon as the first check is clean (previews and Try again). */
  readonly start?: boolean;
}

/** The last parent folder used, a per-window convenience; Rust still checks it every time. */
const PARENT_KEY = "auracode.clone.parent";
export const TYPING_MS = 200;

function remembered(): string | null {
  try {
    return localStorage.getItem(PARENT_KEY);
  } catch {
    return null;
  }
}
function remember(parent: string) {
  try {
    localStorage.setItem(PARENT_KEY, parent);
  } catch {
    /* Storage is optional: the next clone asks for the folder again. */
  }
}

function message(reason: unknown): string {
  return reason instanceof Error && reason.message
    ? reason.message
    : "The clone could not continue. Reopen the form to check its saved status.";
}

export class CloneController {
  private view: CloneView;
  private readonly listeners = new Set<() => void>();
  private live = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  /** The newest review Rust holds for this form, released when the form changes. */
  private held: string | null = null;
  private autoStart: boolean;
  private recoveryGeneration = 0;

  constructor(
    private readonly api: CloneApi,
    draft: CloneDraft = {},
  ) {
    this.autoStart = draft.start === true;
    this.view = {
      phase: "form",
      remote: draft.remote ?? "",
      parent: draft.parent === undefined ? remembered() : draft.parent,
      name: "",
      nameTyped: false,
      check: null,
      checking: false,
      starting: false,
      record: null,
      notice: null,
      error: null,
      recoveries: [],
      recoveryError: null,
      recoveryBusy: null,
    };
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): CloneView => this.view;

  private set(change: Partial<CloneView>) {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }

  /** Mounted: a prefilled form is checked at once. */
  open() {
    this.live = true;
    this.set({ recoveryBusy: null });
    void this.loadRecoveries();
    if (this.view.remote.trim()) this.schedule(0);
  }

  /** Unmounted: the held review is released and a running clone is stopped. */
  close() {
    this.live = false;
    this.recoveryGeneration++;
    clearTimeout(this.timer);
    this.generation++;
    this.release();
    const record = this.view.record;
    if (record && (record.state === "running" || record.state === "cleanup_pending"))
      void this.api.cancel(record.id).catch(() => {});
  }

  setRemote(remote: string) {
    this.set({ remote, notice: null, error: null });
    this.schedule(remote.trim() ? TYPING_MS : -1);
  }

  setName(name: string) {
    this.set({ name, nameTyped: name !== "", notice: null });
    this.schedule(TYPING_MS);
  }

  setParent(parent: string) {
    this.set({ parent, notice: null });
    this.schedule(0);
  }

  /** The problem Rust found for one field of the form as it is now. */
  problem(field: CloneField): string | null {
    const problem = this.view.check?.problem;
    return problem && problem.field === field ? problem.message : null;
  }

  get canStart(): boolean {
    const { phase, check, checking, starting } = this.view;
    return phase === "form" && !checking && !starting && Boolean(check?.review);
  }

  /** `delay` < 0 clears the answer without asking (an empty address). */
  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.generation++;
    this.release();
    if (delay < 0) {
      this.set({ check: null, checking: false });
      return;
    }
    this.set({ check: null, checking: true });
    if (!this.live) return;
    this.timer = setTimeout(() => void this.ask(), delay);
  }

  private release() {
    if (this.held) void this.api.cancelReview(this.held).catch(() => {});
    this.held = null;
  }

  private async ask() {
    const generation = this.generation;
    const { remote, parent, name, nameTyped } = this.view;
    try {
      const check = await this.api.check({
        remote,
        parent,
        name: nameTyped ? name : null,
      });
      if (generation !== this.generation || !this.live) {
        if (check.review) void this.api.cancelReview(check.review.id).catch(() => {});
        return;
      }
      this.held = check.review?.id ?? null;
      this.set({
        check,
        checking: false,
        name: this.view.nameTyped ? this.view.name : (check.name ?? ""),
      });
      if (this.autoStart && check.review) {
        this.autoStart = false;
        await this.start();
      } else if (this.autoStart && check.problem) this.autoStart = false;
    } catch (reason) {
      if (generation === this.generation && this.live)
        this.set({ checking: false, error: message(reason) });
    }
  }

  /** Runs the reviewed command shown in the form. */
  async start() {
    const review = this.view.check?.review;
    if (!this.canStart || !review) return;
    this.held = null;
    this.set({ starting: true, error: null, notice: null });
    try {
      const record = await this.api.start(review.id);
      if (this.view.parent) remember(this.view.parent);
      if (!this.live) {
        void this.api.cancel(record.id).catch(() => {});
        return;
      }
      this.set({ phase: "running", starting: false, record });
      void this.follow(record);
    } catch (reason) {
      if (!this.live) return;
      this.set({ starting: false, error: message(reason) });
      // The review was used up or refused; ask for a fresh one.
      this.schedule(0);
    }
  }

  private async follow(first: CloneRecord) {
    let record = first;
    while (this.live && (record.state === "running" || record.state === "cleanup_pending")) {
      try {
        record = await this.api.status(record.id, record.revision);
      } catch (reason) {
        if (!this.live) return;
        this.set({ phase: "failed", error: message(reason) });
        return;
      }
      if (!this.live) return;
      this.set({ record });
    }
    if (!this.live) return;
    if (record.state === "ready") this.set({ phase: "done" });
    else if (record.state === "canceled") {
      this.set({ phase: "form", record: null, notice: record.detail });
      this.schedule(0);
    } else this.set({ phase: "failed" });
  }

  cancel() {
    const record = this.view.record;
    if (record && this.view.phase === "running") void this.api.cancel(record.id).catch(() => {});
  }

  /** From a failed clone back to the form, as it was. */
  back() {
    this.set({ phase: "form", record: null, error: null });
    void this.loadRecoveries();
    this.schedule(0);
  }

  /** From a failed clone: check the same form again and start once it is clean. */
  retry() {
    this.autoStart = true;
    this.back();
  }

  private async loadRecoveries() {
    const generation = ++this.recoveryGeneration;
    try {
      const recoveries = await this.api.recoveryList();
      if (this.live && generation === this.recoveryGeneration)
        this.set({ recoveries, recoveryError: null });
    } catch (reason) {
      if (this.live && generation === this.recoveryGeneration)
        this.set({ recoveryError: message(reason) });
    }
  }

  /** Recovery never resumes into an uncertain destination. The normal form checks a new folder. */
  retryElsewhere(record: CloneRecovery) {
    if (!record.remote) return;
    this.autoStart = false;
    this.set({
      phase: "form",
      remote: record.remote,
      parent: null,
      name: "",
      nameTyped: false,
      record: null,
      error: null,
      notice: `The previous folder is preserved${record.destination ? ` at ${record.destination}` : ""}. Choose another folder for this attempt.`,
    });
    this.schedule(0);
  }

  async recover(id: string, action: "open" | "dismiss" | "add") {
    if (this.view.recoveryBusy) return;
    const generation = this.recoveryGeneration;
    this.set({ recoveryBusy: id, recoveryError: null });
    try {
      if (action === "open") await this.api.recoveryOpen(id);
      else if (action === "dismiss") {
        await this.api.recoveryDismiss(id);
        if (this.live && generation === this.recoveryGeneration)
          this.set({ recoveries: this.view.recoveries.filter((record) => record.id !== id) });
      } else {
        const record = await this.api.recoveryReady(id);
        if (
          this.live &&
          generation === this.recoveryGeneration &&
          record.can_add &&
          record.destination
        ) {
          this.set({
            phase: "done",
            record: {
              id: record.id,
              revision: 0,
              remote: record.remote ?? "",
              repository: record.repository ?? "repository",
              destination: record.destination,
              state: "ready",
              detail: record.detail,
              progress: null,
              output: [],
              removed: false,
            },
          });
        }
      }
    } catch (reason) {
      if (this.live && generation === this.recoveryGeneration)
        this.set({ recoveryError: message(reason) });
    } finally {
      if (this.live && generation === this.recoveryGeneration) this.set({ recoveryBusy: null });
    }
  }
}

/**
 * Git's stage ("Receiving objects") and how much has arrived ("12.40 MiB") for the running line;
 * the figure beside it is the whole clone's, so the stage's own percentage is not repeated.
 */
export function progressLine(record: CloneRecord): { stage: string; detail: string | null } {
  const progress = record.progress;
  if (!progress) return { stage: "Starting Git", detail: null };
  return { stage: progress.stage, detail: progress.received };
}

/** The last part of a folder path, for the location button. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}
