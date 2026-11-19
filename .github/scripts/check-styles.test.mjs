import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lintStylesheet } from "./check-styles.mjs";

const script = fileURLToPath(new URL("./check-styles.mjs", import.meta.url));
const problems = (css, file = "shell.css", allowlist) =>
  lintStylesheet(css, file, allowlist).map((found) => found.problem);

test("a stylesheet on Graphite's tokens passes", () => {
  const css = `
    /* #ff0000 in a comment is not a colour. */
    .row {
      --row-indent: 36px;
      margin: 0 calc(var(--g-space-8) * -1);
      padding: var(--g-space-12) var(--g-space-16);
      gap: 1px;
      border-radius: var(--g-radius-8);
      color: var(--g-fg-1);
      font-size: var(--g-text-ui);
      line-height: var(--g-leading-ui);
      font-weight: var(--g-weight-medium);
      transition: color var(--g-dur-fast) cubic-bezier(0.4, 0, 0.2, 1), opacity 0ms;
      animation: spin var(--g-dur-count) steps(1, end) infinite;
    }`;
  assert.deepEqual(problems(css), []);
});

test("raw hex colours fail, including ones encoded in data URLs", () => {
  assert.equal(problems(".a { color: #ededed; }").length, 1);
  assert.equal(problems(".a { border: 1px solid #FFF; }").length, 1);
  assert.equal(
    problems(`.a { background: url("data:image/svg+xml,stroke='%23858585'"); }`).length,
    1,
  );
  assert.deepEqual(problems("#add { color: var(--g-fg-1); }"), []);
});

test("spacing must use --g-space-* tokens", () => {
  assert.match(problems(".a { padding: 10px 14px; }")[0], /10px in padding/);
  assert.equal(problems(".a { padding: 10px 14px; }").length, 2);
  assert.equal(problems(".a { margin-left: -18px; }").length, 1);
  assert.equal(problems(".a { gap: 12px; }").length, 1, "on-scale px is still a raw value");
  assert.equal(problems(".a { row-gap: 0.5rem; }").length, 1);
  assert.equal(problems(".a { padding-inline: 2em; }").length, 1);
  assert.deepEqual(
    problems(".a { margin: 0 auto; padding: 0px; gap: 1px; margin-top: -1px; }"),
    [],
  );
  assert.deepEqual(problems(".a { padding-top: clamp(var(--g-space-64), 16vh, 50%); }"), []);
});

test("radii must use --g-radius-* tokens", () => {
  assert.equal(problems(".a { border-radius: 10px; }").length, 1);
  assert.equal(problems(".a { border-top-left-radius: 2px; }").length, 1);
  assert.deepEqual(problems(".a { border-radius: 0 var(--g-radius-8) var(--g-radius-8) 0; }"), []);
});

test("type sizes and line heights must use tokens", () => {
  assert.equal(problems(".a { font-size: 14px; }").length, 1);
  assert.equal(problems(".a { font-size: 0.9em; }").length, 1);
  assert.equal(problems(".a { line-height: 1.5; }").length, 1);
  assert.equal(problems(".a { line-height: 22px; }").length, 1);
  assert.deepEqual(
    problems(
      ".a { font-size: inherit; line-height: normal; } .b { line-height: var(--g-leading-prose); }",
    ),
    [],
  );
});

test("weights come only from the weight tokens, which each platform grades", () => {
  assert.equal(problems(".a { font-weight: 450; }").length, 1);
  assert.equal(problems(".a { font-weight: 600; }").length, 1);
  assert.equal(problems(".a { font-weight: 700; }").length, 1);
  assert.equal(problems(".a { font-weight: bold; }").length, 1);
  assert.deepEqual(
    problems(
      ".a { font-weight: var(--g-weight-semibold); } .b { font-weight: var(--g-weight-medium); } .c { font-weight: inherit; }",
    ),
    [],
  );
});

test("durations must use --g-dur-* tokens", () => {
  assert.equal(problems(".a { animation: peek 220ms var(--g-ease-out); }").length, 1);
  assert.equal(problems(".a { animation: spin 0.9s linear infinite; }").length, 1);
  assert.equal(problems(".a { transition-duration: 240ms; }").length, 1);
  assert.deepEqual(problems(".a { transition-duration: 0ms; animation-delay: 0s; }"), []);
});

test("the allowlist names one declaration in one file", () => {
  const allowlist = [{ file: "setup.css", fragment: "line-height: 1.1875", reason: "fluid" }];
  assert.deepEqual(problems(".a { line-height: 1.1875; }", "setup.css", allowlist), []);
  assert.equal(problems(".a { line-height: 1.1875; }", "chat.css", allowlist).length, 1);
  assert.equal(problems(".a { line-height: 1.5; }", "setup.css", allowlist).length, 1);
});

test("problems carry their file and line", () => {
  const [found] = lintStylesheet(".a {\n  color: var(--g-fg-1);\n  padding: 10px;\n}", "chat.css");
  assert.equal(found.file, "chat.css");
  assert.equal(found.line, 3);
  assert.equal(found.declaration, "padding: 10px");
});

for (const [name, css, expected] of [
  ["a clean desktop tree", ".a { padding: var(--g-space-8); }", 0],
  ["a desktop tree off the scale", ".a { padding: 10px; }", 1],
  ["a desktop tree with a token nothing defines", ".a { padding: var(--g-space-10); }", 1],
]) {
  test(`the command reports ${name}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "auracode-styles-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "apps/desktop/src/components"), { recursive: true });
    writeFileSync(join(root, "apps/desktop/src/components/a.css"), css);
    mkdirSync(join(root, "packages/ui/src/graphite"), { recursive: true });
    writeFileSync(join(root, "packages/ui/src/graphite/tokens.css"), ":root { --g-space-8: 8px; }");
    const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    assert.equal(result.status, expected, result.stderr);
    if (expected !== 0)
      assert.match(
        result.stderr,
        /apps\/desktop\/src\/components\/a\.css:1: (?:10px|--g-space-10 is defined nowhere)/,
      );
  });
}

test("eyebrows fail wherever they hide", async () => {
  const { lintEyebrows } = await import("./check-styles.mjs");
  const eyebrows = (text) => lintEyebrows(text, "x.css").map((found) => found.problem);
  assert.equal(eyebrows(".a {\n  text-transform: uppercase;\n}").length, 1);
  assert.equal(eyebrows(".section-kicker {\n  color: red;\n}").length, 1);
  assert.equal(eyebrows('<p className="hero-eyebrow">Work</p>').length, 1);
  assert.equal(eyebrows('.page-head::before {\n  content: "AURACODE / INFORMATION";\n}').length, 1);
  assert.deepEqual(eyebrows(".cmd::first-letter {\n  text-transform: uppercase;\n}"), []);
  assert.deepEqual(eyebrows('.a::after {\n  content: "+";\n}'), []);
  assert.deepEqual(eyebrows(".title {\n  text-transform: none;\n}"), []);
});

test("a token nothing defines fails, since the browser drops the whole declaration", async () => {
  const { definedIn, lintUndefined, lintUndefinedIn } = await import("./check-styles.mjs");
  const tokens =
    ":root {\n  --g-space-8: 8px;\n  --g-space-12: 12px;\n}\n/* --g-space-10: 10px; */\n";
  const script =
    'node.style.setProperty("--row-height", "28px");\nconst style = { "--depth": 2 };\n';
  const defined = new Set([...definedIn(tokens, true), ...definedIn(script, false)]);
  assert.deepEqual([...defined].sort(), ["--depth", "--g-space-12", "--g-space-8", "--row-height"]);
  const sheet = [
    ".pill {",
    "  padding: 0 var(--g-space-12) 0 var(--g-space-10);",
    "  height: var(--row-height);",
    "  margin: var(--maybe-unset, 0px);",
    "  /* gap: var(--in-a-comment); */",
    "  z-index: var( --depth );",
    "}",
  ].join("\n");
  const found = lintUndefined(sheet, "shell.css", defined);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.match(found[0].problem, /--g-space-10 is defined nowhere/);
  // The repository itself is clean.
  assert.deepEqual(lintUndefinedIn(fileURLToPath(new URL("../../", import.meta.url))), []);
});
