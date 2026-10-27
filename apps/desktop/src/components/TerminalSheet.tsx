import type { Terminal } from "@xterm/xterm";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DialogClose, dialogClassName } from "./chat/Modal";
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
  readonly purpose?: "sign-in" | "installation" | "setup" | "project";
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
      // Graphite's terminal well: code text on surface-1 and the ANSI palette (visual-language 3.1).
      const term = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 1000,
        fontSize: 12.5,
        lineHeight: 1.44,
        fontFamily: color("--g-mono", '"Geist Mono Variable", monospace'),
        cursorBlink: false,
        screenReaderMode: true,
        disableStdin: true,
        logLevel: "off",
        theme: {
          background: color("--g-surface-1", "#0a0a0a"),
          foreground: color("--g-code-fg", "#d4d4d4"),
          cursor: color("--g-fg-1", "#ededed"),
          cursorAccent: color("--g-surface-1", "#0a0a0a"),
          selectionBackground: color("--g-selection", "#333333"),
          selectionForeground: color("--g-fg-1", "#ededed"),
          black: color("--g-ansi-black", "#4d4d4d"),
          red: color("--g-ansi-red", "#ff6b6b"),
          green: color("--g-ansi-green", "#3dd68c"),
          yellow: color("--g-ansi-yellow", "#e6cc6e"),
          blue: color("--g-ansi-blue", "#7aa7ff"),
          magenta: color("--g-ansi-magenta", "#d69cff"),
          cyan: color("--g-ansi-cyan", "#5cd6d6"),
          white: color("--g-ansi-white", "#d4d4d4"),
          brightBlack: color("--g-ansi-bright-black", "#858585"),
          brightRed: color("--g-ansi-bright-red", "#ff8f8f"),
          brightGreen: color("--g-ansi-bright-green", "#6ee7a8"),
          brightYellow: color("--g-ansi-bright-yellow", "#f2dc8c"),
          brightBlue: color("--g-ansi-bright-blue", "#a3c2ff"),
          brightMagenta: color("--g-ansi-bright-magenta", "#e4bdff"),
          brightCyan: color("--g-ansi-bright-cyan", "#8ae6e6"),
          brightWhite: color("--g-ansi-bright-white", "#ededed"),
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
          : purpose === "project"
            ? "Review the folder and shell before starting."
            : "Ready to sign in."
      : state.state === "starting"
        ? purpose === "installation"
          ? "Checking the reviewed installer…"
          : purpose === "setup"
            ? "Checking the reviewed setup…"
            : purpose === "project"
              ? "Checking the reviewed project folder…"
              : "Opening the vendor sign-in flow…"
        : state.state === "running"
          ? purpose === "setup"
            ? "The setup command is running."
            : purpose === "project"
              ? "The project shell is running."
              : "Follow the vendor's prompts below."
          : state.state === "failed"
            ? state.message
            : state.exitCode === 0
              ? purpose === "installation"
                ? "The installer finished. Refresh agents to verify the installation."
                : purpose === "setup"
                  ? "The setup command finished."
                  : purpose === "project"
                    ? "The project shell finished."
                    : "The vendor command finished. Check sign-in status to confirm."
              : state.exitCode === null
                ? "The terminal closed without an exit status."
                : `The ${purpose === "project" ? "project shell" : "vendor command"} exited with code ${state.exitCode}.`;

  const outcome =
    state.state === "failed" || (state.state === "finished" && state.exitCode !== 0)
      ? "failed"
      : state.state === "finished"
        ? "passed"
        : undefined;
  const content = (
    <dialog
      ref={dialog}
      className={dialogClassName("lg", "terminal-sheet")}
      data-purpose={purpose}
      data-state={state.state}
      data-outcome={outcome}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="g-dialog-header terminal-sheet__header">
        <div>
          <h2 id={title} className="g-dialog-title">
            {purpose === "installation"
              ? `Install ${agentName}`
              : purpose === "setup"
                ? `Setup ${agentName}`
                : purpose === "project"
                  ? `${agentName} terminal`
                  : `Sign in to ${agentName}`}
          </h2>
          <p id={description}>
            {purpose === "installation"
              ? "Review and run the package manager. Terminal output is not saved."
              : purpose === "setup"
                ? "Run the reviewed command. Terminal output is not saved."
                : purpose === "project"
                  ? "Open a shell in the reviewed project folder. Terminal output is not saved."
                  : "Run the agent's own sign-in flow. Terminal output is not saved."}
          </p>
        </div>
        <DialogClose label={`Close ${purpose} terminal`} onClick={close} />
      </header>
      {review}
      <div className="terminal-sheet__status" role="status">
        {status}
      </div>
      {state.state === "finished" && state.truncated ? (
        <p role="status" className="terminal-sheet__note">
          Some output could not be drained before the terminal closed.
        </p>
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
          className="g-button g-button-ghost"
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
          className="g-button g-button-primary terminal-sheet__button--primary"
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
              : purpose === "project"
                ? "Start project terminal"
                : "Start sign-in"}
        </button>
      </footer>
    </dialog>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
