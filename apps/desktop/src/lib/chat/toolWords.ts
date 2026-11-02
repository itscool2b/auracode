import type { ToolKind } from "../../bindings";
import type { ToolDisplayStatus } from "./transcript";

/**
 * How tool calls read in the transcript (docs/design/visual-language.md). A call's own line says
 * its verb in the tense of its state: "Searching for useState" while it runs, "Searched for
 * useState" once done, and the agent's own imperative ("Search for useState") while it waits,
 * failed or was stopped, beside that status. A stretch of calls reads as one sentence of counts in
 * the same tenses: "Read 3 files and searched for 2 patterns", or "Reading 3 files…" while any runs.
 */

/** A verb's past and progressive forms, by its base form. */
const FORMS: Readonly<Record<string, readonly [past: string, progressive: string]>> = {
  add: ["added", "adding"],
  analyze: ["analyzed", "analyzing"],
  apply: ["applied", "applying"],
  build: ["built", "building"],
  call: ["called", "calling"],
  check: ["checked", "checking"],
  clean: ["cleaned", "cleaning"],
  clone: ["cloned", "cloning"],
  commit: ["committed", "committing"],
  compare: ["compared", "comparing"],
  compile: ["compiled", "compiling"],
  copy: ["copied", "copying"],
  count: ["counted", "counting"],
  create: ["created", "creating"],
  delete: ["deleted", "deleting"],
  deploy: ["deployed", "deploying"],
  download: ["downloaded", "downloading"],
  edit: ["edited", "editing"],
  enter: ["entered", "entering"],
  execute: ["executed", "executing"],
  exit: ["exited", "exiting"],
  explore: ["explored", "exploring"],
  extract: ["extracted", "extracting"],
  fetch: ["fetched", "fetching"],
  find: ["found", "finding"],
  fix: ["fixed", "fixing"],
  format: ["formatted", "formatting"],
  generate: ["generated", "generating"],
  get: ["got", "getting"],
  glob: ["globbed", "globbing"],
  grep: ["grepped", "grepping"],
  inspect: ["inspected", "inspecting"],
  install: ["installed", "installing"],
  kill: ["killed", "killing"],
  lint: ["linted", "linting"],
  list: ["listed", "listing"],
  load: ["loaded", "loading"],
  look: ["looked", "looking"],
  make: ["made", "making"],
  merge: ["merged", "merging"],
  move: ["moved", "moving"],
  open: ["opened", "opening"],
  patch: ["patched", "patching"],
  print: ["printed", "printing"],
  pull: ["pulled", "pulling"],
  push: ["pushed", "pushing"],
  query: ["queried", "querying"],
  read: ["read", "reading"],
  remove: ["removed", "removing"],
  rename: ["renamed", "renaming"],
  replace: ["replaced", "replacing"],
  restart: ["restarted", "restarting"],
  review: ["reviewed", "reviewing"],
  run: ["ran", "running"],
  save: ["saved", "saving"],
  search: ["searched", "searching"],
  show: ["showed", "showing"],
  start: ["started", "starting"],
  stop: ["stopped", "stopping"],
  switch: ["switched", "switching"],
  test: ["tested", "testing"],
  update: ["updated", "updating"],
  upload: ["uploaded", "uploading"],
  use: ["used", "using"],
  verify: ["verified", "verifying"],
  view: ["viewed", "viewing"],
  write: ["wrote", "writing"],
};

/** Words a verb carries along before its object ("Search for x", "Search the web for x"). */
const PARTICLES = ["the web for", "tools for", "for", "up"] as const;

/** A shell command as agents title one: it starts like a program or a path, never a sentence. */
const COMMAND = /^[a-z./~][^\s]*(?:\s|$)/;

/** "Run the layout checks" names its work in words; "Run cargo test" names a command. */
const PROSE = /^(?:the|a|an|all|any|each|every|my|our|some|this|that|these|those)\s/i;

/** A title split into its leading verb phrase and the object the call acts on. */
export interface ToolTitle {
  /** The verb in the agent's own form ("Search"), or `null` when the title starts with none. */
  readonly verb: string | null;
  /** Words between the verb and the object ("for", "the web for"). */
  readonly particle: string;
  readonly object: string;
  /** The title is a bare command ("pnpm test"); it reads with "Run", "Running" or "Ran". */
  readonly command: boolean;
}

export function parseTitle(title: string, kind: ToolKind): ToolTitle {
  const unwrap = (value: string) => value.replace(/^`([^`]+)`$/, "$1");
  const text = unwrap(title.trim());
  const space = text.indexOf(" ");
  const first = space > 0 ? text.slice(0, space) : text;
  if (/^[A-Z][a-z]+$/.test(first) && Object.hasOwn(FORMS, first.toLowerCase())) {
    let rest = space > 0 ? text.slice(space + 1).trim() : "";
    let particle = "";
    for (const words of PARTICLES)
      if (rest.toLowerCase().startsWith(`${words} `)) {
        particle = rest.slice(0, words.length);
        rest = rest.slice(words.length + 1).trim();
        break;
      }
    if (rest !== "") return { verb: first, particle, object: unwrap(rest), command: false };
  }
  if (kind === "execute" && COMMAND.test(text))
    return { verb: null, particle: "", object: unwrap(text), command: true };
  return { verb: null, particle: "", object: text, command: false };
}

/** A base verb in the tense of a call's state, keeping its capital. */
function inflect(verb: string, display: ToolDisplayStatus): string {
  const forms = FORMS[verb.toLowerCase()];
  if (!forms) return verb;
  const word =
    display === "completed" ? forms[0] : display === "in_progress" ? forms[1] : verb.toLowerCase();
  return /^[A-Z]/.test(verb) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** How a call's line reads: the verb phrase in sans, then the object, in mono when it is code. */
export interface ToolPhrase {
  readonly verb: string | null;
  readonly object: string;
  /** A path, a pattern, a host or a command: set in Geist Mono. */
  readonly literal: boolean;
}

export function toolPhrase(title: string, kind: ToolKind, display: ToolDisplayStatus): ToolPhrase {
  // "write_file: aura-perm.txt": a tool's own name and its argument.
  const named = /^([a-z][\w.-]*):\s+(\S.*)$/.exec(title.trim());
  if (named?.[1] && named[2])
    return { verb: named[1], object: named[2].replace(/^`([^`]+)`$/, "$1"), literal: true };
  const parsed = parseTitle(title, kind);
  if (parsed.command)
    return { verb: inflect("Run", display), object: parsed.object, literal: true };
  if (parsed.verb === null) return { verb: null, object: parsed.object, literal: false };
  const verb = [inflect(parsed.verb, display), parsed.particle].filter(Boolean).join(" ");
  // A pattern is code even with spaces in it; a command after "Run" too. Otherwise one token is.
  const literal =
    !/\s/.test(parsed.object) ||
    (kind === "search" && parsed.particle === "for") ||
    (kind === "execute" &&
      parsed.verb === "Run" &&
      COMMAND.test(parsed.object) &&
      !PROSE.test(parsed.object));
  return { verb, object: parsed.object, literal };
}

/** What a stretch of calls did, by kind, as count phrases: [past, progressive, noun, nouns]. */
const KIND_PHRASE: Readonly<Record<ToolKind, readonly [string, string, string, string]>> = {
  read: ["read", "reading", "file", "files"],
  edit: ["edited", "editing", "file", "files"],
  delete: ["deleted", "deleting", "file", "files"],
  move: ["moved", "moving", "file", "files"],
  search: ["searched for", "searching for", "pattern", "patterns"],
  execute: ["ran", "running", "command", "commands"],
  think: ["worked through", "working through", "step", "steps"],
  fetch: ["browsed", "browsing", "page", "pages"],
  switch_mode: ["changed mode", "changing mode", "", ""],
  other: ["used", "using", "tool", "tools"],
};

/** "A", "A and B", "A, B and C". */
function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The calls of a stretch, as its header shows them. */
export interface GroupedTool {
  readonly toolKind: ToolKind;
  readonly display: ToolDisplayStatus;
}

function running(tool: GroupedTool): boolean {
  return tool.display === "pending" || tool.display === "in_progress";
}

/**
 * A stretch of calls as one sentence: "Read 3 files, searched for 2 patterns and ran 1 command",
 * in the progressive while any call still runs. Kinds keep the order they first appeared in.
 */
export function toolsSummary(tools: readonly GroupedTool[]): string {
  const live = tools.some(running);
  const counts = new Map<ToolKind, number>();
  for (const tool of tools) counts.set(tool.toolKind, (counts.get(tool.toolKind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) => {
    const [past, progressive, one, many] = KIND_PHRASE[kind];
    const verb = live ? progressive : past;
    if (one === "") return count === 1 ? verb : `${verb} ${count} times`;
    return `${verb} ${count} ${count === 1 ? one : many}`;
  });
  const text = sentence(parts);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a stretch's header says at its end: failures and stops show; the rest is for readers. */
export interface GroupResult {
  readonly text: string;
  readonly tone: "failed" | "stopped" | "quiet";
}

export function groupResult(tools: readonly GroupedTool[]): GroupResult {
  const failed = tools.filter((tool) => tool.display === "failed").length;
  const stopped = tools.filter((tool) => tool.display === "stopped").length;
  const single = tools.length === 1;
  if (failed > 0) return { text: single ? "Failed" : `${failed} failed`, tone: "failed" };
  if (stopped > 0) return { text: single ? "Stopped" : `${stopped} stopped`, tone: "stopped" };
  if (tools.some(running)) return { text: "Running", tone: "quiet" };
  return { text: "Done", tone: "quiet" };
}
