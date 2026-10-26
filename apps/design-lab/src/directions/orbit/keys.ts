import type { AgentInfo, Autonomy } from "../../kit";
import type { AnswerKind } from "./state";

/*
 * Orbit's keyboard, decided in one place so it can be tested without a DOM. Keys are visible
 * everywhere (keycaps in menus, buttons and cards), and they mean the same thing wherever they
 * appear: 1 to 3 pick, Enter confirms, Esc backs out one layer at a time.
 */

/* --------------------------------------------------------------------------- the picker */

/** Single-letter keys for agents in the picker (visual-language.md 4.10). */
const AGENT_LETTERS: Readonly<Record<string, string>> = {
  "claude-code": "C",
  codex: "X",
  grok: "G",
  cursor: "U",
  pi: "P",
  "oh-my-pi": "M",
  opencode: "O",
  hermes: "H",
  antigravity: "A",
};

/** Every agent's letter; an agent without one takes the first free letter of its name. */
export function agentLetters(agents: readonly AgentInfo[]): ReadonlyMap<string, string> {
  const letters = new Map<string, string>();
  const taken = new Set<string>();
  for (const agent of agents) {
    const fixed = Object.hasOwn(AGENT_LETTERS, agent.id) ? AGENT_LETTERS[agent.id] : undefined;
    if (fixed && !taken.has(fixed)) {
      letters.set(agent.id, fixed);
      taken.add(fixed);
    }
  }
  for (const agent of agents) {
    if (letters.has(agent.id)) continue;
    const free = [...agent.name.toUpperCase()].find(
      (char) => /[A-Z]/.test(char) && !taken.has(char),
    );
    if (free) {
      letters.set(agent.id, free);
      taken.add(free);
    }
  }
  return letters;
}

/** Where the picker's keyboard is: the focused column and the row chosen in each. */
export interface PickerCursor {
  readonly column: 0 | 1 | 2;
  readonly agent: string;
  readonly model: string;
  readonly effort: string | null;
}

export type PickerAction = "none" | "commit" | "close";

function modelsOf(agents: readonly AgentInfo[], agentId: string) {
  return agents.find((agent) => agent.id === agentId)?.models ?? [];
}

/** The model and effort an agent starts on: the current ones if it is the same agent. */
function landOn(
  agents: readonly AgentInfo[],
  agentId: string,
  current: { readonly agent: string; readonly model: string; readonly effort: string | null },
): { model: string; effort: string | null } {
  if (agentId === current.agent) return { model: current.model, effort: current.effort };
  const agent = agents.find((candidate) => candidate.id === agentId);
  const model =
    agent?.models.find((candidate) => candidate.id === agent.defaultModel) ?? agent?.models[0];
  return { model: model?.id ?? "", effort: model?.defaultEffort ?? null };
}

/** The picker opens on the current agent, model and effort, in the agent column. */
export function openCursor(composer: {
  readonly agent: string;
  readonly model: string;
  readonly effort: string | null;
}): PickerCursor {
  return { column: 0, agent: composer.agent, model: composer.model, effort: composer.effort };
}

/** Moves to an agent: its model column and effort follow it. */
export function cursorToAgent(
  cursor: PickerCursor,
  agentId: string,
  agents: readonly AgentInfo[],
  start: { readonly agent: string; readonly model: string; readonly effort: string | null },
): PickerCursor {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent?.installed) return cursor;
  return { ...cursor, agent: agentId, ...landOn(agents, agentId, start) };
}

/** Moves to a model: the effort stays when the model has it, else takes the model's default. */
export function cursorToModel(
  cursor: PickerCursor,
  modelId: string,
  agents: readonly AgentInfo[],
): PickerCursor {
  const model = modelsOf(agents, cursor.agent).find((candidate) => candidate.id === modelId);
  if (!model) return cursor;
  const keeps = model.efforts.some((effort) => effort.id === cursor.effort);
  return { ...cursor, model: modelId, effort: keeps ? cursor.effort : model.defaultEffort };
}

/**
 * One key in the open picker: arrows move within and across columns, letters jump to agents,
 * digits set the effort, Enter commits all three, Esc closes. Null when the key is not the
 * picker's.
 */
export function pickerKey(
  cursor: PickerCursor,
  key: string,
  agents: readonly AgentInfo[],
  start: { readonly agent: string; readonly model: string; readonly effort: string | null },
): { readonly cursor: PickerCursor; readonly action: PickerAction } | null {
  const installed = agents.filter((agent) => agent.installed);
  const models = modelsOf(agents, cursor.agent);
  const efforts = models.find((model) => model.id === cursor.model)?.efforts ?? [];
  const step = (direction: 1 | -1): PickerCursor => {
    if (cursor.column === 0) {
      const index = installed.findIndex((agent) => agent.id === cursor.agent);
      const next = installed[Math.min(installed.length - 1, Math.max(0, index + direction))];
      return next ? cursorToAgent(cursor, next.id, agents, start) : cursor;
    }
    if (cursor.column === 1) {
      const index = models.findIndex((model) => model.id === cursor.model);
      const next = models[Math.min(models.length - 1, Math.max(0, index + direction))];
      return next ? cursorToModel(cursor, next.id, agents) : cursor;
    }
    const index = efforts.findIndex((effort) => effort.id === cursor.effort);
    const next = efforts[Math.min(efforts.length - 1, Math.max(0, index + direction))];
    return next ? { ...cursor, effort: next.id } : cursor;
  };

  switch (key) {
    case "ArrowDown":
      return { cursor: step(1), action: "none" };
    case "ArrowUp":
      return { cursor: step(-1), action: "none" };
    case "ArrowRight": {
      const limit = efforts.length > 0 ? 2 : 1;
      return {
        cursor: { ...cursor, column: Math.min(limit, cursor.column + 1) as PickerCursor["column"] },
        action: "none",
      };
    }
    case "ArrowLeft":
      return {
        cursor: { ...cursor, column: Math.max(0, cursor.column - 1) as PickerCursor["column"] },
        action: "none",
      };
    case "Enter":
      return { cursor, action: "commit" };
    case "Escape":
      return { cursor, action: "close" };
    default:
      break;
  }
  if (/^[1-9]$/.test(key)) {
    const effort = efforts[Number(key) - 1];
    if (!effort) return { cursor, action: "none" };
    return { cursor: { ...cursor, column: 2, effort: effort.id }, action: "none" };
  }
  if (/^[a-z]$/i.test(key)) {
    const letters = agentLetters(agents);
    const match = agents.find((agent) => letters.get(agent.id) === key.toUpperCase());
    if (!match) return null;
    return {
      cursor: { ...cursorToAgent(cursor, match.id, agents, start), column: 0 },
      action: "none",
    };
  }
  return null;
}

/* ------------------------------------------------------------------- permission and escape */

/** Where keyboard focus is, as far as the window's keys care. */
export type Focus = "composer-empty" | "composer-text" | "field" | "menu" | "other";

/**
 * A key on the permission card: 1 allows once, 2 allows in this chat, 3 always allows in the
 * project, Esc denies, anywhere in the window. Enter allows once only from inside the card (where
 * the primary answer has focus), so an Enter meant for something else never runs a command. Never
 * while typing or while a menu is open.
 */
export function permissionKey(
  key: string,
  context: {
    readonly focus: Focus;
    readonly menuOpen: boolean;
    readonly onButton?: boolean;
    readonly inCard?: boolean;
  },
): AnswerKind | null {
  if (context.menuOpen) return null;
  if (context.focus === "field" || context.focus === "composer-text" || context.focus === "menu") {
    return null;
  }
  switch (key) {
    case "1":
      return "allow_once";
    case "Enter":
      // Enter on a focused button presses that button; elsewhere outside the card it does nothing.
      return context.onButton || !context.inCard ? null : "allow_once";
    case "2":
      return "allow_chat";
    case "3":
      return "allow_always";
    case "Escape":
      return "deny";
    default:
      return null;
  }
}

export type EscapeAction = "close-picker" | "close-menu" | "deny" | "stop" | "force-stop";

/**
 * What Esc does now, topmost layer first; null when it has nothing to do. Any other layer that is
 * up (a menu, a popover, the agent card, a sheet) closes itself on Esc, so the window's Esc does
 * nothing until it is gone: an Esc meant to close a card never stops a running turn.
 */
export function escapeAction(context: {
  readonly pickerOpen: boolean;
  readonly menuOpen: boolean;
  /** Another layer is up and owns its own Esc. */
  readonly overlayOpen?: boolean;
  readonly permissionPending: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly focus: Focus;
}): EscapeAction | null {
  if (context.pickerOpen) return "close-picker";
  if (context.menuOpen) return "close-menu";
  if (context.overlayOpen) return null;
  // A draft or a field keeps its own Esc.
  if (context.focus === "composer-text" || context.focus === "field") return null;
  if (context.permissionPending) return "deny";
  if (context.stopping) return "force-stop";
  if (context.running) return "stop";
  return null;
}

/** Enter in the composer: send when idle, queue while the agent works, steer with Cmd. */
export function submitAction(context: {
  readonly text: string;
  readonly running: boolean;
  readonly meta: boolean;
  readonly canSteer: boolean;
}): "send" | "queue" | "steer" | null {
  if (context.text.trim() === "") return null;
  if (!context.running) return "send";
  if (context.meta && context.canSteer) return "steer";
  return "queue";
}

/** Cmd Shift A: the next autonomy level the agent supports (Full auto, Auto-edit, Ask, around). */
export function nextAutonomy(current: Autonomy, allowed: readonly Autonomy[]): Autonomy {
  const order: readonly Autonomy[] = ["full_auto", "auto_edit", "ask"];
  const usable = order.filter((level) => allowed.includes(level));
  if (usable.length === 0) return current;
  const index = usable.indexOf(current);
  return usable[(index + 1) % usable.length] ?? current;
}

/** Classifies what a key event targets. */
export function focusOf(target: EventTarget | null): Focus {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return "other";
  if (target.closest("[data-orbit-menu]")) return "menu";
  if (target instanceof HTMLTextAreaElement && target.dataset.composer !== undefined) {
    return target.value.trim() === "" ? "composer-empty" : "composer-text";
  }
  if (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return "field";
  }
  return "other";
}
