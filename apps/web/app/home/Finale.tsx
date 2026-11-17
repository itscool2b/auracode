import { Logo } from "@auracode/ui/graphite";

/**
 * The page's last call, as dot.com closes: one line, one sentence, the two pills, and the hero's
 * mark (the logo on its disc) drawn very large in one hairline under them, running off into the
 * footer as dot.com's outlined bot does.
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
      <div className="inner finale-art" aria-hidden="true">
        <span className="finale-disc">
          <Logo size={976} />
        </span>
      </div>
    </section>
  );
}
