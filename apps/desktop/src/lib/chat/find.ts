/**
 * Find in chat: where a query occurs in the words a chat shows (the person's messages and the
 * agent's answers), so the find bar can count the matches and step through them. Tool calls,
 * cards and notices are not searched. Rows a long chat has not rendered are searched in their
 * text; the rendered ones are highlighted in place (see `highlightRanges`).
 */
import type { RenderedSegment } from "./transcript";
import { workFold } from "./workFold";

export interface FindMatch {
  /** The transcript row the match is in, keyed as the transcript keys rows. */
  readonly rowKey: string;
  readonly segmentKey: string;
  /** Which occurrence in its row's text, from 0. */
  readonly occurrence: number;
  /** In a finished turn's folded work: showing the match opens the fold. */
  readonly folded: boolean;
}

/** Whitespace in any amount compares as one space, as the screen shows it. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * A message's words without the Markdown marks the screen does not show: fence lines, link and
 * image targets, inline code ticks, bold and strikethrough marks. Near enough to count matches;
 * the rendered text decides what is highlighted.
 */
export function shownText(markdown: string): string {
  return markdown
    .replace(/^ {0,3}(```|~~~)[^\n]*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/^ {0,3}(#{1,6} +|> ?)/gm, "")
    .replace(/\*\*|__|~~|`/g, "");
}

function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
    count += 1;
  return count;
}

/** Every occurrence of `query` in the chat's messages and answers, in reading order. */
export function findMatches(segments: readonly RenderedSegment[], query: string): FindMatch[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const segment of segments) {
    const fold = workFold(segment);
    segment.items.forEach((item, index) => {
      if (item.kind !== "user" && item.kind !== "message") return;
      const text = normalize(item.kind === "user" ? item.text : shownText(item.text));
      const count = occurrences(text, needle);
      for (let occurrence = 0; occurrence < count; occurrence++)
        matches.push({
          rowKey: JSON.stringify([segment.key, item.key]),
          segmentKey: segment.key,
          occurrence,
          folded: fold !== null && index >= fold.from && index < fold.to,
        });
    });
  }
  return matches;
}

/** Text the reader does not see as the answer's words: labels, copy buttons, MathML copies. */
const HIDDEN = ".code-header, .sr-only, button, .katex-mathml, svg, [aria-hidden='true']";

/**
 * Ranges over each occurrence of `query` in an element's visible text. Text nodes are read in
 * order and whitespace runs compare as one space, so a match may span nodes (a word in bold).
 */
export function highlightRanges(root: Element, query: string): Range[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(HIDDEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  // The visible text, whitespace runs folded, with each kept character's node and offset.
  let text = "";
  const places: { node: Text; offset: number }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    for (let offset = 0; offset < value.length; offset++) {
      const character = value[offset] ?? "";
      // A lowercase form can be longer ("İ"); each of its units points at the same character.
      const kept = /\s/.test(character)
        ? text.endsWith(" ") || text === ""
          ? ""
          : " "
        : character.toLocaleLowerCase();
      text += kept;
      for (let unit = 0; unit < kept.length; unit++) places.push({ node: node as Text, offset });
    }
  }
  const ranges: Range[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    const start = places[at];
    const end = places[at + needle.length - 1];
    if (!start || !end) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    ranges.push(range);
  }
  return ranges;
}
