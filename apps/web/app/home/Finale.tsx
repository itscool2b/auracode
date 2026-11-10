import { Logo } from "@auracode/ui/graphite";

/**
 * The page's last call, as dot.com closes: one line, one sentence, the two pills, and the mark
 * drawn very large in a hairline under them, running off the section's foot.
 */
export function Finale() {
  return (
    <section className="finale" aria-labelledby="finale-title">
      <div className="inner center-head" data-reveal="">
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
      <div className="finale-art" aria-hidden="true">
        <Logo size={960} />
      </div>
    </section>
  );
}
