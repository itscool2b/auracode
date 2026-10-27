import { gridPath, Keycap } from "@auracode/ui/graphite";
import type { CSSProperties, ReactNode } from "react";

/* Seven-by-seven pixel glyphs, drawn like the pixel "a": square cells on whole pixels. */
const GLYPHS = {
  local: ["#######", "#.....#", "#.....#", "#.....#", "#######", "...#...", ".#####."],
  harness: [".......", "#......", ".#.....", "..#....", ".#.....", "#..####", "......."],
  key: ["..###..", ".#...#.", ".#...#.", "..###..", "...#...", "...##..", "...##.."],
  checkpoint: ["...#...", "...#...", "..###..", ".#...#.", "..###..", "...#...", "...#..."],
  keys: ["##...##", "#.#.#.#", ".#####.", "..#.#..", ".#####.", "#.#.#.#", "##...##"],
  sync: ["..###..", ".#...#.", ".#...#.", "#######", "###.###", "###.###", "#######"],
} as const;

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="feature-keys">
      {keys.map((key) => (
        <Keycap key={key}>{key}</Keycap>
      ))}
    </span>
  );
}

const FEATURES: readonly { glyph: keyof typeof GLYPHS; title: string; text: ReactNode }[] = [
  {
    glyph: "local",
    title: "Local by default.",
    text: "Projects, chats and agent sessions live on your computer. The app needs no account and works offline.",
  },
  {
    glyph: "harness",
    title: "Your own subscriptions.",
    text: "Each agent signs in and runs through its own harness, on the plan you already have.",
  },
  {
    glyph: "key",
    title: "Your keys stay put.",
    text: "auracode never reads, stores or proxies agent credentials. Every login stays with its agent.",
  },
  {
    glyph: "checkpoint",
    title: "A checkpoint every turn.",
    text: "Files are saved to a private shadow Git repository before each turn. Your index and branches stay untouched.",
  },
  {
    glyph: "keys",
    title: "Keyboard first.",
    text: (
      <>
        Search with <Keys keys={["⌘", "K"]} />, open the side panel with <Keys keys={["⌘", "J"]} />{" "}
        and pick an agent or model with <Keys keys={["⌘", "."]} />. Ctrl on Windows.
      </>
    ),
  },
  {
    glyph: "sync",
    title: "Sync, sealed.",
    text: "Optional end-to-end encrypted sync between your machines. Invite-only during the private preview.",
  },
];

function Glyph({ rows }: { rows: readonly string[] }) {
  return (
    <svg
      className="feature-glyph"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={gridPath(rows, 2)} />
    </svg>
  );
}

/** Vercel's hairline cells with crosshairs at the outer corners; hovering one dims the rest. */
export function Features() {
  return (
    <section className="section features" aria-labelledby="features-title">
      <div className="frame">
        <div className="section-inner">
          <h2 id="features-title" className="section-title" data-reveal="">
            Nothing in the middle. <span>Your agents run on your machine, with your logins.</span>
          </h2>
          <div className="feature-frame">
            <span className="g-crosshair g-crosshair-tl" aria-hidden="true" />
            <span className="g-crosshair g-crosshair-tr" aria-hidden="true" />
            <span className="g-crosshair g-crosshair-bl" aria-hidden="true" />
            <span className="g-crosshair g-crosshair-br" aria-hidden="true" />
            <div className="feature-grid g-hairline-grid">
              {FEATURES.map((feature, i) => (
                <article className="feature" key={feature.glyph}>
                  <div data-reveal="" style={{ "--i": i % 3 } as CSSProperties}>
                    <Glyph rows={GLYPHS[feature.glyph]} />
                    <div className="feature-copy">
                      <h3 className="feature-title">{feature.title}</h3>{" "}
                      <p className="feature-text">{feature.text}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
