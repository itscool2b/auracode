import { afterEach, describe, expect, it, vi } from "vitest";
import { createXterm } from "./xterm";

const appearance = vi.hoisted(() => ({ change: () => {}, unsubscribe: vi.fn() }));
const theme = vi.hoisted(() => ({ change: () => {}, unsubscribe: vi.fn() }));
vi.mock("../lib/appearance", () => ({
  subscribeAppearance: (listener: () => void) => {
    appearance.change = listener;
    return appearance.unsubscribe;
  },
  subscribeTheme: (listener: () => void) => {
    theme.change = listener;
    return theme.unsubscribe;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("terminal appearance", () => {
  it("updates existing and detached terminal views without replacing their buffers or sessions", () => {
    const root = {};
    let colors: Record<string, string> = { "--g-terminal-bg": "#141516", "--g-code-fg": "#d4d4d4" };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("getComputedStyle", (element: unknown) => {
      expect(element).toBe(root);
      return { getPropertyValue: (name: string) => colors[name] ?? "" };
    });
    const dispose = vi.fn();
    const buffer = { active: { cursorY: 37 } };
    const Terminal = vi.fn(
      class {
        constructor(readonly options: Record<string, unknown>) {}
        buffer = buffer;
        parser = { registerOscHandler: () => ({ dispose: vi.fn() }) };
        attachCustomKeyEventHandler = vi.fn();
        onKey = () => ({ dispose: vi.fn() });
        loadAddon = vi.fn();
        open = vi.fn();
        resize = vi.fn();
        dispose = dispose;
      },
    );
    const modules = {
      Terminal,
      FitAddon: class {
        proposeDimensions() {
          return undefined;
        }
      },
      WebglAddon: class {
        onContextLoss() {}
      },
    } as unknown as Parameters<typeof createXterm>[0];
    const view = createXterm(modules, {} as HTMLElement, { inputLabel: "Terminal" });
    colors = { "--g-terminal-bg": "#f4f4f5", "--g-code-fg": "#24292f", "--g-ansi-red": "#b42318" };
    appearance.change();
    expect(Terminal).toHaveBeenCalledTimes(1);
    expect(view.term.buffer).toBe(buffer);
    expect(view.term.options.theme).toMatchObject({
      background: "#f4f4f5",
      foreground: "#24292f",
      red: "#b42318",
    });
    // A new theme repaints it too, in the same appearance.
    colors = { "--g-terminal-bg": "#ede9e0", "--g-code-fg": "#1f1d1a", "--g-ansi-red": "#a33a1e" };
    theme.change();
    expect(view.term.options.theme).toMatchObject({
      background: "#ede9e0",
      foreground: "#1f1d1a",
      red: "#a33a1e",
    });
    expect(Terminal).toHaveBeenCalledTimes(1);
    expect(view.term.buffer).toBe(buffer);
    expect(dispose).not.toHaveBeenCalled();
    view.dispose();
    expect(appearance.unsubscribe).toHaveBeenCalledOnce();
    expect(theme.unsubscribe).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
