import { getBrand } from "@auracode/ui";
import type { AgentEntry } from "../../bindings";
import { agentChoice } from "./appStore";

const DEMO = "mock";

/** One product per brand: native and adapter variants (Claude Code and its ACP twin) share one. */
function productOf(agent: AgentEntry): string {
  const brand = getBrand(agent.id).id;
  return brand === "generic" ? agent.id : brand;
}

/**
 * Which agents a chat can start with and which wait aside, the one source every agent list and
 * count reads (New chat's choices and its "Other agents" count, the composer's agent picker):
 *
 * - `usable`: every agent that can run here (ready, or still being detected), catalog order;
 * - `others`: the rest (missing or broken), so `usable.length + others.length` is the catalog;
 * - `products`: one usable variant per product, the first ready one in catalog order (the
 *   catalog lists native before adapters), then one still being detected; the scripted demo only
 *   while no real agent is usable.
 */
export function agentLineup(agents: readonly AgentEntry[]): {
  readonly usable: readonly AgentEntry[];
  readonly others: readonly AgentEntry[];
  readonly products: readonly AgentEntry[];
} {
  const usable = agents.filter((agent) => agentChoice(agent).enabled);
  const others = agents.filter((agent) => !agentChoice(agent).enabled);
  const byProduct = new Map<string, AgentEntry[]>();
  for (const agent of usable) {
    const key = productOf(agent);
    byProduct.set(key, [...(byProduct.get(key) ?? []), agent]);
  }
  const products: AgentEntry[] = [];
  for (const variants of byProduct.values()) {
    const pick =
      variants.find((agent) => agent.availability.state === "ready") ??
      variants.find((agent) => agent.availability.state === "checking");
    if (pick) products.push(pick);
  }
  const real = products.filter((agent) => agent.id !== DEMO);
  return { usable, others, products: real.length > 0 ? real : products };
}
