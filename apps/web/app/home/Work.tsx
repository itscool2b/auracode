import type { ReactNode } from "react";
import {
  BrowserView,
  ChangesView,
  DashboardView,
  HandoffView,
  QueueView,
  TerminalView,
} from "./Scenes";

const CARDS: readonly { id: string; title: string; text: string; view: ReactNode }[] = [
  {
    id: "handoff",
    title: "Switch agents mid-chat",
    text: "Hand the chat to another agent at any turn. The handoff stays in view, so you always know who did what.",
    view: <HandoffView />,
  },
  {
    id: "queue",
    title: "Queue and steer",
    text: "Type while a turn runs. Your next message waits in a queue, or steers the turn already under way.",
    view: <QueueView />,
  },
  {
    id: "changes",
    title: "Every change in view",
    text: "See each file a turn changed, comment on any line, and take back what you do not want.",
    view: <ChangesView />,
  },
  {
    id: "terminal",
    title: "Chat or terminal",
    text: "Open any chat in its agent's own interface, right inside o7. Back in Chat, the turns are already there.",
    view: <TerminalView />,
  },
  {
    id: "browser",
    title: "A browser beside the chat",
    text: "Open what you are building next to the conversation, point at the part that should change, and send it to the agent.",
    view: <BrowserView />,
  },
  {
    id: "dashboard",
    title: "A dashboard for every chat",
    text: "One board shows which agents are working, which need you and which have finished.",
    view: <DashboardView />,
  },
];

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="more-glyph"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** What else ships in the app today, each a real part of it (docs/design/visual-language.md). */
const MORE: readonly { id: string; glyph: ReactNode; title: string; text: string }[] = [
  {
    id: "dictation",
    glyph: (
      <>
        <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
        <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
      </>
    ),
    title: "Dictation on your device",
    text: "Talk instead of typing. Your words appear as you speak, and recognition runs on your computer.",
  },
  {
    id: "canvas",
    glyph: (
      <>
        <path d="M3.5 13.5 12 5l3 3-8.5 8.5H3.5v-3Z" />
        <path d="M10.5 6.5l3 3" />
      </>
    ),
    title: "A canvas to draw on",
    text: "Sketch the flow and say what you mean while you draw. The drawing goes with your message.",
  },
  {
    id: "memory",
    glyph: (
      <>
        <path d="M5 3.5h8.5A1.5 1.5 0 0 1 15 5v11.5H6.5A1.5 1.5 0 0 1 5 15V3.5Z" />
        <path d="M5 14.5A1.5 1.5 0 0 1 6.5 13H15M8 7h4" />
      </>
    ),
    title: "Memory every agent reads",
    text: "Project notes that follow the work from agent to agent. You can review or undo each edit.",
  },
  {
    id: "themes",
    glyph: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 3v14M10 6.5a3.5 3.5 0 0 1 0 7" />
      </>
    ),
    title: "A theme for every agent",
    text: "Ten palettes, each in light and dark, with the system's appearance followed by default.",
  },
];

/**
 * What o7 does, laid out as dot.com lays out its own: a centred statement over a grid of
 * cards two to a row, each a title and two lines above a picture of the product that runs off the
 * card's foot. The pictures are authored illustrations of supported states. Four smaller cards
 * under them name other shipped parts.
 */
export function Work() {
  return (
    <section className="section work" id="features" aria-labelledby="work-title" data-zone="">
      <div className="center-head">
        <h2 id="work-title" className="title">
          Built for long turns
        </h2>
        <p className="lead">
          Queue the next message, steer a turn while it runs, hand the chat to another agent, and
          take back any change. Your agents keep working while you decide.
        </p>
      </div>
      <div className="wrap work-grid">
        {CARDS.map((card) => (
          <article
            key={card.id}
            className="card work-card"
            data-card={card.id}
            data-reveal={card.id === "terminal" ? "trigger" : undefined}
          >
            <div className="work-text">
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </div>
            <div className="work-view" aria-hidden="true">
              {card.view}
            </div>
          </article>
        ))}
      </div>
      <ul className="wrap more-grid">
        {MORE.map((item) => (
          <li key={item.id} className="card more-card">
            <Glyph>{item.glyph}</Glyph>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
