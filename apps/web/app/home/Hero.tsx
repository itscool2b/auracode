import { AGENT_NAMES } from "../agents";
import { HandoffView } from "./Capabilities";
import { RotatingAgent } from "./RotatingAgent";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-layout">
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-title" aria-label="One window for your coding agents">
            <span className="hero-line">One window for</span>
            <span className="hero-line">
              <RotatingAgent names={AGENT_NAMES} />.
            </span>
          </h1>
          <p className="hero-lead">
            The coding agents you already use, together in one chat on your machine. Free, with
            nothing to sign up for.
          </p>
          <div className="hero-actions">
            <a className="g-button g-button-primary g-button-44" href="/download">
              Download
            </a>
          </div>
        </div>
        <div className="hero-detail" aria-hidden="true">
          <span className="stage-label">AURACODE / HANDOFF</span>
          <HandoffView />
        </div>
        <p className="hero-aside">
          YOUR AGENTS
          <br />
          YOUR MACHINE
          <br />
          ONE CHAT
        </p>
      </div>
      <div className="product-stage">
        <div className="product-stage-heading">
          <span>THE LOCAL WORKSPACE</span>
          <span>YOUR AGENTS / ONE WINDOW</span>
        </div>
        <figure className="product-frame">
          <picture className="theme-image-dark">
            <source
              type="image/webp"
              srcSet="/images/desktop-dark-480.webp 480w, /images/desktop-dark-960.webp 960w, /images/desktop-dark-1440.webp 1440w, /images/desktop-dark-2240.webp 2240w"
              sizes="(max-width: 1240px) calc(100vw - 40px), 1200px"
            />
            <img
              src="/images/desktop-dark.png"
              width="1440"
              height="760"
              alt="The auracode desktop: project navigation, an agent response with code, and a composer with agent and autonomy controls."
              fetchPriority="high"
            />
          </picture>
          <picture className="theme-image-light">
            <source
              type="image/webp"
              srcSet="/images/desktop-light-480.webp 480w, /images/desktop-light-960.webp 960w, /images/desktop-light-1440.webp 1440w, /images/desktop-light-2240.webp 2240w"
              sizes="(max-width: 1240px) calc(100vw - 40px), 1200px"
            />
            <img
              src="/images/desktop-light.png"
              width="1440"
              height="760"
              alt="The auracode desktop: project navigation, an agent response with code, and a composer with agent and autonomy controls."
            />
          </picture>
        </figure>
      </div>
    </section>
  );
}
