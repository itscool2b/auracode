import { describe, expect, it } from "vitest";
import {
  actsOutsideText,
  cancelsDefault,
  copiesSelection,
  leavesTerminal,
  scrollsTerminal,
  typesText,
} from "./terminalKeys";

const key = (fields: Partial<KeyboardEvent>) =>
  ({
    type: "keydown",
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...fields,
  }) as KeyboardEvent;

describe("keys a terminal keeps from the browser", () => {
  it("cancels the browser's own action for keys that act outside the text", () => {
    for (const name of ["Tab", "PageUp", "PageDown", "F1", "F5", "F11", "F12", "F24"])
      expect(actsOutsideText(key({ key: name })), name).toBe(true);
    // Shift+Tab is the same key: it moved focus out of the terminal.
    expect(actsOutsideText(key({ key: "Tab", shiftKey: true }))).toBe(true);
  });

  it("names the keys whose browser action happens outside the text", () => {
    for (const name of ["a", "A", " ", "Enter", "Backspace", "Delete", "ArrowUp", "Home", "F"])
      expect(actsOutsideText(key({ key: name })), name).toBe(false);
    expect(actsOutsideText(key({ type: "keypress", key: "Tab" }))).toBe(false);
  });

  it("cancels every key the terminal sent but typed text, which a screen reader echoes", () => {
    for (const fields of [
      { key: "Escape" },
      { key: "Enter" },
      { key: "Backspace" },
      { key: "Delete" },
      { key: "ArrowUp" },
      { key: "ArrowLeft", altKey: true },
      { key: "Home" },
      { key: "End" },
      { key: "Tab", shiftKey: true },
      { key: "c", ctrlKey: true },
      { key: "r", ctrlKey: true },
      { key: "F5" },
    ])
      expect(cancelsDefault(key(fields)), JSON.stringify(fields)).toBe(true);
    for (const fields of [{ key: "a" }, { key: "A", shiftKey: true }, { key: " " }, { key: "é" }])
      expect(cancelsDefault(key(fields)), JSON.stringify(fields)).toBe(false);
    expect(cancelsDefault(key({ type: "keyup", key: "Escape" }))).toBe(false);
  });
});

describe("text typed into a terminal", () => {
  it("is the program's however xterm sends it", () => {
    for (const fields of [
      { key: "h" },
      { key: "H", shiftKey: true },
      { key: " " },
      { key: "é" },
      { key: "😀" },
      // AltGr is Ctrl+Alt on Windows: the backslash on a German layout.
      { key: "\\", ctrlKey: true, altKey: true },
      { key: "Dead" },
      { key: "Process" },
      { key: "a", isComposing: true },
    ])
      expect(typesText(key(fields)), JSON.stringify(fields)).toBe(true);
  });

  it("leaves shortcuts and named keys to the other rules", () => {
    for (const fields of [
      { key: "k", ctrlKey: true },
      { key: "1", ctrlKey: true },
      { key: "k", metaKey: true },
      { key: "Enter" },
      { key: "Shift", shiftKey: true },
      { key: "F5" },
    ])
      expect(typesText(key(fields)), JSON.stringify(fields)).toBe(false);
  });
});

describe("leaving a terminal by keyboard", () => {
  it("leaves forward with Ctrl+Tab and back with Ctrl+Shift+Tab", () => {
    expect(leavesTerminal(key({ key: "Tab", ctrlKey: true }))).toBe(1);
    expect(leavesTerminal(key({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe(-1);
  });

  it("gives Tab and Shift+Tab to the program", () => {
    expect(leavesTerminal(key({ key: "Tab" }))).toBeNull();
    expect(leavesTerminal(key({ key: "Tab", shiftKey: true }))).toBeNull();
    expect(leavesTerminal(key({ key: "Tab", ctrlKey: true, altKey: true }))).toBeNull();
    expect(leavesTerminal(key({ key: "Tab", metaKey: true }))).toBeNull();
  });
});

describe("a terminal's own keys", () => {
  it("scrolls its output with Shift+PageUp and Shift+PageDown only", () => {
    expect(scrollsTerminal(key({ key: "PageUp", shiftKey: true }))).toBe(true);
    expect(scrollsTerminal(key({ key: "PageDown", shiftKey: true }))).toBe(true);
    expect(scrollsTerminal(key({ key: "PageUp" }))).toBe(false);
    expect(scrollsTerminal(key({ key: "PageUp", shiftKey: true, ctrlKey: true }))).toBe(false);
  });

  it("copies with Ctrl+Shift+C on Windows and Linux, and leaves macOS its Command+C", () => {
    expect(copiesSelection(key({ key: "C", ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(copiesSelection(key({ key: "C", ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(copiesSelection(key({ key: "c", ctrlKey: true }), false)).toBe(false);
    expect(
      copiesSelection(key({ type: "keyup", key: "C", ctrlKey: true, shiftKey: true }), false),
    ).toBe(false);
  });
});
