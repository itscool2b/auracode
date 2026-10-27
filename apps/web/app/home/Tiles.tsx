import { AgentMark, Keycap } from "@auracode/ui/graphite";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";
import { PlanMini } from "./minis";

/** Steps `count` states every `ms` while the element is in view and motion is allowed. */
function useCycle(count: number, ms: number, stopped = false) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(root, { threshold: 0.3 });
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced || !visible || !inView || stopped) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [count, ms, reduced, visible, inView, stopped]);
  return { root, index };
}

/* The autonomy level as three square ticks, as the composer draws it (visual language 6.11). */
function Ticks({ level }: { level: number }) {
  return (
    <span className="ticks" aria-hidden="true">
      {[1, 2, 3].map((tick) => (
        <span key={tick} className={tick <= level ? "is-on" : undefined} />
      ))}
    </span>
  );
}

const LEVELS = [
  {
    title: "Full auto",
    note: "Edits and runs commands without asking.",
    level: 3,
  },
  { title: "Auto-edit", note: "Asks before running commands.", level: 2 },
  { title: "Ask", note: "Asks before every edit and command.", level: 1 },
] as const;

/** The autonomy menu; the selection walks the three levels. */
function AutonomyMini() {
  const { root, index } = useCycle(LEVELS.length, 2400);
  return (
    <div className="mini mini-autonomy" ref={root}>
      <ul className="mini-menu">
        {LEVELS.map((level, i) => (
          <li key={level.title} className={i === index ? "is-selected" : undefined}>
            <Ticks level={level.level} />
            <span className="mini-menu-copy">
              <span className="mini-strong">{level.title}</span>
              <span className="mini-meta">{level.note}</span>
            </span>
            <Keycap>{String(i + 1)}</Keycap>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A running turn with two messages queued behind it, and the hint that steering is a key away. */
function QueueMini() {
  return (
    <div className="mini mini-queue">
      <div className="mini-byline">
        <AgentMark agent="claude-code" state="thinking" size={16} />
        <span className="mini-strong">Claude Code</span>
        <span className="mini-quiet">Working</span>
      </div>
      <div className="mini-queue-stack">
        <span className="mini-sliver" />
        <div className="mini-segment">
          <span className="mini-meta">2 queued</span>
          <span className="mini-segment-text">Then update the changelog</span>
          <span className="mini-link">Edit</span>
        </div>
        <div className="mini-shell">
          <span className="film-typed">
            Cover the zero case
            <span className="film-caret" />
          </span>
          <span className="mini-split">
            <span className="mini-button mini-button-primary">
              Queue <Keycap>↵</Keycap>
            </span>
          </span>
        </div>
      </div>
      <p className="mini-hint">esc to stop · enter to queue · ⌘ enter to steer</p>
    </div>
  );
}

const BEFORE = ["const frame = clock.now();", "if (late) skip(frame);", "render(frame);"] as const;
const AFTER = [
  "const frame = clock.now();",
  "if (late) return defer(frame);",
  "budget.record(frame);",
  "render(frame);",
] as const;

/**
 * X Money's Front and Back, here the file as this turn left it and as the checkpoint kept it. It
 * alternates on its own until someone picks a side.
 */
function CheckpointMini() {
  const [chosen, setChosen] = useState<"after" | "before" | null>(null);
  const { root, index } = useCycle(2, 3200, chosen !== null);
  const view = chosen ?? (index === 0 ? "after" : "before");
  const lines = view === "after" ? AFTER : BEFORE;
  const changed = (line: string) =>
    view === "after"
      ? !(BEFORE as readonly string[]).includes(line)
      : !(AFTER as readonly string[]).includes(line);
  return (
    <div className="mini mini-checkpoint" ref={root}>
      <fieldset className="checkpoint-toggle">
        <legend className="sr-only">Show the file</legend>
        <button type="button" aria-pressed={view === "after"} onClick={() => setChosen("after")}>
          <span className="checkpoint-swatch is-after" aria-hidden="true" />
          This turn
        </button>
        <button type="button" aria-pressed={view === "before"} onClick={() => setChosen("before")}>
          <span className="checkpoint-swatch" aria-hidden="true" />
          Before it
        </button>
      </fieldset>
      <div className="checkpoint-file">
        <div className="checkpoint-head">
          <span className="mini-code">src/pacing.ts</span>
          <span className="mini-meta">
            {view === "after" ? "After this turn" : "Checkpoint before this turn"}
          </span>
        </div>
        <ol className="checkpoint-code" aria-label={view === "after" ? "After" : "Before"}>
          {lines.map((line, i) => (
            <li key={`${view}-${line}`} className={changed(line) ? `is-${view}` : undefined}>
              <span className="mini-ln">{40 + i}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <div className="checkpoint-foot">
          <span className="mini-meta">2 files · 48s</span>
          <span className="mini-button">Revert</span>
        </div>
      </div>
    </div>
  );
}

const KEYS: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ["⌘", "N"], label: "New chat" },
  { keys: ["⌘", "K"], label: "Search" },
  { keys: ["⌘", "J"], label: "Changes panel" },
  { keys: ["⌘", ","], label: "Settings" },
  { keys: ["Esc"], label: "Stop the turn" },
];

/** The shortcuts, lighting one at a time. */
function KeysMini() {
  const { root, index } = useCycle(KEYS.length, 1600);
  return (
    <div className="mini mini-keys" ref={root}>
      <ul>
        {KEYS.map((row, i) => (
          <li key={row.label} className={i === index ? "is-active" : undefined}>
            <span className="mini-keys-caps">
              {row.keys.map((key) => (
                <Keycap key={key}>{key}</Keycap>
              ))}
            </span>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ITEMS: readonly {
  id: string;
  title: string;
  text: ReactNode;
  tile: ReactNode;
  wide?: boolean;
}[] = [
  {
    id: "autonomy",
    title: "Full auto, by default",
    text: "Agents edit and run commands without stopping to ask. Switch a chat to Auto-edit or Ask whenever you want a say.",
    tile: <AutonomyMini />,
  },
  {
    id: "queue",
    title: "Queue and steer",
    text: "Type while a turn runs. Your next messages wait in a queue, or steer the turn already under way.",
    tile: <QueueMini />,
  },
  {
    id: "checkpoint",
    title: "A checkpoint every turn",
    text: "Before each turn, your files are saved to a private shadow Git repository, so any turn can be undone. Your own index and branches stay untouched.",
    tile: <CheckpointMini />,
    wide: true,
  },
  {
    id: "plan",
    title: "Plans you can read",
    text: "When an agent plans, its steps stay in view and tick off as it works.",
    tile: <PlanMini />,
  },
  {
    id: "keys",
    title: "Keyboard first",
    text: "New chat, search, the changes panel and settings are a keystroke away, and Esc stops a turn. Ctrl on Windows.",
    tile: <KeysMini />,
  },
];

/**
 * X Money's staggered tiles: square recessed tiles with live miniatures of the app, each with its
 * text set against the tile's bottom edge, and one wide tile with a two-way toggle in the middle.
 */
export function Tiles() {
  return (
    <section className="section tiles" aria-labelledby="tiles-title">
      <div className="wrap">
        <h2 id="tiles-title" className="title" data-reveal="">
          Full auto by default. <span>Every control within reach.</span>
        </h2>
        <ul className="tiles-grid">
          {ITEMS.map((item, i) => (
            <li
              key={item.id}
              className={item.wide ? "tiles-item is-wide" : "tiles-item"}
              data-reveal=""
              style={{ "--i": i % 2 } as CSSProperties}
            >
              <div className="tiles-tile" aria-hidden={item.wide ? undefined : "true"}>
                {item.tile}
              </div>
              <div className="tiles-text">
                <h3 className="caption-title">{item.title}</h3>
                <p className="caption-text">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
