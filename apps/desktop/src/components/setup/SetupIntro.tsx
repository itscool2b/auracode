import { Logo, Wordmark } from "@o7/ui/graphite";

export type IntroMode = "pending" | "live" | "still";

/** The first-launch mark preserves setup's existing timing and skip behavior. */
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
        <div className="setup-intro-stage">
          <span className="setup-intro-mark">
            <Logo size={128} />
          </span>
          <span className="setup-intro-word">
            <Wordmark size={32} mark={false} />
          </span>
        </div>
      )}
    </div>
  );
}
