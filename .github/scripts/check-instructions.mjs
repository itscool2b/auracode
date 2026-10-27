import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());

function optionalInstructions(name) {
  try {
    return readFileSync(resolve(root, name));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

try {
  const agents = optionalInstructions("AGENTS.md");
  const claude = optionalInstructions("CLAUDE.md");
  if (agents === null && claude === null) {
    console.log("No local instruction files; parity check is not needed.");
  } else if (agents === null || claude === null) {
    throw new Error("local instruction files must be present together");
  } else if (!agents.equals(claude)) {
    throw new Error("update both local files together; their bytes differ");
  } else {
    console.log("AGENTS.md and CLAUDE.md are identical.");
  }
} catch (error) {
  console.error(`Local AGENTS.md and CLAUDE.md must be paired and identical: ${error.message}`);
  process.exitCode = 1;
}
