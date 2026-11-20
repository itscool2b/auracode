import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { type CSSProperties, useState } from "react";
import { NewChatView } from "./Scenes";
import { AGENTS, SpriteMark } from "./Sprite";

/**
 * Every agent o7 runs, as chips: choosing one names what holds for it and picks it in the
 * New chat view beside them, as dot.com's chips choose what its phone shows. A chip at rest is its
 * name in a hairline pill; the chosen one shows its mark and takes its agent's own colour, the one
 * place on the page an agent's colour marks words. The chips are plain toggle buttons; the sentence
 * under them is announced when it changes.
 */
export function AgentPicker() {
  const [chosen, setChosen] = useState<AgentBrandId>("claude-code");
  const name = AGENT_BRANDS[chosen].name;

  return (
    <section className="section agents" id="agents" aria-labelledby="agents-title">
      <div className="inner agents-grid">
        <div className="agents-text">
          <h2 id="agents-title" className="title">
            Bring every agent
          </h2>
          <ul className="agent-chips" aria-label="Agents o7 runs">
            {AGENTS.map((agent) => (
              <li key={agent}>
                <button
                  type="button"
                  className="agent-chip"
                  aria-pressed={agent === chosen}
                  style={{ "--agent": AGENT_BRANDS[agent].accent } as CSSProperties}
                  onClick={() => setChosen(agent)}
                >
                  <SpriteMark agent={agent} size={22} />
                  <span>{AGENT_BRANDS[agent].name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="agents-note" aria-live="polite">
            <strong>{name}, as it is.</strong> It runs through its own harness and your own sign-in.
            o7 never reads, stores or proxies its credentials, and any agent that speaks ACP works
            too.
          </p>
          <a className="btn btn-quiet" href="/download">
            Get the app
          </a>
        </div>
        <div className="agents-view" aria-hidden="true">
          <NewChatView chosen={chosen} />
        </div>
      </div>
    </section>
  );
}
