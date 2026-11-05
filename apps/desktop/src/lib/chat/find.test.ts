import { describe, expect, it } from "vitest";
import { findMatches, normalize, shownText } from "./find";
import type { RenderedSegment } from "./transcript";

const segment = (
  key: string,
  items: RenderedSegment["items"],
  end: RenderedSegment["end"] = null,
): RenderedSegment => ({
  key,
  turnId: key,
  partial: false,
  items,
  plan: null,
  usage: null,
  end,
});

const user = (key: string, text: string) => ({ kind: "user" as const, key, text });
const message = (key: string, text: string) => ({
  kind: "message" as const,
  key,
  text,
  completed: true,
});
const tool = (key: string, title: string) =>
  ({
    kind: "tool",
    key,
    id: key,
    toolKind: "read",
    title,
    status: "completed",
    locations: [],
    rawInput: null,
    toolName: null,
    content: [],
    truncated: null,
    display: "completed",
  }) as unknown as RenderedSegment["items"][number];

describe("find in chat", () => {
  it("counts each occurrence in messages and answers, not in tool calls", () => {
    const segments = [
      segment("one", [
        user("u1", "Fix the Sidebar, then the sidebar tests"),
        tool("t1", "Read sidebar.tsx"),
        message("m1", "The **sidebar** now keeps the active chat visible."),
      ]),
    ];
    const matches = findMatches(segments, "  SIDEBAR ");
    expect(matches.map((match) => [JSON.parse(match.rowKey)[1], match.occurrence])).toEqual([
      ["u1", 0],
      ["u1", 1],
      ["m1", 0],
    ]);
    expect(findMatches(segments, "   ")).toEqual([]);
  });

  it("matches across line breaks as the screen shows them, and marks folded work", () => {
    const end: RenderedSegment["end"] = {
      stopReason: "end_turn",
      durationMs: 1000,
      usage: null,
      recovered: false,
    };
    const segments = [
      segment(
        "turn",
        [
          user("u1", "Go"),
          message("m1", "Reading the project\nlist first."),
          tool("t1", "Read src/list.ts"),
          message("m2", "The project list is done."),
        ],
        end,
      ),
    ];
    const matches = findMatches(segments, "project list");
    expect(matches.map((match) => [JSON.parse(match.rowKey)[1], match.folded])).toEqual([
      ["m1", true],
      ["m2", false],
    ]);
  });

  it("reads Markdown as the screen shows it", () => {
    expect(shownText("See [the docs](https://example.com/sidebar) and `sidebar.ts`")).toBe(
      "See the docs and sidebar.ts",
    );
    expect(shownText("```tsx\nconst a = 1;\n```")).toBe("\nconst a = 1;\n");
    expect(shownText("## Heading\n> quoted ~~old~~ text")).toBe("Heading\nquoted old text");
    expect(normalize("Two\n\n  Lines")).toBe("two lines");
  });
});
