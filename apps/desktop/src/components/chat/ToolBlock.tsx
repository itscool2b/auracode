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
    <div className="chat-block" data-kind="tool">
      <div className="chat-block-head">
        <span className="chat-block-title">{tool.title || tool.toolName || "Tool"}</span>
        <span className="chat-block-tag">{tool.toolKind.replace("_", " ")}</span>
        <span className="chat-tool-status" data-status={display}>
          {STATUS_LABEL[display]}
        </span>
      </div>
      <Locations locations={tool.locations} />
      {tool.content.length > 0 ? (
        <details>
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
    <ul className="chat-locations">
      {locations.map((location, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: locations are positional.
        <li key={index}>
          {location.line === null ? location.path : `${location.path}:${location.line}`}
        </li>
      ))}
    </ul>
  );
}

/** One entry of a tool's (or a card's) content: text, a diff, or terminal output. */
export function ToolContentView({
  content,
  blobs,
  onLoadBlob,
}: { readonly content: ToolContent } & BlobProps) {
  const blob = content.truncated?.blob ? blobs.get(content.truncated.blob) : undefined;
  switch (content.type) {
    case "text":
      return (
        <div className="chat-command">
          <pre className="ui-pre">{blob?.text || content.text}</pre>
          <FullOutput truncation={content.truncated} blob={blob} onLoadBlob={onLoadBlob} />
        </div>
      );
    case "terminal":
      return (
        <div className="chat-command">
          <pre className="ui-pre">{blob?.text || content.output}</pre>
          {content.exit_code !== null ? (
            <span className="ui-muted ui-mono">exit {content.exit_code}</span>
          ) : null}
          <FullOutput truncation={content.truncated} blob={blob} onLoadBlob={onLoadBlob} />
        </div>
      );
    case "diff":
      return (
        <div className="chat-command">
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
        <span key={index} className="chat-diff-line" data-op={line.op}>
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
