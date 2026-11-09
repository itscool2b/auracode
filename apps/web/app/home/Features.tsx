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

/** A chat open in its agent's own interface, in auracode's terminal, with Chat one click away. */
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
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed transcript; the position is identity.
          <span key={i} className="tm-line" data-kind={line.kind}>
            {line.kind === "tool" || line.kind === "reply" ? (
              <span className="tm-dot">●</span>
            ) : null}
            {line.text || " "}
          </span>
        ))}
        <span className="tm-line tm-input">
          {"> "}
          <span className="tm-cursor" />
        </span>
      </div>
    </div>
  );
}

/**
 * Two ways to work beside Chat: any agent in its own terminal, and a canvas to draw on and talk
 * over. The terminal is an authored illustration of the supported state; the canvas is the real
 * app, captured from its preview (scripts/product-images.mjs).
 */
export function Features() {
  return (
    <section className="section features" aria-labelledby="features-title">
      <div className="wrap">
        <div className="product-head">
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
            <a className="text-link" href="/download">
              Get the app
              <span aria-hidden="true">→</span>
            </a>
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
                  sizes="(max-width: 1023px) calc(100vw - 80px), 560px"
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
      </div>
    </section>
  );
}
