import type {
  AuthCommand,
  Autonomy,
  ConfigCategory,
  ConfigOption,
  ConfigValue,
  ErrorKind,
  FolderState,
  PermissionOption,
  SessionStatus,
  SlashCommand,
  TokenUsage,
  UiAnswer,
  UiPrompt,
  UsageInfo,
} from "../../bindings";
import { formatCost, formatCount } from "../format";
import type { PermissionResolution, QuestionResolution } from "./transcript";

/** The words the chat screens use for protocol values: pure, so tests check them directly. */

export function statusWord(status: SessionStatus): string {
  switch (status) {
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "running":
      return "Working";
    case "cancelling":
      return "Stopping the turn";
    case "stopping":
      return "Stopping";
    case "failed":
      return "Couldn't start";
    case "auth_required":
      return "Sign-in needed";
  }
}

/** `null` for a folder that is fine. */
export function folderStateLabel(state: FolderState): string | null {
  switch (state) {
    case "ok":
      return null;
    case "missing":
      return "folder missing";
    case "not_allowed":
      return "folder not allowed";
  }
}

export function autonomyLabel(autonomy: Autonomy): string {
  switch (autonomy) {
    case "full_auto":
      return "Full auto";
    case "auto_edit":
      return "Auto-edit";
    case "ask":
      return "Ask";
  }
}

export const AUTONOMIES: readonly Autonomy[] = ["full_auto", "auto_edit", "ask"];

/** Who closed a card or question, when it was not the user's own answer. */
function closedBy(by: PermissionResolution["by"]): string | null {
  switch (by) {
    case "user":
      return null;
    case "auto":
      return "Auto-approved";
    case "agent":
      return "Withdrawn by the agent";
    case "turn":
      return "Closed when the turn ended";
    case "system":
      return "Closed when the agent stopped";
    case "other":
      return "Closed";
  }
}

/** What a resolved permission card says: who closed it, or the choice the user made. */
export function permissionResolutionLabel(
  resolution: PermissionResolution,
  options: readonly PermissionOption[],
): string {
  const closed = closedBy(resolution.by);
  if (closed !== null && resolution.by !== "auto") return closed;
  if (resolution.decision.type === "cancelled") return closed ?? "Dismissed";
  const { option_id } = resolution.decision;
  const label = options.find((option) => option.option_id === option_id)?.label ?? option_id;
  return closed === null ? `You chose: ${label}` : `${closed}: ${label}`;
}

/** The answer a question got, in words. */
export function answerLabel(answer: UiAnswer, prompt: UiPrompt): string {
  switch (answer.type) {
    case "confirm":
      return answer.yes ? "Yes" : "No";
    case "select":
      return prompt.type === "select"
        ? (prompt.options[answer.index] ?? `Choice ${answer.index + 1}`)
        : `Choice ${answer.index + 1}`;
    case "input":
      return answer.text;
    case "questions":
      return answer.answers
        .map((item) => {
          const question =
            prompt.type === "questions"
              ? prompt.questions.find((question) => question.id === item.question_id)
              : undefined;
          const values = item.selected.map(
            (index) => question?.options[index]?.label ?? `Choice ${index + 1}`,
          );
          if (item.text !== null) values.push(item.text);
          return `${question?.question || question?.header || item.question_id}: ${values.join(", ")}`;
        })
        .join("; ");
  }
}

export function questionResolutionLabel(resolution: QuestionResolution, prompt: UiPrompt): string {
  if (resolution.by === "user") {
    return resolution.answer === null
      ? "Dismissed"
      : `You answered: ${answerLabel(resolution.answer, prompt)}`;
  }
  if (resolution.answer !== null) return answerLabel(resolution.answer, prompt);
  return closedBy(resolution.by) ?? "Closed";
}

/** The buttons an error card offers. */
export interface ErrorActions {
  /** Start the agent again (`chat_start`), continuing its session. */
  readonly retry: boolean;
  /** Start a new native session (`chat_start` with `fresh`): when continuing the old one failed. */
  readonly startFresh: boolean;
}

/** Start failures offer Retry; turn errors (the session stays ready) and internal ones do not. */
export function isStartFailure(kind: ErrorKind): boolean {
  switch (kind) {
    case "agent_unavailable":
    case "folder_missing":
    case "folder_not_allowed":
    case "spawn_failed":
    case "start_timeout":
    case "protocol_mismatch":
    case "agent_exited":
      return true;
    case "auth_required":
    case "agent_error":
    case "protocol_error":
    case "storage":
    case "internal":
    case "other":
      return false;
  }
}

/**
 * Only the newest error card acts, and only while the session has no process: an old card's Retry
 * would start an agent for a problem that is gone. Start fresh shows when there is an earlier
 * session that a resume may have failed to continue.
 */
export function errorActions(
  kind: ErrorKind,
  context: { readonly newest: boolean; readonly live: boolean; readonly resumable: boolean },
): ErrorActions {
  const retry = isStartFailure(kind) && context.newest && !context.live;
  return { retry, startFresh: retry && context.resumable };
}

/** A word that must be quoted for a POSIX shell. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** A sign-in command as the user types it: its variables, then its words. */
export function authCommandText(command: AuthCommand): string {
  const env = command.env.map(([name, value]) => `${name}=${shellWord(value)}`);
  return [...env, ...command.argv.map(shellWord)].join(" ");
}

/** "1.2k in · 300 out · 800 cached (this turn)". */
export function tokensLabel(usage: TokenUsage): string {
  const parts = [
    `${formatCount(usage.input_tokens)} in`,
    `${formatCount(usage.output_tokens)} out`,
  ];
  if (usage.cache_read_tokens !== null && usage.cache_read_tokens > 0) {
    parts.push(`${formatCount(usage.cache_read_tokens)} cached`);
  }
  if (usage.reasoning_tokens !== null && usage.reasoning_tokens > 0) {
    parts.push(`${formatCount(usage.reasoning_tokens)} reasoning`);
  }
  const scope = usage.scope === "turn" ? "this turn" : "this session";
  return `${parts.join(" · ")} (${scope})`;
}

/** "Context 12k of 200k", or `null` when unknown. */
export function contextLabel(usage: UsageInfo | null): string | null {
  if (usage?.context_used === null || usage?.context_used === undefined) return null;
  const size = usage.context_size === null ? "" : ` of ${formatCount(usage.context_size)}`;
  return `Context ${formatCount(usage.context_used)}${size}`;
}

/** The session's cost so far, or `null` when unknown. */
export function costLabel(usage: UsageInfo | null): string | null {
  const cost = usage?.cost;
  return cost ? formatCost(cost.amount, cost.currency) : null;
}

const CATEGORY_ORDER: readonly ConfigCategory[] = [
  "model",
  "effort",
  "mode",
  "model_config",
  "other",
];

/** Options in the pickers' order: model, effort, mode, model config, other; stable within each. */
export function orderedOptions(options: readonly ConfigOption[]): ConfigOption[] {
  return [...options].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
}

/** A pending value in words: the choice's name, or on and off. */
export function pendingLabel(option: ConfigOption, value: ConfigValue): string {
  if (value.type === "toggle") return value.value ? "on" : "off";
  if (option.kind.type === "select") {
    return option.kind.choices.find((choice) => choice.value === value.value)?.name ?? value.value;
  }
  return value.value;
}

/** The slash commands matching what follows a leading `/`, or `null` when the menu is closed. */
export function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

/** "1 minute", "3 minutes". */
export function minutesLabel(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The slash commands whose names contain `query`, those starting with it first. */
export function matchingCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase();
  const matches = commands.filter((command) => command.name.toLowerCase().includes(needle));
  return [
    ...matches.filter((command) => command.name.toLowerCase().startsWith(needle)),
    ...matches.filter((command) => !command.name.toLowerCase().startsWith(needle)),
  ];
}
