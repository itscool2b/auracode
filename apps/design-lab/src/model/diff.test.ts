import { describe, expect, it } from "vitest";
import {
  PACING_AFTER,
  PACING_BEFORE,
  PACING_TEST_AFTER,
  PACING_TEST_BEFORE,
} from "../fixture/golden-files";
import { DEFAULT_CONTEXT, diffFile, type FileDiff, splitLines } from "./diff";

const lines = (count: number, prefix = "line"): string =>
  `${Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n")}\n`;

/** The diff as `git diff` body lines: " ctx", "-old", "+new". */
function body(diff: FileDiff): string[] {
  return diff.hunks.flatMap((hunk) => [
    hunk.header,
    ...hunk.lines.map((line) => {
      const mark = line.op === "add" ? "+" : line.op === "remove" ? "-" : " ";
      return `${mark}${line.text}`;
    }),
  ]);
}

describe("splitLines", () => {
  it("drops the empty entry a trailing newline adds, and reads CRLF", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("diffFile", () => {
  it("reports nothing for identical text", () => {
    const diff = diffFile("a.ts", lines(5), lines(5));
    expect(diff).toMatchObject({ added: 0, removed: 0, isNew: false, truncated: false });
    expect(diff.hunks).toEqual([]);
  });

  it("shows a new file as all additions, against -0,0", () => {
    const diff = diffFile("new.ts", null, "a\nb\nc\n");
    expect(diff).toMatchObject({ isNew: true, added: 3, removed: 0 });
    expect(body(diff)).toEqual(["@@ -0,0 +1,3 @@", "+a", "+b", "+c"]);
  });

  it("shows emptying a file as all removals, against +0,0", () => {
    const diff = diffFile("gone.ts", "a\nb\n", "");
    expect(diff).toMatchObject({ isNew: false, added: 0, removed: 2 });
    expect(body(diff)).toEqual(["@@ -1,2 +0,0 @@", "-a", "-b"]);
  });

  it("keeps three lines of context and numbers both sides", () => {
    const before = lines(10);
    const after = before.replace("line 5\n", "line five\n");
    const diff = diffFile("a.ts", before, after);
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(body(diff)).toEqual([
      "@@ -2,7 +2,7 @@",
      " line 2",
      " line 3",
      " line 4",
      "-line 5",
      "+line five",
      " line 6",
      " line 7",
      " line 8",
    ]);
    const changed = diff.hunks[0]?.lines.filter((line) => line.op !== "context");
    expect(changed).toEqual([
      { op: "remove", text: "line 5", oldLine: 5, newLine: null },
      { op: "add", text: "line five", oldLine: null, newLine: 5 },
    ]);
  });

  it("splits distant changes into hunks and merges close ones, as git does", () => {
    const before = lines(30);
    const distant = before.replace("line 3\n", "line three\n").replace("line 25\n", "line 25!\n");
    expect(diffFile("a.ts", before, distant).hunks.map((hunk) => hunk.header)).toEqual([
      "@@ -1,6 +1,6 @@",
      "@@ -22,7 +22,7 @@",
    ]);
    // Changes six lines apart have touching context: one hunk.
    const close = before.replace("line 10\n", "line ten\n").replace("line 17\n", "line 17!\n");
    expect(diffFile("a.ts", before, close).hunks).toHaveLength(1);
  });

  it("lists removals before additions within a change", () => {
    const diff = diffFile("a.ts", "keep\nold 1\nold 2\nkeep\n", "keep\nnew 1\nkeep\n");
    expect(body(diff)).toEqual(["@@ -1,4 +1,3 @@", " keep", "-old 1", "-old 2", "+new 1", " keep"]);
  });

  it("numbers a pure insertion from the line before it", () => {
    const before = lines(3);
    const after = before.replace("line 3\n", "line 3\ninserted\n");
    const diff = diffFile("a.ts", before, after, 0);
    expect(body(diff)).toEqual(["@@ -3,0 +4 @@", "+inserted"]);
  });

  it("treats a bad context as the default", () => {
    const before = lines(20);
    const after = before.replace("line 10\n", "x\n");
    const fallback = diffFile("a.ts", before, after, Number.NaN);
    expect(fallback.hunks[0]?.lines).toHaveLength(2 * DEFAULT_CONTEXT + 2);
  });

  it("does not diff huge changes line by line, but keeps the counts exact", () => {
    const diff = diffFile("big.ts", lines(1200, "old"), lines(1100, "new"));
    expect(diff).toMatchObject({ truncated: true, added: 1100, removed: 1200 });
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines.length).toBeLessThanOrEqual(400);
  });

  it("gives the golden edits their counts and hunks", () => {
    const pacing = diffFile("pacing.ts", PACING_BEFORE, PACING_AFTER);
    expect(pacing).toMatchObject({ added: 19, removed: 5, truncated: false });
    expect(pacing.hunks.map((hunk) => hunk.header)).toEqual([
      "@@ -55,6 +55,14 @@",
      "@@ -64,15 +72,21 @@",
    ]);
    const test = diffFile("pacing.test.ts", PACING_TEST_BEFORE, PACING_TEST_AFTER);
    expect(test).toMatchObject({ added: 40, removed: 18, truncated: false });
    expect(test.hunks).toHaveLength(2);
  });
});
