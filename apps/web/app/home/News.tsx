// The repository's CHANGELOG.md, parsed when the site is built (scripts/changelog.ts).
import days from "../changelog-data";

const CHANGES = days.reduce((count, day) => count + day.entries.length, 0);
const LATEST = days[0]?.label;

/** A line's text with its `code` set in the mono face, as the changelog page sets it. */
function Inline({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed line; the position is identity.
        i % 2 === 1 ? <code key={i}>{part}</code> : part,
      )}
    </>
  );
}

/**
 * What shipped, where dot.com points at its guides: a centred title and one line, the three latest
 * days of the changelog as cards (the day set large on a block, then how many changes and the
 * first of them), and one quiet pill. The line counts the changelog itself, so it is true on every
 * build.
 */
export function News() {
  return (
    <section className="section news" aria-labelledby="news-title">
      <div className="center-head">
        <h2 id="news-title" className="title">
          See what shipped
        </h2>
        <p className="lead">
          {LATEST
            ? `${CHANGES} changes so far, each in plain words. The latest landed on ${LATEST}.`
            : "Every change to o7, in plain words."}
        </p>
      </div>
      {days.length ? (
        <ul className="inner news-grid">
          {days.slice(0, 3).map((day) => {
            const [number, ...month] = day.label.split(" ");
            // The day's first change a person would notice; work behind the scenes waits its turn.
            const first =
              day.entries.find((entry) => !entry.head.startsWith("Behind the scenes")) ??
              day.entries[0];
            return (
              <li key={day.date}>
                <a className="card news-card" href={`/changelog#day-${day.date}`}>
                  <time className="news-art" dateTime={day.date}>
                    <span className="news-day">{number}</span>{" "}
                    <span className="news-month">{month.join(" ")}</span>
                  </time>
                  <span className="news-body">
                    <span className="news-count">
                      {day.entries.length} {day.entries.length === 1 ? "change" : "changes"}
                    </span>
                    {first ? (
                      <span className="news-text">
                        <Inline text={first.head} />
                        {first.rest ? (
                          <>
                            {" "}
                            <Inline text={first.rest} />
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="news-action">
        <a className="btn btn-quiet btn-lg" href="/changelog">
          Read the changelog
        </a>
      </div>
    </section>
  );
}
