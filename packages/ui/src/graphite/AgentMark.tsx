import { type CSSProperties, useRef } from "react";
import { type AgentBrandId, getBrand } from "../brand";
import { ORB_STATE_LABELS, type OrbState } from "../orb/states";
import { LogoDrawing } from "./AgentLogo";
import { agentLogo } from "./agentLogos";
import { LoaderCells, type LoaderTempo, useLoaderSteps } from "./PixelLoader";
import { centredSquare, checkRects } from "./pixels";

export interface AgentMarkProps {
  readonly agent: string;
  readonly state?: OrbState;
  readonly size?: number;
  readonly label?: string;
  /** Not installed or turned off: a dashed, empty tile. */
  readonly ghost?: boolean;
  readonly className?: string;
}

/** Two-letter codes for the agents with a designed brand; they never collide. */
const AGENT_CODES: Readonly<Record<Exclude<AgentBrandId, "generic">, string>> = {
  "claude-code": "CC",
  codex: "CX",
  pi: "PI",
  "oh-my-pi": "MP",
  antigravity: "AG",
  hermes: "HM",
  cursor: "CU",
  grok: "GB",
  opencode: "OC",
};

/**
 * An agent's two-letter code: CC Claude Code, CX Codex, PI Pi, MP oh-my-pi, AG Antigravity,
 * HM Hermes, CU Cursor, GB Grok Build, OC OpenCode. Any other agent takes the first two letters of
 * its id; an empty or "generic" id is "?".
 */
export function agentCode(agent: string): string {
  const brand = getBrand(agent);
  if (brand.id !== "generic") return AGENT_CODES[brand.id];
  const letters = (typeof agent === "string" ? agent : "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toUpperCase();
  if (letters.length === 0 || letters === "GENERIC") return "?";
  return Array.from(letters).slice(0, 2).join("");
}

/**
 * The square a logo is drawn in inside a tile of `size`, centred on whole pixels: an even margin of
 * 2px up to 16 (12 in 16), then about a sixth of the tile (16 in 24, 22 in 32), so small marks stay
 * legible and every mark keeps clear space inside the ring.
 */
export function logoSide(size: number): number {
  const margin = size <= 16 ? 2 : Math.round(size * 0.17);
  return size - 2 * margin;
}

type Indicator = "glyph" | "loader" | "waiting" | "done" | "error";

const TEMPO: Partial<Record<OrbState, LoaderTempo>> = {
  thinking: "thinking",
  streaming: "streaming",
  tool: "tool",
};

function indicatorOf(state: OrbState): Indicator {
  switch (state) {
    case "thinking":
    case "streaming":
    case "tool":
      return "loader";
    case "waiting":
      return "waiting";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "glyph";
  }
}

/**
 * An agent's identity and live state in one square tile. Idle, it shows the agent's own published
 * logo (agentLogos.ts), or its two-letter code when it has none; any other state takes that place
 * (the name always sits beside the mark): a walking 2x3 loader while it works, a volt dot while it
 * waits on you, a white pixel check once done, a red dot when it failed. A ghost (not installed)
 * dims the logo or the code in a dashed tile. No canvas. Idle, hidden, offscreen and
 * reduced-motion marks own no animation frame.
 */
export function AgentMark({
  agent,
  state = "idle",
  size = 24,
  label,
  ghost = false,
  className,
}: AgentMarkProps) {
  const brand = getBrand(agent);
  const box = Number.isFinite(size) ? Math.max(12, Math.min(256, Math.round(size))) : 24;
  const known: OrbState = Object.hasOwn(ORB_STATE_LABELS, state) ? state : "idle";
  const indicator: Indicator = ghost ? "glyph" : indicatorOf(known);
  const tempo = TEMPO[known] ?? "tool";
  const svg = useRef<SVGSVGElement>(null);
  useLoaderSteps(svg, indicator === "loader", tempo, "neutral");

  const logo = agentLogo(agent);
  const style: CSSProperties = {
    width: `${box}px`,
    height: `${box}px`,
    borderRadius: `${Math.max(3, Math.round(box * 0.22))}px`,
  };
  // The full code at every size: one letter would make Claude Code and Codex both "C".
  const glyph = logo ? "" : agentCode(agent);
  if (!logo) {
    const fontSize =
      glyph.length > 1
        ? Math.max(7, Math.round(box * (box < 24 ? 0.5 : 0.38)))
        : Math.round(box * 0.56);
    style.fontSize = `${fontSize}px`;
    // Below 12px a 500 stem drops under one device pixel on a 1x screen; 600 keeps it whole.
    style.fontWeight = fontSize < 12 ? 600 : 500;
  }
  const names = ["g-agent-mark", className ?? null].filter(Boolean);

  return (
    <span
      className={names.join(" ")}
      role="img"
      aria-label={label ?? `${brand.name}, ${ORB_STATE_LABELS[known]}`}
      data-agent={brand.id}
      data-state={known}
      data-ghost={ghost ? "" : undefined}
      data-logo={logo ? "" : undefined}
      style={style}
    >
      {indicator === "glyph" ? (
        logo ? (
          <LogoDrawing logo={logo} size={logoSide(box)} className="g-agent-mark-logo" />
        ) : (
          <span className="g-agent-mark-glyph" aria-hidden="true">
            {glyph}
          </span>
        )
      ) : (
        <svg
          ref={svg}
          className="g-agent-mark-state"
          width={box}
          height={box}
          viewBox={`0 0 ${box} ${box}`}
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <StateShape indicator={indicator} size={box} />
        </svg>
      )}
    </span>
  );
}

function StateShape({ indicator, size }: { readonly indicator: Indicator; readonly size: number }) {
  if (indicator === "loader") return <LoaderCells size={size} tone="neutral" />;
  if (indicator === "done") {
    return (
      <>
        {checkRects(size).map((rect, i) => (
          <rect
            key={`${rect.x}-${rect.y}`}
            className="g-agent-mark-check"
            style={{ animationDelay: `${i * 50}ms` }}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
          />
        ))}
      </>
    );
  }
  // A status dot, centred on whole pixels: the even-parity box of the old square, as a circle.
  const box = centredSquare(size, 0.375);
  return (
    <circle
      className={indicator === "waiting" ? "g-agent-mark-waiting" : "g-agent-mark-error"}
      cx={box.x + box.w / 2}
      cy={box.y + box.h / 2}
      r={box.w / 2}
      shapeRendering="geometricPrecision"
    />
  );
}
