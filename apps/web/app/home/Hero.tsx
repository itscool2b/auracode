import { useRef } from "react";
import { Arrow } from "../ui";
import { HeroWindow, useHandoffLoop } from "./HeroWindow";

/**
 * What auracode is in one line, set at a calm size and left, with what it means and the two
 * actions on the row under it. The window below is the proof: one session replayed live, handed
 * from agent to agent.
 */
export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const state = useHandoffLoop(stage);

  return (
    <section className="hero" aria-labelledby="hero-title" data-zone="">
      <div className="wrap">
        <h1 id="hero-title" className="hero-title">
          One window for <span className="hero-soft">every coding agent.</span>
        </h1>
        <div className="hero-row">
          <p className="hero-lead">
            Claude Code, Codex, Cursor and six more, side by side in one desktop app on your
            machine. Free, with nothing to sign up for.
          </p>
          <div className="hero-actions">
            <a className="btn btn-ink" href="/download">
              Download
              <Arrow direction="down" />
            </a>
            <a className="btn btn-line" href="#features">
              See what it does
            </a>
          </div>
        </div>
        <div className="hero-stage" ref={stage}>
          <div className="hero-detail" aria-hidden="true">
            <HeroWindow state={state} />
          </div>
        </div>
      </div>
    </section>
  );
}
