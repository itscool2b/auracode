import { memo, useMemo } from "react";
import { ORBIT_DRAW_MS } from "../../fixture/discovery";
import { seededRandom } from "../../fixture/timeline";
import type { DiscoveredAgent, DiscoveryModel } from "../../kit";
import { type OrbitSignature, signatureOf } from "./geometry";

/*
 * The globe (visual-language.md 5.7), after SpaceXAI's careers globe: a calm, solid tonal sphere one
 * value step above the black panel, a sparse graticule instead of coastlines (the map is not ours to
 * copy), square markers and mono labels with their data lines. Every agent flies its signature orbit
 * around it, staggered from 1.18 to 1.62 globe radii, in a quiet line. As the scan finds an agent its
 * orbit draws in and its satellite settles; missing agents get a dashed orbit and a hollow square.
 * Each label sits on a black plate 16px out along its orbit's outward normal, so no line ever runs
 * through text. Positions are pure functions of the playhead, so a frozen frame is always the same.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DRAW_MS = ORBIT_DRAW_MS;
/** How long a found agent's satellite takes to land at its parked point, ms. */
const LAND_MS = 240;
/** The globe leans its north pole toward the viewer, so parallels read as arcs on a sphere. */
const VIEW_LATITUDE = 18 * DEG;
/** Satellites: 12px squares (SpaceXAI's markers). */
const SATELLITE = 12;
/** Labels: Geist Mono 13px, +0.04em, 16px lines. Geist Mono's advance is 0.6em. */
const LABEL_SIZE = 13;
const LABEL_LINE = 16;
const LABEL_CHAR = LABEL_SIZE * (0.6 + 0.04);
/** How far a label sits from its satellite, along the orbit's outward normal. */
const LABEL_GAP = 16;

/**
 * Where each agent's satellite rests (degrees along its own orbit). Chosen by searching every
 * combination for the one where no label touches another label, a satellite, the sphere or the
 * panel's edges, in the full panel and in a narrow one, with the labels spread around the globe:
 * Claude Code and Antigravity to the left, Codex, Hermes and Cursor to the right, Pi above and
 * Grok Build below.
 */
const PARK: Readonly<Record<string, number>> = {
  "claude-code": -180,
  codex: -15,
  pi: -25,
  antigravity: -180,
  hermes: 30,
  cursor: 35,
  grok: -45,
  opencode: 160,
  "oh-my-pi": 188,
};

interface GlobeOrbit {
  readonly a: number;
  readonly b: number;
  readonly tilt: number;
  readonly shift: number;
}

function globeOrbit(
  signature: OrbitSignature,
  radius: number,
  index: number,
  count: number,
): GlobeOrbit {
  const a = radius * (1.18 + (count > 1 ? (index / (count - 1)) * 0.44 : 0));
  return {
    a,
    b: signature.kind === "ring" ? a : a * signature.k,
    tilt: signature.tilt * DEG,
    shift: signature.a > 0 ? a * (signature.shift / signature.a) : 0,
  };
}

function point(orbit: GlobeOrbit, angle: number, cx: number, cy: number) {
  const ex = orbit.a * Math.cos(angle) + orbit.shift;
  const ey = orbit.b * Math.sin(angle);
  return {
    x: cx + ex * Math.cos(orbit.tilt) - ey * Math.sin(orbit.tilt),
    y: cy - (ex * Math.sin(orbit.tilt) + ey * Math.cos(orbit.tilt)),
  };
}

/** The orbit's outward unit normal at `angle`, in screen space (y down). */
function normal(orbit: GlobeOrbit, angle: number) {
  // The gradient of (x/a)^2 + (y/b)^2 in the orbit's own frame, then turned and flipped.
  const nx = Math.cos(angle) / orbit.a;
  const ny = Math.sin(angle) / orbit.b;
  const length = Math.hypot(nx, ny) || 1;
  const ux = nx / length;
  const uy = ny / length;
  return {
    x: ux * Math.cos(orbit.tilt) - uy * Math.sin(orbit.tilt),
    y: -(ux * Math.sin(orbit.tilt) + uy * Math.cos(orbit.tilt)),
  };
}

function arc(orbit: GlobeOrbit, from: number, to: number, cx: number, cy: number): string {
  const steps = 96;
  const parts: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const p = point(orbit, from + ((to - from) * index) / steps, cx, cy);
    parts.push(`${index === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  return parts.join(" ");
}

/**
 * A line of latitude or longitude on the sphere, front side only, as a path. `at` gives the point
 * for a parameter from 0 to 1 as latitude and longitude (radians, longitude already turned).
 */
function onSphere(
  at: (u: number) => { readonly lat: number; readonly lon: number },
  radius: number,
  cx: number,
  cy: number,
): string {
  const parts: string[] = [];
  let drawing = false;
  for (let index = 0; index <= 96; index += 1) {
    const { lat, lon } = at(index / 96);
    // Orthographic projection, seen from VIEW_LATITUDE above the equator.
    const depth =
      Math.sin(VIEW_LATITUDE) * Math.sin(lat) +
      Math.cos(VIEW_LATITUDE) * Math.cos(lat) * Math.cos(lon);
    if (depth < 0) {
      drawing = false;
      continue;
    }
    const x = cx + radius * Math.cos(lat) * Math.sin(lon);
    const y =
      cy -
      radius *
        (Math.cos(VIEW_LATITUDE) * Math.sin(lat) -
          Math.sin(VIEW_LATITUDE) * Math.cos(lat) * Math.cos(lon));
    parts.push(`${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
    drawing = true;
  }
  return parts.join(" ");
}

function Stars({ width, height }: { readonly width: number; readonly height: number }) {
  const stars = useMemo(() => {
    const random = seededRandom("orbit:night");
    const count = Math.round((width * height) / 6000);
    return Array.from({ length: count }, (_, id) => ({
      id,
      x: random() * width,
      y: random() * height,
      size: random() < 0.82 ? 1 : 2,
      alpha: 0.1 + random() * 0.3,
    }));
  }, [width, height]);
  return (
    <g className="o-stars">
      {stars.map((star) => (
        <rect
          key={star.id}
          x={star.x}
          y={star.y}
          width={star.size}
          height={star.size}
          fill={`rgb(255 255 255 / ${star.alpha.toFixed(2)})`}
        />
      ))}
    </g>
  );
}

/**
 * A label's lines: the name, the version or what it needs, and where the binary lives (SpaceXAI's
 * city, latitude and longitude). A narrow panel drops the path, which the roster beside it shows.
 */
export function labelLines(
  agent: DiscoveredAgent,
  compact = false,
): readonly {
  readonly text: string;
  readonly tone: "name" | "data" | "signal" | "path";
}[] {
  const name = { text: agent.name.toUpperCase(), tone: "name" as const };
  if (agent.status === "missing") return [name, { text: "NOT INSTALLED", tone: "data" }];
  const lines: { text: string; tone: "name" | "data" | "signal" | "path" }[] = [name];
  if (agent.signedIn === false) lines.push({ text: "SIGN IN", tone: "signal" });
  else if (agent.version) lines.push({ text: agent.version, tone: "data" });
  if (agent.path && !compact) lines.push({ text: agent.path, tone: "path" });
  return lines;
}

function Label({
  agent,
  x,
  y,
  direction,
  opacity,
  compact,
}: {
  readonly agent: DiscoveredAgent;
  readonly compact: boolean;
  /** The satellite's centre. */
  readonly x: number;
  readonly y: number;
  /** The orbit's outward normal at the satellite: the label opens this way. */
  readonly direction: { readonly x: number; readonly y: number };
  readonly opacity: number;
}) {
  const lines = labelLines(agent, compact);
  const width = Math.max(...lines.map((line) => line.text.length)) * LABEL_CHAR;
  const height = lines.length * LABEL_LINE;
  const anchorX = x + direction.x * (LABEL_GAP + SATELLITE / 2);
  const anchorY = y + direction.y * (LABEL_GAP + SATELLITE / 2);
  // Open to the side the normal points to; vertically, hang below, sit above or centre on it.
  const left = direction.x >= 0 ? anchorX : anchorX - width;
  const top =
    direction.y > 0.55
      ? anchorY
      : direction.y < -0.55
        ? anchorY - height
        : anchorY - LABEL_LINE / 2 - (direction.y < 0 ? height - LABEL_LINE : 0);
  return (
    <g className="o-globe-label" opacity={opacity}>
      <rect
        className="o-globe-plate"
        x={left - 4}
        y={top - 2}
        width={width + 8}
        height={height + 4}
      />
      {lines.map((line, index) => (
        <text
          key={line.tone + line.text}
          className="o-globe-text"
          data-tone={line.tone}
          x={left}
          y={top + index * LABEL_LINE + 12}
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

/** A project landed on the surface (onboarding step 4) and the arcs from it to the agents. */
export interface GlobeProject {
  readonly name: string;
  readonly path: string;
}

export const Globe = memo(function Globe({
  discovery,
  t,
  width,
  height,
  reduced,
  project = null,
}: {
  readonly discovery: DiscoveryModel;
  readonly t: number;
  readonly width: number;
  readonly height: number;
  readonly reduced: boolean;
  readonly project?: GlobeProject | null;
}) {
  // The globe fills the night panel: R is a fifth of the panel's shorter side, and the orbits,
  // staggered out to 1.62 R, span about three fifths of it. It sits left of centre, so the labels on
  // the right have as much room from the panel's edge as the ones on the left.
  const radius = Math.round(Math.min(width, height) * 0.2);
  const cx = Math.round(width / 2 - Math.min(56, width * 0.06));
  const cy = Math.round(height / 2 - 12);
  // One revolution per 120s while the scan runs; still once it is done (and under reduced motion).
  const turnAt = discovery.status === "done" ? (discovery.finishedAt ?? t) : t;
  const rotation = reduced ? 0 : ((turnAt / 120_000) * TAU) % TAU;
  const agents = discovery.agents;
  const orbits = agents.map((agent, index) => ({
    agent,
    signature: signatureOf(agent.id),
    orbit: globeOrbit(signatureOf(agent.id), radius, index, agents.length),
  }));
  const drawn = (agent: DiscoveredAgent): number => {
    if (agent.status === "looking" || agent.at === null) return 0;
    if (reduced) return 1;
    return Math.min(1, Math.max(0, (t - agent.at) / DRAW_MS));
  };
  // A satellite lands as soon as its agent is found: it fades in while it slides the last 30
  // degrees along its orbit into its parked point; the orbit line draws in behind it.
  const landing = (agent: DiscoveredAgent): number => {
    if (agent.status === "looking" || agent.at === null) return 0;
    if (reduced) return 1;
    return Math.min(1, Math.max(0, (t - agent.at) / LAND_MS));
  };
  const visible = orbits.filter(({ agent }) => drawn(agent) > 0);
  // A sparse graticule: the equator, the 30 degree parallels and four meridians.
  const parallels = [-30, 0, 30].map((lat) =>
    onSphere((u) => ({ lat: lat * DEG, lon: u * TAU }), radius, cx, cy),
  );
  const meridians = [0, 45, 90, 135].map((lon) =>
    onSphere((u) => ({ lat: -Math.PI / 2 + u * TAU, lon: lon * DEG + rotation }), radius, cx, cy),
  );

  const orbitPath = (entry: (typeof orbits)[number], half: "far" | "near") => {
    const progress = drawn(entry.agent);
    const ring = entry.signature.kind === "ring";
    if (ring && half === "far") return null;
    const [from, to] = ring ? [0, TAU] : half === "far" ? [0, Math.PI] : [Math.PI, TAU];
    const missing = entry.agent.status === "missing";
    return (
      <path
        key={`${entry.agent.id}-${half}`}
        className="o-globe-orbit"
        data-missing={missing ? "" : undefined}
        d={arc(entry.orbit, from, to, cx, cy)}
        pathLength={missing ? undefined : 1}
        strokeDasharray={missing ? undefined : "1 1"}
        strokeDashoffset={missing ? undefined : 1 - progress}
        opacity={missing ? Math.min(1, progress * 2) : 1}
      />
    );
  };

  // The project marker: on the sphere's surface, up and left of centre, facing the viewer.
  const marker = project ? { x: cx - radius * 0.34, y: cy - radius * 0.22 } : null;
  const ready = visible.filter(
    (entry) => entry.agent.status === "found" && entry.agent.signedIn !== false,
  );

  return (
    <svg
      className="o-globe"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Agents found: ${
        agents
          .filter((agent) => agent.status === "found")
          .map((agent) => agent.name)
          .join(", ") || "none yet"
      }`}
    >
      <Stars width={width} height={height} />
      {visible.map((entry) => orbitPath(entry, "far"))}
      <circle className="o-globe-body" cx={cx} cy={cy} r={radius} />
      <g className="o-globe-grid">
        {[...parallels, ...meridians].map((d, index) =>
          d ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the graticule's lines are positional.
            <path key={index} d={d} />
          ) : null,
        )}
      </g>
      {visible.map((entry) => orbitPath(entry, "near"))}
      {marker
        ? ready.map((entry, index) => {
            const park = (PARK[entry.agent.id] ?? 40) * DEG;
            const to = point(entry.orbit, park, cx, cy);
            // A great-circle arc lifted off the surface: a quadratic curve bowed away from the centre.
            const mx = (marker.x + to.x) / 2;
            const my = (marker.y + to.y) / 2;
            const lift = 0.35 * Math.hypot(to.x - marker.x, to.y - marker.y);
            const away = Math.atan2(my - cy, mx - cx);
            const qx = mx + Math.cos(away) * lift;
            const qy = my + Math.sin(away) * lift;
            return (
              <path
                key={`arc-${entry.agent.id}`}
                className="o-globe-arc"
                d={`M${marker.x.toFixed(1)} ${marker.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`}
                pathLength={1}
                style={{ animationDelay: `${index * 60}ms` }}
              />
            );
          })
        : null}
      {visible.map((entry) => {
        const land = landing(entry.agent);
        const eased = 1 - (1 - land) ** 3;
        const park = (PARK[entry.agent.id] ?? 40) * DEG;
        const approach = park - entry.signature.direction * (1 - eased) * 30 * DEG;
        const p = point(entry.orbit, approach, cx, cy);
        const missing = entry.agent.status === "missing";
        const needsSignIn = entry.agent.status === "found" && entry.agent.signedIn === false;
        return (
          <g key={`${entry.agent.id}-sat`}>
            <rect
              className="o-globe-sat"
              data-tone={needsSignIn ? "signal" : missing ? "hollow" : undefined}
              x={p.x - SATELLITE / 2}
              y={p.y - SATELLITE / 2}
              width={SATELLITE}
              height={SATELLITE}
              opacity={eased}
              transform={needsSignIn ? `rotate(45 ${p.x} ${p.y})` : undefined}
            />
            <Label
              agent={entry.agent}
              x={p.x}
              y={p.y}
              direction={normal(entry.orbit, park)}
              opacity={eased}
              compact={width < 700}
            />
          </g>
        );
      })}
      {marker && project ? (
        <g className="o-globe-project">
          <rect
            className="o-globe-marker"
            x={marker.x - 6}
            y={marker.y - 6}
            width={12}
            height={12}
          />
          <rect
            className="o-globe-plate"
            x={marker.x - 4 - Math.max(project.name.length, project.path.length) * LABEL_CHAR - 16}
            y={marker.y - LABEL_LINE - 2}
            width={Math.max(project.name.length, project.path.length) * LABEL_CHAR + 8}
            height={LABEL_LINE * 2 + 4}
          />
          <text
            className="o-globe-text"
            data-tone="name"
            x={marker.x - 16}
            y={marker.y - 4}
            textAnchor="end"
          >
            {project.name.toUpperCase()}
          </text>
          <text
            className="o-globe-text"
            data-tone="path"
            x={marker.x - 16}
            y={marker.y + 12}
            textAnchor="end"
          >
            {project.path}
          </text>
        </g>
      ) : null}
    </svg>
  );
});
