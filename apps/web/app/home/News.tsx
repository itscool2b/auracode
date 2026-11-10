/** One centred statement and one quiet pill, where dot.com points at its guides. */
export function News() {
  return (
    <section className="section news" aria-labelledby="news-title">
      <div className="inner center-head" data-reveal="">
        <h2 id="news-title" className="title">
          See what shipped
        </h2>
        <p className="lead">Every change to auracode, in plain words, as it lands.</p>
        <a className="btn btn-quiet btn-lg news-action" href="/changelog">
          Read the changelog
        </a>
      </div>
    </section>
  );
}
