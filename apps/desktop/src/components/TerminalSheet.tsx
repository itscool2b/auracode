import type { Terminal } from "@xterm/xterm";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TerminalSession,
  type TerminalState,
  type TerminalTransport,
  terminalTransport,
} from "../lib/terminal";
import "@xterm/xterm/css/xterm.css";
import "./TerminalSheet.css";

/** The caller opens this sheet; only its Start button launches a vendor command. No theme or
 * command picker is exposed. Keep it mounted until onClose to retain the terminal's local view. */
export function TerminalSheet({
  agentId,
  agentName,
  onClose,
  onFinished,
  transport = terminalTransport,
  purpose = "sign-in",
  review,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly onClose: () => void;
  readonly onFinished?: (exitCode: number | null) => void;
  readonly transport?: TerminalTransport;
  readonly purpose?: "sign-in" | "installation" | "setup";
  readonly review?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const container = useRef<HTMLElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const session = useRef<TerminalSession | null>(null);
  const callbacks = useRef({ onClose, onFinished });
  callbacks.current = { onClose, onFinished };
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<TerminalState | { state: "idle" }>({ state: "idle" });
  const [link, setLink] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const title = useId();
  const description = useId();

  useEffect(() => {
    const sheet = dialog.current;
    sheet?.showModal();
    return () => sheet?.close();
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setReady(false);
    setState({ state: "idle" });
    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-webgl"),
      ]);
      const element = container.current;
      if (disposed || !element) return;
      const styles = getComputedStyle(element);
      const color = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      const term = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 1000,
        fontSize: 13,
        fontFamily: color("--o-mono", '"Geist Mono Variable", monospace'),
        cursorBlink: false,
        screenReaderMode: true,
        disableStdin: true,
        logLevel: "off",
        theme: {
          background: color("--o-pane", "#0e0e0d"),
          foreground: color("--o-ink", "#f2f1ee"),
          cursor: color("--o-signal", "#ff6308"),
          selectionBackground: "#454440",
        },
        linkHandler: {
          activate: (_event, uri) => {
            try {
              const url = new URL(uri);
              if (url.protocol === "https:" || url.protocol === "http:") setLink(url.href);
            } catch {
              /* Malformed links remain terminal text. */
            }
          },
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      term.textarea?.setAttribute("aria-label", `${agentId} ${purpose} terminal input`);
      // The canvas renderer is optional; terminal IO stays usable if WebGL is unavailable/lost.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        /* xterm keeps its DOM renderer. */
      }
      // Vendor output cannot set the OS clipboard. Copying requires the explicit button below.
      const clipboard = term.parser.registerOscHandler(52, () => true);
      const connection = new TerminalSession(
        transport,
        (bytes) => new Promise<void>((resolve) => term.write(bytes, resolve)),
        (next) => {
          if (disposed) return;
          term.options.disableStdin = next.state !== "running";
          setState(next);
          if (next.state === "running") term.focus();
          if (next.state === "finished") callbacks.current.onFinished?.(next.exitCode);
        },
      );
      terminal.current = term;
      session.current = connection;
      const encoder = new TextEncoder();
      const textInput = term.onData((text) => connection.write(encoder.encode(text)));
      const binaryInput = term.onBinary((text) =>
        connection.write(Uint8Array.from(text, (char) => char.charCodeAt(0) & 255)),
      );
      const resize = term.onResize(({ rows, cols }) => {
        void connection.resize({ rows, cols });
      });
      const fitToView = () => {
        const dimensions = fit.proposeDimensions();
        if (!dimensions || dimensions.cols < 2 || dimensions.rows < 1) return;
        term.resize(Math.min(1000, dimensions.cols), Math.min(1000, dimensions.rows));
      };
      const observer = new ResizeObserver(fitToView);
      observer.observe(element);
      fitToView();
      setReady(true);
      cleanup = () => {
        void connection.close();
        observer.disconnect();
        clipboard.dispose();
        textInput.dispose();
        binaryInput.dispose();
        resize.dispose();
        term.dispose();
        if (session.current === connection) session.current = null;
        if (terminal.current === term) terminal.current = null;
      };
    })().catch(() => {
      if (!disposed) setState({ state: "failed", message: "The terminal view could not load." });
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [agentId, purpose, transport]);

  const close = () => {
    void session.current?.close();
    callbacks.current.onClose();
  };
  const status =
    state.state === "idle"
      ? purpose === "installation"
        ? "Review the installation before starting."
        : purpose === "setup"
          ? "Review the command before starting."
          : "Ready to sign in."
      : state.state === "starting"
        ? purpose === "installation"
          ? "Checking the reviewed installer…"
          : purpose === "setup"
            ? "Checking the reviewed setup…"
            : "Opening the vendor sign-in flow…"
        : state.state === "running"
          ? purpose === "setup"
            ? "The setup command is running."
            : "Follow the vendor's prompts below."
          : state.state === "failed"
            ? state.message
            : state.exitCode === 0
              ? purpose === "installation"
                ? "The installer finished. Refresh agents to verify the installation."
                : purpose === "setup"
                  ? "The setup command finished."
                  : "The vendor command finished. Check sign-in status to confirm."
              : state.exitCode === null
                ? "The terminal closed without an exit status."
                : `The vendor command exited with code ${state.exitCode}.`;

  const content = (
    <dialog
      ref={dialog}
      className="orbit-theme terminal-sheet"
      data-theme="dark"
      data-purpose={purpose}
      data-state={state.state}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="terminal-sheet__header">
        <div>
          <h2 id={title}>
            {purpose === "installation"
              ? `Install ${agentName}`
              : purpose === "setup"
                ? `Setup ${agentName}`
                : `Sign in to ${agentName}`}
          </h2>
          <p id={description}>
            {purpose === "installation"
              ? "Review and run the package manager. Terminal output is not saved."
              : purpose === "setup"
                ? "Run the reviewed command in this worktree. Terminal output is not saved."
                : "Run the agent's own sign-in flow. Terminal output is not saved."}
          </p>
        </div>
        <button
          type="button"
          className="terminal-sheet__button"
          onClick={close}
          aria-label={`Close ${purpose} terminal`}
        >
          Close
        </button>
      </header>
      {review}
      <div className="terminal-sheet__status" role="status">
        {status}
      </div>
      {state.state === "finished" && state.truncated ? (
        <p role="status">Some output could not be drained before the terminal closed.</p>
      ) : null}
      <section
        ref={container}
        className="terminal-sheet__viewport"
        aria-label={`${agentName} ${purpose} terminal`}
      />
      {link ? (
        <p className="terminal-sheet__link">
          <a href={link} target="_blank" rel="noreferrer noopener">
            Open vendor link: {link}
          </a>
        </p>
      ) : null}
      <footer className="terminal-sheet__footer">
        <span className="terminal-sheet__hint">
          Closing this sheet stops its {purpose} process.
        </span>
        <span role="status">{copyMessage}</span>
        <button
          type="button"
          className="terminal-sheet__button"
          disabled={!ready}
          onClick={() => {
            const selected = terminal.current?.getSelection();
            if (!selected) {
              setCopyMessage("Select terminal text to copy.");
              return;
            }
            void navigator.clipboard.writeText(selected).then(
              () => setCopyMessage("Copied selection."),
              () => setCopyMessage("Could not copy the selection."),
            );
          }}
        >
          Copy selection
        </button>
        <button
          type="button"
          className="terminal-sheet__button terminal-sheet__button--primary"
          disabled={!ready || state.state !== "idle"}
          onClick={() => {
            const term = terminal.current;
            if (term) void session.current?.start(agentId, { rows: term.rows, cols: term.cols });
          }}
        >
          {purpose === "installation"
            ? "Start installation"
            : purpose === "setup"
              ? "Start setup"
              : "Start sign-in"}
        </button>
      </footer>
    </dialog>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
