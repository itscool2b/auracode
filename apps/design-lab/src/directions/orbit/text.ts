import {
  basename,
  dirname,
  formatCount,
  formatElapsed,
  stripAnsi,
  type ToolCallModel,
  type ToolKind,
  type Turn,
} from "../../kit";

/*
 * Orbit's words and numbers: sentences with real numbers ("Ran pnpm test · 19 passed · 4.2s"),
 * paths split into folder and name, costs with built superscript cents, diffstats as squares.
 * Pure, so every rule is tested in Node.
 */

/** "packages/ui/src/orb/pacing.ts" as its folder (with the slash) and its name. */
export function splitPath(path: string): { readonly dir: string; readonly name: string } {
  const name = basename(path);
  const dir = dirname(path);
  return { dir: dir === "" ? "" : `${dir}/`, name };
}

/** A wait or an elapsed time as a clock: "0:09", "1:05", "12:00". Whole seconds, never negative. */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A cost split for a numeral with superscript cents, the way X Money and Mercury set money:
 * $0.21 is "$0" and "21". Null when there is nothing to show.
 */
export function splitCents(
  amount: number | null,
  currency = "USD",
): { readonly whole: string; readonly cents: string } | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  const fixed = amount.toFixed(2);
  const [whole = "0", cents = "00"] = fixed.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return { whole: currency.toUpperCase() === "USD" ? `$${grouped}` : grouped, cents };
}

/**
 * A token count split for a numeral with a small unit, cut (not rounded) to one decimal so a
 * readout never claims more than happened and its parts add up: 6959 is "6.9" and "k" (4.8k in
 * plus 2.1k out), 950 is "950" and "".
 */
export function splitCount(count: number): { readonly value: string; readonly unit: string } {
  if (!Number.isFinite(count) || count < 0) return { value: "0", unit: "" };
  if (count < 1000) return { value: String(Math.round(count)), unit: "" };
  if (count < 1_000_000) return { value: (Math.floor(count / 100) / 10).toFixed(1), unit: "k" };
  return { value: (Math.floor(count / 100_000) / 10).toFixed(1), unit: "M" };
}

export type SquareTone = "add" | "del" | "rest";

/**
 * GitHub's diffstat squares: `count` squares split between additions and deletions by share,
 * the rest empty when the change is small. A side with any lines gets at least one square.
 */
export function diffSquares(added: number, removed: number, count = 5): SquareTone[] {
  const total = Math.max(0, added) + Math.max(0, removed);
  if (total === 0 || count <= 0) return Array.from({ length: Math.max(0, count) }, () => "rest");
  // Under ten lines, fewer squares fill: a two-line change should not look like a rewrite.
  const sides = (added > 0 ? 1 : 0) + (removed > 0 ? 1 : 0);
  const filled = Math.min(count, Math.max(sides, Math.ceil((Math.min(total, 10) / 10) * count)));
  let adds = Math.round((Math.max(0, added) / total) * filled);
  let dels = filled - adds;
  if (added > 0 && adds === 0) {
    adds = 1;
    dels = Math.max(0, filled - 1);
  }
  if (removed > 0 && dels === 0 && filled > 1) {
    dels = 1;
    adds = filled - 1;
  }
  return [
    ...Array.from({ length: adds }, (): SquareTone => "add"),
    ...Array.from({ length: dels }, (): SquareTone => "del"),
    ...Array.from({ length: count - adds - dels }, (): SquareTone => "rest"),
  ];
}

/**
 * Streaming markdown repair: a bold run or a code span that has opened but not closed yet renders
 * closed, so the words arrive styled instead of flashing raw asterisks; a marker that arrived with
 * nothing after it is dropped until its text does.
 */
export function closeOpenInline(text: string): string {
  let inCode = false;
  let bold = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "`") {
      inCode = !inCode;
      index += 1;
      continue;
    }
    if (!inCode && char === "*" && text[index + 1] === "*") {
      bold = !bold;
      index += 2;
      continue;
    }
    index += 1;
  }
  let repaired = text;
  if (inCode) {
    repaired = repaired.endsWith("`") ? repaired.slice(0, -1) : `${repaired}\``;
  }
  if (bold) {
    repaired = repaired.endsWith("**") ? repaired.slice(0, -2) : `${repaired}**`;
  }
  return repaired;
}

/**
 * A thought that opens with a bold line ("**Planning the ACP client**", as Codex writes them) has a
 * summary; the rest is the body. Other thoughts have none.
 */
export function thoughtSummary(text: string): {
  readonly summary: string | null;
  readonly body: string;
} {
  const none = { summary: null, body: text };
  const match = /^\*\*([^*\n]+)(\*\*)?/.exec(text);
  if (!match) return none;
  const title = (match[1] ?? "").trim();
  const after = text.slice(match[0].length);
  if (match[2] === "**") {
    // A title line ends at the line break; a bold run with words after it opens a sentence.
    return after === "" || after.startsWith("\n") ? { summary: title, body: after.trim() } : none;
  }
  // Still streaming its title, unless the line already broke without closing.
  return after === "" ? { summary: title, body: "" } : none;
}

/** "19 passed · 0 failed" from a test runner's summary (vitest, cargo, jest), or null. */
export function testSummary(
  output: string,
): { readonly passed: number; readonly failed: number } | null {
  const plain = stripAnsi(output);
  const vitest = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/.exec(plain);
  if (vitest) return { passed: Number(vitest[2]), failed: Number(vitest[1] ?? 0) };
  const cargo = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(plain);
  if (cargo) return { passed: Number(cargo[1]), failed: Number(cargo[2]) };
  const jest = /Tests:\s+(?:(\d+) failed, )?(\d+) passed/.exec(plain);
  if (jest) return { passed: Number(jest[2]), failed: Number(jest[1] ?? 0) };
  return null;
}

/** A code block's language as its header label: "ts" is TYPESCRIPT. */
export function languageLabel(lang: string): string {
  const key = lang.trim().toLowerCase();
  const names: Readonly<Record<string, string>> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    typescript: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    javascript: "JavaScript",
    rs: "Rust",
    rust: "Rust",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
    json: "JSON",
    css: "CSS",
    md: "Markdown",
    py: "Python",
    python: "Python",
    toml: "TOML",
  };
  return (Object.hasOwn(names, key) ? names[key] : key) ?? key;
}

/** The language of a file, from its name: "pacing.test.ts" is "ts". */
export function languageOfPath(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A command as its binary and the rest: "pnpm --filter x" is "pnpm" and "--filter x". */
export function commandParts(command: string): { readonly binary: string; readonly args: string } {
  const trimmed = command.trim();
  const space = trimmed.search(/\s/);
  if (space === -1) return { binary: trimmed, args: "" };
  return { binary: trimmed.slice(0, space), args: trimmed.slice(space + 1).trim() };
}

/** A long id with its middle left out: "019e…7f5f". */
export function middleEllipsis(id: string, head = 4, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Words with the whitespace after them, keyed by their offset in the block, for the fade-in. */
export function splitWords(
  text: string,
  base = 0,
): readonly { readonly text: string; readonly key: number }[] {
  const words: { text: string; key: number }[] = [];
  const pattern = /\s*\S+\s*|\s+/g;
  let match = pattern.exec(text);
  while (match) {
    words.push({ text: match[0], key: base + match.index });
    match = pattern.exec(text);
  }
  return words;
}

const VERBS: Readonly<
  Record<ToolKind, readonly [past: string, active: string, waiting: string, base: string]>
> = {
  read: ["Read", "Reading", "Waiting to read", "Read"],
  edit: ["Edited", "Editing", "Waiting to edit", "Edit"],
  delete: ["Deleted", "Deleting", "Waiting to delete", "Delete"],
  move: ["Moved", "Moving", "Waiting to move", "Move"],
  search: ["Searched", "Searching", "Waiting to search", "Search"],
  execute: ["Ran", "Running", "Waiting to run", "Run"],
  fetch: ["Fetched", "Fetching", "Waiting to fetch", "Fetch"],
  think: ["Thought", "Thinking", "Waiting", "Think"],
  switch_mode: ["Switched mode", "Switching mode", "Waiting", "Switch mode"],
  other: ["Used", "Using", "Waiting to use", "Use"],
};

/**
 * A call as Grok's label plus literal: the verb in sans, the object as a literal in mono, and a
 * result where the call has one. "Read" + "pacing.ts"; "Searched" + "performance.now" + "3 matches".
 */
export function toolParts(
  call: ToolCallModel,
  denied = false,
): {
  readonly verb: string;
  readonly object: string | null;
  readonly result: string | null;
} {
  const verbs = VERBS[call.kind] ?? VERBS.other;
  const running = call.status === "pending" || call.status === "in_progress";
  // A call turned down never happened: it keeps the plain verb ("Run cargo test"), struck through.
  const verb = denied
    ? verbs[3]
    : call.awaitingPermission
      ? verbs[2]
      : running
        ? verbs[1]
        : verbs[0];
  let object: string | null = call.target;
  if (object !== null && (call.kind === "read" || call.kind === "edit" || call.kind === "delete")) {
    object = basename(object);
  }
  if (call.kind === "other" || call.kind === "think" || call.kind === "switch_mode") {
    object = call.title.trim() || null;
  }
  let result: string | null = null;
  if (call.kind === "search" && call.search && !running) {
    const count = call.search.matches.length;
    result = count === 0 ? "no matches" : `${count} ${count === 1 ? "match" : "matches"}`;
  }
  if (!denied && call.kind === "execute" && call.terminal && call.terminal.exitCode !== null) {
    const tests = testSummary(call.terminal.output);
    result = tests
      ? `${tests.passed} passed${tests.failed > 0 ? ` · ${tests.failed} failed` : ""}`
      : `exit ${call.terminal.exitCode}`;
  }
  return { verb, object, result };
}

/** The Lucide icon name for a tool kind (section 4.4). */
export function toolIconName(kind: ToolKind, isNewFile = false): string {
  switch (kind) {
    case "read":
      return "file-text";
    case "edit":
      return isNewFile ? "file-plus" : "file-pen-line";
    case "delete":
      return "file-minus";
    case "search":
      return "search";
    case "execute":
      return "square-terminal";
    case "fetch":
      return "globe";
    default:
      return "wrench";
  }
}

/** A tool's duration: "0.4s" and "3.5s" under ten seconds, then whole seconds ("48s", "1m 05s"). */
export function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/**
 * The changed middle of a replaced line, for word highlights: what both lines share at the start
 * and the end stays plain, the rest takes the word tint. Null when the lines share nothing.
 */
export function changedMiddle(
  before: string,
  after: string,
): { readonly prefix: number; readonly suffix: number } | null {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix + suffix === 0) return null;
  return { prefix, suffix };
}

/** Context windows of the fixture's models, in tokens (the picker shows them, the meter divides by them). */
const CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 200_000,
  "gpt-5.5-codex": 400_000,
  "gpt-5.5": 400_000,
  "gpt-5.5-mini": 400_000,
  "gemini-3.5-pro": 1_000_000,
  "gemini-3.5-flash": 1_000_000,
  "hermes-4.5-405b": 128_000,
  "hermes-4.5-70b": 128_000,
};

/** A model's context window in tokens; 200k when the lab does not know the model. */
export function contextWindow(modelId: string | null): number {
  if (modelId === null || !Object.hasOwn(CONTEXT_WINDOWS, modelId)) return 200_000;
  return CONTEXT_WINDOWS[modelId] ?? 200_000;
}

/** A context window as the picker shows it: "1M", "400k", "128k". */
export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
}

/** What a turn answered: its messages, in order, as markdown. */
export function messageText(turn: Turn): string {
  return turn.items
    .flatMap((item) => (item.kind === "message" ? [item.text.trim()] : []))
    .filter((text) => text !== "")
    .join("\n\n");
}

/** One line of prose without its marks: inline code keeps its text, links keep their words. */
function plainLine(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}\s+/, "$1")
    .split(/(`[^`\n]+`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part.slice(1, -1)
        : part
            .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
            .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
            .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\w)/g, "$1$2"),
    )
    .join("");
}

/**
 * Markdown as the words a reader sees, for "Copy" (and "Copy as Markdown" keeps the source): no
 * emphasis marks, backticks, heading hashes or link targets. Fenced code keeps every line as it is,
 * without its fences; list markers stay, since they are part of how the text reads.
 */
export function plainText(markdown: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    lines.push(fenced ? line : plainLine(line));
  }
  return lines.join("\n");
}

/**
 * A turn as X Money's receipt, for "Copy receipt": who did it, how long it took, what it changed,
 * what it cost, and the checkpoint to go back to.
 */
export function receiptText(
  turn: Turn,
  context: { readonly agent: string; readonly title: string; readonly session: string | null },
): string {
  const footer = turn.footer;
  const lines = [context.title, context.agent];
  if (footer) {
    const files = footer.files.length;
    lines.push(
      `${footer.stopReason === "cancelled" ? "Stopped after" : "Done in"} ${formatElapsed(footer.durationMs)}`,
    );
    if (files > 0) {
      lines.push(
        `${files} ${files === 1 ? "file" : "files"} +${footer.added} \u2212${footer.removed}`,
      );
    }
    if (footer.usage) {
      lines.push(
        `${formatCount(footer.usage.input_tokens)} in \u00b7 ${formatCount(footer.usage.output_tokens)} out`,
      );
    }
    if (footer.cost?.amount != null) lines.push(`$${footer.cost.amount.toFixed(2)}`);
  }
  if (context.session) lines.push(`Checkpoint ${context.session.replace(/-/g, "").slice(0, 8)}`);
  return lines.join("\n");
}

/**
 * When a limit resets, as a time of day: "5:00 PM". Read in UTC, so a fixture's reset reads the
 * same on every machine and in every shot.
 */
export function resetTime(resetsAt: number): string {
  // Agents report seconds; anything this large is already milliseconds.
  const ms = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const date = new Date(ms);
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/**
 * The rule a standing permission saves for a command: its binary and subcommand, then anything.
 * "cargo test -p aura-drivers" saves "cargo test *"; "ls -la" saves "ls *".
 */
export function commandRule(command: string): string {
  const [binary = "", next] = command.trim().split(/\s+/);
  if (!binary) return "*";
  return next && !next.startsWith("-") ? `${binary} ${next} *` : `${binary} *`;
}
