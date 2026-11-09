import type { ReactNode } from "react";
import { Words } from "../reveal";

/** An isometric slab: its top face and its thickness, drawn back to front so nearer ones cover. */
function slab(cx: number, cy: number, w: number, h: number, depth: number) {
  const top = `M${cx} ${cy - h} L${cx + w} ${cy} L${cx} ${cy + h} L${cx - w} ${cy} Z`;
  const side = `M${cx - w} ${cy} L${cx - w} ${cy + depth} L${cx} ${cy + h + depth} L${cx + w} ${cy + depth} L${cx + w} ${cy} L${cx} ${cy + h} Z`;
  return { top, side };
}

/** An isometric cube standing on (cx, cy): top face, then its two lit sides. */
function cube(cx: number, cy: number, s: number, height = s) {
  const dx = s * 0.866;
  const dy = s / 2;
  return [
    `M${cx} ${cy - height - dy} L${cx + dx} ${cy - height} L${cx} ${cy - height + dy} L${cx - dx} ${cy - height} Z`,
    `M${cx - dx} ${cy - height} L${cx} ${cy - height + dy} L${cx} ${cy + dy} L${cx - dx} ${cy} Z`,
    `M${cx} ${cy - height + dy} L${cx + dx} ${cy - height} L${cx + dx} ${cy} L${cx} ${cy + dy} Z`,
  ];
}

function Line({ d, fill = false }: { d: string; fill?: boolean }) {
  return <path className={fill ? "art-line art-face" : "art-line"} d={d} pathLength={1} />;
}

/** Your machine: three slabs of what stays local, the top one holding the app. */
function LocalArt() {
  const slabs = [slab(160, 150, 112, 56, 8), slab(160, 112, 112, 56, 8), slab(160, 74, 112, 56, 8)];
  return (
    <>
      {slabs.map((part) => (
        <g key={part.top}>
          <Line d={part.side} fill />
          <Line d={part.top} fill />
        </g>
      ))}
      <Line d="M160 52 L204 74 L160 96 L116 74 Z" />
      <Line d="M138 74 L160 63 L182 74 L160 85 Z" />
      <circle className="art-dot" cx="160" cy="74" r="2.5" />
    </>
  );
}

/** Every agent, one chat: a plate in the middle, the agents around it, each wired to it. */
function AgentsArt() {
  const center = { x: 160, y: 104 };
  const around = [
    { x: 64, y: 82 },
    { x: 112, y: 46 },
    { x: 208, y: 46 },
    { x: 256, y: 82 },
    { x: 214, y: 150 },
    { x: 106, y: 150 },
  ];
  const plate = slab(center.x, center.y, 46, 23, 6);
  return (
    <>
      {around.map((point) => (
        <Line key={`wire-${point.x}`} d={`M${center.x} ${center.y} L${point.x} ${point.y}`} />
      ))}
      <Line d={plate.side} fill />
      <Line d={plate.top} fill />
      <Line d="M160 92 L172 98 L160 104 L148 98 Z" />
      {around.map((point) =>
        cube(point.x, point.y + 8, 13).map((d) => <Line key={`${point.x}-${d}`} d={d} fill />),
      )}
    </>
  );
}

/** Changes in view: work stacking up step by step, each column a turn that kept going. */
function TurnsArt() {
  const steps = [
    { x: 70, y: 168, h: 20 },
    { x: 118, y: 144, h: 38 },
    { x: 166, y: 120, h: 56 },
    { x: 214, y: 96, h: 74 },
    { x: 262, y: 72, h: 92 },
  ];
  return (
    <>
      <Line d="M40 183 L292 57" />
      {steps.map((step) =>
        cube(step.x, step.y, 15, step.h).map((d) => <Line key={`${step.x}-${d}`} d={d} fill />),
      )}
    </>
  );
}

const PILLARS: readonly { id: string; art: ReactNode; title: string; text: string }[] = [
  {
    id: "local",
    art: <LocalArt />,
    title: "Local by default.",
    text: "Chats, history and your agents' sign-ins stay on your computer. Agents run through their own command-line tools.",
  },
  {
    id: "agents",
    art: <AgentsArt />,
    title: "Every agent, one chat.",
    text: "Hand a conversation from one agent to the next, or open any of them in its own terminal, without losing the thread.",
  },
  {
    id: "turns",
    art: <TurnsArt />,
    title: "Every change in view.",
    text: "Queue the next message, steer a turn while it runs, and review or revert each change file by file.",
  },
];

/**
 * What auracode is, said once and large: the first sentence in ink, the rest stepping back to
 * grey. Below it, the three things it holds to, each drawn in hairlines that trace themselves in
 * as they scroll into view (without scripts or motion they are simply drawn).
 */
export function Statement() {
  return (
    <section className="section statement" aria-labelledby="statement-title">
      <div className="wrap">
        <h2 id="statement-title" className="sr-only">
          What auracode is
        </h2>
        <p className="statement-text">
          <span className="statement-ink">
            <Words text="A home for the coding agents you already use." />
          </span>{" "}
          <span className="statement-soft">
            <Words
              text="Claude Code, Codex, Grok Build, Cursor and the rest run side by side in one desktop app, on your machine, through their own sign-ins. Nothing to sign up for, nothing to pay."
              offset={9}
            />
          </span>
        </p>
        <ul className="pillars">
          {PILLARS.map((pillar) => (
            <li key={pillar.id} className="pillar">
              <svg
                className="pillar-art"
                viewBox="0 0 320 210"
                aria-hidden="true"
                data-reveal="trigger"
              >
                {pillar.art}
              </svg>
              <p className="pillar-text">
                <strong>{pillar.title}</strong> {pillar.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
