import { AGENT_BRAND_IDS, AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { AgentMark, StatusDot } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { Glyph, type GlyphName } from "./glyphs";

/* One turn's tool calls on a time axis, as ACP names their kinds; start and end in percent. */
const CALLS: readonly { kind: string; from: number; to: number; now?: boolean }[] = [
  { kind: "read", from: 2, to: 9 },
  { kind: "search", from: 11, to: 24 },
  { kind: "edit", from: 27, to: 40 },
  { kind: "execute", from: 43, to: 84, now: true },
  { kind: "edit", from: 87, to: 95 },
];

function Timeline() {
  return (
    <div className="strip-panel strip-timeline">
      <ol>
        {CALLS.map((call, i) => (
          <li key={`${call.kind}-${call.from}`} style={{ "--i": i } as CSSProperties}>
            <span className="strip-kind">{call.kind}</span>
            <span className="strip-track">
              <span
                className={call.now ? "strip-bar is-now" : "strip-bar"}
                style={{ left: `${call.from}%`, width: `${call.to - call.from}%` }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type Status = "running" | "waiting" | "done";

const SESSIONS: readonly { title: string; agent: AgentBrandId; status: Status }[] = [
  { title: "Fix the flaky login test", agent: "claude-code", status: "running" },
  { title: "Port the parser to Rust", agent: "codex", status: "waiting" },
  { title: "Update the changelog", agent: "opencode", status: "done" },
  { title: "Bump the dependencies", agent: "pi", status: "running" },
  { title: "Review the release notes", agent: "cursor", status: "done" },
  { title: "Profile the startup path", agent: "grok", status: "running" },
  { title: "Tidy the settings screen", agent: "hermes", status: "waiting" },
];

const STATUS_LABEL: Record<Status, string> = {
  running: "Running",
  waiting: "Waiting on you",
  done: "Done",
};

function Sessions() {
  return (
    <div className="strip-panel strip-sessions">
      <ul className="strip-rows">
        {[0, 1].flatMap((copy) =>
          SESSIONS.map((session) => (
            <li key={`${session.title}-${copy}`}>
              <span className="strip-title">{session.title}</span>
              <span className="strip-agent">
                <AgentMark agent={session.agent} size={14} />
                {AGENT_BRANDS[session.agent].name}
              </span>
              <span className={`strip-status is-${session.status}`}>
                <StatusDot
                  tone={session.status === "waiting" ? "volt" : "neutral"}
                  live={session.status === "running"}
                />
                {STATUS_LABEL[session.status]}
              </span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

const AGENTS = AGENT_BRAND_IDS.filter((id) => id !== "generic");

/** Every supported agent as a chip, three rows drifting at their own pace. */
function ChipCloud() {
  const rows = [AGENTS, [...AGENTS.slice(3), ...AGENTS.slice(0, 3)], [...AGENTS].reverse()];
  return (
    <div className="strip-panel strip-chips">
      {rows.map((row, r) => (
        <div className="strip-chip-row" key={row.join()} style={{ "--r": r } as CSSProperties}>
          {[0, 1].flatMap((copy) =>
            row.map((id) => (
              <span className="strip-chip" key={`${id}-${copy}`}>
                <AgentMark agent={id} size={16} />
                {AGENT_BRANDS[id].name}
              </span>
            )),
          )}
        </div>
      ))}
    </div>
  );
}

const NOTES: readonly { glyph: GlyphName; title: string; text: string }[] = [
  {
    glyph: "inbox",
    title: "A Needs you inbox",
    text: "Every chat waiting on your answer, gathered in one list.",
  },
  {
    glyph: "marks",
    title: "Marks that show state",
    text: "A loader while an agent works, a square when it needs you, a check when it is done.",
  },
  {
    glyph: "bell",
    title: "Notifications",
    text: "A question that arrives while the window is hidden sends a notification.",
  },
];

/**
 * Vercel's single framed band of three joined panels: one turn's tool calls on a timeline, the
 * sessions running side by side, and the agents they run on. One row of notes follows.
 */
export function Strip() {
  return (
    <section className="section strip" aria-labelledby="strip-title">
      <div className="wrap">
        <div className="strip-head">
          <h2 id="strip-title" className="title" data-reveal="">
            Run several at once. <span>Each chat works on its own.</span>
          </h2>
          <p className="lead" data-reveal="" style={{ "--i": 1 } as CSSProperties}>
            Start a chat for each task and let them run side by side. When one needs you, it waits
            in the Needs you inbox.
          </p>
        </div>
        <div className="strip-band" aria-hidden="true" data-reveal="">
          <Timeline />
          <Sessions />
          <ChipCloud />
        </div>
        <ul className="strip-notes">
          {NOTES.map((note, i) => (
            <li key={note.title} data-reveal="" style={{ "--i": i } as CSSProperties}>
              <Glyph name={note.glyph} />
              <h3 className="caption-title">{note.title}</h3>
              <p className="caption-text">{note.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
