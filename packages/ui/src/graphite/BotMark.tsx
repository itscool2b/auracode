import { LogoDrawing } from "./AgentLogo";
import { logoSide } from "./AgentMark";
import { agentLogo } from "./agentLogos";
import openclaw from "./bot-logos/openclaw.svg?raw";
import { BOTS, type BotId } from "./bots";
import { MODEL_MAKERS } from "./modelMakers";

export interface BotMarkProps {
  readonly bot: BotId;
  /** Width and height of the tile in px. Default 36. */
  readonly size?: number;
  readonly className?: string;
}

/** OpenClaw's mark is drawn with a gradient, so it is shown as the image it is published as. */
const OPENCLAW = `data:image/svg+xml,${encodeURIComponent(openclaw)}`;

/**
 * The mark of an assistant that can be linked as a bot, on the same tile as the agent marks, so
 * a vendor mark keeps its clear space and its own colours in both appearances. Decorative: the
 * assistant's name sits beside it. Grok Bot and Hermes wear the marks already stored for xAI's and
 * Nous Research's coding agents (and their tiles' plates), and Muse wears Meta's.
 */
export function BotMark({ bot, size = 36, className }: BotMarkProps) {
  const box = Math.max(12, Math.min(64, Math.round(size)));
  const name = BOTS.find((kind) => kind.id === bot)?.name ?? "";
  const logo =
    bot === "muse" ? MODEL_MAKERS.meta?.logo : bot === "openclaw" ? undefined : agentLogo(bot);
  const stored = bot === "grok" || bot === "hermes";
  return (
    <span
      className={["g-agent-mark", "g-model-mark", className].filter(Boolean).join(" ")}
      data-logo=""
      data-bot={bot}
      data-agent={stored ? bot : undefined}
      data-state={stored ? "idle" : undefined}
      title={name}
      aria-hidden="true"
      style={{
        width: `${box}px`,
        height: `${box}px`,
        borderRadius: `${Math.max(3, Math.round(box * 0.22))}px`,
      }}
    >
      {logo ? (
        <LogoDrawing logo={logo} size={logoSide(box)} className="g-agent-mark-logo" />
      ) : (
        <img
          className="g-agent-mark-logo"
          src={OPENCLAW}
          alt=""
          width={logoSide(box)}
          height={logoSide(box)}
          draggable={false}
        />
      )}
    </span>
  );
}
