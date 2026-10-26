import { OrbitMark } from "@auracode/ui/orbit";
import type { RenderedItem } from "../../lib/chat/transcript";

type RenderedTool = Extract<RenderedItem, { kind: "tool" }>;

const KIND_LABEL = {
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  delete: ["deletion", "deletions"],
  move: ["move", "moves"],
  search: ["search", "searches"],
  execute: ["command", "commands"],
  think: ["thinking step", "thinking steps"],
  fetch: ["fetch", "fetches"],
  switch_mode: ["mode change", "mode changes"],
  other: ["tool call", "tool calls"],
} as const;

/** The children remain separate virtual rows when opened, even for a thousand-call run. */
export function ToolGroup({
  tools,
  expanded,
  onToggle,
  agentId,
  agentName,
  byline,
}: {
  readonly tools: readonly RenderedTool[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly agentId: string;
  readonly agentName: string;
  readonly byline: boolean;
}) {
  const running = tools.find(
    (tool) => tool.display === "in_progress" || tool.display === "pending",
  );
  const failed = tools.filter((tool) => tool.display === "failed").length;
  const stopped = tools.filter((tool) => tool.display === "stopped").length;
  const counts = new Map<RenderedTool["toolKind"], number>();
  for (const tool of tools) counts.set(tool.toolKind, (counts.get(tool.toolKind) ?? 0) + 1);
  const summary = [...counts]
    .map(([kind, count]) => `${count} ${KIND_LABEL[kind][count === 1 ? 0 : 1]}`)
    .join(" · ");
  return (
    <div className="chat-tool-group">
      {byline ? (
        <div className="chat-byline">
          <OrbitMark agent={agentId} size={16} label={agentName} />
          <span>{agentName}</span>
        </div>
      ) : null}
      <button
        type="button"
        className="chat-tool-group-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid="tool-group"
      >
        {running ? (
          <OrbitMark agent={agentId} size={16} state="tool" label={`${agentName}, working`} />
        ) : (
          <span className="chat-disclosure" aria-hidden="true">
            {expanded ? "⌄" : "›"}
          </span>
        )}
        <span className="chat-tool-group-summary">
          {running ? running.title || "Working" : summary}
        </span>
        <span className="chat-tool-group-result" data-failed={failed > 0}>
          {running
            ? `${tools.length} calls`
            : failed
              ? `${failed} failed`
              : stopped
                ? `${stopped} stopped`
                : "Done"}
        </span>
      </button>
    </div>
  );
}
