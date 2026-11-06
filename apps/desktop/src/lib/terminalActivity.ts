/**
 * Whether a terminal chat's agent is working, read from what it draws. Claude Code and Codex
 * redraw while they work (their spinners and elapsed time tick at least once a second) and draw
 * nothing while they wait at their prompt. What answers the person, the echo of their typing or a
 * redraw after a resize, is not work.
 */
export class TerminalActivity {
  #lastWork = 0;
  #lastPoke = 0;

  /** The person typed, pasted or resized: what the terminal draws next answers them. */
  poke(now: number): void {
    this.#lastPoke = now;
  }

  /** The terminal drew output. */
  output(now: number): void {
    if (now - this.#lastPoke > ECHO_MS) this.#lastWork = now;
  }

  working(now: number): boolean {
    return this.#lastWork > 0 && now - this.#lastWork < QUIET_MS;
  }
}

/** A chat's terminal: its agent working, the terminal open with its agent quiet, or none. */
export type TerminalUse = "working" | "open" | null;

/** Output this soon after the person's input answers it. */
export const ECHO_MS = 700;

/** An agent quiet this long is waiting at its prompt. */
export const QUIET_MS = 4000;
