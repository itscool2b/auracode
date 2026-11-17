import { Logo } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import catalog from "#release-catalog";
import { HeroWindow, useHandoffLoop } from "./HeroWindow";

/**
 * Whether installers are published. Until they are, the action does not name the visitor's system:
 * "Download for Windows" would promise a file the download page cannot give yet.
 */
const PUBLISHED = catalog.release !== null;

/** The visitor's system, once the page runs, so the action can name it. Null until then. */
function usePlatform(): string | null {
  const [platform, setPlatform] = useState<string | null>(null);
  useEffect(() => {
    const agent = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod/.test(agent)) return;
    if (/Windows/.test(agent)) setPlatform("Windows");
    else if (/Macintosh|Mac OS X/.test(agent)) setPlatform("macOS");
    else if (/Linux|X11/.test(agent)) setPlatform("Linux");
  }, []);
  return platform;
}

/** A word of the headline, flipping up into place after the ones before it. */
const word = (i: number) => ({ "--w": i }) as CSSProperties;

/**
 * The page's opening, composed as dot.com's is: the name with its mark set into the line, two
 * grey lines saying what it is, the two pills, and the app itself under them. The headline's words
 * flip up one after another, the lines and the pills settle down out of a blur, and the window
 * follows. The window is live: one session replayed, handed from agent to agent.
 */
export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const state = useHandoffLoop(stage);
  const platform = usePlatform();

  return (
    <section className="hero" aria-labelledby="hero-title" data-zone="">
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title" aria-label="Meet auracode">
          <span className="hero-word" aria-hidden="true" style={word(0)}>
            Meet
          </span>{" "}
          <span className="hero-word hero-mark" aria-hidden="true" style={word(1)}>
            <Logo size={40} />
          </span>{" "}
          <span className="hero-word" aria-hidden="true" style={word(2)}>
            auracode
          </span>
        </h1>
        <p className="hero-lead">
          One window for every coding agent. Run Claude Code, Codex, Cursor and six more side by
          side on your machine, free, with nothing to sign up for.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href="/download">
            {PUBLISHED && platform ? `Download for ${platform}` : "Download"}
          </a>
          <a className="btn btn-quiet btn-lg" href="#features">
            See what it does
          </a>
        </div>
      </div>
      <div className="inner hero-stage" ref={stage}>
        <div className="hero-detail" aria-hidden="true">
          <HeroWindow state={state} />
        </div>
      </div>
    </section>
  );
}
