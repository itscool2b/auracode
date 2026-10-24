/**
 * A line diff for tool results ("Edited src/main.rs +4 -1" and its expanded view).
 *
 * Longest common subsequence over lines, which is exact and plenty fast for the edits agents
 * report. Inputs past `MAX_DIFF_LINES` are not diffed line by line (the table would be too large);
 * they show as a plain replacement, marked truncated, with exact added/removed counts still given.
 */

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

export const MAX_DIFF_LINES = 400;

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

  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    const lines: DiffLine[] = [
      ...before.slice(0, MAX_DIFF_LINES / 2).map((text) => ({ op: "remove" as const, text })),
      ...after.slice(0, MAX_DIFF_LINES / 2).map((text) => ({ op: "add" as const, text })),
    ];
    return { lines, added: after.length, removed: before.length, truncated: true };
  }

  // lengths[i][j]: LCS length of before[i..] and after[j..].
  const rows = before.length + 1;
  const cols = after.length + 1;
  const lengths = new Uint16Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i * cols + j] =
        before[i] === after[j]
          ? (lengths[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * cols + j] ?? 0, lengths[i * cols + j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const left = before[i];
    const right = after[j];
    if (left !== undefined && right !== undefined && left === right) {
      lines.push({ op: "same", text: left });
      i += 1;
      j += 1;
    } else if (
      right !== undefined &&
      (left === undefined || (lengths[i * cols + j + 1] ?? 0) >= (lengths[(i + 1) * cols + j] ?? 0))
    ) {
      lines.push({ op: "add", text: right });
      added += 1;
      j += 1;
    } else if (left !== undefined) {
      lines.push({ op: "remove", text: left });
      removed += 1;
      i += 1;
    }
  }
  return { lines, added, removed, truncated: false };
}
