import { describe, expect, it, vi } from "vitest";
import type { ProjectShellChoice, ProjectToolsReview } from "../bindings";
import type { ProjectToolsApi } from "./projectTools";
import type { TerminalState, TerminalTransport } from "./terminal";
import {
  clampHeight,
  holdsShell,
  nextTitle,
  PANEL_HEIGHT_DEFAULT,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  type RuntimeFactory,
  TerminalPanels,
  type TerminalRuntime,
} from "./terminalPanel";

const SHELLS: ProjectShellChoice[] = [
  { id: "power_shell", label: "PowerShell", program: "powershell.exe", args: ["-NoProfile"] },
  { id: "command_prompt", label: "Command Prompt", program: "cmd.exe", args: ["/D"] },
];

function review(token: string, shells = SHELLS): ProjectToolsReview {
  return { token, folder: "C:/worktrees/sidebar", shells, editors: [], expires_at: 1 };
}

interface FakeRuntime extends TerminalRuntime {
  readonly label: string;
  readonly transport: TerminalTransport;
  status(status: TerminalState): void;
  disposed: boolean;
}

function rig(options: { reviews?: (() => Promise<ProjectToolsReview>)[]; limit?: number } = {}) {
  let count = 0;
  const reviews = options.reviews ?? [];
  const api: ProjectToolsApi = {
    review: vi.fn(async () => {
      const next = reviews.shift();
      return next ? next() : review(`token-${++count}`);
    }),
    openEditor: vi.fn(async () => {}),
    terminal: vi.fn(
      (chatId: string, token: string, shell: string) =>
        ({ chatId, token, shell }) as unknown as TerminalTransport,
    ),
  };
  const runtimes: FakeRuntime[] = [];
  const factory: RuntimeFactory = ({ transport, label, onStatus }) => {
    const runtime: FakeRuntime = {
      label,
      transport,
      disposed: false,
      status: onStatus,
      attach: vi.fn(),
      detach: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(async () => {
        runtime.disposed = true;
      }),
    };
    runtimes.push(runtime);
    return runtime;
  };
  const panels = new TerminalPanels(api, factory, options.limit);
  const tab = (id: string | null) => (id ? panels.getSnapshot().tabs.get(id) : undefined);
  return { api, panels, runtimes, tab };
}

describe("the docked terminal panels", () => {
  it("shows a reviewed shell in the chat's folder on the first toggle, and only then", async () => {
    const { api, panels, runtimes, tab } = rig();
    expect(panels.panel("chat").open).toBe(false);
    expect(api.review).not.toHaveBeenCalled();
    panels.toggle("chat");
    const panel = panels.panel("chat");
    expect(panel.open).toBe(true);
    expect(tab(panel.active)?.status).toEqual({ state: "reviewing" });
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    expect(api.review).toHaveBeenCalledWith("chat");
    expect(api.terminal).toHaveBeenCalledWith("chat", "token-1", "power_shell");
    const opened = tab(panels.panel("chat").active);
    expect(opened).toMatchObject({
      title: "PowerShell",
      folder: "C:/worktrees/sidebar",
      shell: SHELLS[0],
      status: { state: "starting" },
    });
    expect(runtimes[0]?.label).toBe("PowerShell terminal");
    expect(panels.panel("chat").shells).toEqual(SHELLS);
  });

  it("hides without stopping the shell and shows the same tab again", async () => {
    const { api, panels, runtimes } = rig();
    panels.show("chat");
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    panels.toggle("chat");
    expect(panels.panel("chat")).toMatchObject({ open: false });
    expect(panels.panel("chat").tabs).toHaveLength(1);
    expect(runtimes[0]?.disposed).toBe(false);
    panels.toggle("chat");
    expect(panels.panel("chat").open).toBe(true);
    expect(api.review).toHaveBeenCalledTimes(1);
  });

  it("asks for focus when the person shows, adds or picks a terminal, never when hiding", async () => {
    const { panels, runtimes } = rig();
    panels.show("chat");
    const shown = panels.panel("chat").focus;
    await vi.waitFor(() => expect(runtimes).toHaveLength(1));
    expect(shown).toBeGreaterThan(0);
    await panels.newTab("chat");
    const added = panels.panel("chat").focus;
    expect(added).toBeGreaterThan(shown);
    panels.hide("chat");
    expect(panels.panel("chat").focus).toBe(added);
    const first = panels.panel("chat").tabs[0] ?? "";
    panels.select("chat", first);
    expect(panels.panel("chat")).toMatchObject({ active: first, focus: added + 1 });
    // Arrow keys on the tabs move the selection and leave focus on the tabs.
    panels.select("chat", panels.panel("chat").tabs[1] ?? "", false);
    expect(panels.panel("chat").focus).toBe(added + 1);
  });

  it("numbers tabs per chat, takes a chosen shell and keeps chats apart", async () => {
    const { api, panels, tab } = rig();
    await panels.newTab("chat");
    await panels.newTab("chat");
    await panels.newTab("chat", "command_prompt");
    await panels.newTab("other");
    const titles = panels.panel("chat").tabs.map((id) => tab(id)?.title);
    expect(titles).toEqual(["PowerShell", "PowerShell 2", "Command Prompt"]);
    expect(api.terminal).toHaveBeenLastCalledWith("other", "token-4", "power_shell");
    expect(panels.panel("other").tabs.map((id) => tab(id)?.title)).toEqual(["PowerShell"]);
    expect(nextTitle("PowerShell", ["PowerShell", "PowerShell 3"])).toBe("PowerShell 2");
  });

  it("refuses a terminal past the app's limit before asking Rust, counting only live shells", async () => {
    const { api, panels, runtimes, tab } = rig({ limit: 2 });
    await panels.newTab("chat");
    await panels.newTab("other");
    await panels.newTab("chat");
    expect(api.review).toHaveBeenCalledTimes(2);
    expect(panels.panel("chat").notice).toBe(
      "2 terminals are open. Close one before opening another.",
    );
    expect(panels.panel("chat").tabs).toHaveLength(1);
    // An exited shell keeps its output but no longer holds a Rust slot.
    runtimes[0]?.status({ state: "finished", exitCode: 0, truncated: false });
    expect(tab(panels.panel("chat").active)?.status.state).toBe("finished");
    await panels.newTab("chat");
    expect(api.review).toHaveBeenCalledTimes(3);
    expect(panels.panel("chat").notice).toBeNull();
    expect(holdsShell({ state: "finished", exitCode: 0, truncated: false })).toBe(false);
    expect(holdsShell({ state: "running" })).toBe(true);
  });

  it("closes a tab by stopping its shell, picks its neighbour, and hides with the last one", async () => {
    const { panels, runtimes } = rig();
    await panels.newTab("chat");
    await panels.newTab("chat");
    await panels.newTab("chat");
    const [first, second, third] = panels.panel("chat").tabs;
    panels.select("chat", second ?? "");
    await panels.closeTab(second ?? "");
    expect(runtimes[1]?.disposed).toBe(true);
    expect(panels.panel("chat")).toMatchObject({ active: third, tabs: [first, third] });
    await panels.closeTab(third ?? "");
    expect(panels.panel("chat").active).toBe(first);
    await panels.closeTab(first ?? "");
    expect(panels.panel("chat")).toMatchObject({ open: false, tabs: [], active: null });
    expect(runtimes.every((runtime) => runtime.disposed)).toBe(true);
  });

  it("shows Rust's refusal on the tab and starts nothing", async () => {
    const { panels, runtimes, tab } = rig({
      reviews: [
        async () => {
          throw new Error("Locate this chat's folder before opening project tools.");
        },
        async () => review("empty", []),
      ],
    });
    await panels.newTab("chat");
    expect(tab(panels.panel("chat").active)?.status).toEqual({
      state: "failed",
      message: "Locate this chat's folder before opening project tools.",
    });
    await panels.newTab("chat");
    expect(tab(panels.panel("chat").active)?.status).toEqual({
      state: "failed",
      message: "No supported native shell was found.",
    });
    expect(runtimes).toHaveLength(0);
  });

  it("never creates a shell for a tab closed while its review was pending", async () => {
    let finish: (value: ProjectToolsReview) => void = () => {};
    const { api, panels, runtimes } = rig({
      reviews: [() => new Promise((resolve) => (finish = resolve))],
    });
    const opening = panels.newTab("chat");
    await vi.waitFor(() => expect(api.review).toHaveBeenCalled());
    await panels.closeTab(panels.panel("chat").active ?? "");
    finish(review("late"));
    await opening;
    expect(runtimes).toHaveLength(0);
    expect(api.terminal).not.toHaveBeenCalled();
    expect(panels.panel("chat").tabs).toEqual([]);
  });

  it("renames a tab in up to 40 characters and gives an emptied name back to its shell", async () => {
    const { panels, tab } = rig();
    await panels.newTab("chat");
    await panels.newTab("chat");
    const second = panels.panel("chat").tabs[1] ?? "";
    panels.rename(second, `  dev   server ${"x".repeat(60)}`);
    expect(tab(second)).toMatchObject({ named: true });
    expect(tab(second)?.title).toHaveLength(40);
    expect(tab(second)?.title.startsWith("dev server x")).toBe(true);
    panels.rename(second, "   ");
    expect(tab(second)).toMatchObject({ title: "PowerShell 2", named: false });
  });

  it("keeps heights on the 4px grid, inside the bounds and the room the view has", () => {
    const { panels } = rig();
    expect(panels.panel("chat").height).toBe(PANEL_HEIGHT_DEFAULT);
    panels.setHeight("chat", 333.7);
    expect(panels.panel("chat").height).toBe(332);
    panels.setHeight("chat", 10);
    expect(panels.panel("chat").height).toBe(PANEL_HEIGHT_MIN);
    panels.setHeight("chat", 5000);
    expect(panels.panel("chat").height).toBe(PANEL_HEIGHT_MAX);
    panels.setHeight("chat", 600, 401);
    expect(panels.panel("chat").height).toBe(400);
    expect(clampHeight(500, 50)).toBe(PANEL_HEIGHT_MIN);
    expect(clampHeight(Number.NaN)).toBe(PANEL_HEIGHT_MIN);
  });

  it("stops every shell on dispose and stays usable for the next mount", async () => {
    const { panels, runtimes } = rig();
    await panels.newTab("chat");
    await panels.newTab("other");
    await panels.dispose();
    expect(runtimes.every((runtime) => runtime.disposed)).toBe(true);
    expect(panels.panel("chat").tabs).toEqual([]);
    await panels.newTab("chat");
    expect(panels.panel("chat").tabs).toHaveLength(1);
  });
});
