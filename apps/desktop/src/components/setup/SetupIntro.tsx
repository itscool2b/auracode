import { Creature, Logo, Shallows, Wordmark } from "@auracode/ui/graphite";
import { SETUP_WATER_DEPTH } from "../Water";

export type IntroMode = "pending" | "live" | "still";

/**
 * The first-launch signature, a short Shallows moment (visual language 6.17): the black window
 * lights up like water seen from below, a seal and a turtle glide in from either side as dark
 * silhouettes and settle where the logo forms, and "auracode" rises under it. Everything is CSS
 * keyframes on transform and opacity, timed inside setup's 1800ms hold.
 *
 * `live` plays it; `still` shows the formed mark on the lit water (later launches and reduced
 * motion); `pending` is the black window before setup has said which. The caller fades it out by
 * setting `leaving`, then unmounts it. Setup's own water sits underneath at the same depth, so the
 * hand-off only fades the mark and the word.
 */
export function SetupIntro({
  mode,
  leaving,
}: {
  readonly mode: IntroMode;
  readonly leaving: false | "slow" | "fast";
}) {
  return (
    <div
      className="setup-intro"
      data-mode={mode}
      data-cinematic={leaving ? undefined : ""}
      data-leaving={leaving || undefined}
      aria-hidden="true"
    >
      {mode === "pending" ? null : (
        <>
          <Shallows className="app-water setup-intro-water" depth={SETUP_WATER_DEPTH} />
          <div className="setup-intro-stage">
            {mode === "live" ? (
              <>
                {/* The glide moves the outer span; the inner one pitches and shrinks late. */}
                <span className="setup-intro-swimmer" data-kind="seal">
                  <span className="setup-intro-body">
                    <Creature kind="seal" />
                  </span>
                </span>
                <span className="setup-intro-swimmer" data-kind="turtle">
                  <span className="setup-intro-body">
                    <Creature kind="turtle" facing="left" />
                  </span>
                </span>
              </>
            ) : null}
            <span className="setup-intro-mark">
              <Logo size={128} />
            </span>
            <span className="setup-intro-word">
              <Wordmark size={32} mark={false} />
            </span>
          </div>
        </>
      )}
    </div>
  );
}
