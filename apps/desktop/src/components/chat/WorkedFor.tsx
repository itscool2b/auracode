import { ChevronRight, FileDiff } from "lucide-react";

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

const SHOWN = 4;

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * The files a finished turn changed, under its answer, so folding the work never hides what it
 * did: their names, the full path in each tooltip, and Review, which opens Changes.
 */
export function ChangedFiles({
  files,
  onReview,
}: {
  readonly files: readonly string[];
  readonly onReview?: () => void;
}) {
  const shown = files.slice(0, SHOWN);
  const more = files.length - shown.length;
  return (
    <div className="chat-segment chat-changed" data-testid="changed-files">
      <FileDiff size={14} aria-hidden="true" className="chat-changed-icon" />
      <span className="chat-changed-count">
        {files.length === 1 ? "Changed 1 file" : `Changed ${files.length} files`}
      </span>
      <ul className="chat-changed-list" aria-label="Changed files">
        {shown.map((path) => (
          <li key={path} title={path}>
            {basename(path)}
          </li>
        ))}
        {more > 0 ? <li className="chat-changed-more">{more} more</li> : null}
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
