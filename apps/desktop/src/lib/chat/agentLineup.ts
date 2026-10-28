import type { AgentEntry } from "../../bindings";
import { agentChoice } from "./appStore";

const DEMO = "mock";

/**
 * Which agents a chat can start with and which wait aside, the one source every agent list and
 * count reads (New chat's choices and its "Other agents" count, the composer's agent picker).
 * Rust reports one entry per agent: Claude Code's ACP adapter, say, is a connection of Claude
 * Code, chosen in its details on the Agents page, never a second agent here.
 *
 * - `usable`: every agent that can run here (ready, or still being detected), catalog order;
 * - `others`: the rest (missing or broken), so `usable.length + others.length` is the catalog;
 * - `products`: the usable agents for the picker; the scripted demo only while no real agent is
 *   usable.
 */
export function agentLineup(agents: readonly AgentEntry[]): {
  readonly usable: readonly AgentEntry[];
  readonly others: readonly AgentEntry[];
  readonly products: readonly AgentEntry[];
} {
  const usable = agents.filter((agent) => agentChoice(agent).enabled);
  const others = agents.filter((agent) => !agentChoice(agent).enabled);
  const real = usable.filter((agent) => agent.id !== DEMO);
  return { usable, others, products: real.length > 0 ? real : usable };
}

/**
 * The agents a person has here, as onboarding counts them ("Found N agents"): every real agent,
 * the scripted demo aside. The same entries New chat offers, so the counts agree.
 */
export function realAgents(agents: readonly AgentEntry[]): readonly AgentEntry[] {
  return agents.filter((agent) => agent.id !== DEMO);
}
