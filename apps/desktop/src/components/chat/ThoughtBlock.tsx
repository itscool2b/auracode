import { OrbitMark } from "@auracode/ui/orbit";
import type { ThoughtItem } from "../../lib/chat/transcript";
import { formatDuration } from "../../lib/format";
import { useDisclosure } from "./DisclosureMemory";

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
        {active && !item.completed ? (
          <OrbitMark agent={agentId} state="thinking" size={16} label={`${agentName}, thinking`} />
        ) : (
          <span className="chat-disclosure" aria-hidden="true">
            ›
          </span>
        )}
        {item.completed
          ? item.durationMs === null
            ? "Thought"
            : `Thought for ${formatDuration(item.durationMs)}`
          : active
            ? "Thinking…"
            : "Thinking interrupted"}
      </summary>
      <p>
        {item.text ||
          (item.completed || !active ? "The agent did not share its reasoning." : "Thinking…")}
      </p>
    </details>
  );
}
