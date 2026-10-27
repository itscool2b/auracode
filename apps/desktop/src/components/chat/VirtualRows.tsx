import { defaultRangeExtractor, elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
}

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
}) {
  const reading = useRef<{ anchor: ReadingAnchor; revision: number } | null>(null);
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
    gap: 16,
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
  // A partial page may grow the anchor item itself. While restoring its visible text fragment,
  // automatic row-size compensation would apply that same prefix height a second time.
  virtual.shouldAdjustScrollPositionOnItemSizeChange =
    reading.current && reading.current.revision !== historyRevision ? () => false : undefined;
  const total = virtual.getTotalSize();
  const visibleItems = virtual.getVirtualItems();
  // When the content shrinks to fit, the browser clamps scrollTop without a scroll event, so the
  // remembered offset can point past the end. Clamp it before choosing the first visible row.
  const offset = Math.min(
    virtual.scrollOffset ?? 0,
    Math.max(0, total - (virtual.scrollRect?.height ?? 0)),
  );
  const firstVisible = visibleItems.find((item) => item.end > offset + 1);
  const prompt = firstVisible && rows[firstVisible.index]?.prompt;
  const promptIndex = prompt ? rows.findIndex((row) => row.key === prompt.key) : -1;
  const showPrompt = prompt && promptIndex >= 0 && firstVisible && promptIndex < firstVisible.index;
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
        return (
          <div
            key={item.key}
            ref={virtual.measureElement}
            data-index={item.index}
            data-row-key={row.key}
            className="chat-virtual-row"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {row.content}
          </div>
        );
      })}
    </div>
  );
  const shell = scroller.current?.parentElement;
  return (
    <>
      {content}
      {showPrompt && shell
        ? createPortal(
            <button
              type="button"
              className="chat-sticky-prompt"
              data-testid="sticky-prompt"
              title={prompt.text}
              aria-label={`Return to prompt: ${prompt.text}`}
              onClick={() => {
                scroller.current?.focus({ preventScroll: true });
                stick.current?.release();
                virtual.scrollToIndex(promptIndex, { align: "start" });
              }}
            >
              <span aria-hidden="true">↑</span>
              <span>{prompt.text}</span>
            </button>,
            shell,
          )
        : null}
    </>
  );
}
