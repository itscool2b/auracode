import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-instructions.mjs", import.meta.url));

for (const [name, agents, claude, expected] of [
  ["identical instructions", "same\n", "same\n", 0],
  ["different instructions", "one\n", "two\n", 1],
  ["different line endings", "same\n", "same\r\n", 1],
  ["missing Claude instructions", "same\n", null, 1],
  ["missing agent instructions", null, "same\n", 1],
  ["public checkout without local instructions", null, null, 0],
]) {
  test(name, (t) => {
    const root = mkdtempSync(join(tmpdir(), "auracode-instructions-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    if (agents !== null) writeFileSync(join(root, "AGENTS.md"), agents);
    if (claude !== null) writeFileSync(join(root, "CLAUDE.md"), claude);
    const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    assert.equal(result.status, expected, result.stderr);
    if (expected !== 0) assert.match(result.stderr, /AGENTS\.md.*CLAUDE\.md/);
  });
}
