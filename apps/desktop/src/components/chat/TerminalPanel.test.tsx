import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectToolsApi } from "../../lib/projectTools";
import type { TerminalTransport } from "../../lib/terminal";
import { TerminalPanels } from "../../lib/terminalPanel";
import { TerminalPanel, tabStatusLine } from "./TerminalPanel";
import { isPanelToggle, shellKeys } from "./terminalRuntime";

const key = (init: Partial<KeyboardEvent>) =>
  ({
    type: "keydown",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    ...init,
  }) as KeyboardEvent;

function panels(terminalReview: ProjectToolsApi["terminalReview"]) {
  const api: ProjectToolsApi = {
    review: vi.fn(),
    terminalReview,
    openEditor: vi.fn(async () => {}),
    terminal: () => ({}) as TerminalTransport,
  };
  return new TerminalPanels(api, () => ({
    attach: vi.fn(),
    detach: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(async () => {}),
  }));
}

describe("the terminal panel", () => {
  it("renders nothing while hidden", () => {
    const store = panels(vi.fn());
    expect(renderToStaticMarkup(<TerminalPanel chatId="chat" panels={store} />)).toBe("");
  });

  it("shows quiet tabs, the reviewed folder and its controls once a terminal opens", async () => {
    const store = panels(async () => ({
      folder: "C:/auracode/worktrees/sidebar-scan",
      shells: [
        { id: "power_shell", label: "PowerShell", program: "powershell.exe", args: [] },
        { id: "command_prompt", label: "Command Prompt", program: "cmd.exe", args: [] },
      ],
    }));
    await store.newTab("chat");
    const html = renderToStaticMarkup(<TerminalPanel chatId="chat" panels={store} />);
    expect(html).toContain('role="tablist" aria-label="Terminals"');
    expect(html).toContain('role="tab"');
    expect(html).toContain(">PowerShell<");
    expect(html).toContain("C:/auracode/worktrees/sidebar-scan");
    for (const label of ["New terminal", "Close PowerShell", "Hide terminal"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-label="Resize terminal panel"');
    expect(html).toContain("Starting PowerShell…");
    // Two shells offer the shell choice beside New terminal.
    expect(html).toContain("New terminal with");
  });

  it("says where a shell stands in one line and nothing while it runs", () => {
    const tab = {
      id: "t",
      chatId: "chat",
      title: "PowerShell 2",
      named: false,
      shell: null,
      folder: null,
    };
    expect(tabStatusLine({ ...tab, status: { state: "running" } })).toBeNull();
    expect(
      tabStatusLine({ ...tab, status: { state: "finished", exitCode: 0, truncated: false } }),
    ).toBe("PowerShell 2 exited. Output is not saved.");
    expect(
      tabStatusLine({ ...tab, status: { state: "finished", exitCode: 3, truncated: false } }),
    ).toBe("PowerShell 2 exited with code 3. Output is not saved.");
    expect(tabStatusLine({ ...tab, status: { state: "failed", message: "Refused." } })).toBe(
      "Refused.",
    );
  });
});

describe("keys inside a panel terminal", () => {
  it("leaves Ctrl+` and Cmd+` to the panel on every platform", () => {
    for (const mac of [false, true]) {
      expect(shellKeys(key({ ctrlKey: true, key: "`", code: "Backquote" }), () => false, mac)).toBe(
        false,
      );
      expect(shellKeys(key({ metaKey: true, key: "`", code: "Backquote" }), () => false, mac)).toBe(
        false,
      );
    }
    expect(isPanelToggle(key({ ctrlKey: true, shiftKey: true, key: "~", code: "Backquote" }))).toBe(
      true,
    );
    expect(isPanelToggle(key({ key: "`", code: "Backquote" }))).toBe(false);
    // AltGr+7 types the backtick on a Hungarian layout; it is text, not the toggle.
    expect(isPanelToggle(key({ ctrlKey: true, altKey: true, key: "`", code: "Digit7" }))).toBe(
      false,
    );
  });

  it("copies a selection and pastes with Ctrl on Windows, and keeps Ctrl+C an interrupt", () => {
    expect(shellKeys(key({ ctrlKey: true, key: "v" }), () => false, false)).toBe(false);
    expect(shellKeys(key({ ctrlKey: true, key: "c" }), () => true, false)).toBe(false);
    expect(shellKeys(key({ ctrlKey: true, key: "c" }), () => false, false)).toBe(true);
    expect(shellKeys(key({ ctrlKey: true, key: "j" }), () => false, false)).toBe(true);
    expect(shellKeys(key({ type: "keyup", ctrlKey: true, key: "v" }), () => false, false)).toBe(
      true,
    );
    // macOS keeps Cmd+C and Cmd+V native; Ctrl+V reaches the shell.
    expect(shellKeys(key({ ctrlKey: true, key: "v" }), () => true, true)).toBe(true);
  });
});
