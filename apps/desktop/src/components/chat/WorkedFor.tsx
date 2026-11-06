import { ChevronRight, FileDiff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { FileLink } from "./FileLink";

/**
 * The row a finished turn's work folds under, above its final answer (owner, 4 November 2026,
 * after Codex): "Worked for 1 min 42 s · 12 steps". It opens the work in place and closes it again.
 */
export function WorkedFor({
  label,
  open,
  agentName,
  onToggle,
}: {
  readonly label: string;
  readonly open: boolean;
  readonly agentName: string;
  readonly onToggle: () => void;
}) {
  return (
    <div className="chat-segment chat-worked" data-testid="worked-for-row">
      <button
        type="button"
        className="chat-worked-toggle"
        data-testid="worked-for"
        aria-expanded={open}
        onClick={onToggle}
      >
        {/* The agent's part of the turn starts here; its name is said once, to screen readers. */}
        <span className="sr-only">{agentName}: </span>
        <span>{label}</span>
        <ChevronRight size={14} aria-hidden="true" className="chat-worked-chevron" />
      </button>
    </div>
  );
}

/** Names the card considers at most; the rest only count toward "N more". */
const LISTED = 12;

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * The files a finished turn changed, under its answer, so folding the work never hides what it
 * did: their names, the full path in each tooltip, each opening in the person's editor, and Review,
 * which opens Changes.
 */
export function ChangedFiles({
  files,
  onReview,
}: {
  readonly files: readonly string[];
  readonly onReview?: () => void;
}) {
  const listed = files.slice(0, LISTED);
  // As many whole names as the row holds; the rest fold into "N more". Measured after layout and
  // again whenever the row's width changes.
  const [fit, setFit] = useState(listed.length);
  const list = useRef<HTMLUListElement>(null);
  const names = listed.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Other names need measuring again.
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const chips = [...node.querySelectorAll<HTMLElement>("li[data-name]")];
      const more = node.querySelector<HTMLElement>("li[data-more]");
      // Every name at its natural width (none shrinking), then keep those that end inside the
      // row, leaving room for "N more" unless every file's name fits.
      node.dataset.measuring = "";
      for (const chip of chips) chip.hidden = false;
      if (more) more.hidden = false;
      const right = node.getBoundingClientRect().right + 0.5;
      const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
      const room = right - (more ? more.getBoundingClientRect().width + gap : 0);
      const ends = chips.map((chip) => chip.getBoundingClientRect().right);
      let shown = ends.findIndex((end) => end > room);
      if (shown === -1) shown = ends.length;
      if (files.length === chips.length && ends.every((end) => end <= right)) shown = chips.length;
      // One name always shows, cut short if it must be.
      shown = Math.max(1, shown);
      delete node.dataset.measuring;
      for (const [index, chip] of chips.entries()) chip.hidden = index >= shown;
      if (more) more.hidden = files.length - shown <= 0;
      setFit(shown);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [names, files.length]);
  const shown = Math.min(fit, listed.length);
  const more = files.length - shown;
  return (
    <div className="chat-segment chat-changed" data-testid="changed-files">
      <FileDiff size={14} aria-hidden="true" className="chat-changed-icon" />
      <span className="chat-changed-count">
        {files.length === 1 ? "Changed 1 file" : `Changed ${files.length} files`}
      </span>
      <ul ref={list} className="chat-changed-list" aria-label="Changed files">
        {listed.map((path, index) => (
          <li key={path} title={path} data-name="" hidden={index >= shown}>
            <FileLink reference={path} icon={false}>
              {basename(path)}
            </FileLink>
          </li>
        ))}
        {/* Always rendered, so the measurement can reserve its width. */}
        <li className="chat-changed-more" data-more="" hidden={more <= 0}>
          {more > 0 ? more : files.length} more
        </li>
      </ul>
      {onReview ? (
        <button
          type="button"
          className="g-button g-button-ghost g-button-28 chat-changed-review"
          onClick={onReview}
        >
          Review
        </button>
      ) : null}
    </div>
  );
}
