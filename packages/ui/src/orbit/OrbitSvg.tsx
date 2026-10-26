import type { Ref } from "react";
import {
  bodyRadius,
  type MarkFrame,
  orbitArc,
  orbitPoint,
  SMALL_MARK,
  satelliteSide,
  signatureOf,
} from "./geometry";

const TAU = Math.PI * 2;

export interface OrbitSvgProps {
  readonly agent: string;
  readonly size: number;
  readonly surface?: string;
  readonly ghost?: boolean;
  readonly label?: string;
  readonly className?: string;
  readonly draw?: boolean;
  readonly reduced?: boolean;
  readonly elementRef?: Ref<SVGSVGElement>;
  readonly frame: MarkFrame;
}

export function OrbitSvg({
  agent,
  size,
  surface = "var(--o-pane)",
  ghost = false,
  label,
  className,
  draw = false,
  frame,
  reduced = false,
  elementRef,
}: OrbitSvgProps) {
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
      ref={elementRef}
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
