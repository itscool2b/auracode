import {
  commands,
  type InstructionsAgent,
  type InstructionsAgentStatus,
  type InstructionsApplyResult,
  type InstructionsChange,
  type InstructionsFile,
  type InstructionsReview,
  type InstructionsSnapshot,
  type InstructionsTarget,
} from "../bindings";
import { settle, toCommandError } from "./ipc";

/** Thin native transport. Rust resolves every folder; the page sends a target, a key and text. */
export interface InstructionsApi {
  snapshot(target: InstructionsTarget): Promise<InstructionsSnapshot>;
  review(target: InstructionsTarget, change: InstructionsChange): Promise<InstructionsReview>;
  cancel(id: string): Promise<void>;
  apply(id: string): Promise<InstructionsApplyResult>;
  includeInWorktrees(target: InstructionsTarget, path: string): Promise<void>;
  commit(target: InstructionsTarget, path: string): Promise<string>;
}

export const instructionsApi: InstructionsApi = {
  snapshot: (target) => settle(commands.instructionsSnapshot(target)),
  review: (target, change) => settle(commands.instructionsReview(target, change)),
  cancel: async (id) => {
    try {
      await commands.instructionsCancel(id);
    } catch (error) {
      throw toCommandError(error);
    }
  },
  apply: (id) => settle(commands.instructionsApply(id)),
  includeInWorktrees: async (target, path) => {
    await settle(commands.instructionsIncludeInWorktrees(target, path));
  },
  commit: (target, path) => settle(commands.instructionsCommit(target, path)),
};

export const GLOBAL: InstructionsTarget = { type: "global" };

/** A stable key for a target, for drafts and the scope select. */
export function targetKey(target: InstructionsTarget): string {
  switch (target.type) {
    case "global":
      return "global";
    case "folder":
      return `folder:${target.folder_id}`;
    case "chat":
      return `chat:${target.chat_id}`;
  }
}

export function parseTargetKey(key: string): InstructionsTarget {
  if (key.startsWith("folder:")) return { type: "folder", folder_id: key.slice(7) };
  if (key.startsWith("chat:")) return { type: "chat", chat_id: key.slice(5) };
  return GLOBAL;
}

/** The word beside each agent, and whether it asks for attention (the one volt circle). */
export function statusWord(agent: InstructionsAgent): {
  word: string;
  tone: "quiet" | "volt" | "off";
} {
  if (!agent.installed && agent.status !== "unsupported") {
    return {
      word: agent.status === "not_set" ? "Not installed" : statusWords[agent.status],
      tone: "off",
    };
  }
  const tone: "quiet" | "volt" =
    agent.status === "drift" || agent.status === "not_set" || agent.status === "override"
      ? "volt"
      : "quiet";
  return { word: statusWords[agent.status], tone: agent.status === "unsupported" ? "off" : tone };
}

const statusWords: Record<InstructionsAgentStatus, string> = {
  direct: "Reads it",
  import: "Import",
  link: "Link",
  copy: "Managed copy",
  drift: "Edited copy",
  override: "Override",
  own: "Own file",
  not_set: "Not set",
  unsupported: "No user file",
};

export function agentName(snapshot: InstructionsSnapshot, id: string): string {
  return snapshot.agents.find((agent) => agent.id === id)?.name ?? id;
}

/** "Codex, Pi and OpenCode". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function fileByKey(
  snapshot: InstructionsSnapshot,
  key: string | null | undefined,
): InstructionsFile | undefined {
  return key ? snapshot.files.find((file) => file.key === key) : undefined;
}

/**
 * The files the editor offers. Universal shows the source alone; per agent shows every file an
 * agent reads here, then the agent-specific files that do not exist yet, so each can be created.
 */
export function editableFiles(snapshot: InstructionsSnapshot): InstructionsFile[] {
  if (snapshot.mode === "universal" && snapshot.source) {
    const source = fileByKey(snapshot, snapshot.source);
    return source ? [source] : [];
  }
  const existing = snapshot.files.filter((file) => file.kind !== "missing");
  const own = new Set(
    snapshot.agents
      .filter((agent) => agent.installed)
      .flatMap((agent) => [agent.override_file, agent.file])
      .filter((key): key is string => typeof key === "string"),
  );
  const creatable = snapshot.files.filter(
    (file) =>
      file.kind === "missing" && (own.has(file.key) || file.key === snapshot.default_source),
  );
  return [...existing, ...creatable];
}

/** The one sentence under the mode switch. */
export function modeSentence(snapshot: InstructionsSnapshot): string {
  const source = fileByKey(snapshot, snapshot.source)?.path;
  switch (snapshot.mode) {
    case "universal":
      return `${source ?? "One file"} holds the text every agent reads.`;
    case "per_agent":
      return "Agents read different files here.";
    case "none":
      return "No agent reads instructions here yet.";
  }
}

/**
 * Who reads a file, said plainly: shared files name their agents, a file nearly every agent reads
 * names the exceptions, and a file that does not exist yet says who would read it.
 */
export function readersSentence(snapshot: InstructionsSnapshot, file: InstructionsFile): string {
  if (file.kind === "missing") {
    const future = snapshot.agents
      .filter((agent) => agent.override_file === file.key || agent.file === file.key)
      .map((agent) => agent.name);
    if (future.length === 0) return "No agent reads this file here yet.";
    const instead = /(^|[/:])(CLAUDE|AGENTS\.override)\.md$/.test(file.key);
    return `Once created, ${listNames(future)} ${future.length === 1 ? "reads" : "read"} it${instead ? " instead of AGENTS.md" : " as well"}.`;
  }
  // Agents that reach this file through an import, a link or a managed copy read it too.
  const ids = [
    ...file.readers,
    ...snapshot.agents
      .filter((agent) => agent.via === file.key && !file.readers.includes(agent.id))
      .map((agent) => agent.id),
  ];
  const names = ids.map((id) => agentName(snapshot, id));
  if (names.length === 0) return "No agent reads this file here.";
  const others = snapshot.agents
    .filter((agent) => !ids.includes(agent.id))
    .map((agent) => agent.name);
  if (others.length === 0) return "Every agent reads this file.";
  if (names.length > 3 && others.length <= 2)
    return `Every agent reads this file except ${listNames(others)}.`;
  if (names.length > 3)
    return `Read by ${names.slice(0, 3).join(", ")} and ${names.length - 3} more.`;
  return `Read by ${listNames(names)}.`;
}

/**
 * An instruction file that new worktree chats will not have, and what can be offered for it.
 * With `copiesIgnored` (Instructions' worktree switch) a file Git ignores is copied in anyway.
 */
export function worktreeGap(
  file: InstructionsFile,
  copiesIgnored = false,
): { commit: boolean } | null {
  if (file.kind === "missing") return null;
  if (file.git === "untracked") return { commit: true };
  if (file.git === "ignored" && !copiesIgnored) return { commit: false };
  return null;
}

/** Rust's note for a file Git ignores, true while copying into worktree chats is off. */
const IGNORED_NOTE = "Ignored by Git, so new worktree chats won't have it.";

/** The note shown with a file: an ignored one says it is copied while the switch is on. */
export function fileNote(file: InstructionsFile, copiesIgnored: boolean): string | null {
  if (copiesIgnored && file.git === "ignored" && file.note === IGNORED_NOTE)
    return "Ignored by Git. New worktree chats get a copy.";
  return file.note;
}
