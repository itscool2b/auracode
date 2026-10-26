import { useMemo } from "react";
import type { ToolContent, ToolLocation, Truncation } from "../../bindings";
import type { BlobState } from "../../lib/chat/chatStore";
import type { ToolDisplayStatus, ToolItem } from "../../lib/chat/transcript";
import { diffLines } from "../../lib/diff";
import { formatCount } from "../../lib/format";

/** What a block needs to page a truncated output in through `chat_blob`. */
export interface BlobProps {
  readonly blobs: ReadonlyMap<string, BlobState>;
  readonly onLoadBlob: (sha256: string) => void;
}

const STATUS_LABEL: Record<ToolDisplayStatus, string> = {
  pending: "Pending",
  in_progress: "Running",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** A tool call: title, kind, status and locations, with its output below. */
export function ToolBlock({
  tool,
  display,
  blobs,
  onLoadBlob,
}: { readonly tool: ToolItem; readonly display: ToolDisplayStatus } & BlobProps) {
  return (
    <div
      className="chat-block"
      data-kind="tool"
      data-testid="item"
      data-test-kind="tool"
      data-test-tool-kind={tool.toolKind}
      data-test-status={display}
    >
      <div className="chat-block-head">
        <span className="chat-block-title">{tool.title || tool.toolName || "Tool"}</span>
        <span className="chat-block-tag">{tool.toolKind.replace("_", " ")}</span>
        <span className="chat-tool-status" data-status={display}>
          {STATUS_LABEL[display]}
        </span>
      </div>
      <Locations locations={tool.locations} />
      {tool.content.length > 0 ? (
        <details data-testid="tool-output">
          <summary className="ui-muted">Output</summary>
          <div className="chat-segment">
            {tool.content.map((content, index) => (
              <ToolContentView
                // biome-ignore lint/suspicious/noArrayIndexKey: an update replaces content as a whole.
                key={index}
                content={content}
                blobs={blobs}
                onLoadBlob={onLoadBlob}
              />
            ))}
          </div>
        </details>
      ) : null}
      {tool.truncated ? (
        <EventDetails truncation={tool.truncated} blobs={blobs} onLoadBlob={onLoadBlob} />
      ) : null}
    </div>
  );
}

export function Locations({ locations }: { readonly locations: readonly ToolLocation[] }) {
  if (locations.length === 0) return null;
  return (
    <ul className="chat-locations" data-testid="tool-locations">
      {locations.map((location, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: locations are positional.
        <li key={index}>
          {location.line === null ? location.path : `${location.path}:${location.line}`}
        </li>
      ))}
    </ul>
  );
}

const UTF8 = new TextEncoder();
const UTF8_TEXT = new TextDecoder();

/** What a cut terminal output shows once pages of its full text arrive. */
export interface TerminalParts {
  /** The loaded start of the full output; `null` until a page arrives. */
  readonly head: string | null;
  /** Bytes between `head` and `tail` that are not shown. */
  readonly between: number;
  /** The end of the output still to show after `head`. */
  readonly tail: string;
}

/**
 * A cut terminal output keeps its end inline, since the end explains failures. While pages of the
 * full output load from the start, the loaded start shows, then how much lies between, then that
 * end, until the pages reach it. Pages and the inline end are both cut on character boundaries,
 * so a byte offset into the full output is one into its end as well. A full output keeps only its
 * first 64 MiB, so the pages may never reach the end.
 */
export function terminalParts(
  output: string,
  truncation: Truncation | null,
  blob: BlobState | undefined,
): TerminalParts {
  if (truncation === null || blob === undefined || blob.nextOffset === 0) {
    return { head: null, between: 0, tail: output };
  }
  const end = UTF8.encode(output);
  const endStart = Math.max(0, truncation.total_bytes - end.length);
  if (blob.nextOffset < endStart) {
    return { head: blob.text, between: endStart - blob.nextOffset, tail: output };
  }
  const rest = end.subarray(Math.min(end.length, blob.nextOffset - endStart));
  return { head: blob.text, between: 0, tail: UTF8_TEXT.decode(rest) };
}

/** A full output keeps only its first 64 MiB: what an output loaded to its last page lacks. */
function unkeptBytes(truncation: Truncation | null, blob: BlobState | undefined): number {
  if (truncation === null || !blob?.eof) return 0;
  return Math.max(0, truncation.total_bytes - blob.total);
}

/** One entry of a tool's (or a card's) content: text, a diff, or terminal output. */
export function ToolContentView({
  content,
  blobs,
  onLoadBlob,
}: { readonly content: ToolContent } & BlobProps) {
  const blob = content.truncated?.blob ? blobs.get(content.truncated.blob) : undefined;
  switch (content.type) {
    case "text": {
      const unkept = unkeptBytes(content.truncated, blob);
      return (
        <div
          className="chat-command"
          data-testid="tool-content"
          data-test-type="text"
          data-test-truncated={String(content.truncated !== null)}
        >
          <pre className="ui-pre" data-testid="tool-text">
            {blob?.text || content.text}
          </pre>
          {unkept > 0 ? (
            <p className="chat-marker">
              The remaining {formatCount(unkept)} bytes weren't kept: an output keeps its first 64
              MiB.
            </p>
          ) : null}
          <FullOutput truncation={content.truncated} blob={blob} onLoadBlob={onLoadBlob} />
        </div>
      );
    }
    case "terminal": {
      const { head, between, tail } = terminalParts(content.output, content.truncated, blob);
      return (
        <div
          className="chat-command"
          data-testid="tool-content"
          data-test-type="terminal"
          data-test-truncated={String(content.truncated !== null)}
        >
          {head === null || between === 0 ? (
            <pre className="ui-pre">{(head ?? "") + tail}</pre>
          ) : (
            <>
              <pre className="ui-pre">{head}</pre>
              <p className="chat-marker">
                {blob?.eof
                  ? `${formatCount(between)} bytes in between weren't kept (an output keeps its first 64 MiB). The end of the output:`
                  : `${formatCount(between)} bytes not loaded yet. The end of the output:`}
              </p>
              <pre className="ui-pre">{tail}</pre>
            </>
          )}
          {content.exit_code !== null ? (
            <span className="ui-muted ui-mono">exit {content.exit_code}</span>
          ) : null}
          <FullOutput truncation={content.truncated} blob={blob} onLoadBlob={onLoadBlob} />
        </div>
      );
    }
    case "diff":
      return (
        <div
          className="chat-command"
          data-testid="tool-content"
          data-test-type="diff"
          data-test-truncated={String(content.truncated !== null)}
        >
          <DiffView
            path={content.path}
            oldText={content.old_text}
            newText={content.new_text}
            blob={blob}
          />
          <FullOutput truncation={content.truncated} blob={blob} onLoadBlob={onLoadBlob} />
        </div>
      );
  }
}

/** A diff that did not fit inline keeps empty texts; its blob holds `{old_text, new_text}`. */
function fullDiff(blob: BlobState | undefined): { old: string | null; new: string } | null {
  if (!blob?.eof) return null;
  try {
    const parsed = JSON.parse(blob.text) as { old_text?: string | null; new_text?: string };
    return { old: parsed.old_text ?? null, new: parsed.new_text ?? "" };
  } catch {
    return null;
  }
}

function DiffView({
  path,
  oldText,
  newText,
  blob,
}: {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string;
  readonly blob: BlobState | undefined;
}) {
  const loaded = fullDiff(blob);
  const before = loaded ? loaded.old : oldText;
  const after = loaded ? loaded.new : newText;
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre className="ui-pre">
      <span className="ui-muted">{path}</span>
      {"\n"}
      {diff.lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional.
        <span key={index} className="chat-diff-line" data-op={line.op} data-test-op={line.op}>
          {line.op === "add" ? "+ " : line.op === "remove" ? "- " : "  "}
          {line.text}
          {"\n"}
        </span>
      ))}
      {diff.truncated ? "[too large to diff line by line]" : null}
    </pre>
  );
}

/**
 * "Load full output": an entry cut to fit the event budget pages its complete text in through
 * `chat_blob`, 256 KiB at a time, each page ending on a character boundary.
 */
export function FullOutput({
  truncation,
  blob,
  onLoadBlob,
}: {
  readonly truncation: Truncation | null;
  readonly blob: BlobState | undefined;
  readonly onLoadBlob: (sha256: string) => void;
}) {
  if (truncation === null) return null;
  const sha = truncation.blob;
  if (sha === null) {
    return (
      <span className="ui-muted">
        Cut to fit ({formatCount(truncation.total_bytes)} bytes in all).
      </span>
    );
  }
  if (blob?.eof) return null;
  const label = blob?.loading
    ? "Loading…"
    : blob && blob.nextOffset > 0
      ? `Load more (${formatCount(blob.nextOffset)} of ${formatCount(blob.total)} bytes)`
      : `Load full output (${formatCount(truncation.total_bytes)} bytes)`;
  return (
    <div className="ui-row">
      <button
        type="button"
        className="ui-button"
        data-kind="quiet"
        data-testid="load-full-output"
        disabled={blob?.loading === true}
        onClick={() => onLoadBlob(sha)}
      >
        {label}
      </button>
      {blob?.error ? (
        <span role="alert" className="ui-error">
          {blob.error}
        </span>
      ) : null}
    </div>
  );
}

/** "Show full details": the event's complete original JSON, when more than entry text was cut. */
export function EventDetails({
  truncation,
  blobs,
  onLoadBlob,
}: { readonly truncation: Truncation } & BlobProps) {
  const sha = truncation.blob;
  if (sha === null) return null;
  const blob = blobs.get(sha);
  if (blob?.eof) {
    let pretty = blob.text;
    try {
      pretty = JSON.stringify(JSON.parse(blob.text), null, 2);
    } catch {
      // Not JSON after all: shown as it is.
    }
    return <pre className="ui-pre">{pretty}</pre>;
  }
  return (
    <div className="ui-row">
      <button
        type="button"
        className="ui-button"
        data-kind="quiet"
        data-testid="show-full-details"
        disabled={blob?.loading === true}
        onClick={() => onLoadBlob(sha)}
      >
        {blob?.loading ? "Loading…" : blob ? "Show more details" : "Show full details"}
      </button>
      {blob?.error ? (
        <span role="alert" className="ui-error">
          {blob.error}
        </span>
      ) : null}
    </div>
  );
}
