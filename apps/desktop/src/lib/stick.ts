/**
 * Keeping a scrolling log pinned to its bottom while content streams in, without fighting a reader
 * who scrolls up. `useStickToBottom` (hooks.ts) wires a scroll container's events to a
 * `StickToBottom`; the logic lives here, free of the DOM, so its timing is testable.
 *
 * Two traps decide the design. A streaming turn commits about every 16 ms and each commit re-pins,
 * so a reader's scroll has to be noticed before the next commit undoes it; and WebKit dispatches
 * `scroll` after that next commit, so the scroll event comes too late. So the reader's intent (a
 * wheel or touch gesture, a key, pressing the scrollbar, moving keyboard focus into the log)
 * releases the pin at once, before the scroll lands. Position alone is a poor witness: the browser
 * moves `scrollTop` by a few pixels on its own (clamping as the last block's entrance animation
 * settles, WebKit's scrolling thread catching up with a write), and in a frame where the content
 * also grows that looks just like a reader's small scroll. So an upward move with no intent behind
 * it only counts when it is too large to be the browser settling (a screen reader, a focus that
 * scrolls into view). Only a downward scroll that ends near the bottom pins again, and the scroll
 * event that echoes the controller's own write is recognised by its position and ignored.
 */

/** What the controller reads and writes on the scroll container (an `HTMLElement` in the app). */
export interface Scroller {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** A downward scroll by the reader that ends this close to the bottom pins the view again. */
export const REPIN_DISTANCE = 64;

/**
 * An upward move larger than this releases the pin even without an intent event; smaller ones are
 * the browser settling. Above the few pixels WebKit and the entrance animation move, and below the
 * smallest scroll a screen reader or a focus change makes (a line or more).
 */
export const UNANNOUNCED_SCROLL = 48;

/**
 * Movement under a pixel is rounding (scroll positions are fractional on scaled displays), and an
 * upward move that ends this close to the bottom is the browser clamping after content shrank.
 */
const ROUNDING = 1;
const CLAMP_SLACK = 2;

export class StickToBottom {
  readonly #scroller: Scroller;
  readonly #onPinnedChange?: (pinned: boolean) => void;
  #pinned = true;
  /** The position last written or seen: an echo of a write matches it, a reader's scroll does not. */
  #lastTop: number;

  constructor(scroller: Scroller, onPinnedChange?: (pinned: boolean) => void) {
    this.#scroller = scroller;
    this.#onPinnedChange = onPinnedChange;
    this.#lastTop = scroller.scrollTop;
  }

  get pinned(): boolean {
    return this.#pinned;
  }

  /** Content or the container changed size (a commit, a resize): follow to the bottom if pinned. */
  follow(): void {
    const scroller = this.#scroller;
    if (scroller.scrollHeight <= scroller.clientHeight) {
      // Nothing to scroll (a fresh turn, say): follow again from here.
      this.#setPinned(true);
      this.#lastTop = scroller.scrollTop;
      return;
    }
    // A large scroll up whose event has not arrived yet (WebKit) and that had no intent event.
    if (this.#pinned && this.#scrolledUpFrom(this.#lastTop)) this.#setPinned(false);
    if (!this.#pinned) return;
    scroller.scrollTop = scroller.scrollHeight;
    // Read back the clamped position, to recognise this write's own scroll event.
    this.#lastTop = scroller.scrollTop;
  }

  /** A `scroll` event. */
  onScroll(): void {
    const scroller = this.#scroller;
    const top = scroller.scrollTop;
    const previous = this.#lastTop;
    if (Math.abs(top - previous) < ROUNDING) return; // the echo of a write, or no movement
    this.#lastTop = top;
    if (top < previous) {
      if (this.#scrolledUpFrom(previous)) this.#setPinned(false);
    } else if (this.#distance() <= REPIN_DISTANCE) {
      this.#setPinned(true);
    }
  }

  /**
   * The reader means to scroll up or to look around (wheel up, touch drag, a key, pressing the
   * scrollbar, keyboard focus moving into the log): stop following now, before the scroll lands.
   */
  release(): void {
    this.#setPinned(false);
  }

  /** The reader explicitly asks to return to the latest output. */
  pin(): void {
    this.#lastTop = this.#scroller.scrollTop;
    this.#setPinned(true);
    this.follow();
  }

  #setPinned(pinned: boolean): void {
    if (this.#pinned === pinned) return;
    this.#pinned = pinned;
    this.#onPinnedChange?.(pinned);
  }

  /** A virtual layout compensated for measured rows; this is not a reader's scroll gesture. */
  acknowledgeAdjustment(): void {
    this.#lastTop = this.#scroller.scrollTop;
  }

  #distance(): number {
    const scroller = this.#scroller;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }

  #scrolledUpFrom(previous: number): boolean {
    return (
      this.#scroller.scrollTop < previous - UNANNOUNCED_SCROLL && this.#distance() > CLAMP_SLACK
    );
  }
}

/** Whether a wheel event scrolls up. A ctrl-wheel is a zoom or pinch gesture, not a scroll. */
export function isScrollUpWheel(event: {
  readonly deltaY: number;
  readonly ctrlKey: boolean;
}): boolean {
  return event.deltaY < 0 && !event.ctrlKey;
}

/** Whether a key press scrolls up: PageUp, ArrowUp, Home, or Shift+Space. */
export function isScrollUpKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
}): boolean {
  switch (event.key) {
    case "PageUp":
    case "ArrowUp":
    case "Home":
      return true;
    case " ":
      return event.shiftKey;
    default:
      return false;
  }
}

/**
 * Whether a scroll-up key press (`isScrollUpKey`) scrolls this log. Keys scroll the focused
 * element's scroll container; with nothing focused (`onPage`: the event's target is the page
 * itself) WebKit and Chromium scroll whatever was last clicked. A key typed into a field elsewhere
 * scrolls nothing here.
 */
export function keyScrollsLog(where: {
  readonly inLog: boolean;
  readonly onPage: boolean;
  readonly lastPressInLog: boolean;
}): boolean {
  return where.inLog || (where.onPage && where.lastPressInLog);
}

/**
 * Whether a pointer press on the log means the reader takes over the scrolling: a press on the
 * container itself (its scrollbar, not its content) or a middle-button press (autoscroll).
 */
export function pressTakesOver(press: {
  readonly onContainer: boolean;
  readonly button: number;
}): boolean {
  return press.onContainer || press.button === 1;
}
