import { invoke } from "@tauri-apps/api/core";
import type { TerminalTransport } from "../terminal";
import { terminalTransport } from "../terminal";
import type { AgentInstallReview, CloneInput, CloneRecord, CloneReview } from "./bindings";

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (typeof error === "object" && error !== null && "message" in error) {
      throw new Error(String(error.message));
    }
    throw new Error("The setup action could not continue.");
  }
}

export interface InstallApi {
  review(agentId: string): Promise<AgentInstallReview>;
  terminal(review: AgentInstallReview): TerminalTransport;
}

export const installApi: InstallApi = {
  review: (agentId) => call("agent_install_review", { agentId }),
  terminal: (review) => ({
    ...terminalTransport,
    start: (terminalId, agentId, size) =>
      call("agent_install_start", {
        terminalId,
        agentId,
        revision: review.revision,
        rows: size.rows,
        cols: size.cols,
      }),
  }),
};

export interface CloneApi {
  review(input: CloneInput): Promise<CloneReview>;
  cancelReview(id: string): Promise<void>;
  start(id: string): Promise<CloneRecord>;
  cancel(id: string): Promise<void>;
  status(id: string): Promise<CloneRecord>;
  history(parent: string): Promise<CloneRecord[]>;
}
export const cloneApi: CloneApi = {
  review: (input) => call("clone_review", { input }),
  cancelReview: (id) => call("clone_cancel_review", { id }),
  start: (id) => call("clone_start", { id }),
  cancel: (id) => call("clone_cancel", { id }),
  status: (id) => call("clone_status", { id }),
  history: (parent) => call("clone_history", { parent }),
};
