import { LogoDrawing } from "./AgentLogo";
import { AgentMark, logoSide } from "./AgentMark";
import { modelMaker } from "./modelMakers";

export interface ModelMarkProps {
  /** The model's display name or id ("Opus 5.5", "gpt-5.5-codex"). */
  readonly model: string | null | undefined;
  /** The agent running it: its own mark stands in when the model's maker is unknown. */
  readonly agent: string;
  /** Width and height of the tile in px. Default 16. */
  readonly size?: number;
  readonly className?: string;
}

/**
 * The mark of the company whose model is working (modelMakers.ts), on the same tile as the agent
 * marks, so a vendor mark keeps its clear space and its own colours in both themes. Decorative:
 * the agent's name or the model's sits beside it. Without a known maker it is the agent's mark.
 */
export function ModelMark({ model, agent, size = 16, className }: ModelMarkProps) {
  const maker = modelMaker(model, agent);
  if (!maker) return <AgentMark agent={agent} size={size} className={className} />;
  const box = Math.max(12, Math.min(64, Math.round(size)));
  return (
    <span
      className={["g-agent-mark", "g-model-mark", className].filter(Boolean).join(" ")}
      data-logo=""
      data-maker={maker.id}
      title={maker.name}
      aria-hidden="true"
      style={{
        width: `${box}px`,
        height: `${box}px`,
        borderRadius: `${Math.max(3, Math.round(box * 0.22))}px`,
      }}
    >
      <LogoDrawing logo={maker.logo} size={logoSide(box)} className="g-agent-mark-logo" />
    </span>
  );
}
