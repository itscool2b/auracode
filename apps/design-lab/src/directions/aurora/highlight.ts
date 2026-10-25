/**
 * A tiny per-line syntax tinter for the code agents show most (TypeScript, Rust, shell), so code
 * blocks and diffs read like an editor without a highlighting dependency. It colours keywords,
 * strings, numbers, comments, calls and types; anything it does not know stays plain text. Lines are
 * tinted on their own, so a construct spanning lines (a block comment) only colours its own lines.
 */

export type TokenKind = "kw" | "str" | "num" | "com" | "fn" | "type" | "text";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const TS_KEYWORDS = [
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
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "super",
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
];

const RUST_KEYWORDS = [
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
];

const SHELL_KEYWORDS = ["if", "then", "else", "fi", "for", "do", "done", "export", "cd", "echo"];

type Language = "ts" | "rust" | "shell" | "plain";

const KEYWORDS: Readonly<Record<Language, ReadonlySet<string>>> = {
  ts: new Set(TS_KEYWORDS),
  rust: new Set(RUST_KEYWORDS),
  shell: new Set(SHELL_KEYWORDS),
  plain: new Set(),
};

/** The language for a fence info string or a file name. */
export function languageOf(hint: string): Language {
  const value = hint.trim().toLowerCase();
  const ext = value.includes(".") ? value.slice(value.lastIndexOf(".") + 1) : value;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "typescript", "javascript", "json"].includes(ext)) {
    return "ts";
  }
  if (["rs", "rust"].includes(ext)) return "rust";
  if (["sh", "bash", "zsh", "shell", "console"].includes(ext)) return "shell";
  return "plain";
}

const PATTERNS: Readonly<Record<Exclude<Language, "plain">, RegExp>> = {
  // comment | string | number | word | any other single character (so no character is ever lost)
  ts: /(\/\/.*$|\/\*.*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\d[\w.]*)|([A-Za-z_$][\w$]*)|([\s\S])/g,
  // Rust: char literals only as one character, so lifetimes ('a) stay plain.
  rust: /(\/\/.*$|\/\*.*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:\\.|[^'\\])')|(\d[\w.]*)|([A-Za-z_]\w*)|([\s\S])/g,
  shell: /(#.*$)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\d[\w.]*)|([A-Za-z_][\w.-]*)|([\s\S])/g,
};

/** Tokens of one line of code, adjacent ones of a kind merged. Joining them gives the line back. */
export function tokenizeLine(line: string, language: Language): Token[] {
  if (language === "plain" || line === "") return [{ kind: "text", text: line }];
  const pattern = new RegExp(PATTERNS[language].source, "g");
  const keywords = KEYWORDS[language];
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  let match: RegExpExecArray | null = pattern.exec(line);
  while (match !== null) {
    const [whole, comment, string, number, word] = match;
    if (comment !== undefined) push("com", whole);
    else if (string !== undefined) push("str", whole);
    else if (number !== undefined) push("num", whole);
    else if (word !== undefined) {
      const after = line.slice(match.index + whole.length);
      if (keywords.has(word)) push("kw", whole);
      else if (after.startsWith("(") || (language === "rust" && after.startsWith("!("))) {
        push("fn", whole);
      } else if (/^[A-Z]/.test(word) && language !== "shell") push("type", whole);
      else push("text", whole);
    } else push("text", whole);
    match = pattern.exec(line);
  }
  return tokens;
}
