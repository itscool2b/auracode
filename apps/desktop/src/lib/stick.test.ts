import { beforeEach, describe, expect, it } from "vitest";
import {
  isScrollUpKey,
  isScrollUpWheel,
  keyScrollsLog,
  pressTakesOver,
  REPIN_DISTANCE,
  type Scroller,
  StickToBottom,
  UNANNOUNCED_SCROLL,
} from "./stick";

/** A scroll container: the browser clamps `scrollTop` to what the content allows. */
class FakeScroller implements Scroller {
  #top = 0;
  contentHeight: number;
  readonly clientHeight: number;

  constructor(contentHeight: number, clientHeight = 400) {
    this.contentHeight = contentHeight;
    this.clientHeight = clientHeight;
  }

  get scrollHeight(): number {
    return Math.max(this.contentHeight, this.clientHeight);
  }

  get scrollTop(): number {
    return this.#top;
  }

  set scrollTop(value: number) {
    this.#top = Math.min(Math.max(0, value), this.scrollHeight - this.clientHeight);
  }

  /** How far the view is from the bottom. */
  get distance(): number {
    return this.scrollHeight - this.#top - this.clientHeight;
  }

  /** Content shrank: like a browser's layout, clamps the position to what is left. */
  shrinkTo(contentHeight: number): void {
    this.contentHeight = contentHeight;
    this.scrollTop = this.#top;
  }
}

/** A streamed frame: the content grows and React's layout effect follows. */
function commit(scroller: FakeScroller, stick: StickToBottom, growth = 20): void {
  scroller.contentHeight += growth;
  stick.follow();
}

describe("StickToBottom", () => {
  let scroller: FakeScroller;
  let stick: StickToBottom;

  beforeEach(() => {
    scroller = new FakeScroller(2_000);
    stick = new StickToBottom(scroller);
    stick.follow();
  });

  it("follows growing content while pinned", () => {
    for (let frame = 0; frame < 30; frame += 1) commit(scroller, stick);
    expect(stick.pinned).toBe(true);
    expect(scroller.distance).toBe(0);
  });

  it("keeps small upward wheel steps between 60 Hz commits (Chromium's event order)", () => {
    // Forty 8 px trackpad steps, each one under the old 32 px "still at the bottom" threshold.
    const start = scroller.scrollTop;
    for (let step = 0; step < 40; step += 1) {
      stick.release(); // the wheel event
      scroller.scrollTop -= 8; // the scroll lands...
      stick.onScroll(); // ...and its event arrives before the next commit
      commit(scroller, stick);
    }
    expect(stick.pinned).toBe(false);
    expect(scroller.scrollTop).toBe(start - 320);
    expect(scroller.distance).toBe(320 + 40 * 20);
  });

  it("keeps a wheel step whose scroll event arrives after the next commit (WebKit's order)", () => {
    const start = scroller.scrollTop;
    stick.release(); // wheel dy=-120
    scroller.scrollTop -= 120;
    commit(scroller, stick); // the commit runs before the scroll event is dispatched
    stick.onScroll();
    commit(scroller, stick);
    expect(scroller.scrollTop).toBe(start - 120);
  });

  it("keeps a wheel step that WebKit applies only after the next commit", () => {
    // Asynchronous scrolling: the wheel event arrives, a commit runs, then the scroll lands.
    stick.release();
    commit(scroller, stick);
    const beforeScroll = scroller.scrollTop;
    scroller.scrollTop -= 120;
    stick.onScroll();
    commit(scroller, stick);
    expect(stick.pinned).toBe(false);
    expect(scroller.scrollTop).toBe(beforeScroll - 120);
  });

  it("notices a large upward scroll with no intent event at the next commit", () => {
    // A screen reader or a focus scrolling into view: only the position says it, and WebKit has
    // not dispatched the scroll event yet.
    scroller.scrollTop -= 120;
    const reader = scroller.scrollTop;
    commit(scroller, stick);
    expect(stick.pinned).toBe(false);
    expect(scroller.scrollTop).toBe(reader);
  });

  it("notices a large upward scroll from its scroll event alone", () => {
    scroller.scrollTop -= UNANNOUNCED_SCROLL + 1;
    stick.onScroll();
    expect(stick.pinned).toBe(false);
  });

  it("keeps following through the browser's own small adjustments", () => {
    // Traced in WebKit: the last block's entrance transform settles (the scrollable overflow
    // shrinks a few pixels, so the browser clamps scrollTop down), and in the same frame the
    // stream adds a line. Without an intent event, that is not the reader.
    for (let frame = 0; frame < 30; frame += 1) {
      scroller.shrinkTo(scroller.contentHeight - 3);
      if (frame % 2 === 0) stick.onScroll(); // sometimes its scroll event arrives first
      commit(scroller, stick, 22);
      stick.onScroll();
    }
    expect(stick.pinned).toBe(true);
    expect(scroller.distance).toBe(0);
  });

  it("ignores the scroll event that echoes its own write", () => {
    commit(scroller, stick); // writes scrollTop; its scroll event is still queued
    stick.release(); // the reader's wheel arrives first...
    stick.onScroll(); // ...then the echo, at exactly the written position
    expect(stick.pinned).toBe(false);
    const reader = scroller.scrollTop;
    commit(scroller, stick);
    expect(scroller.scrollTop).toBe(reader);
  });

  it("re-pins when the reader scrolls back down to the bottom", () => {
    stick.release();
    scroller.scrollTop -= 600;
    stick.onScroll();
    for (let frame = 0; frame < 10; frame += 1) commit(scroller, stick);
    // Back down to within reach of the bottom, while the stream keeps growing it.
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - (REPIN_DISTANCE - 10);
    stick.onScroll();
    expect(stick.pinned).toBe(true);
    commit(scroller, stick);
    expect(scroller.distance).toBe(0);
  });

  it("stays put when the reader scrolls down but stops short of the bottom", () => {
    stick.release();
    scroller.scrollTop -= 600;
    stick.onScroll();
    scroller.scrollTop += 300;
    stick.onScroll();
    expect(stick.pinned).toBe(false);
    const reader = scroller.scrollTop;
    commit(scroller, stick);
    expect(scroller.scrollTop).toBe(reader);
  });

  it("is not fooled by the browser clamping the view after content shrank", () => {
    scroller.shrinkTo(scroller.contentHeight - 150); // a block collapsed
    stick.onScroll();
    expect(stick.pinned).toBe(true);
    commit(scroller, stick);
    expect(scroller.distance).toBe(0);
  });

  it("pins again once the content no longer overflows (a fresh turn)", () => {
    stick.release();
    scroller.scrollTop -= 600;
    stick.onScroll();
    scroller.shrinkTo(100); // the next turn starts empty
    stick.follow();
    expect(stick.pinned).toBe(true);
    for (let frame = 0; frame < 40; frame += 1) commit(scroller, stick);
    expect(scroller.distance).toBe(0);
  });

  it("does not re-pin a released view on a commit that finds it unmoved", () => {
    stick.release();
    for (let frame = 0; frame < 5; frame += 1) commit(scroller, stick);
    expect(stick.pinned).toBe(false);
    expect(scroller.distance).toBe(100);
  });
});

describe("scroll intent", () => {
  it("treats only upward, unmodified wheel turns as scrolling up", () => {
    expect(isScrollUpWheel({ deltaY: -8, ctrlKey: false })).toBe(true);
    expect(isScrollUpWheel({ deltaY: 8, ctrlKey: false })).toBe(false);
    expect(isScrollUpWheel({ deltaY: 0, ctrlKey: false })).toBe(false);
    // macOS reports a trackpad pinch as a ctrl-wheel.
    expect(isScrollUpWheel({ deltaY: -8, ctrlKey: true })).toBe(false);
  });

  it("knows the keys that scroll up", () => {
    for (const key of ["PageUp", "ArrowUp", "Home"]) {
      expect(isScrollUpKey({ key, shiftKey: false })).toBe(true);
    }
    expect(isScrollUpKey({ key: " ", shiftKey: true })).toBe(true);
    for (const key of [" ", "PageDown", "ArrowDown", "End", "a"]) {
      expect(isScrollUpKey({ key, shiftKey: false })).toBe(false);
    }
  });

  it("knows when a key scrolls this log", () => {
    // Focus inside the log (a link, a tool row).
    expect(keyScrollsLog({ inLog: true, onPage: false, lastPressInLog: false })).toBe(true);
    // Nothing focused: the browser scrolls what was last clicked.
    expect(keyScrollsLog({ inLog: false, onPage: true, lastPressInLog: true })).toBe(true);
    expect(keyScrollsLog({ inLog: false, onPage: true, lastPressInLog: false })).toBe(false);
    // Typing in a field elsewhere scrolls nothing here, wherever the last click was.
    expect(keyScrollsLog({ inLog: false, onPage: false, lastPressInLog: true })).toBe(false);
  });

  it("knows when a press takes over the scrolling", () => {
    expect(pressTakesOver({ onContainer: true, button: 0 })).toBe(true); // the scrollbar
    expect(pressTakesOver({ onContainer: false, button: 1 })).toBe(true); // autoscroll
    expect(pressTakesOver({ onContainer: false, button: 0 })).toBe(false); // clicking content
  });
});
