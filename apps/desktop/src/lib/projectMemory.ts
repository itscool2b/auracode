import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  type AcceptMemoryProposal,
  type ChatSummary,
  commands,
  type ImportProjectMemory,
  type MemoryProposal,
  type MemoryRevision,
  type ProjectMemory,
  type ProjectMemoryBundle,
  type ProjectMemoryChanged,
  type SaveProjectMemory,
} from "../bindings";
import { errorMessage } from "./errors";
import { inTauri, settle } from "./ipc";

export interface ProjectMemoryApi {
  read(projectId: string): Promise<ProjectMemory>;
  save(input: SaveProjectMemory): Promise<ProjectMemory>;
  accept(input: AcceptMemoryProposal): Promise<ProjectMemory>;
  reject(projectId: string, proposalId: string): Promise<MemoryProposal[]>;
  history(projectId: string): Promise<MemoryRevision[]>;
  proposals(projectId: string): Promise<MemoryProposal[]>;
  export(projectId: string): Promise<ProjectMemoryBundle>;
  import(input: ImportProjectMemory): Promise<ProjectMemory>;
  /**
   * Calls `changed` after every committed memory change, the editor's or an agent's, until the
   * returned function is called. An agent's direct edit is named in `agent_edit`.
   */
  subscribe(changed: (change: ProjectMemoryChanged) => void): () => void;
}

/** The window event Rust sends after each committed memory change (memory_commands.rs). */
export const PROJECT_MEMORY_CHANGED = "auracode-project-memory-changed";
/** Read every open project again: changes were missed, or may have arrived with sync. */
export const MEMORY_CHANGED_ANYWHERE: ProjectMemoryChanged = { project_id: null, agent_edit: null };

/** Native memory changes, and finished sync exchanges, which can bring other devices' revisions. */
export function subscribeProjectMemory(
  changed: (change: ProjectMemoryChanged) => void,
): () => void {
  if (!inTauri()) return () => {};
  let disposed = false;
  const stops: UnlistenFn[] = [];
  const keep = (stop: UnlistenFn) => {
    if (disposed) stop();
    else stops.push(stop);
  };
  // Without native events, focus and Refresh still read memory again.
  void listen<ProjectMemoryChanged>(PROJECT_MEMORY_CHANGED, ({ payload }) => {
    if (!disposed) changed(payload);
  })
    .then(keep)
    .catch(() => {});
  void listen<[string, { readonly state: string }]>("account-sync-changed", ({ payload }) => {
    if (!disposed && payload[1]?.state === "idle") changed(MEMORY_CHANGED_ANYWHERE);
  })
    .then(keep)
    .catch(() => {});
  return () => {
    disposed = true;
    for (const stop of stops.splice(0)) stop();
  };
}

export const projectMemoryApi: ProjectMemoryApi = {
  read: (id) => settle(commands.readProjectMemory(id)),
  save: (input) => settle(commands.saveProjectMemory(input)),
  accept: (input) => settle(commands.acceptMemoryProposal(input)),
  reject: (id, proposal) => settle(commands.rejectMemoryProposal(id, proposal)),
  history: (id) => settle(commands.projectMemoryHistory(id)),
  proposals: (id) => settle(commands.projectMemoryProposals(id)),
  export: (id) => settle(commands.exportProjectMemory(id)),
  import: (input) => settle(commands.importProjectMemory(input)),
  subscribe: subscribeProjectMemory,
};
export const MAX_MEMORY_BYTES = 16 * 1024;
export function memoryBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}
export function proposalIsCurrent(proposal: MemoryProposal, memory: ProjectMemory): boolean {
  return (
    proposal.project_id === memory.project_id &&
    proposal.base_revision === memory.revision &&
    (proposal.state === "pending" || proposal.state === "conflict")
  );
}

/** What memory shows of a chat: its title and its agent's name. */
export interface MemoryChat {
  readonly title: string | null;
  readonly agent: string;
}
export type MemoryChats = ReadonlyMap<string, MemoryChat>;
export const NO_CHATS: MemoryChats = new Map();
/** Later entries win, so live chat titles can follow the saved ones. */
export function memoryChats(
  chats: readonly Pick<ChatSummary, "id" | "title" | "agent_name">[],
): MemoryChats {
  return new Map(chats.map((chat) => [chat.id, { title: chat.title, agent: chat.agent_name }]));
}

/** A revision an agent saved directly names its chat (chatstore/memory.rs). */
export const AGENT_SOURCE = "agent:";
export function agentChat(source: string): string | null {
  return source.startsWith(AGENT_SOURCE) ? source.slice(AGENT_SOURCE.length) || null : null;
}

/**
 * Names the agent of a chat: "Claude Code in Fix the login flow", "Claude Code" for an untitled
 * chat, or "An agent" (`an agent` inside a sentence) when the chat is not known here.
 */
export function agentLabel(chatId: string, chats: MemoryChats, sentenceStart = true): string {
  const chat = chats.get(chatId);
  if (!chat) return sentenceStart ? "An agent" : "an agent";
  const title = chat.title?.trim();
  return title ? `${chat.agent} in ${title}` : chat.agent;
}

/** Who made a revision, for its history entry. */
export function revisionAuthor(source: string, chats: MemoryChats): string {
  const chat = agentChat(source);
  if (chat !== null) return agentLabel(chat, chats);
  switch (source) {
    case "user":
      return "You";
    case "proposal":
      return "Accepted proposal";
    case "import":
      return "Imported";
    default:
      return source;
  }
}

export function revisionTime(revision: Pick<MemoryRevision, "created_at">): string {
  return new Date(revision.created_at).toLocaleString();
}

/** The reason a one-click restore saves with. */
export function restoreReason(revision: MemoryRevision): string {
  return `Restored the revision from ${revisionTime(revision)}`;
}

/**
 * The text a revision replaced, for its diff: its parent's, empty for the first revision, or
 * `null` when the parent is not on this device.
 */
export function previousText(
  revision: MemoryRevision,
  history: readonly MemoryRevision[],
): string | null {
  if (revision.parent_revision === null) return "";
  return history.find((entry) => entry.revision === revision.parent_revision)?.markdown ?? null;
}

/** A newer saved version than the one a draft started from. It is shown, never applied over it. */
export function newerVersion(
  base: ProjectMemory | null,
  saved: ProjectMemory | null,
  draft: string,
): ProjectMemory | null {
  if (!base || !saved || saved.project_id !== base.project_id) return null;
  return saved.revision !== base.revision && draft !== base.markdown ? saved : null;
}

/** Whether an editor without a draft takes a newer saved version at once. */
export function adoptsSaved(
  base: ProjectMemory | null,
  saved: ProjectMemory | null,
  draft: string,
): boolean {
  return (
    !!base &&
    !!saved &&
    saved.project_id === base.project_id &&
    saved.revision !== base.revision &&
    draft === base.markdown
  );
}

export type AgentEditState =
  | { readonly status: "shown" }
  | { readonly status: "undoing" }
  | { readonly status: "undone" }
  | { readonly status: "failed"; readonly message: string };

/** The window's notice of agents' direct edits to one project, with what Undo restores. */
export interface AgentEditNotice {
  readonly projectId: string;
  /** The latest agent revision: Undo applies only while memory is still at it. */
  readonly revision: string;
  /** The revision before these edits, which Undo restores; `null` when memory was empty. */
  readonly restores: string | null;
  readonly chats: readonly string[];
  readonly edits: number;
  readonly state: AgentEditState;
}
const MAX_NOTICES = 3;

/**
 * Adds an agent's direct edit. Edits that follow each other in one project fold into one notice,
 * so Undo returns to the revision before the first; anything in between starts a new notice.
 */
export function noticeAgentEdit(
  notices: readonly AgentEditNotice[],
  change: ProjectMemoryChanged,
): readonly AgentEditNotice[] {
  const edit = change.agent_edit;
  const projectId = change.project_id;
  if (!edit || !projectId) return notices;
  const current = notices.find((notice) => notice.projectId === projectId);
  if (current?.revision === edit.revision) return notices;
  const next: AgentEditNotice =
    current?.state.status === "shown" && current.revision === edit.parent_revision
      ? {
          ...current,
          revision: edit.revision,
          edits: current.edits + 1,
          chats: current.chats.includes(edit.chat_id)
            ? current.chats
            : [...current.chats, edit.chat_id],
        }
      : {
          projectId,
          revision: edit.revision,
          restores: edit.parent_revision,
          chats: [edit.chat_id],
          edits: 1,
          state: { status: "shown" },
        };
  return [...notices.filter((notice) => notice.projectId !== projectId), next].slice(-MAX_NOTICES);
}

/** Who made a notice's edits, at the start of a sentence or inside one. */
export function agentEditAuthor(
  notice: AgentEditNotice,
  chats: MemoryChats,
  sentenceStart = true,
): string {
  const [only] = notice.chats;
  if (notice.chats.length === 1 && only !== undefined)
    return agentLabel(only, chats, sentenceStart);
  return `${sentenceStart ? "Agents" : "agents"} in ${notice.chats.length} chats`;
}

/**
 * A memory edit as its toast says it: a short title, then who and where on one line ("Claude
 * Code · Fix the login flow · auracode"), so a long chat title shortens instead of swallowing the
 * sentence around it. `agentEditText` stays the full sentence, for the toast's tooltip.
 */
export function agentEditToast(
  notice: AgentEditNotice,
  chats: MemoryChats,
  project: string | null,
): { readonly title: string; readonly detail: string } {
  if (notice.state.status === "undone") {
    return {
      title: "Edit undone",
      detail: `Project memory${project ? ` for ${project}` : ""} is back to its revision before ${
        notice.edits > 1 ? "these edits" : "this edit"
      }.`,
    };
  }
  const [only] = notice.chats;
  const chat = notice.chats.length === 1 && only !== undefined ? chats.get(only) : undefined;
  const who =
    notice.chats.length > 1
      ? [`Agents in ${notice.chats.length} chats`]
      : chat
        ? [chat.agent, chat.title?.trim() ?? ""]
        : ["An agent"];
  return {
    title: notice.edits > 1 ? `${notice.edits} edits to project memory` : "Project memory updated",
    detail: [...who, project ?? ""].filter((part) => part !== "").join(" · "),
  };
}

/** "Claude Code in Fix the login flow updated project memory for auracode." */
export function agentEditText(
  notice: AgentEditNotice,
  chats: MemoryChats,
  project: string | null,
): string {
  const target = `project memory${project ? ` for ${project}` : ""}`;
  if (notice.state.status === "undone") {
    return `Undone. The ${target} is back to its revision before ${
      notice.edits > 1 ? "these edits" : "this edit"
    }.`;
  }
  const who = agentEditAuthor(notice, chats);
  return notice.edits > 1
    ? `${who} made ${notice.edits} edits to ${target}.`
    : `${who} updated ${target}.`;
}

/**
 * Restores what a notice's edits replaced as a new revision of yours. It applies only while memory
 * is still at their result, so a later edit by anyone is never overwritten.
 */
export async function undoAgentEdit(
  api: Pick<ProjectMemoryApi, "history" | "save">,
  notice: AgentEditNotice,
  chats: MemoryChats,
): Promise<ProjectMemory> {
  let markdown = "";
  if (notice.restores !== null) {
    const previous = (await api.history(notice.projectId)).find(
      (revision) => revision.revision === notice.restores,
    );
    if (!previous)
      throw new Error(
        "The revision before this edit is not on this device. Review the history in Project memory.",
      );
    markdown = previous.markdown;
  }
  return api.save({
    project_id: notice.projectId,
    expected_revision: notice.revision,
    markdown,
    reason: `Undid ${notice.edits > 1 ? `${notice.edits} edits` : "an edit"} by ${agentEditAuthor(
      notice,
      chats,
      false,
    )}`,
  });
}

/** The notices of agents' direct edits, from the memory events, with Undo and Dismiss. */
export function useAgentMemoryEdits(api: ProjectMemoryApi) {
  const [notices, setNotices] = useState<readonly AgentEditNotice[]>([]);
  useEffect(
    () => api.subscribe((change) => setNotices((current) => noticeAgentEdit(current, change))),
    [api],
  );
  const update = (notice: AgentEditNotice, state: AgentEditState) =>
    setNotices((current) =>
      current.map((entry) =>
        entry.projectId === notice.projectId && entry.revision === notice.revision
          ? { ...entry, state }
          : entry,
      ),
    );
  return {
    notices,
    dismiss: (notice: AgentEditNotice) =>
      setNotices((current) =>
        current.filter(
          (entry) => entry.projectId !== notice.projectId || entry.revision !== notice.revision,
        ),
      ),
    undo: async (notice: AgentEditNotice, chats: MemoryChats) => {
      update(notice, { status: "undoing" });
      try {
        await undoAgentEdit(api, notice, chats);
        update(notice, { status: "undone" });
      } catch (failure) {
        update(notice, {
          status: "failed",
          message: `Nothing was undone. ${errorMessage(failure)}`,
        });
      }
    },
  };
}
