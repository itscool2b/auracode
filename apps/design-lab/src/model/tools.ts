import type { ToolKind, ToolLocation, Value } from "../fixture/types";
import { basename, plural } from "./format";

/**
 * How tool calls are named and grouped. Consecutive calls of one family form a run with one summary
 * line, the way Claude Code and Codex collapse exploration: "Read 2 files, searched 1 pattern".
 * Edits, commands, and other tools each group with their own kind only, so a diff or a terminal is
 * never buried inside an exploration group.
 */
export type ToolFamily = "explore" | "edit" | "execute" | "other";

export function familyOf(kind: ToolKind): ToolFamily {
  switch (kind) {
    case "read":
    case "search":
    case "fetch":
    case "think":
      return "explore";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "execute";
    default:
      return "other";
  }
}

function field(input: Value | null, ...names: string[]): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim() !== "") return value;
    // Some agents send argv arrays for commands.
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((part) => typeof part === "string")
    ) {
      return value.join(" ");
    }
  }
  return null;
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  return match?.[1] ?? url;
}

/**
 * What a call acts on: a file path, a search pattern, a command, or a URL. Taken from the agent's
 * structured fields first, its title last. Null when nothing names it.
 */
export function toolTarget(
  kind: ToolKind,
  title: string,
  locations: readonly ToolLocation[],
  rawInput: Value | null,
): string | null {
  switch (kind) {
    case "read":
    case "edit":
    case "delete":
    case "move":
      return (
        locations[0]?.path ?? field(rawInput, "file_path", "path", "abs_path", "filePath") ?? null
      );
    case "search":
      return field(rawInput, "pattern", "query", "regex") ?? (title.trim() || null);
    case "execute":
      return field(rawInput, "command", "cmd") ?? (title.trim() || null);
    case "fetch":
      return field(rawInput, "url", "uri") ?? (title.trim() || null);
    default:
      return null;
  }
}

/** Display form of a target: file names for paths, hosts for URLs, the rest as given. */
function shown(kind: ToolKind, target: string): string {
  switch (kind) {
    case "read":
    case "edit":
    case "delete":
    case "move":
      return basename(target);
    case "fetch":
      return hostOf(target);
    case "search":
      return `"${target}"`;
    default:
      return target;
  }
}

const VERBS: Readonly<
  Record<ToolKind, readonly [past: string, active: string, infinitive: string]>
> = {
  read: ["Read", "Reading", "read"],
  edit: ["Edited", "Editing", "edit"],
  delete: ["Deleted", "Deleting", "delete"],
  move: ["Moved", "Moving", "move"],
  search: ["Searched for", "Searching for", "search for"],
  execute: ["Ran", "Running", "run"],
  fetch: ["Fetched", "Fetching", "fetch"],
  think: ["Thought", "Thinking", "think"],
  switch_mode: ["Switched mode", "Switching mode", "switch mode"],
  other: ["Used a tool", "Using a tool", "use a tool"],
};

/**
 * One call as a line: "Read pacing.ts" (past), "Reading pacing.ts" (active), or "Waiting to run
 * cargo test" (waiting, while a permission request for it is open). Calls with no target fall back
 * to the agent's own title.
 */
export function toolLabel(
  kind: ToolKind,
  target: string | null,
  title: string,
  tense: "past" | "active" | "waiting",
): string {
  const verbs = VERBS[kind] ?? VERBS.other;
  if (tense === "waiting") {
    if (kind === "think" || kind === "switch_mode" || kind === "other" || target === null) {
      return "Waiting for approval";
    }
    return `Waiting to ${verbs[2]} ${shown(kind, target)}`;
  }
  const verb = tense === "past" ? verbs[0] : verbs[1];
  if (kind === "think" || kind === "switch_mode" || kind === "other") return title.trim() || verb;
  if (target === null) return title.trim() || verb;
  return `${verb} ${shown(kind, target)}`;
}

/** The facts about a call that a run summary needs. */
export interface SummaryCall {
  readonly kind: ToolKind;
  readonly target: string | null;
  readonly title: string;
}

function countPhrase(kind: ToolKind, count: number): string {
  switch (kind) {
    case "read":
      return `read ${plural(count, "file")}`;
    case "edit":
      return `edited ${plural(count, "file")}`;
    case "delete":
      return `deleted ${plural(count, "file")}`;
    case "move":
      return `moved ${plural(count, "file")}`;
    case "search":
      return `searched ${plural(count, "pattern")}`;
    case "execute":
      return `ran ${plural(count, "command")}`;
    case "fetch":
      return `fetched ${plural(count, "page")}`;
    case "think":
      return `thought ${plural(count, "time")}`;
    default:
      return `used ${plural(count, "tool")}`;
  }
}

/**
 * The summary line of a run, in the past tense. One call, or several on one target, reads as that
 * call ("Read pacing.ts", "Ran pnpm test"). Otherwise kinds are counted in order of first
 * appearance, distinct targets for files and patterns: "Read 2 files, searched 1 pattern".
 */
export function runSummary(calls: readonly SummaryCall[]): string {
  const last = calls[calls.length - 1];
  if (!last) return "";
  const byKind = new Map<ToolKind, Set<string>>();
  calls.forEach((call, index) => {
    const targets = byKind.get(call.kind) ?? new Set<string>();
    // Calls without a target count individually.
    targets.add(call.target ?? `#${index}`);
    byKind.set(call.kind, targets);
  });
  const [only] = byKind.values();
  if (byKind.size === 1 && only?.size === 1) {
    return toolLabel(last.kind, last.target, last.title, "past");
  }
  const text = [...byKind].map(([kind, targets]) => countPhrase(kind, targets.size)).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
