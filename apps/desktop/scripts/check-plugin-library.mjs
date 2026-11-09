/**
 * The Plugins & MCP and per-agent configuration sync in Chromium and WebKit, on synthetic
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

async function checkProgressive(page, engine) {
  await page.goto(`${url}/?preview=plugins-progressive`);
  const agents = page.getByRole("navigation", { name: "Agents" });
  for (const name of [
    "Claude Code",
    "Codex",
    "Pi",
    "OpenCode",
    "Hermes",
    "Grok Build",
    "Cursor",
    "Antigravity",
    "oh-my-pi",
  ])
    await agents.getByRole("button", { name, exact: true }).waitFor();
  await page
    .getByText("Reading the agent listing. Cached and file entries are available.")
    .first()
    .waitFor();
  await page.getByRole("button", { name: "review-changes actions" }).waitFor();
  assert.equal(await page.getByText("Reading what your agents use…").count(), 0);
  await agents.getByRole("button", { name: "Pi", exact: true }).click();
  await page.getByText("Checking installation…", { exact: false }).waitFor();
  await page.evaluate(() => window.pluginsFixture.finishProvider("codex"));
  await agents.getByRole("button", { name: "Codex", exact: true }).click();
  await page.getByText("From codex mcp list --json").waitFor();
  await agents.getByRole("button", { name: "Claude Code", exact: true }).click();
  await page
    .getByText("Reading the agent listing. Cached and file entries are available.")
    .first()
    .waitFor();
  await audit(page, `${engine} progressively loaded Plugins & MCP`);
  await page.evaluate(() => window.pluginsFixture.finishProvider("claude"));
  await page.getByText("From claude plugin list --json --available").waitFor();
  await page.evaluate(() => window.pluginsFixture.unmount());
  await page.evaluate(() => {
    window.pluginsFixture.finishProvider("pi");
    window.pluginsFixture.finish();
  });
  assert.equal(await page.getByRole("heading", { name: "Plugins & MCP", exact: true }).count(), 0);
}

async function checkLibrary(page, engine) {
  await checkProgressive(page, engine);
  await page.goto(`${url}/?preview=plugins`);
  await page.getByRole("heading", { name: "Plugins & MCP", exact: true }).waitFor();
  await page
    .getByText(
      "Shared MCP definitions work across compatible sessions. Native plugins and authentication remain owned by each agent; unavailable interfaces are shown explicitly.",
    )
    .waitFor();
  const agents = page.getByRole("navigation", { name: "Agents" });
  for (const name of [
    "Claude Code",
    "Codex",
    "Pi",
    "OpenCode",
    "Hermes",
    "Grok Build",
    "Cursor",
    "Antigravity",
    "oh-my-pi",
  ])
    await agents.getByRole("button", { name, exact: true }).waitFor();
  await page.getByText("From claude plugin list --json --available").waitFor();
  assert.equal(await page.getByText("Instructions", { exact: true }).count(), 0);
  // Opening reads the cache (StrictMode mounts twice in development); only Refresh reruns the CLIs.
  assert.ok((await calls(page)).every((call) => call === "snapshot:false"));
  await audit(page, `${engine} Plugins & MCP`);
  await page.screenshot({ path: resolve(out, `${engine}-plugins.png`) });
  // A row's menu opens the agent's own reviewed command, filled in; nothing runs yet.
  await page.getByRole("button", { name: "tools actions" }).click();
  await page.getByRole("menuitem", { name: "Disable…" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage integrations" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Plugin and marketplace").inputValue(), "tools@team");
  assert.match(
    await dialog.locator(".vendor-intro").textContent(),
    /reviewed command\. You review the exact command before it runs\.$/,
  );
  await audit(page, `${engine} vendor dialog from a row`);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  // A row below the fold: the click first scrolls it into view, and that scroll's event, which
  // arrives after the menu opened, leaves the menu open. A scroll that moves the row closes it.
  await page.getByRole("button", { name: "review-changes actions" }).click();
  const rowMenu = page.getByRole("menu", { name: "review-changes actions" });
  await rowMenu.waitFor();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  assert.equal(await rowMenu.count(), 1, `${engine}: the menu closed on the click's own scroll`);
  await page.locator(".plugins-main").evaluate((node) => node.scrollBy(0, -120));
  await rowMenu.waitFor({ state: "detached" });
  // An agent's own MCP server shares with every agent, through Shared MCP, after a review that
  // says what is shared and what stays on this device; a copy to one agent stays blocked.
  await page.getByRole("button", { name: "github actions" }).click();
  await page.getByRole("menuitem", { name: "Preview and copy…" }).click();
  const detail = page.getByRole("dialog", { name: "github" });
  await detail.getByText("No values will be copied.", { exact: false }).waitFor();
  await detail.getByRole("button", { name: "Share with every agent", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share with every agent" });
  await share
    .getByText("Their values stay on this device as local credentials", { exact: false })
    .waitFor();
  await share.getByText("Antigravity and oh-my-pi", { exact: false }).waitFor();
  await audit(page, `${engine} share an MCP server with every agent`);
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByText("Shared github with every agent.", { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.libraryShares), ["github"]);
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
  await page.getByText("Configuration sync covers Claude Code, Codex and Pi.").waitFor();
  assert.equal(await page.getByRole("switch").count(), 0);
  // Grok Build lists its plugins and marketplaces, and adds a marketplace where its list is.
  await agents.getByRole("button", { name: "Grok Build", exact: true }).click();
  await page.getByText("xai-org/plugin-marketplace", { exact: false }).waitFor();
  // An available Grok plugin installs in Grok: its CLI installs from sources, not names.
  assert.equal(await page.getByRole("button", { name: "Install vercel", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Install vercel in Grok" }).waitFor();
  await page.getByText("grok plugin marketplace list --json", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Add marketplace", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Marketplace source" });
  await source.waitFor();
  assert.equal(
    await source.getAttribute("placeholder"),
    "owner/repository, an https Git address or a local folder",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await audit(page, `${engine} Grok plugins and marketplaces`);
  await page.screenshot({ path: resolve(out, `${engine}-plugins-grok.png`) });
  // Hermes: its plugins, and its skill sources (taps) with their own Add.
  await agents.getByRole("button", { name: "Hermes", exact: true }).click();
  await page.getByText("browser-firecrawl", { exact: true }).waitFor();
  await page.getByText("team/skills", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add skill source", exact: true }).click();
  await page.getByRole("textbox", { name: "Skill source (GitHub repository)" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Cursor still has no qualified interface, and says so.
  await agents.getByRole("button", { name: "Cursor", exact: true }).click();
  await page
    .getByText("no qualified structured plugin-management interface", { exact: false })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "Add marketplace", exact: true }).count(), 0);
  await agents.getByRole("button", { name: "Hermes", exact: true }).click();
  await page.getByRole("button", { name: "Hermes actions" }).click();
  await page.getByRole("menuitem", { name: "Open native customization" }).click();
  await page.getByRole("dialog", { name: "Manage integrations" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await audit(page, `${engine} reviewed native inventory and customization route`);
  await page.screenshot({ path: resolve(out, `${engine}-plugins-hermes.png`) });
  await page.getByRole("button", { name: "Refresh Plugins & MCP" }).click();
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
    await page.getByRole("heading", { name: "Plugins & MCP", exact: true }).waitFor();
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
      // The first page from a new dev server compiles the app, which takes over 10 s on CI's macOS.
      page.setDefaultNavigationTimeout(60000);
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
