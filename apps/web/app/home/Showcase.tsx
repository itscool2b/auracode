const WIDTHS = [480, 960, 1440, 2240] as const;
const sources = (theme: "light" | "dark") =>
  WIDTHS.map((width) => `/images/desktop-${theme}-${width}.webp ${width}w`).join(", ");
const SIZES = "(max-width: 1327px) calc(100vw - 48px), 1280px";

/**
 * The real desktop, screenshotted from its preview (scripts/product-images.mjs) in the appearance
 * the page is shown in, under one line and in one large rounded frame, where dot.com sets its film.
 */
export function Showcase() {
  return (
    <section className="section showcase" aria-labelledby="showcase-title">
      <div className="inner center-head" data-reveal="">
        <h2 id="showcase-title" className="title">
          The whole workspace, on your machine
        </h2>
      </div>
      <div className="wrap">
        <figure className="showcase-frame" data-reveal="">
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              type="image/webp"
              srcSet={sources("dark")}
              sizes={SIZES}
            />
            <source type="image/webp" srcSet={sources("light")} sizes={SIZES} />
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
