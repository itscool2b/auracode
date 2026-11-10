import { Logo } from "@auracode/ui/graphite";

/**
 * What auracode is, on one wide card: the statement and its paragraph at left, and the logo set
 * very large at right, running off the card's edge.
 */
export function Intro() {
  return (
    <section className="section intro" aria-labelledby="intro-title">
      <div className="wrap">
        <div className="card intro-card" data-reveal="">
          <div className="intro-text">
            <h2 id="intro-title" className="title">
              A home for the agents you already use
            </h2>
            <p className="lead">
              Claude Code, Codex, Grok Build, Cursor and the rest run side by side in one desktop
              app, on your machine, through their own sign-ins. Your chats and history stay on your
              computer. Nothing to sign up for, nothing to pay.
            </p>
          </div>
          <div className="intro-art" aria-hidden="true">
            <span className="intro-disc">
              <Logo size={320} />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
