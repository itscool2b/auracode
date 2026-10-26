import { useRef } from "react";
import { useBornLive } from "./ui";

/**
 * Streaming text, Aurora style: every delta "inks in", fading up from the agent's glow colour to
 * plain text, while everything before it stays exactly where it was. Two pieces:
 *
 * - `closeOpenMarkers` closes inline markers a growing block opened but has not closed yet, so a
 *   half-streamed "**Jitter tole" is bold at once rather than showing asterisks that vanish (and
 *   reflow the line) when the closing marker lands.
 * - `useInk` remembers, per block, where each delta started in the block's visible text. The
 *   renderer wraps each delta in its own keyed span, so React keeps the spans of earlier deltas and
 *   their one-shot CSS animation is never restarted.
 */

/** Where the visible text of one block grew: text before `oldEnd` was there when it mounted. */
export interface Ink {
  readonly oldEnd: number;
  /** Visible-text offsets where each later delta began, ascending. */
  readonly starts: readonly number[];
}

interface InkState {
  oldEnd: number;
  starts: number[];
  length: number;
}

/**
 * Tracks how a block's visible text grows. A block that mounted with the window starts "old"
 * (frozen frames and finished chats never animate); one that mounted live inks in from its first
 * character. Text that shrinks (a reparse) resets to old, so nothing flickers.
 */
export function useInk(length: number): Ink {
  const live = useBornLive();
  const state = useRef<InkState | null>(null);
  if (state.current === null) {
    state.current = live
      ? { oldEnd: 0, starts: length > 0 ? [0] : [], length }
      : { oldEnd: length, starts: [], length };
  } else if (length > state.current.length) {
    state.current.starts.push(state.current.length);
    state.current.length = length;
  } else if (length < state.current.length) {
    state.current = { oldEnd: length, starts: [], length };
  }
  return state.current;
}

/**
 * Closes the inline code, bold and italic markers that `text` leaves open, innermost first. A marker
 * with nothing after it yet is dropped instead of closed, so it never renders as an empty span.
 * Underscores are left alone: they are usually snake_case, not emphasis.
 */
export function closeOpenMarkers(text: string): string {
  let codeAt = -1;
  let strongAt = -1;
  let emAt = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`") {
      let run = 1;
      while (text[index + run] === "`") run += 1;
      if (run === 1) codeAt = codeAt === -1 ? index : -1;
      index += run - 1;
      continue;
    }
    if (codeAt !== -1) continue;
    if (char === "*" && text[index + 1] === "*") {
      strongAt = strongAt === -1 ? index : -1;
      index += 1;
      continue;
    }
    if (char === "*") {
      const next = text[index + 1];
      if (emAt === -1) {
        if (next !== undefined && next !== " ") emAt = index;
      } else if (text[index - 1] !== " ") {
        emAt = -1;
      }
    }
  }
  const open = [
    { at: codeAt, marker: "`" },
    { at: strongAt, marker: "**" },
    { at: emAt, marker: "*" },
  ]
    .filter((entry) => entry.at !== -1)
    .sort((a, b) => b.at - a.at);
  let result = text;
  let closers = "";
  for (const { at, marker } of open) {
    if (result.slice(at + marker.length).trim() === "") result = result.slice(0, at);
    else closers += marker;
  }
  if (closers === "") return result;
  // Closers go before trailing spaces: "*foo *" is not emphasis, "*foo* " is.
  const trailing = /\s*$/.exec(result)?.[0] ?? "";
  return `${result.slice(0, result.length - trailing.length)}${closers}${trailing}`;
}
