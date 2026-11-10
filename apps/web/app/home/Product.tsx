import { Words } from "../reveal";

/**
 * The real desktop, screenshotted from its preview (scripts/product-images.mjs), in a plain bezel:
 * a title and what it means above it, and nothing drawn over it.
 */
export function Product() {
  return (
    <section className="section product" aria-labelledby="product-title">
      <div className="wrap">
        <div className="split-head">
          <h2 id="product-title" className="title">
            <Words text="One workspace." />{" "}
            <span className="title-soft">
              <Words text="Every agent you run." offset={2} />
            </span>
          </h2>
          <div className="split-side" data-reveal="">
            <p className="lead">
              Projects, chats, changes and a terminal in a native app for Windows, macOS and Linux.
              Agents run on your machine, through their own command-line tools.
            </p>
            <a className="text-link" href="/download">
              Get the app
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <figure className="product-frame" data-reveal="">
          <picture>
            <source
              type="image/webp"
              srcSet="/images/desktop-light-480.webp 480w, /images/desktop-light-960.webp 960w, /images/desktop-light-1440.webp 1440w, /images/desktop-light-2240.webp 2240w"
              sizes="(max-width: 1247px) calc(100vw - 56px), 1104px"
            />
            <img
              src="/images/desktop-light.png"
              width="1440"
              height="760"
              decoding="async"
              alt="The auracode desktop: projects and chats in the sidebar, an agent's reply with code, the composer with agent, model and access controls, and the Changes panel listing edited files."
            />
          </picture>
        </figure>
      </div>
    </section>
  );
}
