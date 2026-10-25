/*
 * A small line tokenizer for the code palette (visual-language.md 3.1): enough for the TypeScript
 * and Rust the fixtures edit. The palette is x.ai's near-monochrome code window: keywords red,
 * strings blue, numbers and attributes orange, comments and punctuation dim (never italic); calls,
 * types and names stay in the foreground, so their kinds exist only for tests and future themes.
 * Each line stands alone, with one exception: a line inside a block comment (its opening, its
 * starred lines, its close) is read as comment, which covers doc comments in diffs.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "call"
  | "type"
  | "punct"
  | "attr";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  ts: new Set([
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
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
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
  ]),
  rust: new Set([
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
  ]),
};

/** The tokenizer's dialect for a fence or a file extension. */
export function dialectOf(lang: string): "ts" | "rust" | "plain" {
  const key = lang.trim().toLowerCase();
  if (["ts", "tsx", "typescript", "js", "jsx", "javascript", "mjs"].includes(key)) return "ts";
  if (["rs", "rust"].includes(key)) return "rust";
  return "plain";
}

const BLOCK_COMMENT_LINE = /^\s*(\/\*\*?|\*\/|\*(\s|$))/;

/** One line as tokens. Joining the tokens' text gives the line back. */
export function tokenizeLine(line: string, lang: string): Token[] {
  const dialect = dialectOf(lang);
  if (dialect === "plain") return line === "" ? [] : [{ kind: "plain", text: line }];
  if (BLOCK_COMMENT_LINE.test(line)) return [{ kind: "comment", text: line }];
  const keywords = KEYWORDS[dialect] ?? new Set<string>();
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    if (text === "") return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    const comment = /^\/\/.*/.exec(rest);
    if (comment) {
      push("comment", comment[0]);
      break;
    }
    const string = /^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\x60(?:[^\x60\\]|\\.)*\x60?)/.exec(
      rest,
    );
    if (string && (dialect === "ts" || string[0].startsWith('"'))) {
      push("string", string[0]);
      index += string[0].length;
      continue;
    }
    const number = /^\b\d[\d_]*(\.\d+)?(e[+-]?\d+)?\b/i.exec(rest);
    if (number) {
      push("number", number[0]);
      index += number[0].length;
      continue;
    }
    const attribute = dialect === "rust" ? /^#!?\[[^\]]*\]/.exec(rest) : null;
    if (attribute) {
      push("attr", attribute[0]);
      index += attribute[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*!?/.exec(rest);
    if (word) {
      const text = word[0];
      const after = line.slice(index + text.length);
      if (keywords.has(text)) push("keyword", text);
      else if (text.endsWith("!") || /^\s*\(/.test(after)) push("call", text);
      else if (/^[A-Z]/.test(text)) push("type", text);
      else push("plain", text);
      index += text.length;
      continue;
    }
    const punct = /^[{}()[\];,.:<>=+\-*/%!&|?^~@#]+/.exec(rest);
    if (punct) {
      push("punct", punct[0]);
      index += punct[0].length;
      continue;
    }
    push("plain", line[index] ?? "");
    index += 1;
  }
  return tokens;
}
