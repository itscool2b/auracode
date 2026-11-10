import { AGENT_BRANDS } from "@auracode/ui";
import { AGENTS, SpriteMark } from "./Sprite";

/**
 * Every agent auracode runs, once, in one still row: its own mark and its name. Nothing moves, so
 * the row reads the same with scripts, without them and under reduced motion.
 */
export function Agents() {
  return (
    <section className="agents" id="agents" aria-label="Supported agents">
      <div className="wrap">
        <ul className="agent-wall" aria-label="Agents auracode runs" data-reveal="">
          {AGENTS.map((agent) => (
            <li key={agent} className="agent-cell">
              <SpriteMark agent={agent} size={22} />
              <span>{AGENT_BRANDS[agent].name}</span>
            </li>
          ))}
        </ul>
        <p className="agents-note">
          Each through its own harness and sign-in. Plus any agent that speaks ACP.
        </p>
      </div>
    </section>
  );
}
