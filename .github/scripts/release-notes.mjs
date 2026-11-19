// What a published build says is new: the headlines of the changelog lines added since the last
// published build, newest first. The download page shows them, and so does the app's Update panel.
//
// Usage: node .github/scripts/release-notes.mjs [previous-ref]
//   previous-ref  the last published build's tag; without one, the newest day's lines are used.
// Prints the notes. CHANGELOG.md is read from the working tree, and from `git show` at the ref.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = /^- (\S.*\S) \(\[#(\d+)\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+\)\)$/u;
/** The most headlines listed; the rest are counted. */
export const MAX_LINES = 8;
export const FALLBACK = "Fixes and improvements.";

/** Every entry of a changelog, in file order: its pull request, its day and its words. */
export function entries(changelog) {
  const found = [];
  let day = null;
  for (const line of changelog.replace(/\r\n/gu, "\n").split("\n")) {
    const heading = /^## (\d{4}-\d{2}-\d{2})$/u.exec(line);
    if (heading) {
      day = heading[1];
      continue;
    }
    const entry = ENTRY.exec(line);
    if (entry) found.push({ number: Number(entry[2]), day, words: entry[1] });
  }
  return found;
}

/** A line's headline: its words up to the first full stop or colon, as the website sets it. */
export function headline(words) {
  const end = /[.:](?=\s|$)/u.exec(words);
  return (end ? words.slice(0, end.index) : words).trim();
}

/**
 * The notes for a build: the headlines of the lines `current` has and `previous` lacks. With no
 * previous changelog (the first published build), the newest day's lines stand in.
 */
export function notes(current, previous) {
  const now = entries(current);
  let fresh;
  if (previous === null) {
    fresh = now.filter((entry) => entry.day === now[0]?.day);
  } else {
    const seen = new Set(entries(previous).map((entry) => entry.number));
    fresh = now.filter((entry) => !seen.has(entry.number));
  }
  if (fresh.length === 0) return FALLBACK;
  const lines = fresh.slice(0, MAX_LINES).map((entry) => `${headline(entry.words)}.`);
  if (fresh.length > MAX_LINES) lines.push(`And ${fresh.length - MAX_LINES} more.`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const ref = process.argv[2]?.trim();
  let previous = null;
  if (ref) {
    if (!/^[A-Za-z0-9._-]+$/u.test(ref)) {
      console.error(`Not a tag name: ${JSON.stringify(ref)}`);
      process.exit(2);
    }
    try {
      previous = execFileSync("git", ["show", `${ref}:CHANGELOG.md`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // A tag from before the changelog, or one this checkout does not have: the newest day's lines.
      previous = null;
    }
  }
  process.stdout.write(`${notes(readFileSync(resolve(root, "CHANGELOG.md"), "utf8"), previous)}\n`);
}
