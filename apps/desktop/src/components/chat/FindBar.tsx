import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

/**
 * Find in chat (Ctrl+F): the query, which match is shown out of how many, and moving between
 * them. Enter shows the next match and Shift+Enter the previous one; Esc closes the bar.
 */
export function FindBar({
  query,
  onQuery,
  index,
  count,
  limited,
  onStep,
  onClose,
  focusRequest,
}: {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** The shown match, from 0. */
  readonly index: number;
  readonly count: number;
  /** Earlier messages are not loaded, so they are not searched. */
  readonly limited: boolean;
  readonly onStep: (step: 1 | -1) => void;
  readonly onClose: () => void;
  /** Each new value focuses the field and selects its text, as Ctrl+F does again. */
  readonly focusRequest: number;
}) {
  const field = useRef<HTMLInputElement>(null);
  // Before the browser handles another key: a query typed right after Ctrl+F lands here whole.
  useLayoutEffect(() => {
    void focusRequest;
    field.current?.focus();
    field.current?.select();
  }, [focusRequest]);
  const searching = query.trim() !== "";
  const status = !searching ? "" : count === 0 ? "No results" : `${index + 1} of ${count}`;
  return (
    <search className="chat-find" aria-label="Find in chat" data-testid="find-bar">
      <div className="chat-find-row">
        <input
          ref={field}
          className="chat-find-input"
          aria-label="Find in chat"
          placeholder="Find in chat"
          spellCheck={false}
          value={query}
          onChange={(event) => onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              if (count > 0) onStep(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              // Esc closes find only; it never reaches the chat, where it would stop a turn.
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
        <span className="chat-find-count" role="status" data-testid="find-count">
          {status}
        </span>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-24"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={count === 0}
          onClick={() => onStep(-1)}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-24"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={count === 0}
          onClick={() => onStep(1)}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-24"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {limited && searching ? (
        <p className="chat-find-note">Earlier messages are not loaded, so they are not searched.</p>
      ) : null}
    </search>
  );
}
