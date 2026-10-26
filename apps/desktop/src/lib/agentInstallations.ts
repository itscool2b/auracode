import { type AgentInstallations, commands } from "../bindings";
import { settle } from "./ipc";

export interface AgentInstallationsApi {
  list(agentId: string): Promise<AgentInstallations>;
  select(agentId: string, path: string | null): Promise<AgentInstallations>;
}
export const agentInstallationsApi: AgentInstallationsApi = {
  list: (agentId) => settle(commands.agentInstallations(agentId)),
  select: (agentId, path) => settle(commands.agentSelectInstallation(agentId, path)),
};
