import { describe, expect, it } from "vitest";
import type { UiField } from "../../bindings";
import { acceptsFormat, formAnswer, initialDrafts, localDateTime, pickChoice } from "./forms";

const text = (
  id: string,
  required: boolean,
  extra: Partial<Extract<UiField["kind"], { type: "text" }>> = {},
): UiField => ({
  id,
  label: id,
  description: null,
  required,
  kind: { type: "text", format: null, min_length: null, max_length: null, default: null, ...extra },
});

describe("MCP forms", () => {
  it("sends only answered fields, each checked as the session checks it", () => {
    const fields: UiField[] = [
      text("name", true, { min_length: 2 }),
      text("note", false),
      {
        id: "count",
        label: "Count",
        description: null,
        required: false,
        kind: { type: "number", integer: true, minimum: 1, maximum: 3, default: null },
      },
      {
        id: "ok",
        label: "OK",
        description: null,
        required: false,
        kind: { type: "boolean", default: null },
      },
    ];
    const drafts = initialDrafts(fields);
    expect(formAnswer(fields, drafts).errors.get("name")).toBe("name is required.");
    drafts.set("name", { kind: "text", text: "Ada" });
    drafts.set("count", { kind: "text", text: "2.5" });
    expect(formAnswer(fields, drafts).errors.get("count")).toBe("Count must be a whole number.");
    drafts.set("count", { kind: "text", text: "2" });
    // An optional field left empty, and an untouched optional checkbox, send nothing.
    expect(formAnswer(fields, drafts).answer).toEqual({
      type: "form",
      accept: true,
      values: [
        { id: "name", value: { type: "text", text: "Ada" } },
        { id: "count", value: { type: "number", number: 2 } },
      ],
    });
  });

  it("starts from the server's defaults and toggles choices by position", () => {
    const tags: UiField = {
      id: "tags",
      label: "Tags",
      description: null,
      required: false,
      kind: {
        type: "choice",
        options: ["a", "b", "c"],
        multiple: true,
        min_items: null,
        max_items: 2,
        default: [0],
      },
    };
    const drafts = initialDrafts([tags]);
    expect(drafts.get("tags")).toEqual({ kind: "choices", selected: [0] });
    const both = pickChoice(tags, pickChoice(tags, drafts.get("tags"), 2), 1);
    expect(both).toEqual({ kind: "choices", selected: [0, 2, 1] });
    expect(formAnswer([tags], new Map([["tags", both]])).errors.get("tags")).toBe(
      "Choose at most 2 for Tags.",
    );
  });

  it("sends a local date and time as the moment it names, as RFC 3339 wants", () => {
    const when = text("when", true, { format: "date_time" });
    const answer = formAnswer(
      [when],
      new Map([["when", { kind: "text", text: "2026-11-05T08:30" }]]),
    );
    const value = answer.answer?.type === "form" ? answer.answer.values[0]?.value : null;
    expect(value?.type === "text" && acceptsFormat("date_time", value.text)).toBe(true);
    expect(value?.type === "text" ? new Date(value.text).getTime() : 0).toBe(
      new Date("2026-11-05T08:30").getTime(),
    );
    expect(localDateTime("not a date")).toBe("");
    for (const [format, good, bad] of [
      ["email", "ops@example.com", "ops@example"],
      ["uri", "https://example.com/x", "example.com"],
      ["date", "2026-11-05", "2026-13-01"],
    ] as const) {
      expect(acceptsFormat(format, good), good).toBe(true);
      expect(acceptsFormat(format, bad), bad).toBe(false);
    }
  });
});
