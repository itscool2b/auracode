import type { CSSProperties, ReactNode } from "react";
import { Words } from "../reveal";

/** The terminal card's session, as the agent's own interface draws it: an authored illustration. */
const SESSION: readonly { kind: string; text: string }[] = [
  { kind: "prompt", text: "> Fix the header's spacing" },
  { kind: "blank", text: "" },
  { kind: "tool", text: "Read src/shell.css" },
  { kind: "note", text: "  1,612 lines" },
  { kind: "tool", text: "Update src/shell.css" },
  { kind: "del", text: "  - gap: var(--g-space-6);" },
  { kind: "add", text: "  + gap: var(--g-space-8);" },
  { kind: "add", text: "  + align-items: center;" },
  { kind: "blank", text: "" },
  { kind: "reply", text: "The header's controls now share one gap and sit centred." },
];

/**
 * A chat open in its agent's own interface, in auracode's terminal, with Chat one click away. Its
 * lines print one after another when the card scrolls into view.
 */
function TerminalCard() {
  return (
    <div className="tm" aria-hidden="true">
      <div className="tm-bar">
        <span className="tm-title">
          Fix the header spacing <span className="tm-project">auracode</span>
        </span>
        <span className="tm-switch">
          <span>Chat</span>
          <span data-on="">Terminal</span>
        </span>
      </div>
      <div className="tm-screen">
        {SESSION.map((line, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed transcript; the position is identity.
            key={i}
            className="tm-line"
            data-kind={line.kind}
            style={{ "--l": i } as CSSProperties}
          >
            {line.kind === "tool" || line.kind === "reply" ? (
              <span className="tm-dot">●</span>
            ) : null}
            {line.text || " "}
          </span>
        ))}
        <span className="tm-line tm-input" style={{ "--l": SESSION.length } as CSSProperties}>
          {"> "}
          <span className="tm-cursor" />
        </span>
      </div>
    </div>
  );
}

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
    id: "browser",
    glyph: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M3 10h14M10 3c2.2 2 3.2 4.3 3.2 7s-1 5-3.2 7c-2.2-2-3.2-4.3-3.2-7s1-5 3.2-7Z" />
      </>
    ),
    title: "A browser beside the chat.",
    text: "Open what you are building next to the conversation, point at the part that should change, and send it to the agent.",
  },
  {
    id: "dashboard",
    glyph: (
      <>
        <rect x="3" y="3.5" width="14" height="13" rx="2.5" />
        <path d="M7.7 3.5v13M12.3 3.5v13" />
      </>
    ),
    title: "A dashboard for every chat.",
    text: "One board shows which agents are working, which need you and which have finished.",
  },
  {
    id: "dictation",
    glyph: (
      <>
        <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
        <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
      </>
    ),
    title: "Dictation on your device.",
    text: "Talk instead of typing. Your words appear as you speak, and recognition runs on your computer.",
  },
  {
    id: "review",
    glyph: (
      <>
        <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14h-5l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5Z" />
        <path d="M6.5 8h7M6.5 10.8h4" />
      </>
    ),
    title: "Review on the diff.",
    text: "Comment on any changed line and send the review back to the agent, or revert a single change.",
  },
  {
    id: "memory",
    glyph: (
      <>
        <path d="M5 3.5h8.5A1.5 1.5 0 0 1 15 5v11.5H6.5A1.5 1.5 0 0 1 5 15V3.5Z" />
        <path d="M5 14.5A1.5 1.5 0 0 1 6.5 13H15M8 7h4" />
      </>
    ),
    title: "Memory every agent reads.",
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
    title: "A theme for every agent.",
    text: "Ten palettes, each in light and dark, with the system's appearance followed by default.",
  },
];

/**
 * Two ways to work beside Chat, then the rest of the workspace. The terminal is an authored
 * illustration of the supported state; the canvas is the real app, captured from its preview
 * (scripts/product-images.mjs). The six cells under them name shipped parts of the app.
 */
export function Features() {
  return (
    <section className="section features" aria-labelledby="features-title">
      <div className="wrap">
        <div className="split-head">
          <h2 id="features-title" className="title">
            <Words text="Type it, draw it," />{" "}
            <span className="title-soft">
              <Words text="or open the terminal." offset={4} />
            </span>
          </h2>
          <div className="split-side" data-reveal="">
            <p className="lead">
              Every chat can open in its agent's own interface, and every message can carry a
              drawing. Your conversation follows you between them.
            </p>
          </div>
        </div>
        <div className="feature-grid">
          <article className="feature-card" data-reveal="">
            <div className="feature-stage feature-stage-terminal">
              <TerminalCard />
            </div>
            <p className="feature-text">
              <strong>Chat or terminal.</strong> Open any chat in its agent's own interface, right
              inside auracode: Claude Code, Codex, Grok Build, Cursor and the rest. Back in Chat,
              the turns are already there.
            </p>
          </article>
          <article className="feature-card" data-reveal="">
            <div className="feature-stage feature-stage-shot">
              <picture>
                <source
                  type="image/webp"
                  srcSet="/images/feature-canvas-480.webp 480w, /images/feature-canvas-960.webp 960w, /images/feature-canvas-1440.webp 1440w"
                  sizes="(max-width: 1023px) 130vw, 660px"
                />
                <img
                  src="/images/feature-canvas.png"
                  width="960"
                  height="599"
                  loading="lazy"
                  decoding="async"
                  alt="The auracode canvas: a sign-in page boxed and joined by an arrow to a session service, each marked with the number of the sentence said while it was drawn, those two sentences listed under the drawing, and the message box below."
                />
              </picture>
            </div>
            <p className="feature-text">
              <strong>Draw it out.</strong> Sketch the flow on a canvas and say what you mean while
              you draw. The drawing goes with your message, with an outline any agent can read.
            </p>
          </article>
        </div>
        <ul className="more-grid" data-reveal="">
          {MORE.map((item) => (
            <li key={item.id} className="more-cell">
              {item.glyph ? <Glyph>{item.glyph}</Glyph> : null}
              <p className="more-text">
                <strong>{item.title}</strong> {item.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
