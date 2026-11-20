import type {
  AgentEntry,
  ChatRoles,
  ConfigCategory,
  ConfigChoice,
  ConfigOption,
  RoleModel,
  SessionLists,
} from "../bindings";
import { levelName } from "./chat/present";

/**
 * Plan and build, chosen in each chat (owner, 19 November 2026: models by role are "a chat by
 * chat thing not a settings thing"). The chat's model menu names, for this chat only:
 *
 * - Plan with: the model and thinking level of the chat's own agent that turning Plan on
 *   switches to.
 * - Build with: the agent, model and thinking level offered when a plan is accepted, as "Accept
 *   and build with". On the chat's own agent the model and thinking level change and the plan is
 *   accepted; another agent takes the chat over with the plan. A coordinator's chat also starts
 *   its workers on it unless it names another (Rust, `session/coordinator.rs`).
 *
 * A role that is not chosen changes nothing. Rust stores them with the chat (`chat_roles`).
 */
export const NO_ROLES: ChatRoles = { plan: null, build: null };

/** The model and thinking levels an agent last listed, for a role naming another model. */
export interface RoleCatalog {
  readonly models: (agentId: string) => Promise<ConfigChoice[]>;
  readonly thinking: (agentId: string, model: string | null) => Promise<ConfigChoice[]>;
}

/** The chat's Plan with, when it is for the agent the chat is on now. */
export function planRole(
  roles: ChatRoles | null | undefined,
  chatAgent: string | null | undefined,
): RoleModel | null {
  const role = roles?.plan ?? null;
  return role && chatAgent && role.agent === chatAgent ? role : null;
}

/** A role as the window names it: "Codex · GPT-6 Astra · High". */
export function roleLabel(
  role: RoleModel,
  agents: readonly AgentEntry[] | null,
  models: readonly ConfigChoice[] = [],
): string {
  const agent = agents?.find((entry) => entry.id === role.agent)?.name ?? role.agent;
  const model = role.model
    ? (models.find((entry) => entry.value === role.model)?.name ?? role.model)
    : null;
  const effort = role.effort ? levelName({ value: role.effort, name: role.effort }) : null;
  return [agent, model, effort].filter(Boolean).join(" · ");
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
 * What accepting a plan can hand it to: the chat's Build with, when it is chosen, its agent is
 * ready here, and it would change something. In a chat already on that agent and model, Accept
 * plan is the whole of it and nothing more is offered.
 */
export function buildOffer(
  roles: ChatRoles | null | undefined,
  chatAgent: string | null | undefined,
  lists: SessionLists | null,
  agents: readonly AgentEntry[] | null,
): BuildOffer | null {
  const role = roles?.build ?? null;
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
  return {
    role,
    sameAgent,
    label: roleLabel(role, agents, sameAgent ? listedModels(lists) : []),
  };
}

/** The models a chat lists now. */
export function listedModels(lists: SessionLists | null): readonly ConfigChoice[] {
  const option = lists?.options.find((entry) => entry.category === "model");
  return option?.kind.type === "select" ? option.kind.choices : [];
}

/** What the building agent is sent with a plan another agent wrote. */
export function buildPrompt(plan: string, planner: string): string {
  return `Implement this plan. ${planner} wrote it in this chat and I accepted it. Follow it as written; where it leaves something open, choose the simplest thing that fits it and say what you chose.\n\n${plan.trim()}`;
}
