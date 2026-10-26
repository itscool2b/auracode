import { describe, expect, it } from "vitest";
import { type EscapeAction, enterAction, escapeAction, type KeyContext } from "./keys";

const idle: KeyContext = {
  menuOpen: false,
  pickerOpen: false,
  permissionPending: false,
  working: false,
  stopping: false,
  focus: "other",
};

const esc = (overrides: Partial<KeyContext>): EscapeAction | null =>
  escapeAction({ ...idle, ...overrides });

describe("Escape, topmost layer first", () => {
  it("closes the picker and leaves a pending permission alone", () => {
    // The permission scene with the picker open: Escape must only close the picker.
    const scene = { permissionPending: true, working: true, pickerOpen: true };
    expect(esc(scene)).toBe("close-picker");
    expect(esc({ ...scene, focus: "popover" })).toBe("close-picker");
    // Once the picker is closed, the next Escape answers the permission.
    expect(esc({ ...scene, pickerOpen: false })).toBe("reject");
  });

  it("closes the autonomy menu before the picker, the permission and the turn", () => {
    expect(esc({ menuOpen: true, pickerOpen: true, permissionPending: true, working: true })).toBe(
      "close-menu",
    );
  });

  it("stops a running turn, and forces the stop on the second press", () => {
    expect(esc({ working: true })).toBe("stop");
    expect(esc({ working: true, focus: "composer-empty" })).toBe("stop");
    expect(esc({ working: true, stopping: true })).toBe("force-stop");
  });

  it("leaves Escape to a draft or a search field", () => {
    expect(esc({ working: true, focus: "composer-text" })).toBeNull();
    expect(esc({ permissionPending: true, focus: "field" })).toBeNull();
    // A menu still closes from anywhere.
    expect(esc({ pickerOpen: true, focus: "composer-text" })).toBe("close-picker");
  });

  it("does nothing when nothing is open or running", () => {
    expect(esc({})).toBeNull();
  });
});

describe("Enter answers a pending permission", () => {
  const pending: KeyContext = { ...idle, permissionPending: true, working: true };

  it("allows once on Enter and always on Cmd+Enter", () => {
    expect(enterAction(pending, { meta: false, onButton: false })).toBe("allow-once");
    expect(enterAction(pending, { meta: true, onButton: false })).toBe("allow-always");
    expect(enterAction(pending, { meta: true, onButton: true })).toBe("allow-always");
  });

  it("lets a focused button, a menu or a text field keep Enter", () => {
    expect(enterAction(pending, { meta: false, onButton: true })).toBeNull();
    expect(
      enterAction(
        { ...pending, focus: "popover", pickerOpen: true },
        { meta: false, onButton: true },
      ),
    ).toBeNull();
    expect(
      enterAction({ ...pending, pickerOpen: true }, { meta: true, onButton: false }),
    ).toBeNull();
    expect(
      enterAction({ ...pending, focus: "composer-empty" }, { meta: false, onButton: false }),
    ).toBeNull();
    expect(enterAction({ ...pending, focus: "field" }, { meta: true, onButton: false })).toBeNull();
  });

  it("does nothing without a pending permission", () => {
    expect(enterAction(idle, { meta: false, onButton: false })).toBeNull();
  });
});
