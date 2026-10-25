import { DIRECTIONS } from "../directions";
import { Wallpaper } from "../shared/Wallpaper";
import { stageHref } from "./route";
import { LAB_STATES, STATE_INFO } from "./states";

/** The page URL with a different hash: what an iframe needs to load another lab page. */
function pageWith(hash: string): string {
  if (typeof window === "undefined") return hash;
  return `${window.location.pathname}${window.location.search}${hash}`;
}

/**
 * The lab's front page: every direction with a live thumbnail (its settled state, in an iframe so
 * each direction runs alone, styles included) and links to each state.
 */
export function Gallery() {
  return (
    <div className="lab-gallery">
      <Wallpaper id="graphite" />
      <div className="lab-gallery-inner">
        <header className="lab-gallery-header">
          <p className="lab-gallery-kicker">auracode</p>
          <h1 className="lab-gallery-title">Design Lab</h1>
          <p className="lab-gallery-lede">
            Every direction renders the same chat. Open one, then step through its states.
          </p>
        </header>
        <ul className="lab-gallery-grid">
          {DIRECTIONS.map((direction) => (
            <li key={direction.id} className="lab-gallery-card">
              <a
                className="lab-gallery-preview"
                href={stageHref({ direction: direction.id, state: "streaming" })}
              >
                <iframe
                  title={`${direction.name}, settled`}
                  src={pageWith(
                    stageHref({
                      direction: direction.id,
                      state: "settled",
                      thumb: true,
                      hud: false,
                    }),
                  )}
                  loading="lazy"
                  tabIndex={-1}
                />
              </a>
              <div className="lab-gallery-text">
                <h2 className="lab-gallery-name">{direction.name}</h2>
                <p className="lab-gallery-tagline">{direction.tagline}</p>
                <nav className="lab-gallery-states" aria-label={`${direction.name} states`}>
                  {LAB_STATES.map((state) => (
                    <a
                      key={state}
                      href={stageHref({ direction: direction.id, state })}
                      title={STATE_INFO[state].description}
                    >
                      {STATE_INFO[state].label}
                    </a>
                  ))}
                  <a
                    href={stageHref({
                      direction: direction.id,
                      state: "settled",
                      reducedMotion: true,
                    })}
                  >
                    Reduced motion
                  </a>
                </nav>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
