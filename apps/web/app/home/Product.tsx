import { Words } from "../reveal";

const CALLOUTS = [
  { id: "projects", text: "Projects and chats", x: "9.5%", y: "52%" },
  { id: "composer", text: "Agent, model, access and account", x: "44%", y: "79%" },
  { id: "changes", text: "Every change, file by file", x: "86%", y: "62%" },
] as const;

/**
 * The real desktop, screenshotted from its preview (scripts/product-images.mjs), in a glass bezel.
 * Scrolling it into view lays it flat from a tilt; three glass notes then point at real parts of it.
 */
export function Product() {
  return (
    <section className="section product" aria-labelledby="product-title">
      <div className="wrap product-head">
        <h2 id="product-title" className="title">
          <Words text="One workspace." />{" "}
          <span className="title-soft serif">
            <Words text="Every agent you run." offset={2} />
          </span>
        </h2>
        <p className="lead" data-reveal="">
          Projects, chats, changes and a terminal in a native app for Windows, macOS and Linux. Agents run
          on your machine, through their own command-line tools.
        </p>
      </div>
      <div className="product-stage wrap-wide">
        <figure className="product-frame" data-reveal="trigger">
          <picture>
            <source
              type="image/webp"
              srcSet="/images/desktop-light-480.webp 480w, /images/desktop-light-960.webp 960w, /images/desktop-light-1440.webp 1440w, /images/desktop-light-2240.webp 2240w"
              sizes="(max-width: 1240px) calc(100vw - 40px), 1200px"
            />
            <img
              src="/images/desktop-light.png"
              width="1440"
              height="760"
              decoding="async"
              alt="The auracode desktop: projects and chats in the sidebar, an agent's reply with code, the composer with agent, model and access controls, and the Changes panel listing edited files."
            />
          </picture>
          <figcaption className="callouts" aria-hidden="true">
            {CALLOUTS.map((callout, i) => (
              <span
                key={callout.id}
                className="callout"
                data-side={callout.id}
                style={{ left: callout.x, top: callout.y, transitionDelay: `${600 + i * 160}ms` }}
              >
                <span className="callout-dot" />
                {callout.text}
              </span>
            ))}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
