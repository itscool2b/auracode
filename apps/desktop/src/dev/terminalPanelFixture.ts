/**
 * Synthetic shells for the terminal panel preview. Nothing runs: a shell prints a banner and a
 * prompt, echoes what is typed, answers every command with one line saying so, and `exit` ends it.
 * `window.terminalPanelFixture.calls()` lists what the panel asked for, in order.
 */
import type { ProjectShell, ProjectShellChoice, TerminalChunk } from "../bindings";
import type { ProjectToolsApi } from "../lib/projectTools";
import type { TerminalTransport } from "../lib/terminal";
import type { WorktreeRunApi } from "../lib/worktreeRun";

const FOLDER = "C:\\auracode\\worktrees\\sidebar-scan";
const POWERSHELL: ProjectShellChoice = {
  id: "power_shell",
  label: "PowerShell",
  program: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  args: ["-NoLogo", "-NoProfile"],
};
const SHELLS: ProjectShellChoice[] = [
  POWERSHELL,
  {
    id: "command_prompt",
    label: "Command Prompt",
    program: "C:\\Windows\\System32\\cmd.exe",
    args: ["/D"],
  },
];
const PROMPTS: Record<ProjectShell, string> = {
  power_shell: `PS ${FOLDER}> `,
  command_prompt: `${FOLDER}>`,
  zsh: "% ",
  bash: "$ ",
};

const encoder = new TextEncoder();
const calls: string[] = [];

interface Shell {
  readonly prompt: string;
  output: string;
  line: string;
  done: boolean;
  wake: (() => void) | null;
}

function fixtureTransport(shell: ProjectShellChoice, refuse: string | null): TerminalTransport {
  let sequence = 0;
  const shells = new Map<string, Shell>();
  const push = (state: Shell, text: string) => {
    state.output += text;
    state.wake?.();
  };
  return {
    reserve: async () => {
      calls.push("reserve");
      const id = `fixture-${shell.id}-${++sequence}-${calls.length}`;
      shells.set(id, {
        prompt: PROMPTS[shell.id],
        output: "",
        line: "",
        done: false,
        wake: null,
      });
      return id;
    },
    start: async (id, _agent, size) => {
      calls.push(`start:${shell.id}:${size.cols}x${size.rows}`);
      if (refuse) throw new Error(refuse);
      const state = shells.get(id);
      if (!state) throw new Error("This terminal is closed or belongs to another window.");
      const banner =
        shell.id === "power_shell"
          ? "Windows PowerShell\r\n\r\n"
          : "Microsoft Windows [Version 10.0.26300]\r\n\r\n";
      push(
        state,
        `${banner}${state.prompt}git status --short\r\n M apps/desktop/src/components/Sidebar.tsx\r\n M apps/desktop/src/styles.css\r\n${state.prompt}`,
      );
      return id;
    },
    read: async (id): Promise<TerminalChunk> => {
      const state = shells.get(id);
      if (!state) throw new Error("This terminal is closed or belongs to another window.");
      if (!state.output && !state.done)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 20_000);
          state.wake = () => {
            clearTimeout(timer);
            state.wake = null;
            resolve();
          };
        });
      const bytes = Array.from(encoder.encode(state.output));
      state.output = "";
      return { bytes, done: state.done, exit_code: state.done ? 0 : null, truncated: false };
    },
    write: async (id, bytes) => {
      const state = shells.get(id);
      if (!state || state.done) return;
      calls.push("input");
      for (const char of new TextDecoder().decode(Uint8Array.from(bytes))) {
        if (char === "\r") {
          const command = state.line.trim();
          state.line = "";
          if (command === "exit") {
            state.done = true;
            push(state, "\r\n");
            continue;
          }
          push(
            state,
            command
              ? `\r\nThis preview runs no commands. Nothing ran: ${command}\r\n${state.prompt}`
              : `\r\n${state.prompt}`,
          );
        } else if (char === "\u007f") {
          if (state.line) {
            state.line = state.line.slice(0, -1);
            push(state, "\b \b");
          }
        } else if (char >= " ") {
          state.line += char;
          push(state, char);
        }
      }
    },
    resize: async () => {},
    close: async (id) => {
      calls.push("close");
      const state = shells.get(id);
      shells.delete(id);
      if (state) {
        state.done = true;
        state.wake?.();
      }
    },
  };
}

/**
 * Run in the preview (`&run=1`): a saved `cmd.exe /d /c pnpm dev` on the worktree's port 25040,
 * which prints what a dev server prints and keeps running until its tab closes.
 */
export function runFixture(): WorktreeRunApi {
  return {
    info: async () => ({
      command: { program: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/c", "pnpm dev"] },
      port: 25040,
      folder: FOLDER,
    }),
    terminal: () => {
      let output = "";
      let done = false;
      let wake: (() => void) | null = null;
      return {
        reserve: async () => {
          calls.push("run:reserve");
          return "fixture-run";
        },
        start: async (id) => {
          calls.push("run:start");
          output =
            "\r\n  VITE v8.3.5  ready in 214 ms\r\n\r\n  ➜  Local:   http://localhost:25040/\r\n";
          wake?.();
          return id;
        },
        read: async (): Promise<TerminalChunk> => {
          if (!output && !done)
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 20_000);
              wake = () => {
                clearTimeout(timer);
                wake = null;
                resolve();
              };
            });
          const bytes = Array.from(encoder.encode(output));
          output = "";
          return { bytes, done, exit_code: done ? 0 : null, truncated: false };
        },
        write: async () => {},
        resize: async () => {},
        close: async () => {
          calls.push("run:close");
          done = true;
          wake?.();
        },
      };
    },
  };
}

/** The review Rust would give: this chat's folder (a worktree) and the two Windows shells. */
export function terminalPanelFixture(
  options: { readonly refuse?: string | null; readonly failReview?: string | null } = {},
): ProjectToolsApi {
  let review = 0;
  Object.assign(window, { terminalPanelFixture: { calls: () => [...calls] } });
  return {
    review: async () => {
      calls.push("review");
      if (options.failReview) throw new Error(options.failReview);
      return {
        token: `panel-review-${++review}`,
        folder: FOLDER,
        shells: SHELLS,
        editors: ["cursor", "vs_code"],
        expires_at: Date.now() + 600_000,
      };
    },
    terminalReview: async () => {
      calls.push("review");
      if (options.failReview) throw new Error(options.failReview);
      return { folder: FOLDER, shells: SHELLS };
    },
    openEditor: async (_chat, _token, editor) => {
      calls.push(`editor:${editor}`);
    },
    terminal: (_chat, id) =>
      fixtureTransport(
        SHELLS.find((shell) => shell.id === id) ?? POWERSHELL,
        options.refuse ?? null,
      ),
  };
}
