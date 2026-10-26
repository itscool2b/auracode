import { CopyButton } from "@auracode/ui/orbit";
import { useId, useMemo } from "react";
import { diffLines } from "../../lib/diff";
import { useDisclosure } from "./DisclosureMemory";

const COLLAPSED_ROWS = 14;

/** Line numbers refer to the supplied text, which may be a fragment of the named file. */
export function DiffBlock({
  path,
  oldText,
  newText,
  disclosureKey,
}: {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string;
  readonly disclosureKey: string;
}) {
  const [expanded, setExpanded] = useDisclosure(disclosureKey, "diff", false);
  const bodyId = useId();
  const noteId = useId();
  const diff = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const rows = useMemo(() => {
    let oldLine = 0;
    let newLine = 0;
    return diff.lines.map((line) => ({
      ...line,
      oldLine: line.op === "add" ? null : ++oldLine,
      newLine: line.op === "remove" ? null : ++newLine,
    }));
  }, [diff]);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hidden = rows.length - COLLAPSED_ROWS;
  const directoryEnd = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const omittedOld = diff.truncated
    ? diff.removed - rows.filter((line) => line.op === "remove").length
    : 0;
  const omittedNew = diff.truncated
    ? diff.added - rows.filter((line) => line.op === "add").length
    : 0;
  const changed = diff.added + diff.removed;
  const filledSquares = Math.min(5, changed);
  const addedSquares = changed === 0 ? 0 : Math.round((diff.added / changed) * filledSquares);

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
        <CopyButton text={path} label="Copy path" caption="Copy path" />
      </figcaption>
      <p className="chat-diff-note" id={noteId}>
        Line numbers are relative to the supplied text.
        {oldText === null ? " No previous text was provided." : null}
        {diff.truncated
          ? " Large diff: counts describe a replacement, not individual edits."
          : null}
      </p>
      <section
        className="chat-diff-scroll"
        id={bodyId}
        aria-label={`Line changes for ${path || "supplied text"}`}
        aria-describedby={noteId}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long code lines horizontally.
        tabIndex={0}
      >
        {rows.length === 0 ? (
          <p className="chat-diff-empty">No text to compare.</p>
        ) : (
          <table className="chat-diff-table" aria-label="Relative line changes">
            <thead>
              <tr>
                <th scope="col">Old</th>
                <th scope="col">New</th>
                <th scope="col">Change</th>
                <th scope="col">Text</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((line) => (
                <tr
                  key={`${line.oldLine ?? ""}:${line.newLine ?? ""}:${line.op}`}
                  className="chat-diff-line"
                  data-op={line.op}
                  data-test-op={line.op}
                >
                  <td className="chat-diff-number" data-side="old">
                    {line.oldLine}
                  </td>
                  <td className="chat-diff-number" data-side="new">
                    {line.newLine}
                  </td>
                  <td
                    className="chat-diff-marker"
                    aria-label={
                      line.op === "add" ? "Added" : line.op === "remove" ? "Removed" : "Unchanged"
                    }
                  >
                    {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
                  </td>
                  <td className="chat-diff-code">
                    <code>{line.text || " "}</code>
                  </td>
                </tr>
              ))}
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
          {expanded ? "Show fewer lines" : `Show ${hidden} more lines`}
        </button>
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
