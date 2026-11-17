import { describe, expect, it } from "vitest";
import { createFocusReturn } from "./focusReturn";

type Listener = (event: { target?: unknown; relatedTarget?: unknown }) => void;

/** Just enough of a page: elements that can be shown, hidden, removed and focused. */
function page() {
  const listeners = new Map<string, Listener[]>();
  const on = (type: string, listener: Listener) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const frames: (() => void)[] = [];
  let now = 0;
  const body = { focus() {} };
  const doc = {
    body,
    documentElement: {},
    activeElement: body as unknown,
    dialogOpen: false,
    addEventListener: on,
    removeEventListener: () => {},
    querySelector: (selector: string) =>
      selector === "dialog[open]" && doc.dialogOpen ? {} : null,
  };
  const win = {
    addEventListener: on,
    removeEventListener: () => {},
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    setTimeout: (callback: () => void) => frames.push(callback),
    performance: { now: () => now },
    getComputedStyle: () => ({ visibility: "visible" }),
  };
  const element = (name: string) => {
    const node = {
      name,
      isConnected: true,
      hidden: false,
      disabled: false,
      closest: (selector: string) => (selector.includes("[hidden]") && node.hidden ? node : null),
      getClientRects: () => (node.isConnected ? [{}] : []),
      focus() {
        if (!node.isConnected || node.hidden) return;
        const before = doc.activeElement;
        doc.activeElement = node;
        if (before !== node) emit("focusin", { target: node });
      },
    };
    return node;
  };
  const emit = (type: string, event: { target?: unknown; relatedTarget?: unknown }) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const blur = () => {
    const before = doc.activeElement;
    doc.activeElement = body;
    emit("focusout", { target: before, relatedTarget: null });
  };
  const flush = () => {
    while (frames.length > 0) frames.shift()?.();
  };
  const focusReturn = createFocusReturn(doc as unknown as Document, win as unknown as Window);
  return {
    doc,
    element,
    blur,
    flush,
    emit,
    focusReturn,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("focus that falls to nothing", () => {
  it("goes back to the terminal that held it once it is on screen again", () => {
    const { doc, element, flush, focusReturn } = page();
    const terminal = element("terminal");
    terminal.focus();
    // Settings hides the chats: focus falls to the page with nothing to take it.
    terminal.hidden = true;
    doc.activeElement = doc.body;
    expect(focusReturn.restore()).toBe(false);
    // Back from Settings.
    terminal.hidden = false;
    focusReturn.restoreSoon();
    flush();
    expect(doc.activeElement).toBe(terminal);
  });

  it("takes the most recent control still in the page, after a palette goes away", () => {
    const { doc, element, blur, flush } = page();
    const terminal = element("terminal");
    const palette = element("palette");
    terminal.focus();
    palette.focus();
    palette.isConnected = false;
    blur();
    flush();
    expect(doc.activeElement).toBe(terminal);
  });

  it("leaves focus where a click on plain text put it, and dialogs to themselves", () => {
    const { doc, element, blur, flush, emit, advance } = page();
    const terminal = element("terminal");
    terminal.focus();
    emit("pointerdown", {});
    blur();
    flush();
    expect(doc.activeElement).toBe(doc.body);
    advance(1000);
    doc.dialogOpen = true;
    blur();
    flush();
    expect(doc.activeElement).toBe(doc.body);
  });

  it("never moves focus a control already holds", () => {
    const { doc, element, flush, focusReturn } = page();
    const terminal = element("terminal");
    const composer = element("composer");
    terminal.focus();
    composer.focus();
    focusReturn.restoreSoon();
    flush();
    expect(doc.activeElement).toBe(composer);
  });

  it("comes back with the window", () => {
    const { doc, element, flush, emit } = page();
    const terminal = element("terminal");
    terminal.focus();
    doc.activeElement = doc.body;
    emit("focus", {});
    flush();
    expect(doc.activeElement).toBe(terminal);
  });
});
