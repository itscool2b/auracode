import { Shallows, type SwimmerSpec, Swimmers } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { AGENT_NAMES } from "../agents";
import { RotatingAgent } from "./RotatingAgent";

/*
 * Two near creatures and one far turtle, seen from below against the lit surface (visual language
 * 5.3). Anchored by fractions of the hero's water layer, which spans the panel's upper part, so the
 * silhouettes keep to the open water around the headline on every width.
 */
const HERO_SWIMMERS: readonly SwimmerSpec[] = [
  {
    kind: "turtle",
    x: 0.16,
    y: 0.4,
    size: "clamp(112px, 17vw, 252px)",
    tilt: -10,
    phase: 3,
  },
  {
    kind: "seal",
    x: 0.8,
    y: 0.28,
    size: "clamp(150px, 23vw, 336px)",
    heading: "left",
    phase: 9,
  },
  {
    kind: "turtle",
    x: 0.72,
    y: 0.66,
    size: "clamp(56px, 6.6vw, 96px)",
    depth: 0.7,
    speed: 6,
    tilt: -18,
    phase: 1,
    className: "hero-far",
  },
];

/**
 * The hero: one Shallows panel lit from the top, the nav over its surface, seals and turtles
 * passing as dark silhouettes, a centred two-line headline whose agent name rotates, one lead, one
 * Download, and the real app floating in the deep water below (visual language 5.3).
 */
export function Hero() {
  return (
    <Shallows as="section" shimmer className="hero" aria-labelledby="hero-title">
      <Swimmers swimmers={HERO_SWIMMERS} className="hero-swimmers" />
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title" aria-label="One window for your coding agents">
          <span className="hero-line" aria-hidden="true">
            <span className="hero-word" style={{ "--i": 0 } as CSSProperties}>
              One
            </span>{" "}
            <span className="hero-word" style={{ "--i": 1 } as CSSProperties}>
              window
            </span>{" "}
            <span className="hero-word" style={{ "--i": 2 } as CSSProperties}>
              for
            </span>
          </span>
          <span className="hero-line" aria-hidden="true">
            <span className="hero-word" style={{ "--i": 3 } as CSSProperties}>
              <RotatingAgent names={AGENT_NAMES} />.
            </span>
          </span>
        </h1>
        <p className="hero-lead">
          The coding agents you already use, together in one chat on your machine. Free, with
          nothing to sign up for.
        </p>
        <div className="hero-actions">
          <a className="g-button g-button-primary g-button-44" href="/download" data-magnetic="">
            <span className="magnetic-label">Download</span>
          </a>
        </div>
      </div>
      <figure className="product-frame">
        <picture>
          <source
            type="image/webp"
            srcSet="/images/desktop-dark-480.webp 480w, /images/desktop-dark-960.webp 960w, /images/desktop-dark-1440.webp 1440w, /images/desktop-dark-2240.webp 2240w"
            sizes="(max-width: 620px) calc(100vw - 60px), (max-width: 1240px) calc(100vw - 120px), 1120px"
          />
          <img
            src="/images/desktop-dark.png"
            width="1440"
            height="900"
            alt="The auracode desktop: project navigation, an agent response with code, and a composer with agent and autonomy controls."
            fetchPriority="high"
          />
        </picture>
      </figure>
    </Shallows>
  );
}
