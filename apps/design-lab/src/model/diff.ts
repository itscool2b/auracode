/**
 * Line diffs for edit tool calls: exact +/- counts and unified hunks with line numbers, so every
 * direction renders the same "Edited pacing.ts +12 -3" and the same expanded diff.
 *
 * Common leading and trailing lines are trimmed first (an agent's edit touches a small part of a
 * file), then the changed middle is diffed by longest common subsequence. A middle larger than
 * `MAX_DIFF_CELLS` is not diffed line by line: it shows as a plain replacement, marked truncated,
 * with exact counts still given.
 */

export interface DiffLine {
  readonly op: "context" | "add" | "remove";
  readonly text: string;
  /** 1-based line number in the old text; null for an added line. */
  readonly oldLine: number | null;
  /** 1-based line number in the new text; null for a removed line. */
  readonly newLine: number | null;
}

export interface DiffHunk {
  /** `@@ -12,7 +12,9 @@`, as `git diff` prints it. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly path: string;
  /** True when the file did not exist before (the edit created it). */
  readonly isNew: boolean;
  readonly added: number;
  readonly removed: number;
  /** Changed regions with `context` unchanged lines around each; empty when nothing changed. */
  readonly hunks: readonly DiffHunk[];
  /** True when the change was too large to diff line by line (see the module comment). */
  readonly truncated: boolean;
}

/** Unchanged lines shown around each change, as `git diff` does by default. */
export const DEFAULT_CONTEXT = 3;

/** Largest changed middle (old lines x new lines) diffed line by line. */
export const MAX_DIFF_CELLS = 1_000_000;

/** Lines of `text`, without the empty entry a trailing newline would add. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Op = { readonly op: DiffLine["op"]; readonly text: string };

/** The edit script turning `before` into `after`, or null when it would be too large to compute. */
function editScript(before: readonly string[], after: readonly string[]): Op[] | null {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);
  if (oldMiddle.length * newMiddle.length > MAX_DIFF_CELLS) return null;

  const ops: Op[] = before.slice(0, prefix).map((text) => ({ op: "context", text }));

  // lengths[i * cols + j]: LCS length of oldMiddle[i..] and newMiddle[j..].
  const rows = oldMiddle.length + 1;
  const cols = newMiddle.length + 1;
  const lengths = new Uint32Array(rows * cols);
  for (let i = oldMiddle.length - 1; i >= 0; i -= 1) {
    for (let j = newMiddle.length - 1; j >= 0; j -= 1) {
      lengths[i * cols + j] =
        oldMiddle[i] === newMiddle[j]
          ? (lengths[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * cols + j] ?? 0, lengths[i * cols + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < oldMiddle.length || j < newMiddle.length) {
    const oldText = oldMiddle[i];
    const newText = newMiddle[j];
    if (oldText !== undefined && newText !== undefined && oldText === newText) {
      ops.push({ op: "context", text: oldText });
      i += 1;
      j += 1;
    } else if (
      newText !== undefined &&
      (oldText === undefined ||
        (lengths[i * cols + j + 1] ?? 0) >= (lengths[(i + 1) * cols + j] ?? 0))
    ) {
      // Either order is a valid script; reorderChanges puts removals first within each change.
      ops.push({ op: "add", text: newText });
      j += 1;
    } else if (oldText !== undefined) {
      ops.push({ op: "remove", text: oldText });
      i += 1;
    }
  }
  for (const text of before.slice(before.length - suffix)) ops.push({ op: "context", text });
  return reorderChanges(ops);
}

/** Within each run of changed lines, removals first, then additions: how unified diffs read. */
function reorderChanges(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  let removes: Op[] = [];
  let adds: Op[] = [];
  const flush = (): void => {
    out.push(...removes, ...adds);
    removes = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.op === "remove") removes.push(op);
    else if (op.op === "add") adds.push(op);
    else {
      flush();
      out.push(op);
    }
  }
  flush();
  return out;
}

/** Numbers each line of an edit script. */
function numbered(ops: readonly Op[]): DiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return ops.map(({ op, text }) => {
    const line: DiffLine = {
      op,
      text,
      oldLine: op === "add" ? null : oldLine,
      newLine: op === "remove" ? null : newLine,
    };
    if (op !== "add") oldLine += 1;
    if (op !== "remove") newLine += 1;
    return line;
  });
}

function hunkHeader(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
): string {
  const range = (start: number, count: number): string =>
    count === 1 ? `${start}` : `${start},${count}`;
  return `@@ -${range(oldStart, oldLines)} +${range(newStart, newLines)} @@`;
}

/** Groups numbered lines into hunks of changes with `context` lines around each. */
function toHunks(lines: readonly DiffLine[], context: number): DiffHunk[] {
  const changed: number[] = [];
  lines.forEach((line, index) => {
    if (line.op !== "context") changed.push(index);
  });
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    // Hunks whose context would touch or overlap merge into one, as in git.
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const oldLines = slice.filter((line) => line.op !== "add").length;
    const newLines = slice.filter((line) => line.op !== "remove").length;
    const firstOld = slice.find((line) => line.oldLine !== null)?.oldLine ?? 0;
    const firstNew = slice.find((line) => line.newLine !== null)?.newLine ?? 0;
    // A side with no lines in the hunk (a pure addition or removal) names the line before the
    // change, as git does: a new file is "-0,0".
    const oldStart = oldLines === 0 ? firstOldBefore(lines, start) : firstOld;
    const newStart = newLines === 0 ? firstNewBefore(lines, start) : firstNew;
    return {
      header: hunkHeader(oldStart, oldLines, newStart, newLines),
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: slice,
    };
  });
}

function firstOldBefore(lines: readonly DiffLine[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]?.oldLine;
    if (line != null) return line;
  }
  return 0;
}

function firstNewBefore(lines: readonly DiffLine[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]?.newLine;
    if (line != null) return line;
  }
  return 0;
}

/**
 * The diff of one file. `oldText` is null for a new file. `context` is the number of unchanged
 * lines kept around each change.
 */
export function diffFile(
  path: string,
  oldText: string | null,
  newText: string,
  context: number = DEFAULT_CONTEXT,
): FileDiff {
  const before = splitLines(oldText ?? "");
  const after = splitLines(newText);
  const script = editScript(before, after);
  const keep = Number.isFinite(context) && context >= 0 ? Math.floor(context) : DEFAULT_CONTEXT;

  if (script === null) {
    // Too large to diff: one replacement hunk, both sides shortened, exact counts.
    const shown = 200;
    const ops: Op[] = [
      ...before.slice(0, shown).map((text) => ({ op: "remove" as const, text })),
      ...after.slice(0, shown).map((text) => ({ op: "add" as const, text })),
    ];
    return {
      path,
      isNew: oldText === null,
      added: after.length,
      removed: before.length,
      hunks: toHunks(numbered(ops), 0),
      truncated: true,
    };
  }

  const lines = numbered(script);
  return {
    path,
    isNew: oldText === null,
    added: lines.filter((line) => line.op === "add").length,
    removed: lines.filter((line) => line.op === "remove").length,
    hunks: toHunks(lines, keep),
    truncated: false,
  };
}
