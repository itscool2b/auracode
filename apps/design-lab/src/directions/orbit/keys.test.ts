import { describe, expect, it } from "vitest";
import { AGENTS } from "../../fixture/workspace";
import type { AgentInfo } from "../../kit";
import {
  agentLetters,
  cursorToAgent,
  cursorToModel,
  escapeAction,
  nextAutonomy,
  openCursor,
  type PickerCursor,
  permissionKey,
  pickerKey,
  submitAction,
} from "./keys";

const START = { agent: "claude-code", model: "claude-opus-5-5", effort: "high" };

function press(cursor: PickerCursor, ...keys: string[]) {
  let current = cursor;
  let action = "none";
  for (const key of keys) {
    const result = pickerKey(current, key, AGENTS, START);
    if (!result) return { cursor: current, action: "unhandled" };
    current = result.cursor;
    action = result.action;
  }
  return { cursor: current, action };
}

describe("picker letters", () => {
  it("gives the known agents their letters and the rest the first free letter", () => {
    const letters = agentLetters(AGENTS);
    expect(Object.fromEntries(letters)).toEqual({
      "claude-code": "C",
      codex: "X",
      pi: "P",
      antigravity: "A",
      hermes: "H",
      cursor: "U",
      grok: "G",
    });
    const first = AGENTS[0];
    if (!first) throw new Error("the fixture has agents");
    const extra: AgentInfo = { ...first, id: "generic", name: "Claude Clone" };
    // C is taken, L is next.
    expect(agentLetters([...AGENTS, extra]).get("generic")).toBe("L");
  });
});

describe("the picker's keyboard", () => {
  const open = openCursor(START);

  it("opens on the current agent, model and effort, in the agent column", () => {
    expect(open).toEqual({ column: 0, ...START });
  });

  it("moves through installed agents only, and lands each on its default model", () => {
    const down = press(open, "ArrowDown").cursor;
    expect(down).toMatchObject({ agent: "codex", model: "gpt-5.5-codex", effort: "medium" });
    // Hermes is the last installed agent: Cursor and Grok Build are skipped.
    expect(
      press(open, "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown").cursor.agent,
    ).toBe("hermes");
    expect(press(open, "ArrowUp").cursor.agent).toBe("claude-code");
    // Back on the starting agent, its own model and effort come back.
    expect(press(open, "ArrowDown", "ArrowUp").cursor).toMatchObject(START);
  });

  it("jumps to agents by letter, and ignores letters of agents that are not installed", () => {
    expect(press(open, "x").cursor.agent).toBe("codex");
    expect(press(open, "P").cursor.agent).toBe("pi");
    expect(press(open, "u").cursor.agent).toBe("claude-code");
    expect(pickerKey(open, "z", AGENTS, START)).toBeNull();
  });

  it("changes column with the arrows and the effort with digits", () => {
    expect(press(open, "ArrowRight").cursor.column).toBe(1);
    const model = press(open, "ArrowRight", "ArrowDown").cursor;
    expect(model).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    expect(press(open, "ArrowRight", "ArrowRight", "ArrowRight").cursor.column).toBe(2);
    expect(press(open, "1").cursor).toMatchObject({ column: 2, effort: "low" });
    expect(press(open, "5").cursor.effort).toBe("max");
    // Haiku has three efforts (High among them, so it stays): 5 means nothing there.
    const haiku = cursorToModel(open, "claude-haiku-5-5", AGENTS);
    expect(haiku.effort).toBe("high");
    expect(press(haiku, "5").cursor.effort).toBe("high");
    expect(press(haiku, "1").cursor.effort).toBe("low");
  });

  it("commits with Enter and closes with Esc", () => {
    expect(press(open, "x", "Enter")).toMatchObject({ action: "commit" });
    expect(press(open, "Escape")).toMatchObject({ action: "close" });
  });

  it("never moves the cursor to an agent that is not installed", () => {
    expect(cursorToAgent(open, "cursor", AGENTS, START)).toBe(open);
    // Antigravity's Flash model has no effort setting: the column stops at the model.
    const flash = cursorToModel(
      cursorToAgent(open, "antigravity", AGENTS, START),
      "gemini-3.5-flash",
      AGENTS,
    );
    expect(flash.effort).toBeNull();
    expect(press({ ...flash, column: 1 }, "ArrowRight").cursor.column).toBe(1);
  });
});

describe("permission keys", () => {
  const free = { focus: "other" as const, menuOpen: false };

  it("answers with 1 to 3 and Esc anywhere, and Enter only from inside the card", () => {
    expect(permissionKey("1", free)).toBe("allow_once");
    expect(permissionKey("Enter", free)).toBeNull();
    expect(permissionKey("Enter", { ...free, inCard: true })).toBe("allow_once");
    expect(permissionKey("2", free)).toBe("allow_chat");
    expect(permissionKey("3", free)).toBe("allow_always");
    expect(permissionKey("Escape", free)).toBe("deny");
    expect(permissionKey("4", free)).toBeNull();
  });

  it("leaves the keys alone while typing, in a menu, or on a focused button for Enter", () => {
    expect(permissionKey("1", { focus: "field", menuOpen: false })).toBeNull();
    expect(permissionKey("1", { focus: "composer-text", menuOpen: false })).toBeNull();
    expect(permissionKey("1", { focus: "other", menuOpen: true })).toBeNull();
    expect(permissionKey("Enter", { ...free, onButton: true, inCard: true })).toBeNull();
    expect(permissionKey("1", { focus: "composer-empty", menuOpen: false })).toBe("allow_once");
  });
});

describe("Esc, one layer at a time", () => {
  const base = {
    pickerOpen: false,
    menuOpen: false,
    permissionPending: false,
    running: false,
    stopping: false,
    focus: "other" as const,
  };

  it("closes the picker, then a menu, then denies, then stops, then forces the stop", () => {
    expect(escapeAction({ ...base, pickerOpen: true, menuOpen: true, running: true })).toBe(
      "close-picker",
    );
    expect(escapeAction({ ...base, menuOpen: true, permissionPending: true })).toBe("close-menu");
    expect(escapeAction({ ...base, permissionPending: true, running: true })).toBe("deny");
    expect(escapeAction({ ...base, running: true })).toBe("stop");
    expect(escapeAction({ ...base, running: true, stopping: true })).toBe("force-stop");
    expect(escapeAction(base)).toBeNull();
  });

  it("leaves Esc to any other layer that is up, so closing a card never stops the turn", () => {
    expect(escapeAction({ ...base, overlayOpen: true, running: true })).toBeNull();
    expect(escapeAction({ ...base, overlayOpen: true, permissionPending: true })).toBeNull();
    expect(escapeAction({ ...base, overlayOpen: false, running: true })).toBe("stop");
  });

  it("keeps Esc for a draft being typed", () => {
    expect(escapeAction({ ...base, running: true, focus: "composer-text" })).toBeNull();
    expect(escapeAction({ ...base, running: true, focus: "composer-empty" })).toBe("stop");
  });
});

describe("the composer's Enter and the autonomy cycle", () => {
  it("sends when idle, queues while working, steers with Cmd where the agent can", () => {
    expect(submitAction({ text: "hi", running: false, meta: false, canSteer: true })).toBe("send");
    expect(submitAction({ text: "hi", running: true, meta: false, canSteer: true })).toBe("queue");
    expect(submitAction({ text: "hi", running: true, meta: true, canSteer: true })).toBe("steer");
    expect(submitAction({ text: "hi", running: true, meta: true, canSteer: false })).toBe("queue");
    expect(submitAction({ text: "  ", running: false, meta: false, canSteer: true })).toBeNull();
  });

  it("cycles through the levels the agent supports", () => {
    const all = ["full_auto", "auto_edit", "ask"] as const;
    expect(nextAutonomy("full_auto", all)).toBe("auto_edit");
    expect(nextAutonomy("ask", all)).toBe("full_auto");
    expect(nextAutonomy("full_auto", ["full_auto"])).toBe("full_auto");
    expect(nextAutonomy("ask", [])).toBe("ask");
  });
});
