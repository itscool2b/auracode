/**
 * Keeps the desktop app's stylesheets on Graphite (docs/design/visual-language.md, section 3).
 * Every colour, space, radius, type size, line height, weight and duration in
 * apps/desktop/src/**\/*.css must come from a --g-* token. It fails on:
 *
 * - raw hex colours, including %23-encoded ones inside data URLs;
 * - px, rem or em lengths in margin, padding and gap (use --g-space-*; 0 and 1px hairlines pass);
 * - px, rem or em lengths in border radii (use --g-radius-*);
 * - font sizes and line heights that are not tokens (inherit and normal pass);
 * - font weights that are not the weight tokens (--g-weight-regular, -medium, -semibold), which
 *   each platform grades so text reads the same weight everywhere;
 * - transition and animation times that are not --g-dur-* tokens (0ms and 0s pass).
 *
 * Custom property definitions are not checked: a value given a name is a token by definition. The
 * allowlist below holds the few justified exceptions, each with its reason.
 *
 * Usage: node .github/scripts/check-styles.mjs [repository root]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Justified exceptions: the file, a fragment of the declaration, and why it stays. */
export const ALLOWLIST = [
  {
    file: "components/chat/canvas.css",
    fragment: "font-size: var(--canvas-editor-size)",
    reason:
      "The canvas's text box sits over the drawing's own text at the current zoom, so its size is the drawing's, not the interface's scale.",
  },
  {
    file: "components/chat/canvas.css",
    fragment: "line-height: 1.3",
    reason:
      "The canvas's text box lines up with the drawing's text, which the SVG and the export set at 1.3 of its size.",
  },
  {
    file: "shell.css",
    fragment: "stroke='%23000'",
    reason: "The checkbox's check is an SVG data URL, which cannot read a custom property.",
  },
  {
    file: "components/settings/settings.css",
    fragment: "stroke='%23000'",
    reason:
      "Settings draws the chat's checkbox; its check is an SVG data URL, which cannot read a custom property.",
  },
  {
    file: "components/TerminalSheet.css",
    fragment: "fill='%23ededed'",
    reason:
      "The passed status's pixel check is an SVG data URL, which cannot read a custom property.",
  },
  {
    file: "components/chat/launch-art.css",
    fragment: " * var(--launch-art-scale))",
    reason:
      "The start screen's drawing is the art tokens times the scale that fits it to the pane; no fixed size fits every piece in every window.",
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
const WEIGHTS = new Set(["inherit"]);

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
      problems.push(
        `font-weight ${weight}; use var(--g-weight-regular), -medium or -semibold, which each platform grades`,
      );
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

/*
 * No eyebrows, ever (owner, 1 November 2026): no small label above a heading or a section on the
 * website or in the app. The checks catch the shapes eyebrows take in code:
 *
 * - uppercase text (a first letter capitalised with ::first-letter is a different thing);
 * - a class named for one: eyebrow, kicker, overline;
 * - a label generated by CSS that shouts (content with a run of capitals, like "AURACODE / ...").
 */
const EYEBROW_CLASS = /\b[\w-]*(?:eyebrow|kicker|overline)[\w-]*\b/i;
const SHOUTING = /content\s*:\s*(["'])[^"']*[A-Z]{3,}[^"']*\1/;

/** The eyebrow problems in one stylesheet or component source, by line. */
export function lintEyebrows(text, file) {
  const found = [];
  const lines = stripComments(text).split("\n");
  lines.forEach((line, index) => {
    const at = { file, line: index + 1, declaration: line.trim() };
    if (/text-transform\s*:\s*uppercase/i.test(line)) {
      const opening = lines
        .slice(0, index + 1)
        .reverse()
        .find((candidate) => candidate.includes("{"));
      if (!opening?.includes("::first-letter")) found.push({ ...at, problem: "uppercase text" });
    }
    const named = line.match(EYEBROW_CLASS);
    if (named && /class|\.|:is|:where/.test(line))
      found.push({ ...at, problem: `"${named[0]}" names an eyebrow` });
    if (SHOUTING.test(line)) found.push({ ...at, problem: "a generated uppercase label" });
  });
  return found;
}

function sources(dir, extensions) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "build" || name === "dist") continue;
    if (statSync(path).isDirectory()) out.push(...sources(path, extensions));
    else if (extensions.some((extension) => name.endsWith(extension))) out.push(path);
  }
  return out.sort();
}

/** Every eyebrow in the website, the desktop app and the shared primitives. */
export function lintEyebrowsIn(root) {
  const roots = ["apps/web/app", "apps/desktop/src", "packages/ui/src/graphite"];
  return roots
    .map((folder) => resolve(root, folder))
    .filter((folder) => existsSync(folder))
    .flatMap((folder) =>
      sources(folder, [".css", ".tsx"]).flatMap((path) =>
        lintEyebrows(readFileSync(path, "utf8"), relative(root, path).split(sep).join("/")),
      ),
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
    const eyebrows = lintEyebrowsIn(root);
    if (eyebrows.length === 0) {
      console.log("No eyebrows on the website or in the app.");
    } else {
      for (const { file, line, declaration, problem } of eyebrows) {
        console.error(`${file}:${line}: ${problem}\n    ${declaration}`);
      }
      console.error(
        `${eyebrows.length} eyebrow(s) found. Headings stand on their own: no label above a heading or section (docs/design/visual-language.md).`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Could not check the desktop stylesheets: ${error.message}`);
    process.exitCode = 1;
  }
}
