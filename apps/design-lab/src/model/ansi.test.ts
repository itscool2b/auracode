import { describe, expect, it } from "vitest";
import { GOLDEN_TEST_OUTPUT } from "../fixture/golden";
import { type AnsiSpan, color256, parseAnsi, stripAnsi } from "./ansi";

const ESC = "\u001b";

/** Spans reduced to the fields a test cares about. */
function brief(line: readonly AnsiSpan[] | undefined) {
  return (line ?? []).map((span) => {
    const out: Record<string, unknown> = { text: span.text };
    for (const key of ["fg", "bg"] as const) if (span[key] !== null) out[key] = span[key];
    for (const key of ["bold", "dim", "italic", "underline", "inverse", "strikethrough"] as const) {
      if (span[key]) out[key] = true;
    }
    return out;
  });
}

describe("parseAnsi", () => {
  it("reads plain text as unstyled lines", () => {
    expect(parseAnsi("one\ntwo").map(brief)).toEqual([[{ text: "one" }], [{ text: "two" }]]);
    expect(parseAnsi("")).toEqual([[]]);
  });

  it("applies and clears colours", () => {
    const [line] = parseAnsi(`${ESC}[32mok${ESC}[39m done`);
    expect(brief(line)).toEqual([{ text: "ok", fg: "green" }, { text: " done" }]);
  });

  it("reads bright and background colours", () => {
    const [line] = parseAnsi(
      `${ESC}[90mgrey${ESC}[0m ${ESC}[46;30m RUN ${ESC}[49;39m ${ESC}[101mx`,
    );
    expect(brief(line)).toEqual([
      { text: "grey", fg: "brightBlack" },
      { text: " " },
      { text: " RUN ", fg: "black", bg: "cyan" },
      { text: " " },
      { text: "x", bg: "brightRed" },
    ]);
  });

  it("reads 256-colour and truecolour, and skips malformed extended colours", () => {
    const [line] = parseAnsi(
      `${ESC}[38;5;208ma${ESC}[38;5;9mb${ESC}[48;5;232mc${ESC}[0;38;2;10;20;30md${ESC}[0;38;5me`,
    );
    expect(brief(line)).toEqual([
      { text: "a", fg: "#ff8700" },
      { text: "b", fg: "brightRed" },
      { text: "c", fg: "brightRed", bg: "#080808" },
      { text: "d", fg: "#0a141e" },
      { text: "e" },
    ]);
    expect(color256(16)).toBe("#000000");
    expect(color256(231)).toBe("#ffffff");
    expect(color256(255)).toBe("#eeeeee");
    expect(color256(256)).toBeNull();
  });

  it("tracks bold, dim, italic, underline, inverse and strikethrough", () => {
    const [line] = parseAnsi(
      `${ESC}[1mb${ESC}[22m${ESC}[2md${ESC}[22m${ESC}[3mi${ESC}[23m${ESC}[4mu${ESC}[24m${ESC}[7mv${ESC}[27m${ESC}[9ms${ESC}[29mn`,
    );
    expect(brief(line)).toEqual([
      { text: "b", bold: true },
      { text: "d", dim: true },
      { text: "i", italic: true },
      { text: "u", underline: true },
      { text: "v", inverse: true },
      { text: "s", strikethrough: true },
      { text: "n" },
    ]);
  });

  it("carries style across lines, as a terminal does", () => {
    const lines = parseAnsi(`${ESC}[31mone\ntwo${ESC}[0m\nthree`);
    expect(lines.map(brief)).toEqual([
      [{ text: "one", fg: "red" }],
      [{ text: "two", fg: "red" }],
      [{ text: "three" }],
    ]);
  });

  it("redraws a line on a carriage return, but not on CRLF", () => {
    expect(stripAnsi("progress 10%\rprogress 100%\ndone")).toBe("progress 100%\ndone");
    expect(stripAnsi(`50%\r${ESC}[2K60%`)).toBe("60%");
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
  });

  it("drops cursor movement, line clearing and titles, and keeps hyperlink text", () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gcleared${ESC}[3A`)).toBe("cleared");
    expect(stripAnsi(`${ESC}]0;title${ESC}\\visible`)).toBe("visible");
    expect(stripAnsi(`${ESC}]8;;https://example.com\u0007link${ESC}]8;;\u0007`)).toBe("link");
    expect(stripAnsi(`${ESC}(Btext`)).toBe("text");
    expect(stripAnsi(`${ESC}7saved${ESC}8`)).toBe("saved");
  });

  it("drops a cut-off escape at the end of the output", () => {
    expect(stripAnsi(`end${ESC}`)).toBe("end");
    expect(stripAnsi(`end${ESC}[`)).toBe("end");
    expect(stripAnsi(`end${ESC}]0;a title that never ends`)).toBe("end");
  });

  it("does not open an empty line for a trailing newline", () => {
    expect(parseAnsi("a\nb\n")).toHaveLength(2);
    expect(parseAnsi("a\n\nb")).toHaveLength(3);
  });

  it("reads the golden test run: green checks and a bold green pass count", () => {
    const lines = parseAnsi(GOLDEN_TEST_OUTPUT);
    const text = lines.map((line) => line.map((span) => span.text).join(""));
    expect(text).toContain("> vitest run pacing");
    expect(text.filter((line) => line.includes("✓"))).toHaveLength(20);
    const passed = lines.flat().find((span) => span.text === "19 passed");
    expect(passed).toMatchObject({ fg: "green", bold: true });
    expect(stripAnsi(GOLDEN_TEST_OUTPUT)).not.toContain(ESC);
  });
});
