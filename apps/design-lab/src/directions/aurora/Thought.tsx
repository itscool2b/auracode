import { ChevronDown, Sparkle } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDuration, formatElapsed, type Player, type ThoughtItem } from "../../kit";
import { Markdown } from "./Markdown";
import { Collapse, cx } from "./ui";

/**
 * Whole seconds since `since` on the timeline, re-rendering only when the count changes (counted
 * from `since` itself, not from the playhead rounded down, so "1s" shows a second in, not up to
 * two).
 */
function useElapsedSeconds(player: Player, since: number): number {
  const read = useCallback(
    () => Math.max(0, Math.floor((player.getTime() - since) / 1000)),
    [player, since],
  );
  return useSyncExternalStore(player.subscribe, read, read);
}

/** Seconds since `since`, live. Nothing for the first second, so a label never reads "0s". */
export function LiveElapsed({
  player,
  since,
}: {
  readonly player: Player;
  readonly since: number;
}) {
  const seconds = useElapsedSeconds(player, since);
  if (seconds < 1) return null;
  return <span className="au-elapsed">{formatElapsed(seconds * 1000)}</span>;
}

/** The live window's height: three lines and a bit. Taller content scrolls under a top fade. */
const LIVE_WINDOW = 92;

/**
 * The agent's reasoning. While it streams, the pill shimmers "Thinking 4s" over a short live
 * window of the newest lines; once it ends, the window folds away into "Thought for 6s", which
 * opens the whole thought on click.
 */
export const ThoughtView = memo(function ThoughtView({
  item,
  player,
}: {
  readonly item: ThoughtItem;
  readonly player: Player;
}) {
  const thinking = item.durationMs === null;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? thinking;
  const live = thinking && open === null;
  const windowRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // The top fade only once the text is taller than the window: the first words of a thought arrive
  // at full strength, not inside the fade.
  useLayoutEffect(() => {
    const frame = windowRef.current;
    const inner = innerRef.current;
    if (!live || !frame || !inner) return;
    const apply = (): void => {
      if (inner.offsetHeight > LIVE_WINDOW) frame.dataset.overflow = "";
      else delete frame.dataset.overflow;
    };
    apply();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(apply);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [live]);

  return (
    <div className="au-thought" data-thinking={thinking ? "" : undefined}>
      <button
        type="button"
        className="au-thought-pill"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <Sparkle className="au-thought-icon" size={13} strokeWidth={2} />
        {thinking ? (
          <>
            <span className="au-shimmer">Thinking</span>
            <LiveElapsed player={player} since={item.startedAt} />
          </>
        ) : (
          <span>Thought for {formatDuration(item.durationMs ?? 0)}</span>
        )}
        <ChevronDown className="au-chevron" data-open={expanded ? "" : undefined} size={14} />
      </button>
      <Collapse open={expanded}>
        <div ref={windowRef} className={cx("au-thought-body", live && "au-thought-live")}>
          <div ref={innerRef} className="au-thought-inner">
            <Markdown text={item.text} streaming={item.streaming} tone="thought" />
          </div>
        </div>
      </Collapse>
    </div>
  );
});
