// `pnpm bundle`: `tauri build` with the local signing identity on macOS.
//
// A bundle signed with the same identity every time keeps the app's designated requirement across
// builds, so macOS keeps its privacy grants (~/Desktop access) instead of asking again. When this
// Mac has no identity yet the bundle is signed ad hoc, as CI does, with a warning: a machine
// without the certificate can still build. APPLE_SIGNING_IDENTITY, when set, always wins (it is
// Tauri's own setting). Elsewhere this is plain `tauri build`. Arguments are passed on to it. See
// ../README.md.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const signingScript = fileURLToPath(new URL("./macos-signing.sh", import.meta.url));
const tauriCli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");

const env = { ...process.env };
if (process.platform === "darwin" && !env.APPLE_SIGNING_IDENTITY) {
  const lookup = spawnSync("sh", [signingScript, "identity"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (lookup.status === 0) {
    env.APPLE_SIGNING_IDENTITY = lookup.stdout.trim();
  } else if (lookup.status === 1) {
    env.APPLE_SIGNING_IDENTITY = "-";
    console.warn(
      'auracode: no "auracode Local Signing" identity on this Mac, so the bundle is signed ad hoc and macOS will treat it as a new app. Create the identity once with: pnpm signing create',
    );
  } else {
    // Ambiguous: the script has said which identities clash. Signing with either would be a guess.
    process.exit(lookup.status ?? 1);
  }
}

const build = spawnSync(process.execPath, [tauriCli, "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
if (build.error) {
  console.error(`auracode: could not run tauri build: ${build.error.message}`);
  process.exit(1);
}
process.exit(build.status ?? 1);
