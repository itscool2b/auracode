import { useEffect, useState } from "react";
import { Globe } from "../ui";
export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];
const names = ["Claude Code", "Codex", "Pi", "OpenCode", "Cursor", "Hermes"];
export default function Home() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!media.matches)
        timer = setInterval(() => {
          if (!document.hidden) setIndex((i) => (i + 1) % names.length);
        }, 3200);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      clearInterval(timer);
      media.removeEventListener("change", update);
    };
  }, []);
  return (
    <main id="main">
      <section className="hero">
        <p className="eyebrow">
          <span className="signal" /> A LOCAL HOME FOR YOUR AGENTS
        </p>
        <h1 aria-label="One window for your coding agents">
          <span>One window for</span>
          <strong className="rotating-agent" key={index} aria-hidden="true">
            {names[index]}
            <span className="period">.</span>
          </strong>
        </h1>
        <p className="lead">
          The coding agents you already use, together in one chat.
          <br />
          Your subscriptions. Your files. Your machine.
        </p>
        <div className="actions">
          <a className="button" href="/download">
            Get auracode <span aria-hidden="true">↓</span>
          </a>
          <a className="button secondary" href="/signup">
            Create account
          </a>
        </div>
        <p className="caption">Windows + macOS · No account needed for local work</p>
      </section>
      <figure className="product-frame">
        <img
          src="/images/desktop-dark.png"
          width="1440"
          height="900"
          alt="The auracode desktop: project navigation, an agent response with code, and a composer with agent and autonomy controls."
          fetchPriority="high"
        />
        <figcaption>THE REAL APP · DEVELOPMENT PREVIEW</figcaption>
      </figure>
      <section className="agents-section">
        <div>
          <p className="eyebrow">BRING YOUR OWN AGENT</p>
          <h2>
            One place to work.
            <br />
            <span>Room for your favorites.</span>
          </h2>
          <p>
            Keep using the harnesses and subscriptions you trust. auracode brings their
            conversations, tools, and approvals into a common workspace.
          </p>
          <a className="text-link" href="/download">
            See platform availability <span aria-hidden="true">↗</span>
          </a>
        </div>
        <Globe />
      </section>
      <section className="features" aria-label="Built around your work">
        {[
          [
            "01",
            "Local comes first.",
            "Your workspace lives on your computer. Open a folder and work without creating an account.",
          ],
          [
            "02",
            "Stay in the conversation.",
            "Read tool results, answer agent questions, and review changes from one calm workspace.",
          ],
          [
            "03",
            "Carry your work with you.",
            "Optional sync encrypts workspace content on your device. Approval and a recovery key keep access in your hands.",
          ],
        ].map(([n, title, text]) => (
          <article key={n}>
            <span className="eyebrow">{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="closing">
        <p className="eyebrow">LESS SWITCHING. MORE MAKING.</p>
        <h2>Your next project starts here.</h2>
        <a className="button" href="/download">
          Explore downloads <span aria-hidden="true">↗</span>
        </a>
        <p className="caption">Public releases and cloud account service are being prepared.</p>
      </section>
    </main>
  );
}
