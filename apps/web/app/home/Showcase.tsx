const WIDTHS = [480, 960, 1440, 2240] as const;
const sources = (theme: "light" | "dark") =>
  WIDTHS.map((width) => `/images/desktop-${theme}-${width}.webp ${width}w`).join(", ");
/** The frame is the page's column; a phone shows it nearly twice as large, cropped (home.css). */
const SIZES =
  "(max-width: 639px) calc(179vw - 57px), (max-width: 1279px) calc(100vw - 48px), 1232px";

/**
 * The real desktop, screenshotted from its preview (scripts/product-images.mjs) in the appearance
 * the page is shown in, in one large rounded frame across the column, where dot.com sets its film,
 * with one line under it.
 */
export function Showcase() {
  return (
    <div className="film">
      <figure className="wrap film-figure">
        <div className="showcase-frame">
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
              alt="The auracode desktop: projects and chats in the sidebar, an agent's reply with code, the composer with access, account and model controls, and the Changes panel with a file's diff."
            />
          </picture>
        </div>
        <figcaption className="film-caption">The whole workspace, on your machine</figcaption>
      </figure>
    </div>
  );
}
