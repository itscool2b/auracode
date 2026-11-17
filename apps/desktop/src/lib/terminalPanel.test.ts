import { describe, expect, it, vi } from "vitest";
import type { ProjectShellChoice, ProjectToolsReview } from "../bindings";
import type { ProjectToolsApi } from "./projectTools";
import type { TerminalState, TerminalTransport } from "./terminal";
import type { RememberedPanel, TerminalMemory } from "./terminalMemory";
import {
  clampHeight,
  holdsShell,
  nextTitle,
  PANEL_HEIGHT_DEFAULT,
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  type RuntimeFactory,
  shellTitle,
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

/** Remembered panels in memory, as the window's storage would keep them. */
function memory(initial: Record<string, RememberedPanel> = {}) {
  const kept = new Map(Object.entries(initial));
  const writes: string[] = [];
  const store: TerminalMemory = {
    read: (chatId) => kept.get(chatId) ?? null,
    write: (chatId, panel) => {
      writes.push(chatId);
      if (panel) kept.set(chatId, panel);
      else kept.delete(chatId);
    },
  };
  return { store, kept, writes };
}

function rig(
  options: {
    reviews?: (() => Promise<ProjectToolsReview>)[];
    limit?: number;
    memory?: TerminalMemory;
  } = {},
) {
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
  const panels = new TerminalPanels(api, factory, options.limit, options.memory);
  const tab = (id: string | null) => (id ? panels.getSnapshot().tabs.get(id) : undefined);
  return { api, panels, runtimes, tab };
}

describe("the docked terminal panels", () => {
  it("shows setup output in a docked tab and leaves completion to the Rust owner", async () => {
    const { panels, runtimes, api, tab } = rig();
    const transport = {} as TerminalTransport;
    panels.setupTab("chat", transport, "C:/worktrees/setup");
    expect(tab(panels.panel("chat").active)).toMatchObject({
      title: "Setup",
      folder: "C:/worktrees/setup",
      shell: null,
    });
    expect(api.review).not.toHaveBeenCalled();
    expect(runtimes[0]?.transport).toBe(transport);
    panels.hide("chat");
    expect(runtimes[0]?.disposed).toBe(false);
    await panels.closeTab(panels.panel("chat").active as string);
    expect(runtimes[0]?.disposed).toBe(true);
  });
  it("runs Run in one tab of its own per chat, with its address, until it stops", async () => {
    const { panels, runtimes, api, tab } = rig({ limit: 2 });
    const transport = {} as TerminalTransport;
    panels.runTab("chat", transport, "C:/worktrees/run", "http://localhost:25040");
    const id = panels.panel("chat").active as string;
    expect(tab(id)).toMatchObject({
      purpose: "run",
      title: "Run",
      folder: "C:/worktrees/run",
      url: "http://localhost:25040",
      status: { state: "starting" },
    });
    expect(api.review).not.toHaveBeenCalled();
    expect(runtimes[0]?.transport).toBe(transport);
    expect(panels.runningTab("chat")).toBe(id);
    expect(panels.runningTab("other")).toBeNull();
    // Asking again while it runs shows that tab instead of starting another.
    await panels.newTab("chat");
    panels.runTab("chat", transport, "C:/worktrees/run", "http://localhost:25040");
    expect(panels.panel("chat").active).toBe(id);
    expect(runtimes).toHaveLength(2);
    // Renamed and cleared, it is Run again.
    panels.rename(id, "Dev server");
    panels.rename(id, " ");
    expect(tab(id)?.title).toBe("Run");
    // Once it exits it no longer counts as running, and the app's limit holds for a new one.
    runtimes[0]?.status({ state: "finished", exitCode: 1, truncated: false });
    expect(panels.runningTab("chat")).toBeNull();
    panels.runTab("other", transport, "C:/worktrees/other", "http://localhost:25050");
    panels.runTab("third", transport, "C:/worktrees/third", "http://localhost:25060");
    expect(panels.panel("third").notice).toBe(
      "2 terminals are open. Close one before starting Run.",
    );
    await panels.closeTab(id);
    expect(runtimes[0]?.disposed).toBe(true);
  });
  it("remembers a chat's open terminals from the person's actions, never from a shell's exit", async () => {
    const { store, kept } = memory();
    const { panels, runtimes } = rig({ memory: store });
    await panels.newTab("chat", "power_shell");
    await panels.newTab("chat", "command_prompt");
    const [first, second] = panels.panel("chat").tabs as [string, string];
    panels.rename(second, "Tests");
    panels.runTab(
      "chat",
      {} as TerminalTransport,
      "C:/worktrees/sidebar",
      "http://localhost:25000",
    );
    expect(kept.get("chat")?.tabs).toEqual([
      { kind: "shell", shell: "power_shell", title: "PowerShell", named: false },
      { kind: "shell", shell: "command_prompt", title: "Tests", named: true },
      { kind: "run" },
    ]);
    expect(kept.get("chat")?.open).toBe(true);
    // Quitting stops every shell; that is no reason to forget them.
    for (const runtime of runtimes) runtime.status({ state: "failed", message: "closed" });
    expect(kept.get("chat")?.tabs).toHaveLength(3);
    // Closing a tab or hiding the panel is the person's choice and is kept.
    runtimes[0]?.status({ state: "running" });
    await panels.closeTab(second);
    panels.hide("chat");
    expect(kept.get("chat")).toMatchObject({
      tabs: [{ kind: "shell", shell: "power_shell", title: "PowerShell", named: false }],
      open: false,
    });
    await panels.closeTab(first);
    expect(kept.has("chat")).toBe(false);
  });

  it("offers a chat's remembered terminals once, starts them only on Resume, and forgets on Not now", async () => {
    const remembered: RememberedPanel = {
      tabs: [
        { kind: "shell", shell: "command_prompt", title: "Tests", named: true },
        { kind: "run" },
        { kind: "shell", shell: "power_shell", title: "PowerShell", named: false },
      ],
      open: true,
      savedAt: 1,
    };
    const { store, kept } = memory({ chat: remembered, other: remembered });
    const { panels, api, runtimes, tab } = rig({ memory: store });
    panels.restore("chat");
    expect(panels.panel("chat")).toMatchObject({ open: true, resume: remembered.tabs, tabs: [] });
    expect(api.review).not.toHaveBeenCalled();
    // Showing the panel shows the offer, not a new shell.
    panels.hide("chat");
    panels.show("chat");
    expect(api.review).not.toHaveBeenCalled();
    // A second look in the same run offers nothing new.
    panels.restore("chat");
    const onRun = vi.fn(() =>
      panels.runTab(
        "chat",
        {} as TerminalTransport,
        "C:/worktrees/sidebar",
        "http://localhost:25000",
      ),
    );
    await panels.resume("chat", onRun);
    expect(panels.panel("chat").resume).toBeNull();
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(panels.panel("chat").tabs.map((id) => tab(id)?.title)).toEqual([
      "Tests",
      "Run",
      "PowerShell",
    ]);
    expect(runtimes).toHaveLength(3);
    // Not now forgets the other chat's panel and starts nothing.
    panels.restore("other");
    panels.dismissResume("other");
    expect(panels.panel("other").resume).toBeNull();
    expect(kept.has("other")).toBe(false);
    expect(runtimes).toHaveLength(3);
  });

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

  it("names the person's own shell by its program, as their terminal app does", () => {
    const own = { id: "login", label: "Your shell (fish)", program: "/usr/bin/fish" } as const;
    expect(shellTitle(own)).toBe("fish");
    expect(shellTitle({ ...own, program: "C:\\tools\\nu.exe" })).toBe("nu.exe");
    expect(shellTitle({ ...own, program: "" })).toBe("Your shell (fish)");
    expect(shellTitle({ id: "bash", label: "Plain Bash", program: "/usr/bin/bash" })).toBe(
      "Plain Bash",
    );
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
