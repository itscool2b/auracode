/**
 * A line diff for tool results ("Edited src/main.rs +4 -1" and its expanded view) and Changes.
 *
 * Longest common subsequence over lines, which is exact and plenty fast for the edits agents
 * make. The lines both texts start and end with are set aside first, so only the stretch between
 * is compared: an edit in a long file stays cheap. A stretch past `MAX_DIFF_LINES` is not diffed
 * line by line (the table would be too large); it shows as a plain replacement, marked truncated,
 * with exact added/removed counts still given.
 */
import type { LineHunk } from "../bindings";

export interface DiffLine {
  readonly op: "same" | "add" | "remove";
  readonly text: string;
}

export interface LineDiff {
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
  /** True when the input was too large to diff and `lines` is a shortened replacement view. */
  readonly truncated: boolean;
}

/** The longest changed stretch, on either side, compared line by line. */
export const MAX_DIFF_LINES = 2000;
/** How many lines a replacement view lists, half from each side. */
const REPLACEMENT_LINES = 400;

/** Lines of `text`, without the empty entry a trailing newline would add. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(oldText: string | null, newText: string): LineDiff {
  const before = splitLines(oldText ?? "");
  const after = splitLines(newText);

  // Lines both texts start or end with are unchanged; only the stretch between is compared.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const oldMiddle = before.slice(head, before.length - tail);
  const newMiddle = after.slice(head, after.length - tail);

  if (oldMiddle.length > MAX_DIFF_LINES || newMiddle.length > MAX_DIFF_LINES) {
    const lines: DiffLine[] = [
      ...before.slice(0, REPLACEMENT_LINES / 2).map((text) => ({ op: "remove" as const, text })),
      ...after.slice(0, REPLACEMENT_LINES / 2).map((text) => ({ op: "add" as const, text })),
    ];
    return { lines, added: after.length, removed: before.length, truncated: true };
  }

  // lengths[i][j]: LCS length of oldMiddle[i..] and newMiddle[j..].
  const rows = oldMiddle.length + 1;
  const cols = newMiddle.length + 1;
  const lengths = new Uint16Array(rows * cols);
  for (let i = oldMiddle.length - 1; i >= 0; i -= 1) {
    for (let j = newMiddle.length - 1; j >= 0; j -= 1) {
      lengths[i * cols + j] =
        oldMiddle[i] === newMiddle[j]
          ? (lengths[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * cols + j] ?? 0, lengths[i * cols + j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = before.slice(0, head).map((text) => ({ op: "same", text }));
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < oldMiddle.length || j < newMiddle.length) {
    const left = oldMiddle[i];
    const right = newMiddle[j];
    if (left !== undefined && right !== undefined && left === right) {
      lines.push({ op: "same", text: left });
      i += 1;
      j += 1;
    } else if (
      left !== undefined &&
      (right === undefined ||
        (lengths[(i + 1) * cols + j] ?? 0) >= (lengths[i * cols + j + 1] ?? 0))
    ) {
      // On a tie the removal goes first, as in Git: a changed line reads old, then new.
      lines.push({ op: "remove", text: left });
      removed += 1;
      i += 1;
    } else if (right !== undefined) {
      lines.push({ op: "add", text: right });
      added += 1;
      j += 1;
    }
  }
  for (const text of after.slice(after.length - tail)) lines.push({ op: "same", text });
  return { lines, added, removed, truncated: false };
}

/** A diff line with its numbers in the old and the new text, and a key unique in its diff. */
export interface NumberedLine extends DiffLine {
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly key: string;
}

export function numberLines(lines: readonly DiffLine[]): NumberedLine[] {
  let oldLine = 0;
  let newLine = 0;
  return lines.map((line) => {
    const before = line.op === "add" ? null : ++oldLine;
    const after = line.op === "remove" ? null : ++newLine;
    return { ...line, oldLine: before, newLine: after, key: `${before}:${after}:${line.op}` };
  });
}

/** A stretch of a whole file's diff: unchanged lines folded away, or a change and its context. */
export type DiffPart =
  | { readonly kind: "fold"; readonly from: number; readonly to: number }
  | {
      readonly kind: "change";
      readonly from: number;
      readonly to: number;
      /** The changed lines, without their context, as a revert counts them. */
      readonly hunk: LineHunk;
      readonly added: number;
      readonly removed: number;
    };

/**
 * A whole file's diff as its changes, each with up to `context` unchanged lines on either side,
 * and the unchanged stretches between them. Changes closer than twice the context and one line
 * show as one, and a fold never hides fewer than two lines.
 */
export function changeParts(rows: readonly NumberedLine[], context: number): DiffPart[] {
  const groups: [number, number][] = [];
  rows.forEach((row, index) => {
    if (row.op === "same") return;
    const last = groups[groups.length - 1];
    if (last && index - last[1] - 1 <= 2 * context + 1) last[1] = index;
    else groups.push([index, index]);
  });
  const parts: DiffPart[] = [];
  let cursor = 0;
  groups.forEach(([first, last], index) => {
    let from = Math.max(cursor, first - context);
    if (from - cursor < 2) from = cursor;
    if (from > cursor) parts.push({ kind: "fold", from: cursor, to: from });
    let to = Math.min(rows.length, last + context + 1);
    if (index === groups.length - 1 && rows.length - to < 2) to = rows.length;
    let oldStart = 0;
    let newStart = 0;
    for (const row of rows.slice(0, first)) {
      if (row.op !== "add") oldStart += 1;
      if (row.op !== "remove") newStart += 1;
    }
    let oldLines = 0;
    let newLines = 0;
    let added = 0;
    let removed = 0;
    for (const row of rows.slice(first, last + 1)) {
      if (row.op !== "add") oldLines += 1;
      if (row.op !== "remove") newLines += 1;
      if (row.op === "add") added += 1;
      if (row.op === "remove") removed += 1;
    }
    parts.push({
      kind: "change",
      from,
      to,
      hunk: {
        old_start: oldStart,
        old_lines: oldLines,
        new_start: newStart,
        new_lines: newLines,
      },
      added,
      removed,
    });
    cursor = to;
  });
  if (cursor < rows.length) parts.push({ kind: "fold", from: cursor, to: rows.length });
  return parts;
}
