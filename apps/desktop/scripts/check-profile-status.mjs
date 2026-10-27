/** The production sidebar row with synthetic native status and delayed responses only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:1470";
const out = resolve(app, "../../target/profile-status-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1470",
    "--strictPort",
  ],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (part) => {
    output = (output + part).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      await page.goto(`${origin}/scripts/fixtures/profile-status.html`);
      await page.getByRole("status").filter({ hasText: "Stored on this device" }).waitFor();
      const calls = () => page.evaluate(() => window.profileStatusFixture.calls());
      assert.deepEqual(await calls(), []);
      await page.screenshot({ path: resolve(out, `${engine}-local.png`) });
      await page.getByRole("button", { name: "Work account", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Sync status loading" }).waitFor();
      await page.evaluate(() => window.profileStatusFixture.resolve(0, "work"));
      await page.getByRole("status").filter({ hasText: "Synced" }).waitFor();
      await page.screenshot({ path: resolve(out, `${engine}-account.png`) });
      await page.evaluate(() => window.profileStatusFixture.event("work", "paused", 3));
      await page.getByRole("status").filter({ hasText: "Sync paused · 3 pending" }).waitFor();
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-paused.png`) });
      await page.getByRole("button", { name: "Open settings" }).click();
      assert.ok((await calls()).includes("settings"));
      await page.getByRole("button", { name: "Personal account", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Sync status loading" }).waitFor();
      await page.evaluate(() => window.profileStatusFixture.event("work", "error", 9));
      assert.equal(await page.getByRole("status").textContent(), "Sync status loading");
      await page.getByRole("button", { name: "Local", exact: true }).click();
      await page.evaluate(() => {
        window.profileStatusFixture.resolve(1, "personal");
        window.profileStatusFixture.event("personal", "offline", 2);
      });
      await page.getByRole("status").filter({ hasText: "Stored on this device" }).waitFor();
      assert.equal((await calls()).filter((call) => call === "snapshot").length, 2);
      assert.ok((await calls()).includes("stop:personal"));
      await page.getByRole("button", { name: "Work account", exact: true }).click();
      await page.evaluate(() => {
        window.profileStatusFixture.event("work", "syncing", 1);
        window.profileStatusFixture.resolve(2, "work");
      });
      await page.getByRole("status").filter({ hasText: "Syncing · 1 pending" }).waitFor();
      await page.setViewportSize({ width: 390, height: 700 });
      assert.equal(
        await page
          .locator(".chat-account-row")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-narrow.png`) });
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: Local, Account, paused, cached/event ordering, profile switch cleanup and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
