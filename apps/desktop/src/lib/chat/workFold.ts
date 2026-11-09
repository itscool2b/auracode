import type { RenderedItem, RenderedSegment } from "./transcript";

/**
 * A finished turn's work, folded under one "Worked for" row so the final answer stands alone
 * (owner, 4 November 2026, after Codex): every item between the person's message and the agent's
 * final answer, the interim messages, tool calls, answered cards and notices among them.
 *
 * A turn folds only when it ended normally on an answer, after some work, and nothing in that
 * work must stay in view: no error, no request still waiting for an answer, and no message of the
 * person's own (a steer). The answer is the run of messages that ends the turn.
 *
 * A turn too long for one history page loads cut, from somewhere in its work (`partial`). It folds
 * the work that loaded, so a long turn ends on its answer like any other (owner, 9 November 2026:
 * long turns showed every step whenever their chat loaded again).
 */
export interface WorkFold {
  /** The first folded item, by its index in the segment's items. */
  readonly from: number;
  /** The first item of the final answer: the fold ends just before it. */
  readonly to: number;
  /**
   * The tool calls folded, or everything folded when there are none: "12 steps". `null` for a
   * cut turn, whose loaded part would undercount.
   */
  readonly steps: number | null;
}

function staysInView(item: RenderedItem): boolean {
  if (item.kind === "error" || item.kind === "user" || item.kind === "gap") return true;
  return (item.kind === "permission" || item.kind === "question") && item.resolution === null;
}

export function workFold(segment: RenderedSegment): WorkFold | null {
  if (segment.turnId === null || segment.end?.stopReason !== "end_turn") return null;
  const items = segment.items;
  // A cut turn's prompt did not load: a message of the person's in it is a steer, kept in view.
  const from = segment.partial ? 0 : items.findIndex((item) => item.kind !== "user");
  if (from < 0) return null;
  let to = items.length;
  while (to > from && items[to - 1]?.kind === "message") to -= 1;
  // No answer at the end, or nothing but the answer.
  if (to === items.length || to <= from) return null;
  const answer = items.slice(to);
  if (!answer.some((item) => item.kind === "message" && item.text.trim() !== "")) return null;
  const work = items.slice(from, to);
  if (!work.some((item) => item.kind !== "message") || work.some(staysInView)) return null;
  const tools = work.filter((item) => item.kind === "tool").length;
  return { from, to, steps: segment.partial ? null : tools || work.length };
}

const CHANGES: ReadonlySet<string> = new Set(["edit", "delete", "move"]);

/**
 * The files the turn's tool calls changed, in the order they were first changed: what the card
 * under the final answer lists. Calls that failed changed nothing and are left out.
 */
export function changedFiles(segment: RenderedSegment): readonly string[] {
  const seen = new Set<string>();
  for (const item of segment.items) {
    if (item.kind !== "tool" || !CHANGES.has(item.toolKind) || item.display === "failed") continue;
    for (const location of item.locations) if (location.path) seen.add(location.path);
  }
  return [...seen];
}

/**
 * "Worked for 1 min 42 s · 12 steps", without a time when the turn did not record one, and without
 * a count when only part of the turn loaded.
 */
export function workedLabel(
  steps: number | null,
  durationMs: number | null,
  format: (ms: number) => string,
): string {
  const time = durationMs === null ? "Worked" : `Worked for ${format(durationMs)}`;
  return steps === null ? time : `${time} · ${steps} ${steps === 1 ? "step" : "steps"}`;
}
