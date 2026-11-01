import { Words } from "../reveal";
import { Arrow } from "../ui";

/**
 * The night band's last word before the footer: one line, one action, and a halo that drifts
 * toward the pointer (enhance.tsx). The footer continues the same night below it.
 */
export function Finale() {
  return (
    <section
      className="section finale night"
      aria-labelledby="finale-title"
      data-follow=""
      data-zone=""
    >
      <div className="finale-halo" aria-hidden="true" />
      <div className="wrap finale-inner">
        <h2 id="finale-title" className="finale-title">
          <Words text="Your agents." />{" "}
          <span className="serif">
            <Words text="Your machine." offset={2} />
          </span>
        </h2>
        <p className="finale-note" data-reveal="">
          Free for Windows and macOS. No account needed.
        </p>
        <div className="finale-actions" data-reveal="">
          <a className="cta cta-light" href="/download" data-magnetic="">
            Download
            <Arrow direction="down" />
          </a>
          <a className="cta cta-night" href="/changelog">
            Read the changelog
          </a>
        </div>
      </div>
    </section>
  );
}
