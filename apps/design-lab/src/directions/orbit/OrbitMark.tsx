import type { OrbState } from "@auracode/ui";
import { memo } from "react";
import { type Player, usePlayhead } from "../../kit";
import {
  bodyRadius,
  type MarkFrame,
  type MarkTimeline,
  markFrame,
  orbitArc,
  orbitPoint,
  SMALL_MARK,
  satelliteSide,
  signatureOf,
} from "./geometry";
import { useReduced } from "./ui";

/*
 * The Orbit mark (visual-language.md, section 5): the agent's own orbit, a node at its centre and a
 * square satellite, drawn the way X draws its orbital hairlines (a line, a node, a square), not as
 * a planet. Inline SVG, no glow, no blur. Below 48px the node is a filled dot and the orbit a
 * 1.25px line at 14 and 16px, so a small mark reads as a line around a node; from 48px the node is
 * hollow, filled with the surface beneath, and the far half of the orbit is the X Card's dashed
 * arc. There is no graticule below the 220px globe.
 */

const TAU = Math.PI * 2;

/** A timeline holding one state since long ago: a still mark showing that state. */
function stillTimeline(state: OrbState): MarkTimeline {
  if (state === "idle") return { segments: [], ripples: [], streamedChars: 0 };
  return { segments: [{ from: -1e9, to: null, state }], ripples: [], streamedChars: 0 };
}

const STILL: Readonly<Record<OrbState, MarkTimeline>> = {
  idle: stillTimeline("idle"),
  thinking: stillTimeline("thinking"),
  streaming: stillTimeline("streaming"),
  tool: stillTimeline("tool"),
  waiting: stillTimeline("waiting"),
  error: stillTimeline("error"),
  done: stillTimeline("idle"),
};

export interface OrbitMarkProps {
  readonly agent: string;
  readonly size: number;
  /** The surface under the mark, which fills the body so the far side passes behind it. */
  readonly surface?: string;
  /** A still state (default idle). Ignored when `live` is given. */
  readonly state?: OrbState;
  /** A live mark: the turn's activity and the player whose playhead moves it. */
  readonly live?: { readonly timeline: MarkTimeline; readonly player: Player };
  /** A missing agent: every stroke faint, the orbit dashed, the satellite hollow. */
  readonly ghost?: boolean;
  /** The accessible name: the state as a sentence ("Claude Code, running pnpm test"). */
  readonly label?: string;
  readonly className?: string;
  /**
   * Draw the orbit in when the mark mounts (stroke-dashoffset, 400ms): the empty state's agent
   * switch. Key the mark on the agent so a new agent draws its own orbit. Skipped under reduced
   * motion.
   */
  readonly draw?: boolean;
}

/** An Orbit mark: live when given a timeline and a player, still otherwise. */
export function OrbitMark(props: OrbitMarkProps) {
  if (props.live) return <LiveMark {...props} live={props.live} />;
  return <StillMark {...props} />;
}

const StillMark = memo(function StillMark(props: OrbitMarkProps) {
  const reduced = useReduced();
  const signature = signatureOf(props.agent);
  const frame = markFrame(signature, STILL[props.state ?? "idle"], 0, props.size, reduced);
  return <MarkSvg {...props} frame={frame} />;
});

/**
 * The playhead step a live mark reads: one frame. A step keeps the snapshot stable between React's
 * two reads in one render (a raw, moving clock would never settle), and 16ms is smooth enough.
 */
export const FRAME_MS = 16;

function LiveMark(props: OrbitMarkProps & { readonly live: NonNullable<OrbitMarkProps["live"]> }) {
  const reduced = useReduced();
  const t = usePlayhead(props.live.player, FRAME_MS);
  const frame = markFrame(signatureOf(props.agent), props.live.timeline, t, props.size, reduced);
  return <MarkSvg {...props} frame={frame} />;
}

function MarkSvg({
  agent,
  size,
  surface = "var(--o-pane)",
  ghost = false,
  label,
  className,
  draw = false,
  frame,
}: OrbitMarkProps & { readonly frame: MarkFrame }) {
  const reduced = useReduced();
  const signature = signatureOf(agent);
  const small = size < SMALL_MARK;
  const r = bodyRadius(size);
  const c = size / 2;
  const side = satelliteSide(size);
  const ring = signature.kind === "ring";
  const dashedOrbit = ghost || signature.unknown || frame.orbitDashed;
  const orbitTone = ghost ? "text-4" : frame.orbitTone;
  const far = ring ? "" : orbitArc(signature, 0, Math.PI, size);
  const near = ring ? "" : orbitArc(signature, Math.PI, TAU, size);
  const full = ring ? orbitArc(signature, 0, TAU, size) : "";
  const hollow = ghost || signature.unknown;
  // A waiting satellite has left its orbit's twin behind: oh-my-pi's pair shows one diamond.
  const satellites =
    signature.satellites === 2 && !frame.diamond
      ? [frame, { ...frame, ...orbitPoint(signature, frame.angle + Math.PI, size) }]
      : [frame];
  // From 48px the far half reads as passing behind: the X Card's dashed arc.
  const farDashed = size >= 48 && !ring && !dashedOrbit;
  const orbitProps = {
    className: "o-mark-orbit",
    "data-tone": orbitTone,
    "data-dashed": dashedOrbit ? (frame.orbitDashed && !ghost ? "error" : "dash") : undefined,
  } as const;
  // The done check replaces the node while it shows, so it can be drawn at a legible size.
  const check = size * (small ? 0.3 : 0.24);
  // A small node is a dot of the body's tone; a large one is hollow, filled with the surface.
  const bodyFill = small ? (ghost ? "var(--o-text-4)" : "var(--o-text-2)") : surface;
  const drawing = draw && !reduced;

  const satellite = (point: { x: number; y: number }, key: string) => (
    <rect
      key={key}
      className="o-mark-sat"
      data-tone={ghost ? "ghost" : frame.satelliteTone}
      data-hollow={hollow ? "" : undefined}
      x={point.x - side / 2}
      y={point.y - side / 2}
      width={side}
      height={side}
      transform={frame.diamond ? `rotate(45 ${point.x} ${point.y})` : undefined}
    />
  );

  // The 90 degrees behind a fast satellite, brightest at the satellite, in six fading steps.
  const trail =
    frame.trail && !ghost
      ? [0, 1, 2, 3, 4, 5].map((step) => {
          const span = Math.PI / 2 / 6;
          const end = frame.angle - signature.direction * span * step;
          const start = end - signature.direction * span;
          const [from, to] = signature.direction === 1 ? [start, end] : [end, start];
          return (
            <path
              key={step}
              className="o-mark-trail"
              d={orbitArc(signature, from, to, size)}
              opacity={1 - step * 0.14}
            />
          );
        })
      : null;

  const behind = satellites.filter((point) => frame.hidden && point === frame);
  const front = satellites.filter((point) => !(frame.hidden && point === frame));

  return (
    <svg
      className={`o-mark${className ? ` ${className}` : ""}`}
      data-agent={agent}
      data-state={frame.state}
      data-ghost={ghost ? "" : undefined}
      data-small={small ? "" : undefined}
      data-fine={size <= 16 ? "" : undefined}
      data-draw={drawing ? "" : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? agent}
    >
      {ring ? (
        <path {...orbitProps} d={full} pathLength={drawing ? 1 : undefined} data-near="" />
      ) : (
        <path {...orbitProps} d={far} data-far={farDashed ? "" : undefined} />
      )}
      {behind.map((point, index) => satellite(point, `b${index}`))}
      <circle
        className="o-mark-body"
        data-ghost={ghost ? "" : undefined}
        cx={c}
        cy={c}
        r={r}
        data-node={small ? "" : undefined}
        style={{ fill: bodyFill }}
        opacity={1 - frame.checkOpacity}
      />
      {ring ? null : (
        <path {...orbitProps} d={near} pathLength={drawing ? 1 : undefined} data-near="" />
      )}
      {trail}
      {front.map((point, index) => satellite(point, `f${index}`))}
      {frame.ripple ? (
        <circle
          className="o-mark-ripple"
          data-tone={frame.ripple.tone}
          cx={frame.x}
          cy={frame.y}
          r={side / 2 + (side * 2.2 - side / 2) * frame.ripple.progress}
          opacity={0.3 * Math.sin(Math.PI * frame.ripple.progress)}
        />
      ) : null}
      {frame.checkOpacity > 0 ? (
        <path
          className="o-mark-check"
          d={`M${c - check * 0.45} ${c + check * 0.02} L${c - check * 0.1} ${c + check * 0.36} L${c + check * 0.5} ${c - check * 0.34}`}
          pathLength={24}
          strokeDasharray={24}
          strokeDashoffset={24 * (1 - frame.checkDraw)}
          opacity={frame.checkOpacity}
        />
      ) : null}
    </svg>
  );
}
