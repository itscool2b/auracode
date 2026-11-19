import { Wing } from "./Wing";

/**
 * The page's last call, as dot.com closes: one line, one sentence, the two pills, and the wing
 * drawn very large in one hairline under them, running off into the footer as dot.com's outlined
 * bot does. The line draws itself when the section arrives, and the eyes blink and look around.
 */
export function Finale() {
  return (
    <section className="finale" aria-labelledby="finale-title">
      <div className="center-head finale-head">
        <h2 id="finale-title" className="title">
          Your agents. Your machine.
        </h2>
        <p className="lead">Free for Windows, macOS and Linux. No account needed.</p>
        <div className="finale-actions">
          <a className="btn btn-primary btn-lg" href="/download">
            Download for free
          </a>
          <a className="btn btn-quiet btn-lg" href="/changelog">
            Read the changelog
          </a>
        </div>
      </div>
      <div className="inner finale-art" aria-hidden="true" data-reveal="" data-zone="">
        <Wing line look className="finale-wing" />
      </div>
    </section>
  );
}
