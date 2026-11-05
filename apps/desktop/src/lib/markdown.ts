/**
 * A small streaming-friendly markdown reader for the M0 transcript.
 *
 * It parses into plain data (blocks and inline nodes) that React renders as elements, so agent text
 * can never inject HTML. Blocks are split first, on blank lines outside code fences, which is what
 * lets the transcript fade each block in once and leave finished blocks alone while the last one
 * grows. Covers what agents write: headings, paragraphs, fenced code, nested and task lists,
 * quotes, tables, rules, and inline code, bold, italics and web links. The real renderer
 * (Streamdown) replaces this in M2.
 */

export interface BlockSpan {
  /** Source offset of the block's first character. */
  readonly start: number;
  /** Source offset just past the block's last character (excluding the newline that ends it). */
  readonly end: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface FenceOpen {
  readonly marker: string;
  readonly info: string;
}

function fenceOpen(line: string): FenceOpen | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  const marker = match[1] ?? "";
  const info = (match[2] ?? "").trim();
  // A backtick fence's info string cannot contain backticks (that is inline code).
  if (marker.startsWith("`") && info.includes("`")) return null;
  return { marker, info };
}

function closesFence(line: string, open: FenceOpen): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= open.marker.length &&
    trimmed.startsWith(open.marker) &&
    [...trimmed].every((char) => char === open.marker[0])
  );
}

/**
 * Top-level blocks: runs of non-blank lines, except that a fenced code block is one block however
 * many blank lines it holds, and an unclosed fence runs to the end (it is still streaming).
 */
export function splitBlocks(source: string): BlockSpan[] {
  const spans: BlockSpan[] = [];
  let blockStart = -1;
  let fence: FenceOpen | null = null;
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    if (fence) {
      if (closesFence(line, fence)) {
        spans.push({ start: blockStart, end: lineEnd });
        blockStart = -1;
        fence = null;
      }
    } else {
      const open = fenceOpen(line);
      if (open) {
        if (blockStart !== -1) spans.push({ start: blockStart, end: lineStart - 1 });
        blockStart = lineStart;
        fence = open;
      } else if (line.trim() === "") {
        if (blockStart !== -1) spans.push({ start: blockStart, end: lineStart - 1 });
        blockStart = -1;
      } else if (blockStart === -1) {
        blockStart = lineStart;
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (blockStart !== -1) spans.push({ start: blockStart, end: source.length });
  return spans;
}

/**
 * Splits `source` incrementally: blocks before `stableEnd` (the end of the last block known to be
 * complete) are reused from `previous`, only the tail is split again. A block is complete once a
 * later block has started, since text only ever gets appended.
 */
export interface SplitCache {
  readonly source: string;
  /** Complete blocks, as source text. */
  readonly stable: readonly string[];
  /** Offset where the unsplit tail starts. */
  readonly stableEnd: number;
  /** The last block (still growing), or null when the source ends in blank lines. */
  readonly tail: string | null;
}

export const EMPTY_SPLIT: SplitCache = { source: "", stable: [], stableEnd: 0, tail: null };

export function splitIncremental(previous: SplitCache, source: string): SplitCache {
  // Only an append can reuse work; anything else (a new message) starts over.
  const base = source.startsWith(previous.source) ? previous : EMPTY_SPLIT;
  const spans = splitBlocks(source.slice(base.stableEnd));
  const stable = [...base.stable];
  let stableEnd = base.stableEnd;
  for (let index = 0; index < spans.length - 1; index += 1) {
    const span = spans[index];
    if (!span) continue;
    stable.push(source.slice(base.stableEnd + span.start, base.stableEnd + span.end));
    const next = spans[index + 1];
    stableEnd = base.stableEnd + (next ? next.start : span.end);
  }
  const last = spans[spans.length - 1];
  const tail = last ? source.slice(base.stableEnd + last.start, base.stableEnd + last.end) : null;
  return { source, stable, stableEnd, tail };
}

/** Every block of a split, finished ones first. */
export function blocksOf(split: SplitCache): string[] {
  return split.tail === null ? [...split.stable] : [...split.stable, split.tail];
}

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  readonly text: string;
  /** Nesting level, 0 for top-level items. */
  readonly depth: number;
  /** Task list state, or null for a plain item. */
  readonly checked: boolean | null;
}

export type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | {
      readonly kind: "code";
      readonly lang: string;
      readonly code: string;
      /** False while the closing fence has not arrived. */
      readonly closed: boolean;
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly ListItem[];
    }
  | { readonly kind: "quote"; readonly text: string }
  | {
      readonly kind: "table";
      readonly header: readonly string[];
      readonly align: readonly Align[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly kind: "rule" }
  /** Display math: a paragraph that is only `$$…$$` or `\[…\]`, in TeX. */
  | { readonly kind: "math"; readonly tex: string };

/** A paragraph that is only display math, as `$$…$$` or `\[…\]`: its TeX, or `null`. */
function displayMath(text: string): string | null {
  const match = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(text) ?? /^\s*\\\[([\s\S]+?)\\\]\s*$/.exec(text);
  const tex = match?.[1]?.trim();
  return tex ? tex : null;
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^([ \t]*)([-*+]|(\d{1,9})[.)])(?:[ \t]+(.*))?$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function indentWidth(indent: string): number {
  let width = 0;
  for (const char of indent) width += char === "\t" ? 4 : 1;
  return width;
}

function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cellAlign(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Parses one block (as split by `splitBlocks`) into one or more blocks. */
export function parseBlock(source: string): Block[] {
  const lines = source.split("\n");
  const first = lines[0] ?? "";
  const fence = fenceOpen(first);
  if (fence) {
    const last = lines.length > 1 ? (lines[lines.length - 1] ?? "") : null;
    const closed = last !== null && closesFence(last, fence);
    const body = lines.slice(1, closed ? -1 : undefined);
    return [
      {
        kind: "code",
        lang: fence.info.split(/\s+/)[0] ?? "",
        code: body.join("\n"),
        closed,
      },
    ];
  }

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      const text = paragraph.join("\n");
      const tex = displayMath(text);
      blocks.push(tex === null ? { kind: "paragraph", text } : { kind: "math", tex });
      paragraph = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        text: (heading[2] ?? "").trim(),
      });
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    const next = lines[index + 1];
    if (line.includes("|") && next !== undefined && TABLE_DELIMITER.test(next)) {
      flushParagraph();
      const header = tableCells(line);
      const align = tableCells(next).map(cellAlign);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        const cells = tableCells(lines[index] ?? "");
        rows.push(header.map((_, column) => cells[column] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", header, align: header.map((_, i) => align[i] ?? null), rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? "");
        if (!match) break;
        quoted.push(match[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join("\n") });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = item[3] !== undefined;
      const start = ordered ? Number(item[3]) : 1;
      const items: ListItem[] = [];
      const baseIndent = indentWidth(item[1] ?? "");
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = LIST_ITEM.exec(current);
        if (match) {
          const depth = Math.max(0, Math.floor((indentWidth(match[1] ?? "") - baseIndent) / 2));
          const body = match[4] ?? "";
          const task = TASK.exec(body);
          items.push({
            text: task ? (task[2] ?? "") : body,
            depth,
            checked: task ? task[1] !== " " : null,
          });
        } else if (/^[ \t]+\S/.test(current) && items.length > 0) {
          // A lazy continuation line belongs to the previous item.
          const previous = items.pop();
          if (previous) items.push({ ...previous, text: `${previous.text} ${current.trim()}` });
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

import { localImagePath } from "./chatImages";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "image"; readonly path: string; readonly alt: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly Inline[] }
  /** Inline math, `$…$` or `\(…\)`, in TeX. */
  | { readonly kind: "math"; readonly tex: string };

/** Nesting deeper than this is shown as plain text: bounded recursion whatever the input. */
const MAX_INLINE_DEPTH = 8;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** Only web links become links; anything else (javascript:, file:, data:) stays text. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Where inline math `$…$` that opens at `index` closes, by Pandoc's rule: the opening `$` has a
 * character other than a space right after it, the closing one has one right before it and no
 * digit right after it, and both are on one line. So "$5 and $10" stays text. `-1`: no math.
 */
function dollarClose(text: string, index: number): number {
  const after = text[index + 1];
  if (after === undefined || after === "$" || /\s/.test(after)) return -1;
  for (let close = index + 1; close < text.length; close++) {
    const char = text[close];
    if (char === "\n") return -1;
    if (char !== "$" || text[close - 1] === "\\") continue;
    if (/\s/.test(text[close - 1] ?? " ") || /\d/.test(text[close + 1] ?? "")) continue;
    return close;
  }
  return -1;
}

/** Inline markdown: `code`, **strong**, *em* / _em_, [text](https://...), $math$. */
export function parseInline(text: string, depth = 0): Inline[] {
  const nodes: Inline[] = [];
  let plain = "";
  const pushPlain = (): void => {
    if (plain !== "") {
      nodes.push({ kind: "text", text: plain });
      plain = "";
    }
  };
  if (depth >= MAX_INLINE_DEPTH) return [{ kind: "text", text }];

  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";

    if (char === "`") {
      let ticks = 1;
      while (text[index + ticks] === "`") ticks += 1;
      const marker = "`".repeat(ticks);
      const close = text.indexOf(marker, index + ticks);
      if (close !== -1) {
        pushPlain();
        nodes.push({ kind: "code", text: text.slice(index + ticks, close).trim() || " " });
        index = close + ticks;
        continue;
      }
      plain += marker;
      index += ticks;
      continue;
    }

    // An escaped dollar is a dollar, never math.
    if (char === "\\" && text[index + 1] === "$") {
      plain += "$";
      index += 2;
      continue;
    }

    if (char === "\\" && text[index + 1] === "(") {
      const close = text.indexOf("\\)", index + 2);
      const tex = close === -1 ? "" : text.slice(index + 2, close).trim();
      if (tex && !tex.includes("\n")) {
        pushPlain();
        nodes.push({ kind: "math", tex });
        index = close + 2;
        continue;
      }
    }

    if (char === "$") {
      const close = dollarClose(text, index);
      if (close !== -1) {
        pushPlain();
        nodes.push({ kind: "math", tex: text.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    if ((char === "*" || char === "_") && text[index + 1] === char) {
      const marker = char + char;
      const close = text.indexOf(marker, index + 2);
      if (close > index + 2) {
        pushPlain();
        nodes.push({
          kind: "strong",
          children: parseInline(text.slice(index + 2, close), depth + 1),
        });
        index = close + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      // `_` only delimits at word boundaries, so snake_case stays text.
      const opens = char === "*" || !isWordChar(text[index - 1]);
      const after = text[index + 1];
      if (opens && after !== undefined && after !== " " && after !== char) {
        let close = text.indexOf(char, index + 1);
        while (close !== -1 && char === "_" && isWordChar(text[close + 1])) {
          close = text.indexOf(char, close + 1);
        }
        if (close > index + 1 && text[close - 1] !== " ") {
          pushPlain();
          nodes.push({
            kind: "em",
            children: parseInline(text.slice(index + 1, close), depth + 1),
          });
          index = close + 1;
          continue;
        }
      }
    }

    if (char === "!" && text[index + 1] === "[") {
      const closeBracket = text.indexOf("](", index + 2);
      const start = closeBracket + 2;
      const closeParen =
        closeBracket === -1 ? -1 : text.indexOf(text[start] === "<" ? ">)" : ")", start);
      if (closeBracket !== -1 && closeParen !== -1) {
        const angle = text[start] === "<";
        const path = localImagePath(text.slice(start, closeParen + (angle ? 1 : 0)));
        const alt = text.slice(index + 2, closeBracket);
        if (path && !alt.includes("]")) {
          pushPlain();
          nodes.push({ kind: "image", path, alt });
          index = closeParen + (angle ? 2 : 1);
          continue;
        }
      }
    }

    if (char === "[" && text[index - 1] !== "!") {
      const closeBracket = text.indexOf("](", index + 1);
      const closeParen = closeBracket === -1 ? -1 : text.indexOf(")", closeBracket + 2);
      if (closeBracket !== -1 && closeParen !== -1) {
        const label = text.slice(index + 1, closeBracket);
        const href = safeHref(text.slice(closeBracket + 2, closeParen));
        if (href !== null && !label.includes("]")) {
          pushPlain();
          nodes.push({ kind: "link", href, children: parseInline(label, depth + 1) });
          index = closeParen + 1;
          continue;
        }
      }
    }

    plain += char;
    index += 1;
  }
  pushPlain();
  return nodes;
}

/** The text a reader sees, without markdown syntax (for measuring what was rendered). */
export function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code"
        ? node.text
        : node.kind === "image"
          ? node.alt
          : node.kind === "math"
            ? node.tex
            : plainText(node.children),
    )
    .join("");
}
