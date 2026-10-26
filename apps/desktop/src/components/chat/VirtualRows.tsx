import { defaultRangeExtractor, elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
}

/** Stable row keys retain measured heights and the reading anchor as older history is prepended. */
export function VirtualRows({
  rows,
  leading,
  scroller,
  stick,
  historyRevision,
  captureHistory,
}: {
  readonly rows: readonly TranscriptRow[];
  readonly leading?: ReactNode;
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly stick: RefObject<StickToBottom | null>;
  readonly historyRevision: unknown;
  readonly captureHistory: RefObject<(() => void) | null>;
}) {
  const reading = useRef<{ anchor: ReadingAnchor; revision: unknown } | null>(null);
  const settleFrame = useRef<number | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
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
  const total = virtual.getTotalSize();
  useLayoutEffect(() => {
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
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = requestAnimationFrame(() => {
      settleFrame.current = requestAnimationFrame(() => {
        reading.current = null;
        settleFrame.current = null;
      });
    });
  });
  useLayoutEffect(() => {
    const cancel = () => {
      reading.current = null;
    };
    const element = scroller.current;
    for (const name of ["wheel", "touchmove", "keydown", "pointerdown"])
      element?.addEventListener(name, cancel, { passive: true });
    return () => {
      for (const name of ["wheel", "touchmove", "keydown", "pointerdown"])
        element?.removeEventListener(name, cancel);
      if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
      captureHistory.current = null;
    };
  }, [captureHistory, scroller]);
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
  return (
    <div
      className="chat-transcript-inner chat-virtual"
      style={{ height: total }}
      data-testid="virtual-transcript"
      data-row-count={rows.length}
      onFocusCapture={(event) =>
        setFocusedKey(
          (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey ??
            null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null);
      }}
    >
      {leading ? (
        <div className="chat-virtual-row" ref={leadingRef} style={{ top: 24 }}>
          {leading}
        </div>
      ) : null}
      {virtual.getVirtualItems().map((item) => {
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
}
