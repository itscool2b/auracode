import { describe, expect, it } from "vitest";
import { type DiffComment, excerptOf, quoteStart, reviewMessage, reviewRequest } from "./review";

const comment = (path: string, line: number, text: string, extra: Partial<DiffComment> = {}) => ({
  id: `${path}:${line}`,
  path,
  line,
  side: "new" as const,
  excerpt: `line ${line}`,
  text,
  ...extra,
});

describe("review comments", () => {
  it("sends every comment in one message, file by file and line by line", () => {
    const message = reviewMessage([
      comment("src/b.ts", 4, "Rename this."),
      comment("src/a.ts", 30, "  Handle the empty list.  "),
      comment("src/a.ts", 2, "Why was this removed?", { side: "old", excerpt: "check()" }),
    ]);
    expect(message).toBe(
      [
        "Please address these comments on your changes:",
        "",
        "src/a.ts, a removed line (line 2 before the change)",
        "> check()",
        "Why was this removed?",
        "",
        "src/a.ts:30",
        "> line 30",
        "Handle the empty list.",
        "",
        "src/b.ts:4",
        "> line 4",
        "Rename this.",
      ].join("\n"),
    );
  });

  it("names one comment as one, and quotes no blank line", () => {
    expect(reviewMessage([comment("main.rs", 1, "Add a test.", { excerpt: "" })])).toBe(
      "Please address this comment on your changes:\n\nmain.rs:1\nAdd a test.",
    );
  });

  it("quotes a line trimmed, and a long one cut", () => {
    expect(excerptOf("    return value;  ")).toBe("return value;");
    const long = excerptOf("x".repeat(500));
    expect(long).toHaveLength(201);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("review requests", () => {
  it("asks about the latest turn's changes, listing the files", () => {
    expect(reviewRequest(null, ["src/a.ts", "src/b.ts"])).toBe(
      [
        "Review the changes from your last turn.",
        "",
        "The files that changed:",
        "- src/a.ts",
        "- src/b.ts",
        "",
        "Look for bugs, regressions, missed cases and anything left unfinished, and list the problems by file and line, the most serious first. Don't change any files yet.",
      ].join("\n"),
    );
  });

  it("names the message it compares from, and counts files past twenty", () => {
    const files = Array.from({ length: 23 }, (_, index) => `f${index}.ts`);
    const request = reviewRequest("Fix the login form\nand its tests", files);
    expect(
      request.startsWith('Review the changes made since my message "Fix the login form".'),
    ).toBe(true);
    expect(request).toContain("- f19.ts\n- and 3 more\n");
    expect(request).not.toContain("f20.ts");
  });

  it("still asks when the message had no words or no files are known", () => {
    expect(reviewRequest("", [])).toBe(
      "Review the changes made since an earlier message of mine.\n\nLook for bugs, regressions, missed cases and anything left unfinished, and list the problems by file and line, the most serious first. Don't change any files yet.",
    );
  });

  it("quotes the start of a long message at a word", () => {
    const quoted = quoteStart(`${"word ".repeat(30)}end`);
    expect(quoted.endsWith("word…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(81);
  });
});
