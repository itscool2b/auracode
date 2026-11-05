import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Syntax colours for code in answers (owner's plan, 4 November 2026, missing features A): the
 * languages agents write most, by the names fences use for them. The colours are the theme's code
 * tokens (chat.css, `.hljs-*`), so every theme and appearance has its own.
 */
const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  makefile,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
} as const;
type Language = keyof typeof LANGUAGES;

for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** The names fences give these languages. */
const ALIASES: Readonly<Record<string, Language>> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "c",
  cs: "csharp",
  "c#": "csharp",
  patch: "diff",
  docker: "dockerfile",
  golang: "go",
  gql: "graphql",
  toml: "ini",
  cfg: "ini",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsonc: "json",
  json5: "json",
  kt: "kotlin",
  kts: "kotlin",
  make: "makefile",
  md: "markdown",
  ps1: "powershell",
  pwsh: "powershell",
  ps: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "xml",
  svg: "xml",
  vue: "xml",
  yml: "yaml",
};

/** Longer code shows plain: colouring it would cost more than it gives. */
const MAX_CHARS = 100_000;

/** The highlight.js language for a fence's name, or `null` when there is none for it. */
export function languageOf(fence: string): Language | null {
  const name = fence.trim().toLowerCase();
  if (name in LANGUAGES) return name as Language;
  return ALIASES[name] ?? null;
}

/**
 * `code` coloured as HTML (highlight.js escapes the text itself), or `null` for a language it
 * does not know, an empty block or one too long to colour.
 */
export function highlightCode(code: string, fence: string): string | null {
  const language = languageOf(fence);
  if (language === null || code === "" || code.length > MAX_CHARS) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
