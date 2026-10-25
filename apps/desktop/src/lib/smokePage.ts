/**
 * How the chat smoke run (`smokeChat.ts`) reads and drives the real UI.
 *
 * The chat screens mark what automation needs with two kinds of attribute: `data-testid` says what
 * an element is (`chat-row`, `composer-send`, a transcript `item`), and `data-test-*` carries the
 * state it shows (a chat's status, a tool's status, whether a queued prompt is held, who resolved a
 * card). Nothing here reads a class name, a style or a label's wording, and styles never select on
 * these attributes, so a restyle leaves the run alone as long as the attributes stay;
 * `components/chat/testIds.test.tsx` checks that every screen still carries them.
 *
 * Actions go through the DOM the way a user's would: clicks on the buttons, text set in a field
 * through the native value setter followed by an input event (so React sees a change), and Enter in
 * the message box. Waits poll until the page shows what they wait for, and fail with what they
 * waited for after a deadline, so a broken step ends the run instead of hanging it.
 */

/** How often waits look at the page again. */
export const POLL_MS = 25;

/** How long a step may wait for the page by default. */
export const STEP_TIMEOUT_MS = 20_000;

/** A step that found the page in a state it did not expect. */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every element with this `data-testid` in `within`, in document order. */
export function all(testId: string, within: ParentNode = document): HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
}

/** The first element with this `data-testid` in `within`, or `null`. */
export function one(testId: string, within: ParentNode = document): HTMLElement | null {
  return within.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

/** The value of `data-test-<name>`, or `""` when the element or the attribute is missing. */
export function attr(element: Element | null | undefined, name: string): string {
  return element?.getAttribute(`data-test-${name}`) ?? "";
}

/** The element's text, as it renders (for a `<pre>` exactly, whitespace included). */
export function text(element: Element | null | undefined): string {
  return element?.textContent ?? "";
}

function isFound<T>(value: T | null | undefined | false): value is T {
  return value !== null && value !== undefined && value !== false;
}

/**
 * Waits until `probe` returns something (not `null`, `undefined` or `false`) and returns it. A
 * probe that throws ends the wait with its error: the page showed something that can no longer
 * turn out right. `what` names what was awaited when the wait times out; as a function it is
 * asked then, so it can say what the page showed instead.
 *
 * The probe runs again whenever the page changes, and every `POLL_MS` besides. Polling alone is
 * not enough: a page whose window is hidden, covered or behind a locked screen gets its timers
 * slowed to one a second, while React keeps rendering at full speed, so a step could miss a state
 * that lasts a second or two (a prompt waiting behind a short turn).
 */
export function waitFor<T>(
  what: string | (() => string),
  probe: () => T | null | undefined | false,
  timeoutMs: number = STEP_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => check());
    const deadline = setTimeout(() => {
      const awaited = typeof what === "string" ? what : what();
      finish(() =>
        reject(new StepError(`timed out after ${formatSeconds(timeoutMs)} waiting for ${awaited}`)),
      );
    }, timeoutMs);
    function finish(settle: () => void): void {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(deadline);
      if (poll !== undefined) clearTimeout(poll);
      settle();
    }
    function check(): void {
      if (done) return;
      let found: T | null | undefined | false;
      try {
        found = probe();
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (isFound(found)) {
        const value = found;
        finish(() => resolve(value));
      }
    }
    function tick(): void {
      check();
      if (!done) poll = setTimeout(tick, POLL_MS);
    }
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    tick();
  });
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

function isDisabled(element: HTMLElement): boolean {
  return "disabled" in element && element.disabled === true;
}

/** Clicks an element that is there and enabled now. */
export function click(element: HTMLElement | null, what: string): void {
  if (element === null) throw new StepError(`${what} is not on the page`);
  if (isDisabled(element)) throw new StepError(`${what} is disabled`);
  element.click();
}

/** Waits until `find` returns an enabled element, then clicks it. */
export async function clickWhenEnabled(
  what: string,
  find: () => HTMLElement | null | undefined,
  timeoutMs: number = STEP_TIMEOUT_MS,
): Promise<void> {
  const element = await waitFor(
    `${what} to be enabled`,
    () => {
      const found = find();
      return found && !isDisabled(found) ? found : null;
    },
    timeoutMs,
  );
  element.click();
}

/**
 * Sets a field's value as typing would: through the prototype's setter, so React's own record of
 * the value does not swallow the change, then the event React listens for (`change` for a select,
 * `input` for text).
 */
export function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  const event = element instanceof HTMLSelectElement ? "change" : "input";
  element.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Presses Enter in an element (the message box sends on Enter). */
export function pressEnter(element: HTMLElement): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
  );
}

// ---------- the transcript ----------

/** One item of a transcript segment as the page shows it. */
export interface ItemView {
  /** `data-test-kind`: user, message, thought, tool, permission, question, notice, error, gap. */
  readonly kind: string;
  /** The kind with the state that matters, as `itemSignature` writes it. */
  readonly signature: string;
  readonly text: string;
  readonly element: HTMLElement;
}

/** The data a segment is compared by, without its elements. */
export interface SegmentShape {
  readonly kind: "turn" | "outside";
  /** The user's prompt; `""` between turns. */
  readonly prompt: string;
  /** Why the turn ended; `""` while it runs, and between turns. */
  readonly stopReason: string;
  /** The items after the prompt, by signature. */
  readonly items: readonly string[];
  /** The plan's entries, by status. */
  readonly plan: readonly string[];
}

/** One segment of the transcript (a turn, or what came between turns) as the page shows it. */
export interface SegmentView extends SegmentShape {
  readonly recovered: boolean;
  /** Every item, the prompt included. */
  readonly views: readonly ItemView[];
  readonly element: HTMLElement;
}

/**
 * An item's kind with the state that matters for comparing transcripts: `tool:read:completed`,
 * `permission:user:allow` (or `permission:open` while it waits), `question:user:select:1`,
 * `notice:warning`, `error:agent_error`, `thought` (or `thought:open` while it streams), and the
 * bare kind for the rest.
 */
export function itemSignature(kind: string, read: (name: string) => string): string {
  switch (kind) {
    case "tool":
      return `tool:${read("tool-kind")}:${read("status")}`;
    case "permission": {
      const by = read("resolved-by");
      return by === "" ? "permission:open" : `permission:${by}:${read("decision")}`;
    }
    case "question": {
      const by = read("resolved-by");
      return by === "" ? "question:open" : `question:${by}:${read("answer")}`;
    }
    case "notice":
      return `notice:${read("level")}`;
    case "error":
      return `error:${read("error-kind")}`;
    case "thought":
      return read("completed") === "true" ? "thought" : "thought:open";
    default:
      return kind;
  }
}

/** Every segment of the open chat's transcript, oldest first. */
export function readTranscript(within: ParentNode = document): SegmentView[] {
  const transcript = one("transcript", within);
  if (transcript === null) return [];
  return all("segment", transcript).map((element) => {
    const views = [...element.querySelectorAll<HTMLElement>(':scope > [data-testid="item"]')].map(
      (item): ItemView => {
        const kind = attr(item, "kind");
        return {
          kind,
          signature: itemSignature(kind, (name) => attr(item, name)),
          text: text(item),
          element: item,
        };
      },
    );
    const turn = attr(element, "kind") === "turn";
    return {
      kind: turn ? "turn" : "outside",
      prompt: views.find((view) => view.kind === "user")?.text ?? "",
      stopReason: attr(element, "stop-reason"),
      recovered: attr(element, "recovered") === "true",
      items: views.filter((view) => view.kind !== "user").map((view) => view.signature),
      plan: all("plan-entry", element).map((entry) => attr(entry, "status")),
      views,
      element,
    };
  });
}

/** A segment in one line, to compare with what a script expects and to show when they differ. */
export function describeSegment(segment: SegmentShape): string {
  const head =
    segment.kind === "outside"
      ? "between turns"
      : `turn "${segment.prompt}" ${segment.stopReason === "" ? "running" : `ended ${segment.stopReason}`}`;
  const plan = segment.plan.length > 0 ? `; plan ${segment.plan.join(", ")}` : "";
  return `${head}: ${segment.items.join(", ") || "nothing"}${plan}`;
}

/**
 * Where two transcripts first differ, or `null` when they are the same. Both are lists of
 * `describeSegment` lines.
 */
export function firstDifference(
  expected: readonly string[],
  actual: readonly string[],
): string | null {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const want = expected[index];
    const got = actual[index];
    if (want === got) continue;
    const place = `segment ${index + 1} of ${expected.length}`;
    if (want === undefined) return `${place}: nothing expected, but the page shows ${got}`;
    if (got === undefined) return `${place}: expected ${want}, but the transcript ends before it`;
    return `${place}: expected ${want}, but the page shows ${got}`;
  }
  return null;
}
