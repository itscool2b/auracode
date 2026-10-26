/**
 * A tiny line highlighter for the code Halo shows (TypeScript and Rust in the fixtures): comments,
 * strings, numbers, keywords, calls and type names. Line by line, so a diff or a streaming code
 * block highlights each line on its own; a line inside a block comment that starts with `*` reads
 * as a comment. Good enough to give code its rhythm; the real app gets a real highlighter.
 */

export type TokenKind = "keyword" | "string" | "number" | "comment" | "call" | "type" | "plain";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  // TypeScript and JavaScript
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
  "readonly",
  "return",
  "satisfies",
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
  // Rust
  "crate",
  "dyn",
  "fn",
  "impl",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "Self",
  "self",
  "struct",
  "trait",
  "unsafe",
  "use",
  "where",
  "Some",
  "None",
  "Ok",
  "Err",
]);

const TOKEN =
  /(\/\/.*$)|(\/\*.*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+|.)/g;

/** A whole line of a block comment, a doc comment, or a line comment. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*(\s|\/|$))/;

export function highlight(line: string): Token[] {
  if (COMMENT_LINE.test(line)) return [{ kind: "comment", text: line }];
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  for (const match of line.matchAll(TOKEN)) {
    const [text, lineComment, blockComment, string, number, word] = match;
    if (lineComment !== undefined || blockComment !== undefined) push("comment", text);
    else if (string !== undefined) push("string", text);
    else if (number !== undefined) push("number", text);
    else if (word !== undefined) {
      const rest = line.slice((match.index ?? 0) + text.length);
      if (KEYWORDS.has(word)) push("keyword", text);
      else if (/^!?\(/.test(rest) || /^::</.test(rest)) push("call", text);
      else if (/^[A-Z]/.test(word)) push("type", text);
      else push("plain", text);
    } else push("plain", text);
  }
  return tokens;
}
