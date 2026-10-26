/** Production Library presentation with synthetic native replies, never real configuration. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/library-browser");
const url = "http://127.0.0.1:1465";
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1465", "--strictPort"],
  {
    cwd: app,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    output = (output + data).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(`${url}/library.html`)).ok;
    } catch {
      /* Owned server starting. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const calls = () => page.evaluate(() => window.libraryFixture.calls());
      const choose = async () => {
        await page.getByRole("button", { name: /Review changes Claude/ }).click();
        await page.getByLabel("Copy destination").selectOption("user:codex");
      };
      await page.goto(`${url}/library.html`);
      await page.getByRole("button", { name: /Review changes Claude/ }).waitFor();
      assert.deepEqual(await calls(), ["snapshot:null", "history"]);
      await choose();
      assert.equal(await page.locator(".library-code script").count(), 0);
      await page.screenshot({ path: resolve(out, `${engine}-library.png`) });
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} Library accessibility`,
      );
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await page.getByRole("dialog", { name: "Review copy" }).waitFor();
      assert.equal((await calls()).includes("apply"), false);
      await page.screenshot({ path: resolve(out, `${engine}-review.png`) });
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} review accessibility`,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.libraryFixture.calls().includes("cancel"));
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await page.getByRole("button", { name: "Apply copy", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Copy saved" }).waitFor();
      await page.getByRole("button", { name: "Copy history", exact: true }).click();
      await page.getByRole("button", { name: "Review restore" }).click();
      assert.equal((await calls()).includes("rollback"), false);
      await page.getByRole("button", { name: "Restore originals", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Original files restored" }).waitFor();
      await page.getByRole("button", { name: "Review restore" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Review restore" }).isEnabled(), false);
      await page.getByRole("button", { name: /MCP servers/ }).click();
      await page.getByRole("button", { name: /Private issue tracker/ }).click();
      await page
        .getByText("This server has authentication or vendor options", { exact: false })
        .waitFor();
      assert.equal(await page.getByLabel("Copy destination").count(), 0);
      await page.getByLabel("Project configuration source").selectOption("project-fixture");
      await page.waitForFunction(() =>
        window.libraryFixture.calls().includes("snapshot:project-fixture"),
      );
      // A stale reply is displayed and its single-use review closes without claiming success.
      await page.goto(`${url}/library.html?stale`);
      await choose();
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await page.getByRole("button", { name: "Apply copy", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "changed after" }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal((await calls()).filter((call) => call === "apply").length, 1);
      // Navigating away while preparing cancels a later review response instead of leaking it.
      await page.goto(`${url}/library.html?delay`);
      await choose();
      await page.getByRole("button", { name: "Review copy", exact: true }).click();
      await page.getByRole("button", { name: /AGENTS.md Codex/ }).click();
      await page.evaluate(() => window.libraryFixture.finishPreparation());
      await page.waitForFunction(() => window.libraryFixture.calls().includes("cancel"));
      assert.equal(await page.evaluate(() => window.libraryFixture.pending()), false);
      assert.equal((await calls()).includes("apply"), false);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: Library inspection, review/cancel, explicit copy, restore, stale rejection and abandoned preparation passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
