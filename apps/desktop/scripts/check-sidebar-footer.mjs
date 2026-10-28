/**
 * The production sidebar footer (the logo and one Settings button) with synthetic profile switches
 * and delayed sync status only: no agent dock, no profile row, and a sync dot only while an
 * account's sync needs a hand.
 */
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
const out = resolve(app, "../../target/sidebar-footer-browser");
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
      await page.goto(`${origin}/scripts/fixtures/sidebar-footer.html`);
      const sidebar = page.getByRole("complementary", { name: "Sidebar" });
      const settings = sidebar.getByTestId("sidebar-settings");
      const named = (name) =>
        page.waitForFunction(
          (expected) =>
            document
              .querySelector('[data-testid="sidebar-settings"]')
              ?.getAttribute("aria-label") === expected,
          name,
        );
      await named("Open settings");
      const calls = () => page.evaluate(() => window.sidebarFooterFixture.calls());
      assert.deepEqual(await calls(), []);
      // Only the logo and Settings: no agent tiles, no profile row, no status text.
      assert.equal(await sidebar.locator(".g-agent-mark").count(), 0);
      assert.equal(await sidebar.getByRole("status").count(), 0);
      assert.equal(await sidebar.locator(".chat-sidebar-footer-logo").count(), 1);
      assert.equal(await sidebar.locator("button, summary, a").count(), 1);
      assert.equal(await settings.getAttribute("aria-keyshortcuts"), "Control+, Meta+,");
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await sidebar.screenshot({ path: resolve(out, `${engine}-local.png`) });
      await page.getByRole("button", { name: "Work account", exact: true }).click();
      await page.evaluate(() => window.sidebarFooterFixture.resolve(0, "work"));
      await named("Open settings");
      assert.equal(await settings.getAttribute("data-attention"), null);
      await page.evaluate(() => window.sidebarFooterFixture.event("work", "paused", 3));
      await named("Open settings, sync paused · 3 pending");
      assert.equal(await settings.getAttribute("data-attention"), "");
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await sidebar.screenshot({ path: resolve(out, `${engine}-paused.png`) });
      await settings.click();
      assert.ok((await calls()).includes("settings"));
      // Another profile never shows a status cached for the one before it.
      await page.getByRole("button", { name: "Personal account", exact: true }).click();
      await named("Open settings");
      await page.evaluate(() => window.sidebarFooterFixture.event("work", "error", 9));
      assert.equal(await settings.getAttribute("aria-label"), "Open settings");
      await page.getByRole("button", { name: "Local", exact: true }).click();
      await page.evaluate(() => {
        window.sidebarFooterFixture.resolve(1, "personal");
        window.sidebarFooterFixture.event("personal", "error", 2);
      });
      await named("Open settings");
      assert.equal(await settings.getAttribute("data-attention"), null);
      assert.equal((await calls()).filter((call) => call === "snapshot").length, 2);
      assert.ok((await calls()).includes("stop:personal"));
      await page.getByRole("button", { name: "Work account", exact: true }).click();
      await page.evaluate(() => {
        window.sidebarFooterFixture.event("work", "syncing", 1);
        window.sidebarFooterFixture.resolve(2, "work");
      });
      await named("Open settings");
      await page.setViewportSize({ width: 390, height: 700 });
      assert.equal(
        await sidebar
          .locator(".chat-sidebar-footer")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-narrow.png`) });
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: logo and Settings only, sync dot on paused, cached/event ordering, profile switch cleanup and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
