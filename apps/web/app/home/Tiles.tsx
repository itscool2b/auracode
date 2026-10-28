import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { AgentMark, Keycap, StatusDot } from "@auracode/ui/graphite";
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { useReducedMotion } from "../motion";

/*
 * X Money's "One app" tiles (money.x.com, measured): 268 by 240 recessed tiles in a four-column
 * grid, 16px apart, each with its caption set against the tile's bottom edge in the next column,
 * and a wide tile on every other row. The miniatures are built from Graphite tokens, not drawn.
 * At rest every tile is still; hovering one plays its loop and dims the others to half over
 * 500ms, as X Money's do. They illustrate the caption beside them, so all but the interactive
 * checkpoint tile are hidden from assistive technology.
 */

/** Steps through `count` states every `ms` while `playing`, and rests on the first otherwise. */
function useCycle(count: number, ms: number, playing: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!playing) {
      setIndex(0);
      return;
    }
    let id = 0;
    const step = () => {
      setIndex((i) => (i + 1) % count);
      id = window.setTimeout(step, ms);
    };
    id = window.setTimeout(step, ms / 2);
    return () => window.clearTimeout(id);
  }, [count, ms, playing]);
  return index;
}

/** A check drawn on whole pixels, as the app's pickers draw the selected row. */
function Check() {
  return (
    <svg
      className="mini-check"
      width="8"
      height="8"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 4h2v2H1zM3 5h1v2H3zM4 3h1v2H4zM5 2h1v2H5zM6 1h1v2H6z" />
    </svg>
  );
}

const PICKER: readonly AgentBrandId[] = ["claude-code", "codex", "pi", "cursor", "opencode"];

/** The agent picker; on hover the selection walks down it. */
function AgentsMini({ playing }: { playing: boolean }) {
  const index = useCycle(PICKER.length, 1400, playing);
  return (
    <ul className="mini mini-menu">
      {PICKER.map((id, i) => (
        <li key={id} className={i === index ? "is-selected" : undefined}>
          <AgentMark agent={id} size={20} />
          <span className="mini-strong">{AGENT_BRANDS[id].name}</span>
          {i === index ? <Check /> : null}
        </li>
      ))}
    </ul>
  );
}

/** A chat handed from Claude Code to Codex, the handoff in plain view. */
function HandoffMini() {
  return (
    <div className="mini mini-handoff">
      <p className="mini-user">Review the pacing change</p>
      <p className="mini-event">
        <span className="mini-quiet">Switched to</span>
        <AgentMark agent="codex" size={16} />
        <span className="mini-strong">Codex</span>
      </p>
      <p className="mini-answer">
        Read the handoff from Claude Code. One edge case is left in{" "}
        <code className="mini-code">defer()</code>.
      </p>
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
 * X Money's Front and Back, here the file as this turn left it and as the checkpoint kept it. On
 * hover it alternates until someone picks a side.
 */
function CheckpointMini({ playing }: { playing: boolean }) {
  const [chosen, setChosen] = useState<"after" | "before" | null>(null);
  const index = useCycle(2, 2400, playing && chosen === null);
  const view = chosen ?? (index === 0 ? "after" : "before");
  const lines = view === "after" ? AFTER : BEFORE;
  const changed = (line: string) =>
    view === "after"
      ? !(BEFORE as readonly string[]).includes(line)
      : !(AFTER as readonly string[]).includes(line);
  return (
    <div className="mini mini-checkpoint">
      <fieldset className="checkpoint-toggle">
        <legend className="sr-only">Show the file</legend>
        <button type="button" aria-pressed={view === "after"} onClick={() => setChosen("after")}>
          <span className="checkpoint-swatch" aria-hidden="true" />
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
          <span className="mini-meta">{view === "after" ? "After this turn" : "Checkpoint"}</span>
        </div>
        <ol className="checkpoint-code" aria-label={view === "after" ? "After" : "Before"}>
          {lines.map((line, i) => (
            <li key={`${view}-${line}`} className={changed(line) ? `is-${view}` : undefined}>
              <span className="mini-ln">{40 + i}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
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
  { title: "Full auto", note: "Edits and runs commands", level: 3 },
  { title: "Auto-edit", note: "Asks before commands", level: 2 },
  { title: "Ask", note: "Asks before every change", level: 1 },
] as const;

/** The autonomy menu; on hover the selection walks the three levels. */
function AutonomyMini({ playing }: { playing: boolean }) {
  const index = useCycle(LEVELS.length, 1600, playing);
  return (
    <ul className="mini mini-menu mini-autonomy">
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
  );
}

/** A running turn with a message queued behind it; its loader runs on hover only. */
function QueueMini({ playing }: { playing: boolean }) {
  return (
    <div className="mini mini-queue">
      <p className="mini-event">
        <AgentMark agent="claude-code" state={playing ? "thinking" : "idle"} size={16} />
        <span className="mini-strong">Claude Code</span>
        <span className="mini-quiet">Working</span>
      </p>
      <div className="mini-queue-stack">
        <div className="mini-segment">
          <span className="mini-meta">Queued</span>
          <span className="mini-segment-text">Then update the changelog</span>
        </div>
        <div className="mini-shell">
          <span className="mini-typed">
            Add a test
            <span className="mini-caret" />
          </span>
          <span className="mini-button mini-button-primary">
            Queue <Keycap>↵</Keycap>
          </span>
        </div>
      </div>
    </div>
  );
}

type Status = "running" | "waiting" | "done";

const SESSIONS: readonly { title: string; agent: AgentBrandId; status: Status }[] = [
  { title: "Fix the flaky login test", agent: "claude-code", status: "running" },
  { title: "Port the parser to Rust", agent: "codex", status: "waiting" },
  { title: "Update the changelog", agent: "opencode", status: "done" },
  { title: "Bump the dependencies", agent: "pi", status: "running" },
];

const STATUS_LABEL: Record<Status, string> = {
  running: "Running",
  waiting: "Needs you",
  done: "Done",
};

/** Four chats side by side; one waits on you. On hover the running ones show their loaders. */
function SessionsMini({ playing }: { playing: boolean }) {
  return (
    <ul className="mini mini-sessions">
      {SESSIONS.map((session) => (
        <li key={session.title}>
          <span className="mini-session-title">{session.title}</span>
          <span className="mini-session-agent">
            <AgentMark agent={session.agent} size={16} />
            {AGENT_BRANDS[session.agent].name}
          </span>
          <span className={`mini-session-status is-${session.status}`}>
            <StatusDot
              tone={session.status === "waiting" ? "volt" : "neutral"}
              live={playing && session.status === "running"}
            />
            {STATUS_LABEL[session.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Place = "pair" | "wide-end" | "wide-start";

const ITEMS: readonly {
  id: string;
  title: string;
  text: string;
  place: Place;
  interactive?: boolean;
  tile: (playing: boolean) => ReactNode;
}[] = [
  {
    id: "agents",
    title: "Your agents, as they are",
    text: "Claude Code, Codex, Pi, Cursor and five more run through their own harnesses and sign-ins, plus any agent that speaks ACP.",
    place: "pair",
    tile: (playing) => <AgentsMini playing={playing} />,
  },
  {
    id: "handoff",
    title: "Switch agents mid-chat",
    text: "Hand a chat to another agent at any turn. It picks up from a handoff you can read.",
    place: "pair",
    tile: () => <HandoffMini />,
  },
  {
    id: "checkpoint",
    title: "A checkpoint every turn",
    text: "Before each turn your files are saved to a private shadow Git repository, so any turn can be undone. Your own index and branches stay untouched.",
    place: "wide-end",
    interactive: true,
    tile: (playing) => <CheckpointMini playing={playing} />,
  },
  {
    id: "autonomy",
    title: "Full auto, by default",
    text: "Agents edit and run commands without stopping to ask. Switch a chat to Auto-edit or Ask whenever you want a say.",
    place: "pair",
    tile: (playing) => <AutonomyMini playing={playing} />,
  },
  {
    id: "queue",
    title: "Queue and steer",
    text: "Type while a turn runs. Your next message waits in a queue, or steers the turn already under way.",
    place: "pair",
    tile: (playing) => <QueueMini playing={playing} />,
  },
  {
    id: "sessions",
    title: "Several chats at once",
    text: "Start a chat for each task and let them run side by side. When one needs you, it waits in the Needs you inbox.",
    place: "wide-start",
    tile: (playing) => <SessionsMini playing={playing} />,
  },
];

export function Tiles() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const enter = (id: string) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") setActive(id);
  };
  const leave = (event: PointerEvent) => {
    if (event.pointerType === "mouse") setActive(null);
  };
  return (
    <section className="section tiles" aria-labelledby="tiles-title">
      <div className="wrap">
        <h2 id="tiles-title" className="title" data-reveal="">
          Every agent, one window. <span>Full auto, with every control in reach.</span>
        </h2>
        <ul className="tiles-grid" data-active={active ?? undefined}>
          {ITEMS.map((item, i) => (
            <li
              key={item.id}
              className={`tiles-item is-${item.place}`}
              data-reveal=""
              data-current={active === item.id ? "" : undefined}
              style={{ "--i": i % 2 } as CSSProperties}
              onPointerEnter={enter(item.id)}
              onPointerLeave={leave}
            >
              <div className="tiles-tile" aria-hidden={item.interactive ? undefined : "true"}>
                {item.tile(!reduced && active === item.id)}
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
