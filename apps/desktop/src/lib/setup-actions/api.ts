import { invoke } from "@tauri-apps/api/core";
import type { TerminalTransport } from "../terminal";
import { terminalTransport } from "../terminal";
import type { AgentInstallReview } from "./bindings";

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
