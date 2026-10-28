import { Shallows, type SwimmerSpec, Swimmers } from "@auracode/ui/graphite";

/** A turtle crossing low and a seal passing high, both slower than in the hero. */
const CLOSING_SWIMMERS: readonly SwimmerSpec[] = [
  {
    kind: "turtle",
    x: 0.14,
    y: 0.62,
    size: "clamp(88px, 12vw, 172px)",
    tilt: -8,
    speed: 7,
    phase: 6,
  },
  {
    kind: "seal",
    x: 0.84,
    y: 0.3,
    size: "clamp(120px, 16vw, 232px)",
    heading: "left",
    depth: 0.25,
    speed: 11,
    phase: 2,
  },
];

/**
 * Aside's closing panel in Shallows: one lit panel on the column, a centred two-line statement, one
 * line of plain facts and one Download, with a turtle and a seal crossing behind them.
 */
export function Closing() {
  return (
    <section className="section closing" aria-labelledby="closing-title">
      <div className="wrap">
        <div data-reveal="">
          <Shallows className="closing-panel" shimmer>
            <Swimmers swimmers={CLOSING_SWIMMERS} className="closing-swimmers" />
            <h2 id="closing-title" className="title title-stack">
              Your agents. <span>Your machine.</span>
            </h2>
            <p className="closing-note">Free for Windows and macOS. No account needed.</p>
            <div className="closing-actions">
              <a
                className="g-button g-button-primary g-button-44"
                href="/download"
                data-magnetic=""
              >
                <span className="magnetic-label">Download</span>
              </a>
            </div>
          </Shallows>
        </div>
      </div>
    </section>
  );
}
