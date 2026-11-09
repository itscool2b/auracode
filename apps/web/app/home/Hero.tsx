import { AGENT_BRANDS } from "@auracode/ui";
import { useRef } from "react";
import { Arrow } from "../ui";
import { AgentRoll } from "./AgentRoll";
import { HeroWindow, useHandoffLoop, workingAgent } from "./HeroWindow";
import { Marquee } from "./Marquee";

/**
 * "One window for" the agent at work, set large and left as a statement, with what it is and the
 * two actions beside it. The window below replays one session handed from agent to agent; the
 * name in the headline follows it. The window leans back on a hairline floor and lies flat as the
 * page scrolls; the agents it runs pass underneath.
 */
export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const state = useHandoffLoop(stage);
  const agent = AGENT_BRANDS[workingAgent(state)];

  return (
    <section className="hero" aria-labelledby="hero-title" data-zone="">
      <div className="hero-copy wrap">
        <h1 id="hero-title" className="hero-title" aria-label="One window for your coding agents">
          <span className="hero-line" aria-hidden="true">
            One window for
          </span>
          <span className="hero-line hero-line-agent" aria-hidden="true">
            <AgentRoll name={agent.name} />
          </span>
        </h1>
        <div className="hero-side">
          <p className="hero-lead">
            The coding agents you already use, side by side in one chat on your machine. Free, with
            nothing to sign up for.
          </p>
          <div className="hero-actions">
            <a className="cta cta-ink" href="/download" data-magnetic="">
              Download
              <Arrow direction="down" />
            </a>
            <a className="cta cta-glass" href="#capabilities">
              See it work
            </a>
          </div>
        </div>
      </div>
      <div className="hero-floor">
        <div className="hero-stage" ref={stage}>
          <div className="hero-detail" aria-hidden="true">
            <div className="hero-tilt">
              <HeroWindow state={state} />
            </div>
          </div>
        </div>
        <Marquee />
      </div>
    </section>
  );
}
