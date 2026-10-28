/**
 * The Plugin library and per-agent configuration sync in Chromium and WebKit, on synthetic
 * fixtures (?preview=plugins, plugins-update, plugins-failed, plugins-pi, plugin-sync). No agent,
 * CLI or vendor command runs, and no real configuration is read. Every view's axe audit must be
 * clean. Usage: node scripts/check-plugin-library.mjs [--server URL]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/plugin-library-browser");
const given = process.argv.indexOf("--server");
const url = given > 0 ? process.argv[given + 1] : "http://127.0.0.1:1426";
const require = createRequire(import.meta.url);

/** Audits once every finite animation has ended, as the other checks do. */
async function audit(page, what) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, [], what);
}

const calls = (page) => page.evaluate(() => window.pluginsFixture.calls);
const syncCalls = (page) => page.evaluate(() => window.configSyncCalls);

async function checkLibrary(page, engine) {
  await page.goto(`${url}/?preview=plugins`);
  await page.getByRole("heading", { name: "Plugin library", exact: true }).waitFor();
  const agents = page.getByRole("navigation", { name: "Agents" });
  for (const name of ["Claude Code", "Codex", "Pi", "OpenCode"])
    await agents.getByRole("button", { name, exact: true }).waitFor();
  await page.getByText("From claude plugin list --json --available").waitFor();
  assert.equal(await page.getByText("Instructions", { exact: true }).count(), 0);
  // Opening reads the cache (StrictMode mounts twice in development); only Refresh reruns the CLIs.
  assert.ok((await calls(page)).every((call) => call === "snapshot:false"));
  await audit(page, `${engine} Plugin library`);
  await page.screenshot({ path: resolve(out, `${engine}-plugins.png`) });
  // A row's menu opens the agent's own reviewed command, filled in; nothing runs yet.
  await page.getByRole("button", { name: "tools actions" }).click();
  await page.getByRole("menuitem", { name: "Disable…" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage integrations" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Plugin and marketplace").inputValue(), "tools@team");
  await audit(page, `${engine} vendor dialog from a row`);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  // Available plugins are searched, then installed through the same review.
  await page.getByLabel("Find an available Claude Code plugin").fill("security");
  await page.getByRole("button", { name: "Install security-review" }).click();
  assert.equal(
    await page.getByLabel("Plugin and marketplace").inputValue(),
    "security-review@anthropic-plugin-directory",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Codex: one feature's CLI listing failed and says so; its sync switch is per agent.
  await agents.getByRole("button", { name: "Codex", exact: true }).click();
  await page.getByText("marketplace cache is corrupt", { exact: false }).waitFor();
  await page.getByRole("switch", { name: "Sync Codex across devices" }).click();
  await page.waitForFunction(() => window.pluginsFixture.calls.includes("sync:codex:false"));
  await agents.getByRole("button", { name: "Pi", exact: true }).click();
  await page.getByText("Pi has no plugin marketplace.", { exact: false }).waitFor();
  await agents.getByRole("button", { name: "OpenCode", exact: true }).click();
  assert.equal(await page.getByRole("switch").count(), 0);
  await page.getByRole("button", { name: "Refresh Plugin library" }).click();
  await page.waitForFunction(() => window.pluginsFixture.calls.includes("snapshot:true"));

  await page.goto(`${url}/?preview=plugins-update`);
  await page.getByText("Claude Code 2.1.314 is available.", { exact: false }).waitFor();
  await page.getByText("so its plugins were read again", { exact: false }).waitFor();
  await audit(page, `${engine} update available`);
  await page.screenshot({ path: resolve(out, `${engine}-plugins-update.png`) });
  await page.getByRole("button", { name: "Update Claude Code to 2.1.314" }).click();
  await page.getByText("Up to date on 2.1.314.").waitFor();
  assert.ok((await calls(page)).includes("update:claude"));

  for (const mode of ["plugins-failed", "plugins-pi"]) {
    await page.goto(`${url}/?preview=${mode}`);
    await page.getByRole("heading", { name: "Plugin library", exact: true }).waitFor();
    await page.locator(".plugins-agent").waitFor();
    await audit(page, `${engine} ${mode}`);
    await page.screenshot({ path: resolve(out, `${engine}-${mode}.png`) });
  }
}

async function checkSync(page, engine) {
  await page.goto(`${url}/?preview=plugin-sync`);
  for (const name of ["Claude Code", "Codex", "Pi"])
    await page.locator(".config-sync-agent-head").getByText(name, { exact: true }).waitFor();
  for (const text of [
    "Marketplace not added",
    "Needs a newer agent",
    "Another system only",
    "Kept on its own device",
    "Command not on this device",
    "Removed on another device",
    "Previous change needs review",
    "Sync is off",
    "Needs a decision",
  ])
    await page.getByText(text, { exact: true }).first().waitFor();
  await audit(page, `${engine} sync by agent`);
  await page.screenshot({ path: resolve(out, `${engine}-plugin-sync.png`), fullPage: true });
  await page.getByRole("switch", { name: "Sync Pi on this device" }).click();
  await page.waitForFunction(() => window.configSyncCalls.includes("sync:pi:true"));
  await page.getByRole("button", { name: "Apply all 1" }).first().click();
  await page.getByRole("status").filter({ hasText: "1 of 2 applied." }).waitFor();
  // A plugin whose marketplace is missing: the review offers the installer steps in order, and a
  // failed install restores that declaration only.
  await page.getByRole("button", { name: /Review settings.json · enabledPlugins/ }).click();
  const steps = page.getByLabel("Installer steps");
  await steps.waitFor();
  await steps.getByText("owner/plugins").waitFor();
  await audit(page, `${engine} installer steps`);
  await page.screenshot({ path: resolve(out, `${engine}-plugin-sync-steps.png`) });
  assert.equal(
    (await syncCalls(page)).some((call) => call.startsWith("apply:")),
    false,
  );
  await steps.getByRole("button", { name: "Install…" }).click();
  await page.getByRole("button", { name: "Review command", exact: true }).click();
  await page.getByRole("button", { name: "Start setup", exact: true }).click();
  await page.waitForFunction(() =>
    window.configSyncCalls.some((call) => call.startsWith("vendor-finish:")),
  );
  // The terminal stays readable until it is closed; then the review reports the outcome.
  await page.getByRole("button", { name: "Close setup terminal", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "exited with code 1" }).waitFor();
  assert.ok(
    (await syncCalls(page)).some(
      (call) => call.startsWith("vendor-finish:") && call.endsWith(":false:1"),
    ),
  );
}

let server;
let output = "";
try {
  await mkdir(out, { recursive: true });
  if (given < 0) {
    const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    server = spawn(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", "1426", "--strictPort"],
      {
        cwd: app,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        output = (output + data).slice(-8192);
      });
    let ready = false;
    for (let attempt = 0; attempt < 150 && !ready; attempt++) {
      if (server.exitCode !== null) throw new Error(output);
      ready = await fetch(`${url}/?preview=plugins`).then(
        (response) => response.ok,
        () => false,
      );
      if (!ready) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready, output);
  }
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
        colorScheme: "dark",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await checkLibrary(page, engine);
      await checkSync(page, engine);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: per-agent sections, CLI and file sources, update alert, failed listing, sync switches, holds, installer steps and a failed install passed with clean axe audits`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.kill();
}
