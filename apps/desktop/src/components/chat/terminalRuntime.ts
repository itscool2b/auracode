import { TerminalSession } from "../../lib/terminal";
import type { RuntimeFactory, TerminalRuntime } from "../../lib/terminalPanel";
import { isMac } from "../terminalKeys";
import { createXterm, loadXterm, type XtermView } from "../xterm";

/**
 * Ctrl+` or Cmd+`: the panel's own toggle, which the shell never receives. Not with Alt: AltGr
 * (Ctrl+Alt on Windows) types the backtick on layouts such as Hungarian.
 */
export function isPanelToggle(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key" | "code"> &
    Partial<Pick<KeyboardEvent, "altKey">>,
) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    (event.key === "`" || event.code === "Backquote")
  );
}

/**
 * Which keys xterm handles (true) and which it leaves to the page (false). The toggle always goes
 * to the page. On Windows, Ctrl+C with a selection copies it and Ctrl+V pastes, as in Windows
 * Terminal; without a selection Ctrl+C still interrupts. macOS keeps Cmd+C and Cmd+V native.
 */
export function shellKeys(
  event: Pick<
    KeyboardEvent,
    "type" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "code"
  >,
  hasSelection: () => boolean,
  mac = isMac(),
): boolean {
  if (isPanelToggle(event)) return false;
  if (mac || event.type !== "keydown" || !event.ctrlKey || event.altKey || event.metaKey)
    return true;
  const key = event.key.toLowerCase();
  if (key === "v" && !event.shiftKey) return false;
  if (key === "c" && !event.shiftKey && hasSelection()) return false;
  return true;
}

/**
 * The panel's xterm runtime: one detached element per tab that moves into the panel while its tab
 * shows, so a shell keeps its screen while another tab or chat is open. The first attach opens
 * the view, fits it and starts the reviewed shell at that size; Rust runs it, never the renderer.
 */
export const createXtermRuntime: RuntimeFactory = ({ transport, label, onStatus }) => {
  const host = document.createElement("div");
  host.className = "terminal-panel-host";
  let view: XtermView | null = null;
  let session: TerminalSession | null = null;
  let observer: ResizeObserver | null = null;
  let opening: Promise<void> | null = null;
  let disposed = false;
  let wantsFocus = false;
  const listeners: { dispose(): void }[] = [];

  const open = async () => {
    const modules = await loadXterm();
    if (disposed) return;
    // xterm measures its cells as it opens; a tab that left the page meanwhile opens on its next
    // attach instead.
    if (!host.isConnected) {
      opening = null;
      return;
    }
    const opened = createXterm(modules, host, {
      inputLabel: `${label} input`,
      keys: (event) => shellKeys(event, () => opened.term.hasSelection()),
      variant: "shell",
    });
    view = opened;
    const term = opened.term;
    const connection = new TerminalSession(
      transport,
      (bytes) => new Promise<void>((resolve) => term.write(bytes, resolve)),
      (next) => {
        if (disposed) return;
        term.options.disableStdin = next.state !== "running";
        onStatus(next);
      },
    );
    session = connection;
    const encoder = new TextEncoder();
    listeners.push(
      term.onData((text) => connection.write(encoder.encode(text))),
      term.onBinary((text) =>
        connection.write(Uint8Array.from(text, (char) => char.charCodeAt(0) & 255)),
      ),
      term.onResize(({ rows, cols }) => {
        void connection.resize({ rows, cols });
      }),
    );
    observer = new ResizeObserver(() => {
      if (host.isConnected) opened.fit();
    });
    observer.observe(host);
    opened.fit();
    if (wantsFocus && host.isConnected) term.focus();
    wantsFocus = false;
    void connection.start("project", { rows: term.rows, cols: term.cols });
  };

  const runtime: TerminalRuntime = {
    attach(container) {
      if (disposed) return;
      if (host.parentElement !== container) container.appendChild(host);
      if (!opening)
        opening = open().catch(() => {
          if (!disposed)
            onStatus({ state: "failed", message: "The terminal view could not load." });
        });
      else if (view) {
        view.fit();
        view.term.refresh(0, view.term.rows - 1);
      }
    },
    detach() {
      host.remove();
    },
    focus() {
      // A focus asked for while the view still loads lands once it opens.
      if (view) view.term.focus();
      else wantsFocus = true;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      host.remove();
      observer?.disconnect();
      for (const listener of listeners) listener.dispose();
      const closing = session?.close();
      view?.dispose();
      view = null;
      await closing;
    },
  };
  return runtime;
};
