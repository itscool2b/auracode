/**
 * A terminal chat over a scripted terminal (`?preview=terminal-chat`, `&case=exited`,
 * `&case=omitted`). Nothing runs: the "agent" draws a screen in ANSI colour and echoes input.
 * `window.terminalKeys` records what was written to the agent and which keys reached the app, with
 * a control on each side of the terminal for leaving it by keyboard.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { TerminalChunk } from "../bindings";
import { TerminalChat } from "../components/chat/TerminalChat";
import { TerminalChats, type TerminalChatTransport } from "../components/chat/terminalChatRuntime";

const esc = "\u001b[";
const screen = [
  `${esc}38;2;217;119;87m✻${esc}0m ${esc}1mWelcome to Claude Code${esc}0m`,
  "",
  `${esc}2m  cwd: C:\\work\\auracode${esc}0m`,
  "",
  `${esc}1m> ${esc}0mFix the header's spacing`,
  "",
  `${esc}38;2;217;119;87m●${esc}0m I'll look at the header styles first.`,
  "",
  `${esc}38;2;120;200;140m●${esc}0m ${esc}1mRead${esc}0m(src/shell.css)`,
  `  ${esc}2m⎿  Read 1,612 lines${esc}0m`,
  "",
  `${esc}38;2;120;200;140m●${esc}0m ${esc}1mUpdate${esc}0m(src/shell.css)`,
  `  ${esc}2m⎿  Updated with${esc}0m ${esc}32m2 additions${esc}0m and ${esc}31m1 removal${esc}0m`,
  `     ${esc}31m- gap: var(--g-space-6);${esc}0m`,
  `     ${esc}32m+ gap: var(--g-space-8);${esc}0m`,
  `     ${esc}32m+ align-items: center;${esc}0m`,
  "",
  `${esc}38;2;217;119;87m●${esc}0m The header's controls now share an 8px gap and sit centred.`,
  "",
  `${esc}2m╭──────────────────────────────────────────────────────────╮${esc}0m`,
  `${esc}2m│${esc}0m > ${esc}2mTry "write a test for the header"${esc}0m                       ${esc}2m│${esc}0m`,
  `${esc}2m╰──────────────────────────────────────────────────────────╯${esc}0m`,
  `  ${esc}2m? for shortcuts${esc}0m`,
].join("\r\n");

/** What the check reads: bytes written to the agent, and keys as the app's own listeners saw them. */
const keys = {
  written: [] as number[],
  /** Keys that reached a window listener after the terminal: the app's shortcuts. */
  app: [] as string[],
  /** Every keydown, seen first (capture), to read whether the browser's action was cancelled. */
  all: [] as KeyboardEvent[],
};
declare global {
  interface Window {
    terminalKeys: typeof keys;
  }
}

function transport(kind: string | null): TerminalChatTransport {
  const encoder = new TextEncoder();
  const pending: Uint8Array[] = [encoder.encode(screen)];
  let wake: (() => void) | null = null;
  let done = false;
  if (kind === "exited") {
    pending.push(encoder.encode(`\r\n\r\n${esc}2mGoodbye.${esc}0m\r\n`));
    done = true;
  }
  return {
    reserve: async () => "term-1",
    start: async () => ({
      terminal_id: "term-1",
      omitted: kind === "omitted" ? ["legacy-docs: Codex does not take legacy SSE servers"] : [],
      first_input: null,
    }),
    read: async (): Promise<TerminalChunk> => {
      while (pending.length === 0 && !done) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 1000);
        });
      }
      const next = pending.shift();
      return {
        bytes: next ? Array.from(next) : [],
        done: pending.length === 0 && done,
        exit_code: done ? 0 : null,
        truncated: false,
      };
    },
    // Typing echoes, as a shell's line editor would.
    write: async (_id, bytes) => {
      keys.written.push(...bytes);
      pending.push(Uint8Array.from(bytes));
      wake?.();
    },
    resize: async () => {},
    close: async () => {
      done = true;
      wake?.();
    },
    ended: async () => {
      document.body.dataset.terminalEnded = "";
    },
  };
}

export function mountTerminalChatPreview(container: HTMLElement): void {
  const kind = new URLSearchParams(location.search).get("case");
  const runtimes = new TerminalChats(transport(kind));
  window.terminalKeys = keys;
  window.addEventListener("keydown", (event) => keys.all.push(event), true);
  window.addEventListener("keydown", (event) => keys.app.push(event.key));
  container.style.height = "100vh";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  createRoot(container).render(
    <StrictMode>
      <button type="button" className="g-button g-button-28" data-testid="preview-before">
        Before the terminal
      </button>
      <main className="chat-main" style={{ flex: "1 1 auto", display: "flex" }}>
        <TerminalChat
          chatId="terminal-preview"
          agentName="Claude Code"
          runtimes={runtimes}
          onChat={() => {
            document.body.dataset.backToChat = "";
          }}
        />
      </main>
      <button type="button" className="g-button g-button-28" data-testid="preview-after">
        After the terminal
      </button>
    </StrictMode>,
  );
}
