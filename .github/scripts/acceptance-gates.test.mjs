/** Verify the real final gate configuration without running hosted CI, agents or sign-in. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const build = read(".github/workflows/build.yml");
const desktop = JSON.parse(read("apps/desktop/package.json"));
const scripts = "apps/desktop/scripts";

test("every desktop acceptance script runs directly or through a checked aggregator", () => {
  const expected = readdirSync(resolve(root, scripts)).filter((file) =>
    /^check-.*\.mjs$/u.test(file),
  );
  const covered = new Set();
  function include(file) {
    if (covered.has(file)) return;
    covered.add(file);
    for (const match of read(`${scripts}/${file}`).matchAll(
      /from\s+["']\.\/(check-[^"']+\.mjs)["']/gu,
    )) {
      include(match[1]);
    }
  }
  for (const match of ci.matchAll(/@auracode\/desktop\s+exec node scripts\/(check-[^\s]+\.mjs)/gu))
    include(match[1]);
  for (const match of ci.matchAll(/@auracode\/desktop\s+(check:[\w-]+)/gu)) {
    const command = desktop.scripts[match[1]];
    assert.ok(command, `Missing package command ${match[1]}`);
    const file = /^node scripts\/(check-[\w-]+\.mjs)$/u.exec(command);
    assert.ok(file, `Review acceptance command ${match[1]}: ${command}`);
    include(file[1]);
  }
  assert.deepEqual(
    expected.filter((file) => !covered.has(file)),
    [],
    "Acceptance scripts missing from final CI",
  );
});

test("browser gates have explicit deadlines and retain standalone evidence", () => {
  for (const step of ci.split(/\n {6}- name:/u).slice(1)) {
    if (
      !/run:.*(?:\n[ \t]+.*)*?pnpm --filter @auracode\/(?:desktop|web) (?:check:|exec node scripts\/check-|test:browser)/u.test(
        step,
      )
    )
      continue;
    assert.match(
      step,
      /timeout-minutes: (?:[1-9]|1[0-5])\b/u,
      `Browser step needs a bounded deadline: ${step.split("\n")[0]}`,
    );
  }
  for (const artifact of [
    "setup-browser",
    "setup-actions-browser",
    "profile-status-browser",
    "chat-auth-browser",
  ]) {
    assert.ok(ci.includes(`target/${artifact}`), `Missing browser evidence: ${artifact}`);
  }
});

test("native desktop and isolated encrypted fixtures enable SQLCipher", () => {
  assert.match(ci, /os: \[macos-26, windows-2025\]/u);
  assert.match(ci, /cargo test -p aura-sync --features sqlcipher --lib --locked/u);
  assert.match(ci, /cargo test -p aura-core --features account-sync --lib --locked/u);
  assert.match(
    read("apps/desktop/src-tauri/Cargo.toml"),
    /aura-core = \{[^\n]*features = \["account-sync"\]/u,
  );
  assert.match(
    read("crates/aura-core/Cargo.toml"),
    /account-sync = \[[^\n]*"aura-sync\/sqlcipher"/u,
  );
});

test("unsigned packages use exact bindings and need no release secret or updater artifact", () => {
  const bindings = build.indexOf('export-bindings.sh check "$RUNNER_TEMP/bindings-build"');
  const bundle = build.indexOf('pnpm --filter @auracode/desktop bundle --target "$BUNDLE_TARGET"');
  assert.ok(
    bindings >= 0 && bundle > bindings,
    "Check exact generated bindings before bundling the frontend",
  );
  assert.doesNotMatch(
    build,
    /--signed-updater|secrets\.|TAURI_SIGNING_PRIVATE_KEY|AURACODE_UPDATER_PUBLIC_KEY/u,
  );
  assert.match(build, /APPLE_SIGNING_IDENTITY=-/u);
  assert.match(build, /select-native-perl\.ps1/u);
  for (const target of [
    "universal-apple-darwin",
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
  ]) {
    assert.ok(build.includes(`target: ${target}`), `Missing acceptance bundle ${target}`);
  }
  const config = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
  assert.ok(
    !config.bundle.createUpdaterArtifacts,
    "Unsigned bundles must not require updater signing",
  );
  assert.equal(config.bundle.windows.signCommand, undefined);
  assert.equal(config.bundle.macOS.signingIdentity, undefined);
});

test("Windows uses a pinned external bridge, matching runtime and separate evidence", () => {
  assert.match(ci, /cargo install tauri-driver --version 2\.1\.0 --locked/u);
  assert.match(ci, /prepare-webdriver\.ps1 -OutputDirectory/u);
  assert.match(
    ci,
    /EXPECTED_WEBVIEW_VERSION: \$\{\{ steps\.webdriver-native\.outputs\.webview_version \}\}/u,
  );
  const external = ci
    .split(/\n {6}- name:/u)
    .find((step) => step.includes("node .github/scripts/webdriver-smoke.mjs"));
  assert.ok(external, "The full-app WebDriver gate must not be replaced by embedded smoke");
  assert.match(external, /timeout-minutes: 8/u);
  assert.match(external, /target\/debug\/auracode\.exe/u);
  assert.match(ci, /path: \|\s+\$\{\{ runner\.temp \}\}\/webdriver-evidence/u);
  assert.match(ci, /node --test [^\n]*webdriver-smoke\.test\.mjs/u);
});
