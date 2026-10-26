import { errorMessage } from "./errors";

/** Where a notice the user can dismiss stands. */
export type DismissState =
  /** On screen. `problem` says why the last attempt to dismiss it failed, if one did. */
  | { readonly status: "shown"; readonly problem: string | null }
  /** Waiting for the shell to confirm. */
  | { readonly status: "dismissing" }
  /** Gone: the shell confirmed. */
  | { readonly status: "dismissed" };

export const SHOWN: DismissState = { status: "shown", problem: null };

/**
 * Dismisses a notice through `acknowledge` (the shell's command), reporting each step to
 * `update`. The notice only goes once the shell confirms: on a failure it stays, with the reason,
 * since a notice that vanished without being acknowledged would just come back on the next launch.
 * Never rejects for a failed `acknowledge`.
 */
export async function dismiss(
  acknowledge: () => Promise<void>,
  update: (state: DismissState) => void,
): Promise<void> {
  update({ status: "dismissing" });
  try {
    await acknowledge();
  } catch (error) {
    update({ status: "shown", problem: errorMessage(error) });
    return;
  }
  update({ status: "dismissed" });
}
