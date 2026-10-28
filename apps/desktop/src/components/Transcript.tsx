import { useId, useMemo, useState } from "react";
import type { PlanEntry, ToolContent, ToolKind, ToolStatus } from "../bindings";
import { diffLines } from "../lib/diff";
import { formatCost, formatCount, formatDuration, stopReasonLabel } from "../lib/format";
import { useStickToBottom } from "../lib/hooks";
import { isRunning, type StreamSnapshot } from "../lib/session";
import type { ThoughtBlock, ToolBlock } from "../lib/stream";
import {
  CheckIcon,
  ChevronIcon,
  CircleIcon,
  CrossIcon,
  FileIcon,
  PencilIcon,
  SearchIcon,
  SpinnerIcon,
  TerminalIcon,
  ToolIcon,
} from "./icons";
import { Answer, InlineText } from "./Markdown";

/** One demo session as a transcript: thought pill, tool rows, answer, plan, and a footer. */
export function Transcript({
  snapshot,
  className,
}: {
  readonly snapshot: StreamSnapshot;
  readonly className?: string;
}) {
  const { stream } = snapshot;
  const running = isRunning(snapshot);
  // Once the turn is over nothing is still working: spinners stop where the agent left them.
  const settled = stream.turn?.ended === true || !running;
  const scrollRef = useStickToBottom<HTMLDivElement>(stream);

  return (
    <div
      ref={scrollRef}
      className={`transcript focus-gutter ${className ?? ""}`}
      role="log"
      aria-label="Demo transcript"
      aria-busy={running}
    >
      {stream.items.map((item) => {
        // Keyed per session, so a new run's blocks mount (and fade in) fresh.
        const key = `${snapshot.sessionId ?? "pending"}:${item.kind}:${item.id}`;
        if (item.kind === "thought") {
          const thought = stream.thoughts.get(item.id);
          return thought ? <ThoughtPill key={key} thought={thought} /> : null;
        }
        if (item.kind === "tool") {
          const tool = stream.tools.get(item.id);
          return tool ? <ToolRow key={key} tool={tool} settled={settled} /> : null;
        }
        const message = stream.messages.get(item.id);
        return message ? <Answer key={key} text={message.text} /> : null;
      })}
      {stream.plan.length > 0 ? <PlanChecklist entries={stream.plan} settled={settled} /> : null}
      {stream.turn?.ended ? <TurnFooter snapshot={snapshot} /> : null}
    </div>
  );
}

function ThoughtPill({ thought }: { readonly thought: ThoughtBlock }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const label = thought.completed
    ? `Thought for ${formatDuration(thought.durationMs ?? 0)}`
    : "Thinking";
  return (
    <div className={thought.completed ? undefined : "thinking"}>
      <button
        type="button"
        className="thought-pill"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thought-dot" aria-hidden="true" />
        <span className="thought-label">{label}</span>
        <ChevronIcon width={12} height={12} />
      </button>
      {open ? (
        <p id={detailsId} className="thought-text">
          <InlineText
            text={
              thought.text ||
              (thought.completed ? "The agent did not share its reasoning." : "Thinking…")
            }
          />
        </p>
      ) : null}
    </div>
  );
}

function kindIcon(kind: ToolKind) {
  switch (kind) {
    case "read":
      return <FileIcon className="tool-icon" />;
    case "edit":
    case "delete":
    case "move":
      return <PencilIcon className="tool-icon" />;
    case "execute":
      return <TerminalIcon className="tool-icon" />;
    case "search":
    case "fetch":
      return <SearchIcon className="tool-icon" />;
    default:
      return <ToolIcon className="tool-icon" />;
  }
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  pending: "Pending",
  in_progress: "Running",
  completed: "Done",
  failed: "Failed",
};

function StatusMark({
  status,
  settled,
}: {
  readonly status: ToolStatus;
  readonly settled: boolean;
}) {
  const className = `status-${status}`;
  const label = STATUS_LABEL[status];
  switch (status) {
    case "completed":
      return <CheckIcon className={className} role="img" aria-hidden={false} aria-label={label} />;
    case "failed":
      return <CrossIcon className={className} role="img" aria-hidden={false} aria-label={label} />;
    case "in_progress":
      return (
        <SpinnerIcon
          className={settled ? className : `${className} spin`}
          role="img"
          aria-hidden={false}
          aria-label={label}
        />
      );
    case "pending":
      return <CircleIcon className={className} role="img" aria-hidden={false} aria-label={label} />;
  }
}

/** Past-tense titles once a tool is done: "Read src/main.rs", "Edited src/main.rs". */
function settledTitle(tool: ToolBlock): string {
  if (tool.status !== "completed") return tool.title;
  if (tool.kind === "edit" && tool.title.startsWith("Edit "))
    return `Edited ${tool.title.slice(5)}`;
  return tool.title;
}

function ToolRow({ tool, settled }: { readonly tool: ToolBlock; readonly settled: boolean }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const diff = useMemo(() => {
    const change = tool.content.find((content) => content.type === "diff");
    return change ? diffLines(change.old_text, change.new_text) : null;
  }, [tool.content]);

  return (
    <div className="tool">
      <button
        type="button"
        className="tool-row"
        aria-expanded={open}
        aria-controls={detailsId}
        disabled={tool.content.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        {kindIcon(tool.kind)}
        <span className="tool-title">{settledTitle(tool)}</span>
        {diff ? (
          <span className="chip">
            <span className="add">+{diff.added}</span>
            <span className="remove">-{diff.removed}</span>
          </span>
        ) : null}
        <StatusMark status={tool.status} settled={settled} />
      </button>
      {open ? (
        <div id={detailsId} className="tool-details">
          {tool.content.map((content, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an update replaces content as a whole.
            <ToolContentView key={index} content={content} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolContentView({ content }: { readonly content: ToolContent }) {
  switch (content.type) {
    case "text":
      return <pre>{content.text}</pre>;
    case "terminal":
      return (
        <pre>
          {content.output}
          {content.truncated ? "\n[output truncated; the full output is on disk]" : ""}
          {content.exit_code !== null ? `\n[exit ${content.exit_code}]` : ""}
        </pre>
      );
    case "diff": {
      const diff = diffLines(content.old_text, content.new_text);
      return (
        <pre>
          <span className="code-lang">{content.path}</span>
          {diff.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional.
            <span key={index} className="diff-line" data-op={line.op}>
              {line.text}
              {"\n"}
            </span>
          ))}
          {diff.truncated ? "\n[too large to diff line by line]" : ""}
        </pre>
      );
    }
  }
}

function PlanChecklist({
  entries,
  settled,
}: {
  readonly entries: readonly PlanEntry[];
  readonly settled: boolean;
}) {
  return (
    <section className="plan" aria-label="Plan">
      <h3 className="plan-title">Plan</h3>
      <ol>
        {entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan update replaces the whole list.
          <li key={index} data-status={entry.status}>
            <PlanMark status={entry.status} settled={settled} />
            {entry.content}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanMark({
  status,
  settled,
}: {
  readonly status: PlanEntry["status"];
  readonly settled: boolean;
}) {
  switch (status) {
    case "completed":
      return (
        <CheckIcon className="status-completed" role="img" aria-hidden={false} aria-label="Done" />
      );
    case "in_progress":
      return (
        <SpinnerIcon
          className={settled ? "status-in_progress" : "status-in_progress spin"}
          role="img"
          aria-hidden={false}
          aria-label="In progress"
        />
      );
    case "pending":
      return (
        <CircleIcon className="status-pending" role="img" aria-hidden={false} aria-label="To do" />
      );
  }
}

function TurnFooter({ snapshot }: { readonly snapshot: StreamSnapshot }) {
  const { stream, startedAt, endedAt } = snapshot;
  const turn = stream.turn;
  if (!turn) return null;
  const parts: string[] = [stopReasonLabel(turn.stopReason ?? "end_turn")];
  if (startedAt !== null && endedAt !== null) parts.push(formatDuration(endedAt - startedAt));
  if (turn.usage) {
    parts.push(`${formatCount(turn.usage.input_tokens)} in`);
    parts.push(`${formatCount(turn.usage.output_tokens)} out`);
  }
  const cost = stream.usage?.cost
    ? formatCost(stream.usage.cost.amount, stream.usage.cost.currency)
    : null;
  if (cost) parts.push(cost);
  parts.push(`${formatCount(stream.events)} events in ${formatCount(stream.frames)} frames`);
  return (
    <p className="turn-footer">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );
}
