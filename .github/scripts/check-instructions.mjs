import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
try {
  const agents = readFileSync(resolve(root, "AGENTS.md"));
  const claude = readFileSync(resolve(root, "CLAUDE.md"));
  if (!agents.equals(claude)) {
    throw new Error("update both files in the same commit; their bytes differ");
  }
  console.log("AGENTS.md and CLAUDE.md are identical.");
} catch (error) {
  console.error(`AGENTS.md and CLAUDE.md must exist and be identical: ${error.message}`);
  process.exitCode = 1;
}
