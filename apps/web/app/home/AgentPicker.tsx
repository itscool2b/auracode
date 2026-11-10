import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { useState } from "react";
import { NewChatView } from "./Scenes";
import { AGENTS, SpriteMark } from "./Sprite";

/**
 * Every agent auracode runs, as chips: choosing one names what holds for it and picks it in the
 * New chat view beside them, as dot.com's chips choose what its phone shows. The chips are plain
 * toggle buttons; the sentence under them is announced when it changes.
 */
export function AgentPicker() {
  const [chosen, setChosen] = useState<AgentBrandId>("claude-code");
  const name = AGENT_BRANDS[chosen].name;

  return (
    <section className="section agents" id="agents" aria-labelledby="agents-title">
      <div className="inner agents-grid">
        <div className="agents-text" data-reveal="">
          <h2 id="agents-title" className="title">
            Bring every agent
          </h2>
          <ul className="agent-chips" aria-label="Agents auracode runs">
            {AGENTS.map((agent) => (
              <li key={agent}>
                <button
                  type="button"
                  className="agent-chip"
                  aria-pressed={agent === chosen}
                  onClick={() => setChosen(agent)}
                >
                  <SpriteMark agent={agent} size={20} />
                  <span>{AGENT_BRANDS[agent].name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="agents-note" aria-live="polite">
            <strong>{name}, as it is.</strong> It runs through its own harness and your own sign-in.
            auracode never reads, stores or proxies its credentials, and any agent that speaks ACP
            works too.
          </p>
          <a className="btn btn-quiet" href="/download">
            Get the app
          </a>
        </div>
        <div className="agents-view" aria-hidden="true" data-reveal="">
          <NewChatView chosen={chosen} />
        </div>
      </div>
    </section>
  );
}
