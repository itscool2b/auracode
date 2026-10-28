import { describe, expect, it } from "vitest";
import { diffLines, MAX_DIFF_LINES, splitLines } from "./diff";

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
