import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Within this many px of the end counts as reading the newest output. */
const NEAR_END = 48;
/** After a click inside the transcript, growth is the user's doing (a disclosure), not new output. */
const CLICK_GRACE_MS = 900;
/** What a click opens belongs to the transcript block around it. */
const BLOCK = ".au-item, .au-footer, .au-user";

/**
 * Keeps a chat scrolled to its newest output while you are at the end, gliding rather than jumping
 * as text arrives, and lets go the moment you scroll up (then `pinned` is false, so a "Jump to
 * latest" control can show). Opening a disclosure grows the content where you clicked instead of
 * yanking the view to the end. The first frame lands at the end at once; reduced motion never glides.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  reduced: boolean,
  /** Height at the bottom of the scroller hidden behind floating UI (the composer dock). */
  coveredBottom: (scroller: HTMLElement) => number,
): {
  readonly pinned: boolean;
  readonly toLatest: () => void;
  readonly release: () => void;
} {
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const frame = useRef(0);
  const lastClick = useRef(Number.NEGATIVE_INFINITY);
  const clickedBlock = useRef<Element | null>(null);
  const coveredRef = useRef(coveredBottom);
  coveredRef.current = coveredBottom;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const setPinnedBoth = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const glideToEnd = useCallback(
    (instant: boolean) => {
      const element = scrollRef.current;
      if (!element) return;
      cancelAnimationFrame(frame.current);
      const end = (): number => element.scrollHeight - element.clientHeight;
      if (instant || reducedRef.current) {
        element.scrollTop = end();
        return;
      }
      let last = performance.now();
      const step = (now: number): void => {
        const goal = end();
        const gap = goal - element.scrollTop;
        if (Math.abs(gap) < 0.75) {
          element.scrollTop = goal;
          return;
        }
        // Frame-rate independent ease: about 90% of the way in 160 ms.
        const k = 1 - Math.exp(-(now - last) / 70);
        last = now;
        element.scrollTop += gap * k;
        frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    [scrollRef],
  );

  // The first frame shows the end, before paint.
  useLayoutEffect(() => {
    glideToEnd(true);
  }, [glideToEnd]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const distance = (): number => element.scrollHeight - element.clientHeight - element.scrollTop;

    // A disclosure the user opened grows downwards from where they clicked: reveal what it opened,
    // without ever pushing the clicked block's top out of view.
    const reveal = (block: Element): void => {
      const view = element.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      // Rects are in screen px (the window may be scaled); scrollTop is in layout px.
      const scale = element.clientHeight > 0 ? view.height / element.clientHeight : 1;
      const visibleBottom = view.bottom - coveredRef.current(element) * scale;
      const hidden = rect.bottom - visibleBottom;
      if (hidden <= 0) return;
      const headroom = rect.top - (view.top + 20 * scale);
      const delta = Math.min(hidden, Math.max(0, headroom));
      if (delta > 0) element.scrollTop += delta / scale;
    };

    const observer = new ResizeObserver(() => {
      if (performance.now() - lastClick.current < CLICK_GRACE_MS) {
        cancelAnimationFrame(frame.current);
        const block = clickedBlock.current;
        if (block?.isConnected) reveal(block);
        setPinnedBoth(distance() < NEAR_END);
        return;
      }
      if (pinnedRef.current) glideToEnd(false);
    });
    observer.observe(content);

    const onUserScroll = (): void => {
      requestAnimationFrame(() => {
        const away = distance() > NEAR_END;
        if (away) cancelAnimationFrame(frame.current);
        setPinnedBoth(!away);
      });
    };
    const onScroll = (): void => {
      if (!pinnedRef.current && distance() < 4) setPinnedBoth(true);
    };
    const markClick = (target: EventTarget | null): void => {
      lastClick.current = performance.now();
      clickedBlock.current = target instanceof Element ? target.closest(BLOCK) : null;
    };
    const onPointerDown = (event: PointerEvent): void => markClick(event.target);
    const onKeyActivate = (event: KeyboardEvent): void => {
      if (event.key === "Enter" || event.key === " ") markClick(event.target);
    };
    element.addEventListener("wheel", onUserScroll, { passive: true });
    element.addEventListener("touchmove", onUserScroll, { passive: true });
    element.addEventListener("keydown", onUserScroll);
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("keydown", onKeyActivate);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      element.removeEventListener("wheel", onUserScroll);
      element.removeEventListener("touchmove", onUserScroll);
      element.removeEventListener("keydown", onUserScroll);
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("keydown", onKeyActivate);
    };
  }, [scrollRef, contentRef, glideToEnd, setPinnedBoth]);

  const toLatest = useCallback(() => {
    setPinnedBoth(true);
    glideToEnd(false);
  }, [glideToEnd, setPinnedBoth]);

  /** Lets go of the end before a scroll the user asked for from the keyboard (PageUp, Cmd-Up). */
  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPinnedBoth(false);
  }, [setPinnedBoth]);

  return { pinned, toLatest, release };
}
