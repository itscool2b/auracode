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
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseBuildEnv, requireUpdaterSigning } from "./build-env.mjs";

const signingScript = fileURLToPath(new URL("./macos-signing.sh", import.meta.url));
const tauriCli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);
const signed = args.indexOf("--signed-updater");
if (signed >= 0) {
  requireUpdaterSigning(process.env);
  args.splice(signed, 1);
  args.push(
    "--config",
    fileURLToPath(new URL("../src-tauri/tauri.updater.conf.json", import.meta.url)),
  );
}

const sysroot = spawnSync(process.env.RUSTC ?? "rustc", ["--print", "sysroot"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (sysroot.status !== 0) {
  console.error("auracode: could not determine the Rust sysroot for build-path remapping.");
  process.exit(1);
}
const home = homedir();
const env = releaseBuildEnv(process.env, [
  [home, "/build-home"],
  [process.env.CARGO_HOME ?? join(home, ".cargo"), "/cargo"],
  [sysroot.stdout.trim(), "/rust-toolchain"],
  [fileURLToPath(new URL("../../../", import.meta.url)), "/auracode/"],
]);
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

const build = spawnSync(process.execPath, [tauriCli, "build", ...args], {
  stdio: "inherit",
  env,
});
if (build.error) {
  console.error(`auracode: could not run tauri build: ${build.error.message}`);
  process.exit(1);
}
process.exit(build.status ?? 1);
