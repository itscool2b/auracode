/**
 * Terminal output with ANSI escapes, read into styled spans per line so every direction colours a
 * test run the same way, each with its own palette.
 *
 * Covers what command output actually uses: SGR styling (bold, dim, italic, underline, inverse,
 * strikethrough, the 16 named colours, 256-colour and truecolour), carriage returns that redraw a
 * progress line, and escapes that only move the cursor or set a title, which are dropped.
 */

export type AnsiColorName =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

/** One of the 16 named terminal colours (map them to your palette) or an exact `#rrggbb`. */
export type AnsiColor = AnsiColorName | `#${string}`;

export interface AnsiStyle {
  readonly fg: AnsiColor | null;
  readonly bg: AnsiColor | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /** Swap fg and bg when rendering (vitest's " RUN " badge uses it through bg colours instead). */
  readonly inverse: boolean;
  readonly strikethrough: boolean;
}

export interface AnsiSpan extends AnsiStyle {
  readonly text: string;
}

/** One line of output: its spans in order. An empty line has no spans. */
export type AnsiLine = readonly AnsiSpan[];

export const ANSI_COLOR_NAMES: readonly AnsiColorName[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

const PLAIN: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strikethrough: false,
};

function hex(r: number, g: number, b: number): `#${string}` {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** xterm's 256-colour palette: 0-15 named, then a 6x6x6 cube, then 24 greys. */
export function color256(index: number): AnsiColor | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) return ANSI_COLOR_NAMES[index] ?? null;
  if (index < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const n = index - 16;
    return hex(
      levels[Math.floor(n / 36)] ?? 0,
      levels[Math.floor(n / 6) % 6] ?? 0,
      levels[n % 6] ?? 0,
    );
  }
  const grey = 8 + (index - 232) * 10;
  return hex(grey, grey, grey);
}

/** Applies one SGR sequence's parameters ("1;32", "38;5;208", "") to a style. */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(";").map((part) => Number(part || "0"));
  let next: AnsiStyle = style;
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0;
    if (code === 0) next = PLAIN;
    else if (code === 1) next = { ...next, bold: true };
    else if (code === 2) next = { ...next, dim: true };
    else if (code === 3) next = { ...next, italic: true };
    else if (code === 4) next = { ...next, underline: true };
    else if (code === 7) next = { ...next, inverse: true };
    else if (code === 9) next = { ...next, strikethrough: true };
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next = { ...next, italic: false };
    else if (code === 24) next = { ...next, underline: false };
    else if (code === 27) next = { ...next, inverse: false };
    else if (code === 29) next = { ...next, strikethrough: false };
    else if (code >= 30 && code <= 37) next = { ...next, fg: ANSI_COLOR_NAMES[code - 30] ?? null };
    else if (code === 39) next = { ...next, fg: null };
    else if (code >= 40 && code <= 47) next = { ...next, bg: ANSI_COLOR_NAMES[code - 40] ?? null };
    else if (code === 49) next = { ...next, bg: null };
    else if (code >= 90 && code <= 97) next = { ...next, fg: ANSI_COLOR_NAMES[code - 82] ?? null };
    else if (code >= 100 && code <= 107) {
      next = { ...next, bg: ANSI_COLOR_NAMES[code - 92] ?? null };
    } else if (code === 38 || code === 48) {
      // Extended colour: 5;n (256 colours) or 2;r;g;b (truecolour). Malformed ones are skipped.
      const mode = codes[i + 1];
      let color: AnsiColor | null = null;
      if (mode === 5) {
        color = color256(codes[i + 2] ?? -1);
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if (r !== undefined && g !== undefined && b !== undefined) color = hex(r, g, b);
        i += 4;
      }
      if (color !== null) next = code === 38 ? { ...next, fg: color } : { ...next, bg: color };
    }
  }
  return next;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.strikethrough === b.strikethrough
  );
}

// Escapes, longest forms first: CSI (ESC [ params intermediates final), OSC (ESC ] ... ended by BEL
// or ESC \, or by the end of the text), nF (ESC, intermediates, final: character set selection),
// any other two-character escape, and a lone ESC. Only CSI ending in "m" (SGR) changes anything.
const ESCAPE = new RegExp(
  [
    String.raw`\u001b\[([0-?]*)[ -/]*([@-~])`,
    String.raw`\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?`,
    String.raw`\u001b[ -/]+[0-~]`,
    String.raw`\u001b[0-~]`,
    String.raw`\u001b`,
  ].join("|"),
  "g",
);

/** Output split into lines of styled spans. Style carries across lines, as in a terminal. */
export function parseAnsi(input: string): AnsiLine[] {
  const lines: AnsiSpan[][] = [[]];
  let style: AnsiStyle = PLAIN;

  const write = (text: string): void => {
    // Lone carriage returns redraw the line: what follows the last one is what stays on screen.
    const segments = text.split(/\r?\n/);
    segments.forEach((segment, index) => {
      if (index > 0) lines.push([]);
      const parts = segment.split("\r");
      if (parts.length > 1) lines[lines.length - 1] = [];
      const visible = parts[parts.length - 1] ?? "";
      if (visible === "") return;
      const line = lines[lines.length - 1];
      if (!line) return;
      const last = line[line.length - 1];
      if (last && sameStyle(last, style))
        line[line.length - 1] = { ...last, text: last.text + visible };
      else line.push({ ...style, text: visible });
    });
  };

  let cursor = 0;
  for (const match of input.matchAll(ESCAPE)) {
    const index = match.index ?? 0;
    if (index > cursor) write(input.slice(cursor, index));
    const [, params, final] = match;
    if (final === "m" && params !== undefined) style = applySgr(style, params);
    cursor = index + match[0].length;
  }
  if (cursor < input.length) write(input.slice(cursor));

  // A trailing newline ends the last line rather than opening an empty one.
  if (lines.length > 1 && lines[lines.length - 1]?.length === 0 && /\n$/.test(input)) lines.pop();
  return lines;
}

/** The text a terminal would show, without escapes. */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((line) => line.map((span) => span.text).join(""))
    .join("\n");
}
