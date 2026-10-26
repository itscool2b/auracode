/** Synthetic responses only. This fixture never starts a native shell or editor. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectToolsDialog } from "../components/chat/ProjectToolsDialog";
import type { ProjectToolsApi } from "../lib/projectTools";
import type { TerminalTransport } from "../lib/terminal";

const calls: string[] = [];
const params = new URLSearchParams(location.search);
let sequence = 0;
let release: (() => void) | null = null;
const transport: TerminalTransport = {
  reserve: async () => {
    calls.push("reserve");
    return "project-terminal";
  },
  start: async () => {
    calls.push("start");
    if (params.has("stale"))
      throw new Error("The chat or folder changed after review. Review project tools again.");
    return "project-terminal";
  },
  read: async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { bytes: [], done: true, exit_code: 0, truncated: false };
  },
  write: async () => {
    calls.push("input");
  },
  resize: async () => {},
  close: async () => {
    calls.push("close");
    release?.();
  },
};
const api: ProjectToolsApi = {
  review: async () => ({
    token: `review-${++sequence}`,
    folder: "C:/projects/orbit",
    shells: params.has("missing")
      ? []
      : [
          {
            id: "power_shell",
            label: "PowerShell",
            program: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            args: ["-NoLogo", "-NoProfile"],
          },
        ],
    editors: params.has("missing") ? [] : ["cursor", "vs_code"],
    expires_at: Date.now() + 600000,
  }),
  openEditor: async (_chat, _token, editor) => {
    calls.push(`editor:${editor}`);
    if (params.has("handler-error"))
      throw new Error(
        "The operating system could not open this editor. Install or repair its URL handler, then review the folder again.",
      );
  },
  terminal: () => transport,
};
Object.assign(window, { projectToolsFixture: { calls: () => [...calls] } });
function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <main className="orbit-theme" data-theme="dark">
      <h1>Project tools fixture</h1>
      <button type="button" onClick={() => setOpen(true)}>
        Open project tools
      </button>
      {open ? (
        <ProjectToolsDialog chatId="project-chat" api={api} onClose={() => setOpen(false)} />
      ) : null}
    </main>
  );
}
export function mountProjectToolsPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
}
