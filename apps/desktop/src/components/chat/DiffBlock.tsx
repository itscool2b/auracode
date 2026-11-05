import { CopyButton } from "@auracode/ui/graphite";
import { MessageSquarePlus } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { type DiffComment, excerptOf } from "../../lib/chat/review";
import { diffLines } from "../../lib/diff";
import { useDisclosure } from "./DisclosureMemory";

const COLLAPSED_ROWS = 14;

/** Comments on this file's lines, for Changes' review (lib/chat/review.ts). */
export interface DiffReview {
  readonly comments: readonly DiffComment[];
  readonly onAdd: (comment: Omit<DiffComment, "id" | "path">) => void;
  readonly onRemove: (id: string) => void;
}

/** The line a comment is on, as its buttons name it. */
function place(comment: Pick<DiffComment, "side" | "line">): string {
  return comment.side === "old" ? `removed line ${comment.line}` : `line ${comment.line}`;
}

function commentCount(count: number): string {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

/** A comment being written under a line: Enter adds it, Shift+Enter starts a new line. */
function CommentEditor({
  label,
  onAdd,
  onCancel,
}: {
  readonly label: string;
  readonly onAdd: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // The editor opens because its line was chosen.
    field.current?.focus();
  }, []);
  const add = () => {
    if (text.trim()) onAdd(text.trim());
  };
  return (
    <div className="chat-diff-comment-editor">
      <textarea
        ref={field}
        className="g-textarea"
        aria-label={label}
        placeholder="What should change here?"
        maxLength={4000}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            // Esc only closes the editor; it never reaches the panel, which it would close.
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            add();
          }
        }}
      />
      <div className="chat-diff-comment-actions">
        <button type="button" className="g-button g-button-ghost g-button-24" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="g-button g-button-24"
          disabled={!text.trim()}
          onClick={add}
        >
          Add comment
        </button>
      </div>
    </div>
  );
}

/** Line numbers refer to the supplied text, which may be a fragment of the named file. */
export function DiffBlock({
  path,
  oldText,
  newText,
  disclosureKey,
  wholeFile = false,
  copyPath = true,
  review,
}: {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string;
  readonly disclosureKey: string;
  readonly wholeFile?: boolean;
  /** Off when `path` names a document rather than a file, such as project memory. */
  readonly copyPath?: boolean;
  /** Comments on lines, where line numbers are the file's own (Changes). */
  readonly review?: DiffReview;
}) {
  const [expanded, setExpanded] = useDisclosure(disclosureKey, "diff", false);
  const bodyId = useId();
  const noteId = useId();
  const scroller = useRef<HTMLElement>(null);
  const diff = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const rows = useMemo(() => {
    let oldLine = 0;
    let newLine = 0;
    return diff.lines.map((line) => {
      const before = line.op === "add" ? null : ++oldLine;
      const after = line.op === "remove" ? null : ++newLine;
      return { ...line, oldLine: before, newLine: after, key: `${before}:${after}:${line.op}` };
    });
  }, [diff]);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hidden = rows.length - COLLAPSED_ROWS;
  // A shortened replacement view lists lines as removed and added that were not: no comments.
  const reviewing = diff.truncated ? undefined : review;
  // The line whose comment is being written, and the line whose comment button Tab reaches.
  const [writing, setWriting] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  // Each comment sits under its line. One on a folded line is counted on Show more lines; one
  // whose line has gone (the file changed since) is listed after the lines.
  const placement = useMemo(() => {
    const under = new Map<string, DiffComment[]>();
    const lost: DiffComment[] = [];
    let folded = 0;
    for (const comment of reviewing?.comments ?? []) {
      const index = rows.findIndex((row) =>
        comment.side === "old"
          ? row.op === "remove" && row.oldLine === comment.line
          : row.op !== "remove" && row.newLine === comment.line,
      );
      const row = rows[index];
      if (!row) lost.push(comment);
      else if (index >= visible.length) folded += 1;
      else under.set(row.key, [...(under.get(row.key) ?? []), comment]);
    }
    return { under, lost, folded };
  }, [reviewing, rows, visible.length]);
  // One comment button takes Tab, at first the first changed line's; arrows move between them.
  const tabStop =
    visible.find((row) => row.key === current)?.key ??
    (visible.find((row) => row.op !== "same") ?? visible[0])?.key;
  const commentButtons = () =>
    Array.from(
      scroller.current?.querySelectorAll<HTMLButtonElement>("button[data-comment-line]") ?? [],
    );
  const focusLine = (key: string) =>
    commentButtons()
      .find((button) => button.dataset.commentLine === key)
      ?.focus();
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = commentButtons();
    const index = buttons.indexOf(event.currentTarget);
    const target =
      buttons[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : index + (event.key === "ArrowDown" ? 1 : -1)
      ];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  const directoryEnd = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const omittedOld = diff.truncated
    ? diff.removed - rows.filter((line) => line.op === "remove").length
    : 0;
  const omittedNew = diff.truncated
    ? diff.added - rows.filter((line) => line.op === "add").length
    : 0;
  const changed = diff.added + diff.removed;
  const explain = !wholeFile || oldText === null || diff.truncated;
  const filledSquares = Math.min(5, changed);
  const addedSquares = changed === 0 ? 0 : Math.round((diff.added / changed) * filledSquares);
  const columns = reviewing ? 5 : 4;

  return (
    <figure
      className="chat-diff"
      data-testid="diff-block"
      data-test-truncated={String(diff.truncated)}
      data-folded={hidden > 0 && !expanded}
    >
      <figcaption className="chat-diff-header">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M3 1.5h5l3 3v8H3zM8 1.5v3h3" />
        </svg>
        <span className="chat-diff-path" title={path}>
          <span className="chat-diff-directory">{path.slice(0, directoryEnd)}</span>
          <strong>{path.slice(directoryEnd) || "Changed text"}</strong>
        </span>
        <span
          className="chat-diff-totals"
          title={`${diff.added} added, ${diff.removed} removed${diff.truncated ? ", replacement totals" : ""}`}
        >
          <span data-op="add">+{diff.added}</span> <span data-op="remove">−{diff.removed}</span>
        </span>
        <span className="chat-diff-stat" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((square) => (
            <span
              key={square}
              data-op={square < addedSquares ? "add" : square < filledSquares ? "remove" : "same"}
            />
          ))}
        </span>
        {copyPath ? <CopyButton text={path} label="Copy path" caption="Copy path" /> : null}
      </figcaption>
      {explain ? (
        <p className="chat-diff-note" id={noteId}>
          {!wholeFile ? "Line numbers are relative to the supplied text." : null}
          {oldText === null ? " No previous text was provided." : null}
          {diff.truncated
            ? " Large diff: counts describe a replacement, not individual edits."
            : null}
        </p>
      ) : null}
      <section
        ref={scroller}
        className="chat-diff-scroll"
        id={bodyId}
        data-review={reviewing ? "" : undefined}
        aria-label={`Line changes for ${path || "supplied text"}`}
        aria-describedby={explain ? noteId : undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long code lines horizontally.
        tabIndex={0}
      >
        {rows.length === 0 ? (
          <p className="chat-diff-empty">No text to compare.</p>
        ) : (
          <table
            className="chat-diff-table"
            aria-label={wholeFile ? "File line changes" : "Relative line changes"}
          >
            <thead>
              <tr>
                {reviewing ? <th scope="col">Comment</th> : null}
                <th scope="col">Old</th>
                <th scope="col">New</th>
                <th scope="col">Change</th>
                <th scope="col">Text</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((line) => {
                // A removed line exists only in the earlier text: its number is the old one.
                const side = line.op === "remove" ? "old" : "new";
                const number = (side === "old" ? line.oldLine : line.newLine) ?? 0;
                const where = place({ side, line: number });
                return (
                  <Fragment key={line.key}>
                    <tr className="chat-diff-line" data-op={line.op} data-test-op={line.op}>
                      {reviewing ? (
                        <td className="chat-diff-comment-cell">
                          <button
                            type="button"
                            className="chat-diff-comment-add"
                            data-comment-line={line.key}
                            tabIndex={line.key === tabStop ? 0 : -1}
                            aria-label={`Comment on ${where}`}
                            title={`Comment on ${where}`}
                            onFocus={() => setCurrent(line.key)}
                            onKeyDown={moveFocus}
                            onClick={() => setWriting(line.key)}
                          >
                            <MessageSquarePlus size={13} aria-hidden="true" />
                          </button>
                        </td>
                      ) : null}
                      <td className="chat-diff-number" data-side="old">
                        {line.oldLine}
                      </td>
                      <td className="chat-diff-number" data-side="new">
                        {line.newLine}
                      </td>
                      <td
                        className="chat-diff-marker"
                        aria-label={
                          line.op === "add"
                            ? "Added"
                            : line.op === "remove"
                              ? "Removed"
                              : "Unchanged"
                        }
                      >
                        {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
                      </td>
                      <td className="chat-diff-code">
                        <code>{line.text || " "}</code>
                      </td>
                    </tr>
                    {reviewing
                      ? (placement.under.get(line.key) ?? []).map((comment) => (
                          <tr key={comment.id} className="chat-diff-review-row">
                            <td colSpan={columns}>
                              <div
                                className="chat-diff-comment chat-diff-pinned"
                                data-testid="diff-comment"
                              >
                                <p className="chat-diff-comment-text">{comment.text}</p>
                                <button
                                  type="button"
                                  className="g-button g-button-ghost g-button-24"
                                  aria-label={`Delete the comment on ${where}`}
                                  onClick={() => {
                                    reviewing.onRemove(comment.id);
                                    focusLine(line.key);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      : null}
                    {reviewing && writing === line.key ? (
                      <tr className="chat-diff-review-row">
                        <td colSpan={columns}>
                          <div className="chat-diff-pinned">
                            <CommentEditor
                              label={`Comment on ${where}`}
                              onCancel={() => {
                                setWriting(null);
                                focusLine(line.key);
                              }}
                              onAdd={(text) => {
                                reviewing.onAdd({
                                  line: number,
                                  side,
                                  excerpt: excerptOf(line.text),
                                  text,
                                });
                                setWriting(null);
                                focusLine(line.key);
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {hidden > 0 ? (
        <button
          type="button"
          className="chat-diff-expand"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer lines"
            : `Show ${hidden} more lines${placement.folded ? `, ${commentCount(placement.folded)}` : ""}`}
        </button>
      ) : null}
      {reviewing && placement.lost.length ? (
        <ul className="chat-diff-lost" aria-label="Comments on lines this diff no longer has">
          {placement.lost.map((comment) => (
            <li key={comment.id} className="chat-diff-comment" data-testid="diff-comment">
              <p className="chat-diff-comment-text">
                <span className="chat-diff-comment-place">On {place(comment)}:</span> {comment.text}
              </p>
              <button
                type="button"
                className="g-button g-button-ghost g-button-24"
                aria-label={`Delete the comment on ${place(comment)}`}
                onClick={() => {
                  reviewing.onRemove(comment.id);
                  scroller.current?.focus();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {diff.truncated ? (
        <p className="chat-diff-truncated">
          The replacement preview omits {omittedOld} old and {omittedNew} new lines. Expanding shows
          only the retained preview.
        </p>
      ) : null}
    </figure>
  );
}
