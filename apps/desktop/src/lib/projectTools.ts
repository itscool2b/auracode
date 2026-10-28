import {
  commands,
  type ProjectEditor,
  type ProjectShell,
  type ProjectToolsReview,
} from "../bindings";
import { settle } from "./ipc";
import { type TerminalTransport, terminalTransport } from "./terminal";

export interface ProjectToolsApi {
  review(chatId: string): Promise<ProjectToolsReview>;
  openEditor(chatId: string, token: string, editor: ProjectEditor): Promise<void>;
  terminal(chatId: string, token: string, shell: ProjectShell): TerminalTransport;
}

export const projectToolsApi: ProjectToolsApi = {
  review: (chatId) => settle(commands.projectToolsReview(chatId)),
  openEditor: async (chatId, token, editor) => {
    await settle(commands.projectEditorOpen(chatId, token, editor));
  },
  terminal: (chatId, token, shell) => ({
    ...terminalTransport,
    // Project shells have their own pool in Rust: several per window, eight in the app.
    reserve: () => settle(commands.projectTerminalReserve()),
    start: (id, _agent, size) =>
      settle(commands.projectTerminalStart(chatId, token, shell, id, size.rows, size.cols)),
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
