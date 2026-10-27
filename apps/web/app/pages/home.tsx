import { AGENT_NAMES } from "../agents";
import { AgentWheel } from "../home/AgentWheel";
import { Capabilities } from "../home/Capabilities";
import { Closing } from "../home/Closing";
import { Faq } from "../home/Faq";
import { Features } from "../home/Features";
import { Stage } from "../home/Stage";
import { Stats } from "../home/Stats";
import { Arrow } from "../ui";

export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];

function Agents() {
  return (
    <section className="section agents" aria-labelledby="agents-title">
      <div className="frame">
        <div className="section-inner agents-grid">
          <h2 id="agents-title" className="agents-title" data-reveal="">
            Bring the agents you already pay for.{" "}
            <span>auracode runs each one through its own harness.</span>
          </h2>
          <div className="agents-names">
            <AgentWheel names={AGENT_NAMES} />
            <ul className="agent-list">
              {AGENT_NAMES.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
          <div className="agents-more" data-reveal="">
            <a className="g-button g-button-outline g-button-36" href="/download">
              Platform availability <Arrow />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main id="main" className="home">
      <Stage />
      <Agents />
      <Capabilities />
      <Features />
      <Stats />
      <Faq />
      <Closing />
    </main>
  );
}
