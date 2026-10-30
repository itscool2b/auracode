import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { AgentMark } from "@auracode/ui/graphite";

export interface AgentStripProps {
  readonly agents: readonly AgentBrandId[];
  readonly active?: boolean;
  readonly label?: string;
  readonly onPoint?: (agent: AgentBrandId | null) => void;
  readonly className?: string;
}

export function AgentStrip({ agents, label, onPoint, className }: AgentStripProps) {
  return (
    <ul
      className={className ? `agent-strip ${className}` : "agent-strip"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-shown=""
      onPointerLeave={() => onPoint?.(null)}
    >
      {agents.map((id) => (
        <li
          key={id}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onPoint?.(id);
          }}
        >
          <span className="agent-strip-drift">
            <span className="agent-strip-lift">
              <AgentMark agent={id} size={24} label={AGENT_BRANDS[id].name} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
