import { Words } from "../reveal";
import { AppTile, Arrow } from "../ui";

/**
 * The page's last word before the footer: the app as an object, one line, and the one action.
 */
export function Finale() {
  return (
    <section className="section finale" aria-labelledby="finale-title">
      <div className="wrap finale-inner">
        <div className="finale-tile" aria-hidden="true" data-reveal="">
          <AppTile small />
        </div>
        <h2 id="finale-title" className="title finale-title">
          <Words text="Your agents." />{" "}
          <span className="title-soft">
            <Words text="Your machine." offset={2} />
          </span>
        </h2>
        <p className="finale-note" data-reveal="">
          Free for Windows, macOS and Linux. No account needed.
        </p>
        <div className="finale-actions" data-reveal="">
          <a className="btn btn-ink" href="/download">
            Download
            <Arrow direction="down" />
          </a>
          <a className="btn btn-line" href="/changelog">
            Read the changelog
          </a>
        </div>
      </div>
    </section>
  );
}
