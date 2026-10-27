/**
 * Keeps the desktop app's stylesheets on Graphite (docs/design/visual-language.md, section 3).
 * Every colour, space, radius, type size, line height, weight and duration in
 * apps/desktop/src/**\/*.css must come from a --g-* token. It fails on:
 *
 * - raw hex colours, including %23-encoded ones inside data URLs;
 * - px, rem or em lengths in margin, padding and gap (use --g-space-*; 0 and 1px hairlines pass);
 * - px, rem or em lengths in border radii (use --g-radius-*);
 * - font sizes and line heights that are not tokens (inherit and normal pass);
 * - font weights other than 400, 500 and 600 (Graphite's integer weights);
 * - transition and animation times that are not --g-dur-* tokens (0ms and 0s pass).
 *
 * Custom property definitions are not checked: a value given a name is a token by definition. The
 * allowlist below holds the few justified exceptions, each with its reason.
 *
 * Usage: node .github/scripts/check-styles.mjs [repository root]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Justified exceptions: the file, a fragment of the declaration, and why it stays. */
export const ALLOWLIST = [
  {
    file: "shell.css",
    fragment: "stroke='%23000'",
    reason: "The checkbox's check is an SVG data URL, which cannot read a custom property.",
  },
  {
    file: "components/TerminalSheet.css",
    fragment: "fill='%23ededed'",
    reason:
      "The passed status's pixel check is an SVG data URL, which cannot read a custom property.",
  },
  {
    file: "components/setup/setup.css",
    fragment: "0.01ms !important",
    reason: "The app's reduced-motion switch ends every animation at once and still fires its end.",
  },
];

const SPACING = /^(?:margin|padding)(?:-[a-z-]+)?$|^(?:row-|column-)?gap$/;
const RADIUS = /^border(?:-[a-z]+)*-radius$/;
const LENGTH = /(?<![\w-])(-?\d*\.?\d+)(px|rem|em)\b/g;
const HEX = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,8}\b/;
const TIME = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/g;
const WEIGHTS = new Set(["400", "500", "600", "inherit"]);

/** Comments become spaces, so offsets and line numbers stay true. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Removes var(...) references (with nesting), so token names never read as values. */
function withoutVars(value) {
  let out = value;
  for (;;) {
    const next = out.replace(/var\([^()]*\)/g, "");
    if (next === out) return out;
    out = next;
  }
}

function problemsIn(property, value) {
  const problems = [];
  const bare = withoutVars(value);
  if (HEX.test(value)) problems.push("raw hex colour; use a --g-* colour token");
  if (SPACING.test(property)) {
    for (const [, number, unit] of bare.matchAll(LENGTH)) {
      if (Number(number) === 0 || (unit === "px" && Math.abs(Number(number)) === 1)) continue;
      problems.push(`${number}${unit} in ${property}; use a --g-space-* token`);
    }
  }
  if (RADIUS.test(property)) {
    for (const [, number, unit] of bare.matchAll(LENGTH)) {
      if (Number(number) === 0) continue;
      problems.push(`${number}${unit} radius; use a --g-radius-* token`);
    }
  }
  if (property === "font-size" && !/^(?:inherit|var\(--g-[\w-]+\))$/.test(value.trim())) {
    problems.push(`font-size ${value.trim()}; use a --g-text-* token`);
  }
  if (property === "line-height" && !/^(?:inherit|normal|var\(--g-[\w-]+\))$/.test(value.trim())) {
    problems.push(`line-height ${value.trim()}; use a --g-leading-* token`);
  }
  if (property === "font-weight") {
    const weight = value.trim();
    if (!WEIGHTS.has(weight) && !/^var\(--g-weight-[\w-]+\)$/.test(weight)) {
      problems.push(`font-weight ${weight}; Graphite uses 400, 500 and 600 only`);
    }
  }
  if (/^(?:transition|animation)(?:-duration|-delay)?$/.test(property)) {
    for (const [, number] of bare.matchAll(TIME)) {
      if (Number(number) === 0) continue;
      problems.push(`${number} in ${property}; use a --g-dur-* token`);
    }
  }
  return problems;
}

/**
 * The problems in one stylesheet. `file` is its path relative to apps/desktop/src, with forward
 * slashes, as the allowlist names it.
 */
export function lintStylesheet(css, file, allowlist = ALLOWLIST) {
  const text = stripComments(css);
  const found = [];
  for (const match of text.matchAll(
    /(?<=[{;]\s*)(-{0,2}[a-zA-Z][\w-]*)\s*:\s*([^;{}]+)(?=[;}])/g,
  )) {
    const [declaration, property, value] = match;
    if (property.startsWith("--")) continue;
    const allowed = allowlist.some(
      (entry) => entry.file === file && declaration.includes(entry.fragment),
    );
    if (allowed) continue;
    const line = text.slice(0, match.index).split("\n").length;
    for (const problem of problemsIn(property.toLowerCase(), value)) {
      found.push({ file, line, declaration: declaration.replace(/\s+/g, " ").trim(), problem });
    }
  }
  return found;
}

function stylesheets(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...stylesheets(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out.sort();
}

/** Lints every stylesheet under <root>/apps/desktop/src and returns the problems. */
export function lintDesktop(root) {
  const source = resolve(root, "apps/desktop/src");
  return stylesheets(source).flatMap((path) =>
    lintStylesheet(readFileSync(path, "utf8"), relative(source, path).split(sep).join("/")),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? process.cwd());
  try {
    const problems = lintDesktop(root);
    if (problems.length === 0) {
      console.log("Desktop stylesheets use Graphite tokens only.");
    } else {
      for (const { file, line, declaration, problem } of problems) {
        console.error(`apps/desktop/src/${file}:${line}: ${problem}\n    ${declaration}`);
      }
      console.error(
        `${problems.length} declaration(s) leave Graphite's scales. Use the --g-* tokens (docs/design/visual-language.md, section 3), or add a justified entry to ALLOWLIST in .github/scripts/check-styles.mjs.`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Could not check the desktop stylesheets: ${error.message}`);
    process.exitCode = 1;
  }
}
