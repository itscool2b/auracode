/**
 * Pure text helpers for Noir's transcript: repairing markdown that is still streaming, splitting
 * text into words that fade in once, and reading the title an agent puts at the top of a thought.
 * No React here, so every rule is covered by noir.test.ts.
 */

/**
 * Closes inline markers a streaming block has opened but not yet closed, so `**Jitter` renders
 * as bold "Jitter" straight away instead of flashing two asterisks that vanish a moment later.
 * A marker that arrived with nothing after it yet is dropped rather than closed. Only code spans
 * and strong emphasis are repaired: single `*` and `_` are too ambiguous (snake_case, globs).
 */
export function closeOpenInline(text: string): string {
  let out = text;
  const ticks = countOf(out, "`");
  if (ticks % 2 === 1) {
    out = out.endsWith("`") ? out.slice(0, -1) : `${out}\``;
  }
  // Strong markers count only outside code spans: inside one they are literal text.
  const outside = out.split("`").filter((_, index) => index % 2 === 0);
  const strong = outside.reduce((sum, part) => sum + countOf(part, "**"), 0);
  if (strong % 2 === 1) {
    if (out.endsWith("**")) return out.slice(0, -2);
    // A code span closed above sits inside the strong run, so the strong marker closes last.
    return `${out}**`;
  }
  return out;
}

function countOf(text: string, marker: string): number {
  let count = 0;
  let index = text.indexOf(marker);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(marker, index + marker.length);
  }
  return count;
}

/** One word and the whitespace after it, keyed by where it starts in the block's text. */
export interface Word {
  readonly key: number;
  readonly text: string;
}

/**
 * Splits text into words, each keeping the whitespace that follows it, keyed by offset. Keys are
 * stable while text only grows, so React keeps a word's element (and its finished fade) when the
 * next chunk arrives, and only the new words animate.
 */
export function splitWords(text: string, offset = 0): Word[] {
  const words: Word[] = [];
  const pattern = /\s*\S+\s*|\s+/g;
  for (const match of text.matchAll(pattern)) {
    words.push({ key: offset + (match.index ?? 0), text: match[0] });
  }
  return words;
}

export interface ThoughtParts {
  /** The agent's own title for the thought (Codex opens with a bold line), or null. */
  readonly title: string | null;
  /** The rest of the thought, without the title line. */
  readonly body: string;
}

/**
 * Splits a thought into the bold title some agents open with ("**Planning the ACP client**")
 * and the text after it. A title still streaming (no closing marker yet) is shown without its
 * asterisks.
 */
export function thoughtParts(text: string): ThoughtParts {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith("**")) return { title: null, body: text };
  const close = trimmed.indexOf("**", 2);
  const lineEnd = trimmed.indexOf("\n");
  if (close === -1) {
    const title = (lineEnd === -1 ? trimmed.slice(2) : trimmed.slice(2, lineEnd)).trim();
    return {
      title: title === "" ? null : title,
      body: lineEnd === -1 ? "" : trimmed.slice(lineEnd),
    };
  }
  // Only a bold run that is the whole first line counts as a title.
  if (lineEnd !== -1 && close > lineEnd) return { title: null, body: text };
  const rest = trimmed.slice(close + 2);
  if (rest.trim() !== "" && !rest.startsWith("\n")) return { title: null, body: text };
  const title = trimmed.slice(2, close).trim();
  return { title: title === "" ? null : title, body: rest.replace(/^\s+/, "") };
}

/** "packages/ui/src/orb/pacing.ts" as its folder (with a trailing slash) and its name. */
export function splitPath(path: string): { readonly dir: string; readonly name: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index === -1) return { dir: "", name: path };
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** The language a file's extension suggests, for highlighting: "ts", "rust", or "". */
export function languageOf(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match?.[1]?.toLowerCase() ?? "";
  if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) return "ts";
  if (ext === "rs") return "rust";
  if (["sh", "bash", "zsh"].includes(ext)) return "sh";
  return ext;
}
