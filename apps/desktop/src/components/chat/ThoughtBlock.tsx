import { AgentMark } from "@auracode/ui/graphite";
import { ChevronRight } from "lucide-react";
import type { ThoughtItem } from "../../lib/chat/transcript";
import { formatDuration } from "../../lib/format";
import { useDisclosure } from "./DisclosureMemory";

/**
 * A thought as one quiet line, "Thought for 2.4 s", opening onto the reasoning on a spine. While it
 * streams, the live mark takes the chevron's place in the gutter: the row's one moving thing.
 */
export function ThoughtBlock({
  item,
  active,
  tail,
  agentId,
  agentName,
}: {
  readonly item: ThoughtItem;
  readonly active: boolean;
  readonly tail: boolean;
  readonly agentId: string;
  readonly agentName: string;
}) {
  const [open, setOpen] = useDisclosure(item.key, "thought", active && tail);
  return (
    <details
      className="chat-thought"
      data-testid="item"
      data-test-kind="thought"
      data-test-completed={String(item.completed)}
      data-test-duration-ms={item.durationMs ?? ""}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="chat-gutter">
          {active && !item.completed ? (
            <AgentMark
              agent={agentId}
              state="thinking"
              size={16}
              label={`${agentName}, thinking`}
            />
          ) : (
            <ChevronRight className="chat-disclosure" size={12} aria-hidden="true" />
          )}
        </span>
        <span>
          {item.completed
            ? item.durationMs === null
              ? "Thought"
              : `Thought for ${formatDuration(item.durationMs)}`
            : active
              ? "Thinking…"
              : "Thinking interrupted"}
        </span>
      </summary>
      <p>
        {item.text ||
          (item.completed || !active ? "The agent did not share its reasoning." : "Thinking…")}
      </p>
    </details>
  );
}
