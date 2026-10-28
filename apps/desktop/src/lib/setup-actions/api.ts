import { invoke } from "@tauri-apps/api/core";
import type { TerminalTransport } from "../terminal";
import { terminalTransport } from "../terminal";
import type { AgentInstallReview, CloneCheck, CloneInput, CloneRecord } from "./bindings";

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
  /** Reads the form: the exact command when it is complete, or the first problem. */
  check(input: CloneInput): Promise<CloneCheck>;
  cancelReview(id: string): Promise<void>;
  start(id: string): Promise<CloneRecord>;
  cancel(id: string): Promise<void>;
  /** With `after`, resolves at the next revision (or within ten seconds). */
  status(id: string, after: number | null): Promise<CloneRecord>;
}
export const cloneApi: CloneApi = {
  check: (input) => call("clone_check", { input }),
  cancelReview: (id) => call("clone_cancel_review", { id }),
  start: (id) => call("clone_start", { id }),
  cancel: (id) => call("clone_cancel", { id }),
  status: (id, after) => call("clone_status", { id, after }),
};
