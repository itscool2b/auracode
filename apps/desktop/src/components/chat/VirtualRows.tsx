import { defaultRangeExtractor, elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  captureReadingAnchor,
  type ReadingAnchor,
  readingAnchorOffset,
} from "../../lib/chat/readingAnchor";
import type { StickToBottom } from "../../lib/stick";

export interface TranscriptRow {
  readonly key: string;
  readonly content: ReactNode;
  readonly estimate: number;
  readonly retain?: boolean;
  readonly prompt?: { readonly key: string; readonly text: string };
  /** A disclosure the reader just opened or closed: the row glides its height in or out. */
  readonly reveal?: "open" | "close";
  /** `false`: the row never fades in as new (the person's own message appears at once). */
  readonly arrive?: boolean;
}

/**
 * Lets a row's own disclosure (a call's output well) say that its height is about to glide, so
 * the rows below follow it frame by frame instead of a frame late.
 */
export const RevealContext = createContext<{ readonly hold: (ms: number) => void } | null>(null);

/** The space between rows; a row's own padding adds to it where the rhythm needs more. */
const ROW_GAP = 8;

/** How long a new row keeps its arrival mark: longer than its 240ms fade, so no render cuts it. */
const ARRIVAL_MS = 400;

/** More new rows than this at once is a load (a page, a reconnect), not live output: none fade. */
const MAX_ARRIVALS = 3;

/** How long rows follow a gliding height frame by frame after a disclosure was toggled. */
const REVEAL_HOLD_MS = 450;

/** Stable row keys retain measured heights and the reading anchor as older history is prepended. */
export function VirtualRows({
  rows,
  leading,
  scroller,
  stick,
  historyRevision,
  historyError,
  captureHistory,
  focusedKey,
  onFocusKey,
  promptHost,
}: {
  readonly rows: readonly TranscriptRow[];
  readonly leading?: ReactNode;
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly stick: RefObject<StickToBottom | null>;
  readonly historyRevision: number;
  readonly historyError: string | null;
  readonly captureHistory: RefObject<(() => void) | null>;
  readonly focusedKey: string | null;
  readonly onFocusKey: (key: string | null) => void;
  readonly promptHost: HTMLDivElement | null;
}) {
  const reading = useRef<{ anchor: ReadingAnchor; revision: number } | null>(null);
  const viewportTop = useRef<number | null>(null);
  const returningToPrompt = useRef<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by a reader's scroll gesture until its scroll event arrives (see scrollToFn).
  const readerScrolling = useRef(false);
  const [leadingHeight, setLeadingHeight] = useState(0);
  const leadingRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const measure = () => setLeadingHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const focused = rows.findIndex((row) => row.key === focusedKey);
  const retained = rows.flatMap((row, index) =>
    row.retain || index === focused || row.key === reading.current?.anchor.key ? [index] : [],
  );
  const keyAt = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  // New rows of live output fade in and rise 2px; rows that only re-enter the virtual window, a
  // history page and the first content never do. A key is new once: an opened group's calls
  // arrive with their reveal instead.
  const seen = useRef<{ keys: ReadonlySet<string>; revision: number } | null>(null);
  const arrivals = useRef(new Map<string, number>());
  const now = typeof performance === "undefined" ? 0 : performance.now();
  const before = seen.current;
  if (before !== null && before.keys.size > 0 && before.revision === historyRevision) {
    const fresh = rows.filter(
      (row) =>
        row.arrive !== false &&
        row.reveal === undefined &&
        !before.keys.has(row.key) &&
        !arrivals.current.has(row.key),
    );
    if (fresh.length <= MAX_ARRIVALS) for (const row of fresh) arrivals.current.set(row.key, now);
  }
  const arrived = (key: string) => {
    const at = arrivals.current.get(key);
    return at !== undefined && now - at < ARRIVAL_MS;
  };
  // While a disclosure glides, each measured frame re-renders the rows synchronously, so the rows
  // below a growing or shrinking one move in the same frame instead of overlapping it for one.
  const followUntil = useRef(0);
  if (rows.some((row) => row.reveal !== undefined))
    followUntil.current = Math.max(followUntil.current, now + REVEAL_HOLD_MS);
  const [, follow] = useReducer((count: number) => count + 1, 0);
  const follower = useRef<ResizeObserver | null>(null);
  const followed = useRef(new Set<Element>());
  const reveal = useMemo(
    () => ({
      hold: (ms: number) => {
        followUntil.current = Math.max(followUntil.current, performance.now() + ms + 150);
      },
    }),
    [],
  );
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroller.current,
    scrollToFn: (offset, options, instance) => {
      // Size corrections, and retries of a correction the old height clamped, are computed from the
      // last scroll offset the virtualizer read. A reader's jump (Home, a scrollbar drag) can land
      // before that scroll event, which WebKit may deliver a frame late; writing then would throw
      // the reader back. Skip it: the pending scroll event re-anchors and drops the stale retry.
      const element = instance.scrollElement;
      const known = instance.scrollOffset;
      if (
        readerScrolling.current &&
        element &&
        known !== null &&
        Math.abs(element.scrollTop - known) > 2
      )
        return;
      elementScroll(offset, options, instance);
      stick.current?.acknowledgeAdjustment();
    },
    getItemKey: keyAt,
    estimateSize: (index) => rows[index]?.estimate ?? 320,
    overscan: 3,
    gap: ROW_GAP,
    paddingStart: 24 + (leading ? leadingHeight + 16 : 0),
    paddingEnd: 32,
    anchorTo: "end",
    useFlushSync: false,
    rangeExtractor: useCallback(
      (range) => {
        const visible = defaultRangeExtractor(range);
        // A keyboard user's focused disclosure must survive scrolling beyond the overscan range.
        return [...new Set([...visible, ...retained])].sort((a, b) => a - b);
      },
      [retained],
    ),
  });
  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      virtual.measureElement(node);
      if (typeof ResizeObserver === "undefined") return;
      follower.current ??= new ResizeObserver((entries) => {
        if (performance.now() > followUntil.current) return;
        for (const entry of entries)
          if (entry.target.isConnected) virtual.measureElement(entry.target as HTMLDivElement);
        flushSync(follow);
      });
      if (node) {
        if (!followed.current.has(node)) {
          follower.current.observe(node);
          followed.current.add(node);
        }
        return;
      }
      for (const element of followed.current)
        if (!element.isConnected) {
          follower.current.unobserve(element);
          followed.current.delete(element);
        }
    },
    [virtual],
  );
  useLayoutEffect(() => {
    seen.current = { keys: new Set(rows.map((row) => row.key)), revision: historyRevision };
    const at = performance.now();
    for (const [key, time] of arrivals.current)
      if (at - time > ARRIVAL_MS) arrivals.current.delete(key);
  });
  useLayoutEffect(() => {
    // Strict Mode replays setup after disconnecting, with the same mounted row elements.
    for (const element of followed.current) {
      if (element.isConnected) follower.current?.observe(element);
      else followed.current.delete(element);
    }
    return () => follower.current?.disconnect();
  }, []);
  // A partial page may grow the anchor item itself. While restoring its visible text fragment,
  // automatic row-size compensation would apply that same prefix height a second time.
  virtual.shouldAdjustScrollPositionOnItemSizeChange =
    reading.current && reading.current.revision !== historyRevision ? () => false : undefined;
  const total = virtual.getTotalSize();
  const visibleItems = virtual.getVirtualItems();
  // Explicit prompt navigation uses the viewport itself until the header has gone and the
  // second scrollToIndex below aligns that prompt in the enlarged viewport.
  const promptInset =
    returningToPrompt.current === null ? (promptHost?.getBoundingClientRect().height ?? 0) : 0;
  // Choose the prompt from the same point in the shell whether its header reserves space or
  // not. Otherwise the header's own scroll compensation can cross a prompt boundary and hide
  // the header again, reversing the compensation on the next frame.
  // When the content shrinks to fit, the browser clamps scrollTop without a scroll event, so the
  // remembered offset can point past the end. Clamp it before choosing the first visible row.
  const offset = Math.min(
    (virtual.scrollOffset ?? 0) - promptInset,
    Math.max(0, total - (virtual.scrollRect?.height ?? 0) - promptInset),
  );
  const firstVisible = visibleItems.find((item) => item.end > offset + 1);
  const prompt = firstVisible && rows[firstVisible.index]?.prompt;
  const promptIndex = prompt ? rows.findIndex((row) => row.key === prompt.key) : -1;
  const showPrompt = prompt && promptIndex >= 0 && firstVisible && promptIndex < firstVisible.index;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    const previous = viewportTop.current;
    viewportTop.current = top;
    if (returningToPrompt.current !== null && !showPrompt) {
      const index = rows.findIndex((row) => row.key === returningToPrompt.current);
      returningToPrompt.current = null;
      if (index >= 0) virtual.scrollToIndex(index, { align: "start" });
    } else if (previous !== null && Math.abs(top - previous) > 0.5) {
      // Releasing the prompt header enlarges the viewport and can clamp the DOM's scrollTop
      // before this effect runs. Adjust the pre-clamp position, or the header height is
      // subtracted twice and the first visible prompt can alternate on every frame.
      virtual.scrollToOffset((virtual.scrollOffset ?? element.scrollTop) + top - previous);
      stick.current?.acknowledgeAdjustment();
    }
  });
  useLayoutEffect(() => {
    if (historyError !== null) reading.current = null;
    captureHistory.current = () => {
      const anchor = scroller.current && captureReadingAnchor(scroller.current);
      reading.current = anchor ? { anchor, revision: historyRevision } : null;
    };
    const pending = reading.current;
    const element = scroller.current;
    if (!pending || !element || pending.revision === historyRevision) return;
    const row = [...element.querySelectorAll<HTMLElement>("[data-row-key]")].find(
      (node) => node.dataset.rowKey === pending.anchor.key,
    );
    if (!row) return;
    // Measure synchronously before restoring a fragment. A page can prepend text into the same
    // message, or remove its old page marker, without changing that item's stable key.
    for (const node of element.querySelectorAll<HTMLDivElement>("[data-row-key]"))
      virtual.measureElement(node);
    const offset = readingAnchorOffset(row, pending.anchor);
    const item = virtual.getVirtualItems().find((item) => item.key === pending.anchor.key);
    if (offset !== null && item) {
      const target = item.start + offset + element.getBoundingClientRect().top - pending.anchor.y;
      if (Math.abs(element.scrollTop - target) > 1) virtual.scrollToOffset(target);
      stick.current?.acknowledgeAdjustment();
    }
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    // WebKit may deliver a ResizeObserver batch after the scroll write's first painted frames.
    // Keep one anchor until measurements have been quiet; any reader gesture cancels it at once.
    settleTimer.current = setTimeout(() => {
      reading.current = null;
      virtual.shouldAdjustScrollPositionOnItemSizeChange = undefined;
      settleTimer.current = null;
    }, 180);
  });
  useLayoutEffect(() => {
    const cancel = () => {
      reading.current = null;
      virtual.shouldAdjustScrollPositionOnItemSizeChange = undefined;
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    };
    // Listen on the document: this effect runs before the parent attaches the scroller's ref, so
    // the log element may not exist yet. Each handler looks it up when the event arrives.
    const inLog = (target: EventTarget | null) =>
      target instanceof Node && scroller.current?.contains(target) === true;
    let gestureTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (event?: Event) => {
      if (event && event.target !== scroller.current) return;
      readerScrolling.current = false;
      if (gestureTimer !== null) clearTimeout(gestureTimer);
      gestureTimer = null;
    };
    const gesture = (event: Event) => {
      if (!inLog(event.target)) return;
      cancel();
      // A press scrolls only on the scrollbar, which belongs to the container itself.
      if (event.type === "pointerdown" && event.target !== scroller.current) return;
      readerScrolling.current = true;
      if (gestureTimer !== null) clearTimeout(gestureTimer);
      gestureTimer = setTimeout(settle, 250);
    };
    const options = { capture: true, passive: true };
    for (const name of ["wheel", "touchmove", "keydown", "pointerdown"])
      document.addEventListener(name, gesture, options);
    document.addEventListener("scroll", settle, options);
    return () => {
      for (const name of ["wheel", "touchmove", "keydown", "pointerdown"])
        document.removeEventListener(name, gesture, options);
      document.removeEventListener("scroll", settle, options);
      settle();
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      captureHistory.current = null;
    };
  }, [captureHistory, scroller, virtual]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured height changes must follow the bottom only while the reader is pinned.
  useLayoutEffect(() => {
    stick.current?.follow();
  }, [total, stick]);
  if (typeof window === "undefined") {
    return (
      <div className="chat-transcript-inner">
        {leading}
        {rows.map((row) => (
          <div key={row.key}>{row.content}</div>
        ))}
      </div>
    );
  }
  const content = (
    <div
      className="chat-transcript-inner chat-virtual"
      style={{ height: total }}
      data-testid="virtual-transcript"
      data-row-count={rows.length}
      onFocusCapture={(event) =>
        onFocusKey(
          (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey ??
            null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocusKey(null);
      }}
    >
      {leading ? (
        <div className="chat-virtual-row" ref={leadingRef} style={{ top: 24 }}>
          {leading}
        </div>
      ) : null}
      {visibleItems.map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        const motion = row.reveal ?? (arrived(row.key) ? "arrive" : undefined);
        return (
          <div
            key={item.key}
            ref={measureRow}
            data-index={item.index}
            data-row-key={row.key}
            data-reveal={motion}
            inert={row.reveal === "close"}
            className="chat-virtual-row"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {/* The reveal wraps every row, always, so a reveal never remounts what it shows. */}
            <div className="chat-reveal">
              <div className="chat-reveal-clip">{row.content}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <RevealContext.Provider value={reveal}>
      {content}
      {showPrompt && promptHost
        ? createPortal(
            <button
              type="button"
              className="chat-sticky-prompt"
              data-testid="sticky-prompt"
              title={prompt.text}
              aria-label={`Return to prompt: ${prompt.text}`}
              onClick={() => {
                returningToPrompt.current = prompt.key;
                scroller.current?.focus({ preventScroll: true });
                stick.current?.release();
                virtual.scrollToIndex(promptIndex, { align: "start" });
              }}
            >
              <span aria-hidden="true">↑</span>
              <span>{prompt.text}</span>
            </button>,
            promptHost,
          )
        : null}
    </RevealContext.Provider>
  );
}
