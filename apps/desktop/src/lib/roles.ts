import type {
  AgentEntry,
  ConfigCategory,
  ConfigOption,
  ModelRole,
  RoleModel,
  RoleModels,
  SessionLists,
} from "../bindings";

/**
 * Models by role (owner, 19 November 2026: "different models for different things like fable for
 * planning, gpt 6 astra for implementation or mixing and matching"). Settings > General names an
 * agent, and optionally its model and thinking level, for each kind of work. A role that is not
 * chosen changes nothing.
 *
 * - Planning is applied when Plan is turned on in a chat of that agent.
 * - Building is offered when a plan is accepted, as "Accept and build with": in a chat of the
 *   same agent the model and thinking level change and the plan is accepted; for another agent
 *   the chat is handed to it with the plan.
 * - Coordinator and Workers are read by a coordinated project (Rust, `session/coordinator.rs`).
 */
export const NO_ROLES: RoleModels = { plan: null, build: null, coordinator: null, worker: null };

export const ROLES: readonly {
  readonly role: ModelRole;
  readonly title: string;
  readonly detail: string;
  /** What the agent select's first entry says: nothing is chosen. */
  readonly none: string;
}[] = [
  {
    role: "plan",
    title: "Planning",
    detail: "Applied when you turn Plan on in a chat of this agent.",
    none: "The chat's own model",
  },
  {
    role: "build",
    title: "Building",
    detail:
      "Offered when you accept a plan, as Accept and build with. Another agent than the chat's takes the plan over.",
    none: "The chat's own model",
  },
  {
    role: "coordinator",
    title: "Coordinator",
    detail: "A coordinated project's coordinator starts on this (Settings > Experiments).",
    none: "The project's agent",
  },
  {
    role: "worker",
    title: "Workers",
    detail: "A coordinated project's workers run on this unless the coordinator names another.",
    none: "The coordinator's agent",
  },
];

export function roleOf(roles: RoleModels | null | undefined, role: ModelRole): RoleModel | null {
  return roles?.[role] ?? null;
}

/** A role as the window names it: "Codex · gpt-6-astra · high". */
export function roleLabel(role: RoleModel, agents: readonly AgentEntry[] | null): string {
  const agent = agents?.find((entry) => entry.id === role.agent)?.name ?? role.agent;
  return [agent, role.model, role.effort].filter(Boolean).join(" · ");
}

/** The option of a kind a chat offers, with the choice a role asks for, if it offers it. */
export function roleChoice(
  lists: SessionLists | null,
  category: ConfigCategory,
  wanted: string | null,
): { readonly option: ConfigOption; readonly value: string; readonly current: boolean } | null {
  if (!wanted) return null;
  const option = lists?.options.find((entry) => entry.category === category);
  if (!option || option.kind.type !== "select") return null;
  const asked = wanted.toLowerCase();
  const choice = option.kind.choices.find(
    (entry) => entry.value.toLowerCase() === asked || entry.name.toLowerCase() === asked,
  );
  return choice
    ? { option, value: choice.value, current: option.kind.current === choice.value }
    : null;
}

export interface BuildOffer {
  readonly role: RoleModel;
  /** The chat's own agent builds, on another model or thinking level. */
  readonly sameAgent: boolean;
  readonly label: string;
}

/**
 * What accepting a plan can hand it to: the Building role, when it is chosen, its agent is ready
 * here, and it would change something. In a chat already on that agent and model, Accept plan is
 * the whole of it and nothing more is offered.
 */
export function buildOffer(
  roles: RoleModels | null | undefined,
  chatAgent: string | null | undefined,
  lists: SessionLists | null,
  agents: readonly AgentEntry[] | null,
): BuildOffer | null {
  const role = roleOf(roles, "build");
  if (!role || !chatAgent) return null;
  const ready = agents?.some(
    (entry) => entry.id === role.agent && entry.availability.state === "ready",
  );
  if (!ready) return null;
  const sameAgent = role.agent === chatAgent;
  if (sameAgent) {
    const model = roleChoice(lists, "model", role.model);
    const effort = roleChoice(lists, "effort", role.effort);
    const changes = (model && !model.current) || (effort && !effort.current);
    if (!changes) return null;
  }
  return { role, sameAgent, label: roleLabel(role, agents) };
}

/** What the building agent is sent with a plan another agent wrote. */
export function buildPrompt(plan: string, planner: string): string {
  return `Implement this plan. ${planner} wrote it in this chat and I accepted it. Follow it as written; where it leaves something open, choose the simplest thing that fits it and say what you chose.\n\n${plan.trim()}`;
}
