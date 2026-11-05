import { describe, expect, it } from "vitest";
import { changeParts, diffLines, MAX_DIFF_LINES, numberLines, splitLines } from "./diff";

const BEFORE = `fn main() {
    let name = "world";
    println!("Hello, {}!", name);
}
`;

const AFTER = `fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

fn main() {
    println!("{}", greet("world"));
}
`;

describe("diffLines", () => {
  it("diffs the demo edit with exact counts", () => {
    const diff = diffLines(BEFORE, AFTER);
    expect(diff.truncated).toBe(false);
    expect(diff.added).toBe(5);
    expect(diff.removed).toBe(2);
    expect(diff.lines.filter((line) => line.op === "same").map((line) => line.text)).toEqual([
      "fn main() {",
      "}",
    ]);
  });

  it("rebuilds both sides from its output", () => {
    const diff = diffLines(BEFORE, AFTER);
    const old = diff.lines.filter((l) => l.op !== "add").map((l) => l.text);
    const next = diff.lines.filter((l) => l.op !== "remove").map((l) => l.text);
    expect(old).toEqual(splitLines(BEFORE));
    expect(next).toEqual(splitLines(AFTER));
  });

  it("shows a changed line as its removal, then its addition", () => {
    const diff = diffLines("a\nold\nb\n", "a\nnew\nb\n");
    expect(diff.lines).toEqual([
      { op: "same", text: "a" },
      { op: "remove", text: "old" },
      { op: "add", text: "new" },
      { op: "same", text: "b" },
    ]);
  });

  it("treats a new file as all additions", () => {
    const diff = diffLines(null, "a\nb\n");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(diff.lines.every((line) => line.op === "add")).toBe(true);
  });

  it("reports no changes for identical text", () => {
    const diff = diffLines("same\n", "same\n");
    expect(diff).toEqual({
      lines: [{ op: "same", text: "same" }],
      added: 0,
      removed: 0,
      truncated: false,
    });
  });

  it("does not diff huge inputs line by line but keeps exact counts", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `line ${i}`).join("\n");
    const diff = diffLines(big, "short");
    expect(diff.truncated).toBe(true);
    expect(diff.removed).toBe(MAX_DIFF_LINES + 10);
    expect(diff.added).toBe(1);
    expect(diff.lines.length).toBeLessThanOrEqual(MAX_DIFF_LINES);
  });
});

describe("splitLines", () => {
  it("drops only the empty entry after a final newline", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });
});

describe("long files", () => {
  it("diffs an edit in a long file line by line, comparing only the stretch between", () => {
    const before = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
    const after = [...before];
    after[1499] = "changed";
    const diff = diffLines(before.join("\n"), after.join("\n"));
    expect(diff.truncated).toBe(false);
    expect([diff.added, diff.removed]).toEqual([1, 1]);
    expect(diff.lines).toHaveLength(3001);
    expect(diff.lines[1499]).toEqual({ op: "remove", text: "line 1500" });
    expect(diff.lines[1500]).toEqual({ op: "add", text: "changed" });
  });
});

describe("changeParts", () => {
  const file = (edits: Record<number, string>, length = 30) => {
    const before = Array.from({ length }, (_, index) => `l${index + 1}`);
    const after = before.map((line, index) => edits[index + 1] ?? line);
    return numberLines(diffLines(before.join("\n"), after.join("\n")).lines);
  };

  it("shows each change with three lines around it and folds the rest", () => {
    const parts = changeParts(file({ 5: "X5", 25: "X25" }), 3);
    expect(parts.map((part) => [part.kind, part.from, part.to])).toEqual([
      ["change", 0, 9],
      ["fold", 9, 22],
      ["change", 22, 30],
      ["fold", 30, 32],
    ]);
    expect(parts[2]).toMatchObject({
      hunk: { old_start: 24, old_lines: 1, new_start: 24, new_lines: 1 },
      added: 1,
      removed: 1,
    });
  });

  it("joins nearby changes, the unchanged lines between them included in the hunk", () => {
    const parts = changeParts(file({ 10: "X10", 14: "X14" }), 3);
    expect(parts.map((part) => part.kind)).toEqual(["fold", "change", "fold"]);
    expect(parts[1]).toMatchObject({
      hunk: { old_start: 9, old_lines: 5, new_start: 9, new_lines: 5 },
      added: 2,
      removed: 2,
    });
  });

  it("counts added and removed lines by the side they belong to", () => {
    const rows = numberLines(diffLines("a\nb\nc\n", "a\nc\nd\ne\n").lines);
    expect(changeParts(rows, 3)).toEqual([
      {
        kind: "change",
        from: 0,
        to: rows.length,
        hunk: { old_start: 1, old_lines: 2, new_start: 1, new_lines: 3 },
        added: 2,
        removed: 1,
      },
    ]);
  });

  it("folds a file with no line changes whole", () => {
    expect(changeParts(file({}), 3)).toEqual([{ kind: "fold", from: 0, to: 30 }]);
  });
});
