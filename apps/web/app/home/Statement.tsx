import { AGENT_BRANDS } from "@auracode/ui";
import { AGENTS, SpriteMark } from "./Sprite";

/**
 * What auracode is, as dot.com says what its product is: a large title at left and two paragraphs
 * in ink at right, then every agent in one row across the column, where dot.com sets its row of
 * bots. The marks stay at the website's 24px (third-party/brand-marks.md), each beside its name.
 * The row repeats the chips further down, so it is hidden from assistive technology.
 */
export function Statement() {
  return (
    <section className="statement" aria-labelledby="statement-title">
      <div className="wrap statement-grid">
        <h2 id="statement-title" className="title-xl">
          A home for the agents you already use
        </h2>
        <div className="statement-text">
          <p>
            Claude Code, Codex, Grok Build, Cursor and the rest run side by side in one desktop app,
            on your machine, through their own sign-ins.
          </p>
          <p>
            Your chats and history stay on your computer. Nothing to sign up for, nothing to pay.
          </p>
        </div>
      </div>
      <div className="wrap statement-roster" aria-hidden="true">
        {AGENTS.map((agent) => (
          <span key={agent} className="statement-agent">
            <SpriteMark agent={agent} size={24} />
            {AGENT_BRANDS[agent].name}
          </span>
        ))}
      </div>
    </section>
  );
}
