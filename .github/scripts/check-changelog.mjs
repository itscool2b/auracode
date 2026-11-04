// CHANGELOG.md lists every pull request merged into main, newest first: `## YYYY-MM-DD` sections
// by merge date (UTC), each line `- What changed. ([#N](https://github.com/itscool2b/auracode/pull/N))`.
// Every pull request adds its own line (docs/developing-in-aura.md, "Changelog").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY =
  /^- (\S.*\S) \(\[#(\d+)\]\(https:\/\/github\.com\/itscool2b\/auracode\/pull\/(\d+)\)\)$/;
const DATE = /^## (\d{4}-\d{2}-\d{2})$/;
/** U+2014, written by code point so the character itself never appears in the source. */
export const EM_DASH = String.fromCharCode(0x2014);

export function checkChangelog(text) {
  const problems = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "# Changelog") problems.push("line 1 must be '# Changelog'");
  const seen = new Map();
  let date = null;
  let previousDate = null;
  let previousNumber = Infinity;
  lines.forEach((line, index) => {
    const at = `line ${index + 1}`;
    if (line.includes(EM_DASH))
      problems.push(`${at}: use a colon, comma or full stop, not an em dash`);
    const heading = line.match(DATE);
    if (heading) {
      date = heading[1];
      if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
        problems.push(`${at}: ${date} is not a date`);
      if (previousDate !== null && date >= previousDate)
        problems.push(`${at}: ${date} must come before ${previousDate} (newest first, once each)`);
      previousDate = date;
      previousNumber = Infinity;
      return;
    }
    if (!line.startsWith("- ")) return;
    const entry = line.match(ENTRY);
    if (!entry) {
      problems.push(
        `${at}: an entry ends with its pull request, ([#N](https://github.com/itscool2b/auracode/pull/N))`,
      );
      return;
    }
    const [, , label, linked] = entry;
    const number = Number(label);
    if (label !== linked) problems.push(`${at}: #${label} links to pull request ${linked}`);
    if (date === null) problems.push(`${at}: #${number} is not under a date`);
    if (seen.has(number))
      problems.push(`${at}: #${number} is already listed on line ${seen.get(number)}`);
    seen.set(number, index + 1);
    if (number >= previousNumber)
      problems.push(
        `${at}: #${number} must come before #${previousNumber} (newest first within a day)`,
      );
    previousNumber = number;
  });
  if (seen.size === 0) problems.push("no entries");
  return { problems, count: seen.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? process.cwd());
  try {
    const { problems, count } = checkChangelog(readFileSync(resolve(root, "CHANGELOG.md"), "utf8"));
    if (problems.length) throw new Error(problems.join("\n  "));
    console.log(`CHANGELOG.md lists ${count} pull requests, newest first.`);
  } catch (error) {
    console.error(`CHANGELOG.md needs fixing:\n  ${error.message}`);
    process.exitCode = 1;
  }
}
