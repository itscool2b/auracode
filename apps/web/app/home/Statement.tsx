import { AGENT_BRANDS } from "@auracode/ui";
import type { CSSProperties } from "react";
import { AGENTS, SpriteMark } from "./Sprite";
import { Wing } from "./Wing";

/**
 * What o7 is, as dot.com says what its product is: a large title at left and two paragraphs
 * in ink at right, then every agent in one row across the column, where dot.com sets its row of
 * bots. The marks stay at the website's 24px (third-party/brand-marks.md), each beside its name.
 * The row repeats the chips further down, so it is hidden from assistive technology. As dot.com's
 * bots do, the agents arrive one after another when the row scrolls in, and a faint wing crosses
 * behind the section as the page moves past it.
 */
export function Statement() {
  return (
    <section className="statement" aria-labelledby="statement-title">
      <Wing className="flyby" />
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
      <div className="wrap statement-roster" aria-hidden="true" data-reveal="">
        {AGENTS.map((agent, i) => (
          <span key={agent} className="statement-agent" style={{ "--i": i } as CSSProperties}>
            <SpriteMark agent={agent} size={24} />
            {AGENT_BRANDS[agent].name}
          </span>
        ))}
      </div>
    </section>
  );
}
