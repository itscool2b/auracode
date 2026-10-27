// Build tooling only. Keep private build-machine paths out of distributed Rust binaries.
export function releaseBuildEnv(env, roots) {
  if (
    env.AURACODE_UPDATER_CHANNEL !== undefined &&
    !["stable", "staging"].includes(env.AURACODE_UPDATER_CHANNEL)
  ) {
    throw new Error("AURACODE_UPDATER_CHANNEL must be stable or staging.");
  }
  const flags = env.CARGO_ENCODED_RUSTFLAGS
    ? env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")
    : (env.RUSTFLAGS ?? "").split(/\s+/u).filter(Boolean);
  // rustc applies the last matching mapping, so specific roots follow the home directory.
  for (const [source, destination] of roots) {
    if (!source) continue;
    if (/[=\r\n]/u.test(source) || source.includes("\x1f")) {
      throw new Error("A build path contains a character rustc cannot safely remap.");
    }
    for (const path of new Set([source, source.replaceAll("\\", "/")])) {
      flags.push(`--remap-path-prefix=${path}=${destination}`);
    }
  }
  return { ...env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") };
}

export function requireUpdaterSigning(env) {
  if (!env.AURACODE_UPDATER_PUBLIC_KEY?.trim() || !env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error(
      "Signed updater builds require AURACODE_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY from the release secret store.",
    );
  }
}
