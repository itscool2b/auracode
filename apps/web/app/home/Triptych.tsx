import { AgentMark, gridPath } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { AGENT_NAMES } from "../agents";
import { GRAIN_SEEDS } from "../fields";
import { AgentWheel } from "./AgentWheel";
import { Glyph, type GlyphName } from "./glyphs";
import { GrainTile } from "./Tile";

/* A solid pixel pointer, seven cells across. */
const POINTER = [
  "#......",
  "##.....",
  "###....",
  "####...",
  "#####..",
  "######.",
  "####...",
  "#.##...",
  "...##..",
  "....#..",
];

function Pointer() {
  return (
    <svg
      className="cursor-pointer"
      width="14"
      height="20"
      viewBox="0 0 14 20"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={gridPath(POINTER, 2)} />
    </svg>
  );
}

/** Two agents trading one chat, as Harvey's two cursors share a document. */
function Handover() {
  return (
    <div className="handover">
      <div className="handover-card">
        <p className="handover-user">Review the pacing change</p>
        <p className="handover-event">
          <span className="mini-quiet">Switched to</span>
          <AgentMark agent="codex" size={14} />
          <span className="mini-strong">Codex</span>
        </p>
        <p className="handover-text">
          Read the handoff from Claude Code. One edge case is left in <code>defer()</code>.
        </p>
      </div>
      <span className="cursor cursor-a">
        <Pointer />
        <span className="cursor-chip">
          <AgentMark agent="claude-code" size={14} />
          Claude Code
        </span>
      </span>
      <span className="cursor cursor-b">
        <Pointer />
        <span className="cursor-chip">
          <AgentMark agent="codex" size={14} />
          Codex
        </span>
      </span>
    </div>
  );
}

const FACTS: readonly { glyph: GlyphName; label: string }[] = [
  { glyph: "window", label: "Windows x64" },
  { glyph: "window", label: "Windows ARM64" },
  { glyph: "laptop", label: "macOS on Apple silicon" },
  { glyph: "laptop", label: "macOS on Intel" },
  { glyph: "home", label: "Works offline" },
  { glyph: "person", label: "No account needed" },
  { glyph: "key", label: "Your own agent logins" },
];

/** Harvey's scrolling list of sources, here the places auracode runs. Two copies loop seamlessly. */
function Facts() {
  return (
    <div className="facts">
      <ul className="facts-list">
        {[0, 1].flatMap((copy) =>
          FACTS.map((fact) => (
            <li className="fact" key={`${fact.label}-${copy}`}>
              <Glyph name={fact.glyph} />
              {fact.label}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

const ITEMS = [
  {
    title: "Your agents, as they are",
    text: "Claude Code, Codex, Pi, Cursor and five more run through their own harnesses and sign-ins, plus any agent that speaks ACP.",
  },
  {
    title: "Switch agents mid-chat",
    text: "Hand a chat to another agent at any turn. It picks up from a handoff written into the prompt, where you can read it.",
  },
  {
    title: "Runs where you work",
    text: "Windows and macOS, on your own machine. The app is free, works offline and needs no account.",
  },
] as const;

/** Harvey's "top performers" triptych: three tall recessed tiles on grain, a caption under each. */
export function Triptych() {
  const tiles = [
    <>
      <AgentWheel names={AGENT_NAMES} />
      <ul className="agent-list">
        {AGENT_NAMES.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </>,
    <Handover key="handover" />,
    <Facts key="facts" />,
  ];
  return (
    <section className="section triptych" aria-labelledby="agents-title">
      <div className="wrap">
        <h2 id="agents-title" className="title" data-reveal="">
          Bring the agents you already use.{" "}
          <span>auracode runs each one through its own harness.</span>
        </h2>
        <ul className="triptych-row">
          {ITEMS.map((item, i) => (
            <li
              className="triptych-item"
              key={item.title}
              data-reveal=""
              style={{ "--i": i } as CSSProperties}
            >
              <GrainTile seed={GRAIN_SEEDS[i] ?? GRAIN_SEEDS[0]} className="tile-tall">
                {tiles[i]}
              </GrainTile>
              <h3 className="caption-title">{item.title}</h3>
              <p className="caption-text">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
