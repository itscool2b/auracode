// The repository's CHANGELOG.md, parsed when the site is built (scripts/changelog.ts).
import days from "../changelog-data";

const CHANGES = days.reduce((count, day) => count + day.entries.length, 0);
const LATEST = days[0]?.label;

/**
 * One centred statement and one quiet pill, where dot.com points at its guides. The line under the
 * title counts the changelog itself, so it is true on every build.
 */
export function News() {
  return (
    <section className="section news" aria-labelledby="news-title">
      <div className="inner center-head" data-reveal="">
        <h2 id="news-title" className="title">
          See what shipped
        </h2>
        <p className="lead">
          {LATEST
            ? `${CHANGES} changes so far, each in plain words. The latest landed on ${LATEST}.`
            : "Every change to auracode, in plain words."}
        </p>
        <a className="btn btn-quiet btn-lg news-action" href="/changelog">
          Read the changelog
        </a>
      </div>
    </section>
  );
}
