import {
  type BackgroundTask,
  commands,
  type ProcessesSnapshot,
  type ProcessRow,
} from "../bindings";
import { settle } from "./ipc";

export interface ProcessesApi {
  snapshot(): Promise<ProcessesSnapshot>;
  stop(chatId: string, pid: number): Promise<void>;
}

export const processesApi: ProcessesApi = {
  snapshot: () => settle(commands.processesSnapshot()),
  stop: async (chatId, pid) => {
    await settle(commands.processStop(chatId, pid));
  },
};

/** How often the open page reads the process table. */
export const REFRESH_MS = 2000;

/** One row as the page lists it: indented under its parent, the agent at depth 0. */
export interface ListedProcess {
  readonly row: ProcessRow;
  readonly depth: number;
  /** The agent process itself: its Stop is the chat's. */
  readonly root: boolean;
}

/**
 * The tree in reading order: each process followed by what it started, nearest first. A process
 * whose parent is not in the tree (it exited) follows the agent's own subtree at depth 1.
 */
export function listTree(rows: readonly ProcessRow[]): ListedProcess[] {
  const root = rows[0];
  if (!root) return [];
  const pids = new Set(rows.map((row) => row.pid));
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows.slice(1)) {
    const parent = row.parent !== null && pids.has(row.parent) ? row.parent : root.pid;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  const listed: ListedProcess[] = [];
  const seen = new Set<number>();
  const walk = (row: ProcessRow, depth: number) => {
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    listed.push({ row, depth, root: row.pid === root.pid });
    for (const child of children.get(row.pid) ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return listed;
}

/** Readings closer together than this say nothing reliable about processor use. */
const MIN_CPU_WINDOW_MS = 500;

/**
 * Processor use since the previous snapshot, in percent of one core (a busy process on several
 * cores passes 100); `null` until two readings at least half a second apart exist.
 */
export function cpuPercent(
  previous: ProcessesSnapshot | null,
  current: ProcessesSnapshot,
  pid: number,
): number | null {
  if (!previous) return null;
  const find = (snapshot: ProcessesSnapshot) =>
    snapshot.chats
      .flatMap((chat) => chat.agents)
      .flatMap((agent) => agent.processes)
      .find((row) => row.pid === pid);
  const before = find(previous);
  const after = find(current);
  if (current.taken_at_ms === null || previous.taken_at_ms === null) return null;
  const elapsed = current.taken_at_ms - previous.taken_at_ms;
  if (
    !before ||
    !after ||
    before.cpu_ms === null ||
    after.cpu_ms === null ||
    before.started_ms !== after.started_ms ||
    elapsed < MIN_CPU_WINDOW_MS
  )
    return null;
  return Math.max(0, ((after.cpu_ms - before.cpu_ms) / elapsed) * 100);
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "42s", "3m", "1h 5m", "2d 3h": how long it has run. */
export function formatUptime(startedMs: number | null, now: number): string | null {
  if (startedMs === null) return null;
  const seconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Running tasks first, then the rest newest first; subagents' own tasks follow their parent. */
export function orderedTasks(tasks: readonly BackgroundTask[]): BackgroundTask[] {
  const rank = (task: BackgroundTask) => (task.status === "running" ? 0 : 1);
  const newest = (task: BackgroundTask) => task.started_at ?? 0;
  return [...tasks].sort((a, b) => rank(a) - rank(b) || newest(b) - newest(a));
}

/** Every process the snapshot lists. */
export function processCount(snapshot: ProcessesSnapshot | null): number {
  return (
    snapshot?.chats.reduce(
      (sum, chat) => sum + chat.agents.reduce((count, agent) => count + agent.processes.length, 0),
      0,
    ) ?? 0
  );
}
