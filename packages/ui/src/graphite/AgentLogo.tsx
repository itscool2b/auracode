import { createElement } from "react";
import { type AgentLogo as AgentLogoData, agentLogo, type LogoShape } from "./agentLogos";

export interface AgentLogoProps {
  /** Agent id or alias. An agent without a published mark renders nothing. */
  readonly agent: string;
  /** Width and height of the square box in px. Default 16. */
  readonly size?: number;
  readonly className?: string;
  /** Accessible name; without one the mark is decorative (the agent's name sits beside it). */
  readonly label?: string;
}

/** SVG attribute names as React spells them; the stored files use only these. */
const REACT_NAMES: Readonly<Record<string, string>> = {
  d: "d",
  fill: "fill",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
  opacity: "opacity",
  cx: "cx",
  cy: "cy",
  r: "r",
  rx: "rx",
  ry: "ry",
  x: "x",
  y: "y",
  width: "width",
  height: "height",
  points: "points",
};

function shapeElement(shape: LogoShape, key: number) {
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(shape.attributes)) {
    const prop = REACT_NAMES[name];
    if (prop) props[prop] = value;
  }
  return createElement(shape.tag, props);
}

/**
 * The viewBox that draws the mark at its optical scale, centred in a square: the stored box
 * widened evenly, so the shapes themselves are never moved, stretched or redrawn.
 */
export function logoViewBox(logo: Pick<AgentLogoData, "viewBox" | "scale" | "turn">): string {
  const [x = 0, y = 0, w = 1, h = 1] = (logo.turn?.frame ?? logo.viewBox).split(" ").map(Number);
  const side = Math.max(w, h) / logo.scale;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [x - (side - w) / 2, y - (side - h) / 2, side, side].map(round).join(" ");
}

/** A whole-mark turn about the stored viewBox's centre, for a mark its maker shows turned. */
function turnTransform(viewBox: string, angle: number): string {
  const [x = 0, y = 0, w = 1, h = 1] = viewBox.split(" ").map(Number);
  return `rotate(${angle} ${x + w / 2} ${y + h / 2})`;
}

/** A logo's drawing in a square box: used by AgentLogo and inside AgentMark's tile. */
export function LogoDrawing({
  logo,
  size,
  className,
  label,
}: {
  readonly logo: AgentLogoData;
  readonly size: number;
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={logoViewBox(logo)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-agent-logo={logo.id}
    >
      {logo.turn ? (
        <g transform={turnTransform(logo.viewBox, logo.turn.angle)}>
          {logo.shapes.map(shapeElement)}
        </g>
      ) : (
        logo.shapes.map(shapeElement)
      )}
    </svg>
  );
}

/**
 * An agent's own published mark, alone (third-party/brand-marks.md): its shapes and colours as the
 * vendor publishes them, centred at its optical scale. Null for an agent without one; AgentMark is
 * the tile that always shows something.
 */
export function AgentLogo({ agent, size = 16, className, label }: AgentLogoProps) {
  const logo = agentLogo(agent);
  if (!logo) return null;
  const box = Number.isFinite(size) ? Math.max(8, Math.min(512, Math.round(size))) : 16;
  return (
    <LogoDrawing
      logo={logo}
      size={box}
      className={className ? `g-agent-logo ${className}` : "g-agent-logo"}
      label={label}
    />
  );
}
