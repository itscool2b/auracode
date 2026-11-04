/** Writes src/graphite/themes.css from themes.ts: `node packages/ui/scripts/write-themes.mts`. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themesCss } from "../src/graphite/themes.ts";

const target = fileURLToPath(new URL("../src/graphite/themes.css", import.meta.url));
writeFileSync(target, themesCss());
console.log(`Wrote ${target}`);
