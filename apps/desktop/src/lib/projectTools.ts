import {
  commands,
  type ProjectEditor,
  type ProjectShell,
  type ProjectTerminalReview,
  type ProjectToolsReview,
} from "../bindings";
import { settle } from "./ipc";
import { type TerminalTransport, terminalTransport } from "./terminal";

export interface ProjectToolsApi {
  review(chatId: string): Promise<ProjectToolsReview>;
  /** The chat's folder and this device's shells for a new terminal tab. It holds nothing. */
  terminalReview(chatId: string): Promise<ProjectTerminalReview>;
  openEditor(chatId: string, token: string, editor: ProjectEditor): Promise<void>;
  /** A shell for the chat's folder, opened in one step when its tab first shows: no review
   * token, so nothing expires while the tab waits to be shown. */
  terminal(chatId: string, shell: ProjectShell): TerminalTransport;
}

export const projectToolsApi: ProjectToolsApi = {
  review: (chatId) => settle(commands.projectToolsReview(chatId)),
  terminalReview: (chatId) => settle(commands.projectTerminalReview(chatId)),
  openEditor: async (chatId, token, editor) => {
    await settle(commands.projectEditorOpen(chatId, token, editor));
  },
  terminal: (chatId, shell) => ({
    ...terminalTransport,
    // Project shells have their own pool in Rust: several per window, eight in the app.
    reserve: () => settle(commands.projectTerminalReserve()),
    start: async (id, _agent, size) =>
      (await settle(commands.projectTerminalOpen(chatId, shell, id, size.rows, size.cols)))
        .terminal_id,
  }),
};

export const editorName: Record<ProjectEditor, string> = {
  cursor: "Cursor",
  vs_code: "Visual Studio Code",
  vs_code_insiders: "Visual Studio Code Insiders",
  zed: "Zed",
  intellij_idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
  pycharm: "PyCharm",
  rustrover: "RustRover",
  goland: "GoLand",
  clion: "CLion",
};
