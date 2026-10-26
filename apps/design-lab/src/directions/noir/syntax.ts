/**
 * Monochrome syntax: Noir highlights code by weight and brightness, not hue. Keywords and calls
 * read brightest, identifiers sit in the body tone, punctuation and comments recede. One line at
 * a time (diffs and streaming code blocks are line-based), with no state between lines.
 */

export type TokenKind =
  | "keyword"
  | "call"
  | "type"
  | "string"
  | "number"
  | "comment"
  | "punct"
  | "plain";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const TS_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "private",
  "public",
  "readonly",
  "return",
  "static",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "yield",
]);

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

const SH_KEYWORDS = new Set(["if", "then", "else", "fi", "for", "do", "done", "export", "cd"]);

function keywordsFor(lang: string): ReadonlySet<string> {
  if (lang === "rust" || lang === "rs") return RUST_KEYWORDS;
  if (lang === "sh" || lang === "bash" || lang === "zsh" || lang === "shell") return SH_KEYWORDS;
  return TS_KEYWORDS;
}

/*
 * Alternatives in priority order: comments before punctuation (so `//` is a comment), and in
 * Rust, lifetimes (`'a`) before strings, since elsewhere a quote always opens a string.
 */
function pattern(withLifetimes: boolean): RegExp {
  return new RegExp(
    [
      String.raw`(?<comment>\/\/.*|\/\*.*?(?:\*\/|$))`,
      withLifetimes ? String.raw`(?<lifetime>'[A-Za-z_]\w*(?![\w']))` : null,
      String.raw`(?<string>"(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)|\x60(?:[^\x60\\]|\\.)*(?:\x60|$))`,
      String.raw`(?<number>\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)(?:[a-z]\w*)?\b)`,
      String.raw`(?<word>[A-Za-z_$][\w$]*!?)`,
      String.raw`(?<space>\s+)`,
      String.raw`(?<punct>[^\sA-Za-z0-9_$"'\x60])`,
    ]
      .filter((part) => part !== null)
      .join("|"),
    "y",
  );
}

const CODE_PATTERN = pattern(false);
const RUST_PATTERN = pattern(true);
const SHELL_LANGS = new Set(["sh", "bash", "zsh", "shell", "toml", "yaml", "yml"]);

/** Tokens of one line of code. Unknown languages get the TypeScript keyword set. */
export function tokenizeLine(line: string, lang: string): Token[] {
  const keywords = keywordsFor(lang);
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  const pushWord = (word: string, rest: string): void => {
    if (keywords.has(word)) push("keyword", word);
    else if (word.endsWith("!") || /^\s*\(/.test(rest)) push("call", word);
    else if (/^[A-Z]/.test(word)) push("type", word);
    else push("plain", word);
  };
  // `#` opens a comment only in shell-like languages (in Rust it starts an attribute).
  if (SHELL_LANGS.has(lang) && line.trimStart().startsWith("#")) {
    return [{ kind: "comment", text: line }];
  }
  const regex = lang === "rust" || lang === "rs" ? RUST_PATTERN : CODE_PATTERN;
  let index = 0;
  while (index < line.length) {
    regex.lastIndex = index;
    const match = regex.exec(line);
    if (!match || match[0] === "") {
      push("plain", line.slice(index, index + 1));
      index += 1;
      continue;
    }
    const groups = match.groups ?? {};
    const text = match[0];
    if (groups.comment !== undefined) {
      push("comment", text);
    } else if (groups.lifetime !== undefined) {
      push("keyword", text);
    } else if (groups.string !== undefined) {
      push("string", text);
    } else if (groups.number !== undefined) {
      push("number", text);
    } else if (groups.word !== undefined) {
      // `name!` is a macro call in Rust; elsewhere the `!` is an operator of its own.
      if (text.endsWith("!") && regex !== RUST_PATTERN) {
        pushWord(text.slice(0, -1), line.slice(index + text.length - 1));
        push("punct", "!");
      } else {
        pushWord(text, line.slice(index + text.length));
      }
    } else if (groups.space !== undefined) {
      push("plain", text);
    } else {
      push("punct", text);
    }
    index += text.length;
  }
  return tokens;
}
