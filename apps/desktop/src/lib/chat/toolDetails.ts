import type { Value } from "../../bindings";
import { diffLines } from "../diff";
import { safeHref } from "../markdown";
import type { ToolItem } from "./transcript";

/**
 * What a tool call shows besides its output (owner's plan, 4 November 2026, missing features A):
 * its input, the links a web search found, and the lines an edit changed.
 */

/** One input the call was given: its name and value, as text. */
export interface InputField {
  readonly key: string;
  readonly value: string;
  /** Set on its own lines (code, JSON, long or multi-line text) rather than beside its name. */
  readonly block: boolean;
}

const MAX_FIELDS = 20;
const MAX_VALUE_CHARS = 2000;
/** An edit's texts, which its diff shows. */
const IN_THE_DIFF = new Set([
  "old_string",
  "new_string",
  "old_text",
  "new_text",
  "content",
  "edits",
]);

/**
 * The call's input worth showing: everything it was given, except what the call already shows
 * (an edit's texts in its diff; Claude's to-do list in the turn's plan), and nothing when the
 * title already says the one thing it was given.
 */
export function toolInput(tool: ToolItem): InputField[] {
  const input = tool.rawInput;
  if (tool.toolName === "TodoWrite" || input === null || typeof input !== "object") return [];
  if (Array.isArray(input)) return [];
  const diffs = tool.content.some((content) => content.type === "diff");
  // A path the call names in its locations line shows there already.
  const located = new Set(tool.locations.map((location) => location.path));
  const fields: InputField[] = [];
  for (const [key, value] of Object.entries(input as Record<string, Value>)) {
    if (fields.length >= MAX_FIELDS) break;
    if (value === null || value === "" || (diffs && IN_THE_DIFF.has(key))) continue;
    if (typeof value === "string" && located.has(value)) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const clipped = text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
    fields.push({
      key,
      value: clipped,
      block: typeof value === "object" || clipped.includes("\n") || clipped.length > 80,
    });
  }
  // One input the title already says (a path, a query) adds nothing.
  const only = fields.length === 1 ? fields[0] : undefined;
  if (only && !only.block && tool.title.includes(only.value)) return [];
  return fields;
}

/**
 * A JSON text set out over lines with two-space indents (an MCP server's reply, mostly), or
 * `null` when it is not JSON, already set out that way, or too large to reformat.
 */
export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 200_000) return null;
  const pair = `${trimmed[0]}${trimmed[trimmed.length - 1]}`;
  if (pair !== "{}" && pair !== "[]") return null;
  try {
    const pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
    return pretty === trimmed ? null : pretty;
  } catch {
    return null;
  }
}

/** The JSON array starting at `start` in `text`, read to its matching bracket. */
function arrayAt(text: string, start: number): string | null {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export interface SearchLink {
  readonly title: string;
  readonly url: string;
  readonly host: string;
}

/**
 * The pages a web search found, from Claude Code's WebSearch result, which lists them after
 * `Links:` as JSON: `Links: [{"title":"…","url":"https://…"}, …]`. Only http and https.
 */
export function searchLinks(tool: ToolItem): SearchLink[] {
  if (tool.toolName !== "WebSearch") return [];
  const text = tool.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("\n");
  const links: SearchLink[] = [];
  let from = 0;
  for (;;) {
    const label = text.indexOf("Links:", from);
    if (label < 0) break;
    const open = text.indexOf("[", label);
    from = label + 6;
    if (open < 0) break;
    const json = arrayAt(text, open);
    if (json === null) break;
    try {
      const entries: unknown = JSON.parse(json);
      for (const entry of Array.isArray(entries) ? entries : []) {
        const url = typeof entry?.url === "string" ? safeHref(entry.url) : null;
        if (!url || links.some((link) => link.url === url)) continue;
        const title = typeof entry.title === "string" && entry.title.trim() ? entry.title : url;
        links.push({ title: title.trim(), url, host: new URL(url).hostname.replace(/^www\./, "") });
      }
    } catch {
      // Not the list Claude Code writes; the text below still shows.
    }
  }
  return links.slice(0, 20);
}

/** A WebSearch result's text without its `Links:` JSON, which shows as links above it. */
export function withoutSearchLinks(text: string): string {
  let out = text;
  for (;;) {
    const label = out.indexOf("Links:");
    if (label < 0) return out;
    const open = out.indexOf("[", label);
    const json = open < 0 ? null : arrayAt(out, open);
    if (json === null) return out;
    out = `${out.slice(0, label).trimEnd()}\n\n${out.slice(open + json.length).trimStart()}`.trim();
  }
}

/** The lines the call's edits added and removed, or `null` when it has no diff to count. */
export function diffDelta(tool: ToolItem): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let counted = false;
  for (const content of tool.content) {
    if (content.type !== "diff") continue;
    // A diff too large for the event keeps empty texts until it is loaded: nothing to count.
    if (content.truncated !== null && content.new_text === "" && !content.old_text) continue;
    const diff = diffLines(content.old_text, content.new_text);
    if (diff.truncated) return null;
    added += diff.added;
    removed += diff.removed;
    counted = true;
  }
  return counted ? { added, removed } : null;
}
