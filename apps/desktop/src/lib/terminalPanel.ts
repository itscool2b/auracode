import type { ProjectShell, ProjectShellChoice } from "../bindings";
import { errorMessage } from "./errors";
import type { ProjectToolsApi } from "./projectTools";
import type { TerminalState, TerminalTransport } from "./terminal";

/** Rust allows eight project shells in the app (aura-core terminal.rs); the panel says so first. */
export const PANEL_TERMINAL_LIMIT = 8;
/** A third of a 1440x900 window: room for a test run without hiding the conversation. */
export const PANEL_HEIGHT_DEFAULT = 280;
export const PANEL_HEIGHT_MIN = 120;
export const PANEL_HEIGHT_MAX = 800;
/** Room the transcript and the composer keep above the panel. */
export const PANEL_ROOM_ABOVE = 240;
const TITLE_LIMIT = 40;

export type TabStatus = { readonly state: "reviewing" } | TerminalState;

export interface PanelTab {
  readonly purpose?: "setup";
  readonly id: string;
  readonly chatId: string;
  /** The shell's name ("PowerShell 2") or the name the user gave the tab. */
  readonly title: string;
  readonly named: boolean;
  readonly shell: ProjectShellChoice | null;
  /** The folder Rust reviewed: the chat's own folder, so a worktree chat opens in its worktree. */
  readonly folder: string | null;
  readonly status: TabStatus;
}

export interface ChatPanel {
  readonly open: boolean;
  readonly height: number;
  readonly tabs: readonly string[];
  readonly active: string | null;
  /** The shells the latest review offered, for the New terminal menu. */
  readonly shells: readonly ProjectShellChoice[];
  /** A refusal that belongs to the panel, not to one tab (the app-wide limit). */
  readonly notice: string | null;
  /** Counts the person's requests to use the terminal (show, a new tab, a tab chosen). */
  readonly focus: number;
}

export interface PanelSnapshot {
  readonly chats: ReadonlyMap<string, ChatPanel>;
  readonly tabs: ReadonlyMap<string, PanelTab>;
}

/** One tab's terminal view and process plumbing. The xterm runtime lives in the component layer. */
export interface TerminalRuntime {
  /** Shows the terminal inside `container`; the first call opens the view and starts the shell. */
  attach(container: HTMLElement): void;
  /** Takes the view out of the page. The shell keeps running and its output keeps arriving. */
  detach(): void;
  focus(): void;
  /** Ends the shell (Rust stops its owned processes) and releases the view. */
  dispose(): Promise<void>;
}

export type RuntimeFactory = (options: {
  readonly transport: TerminalTransport;
  readonly label: string;
  readonly onStatus: (status: TerminalState) => void;
}) => TerminalRuntime;

export const CLOSED_PANEL: ChatPanel = {
  open: false,
  height: PANEL_HEIGHT_DEFAULT,
  tabs: [],
  active: null,
  shells: [],
  notice: null,
  focus: 0,
};

/** Heights land on Graphite's 4px grid, inside the bounds and the room the view has. */
export function clampHeight(height: number, room = PANEL_HEIGHT_MAX): number {
  const max = Math.max(PANEL_HEIGHT_MIN, Math.min(PANEL_HEIGHT_MAX, room));
  const value = Math.max(PANEL_HEIGHT_MIN, Math.min(max, Number.isFinite(height) ? height : 0));
  return Math.floor(value / 4) * 4;
}

/** A shell holds its Rust slot until it exits or fails; finished tabs keep only their output. */
export function holdsShell(status: TabStatus): boolean {
  return status.state === "reviewing" || status.state === "starting" || status.state === "running";
}

/** "PowerShell", then "PowerShell 2" and so on: the lowest number no open tab of this chat uses. */
export function nextTitle(label: string, taken: readonly string[]): string {
  if (!taken.includes(label)) return label;
  for (let number = 2; ; number++) {
    const title = `${label} ${number}`;
    if (!taken.includes(title)) return title;
  }
}

/**
 * The docked terminal panels, one per chat, owned by the chat screen so a chat's shells keep
 * running while another chat is open. Every tab is an explicit user action: a new tab asks Rust to
 * review the chat's folder and shell, then the reviewed shell starts in that folder. Nothing runs
 * a command; closing a tab, reloading or quitting stops its shell.
 */
export class TerminalPanels {
  #chats = new Map<string, ChatPanel>();
  #tabs = new Map<string, PanelTab>();
  #runtimes = new Map<string, TerminalRuntime>();
  #listeners = new Set<() => void>();
  #snapshot: PanelSnapshot = { chats: new Map(), tabs: new Map() };
  #sequence = 0;

  constructor(
    private readonly api: ProjectToolsApi,
    private readonly factory: RuntimeFactory,
    private readonly limit = PANEL_TERMINAL_LIMIT,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): PanelSnapshot => this.#snapshot;

  panel(chatId: string): ChatPanel {
    return this.#chats.get(chatId) ?? CLOSED_PANEL;
  }

  runtime(tabId: string): TerminalRuntime | undefined {
    return this.#runtimes.get(tabId);
  }

  /** The reviewed setup uses the normal docked panel, keeping the chat composer available.
   * Process completion belongs to Rust; this tab only renders its output and closes its process. */
  setupTab(chatId: string, transport: TerminalTransport, folder: string): void {
    const id = `setup-${++this.#sequence}`;
    const panel = this.panel(chatId);
    this.#tabs.set(id, {
      id,
      chatId,
      purpose: "setup",
      title: "Setup",
      named: false,
      shell: null,
      folder,
      status: { state: "starting" },
    });
    this.#runtimes.set(
      id,
      this.factory({
        transport,
        label: "Worktree setup terminal",
        onStatus: (status) => {
          if (this.#tabs.has(id)) this.#setTab(id, { status });
        },
      }),
    );
    this.#setPanel(chatId, {
      ...panel,
      tabs: [...panel.tabs, id],
      active: id,
      open: true,
      notice: null,
      focus: panel.focus + 1,
    });
  }

  /** Opens setup review without starting a shell. Existing terminal output remains in its tab. */
  showReview(chatId: string): void {
    const panel = this.panel(chatId);
    this.#setPanel(chatId, { ...panel, active: null, open: true, focus: panel.focus + 1 });
  }

  /** Ctrl+`: hides an open panel, or shows it, opening the first terminal when it has none. */
  toggle(chatId: string): void {
    if (this.panel(chatId).open) this.hide(chatId);
    else this.show(chatId);
  }

  show(chatId: string): void {
    const panel = this.panel(chatId);
    this.#setPanel(chatId, {
      ...panel,
      active: panel.active ?? panel.tabs.at(-1) ?? null,
      open: true,
      focus: panel.focus + 1,
    });
    if (panel.tabs.length === 0) void this.newTab(chatId);
  }

  hide(chatId: string): void {
    const panel = this.panel(chatId);
    if (panel.open) this.#setPanel(chatId, { ...panel, open: false, notice: null });
  }

  /** Reviews the chat's folder and starts the chosen shell (the first one Rust offers by default). */
  async newTab(chatId: string, shell?: ProjectShell): Promise<void> {
    const panel = this.panel(chatId);
    const open = [...this.#tabs.values()].filter((tab) => holdsShell(tab.status)).length;
    if (open >= this.limit) {
      this.#setPanel(chatId, {
        ...panel,
        open: true,
        notice: `${this.limit === PANEL_TERMINAL_LIMIT ? "Eight" : this.limit} terminals are open. Close one before opening another.`,
      });
      return;
    }
    const id = `terminal-${++this.#sequence}`;
    this.#tabs.set(id, {
      id,
      chatId,
      title: "Terminal",
      named: false,
      shell: null,
      folder: null,
      status: { state: "reviewing" },
    });
    this.#setPanel(chatId, {
      ...panel,
      open: true,
      tabs: [...panel.tabs, id],
      active: id,
      notice: null,
      focus: panel.focus + 1,
    });
    try {
      const review = await this.api.review(chatId);
      const tab = this.#tabs.get(id);
      if (!tab) return;
      const choice = review.shells.find((item) => item.id === shell) ?? review.shells[0];
      this.#setPanel(chatId, { ...this.panel(chatId), shells: review.shells });
      if (!choice) {
        this.#setTab(id, {
          folder: review.folder,
          status: { state: "failed", message: "No supported native shell was found." },
        });
        return;
      }
      const taken = this.panel(chatId)
        .tabs.filter((other) => other !== id)
        .map((other) => this.#tabs.get(other)?.title ?? "");
      const title = nextTitle(choice.label, taken);
      this.#runtimes.set(
        id,
        this.factory({
          transport: this.api.terminal(chatId, review.token, choice.id),
          label: `${title} terminal`,
          onStatus: (status) => {
            if (this.#tabs.has(id)) this.#setTab(id, { status });
          },
        }),
      );
      this.#setTab(id, {
        title,
        shell: choice,
        folder: review.folder,
        status: { state: "starting" },
      });
    } catch (error) {
      if (this.#tabs.has(id))
        this.#setTab(id, { status: { state: "failed", message: errorMessage(error) } });
    }
  }

  /** Shows a tab. A click moves focus into its shell; arrow keys leave it on the tabs. */
  select(chatId: string, tabId: string, focus = true): void {
    const panel = this.panel(chatId);
    if (panel.tabs.includes(tabId))
      this.#setPanel(chatId, { ...panel, active: tabId, focus: panel.focus + (focus ? 1 : 0) });
  }

  /** Closes the tab and stops its shell. The last tab closing hides the panel. */
  async closeTab(tabId: string): Promise<void> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    const panel = this.panel(tab.chatId);
    const index = panel.tabs.indexOf(tabId);
    const tabs = panel.tabs.filter((other) => other !== tabId);
    const active =
      panel.active === tabId ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : panel.active;
    this.#tabs.delete(tabId);
    const runtime = this.#runtimes.get(tabId);
    this.#runtimes.delete(tabId);
    this.#setPanel(tab.chatId, {
      ...panel,
      tabs,
      active,
      open: tabs.length > 0 && panel.open,
      notice: null,
    });
    await runtime?.dispose();
  }

  /** A name of up to 40 characters; an empty name gives the tab its shell's name back. */
  rename(tabId: string, title: string): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    const name = title.replace(/\s+/g, " ").trim().slice(0, TITLE_LIMIT).trim();
    if (name) {
      this.#setTab(tabId, { title: name, named: true });
      return;
    }
    const taken = this.panel(tab.chatId)
      .tabs.filter((other) => other !== tabId)
      .map((other) => this.#tabs.get(other)?.title ?? "");
    this.#setTab(tabId, {
      title: tab.shell
        ? nextTitle(tab.shell.label, taken)
        : tab.purpose === "setup"
          ? "Setup"
          : "Terminal",
      named: false,
    });
  }

  setHeight(chatId: string, height: number, room?: number): void {
    const panel = this.panel(chatId);
    const next = clampHeight(height, room);
    if (next !== panel.height) this.#setPanel(chatId, { ...panel, height: next });
  }

  /** Stops every shell. The panels stay usable, so a remount starts clean. */
  async dispose(): Promise<void> {
    const runtimes = [...this.#runtimes.values()];
    this.#runtimes.clear();
    this.#tabs.clear();
    this.#chats.clear();
    this.#publish();
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
  }

  #setTab(tabId: string, change: Partial<PanelTab>): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    this.#tabs.set(tabId, { ...tab, ...change });
    this.#publish();
  }

  #setPanel(chatId: string, panel: ChatPanel): void {
    this.#chats.set(chatId, panel);
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = { chats: new Map(this.#chats), tabs: new Map(this.#tabs) };
    for (const listener of this.#listeners) listener();
  }
}
