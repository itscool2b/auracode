import { ChevronRight } from "lucide-react";
import { groupResult, toolsSummary } from "../../lib/chat/toolWords";
import type { RenderedItem } from "../../lib/chat/transcript";
import { ToolPhraseText, toolTooltip } from "./ToolBlock";

type RenderedTool = Extract<RenderedItem, { kind: "tool" }>;

/**
 * The header of a stretch of work: every call the agent made between two pieces of its text, one
 * or many, behind one disclosure (thoughts are not shown, so they never split a stretch). One call
 * reads as its own line ("Searched for useState"); more read as one sentence of counts ("Read 3
 * files and searched for 2 patterns"), in the progressive while any still runs. Opened, the calls
 * follow as separate virtual rows on a spine, even for a thousand-call run; a single call shows
 * its output directly. Failures and stops show at the end; otherwise the end speaks only to
 * screen readers.
 */
export function ToolGroup({
  tools,
  expanded,
  onToggle,
  agentName,
  byline,
}: {
  readonly tools: readonly RenderedTool[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly agentName: string;
  readonly byline: boolean;
}) {
  const single = tools.length === 1 ? tools[0] : undefined;
  const result = groupResult(tools);
  return (
    <div className="chat-tool-group" data-single={single ? "" : undefined}>
      {byline ? <span className="sr-only">{agentName}</span> : null}
      <button
        type="button"
        className="chat-tool-group-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
        title={single ? toolTooltip(single) : undefined}
        data-testid="tool-group"
        data-test-count={tools.length}
      >
        <span className="chat-gutter">
          <ChevronRight className="chat-disclosure" size={12} aria-hidden="true" />
        </span>
        {single ? (
          <ToolPhraseText
            title={single.title || single.toolName || "Tool"}
            kind={single.toolKind}
            display={single.display}
          />
        ) : (
          <span className="chat-tool-group-summary">{toolsSummary(tools)}</span>
        )}
        <span className="chat-tool-group-result" data-tone={result.tone}>
          {result.text}
        </span>
      </button>
    </div>
  );
}
