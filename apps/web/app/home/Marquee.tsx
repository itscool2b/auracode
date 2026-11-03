import { AGENT_BRANDS } from "@auracode/ui";
import { AGENTS, SpriteMark } from "./Sprite";

function Track({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="marquee-track" aria-hidden={hidden ? true : undefined}>
      {AGENTS.map((agent) => (
        <li key={agent} className="marquee-item">
          <SpriteMark agent={agent} size={28} />
          <span>{AGENT_BRANDS[agent].name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every agent auracode runs, gliding past under the hero; each lifts under the pointer. A second
 * copy makes the loop seamless and is hidden from assistive technology. Reduced motion stops the
 * glide and lets the row wrap.
 */
export function Marquee() {
  return (
    <div className="marquee-block">
      <section className="marquee" aria-label="Agents auracode runs">
        <Track />
        <Track hidden />
      </section>
      <p className="marquee-note">
        Claude Code, Codex, Cursor and six more, each through its own harness and sign-in. Plus any
        agent that speaks ACP.
      </p>
    </div>
  );
}
